use super::support::{check, check_only, with_program};
use bun_sema::check::aot::{
    BuiltinTypeSymbols, GaveUp, NamedValue, NamedValues, QueryInputs, QueryStatistics,
};
use bun_sema::hir::ExprId;
use bun_sema::program::{FileId, FileRole};
use std::fmt::Write;
use std::sync::Mutex;

const LEVELS_UNDER_BUDGET: usize = 38;
const LEVELS_OVER_BUDGET: usize = 40;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

fn write_family(text: &mut String, name: char, levels: usize, steps: [usize; 4], last_leaf: &str) {
    for level in 0..levels {
        for index in 0..=level {
            write!(text, "interface {name}{level}_{index} {{").unwrap();
            if level + 1 == levels {
                let leaf = if index == level { last_leaf } else { "number" };
                write!(text, " end: {leaf};").unwrap();
            } else {
                for (member, step) in steps.into_iter().enumerate() {
                    write!(text, " p{member}: {name}{}_{};", level + 1, index + step).unwrap();
                }
            }
            text.push_str(" }\n");
        }
    }
}

fn write_families(levels: usize, last_leaf_of_b: &str) -> String {
    let mut text = String::new();
    write_family(&mut text, 'A', levels, [0, 0, 1, 1], "number");
    write_family(&mut text, 'B', levels, [0, 1, 0, 1], last_leaf_of_b);
    text
}

fn write_closed_families(levels: usize) -> String {
    let mut text = write_families(levels, "number");
    for name in ['A', 'B'] {
        for index in 0..levels {
            writeln!(
                text,
                "interface {name}{}_{index} {{ back: {name}0_0; }}",
                levels - 1
            )
            .unwrap();
        }
    }
    text
}

fn write_chains(levels: usize) -> String {
    let mut text = String::new();
    for name in ['A', 'B'] {
        for level in 0..levels {
            writeln!(
                text,
                "interface {name}{level}_0 {{ next: {name}{}_0; }}",
                level + 1
            )
            .unwrap();
        }
        writeln!(text, "interface {name}{levels}_0 {{ end: number; }}").unwrap();
    }
    text
}

fn write_unions_over_size_limit() -> String {
    let mut text = String::new();
    for name in ['L', 'R'] {
        for index in 0..320 {
            writeln!(text, "interface {name}{index} {{ {name}{index}: number; }}").unwrap();
        }
        let members: Vec<String> = (0..320).map(|index| format!("{name}{index}")).collect();
        writeln!(text, "type {name} = {};", members.join(" | ")).unwrap();
    }
    text.push_str("interface Results { left: L; right: R; }\n");
    text.push_str("type A0_0 = () => L0;\n");
    text.push_str("type B0_0 = <Name extends keyof Results>() => Results[Name];\n");
    text
}

type Answer = Result<bool, GaveUp>;

struct Asked {
    answers: Vec<Answer>,
    statistics: QueryStatistics,
    codes: Vec<u32>,
}

const ASKS: &str = "declare const source: A0_0;\ndeclare const target: B0_0;\nexport {};\n";
const ASSIGNS: &str = "declare const source: A0_0;\nexport const target: B0_0 = source;\n";

fn list_files<'a>(families: &'a str, main: &'a str) -> [(&'a str, &'a str); 4] {
    [
        ("families.d.ts", families),
        ("main.ts", main),
        ("asks.ts", ASKS),
        ("assigns.ts", ASSIGNS),
    ]
}

fn check_only_codes(families: &str) -> Vec<u32> {
    let files = list_files(families, ASSIGNS_ONLY);
    with_program(&files, &["./main.ts"], 1, |program| {
        check_only(program).codes()
    })
}

fn ask(families: &str, main: &str) -> Asked {
    let files = list_files(families, main);
    with_program(&files, &["./main.ts"], 1, |program| {
        let all = program.files();
        let roles: Vec<FileRole> = (0..all.modules.len() as u32)
            .map(|file| all.role(FileId(file)))
            .collect();
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], &[]),
            named_values: &NoNamedValues,
            max_inference_nodes: 0,
        };
        let asks = program.file("asks.ts");
        let answers = Mutex::new(Vec::new());
        let build = check(program, &|checker, file| {
            (file == asks).then(|| {
                checker.with_queries(file, inputs, |queries| {
                    let declarations = &queries.hir().var_decls;
                    let (source, target) = (declarations[0].pat, declarations[1].pat);
                    let source = queries.binding_type(source).unwrap();
                    let target = queries.binding_type(target).unwrap();
                    let answer = queries.is_assignable(source, target);
                    answers.lock().unwrap().push(answer);
                    queries.statistics()
                })
            })
        });
        assert!(build.program.incomplete.is_empty());
        let codes = build.codes();
        let kept = build
            .program
            .lowered
            .into_iter()
            .find_map(|(_, asked)| asked);
        Asked {
            answers: answers.into_inner().unwrap(),
            statistics: kept.expect("asks.ts is lowered"),
            codes,
        }
    })
}

const ASKS_ONLY: &str = "import \"./asks\";\n";
const ASSIGNS_ONLY: &str = "import \"./assigns\";\n";
const ASKS_THEN_ASSIGNS: &str = "import \"./asks\";\nimport \"./assigns\";\n";
const ASSIGNS_THEN_ASKS: &str = "import \"./assigns\";\nimport \"./asks\";\n";

