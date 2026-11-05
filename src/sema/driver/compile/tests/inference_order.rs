use super::support::{check, with_program};
use bun_sema::check::aot::{
    BuiltinTypeSymbols, NamedValue, NamedValues, QueryInputs, QueryStatistics,
};
use bun_sema::hir::{ExprId, FnId};
use bun_sema::program::{FileId, FileRole};
use std::fmt::Write;
use std::sync::Mutex;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

fn write_visitors(kinds: usize) -> String {
    let mut text = String::from("export function visit(left, right) {\n");
    for kind in 0..kinds {
        writeln!(
            text,
            "    if (left.kind === {kind}) return from{kind}(left, right);"
        )
        .unwrap();
    }
    text.push_str("    return left.fallback(right.fallback);\n}\n");
    for kind in 0..kinds {
        let (next, far) = ((kind + 1) % kinds, (kind + 7) % kinds);
        writeln!(
            text,
            "export function from{kind}(left, right) {{
    if (right.any{kind}) return from{next}(left, right) || from{far}(left, right);
    if (left.own{kind} > 1) return visit(left.items, right.items) && visit(left.returns, right.returns);
    return right.list.some(part => visit(left, part)) || from{far}(left, right) || visit(left, right);
}}"
        )
        .unwrap();
    }
    text.push_str("export const first = visit({ kind: 0 }, { kind: 1 });\n");
    text
}

fn write_chain(length: usize) -> String {
    let mut text = String::new();
    for index in 0..length {
        let next = index + 1;
        writeln!(
            text,
            "export function step{index}(value) {{ step{next}(value); }}"
        )
        .unwrap();
    }
    writeln!(
        text,
        "export function step{length}(value) {{ return value.size; }}"
    )
    .unwrap();
    text
}

fn write_ring(length: usize, handed_on: &str) -> String {
    let mut text = String::new();
    for index in 0..length {
        let (own, next) = (index % 8, (index + 1) % length);
        writeln!(
            text,
            "export function step{index}(value) {{ if (value.own{own}) step{next}({handed_on}); }}"
        )
        .unwrap();
    }
    text
}

fn write_functions_that_call_one_another_at_random(count: usize) -> String {
    let mut seed = 7;
    let mut next = || {
        seed = seed * 48_271 % 2_147_483_647;
        seed % count
    };
    let mut text = String::new();
    for index in 0..count {
        writeln!(text, "function f{index}(node, depth) {{").unwrap();
        for tag in 0..3 {
            let callee = next();
            writeln!(
                text,
                "    if (node.tag === {tag}) return f{callee}(node.next, depth + {tag});"
            )
            .unwrap();
        }
        text.push_str("    return node.value;\n}\n");
    }
    text.push_str("export const first = f0({ tag: 9, value: 1, next: null }, 0);\n");
    text
}

fn write_two_that_read_many_members_and_one_that_calls(reads: usize) -> String {
    let mut text = String::from("export function first(value) {\n");
    for index in 0..reads {
        writeln!(text, "    value.own{index};").unwrap();
    }
    text.push_str("    second(value);\n    return run(value);\n}\n");
    text.push_str("export function second(value) {\n    first(value);\n");
    for index in 0..reads {
        writeln!(text, "    value.other{index};").unwrap();
    }
    text.push_str("}\nexport function run(value) {\n    return value();\n}\n");
    text
}

fn write_two_that_read_a_wide_tree_and_one_that_calls() -> String {
    let mut text = String::from(
        "export function first(value) {
    level0(value.own);
    second(value);
    return run(value);
}
export function second(value) {
    first(value);
    level0(value.other);
}
export function run(value) {
    return value();
}
",
    );
    for level in 0..5 {
        let next = level + 1;
        writeln!(
            text,
            "export function level{level}(node) {{
    level{next}(node.north);
    level{next}(node.east);
    level{next}(node.south);
    level{next}(node.west);
}}"
        )
        .unwrap();
    }
    text.push_str("export function level5(node) {\n    return node.size;\n}\n");
    text
}

#[derive(Copy, Clone, Debug)]
enum Order {
    AsWritten,
    LastFirst,
    Scattered,
}

fn ask_for_parameters(text: &str, order: Order) -> Vec<String> {
    ask_for_parameters_and_count(text, order, 4096).0
}

