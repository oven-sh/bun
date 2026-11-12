use super::support::with_program;
use crate::{PassCount, Passes, check_and_lower_noting_commits, decide_roles};
use bun_sema::check::Checker;
use bun_sema::check::aot::{
    BuiltinTypeSymbols, ListedMember, NamedValue, NamedValues, Queries, QueryInputs,
};
use bun_sema::hir::{ExprId, FnId};
use bun_sema::program::{FileId, FileRole};
use bun_sema::types::TypeId;
use std::fmt::Write;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

#[derive(Default)]
struct Turns {
    reached: Mutex<u32>,
    has_changed: Condvar,
}

impl Turns {
    fn reach(&self, step: u32) {
        let mut reached = self.reached.lock().unwrap();
        *reached = step.max(*reached);
        self.has_changed.notify_all();
    }

    fn wait_for(&self, step: u32) {
        let reached = self.reached.lock().unwrap();
        let is_early = |reached: &mut u32| *reached < step;
        let patience = Duration::from_secs(60);
        let waited = self
            .has_changed
            .wait_timeout_while(reached, patience, is_early);
        assert!(
            !waited.unwrap().1.timed_out(),
            "nobody has reached step {step}"
        );
    }
}

const HAS_LISTED: u32 = 1;
const HAS_COMMITTED: u32 = 2;

const OTHER_TYPES: u32 = 1100;

const HOLDER: &str = "import { make } from \"./gadget\";
declare const base: unique symbol;
export const holder = { key: base, first: make().start } as const;
export function hold() { return holder; }
export declare function probe(): Shop.Gadget;
";

const GADGET: &str = "import { holder } from \"./holder\";
const key: typeof holder.key = holder.key;
declare global {
    interface Symbol {}
    namespace Shop {
        interface Gadget {
            start(): number;
            [key]?: string;
            stop: boolean;
        }
    }
}
export declare function make(): Shop.Gadget;
";

fn write_user() -> String {
    let mut text = String::from("export declare function probe(): Shop.Gadget;\n");
    for number in 0..OTHER_TYPES {
        writeln!(text, "interface Other{number} {{ part: number }}").unwrap();
        writeln!(
            text,
            "export declare function other{number}(): Other{number};"
        )
        .unwrap();
    }
    text
}

fn describe(queries: &mut Queries<'_, '_, '_>, gadget: TypeId, member: ListedMember) -> String {
    match queries.listed_member_types(gadget, member).checked {
        Ok(ty) => String::from_utf8(queries.type_text(ty)).unwrap(),
        Err(reason) => format!("{reason:?}"),
    }
}

#[derive(PartialEq, Eq, Debug)]
struct Visit {
    types: Vec<String>,
    is_discarded: bool,
}

fn visit_user(threads: usize, asked: usize) -> Vec<Visit> {
    let user_text = write_user();
    let files = [
        ("main.ts", "import \"./holder\";\nimport \"./user\";\n"),
        ("holder.ts", HOLDER),
        ("gadget.ts", GADGET),
        ("user.ts", user_text.as_str()),
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
            alias_mentions: None,
            max_inference_nodes: 4096,
            limits: Default::default(),
        };
        let (holder, user) = (program.file("holder.ts"), program.file("user.ts"));
        let turns = Turns::default();
        let takes_turns = threads > 1;
        let visits = Mutex::new(Vec::new());
        let lower = |checker: &mut Checker<'_, '_>, file: FileId| {
            if file == holder {
                if takes_turns {
                    turns.wait_for(HAS_LISTED);
                }
                checker.with_queries(file, &inputs, |queries| {
                    queries.return_type(FnId(0)).unwrap();
                    let gadget = queries.return_type(FnId(1)).unwrap();
                    queries.listed_members(gadget).unwrap();
                });
            }
            if file == user {
                let visit = checker.with_queries(file, &inputs, |queries| {
                    let gadget = queries.return_type(FnId(0)).unwrap();
                    let members = queries.listed_members(gadget).unwrap();
                    if takes_turns {
                        turns.reach(HAS_LISTED);
                        turns.wait_for(HAS_COMMITTED);
                    }
                    for other in 1..=OTHER_TYPES {
                        let other = queries.return_type(FnId(other)).unwrap();
                        queries.listed_members(other).unwrap();
                    }
                    let asked = members.get(asked).copied();
                    Visit {
                        types: asked
                            .map(|member| describe(queries, gadget, member))
                            .into_iter()
                            .collect(),
                        is_discarded: queries.is_discarded(),
                    }
                });
                visits.lock().unwrap().push(visit);
            }
            Some(())
        };
        let files_to_lower = all.compiled_files();
        let (loaded, host, request) = (program.loaded, program.host, program.request);
        let decided = decide_roles(loaded, host, request, files_to_lower);
        check_and_lower_noting_commits(
            loaded,
            host,
            request,
            &decided,
            files_to_lower,
            &|checker, file, _| lower(checker, file),
            &|file, _| {
                if file == holder {
                    turns.reach(HAS_COMMITTED);
                }
            },
            &Passes {
                count: PassCount::Exactly(1),
                before_next: &|| {},
            },
        );
        visits.into_inner().unwrap()
    })
}

#[track_caller]
fn assert_gives_up_and_comes_again(asked: usize) {
    let lost = Visit {
        types: vec!["Unresolved".to_owned()],
        is_discarded: true,
    };
    let [alone] = visit_user(1, asked).try_into().unwrap();
    assert!(!alone.is_discarded);
    assert_eq!(visit_user(2, asked), [lost, alone]);
}

#[test]
fn member_is_not_read_from_its_neighbor_in_the_list_of_another_task() {
    assert_gives_up_and_comes_again(1);
}

#[test]
fn member_is_not_read_behind_the_end_of_the_list_of_another_task() {
    assert_gives_up_and_comes_again(2);
}