fn count_given_up(statistics: &QueryStatistics) -> u32 {
    statistics.gave_up.iter().sum()
}

fn assert_gave_up(asked: &Asked) {
    assert_eq!(asked.answers, [Err(GaveUp::Unresolved)]);
    assert_eq!(asked.statistics.asked, 3);
    assert_eq!(count_given_up(&asked.statistics), 1);
    assert_eq!(asked.statistics.gave_up[GaveUp::Unresolved as usize], 1);
}

fn assert_answered(asked: &Asked, answer: bool) {
    assert_eq!(asked.answers, [Ok(answer)]);
    assert_eq!(count_given_up(&asked.statistics), 0);
}

#[test]
fn question_over_budget_gives_up_and_reports_nothing() {
    for last_leaf_of_b in ["number", "string"] {
        let asked = ask(
            &write_families(LEVELS_OVER_BUDGET, last_leaf_of_b),
            ASKS_ONLY,
        );
        assert_gave_up(&asked);
        assert_eq!(asked.codes, [0; 0]);
    }
}

#[test]
fn question_under_budget_is_answered() {
    for (last_leaf_of_b, answer) in [("number", true), ("string", false)] {
        let asked = ask(
            &write_families(LEVELS_UNDER_BUDGET, last_leaf_of_b),
            ASKS_ONLY,
        );
        assert_answered(&asked, answer);
        assert_eq!(asked.codes, [0; 0]);
    }
}

#[test]
fn results_that_wait_for_outermost_comparison_count() {
    let asked = ask(&write_closed_families(LEVELS_OVER_BUDGET), ASKS_ONLY);
    assert_gave_up(&asked);
    assert_eq!(asked.codes, [0; 0]);

    let asked = ask(&write_closed_families(LEVELS_UNDER_BUDGET), ASKS_ONLY);
    assert_answered(&asked, true);
}

#[test]
fn check_after_question_over_budget_gets_the_true_answer() {
    for (last_leaf_of_b, codes) in [("number", &[][..]), ("string", &[2322][..])] {
        let asked = ask(
            &write_families(LEVELS_OVER_BUDGET, last_leaf_of_b),
            ASKS_THEN_ASSIGNS,
        );
        assert_gave_up(&asked);
        assert_eq!(asked.codes, codes);
    }
    let asked = ask(
        &write_closed_families(LEVELS_OVER_BUDGET),
        ASKS_THEN_ASSIGNS,
    );
    assert_gave_up(&asked);
    assert_eq!(asked.codes, [0; 0]);
}

#[test]
fn answer_does_not_depend_on_what_is_settled() {
    for (last_leaf_of_b, codes) in [("number", &[][..]), ("string", &[2322][..])] {
        let asked = ask(
            &write_families(LEVELS_OVER_BUDGET, last_leaf_of_b),
            ASSIGNS_THEN_ASKS,
        );
        assert_gave_up(&asked);
        assert_eq!(asked.codes, codes);
    }
    let asked = ask(
        &write_closed_families(LEVELS_OVER_BUDGET),
        ASSIGNS_THEN_ASKS,
    );
    assert_gave_up(&asked);
    let asked = ask(&write_chains(120), ASSIGNS_THEN_ASKS);
    assert_gave_up(&asked);
}

fn write_member_past_instantiation_limit(length: usize) -> String {
    let elements: Vec<String> = (0..length).map(|index| index.to_string()).collect();
    format!(
        "type Reversed<T extends unknown[]> = T extends [infer First, ...infer Rest] ? [...Reversed<Rest>, First] : [];
        interface A0_0 {{ member: string; }}
        interface B0_0 {{ member: Reversed<[{}]>; }}\n",
        elements.join(", ")
    )
}

#[test]
fn question_that_hits_instantiation_limit_gives_up() {
    assert_answered(
        &ask(&write_member_past_instantiation_limit(10), ASKS_ONLY),
        false,
    );
    let asked = ask(&write_member_past_instantiation_limit(200), ASKS_ONLY);
    assert!(!asked.answers.is_empty());
    assert!(
        asked
            .answers
            .iter()
            .all(|&answer| answer == Err(GaveUp::ErrorType)),
        "{:?}",
        asked.answers
    );
    assert_eq!(asked.codes, [0; 0]);
}

#[test]
fn question_that_is_too_deep_gives_up_and_changes_no_check() {
    let chains = write_chains(120);
    let asked = ask(&chains, ASKS_THEN_ASSIGNS);
    assert_gave_up(&asked);
    assert_eq!(asked.codes, check_only_codes(&chains));
    assert_eq!(asked.codes, [0; 0]);

    assert_answered(&ask(&write_chains(90), ASKS_ONLY), true);
}

#[test]
fn question_at_union_size_limit_keeps_its_task() {
    let asked = ask(&write_unions_over_size_limit(), ASKS_ONLY);
    assert_eq!(asked.answers, [Err(GaveUp::ErrorType)]);
    assert_eq!(asked.codes, [0; 0]);
}

#[test]
fn check_reports_union_size_limit_whatever_was_asked() {
    let unions = write_unions_over_size_limit();
    assert_eq!(check_only_codes(&unions), [2590]);
    for main in [ASKS_THEN_ASSIGNS, ASSIGNS_THEN_ASKS] {
        let asked = ask(&unions, main);
        assert_eq!(asked.answers.last(), Some(&Err(GaveUp::ErrorType)));
        assert_eq!(asked.codes, [2590]);
    }
}