fn ask_for_parameters_and_count(
    text: &str,
    order: Order,
    max_inference_nodes: u64,
) -> (Vec<String>, QueryStatistics) {
    ask_for_parameters_of("main.ts", text, order, max_inference_nodes)
}

fn ask_for_parameters_of(
    name: &str,
    text: &str,
    order: Order,
    max_inference_nodes: u64,
) -> (Vec<String>, QueryStatistics) {
    ask_for_parameters_from_height(name, text, order, max_inference_nodes, 0)
}

fn call_higher_up(kilobytes: usize, then: &mut dyn FnMut()) {
    let in_use = std::hint::black_box([0u8; 1024]);
    match kilobytes {
        0 => then(),
        _ => call_higher_up(kilobytes - 1, then),
    }
    std::hint::black_box(in_use);
}

fn ask_for_parameters_from_height(
    name: &str,
    text: &str,
    order: Order,
    max_inference_nodes: u64,
    kilobytes_in_use: usize,
) -> (Vec<String>, QueryStatistics) {
    let files = [(name, text)];
    with_program(&files, &[&format!("./{name}")], 1, |program| {
        let all = program.files();
        let roles = vec![FileRole::Inferred; all.modules.len()];
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes,
            limits: Default::default(),
        };
        let main = program.file(name);
        let answers = Mutex::new((Vec::new(), QueryStatistics::default()));
        check(program, &|checker, file| {
            if file != main {
                return;
            }
            checker.set_has_stack_for_questions();
            checker.with_queries(file, &inputs, |queries| {
                let count = queries.hir().params.len();
                let mut asked: Vec<usize> = (0..count).collect();
                match order {
                    Order::AsWritten => {}
                    Order::LastFirst => asked.reverse(),
                    Order::Scattered => asked.sort_by_key(|&index| (index % 3, index)),
                }
                let mut texts = vec![String::new(); count];
                let mut types = Vec::with_capacity(count);
                call_higher_up(kilobytes_in_use, &mut || {
                    for &index in &asked {
                        let pattern = queries.hir().params[index].pat;
                        let ty = (queries.binding_type(pattern)).unwrap_or_else(|refusal| {
                            panic!("parameter {index}, {order:?}: {refusal:?}")
                        });
                        types.push((index, ty));
                    }
                });
                for (index, ty) in types {
                    texts[index] = String::from_utf8(queries.type_text(ty)).unwrap();
                }
                *answers.lock().unwrap() = (texts, queries.statistics());
            });
        });
        answers.into_inner().unwrap()
    })
}

#[test]
fn an_inherited_index_signature_does_not_depend_on_which_class_is_asked_for_first() {
    let text = "/** @type {symbol} */
let name;
class Top { [name]() { return 1; } }
class Middle extends Top { middle = 1; }
class Bottom extends Middle { bottom = 2; }
/** @param {Middle} it */
export function ofMiddle(it, found = it[name]) {}
/** @param {Bottom} it */
export function ofBottom(it, found = it[name]) {}
";
    for order in [Order::LastFirst, Order::AsWritten] {
        let answers = ask_for_parameters_of("main.js", text, order, 4096).0;
        let expected = ["Middle", "() => number", "Bottom", "() => number"];
        assert_eq!(answers, expected, "{order:?}");
    }
}

#[test]
fn types_in_a_cycle_do_not_depend_on_which_is_asked_for_first() {
    for kinds in [1, 2, 3, 4, 6, 8, 12, 16, 24, 48] {
        let text = write_visitors(kinds);
        let as_written = ask_for_parameters(&text, Order::AsWritten);
        let last_first = ask_for_parameters(&text, Order::LastFirst);
        assert_eq!(as_written, last_first, "{kinds} kinds");
        let scattered = ask_for_parameters(&text, Order::Scattered);
        assert_eq!(as_written, scattered, "{kinds} kinds");
    }
}

