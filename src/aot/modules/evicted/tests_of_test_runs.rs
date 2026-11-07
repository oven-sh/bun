use crate::modules::testing::{file_named, with_graph_of_test_files};

const GAUGE: (&str, &str) = (
    "gauge.cjs",
    "if (globalThis.cold) throw 0;\nexports.reading = 1;",
);

fn files_that_run_again<'a>(
    files: &[(&'a str, &str)],
    test_files: usize,
    preloads: usize,
) -> Vec<&'a str> {
    with_graph_of_test_files(files, test_files, preloads, |graph, input| {
        let names = files.iter().map(|&(name, _)| name);
        names
            .filter(|name| graph.runs_again(file_named(input, name)))
            .collect()
    })
}

#[test]
fn what_threw_under_one_test_file_runs_again_for_the_next() {
    let asks = "import { test } from 'bun:test';\nconst gauge = require('./gauge.cjs');\ntest('reads', () => gauge.reading);";
    let files = [("a.test.ts", asks), ("b.test.ts", asks), GAUGE];
    assert_eq!(files_that_run_again(&files, 2, 0), ["gauge.cjs"]);
    assert!(files_that_run_again(&[("a.test.ts", asks), GAUGE], 1, 0).is_empty());
}

#[test]
fn what_lies_below_the_file_that_threw_runs_again_with_it() {
    let asks = "const outer = require('./outer.cjs');";
    let outer = (
        "outer.cjs",
        "const gauge = require('./gauge.cjs');\nexports.reading = gauge.reading;",
    );
    let files = [("a.test.ts", asks), ("b.test.ts", asks), outer, GAUGE];
    assert_eq!(
        files_that_run_again(&files, 2, 0),
        ["outer.cjs", "gauge.cjs"]
    );
}

#[test]
fn what_one_test_file_alone_asks_for_is_told_apart_wherever_the_test_file_stands() {
    let own = ("own.cjs", "exports.name = 1;");
    let shared = "const gauge = require('./gauge.cjs');";
    let with_own = "const own = require('./own.cjs');\nconst gauge = require('./gauge.cjs');";
    let first_has_it = [("a.test.ts", with_own), ("b.test.ts", shared), own, GAUGE];
    assert_eq!(files_that_run_again(&first_has_it, 2, 0), ["gauge.cjs"]);
    let second_has_it = [("a.test.ts", shared), ("b.test.ts", with_own), own, GAUGE];
    assert_eq!(files_that_run_again(&second_has_it, 2, 0), ["gauge.cjs"]);
}

#[test]
fn a_test_function_of_a_later_file_asks_for_what_threw_under_an_earlier_one() {
    let at_the_top = "const gauge = require('./gauge.cjs');";
    let in_a_test =
        "import { test } from 'bun:test';\ntest('reads', () => require('./gauge.cjs').reading);";
    let files = [("a.test.ts", at_the_top), ("b.test.ts", in_a_test), GAUGE];
    assert_eq!(files_that_run_again(&files, 2, 0), ["gauge.cjs"]);
}

#[test]
fn a_test_file_does_not_run_again_for_being_started() {
    let asks = "const gauge = require('./gauge.cjs');";
    let files = [("a.test.cjs", asks), ("b.test.cjs", asks), GAUGE];
    assert_eq!(files_that_run_again(&files, 2, 0), ["gauge.cjs"]);
}

#[test]
fn what_a_preload_hands_out_is_callable_from_the_first_statement_of_a_test_file() {
    let test_file = "console.log(globalThis.attempt());\nconst gauge = require('./gauge.cjs');";
    let setup = "globalThis.attempt = () => {\n  try { return require('./gauge.cjs').reading; } catch { return 0; }\n};";
    let files = [("a.test.ts", test_file), ("setup.ts", setup), GAUGE];
    assert_eq!(files_that_run_again(&files, 1, 1), ["gauge.cjs"]);
}

#[test]
fn a_hoisted_statement_runs_in_front_of_the_imports_that_are_written_above_it() {
    let panel = (
        "panel.cjs",
        "globalThis.probe();\nconst gauge = require('./gauge.cjs');",
    );
    let probe = "vi.hoisted(() => {\n  globalThis.probe = () => {\n    try { require('./gauge.cjs'); } catch {}\n  };\n});";
    let head = "import { vi } from 'bun:test';";
    let below = format!("{head}\nimport './panel.cjs';\n{probe}");
    let above = format!("{head}\n{probe}\nimport './panel.cjs';");
    for test_file in [&below, &above] {
        let files = [("a.test.ts", &test_file[..]), panel, GAUGE];
        assert_eq!(
            files_that_run_again(&files, 1, 0),
            ["gauge.cjs"],
            "{test_file}"
        );
    }
    let in_place = format!(
        "import './panel.cjs';\n{}",
        probe.replace("vi.hoisted", "(run => run())")
    );
    let files = [("a.test.ts", &in_place[..]), panel, GAUGE];
    assert!(files_that_run_again(&files, 1, 0).is_empty());
}
