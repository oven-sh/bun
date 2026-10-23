use bun_sema::hir::StmtKind;
use bun_sema::program::Files;

use super::LeftOutDeclarations;
use crate::compile::testing::lower_program_without;

const PROGRAM: &str = "function define(name: string, initialize: () => number) { return { name, initialize }; }
export const kept = define(\"kept\", function initializeKept() { return 1; });
export const dropped = define(\"dropped\", function initializeDropped() { return 2; }),
  keptBeside = define(\"keptBeside\", function initializeKeptBeside() { return 3; });
export class DroppedClass {
  methodOfDroppedClass() { return 4; }
  static createDropped() { return new DroppedClass(); }
}
export class DroppedByStatement { methodOfDroppedByStatement() { return 5; } }
export class KeptClass { methodOfKeptClass() { return 6; } }
define(\"statement\", function initializeStatement() { return 7; });
export enum DroppedEnum { First = define(\"enum\", function initializeEnum() { return 8; }).name.length }
export default define(\"default\", function initializeDefault() { return 9; });
const droppedLocal = define(\"droppedLocal\", function initializeDroppedLocal() { return 10; }), keptLocal = 11;
export function readsLocals() { return [droppedLocal, keptLocal]; }
";

const KEPT: [&str; 5] = [
    "define",
    "initializeKept",
    "initializeKeptBeside",
    "methodOfKeptClass",
    "readsLocals",
];

const DROPPED: [&str; 8] = [
    "initializeDropped",
    "methodOfDroppedClass",
    "createDropped",
    "methodOfDroppedByStatement",
    "initializeStatement",
    "initializeEnum",
    "initializeDefault",
    "initializeDroppedLocal",
];

fn leave_out_what_is_called_dropped(files: &Files<'_>) -> LeftOutDeclarations {
    let file = files.entry_points()[0];
    let hir = files.hir(file);
    let mut left_out = LeftOutDeclarations::default();
    let mut class_count = 0;
    for statement in hir.ids(hir.body) {
        match hir[statement].kind {
            StmtKind::Var(declarations) if declarations.len == 2 => {
                let first = declarations.iter().next().expect("two declarators");
                left_out.leave_out_declarator(file, first);
            }
            StmtKind::Class(class) => {
                match class_count {
                    0 => left_out.leave_out_class(file, class),
                    1 => left_out.leave_out_statement(file, hir, statement),
                    _ => {}
                }
                class_count += 1;
            }
            StmtKind::Expr(_) | StmtKind::Enum(_) | StmtKind::ExportDefault(_) => {
                left_out.leave_out_statement(file, hir, statement);
            }
            _ => {}
        }
    }
    left_out
}

fn names_of_lowered_functions(choose: fn(&Files<'_>) -> LeftOutDeclarations) -> Vec<String> {
    let lowered = lower_program_without(&[("a.ts", PROGRAM)], choose);
    assert_eq!(lowered.len(), 1);
    let fragment = &lowered[0].1.fragment;
    let names = fragment
        .functions
        .iter()
        .filter_map(|(_, function)| function.name);
    names
        .map(|name| String::from_utf8_lossy(fragment.strings.get(name)).into_owned())
        .collect()
}

#[test]
fn whole_program_has_every_function() {
    let names = names_of_lowered_functions(|_| LeftOutDeclarations::default());
    for name in KEPT.iter().chain(&DROPPED) {
        assert!(
            names.iter().any(|it| it == name),
            "{name} is missing from {names:?}"
        );
    }
}

#[test]
fn what_is_left_out_is_not_evaluated() {
    let names = names_of_lowered_functions(leave_out_what_is_called_dropped);
    for name in KEPT {
        assert!(
            names.iter().any(|it| it == name),
            "{name} is missing from {names:?}"
        );
    }
    for name in DROPPED {
        assert!(names.iter().all(|it| it != name), "{name} is in {names:?}");
    }
}