#[test]
fn types_in_a_cycle_of_private_functions_do_not_depend_on_which_is_asked_for_first() {
    let mut programs = Vec::new();
    for kinds in [1, 2, 3, 4, 6, 8, 12, 16, 24, 48] {
        programs.push(write_visitors(kinds));
    }
    for text in [
        write_two_that_read_a_wide_tree_and_one_that_calls(),
        write_two_that_read_many_members_and_one_that_calls(16),
    ] {
        programs.push(format!("{text}export const made = first(() => 1);\n"));
    }
    programs.push(write_functions_that_call_one_another_at_random(300));
    for text in programs {
        let text = text.replace("export function", "function");
        for max_inference_nodes in [4096, 100] {
            let ask = |order| ask_for_parameters_and_count(&text, order, max_inference_nodes).0;
            let as_written = ask(Order::AsWritten);
            for order in [Order::LastFirst, Order::Scattered] {
                assert_eq!(
                    as_written,
                    ask(order),
                    "{max_inference_nodes} nodes:\n{text}"
                );
            }
        }
    }
}

#[test]
fn what_a_walk_found_before_its_budget_ended_does_not_depend_on_which_is_asked_for_first() {
    let mut programs = vec![(write_two_that_read_a_wide_tree_and_one_that_calls(), 4096)];
    for reads in [4, 16, 64] {
        let text = write_two_that_read_many_members_and_one_that_calls(reads);
        for max_inference_nodes in 2 * reads..4 * reads {
            programs.push((text.clone(), max_inference_nodes as u64));
        }
    }
    for (text, max_inference_nodes) in programs {
        let ask = |order| ask_for_parameters_and_count(&text, order, max_inference_nodes).0;
        let as_written = ask(Order::AsWritten);
        for order in [Order::LastFirst, Order::Scattered] {
            assert_eq!(
                as_written[..3],
                ask(order)[..3],
                "{max_inference_nodes} nodes:\n{text}"
            );
        }
    }
}

#[test]
fn every_function_of_a_cycle_knows_what_the_others_read() {
    let answers = ask_for_parameters(&write_visitors(48), Order::AsWritten);
    let (left, right) = (&answers[0], &answers[1]);
    assert!(left.contains("own0") && left.contains("own19"), "{left}");
    assert!(right.contains("any0") && right.contains("any19"), "{right}");
    let count = |text: &String| answers.iter().filter(|&answer| answer == text).count();
    assert_eq!((count(left), count(right)), (49, 49 + 48));
}

#[test]
fn the_first_of_a_long_chain_of_calls_knows_what_the_last_reads() {
    let text = write_chain(20_000);
    for order in [Order::AsWritten, Order::LastFirst, Order::Scattered] {
        let answers = ask_for_parameters(&text, order);
        let last = answers.last().unwrap();
        assert!(last.contains("size"), "{last}");
        let differing = answers.iter().filter(|&answer| answer != last).count();
        assert_eq!(differing, 0);
    }
}

#[test]
fn a_cycle_of_functions_is_not_inferred_once_for_each_of_them() {
    for count in [300, 600] {
        let text = write_functions_that_call_one_another_at_random(count);
        for max_inference_nodes in [4096, 100] {
            for order in [Order::AsWritten, Order::LastFirst, Order::Scattered] {
                let (answers, statistics) =
                    ask_for_parameters_and_count(&text, order, max_inference_nodes);
                let named = answers.iter().filter(|answer| answer.contains("tag"));
                assert_eq!(named.count(), count);
                let types_inferred = statistics.types_inferred;
                assert!(
                    types_inferred <= 20 * count as u64,
                    "{types_inferred} types inferred for {count} functions"
                );
            }
        }
    }
}

#[test]
fn every_function_of_a_long_cycle_of_calls_knows_what_the_others_read() {
    let length = 20_000;
    let text = write_ring(length, "value");
    for order in [Order::AsWritten, Order::LastFirst, Order::Scattered] {
        let (answers, statistics) = ask_for_parameters_and_count(&text, order, 4096);
        let first = &answers[0];
        assert!(first.contains("own0") && first.contains("own7"), "{first}");
        let differing = answers.iter().filter(|&answer| answer != first).count();
        assert_eq!(differing, 0);
        let usages_walked = statistics.usages_walked;
        assert!(
            usages_walked <= 10 * length as u64,
            "the uses of {usages_walked} parameters walked for {length} functions"
        );
    }
}

#[test]
fn a_long_cycle_of_calls_that_hand_on_a_part_is_walked_once() {
    let length = 20_000;
    let text = write_ring(length, "value.rest");
    for order in [Order::AsWritten, Order::LastFirst, Order::Scattered] {
        let (answers, statistics) = ask_for_parameters_and_count(&text, order, 4096);
        for (index, answer) in answers.iter().enumerate() {
            let own = format!("own{}", index % 8);
            assert!(answer.contains(&own) && answer.contains("rest"), "{answer}");
        }
        let usages_walked = statistics.usages_walked;
        assert!(
            usages_walked <= 10 * length as u64,
            "the uses of {usages_walked} parameters walked for {length} functions"
        );
    }
}

