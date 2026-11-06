use super::{lower_files, lower_runtime_module};

const MARKED: &str = "export function probe(x: any, y: any) {
  if (x) { \"unlikely\"; return 1; }
  if (y) { x = 2; } else { \"unlikely\"; x = 3; if (y === 0) { \"unlikely\"; x = 4; } }
  if (x) { return 5; } else if (y) { \"unlikely\"; return 6; }
  return 7;
}";

fn without_marks(source: &str) -> String {
    source.replace("\"unlikely\";", "           ")
}

#[test]
fn a_mark_names_the_unlikely_arm_and_changes_nothing_else() {
    let marked = lower_runtime_module(MARKED);
    let marked = marked.function("probe").to_string();
    let plain = lower_runtime_module(&without_marks(MARKED));
    let plain = plain.function("probe").to_string();
    assert_eq!(marked.matches(" frequency=Unlikely").count(), 4, "{marked}");
    assert_eq!(plain.matches(" frequency=Unlikely").count(), 0, "{plain}");
    assert_eq!(marked.replace(" frequency=Unlikely", ""), plain);
}

#[test]
fn only_the_first_statement_of_an_arm_is_a_mark() {
    let source = "export function probe(x: any) { if (x) { x = 1; \"unlikely\"; } { \"unlikely\"; } return x; }";
    let lowered = lower_runtime_module(source);
    let lowered = lowered.function("probe").to_string();
    let marks = lowered.matches("frequency=Unlikely").count();
    assert_eq!(marks, 0, "{lowered}");
}

#[test]
fn a_program_of_the_user_has_no_marks() {
    let source = "export function probe(x: any) { if (x) { \"unlikely\"; return 1; } return 2; }";
    let lowered = lower_files(&[("main.ts", source)]);
    let lowered = lowered.function("probe").to_string();
    let marks = lowered.matches("frequency=Unlikely").count();
    assert_eq!(marks, 0, "{lowered}");
}