#[test]
fn a_cycle_of_functions_that_is_deeper_than_the_stack_is_walked_once() {
    let count = 6_000;
    let text = write_functions_that_call_one_another_at_random(count);
    for order in [Order::AsWritten, Order::LastFirst, Order::Scattered] {
        let (answers, statistics) = ask_for_parameters_and_count(&text, order, 4096);
        let named = answers.iter().filter(|answer| answer.contains("tag"));
        assert_eq!(named.count(), count);
        let usages_walked = statistics.usages_walked;
        assert!(
            usages_walked <= 20 * count as u64,
            "the uses of {usages_walked} parameters walked for {count} functions"
        );
    }
}

#[test]
fn an_answer_does_not_depend_on_how_much_stack_the_asker_has_in_use() {
    let text = write_functions_that_call_one_another_at_random(6_000);
    let ask = |kilobytes| {
        ask_for_parameters_from_height("main.ts", &text, Order::AsWritten, 4096, kilobytes).0
    };
    let from_the_bottom = ask(0);
    for kilobytes in [500, 1_000, 2_000] {
        assert!(from_the_bottom == ask(kilobytes), "{kilobytes} KB in use");
    }
}

fn ask_for_results_of_a_circle_across_files(threads: usize) -> Vec<String> {
    let files = [
        ("main.ts", "import \"./a\";\nimport \"./b\";\n"),
        (
            "a.ts",
            "import { g } from \"./b\";\nexport function f() { return [g()]; }\n",
        ),
        (
            "b.ts",
            "import { f } from \"./a\";\nexport function g() { return { v: f() }; }\n",
        ),
    ];
    with_program(&files, &["./main.ts"], threads, |program| {
        let all = program.files();
        let roles: Vec<FileRole> = (0..all.modules.len() as u32)
            .map(|file| all.role(FileId(file)))
            .collect();
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 4096,
            limits: Default::default(),
        };
        let build = check(program, &|checker, file| {
            checker.with_queries(file, &inputs, |queries| {
                let mut texts = Vec::new();
                for function in 0..queries.hir().fns.len() as u32 {
                    texts.push(match queries.return_type(FnId(function)) {
                        Ok(ty) => String::from_utf8(queries.type_text(ty)).unwrap(),
                        Err(refusal) => format!("{refusal:?}"),
                    });
                }
                texts
            })
        });
        let lowered = build.program.lowered.iter();
        lowered.flat_map(|file| file.1.clone()).collect()
    })
}

#[test]
fn types_in_a_circle_across_files_do_not_depend_on_the_threads() {
    let on_one_thread = ask_for_results_of_a_circle_across_files(1);
    assert_eq!(on_one_thread.len(), 2);
    for attempt in 0..20 {
        let on_four_threads = ask_for_results_of_a_circle_across_files(4);
        assert_eq!(on_one_thread, on_four_threads, "attempt {attempt}");
    }
}

#[test]
fn a_function_is_listed_once_among_the_members_of_the_cycles_it_is_in() {
    for count in [300, 600] {
        let text = write_functions_that_call_one_another_at_random(count);
        let files = [("main.ts", text.as_str())];
        with_program(&files, &["./main.ts"], 1, |program| {
            let all = program.files();
            let roles: Vec<FileRole> = (0..all.modules.len() as u32)
                .map(|file| all.role(FileId(file)))
                .collect();
            let inputs = QueryInputs {
                roles: &roles,
                checked_elsewhere: &[],
                builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
                named_values: &NoNamedValues,
                max_inference_nodes: 0,
                limits: Default::default(),
            };
            let build = check(program, &|checker, file| {
                checker.with_queries(file, &inputs, |queries| {
                    for function in 0..queries.hir().fns.len() as u32 {
                        let _ = queries.return_type(FnId(function));
                    }
                });
                checker.cycle_members_added()
            });
            let added: u64 = build.program.lowered.iter().map(|file| file.1).sum();
            assert!(
                (1..=40 * count as u64).contains(&added),
                "{added} members of cycles for {count} functions"
            );
        });
    }
}
