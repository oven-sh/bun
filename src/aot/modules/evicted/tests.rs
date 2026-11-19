use crate::modules::testing::{file_named, with_graph};

fn files_that_run_again<'a>(files: &[(&'a str, &str)]) -> Vec<&'a str> {
    with_graph(files, |graph, input| {
        let names = files.iter().map(|&(name, _)| name);
        names
            .filter(|name| graph.may_be_reevaluated(file_named(input, name)))
            .collect()
    })
}

#[test]
fn import_cycle_swallows_commonjs_error() {
    let files = [
        ("main.mjs", "import './first.cjs';"),
        (
            "first.cjs",
            "require('./cycle.mjs');\nrequire('./thrower.cjs');",
        ),
        ("cycle.mjs", "import './imported.cjs';"),
        ("imported.cjs", "require('./thrower.cjs');"),
        ("thrower.cjs", "(() => require('./cycle.mjs'))();"),
    ];
    assert_eq!(files_that_run_again(&files), ["thrower.cjs"]);
    let mut without_cycle = files;
    without_cycle[4].1 = "exports.value = 1;";
    assert!(files_that_run_again(&without_cycle).is_empty());
}

#[test]
fn a_function_that_a_file_hands_out_may_ask_for_the_file_behind_its_throw() {
    let files = [
        ("main.cjs", "require('./flaky.cjs');"),
        (
            "flaky.cjs",
            "globalThis.retry = () => require('./flaky.cjs');\nif (globalThis.first) throw 0;",
        ),
    ];
    assert_eq!(files_that_run_again(&files), ["flaky.cjs"]);
}

#[test]
fn a_load_out_of_sight_may_ask_for_the_file_that_a_text_spells_behind_its_throw() {
    let lib = ("lib.cjs", "if (globalThis.first) throw 0;");
    let asks_first = "const handed = [require][0];\ntry { handed('./lib.cjs'); } catch {}\nrequire('./lib.cjs');";
    assert_eq!(
        files_that_run_again(&[("main.cjs", asks_first), lib]),
        ["lib.cjs"]
    );
    let nobody_loads_out_of_sight = "const text = './lib.cjs';\nrequire('./lib.cjs');";
    assert!(files_that_run_again(&[("main.cjs", nobody_loads_out_of_sight), lib]).is_empty());
}

#[test]
fn a_load_by_a_computed_name_may_ask_for_any_file() {
    let lib = ("lib.cjs", "if (globalThis.first) throw 0;");
    let computed = "globalThis.load = (name) => require(name);\nrequire('./lib.cjs');";
    let may_run_again = files_that_run_again(&[("main.cjs", computed), lib]);
    assert!(may_run_again.contains(&"lib.cjs"), "{may_run_again:?}");
    let behind = "require('./lib.cjs');\nglobalThis.load = (name) => require(name);";
    let may_run_again = files_that_run_again(&[("main.cjs", behind), lib]);
    assert!(!may_run_again.contains(&"lib.cjs"), "{may_run_again:?}");
}

#[test]
fn a_load_out_of_sight_asks_for_what_is_found_by_name() {
    let lib = ("lib.cjs", "if (globalThis.first) throw 0;");
    let other = ("other.cjs", "exports.value = 1;");
    let spelled = [
        "const handed = [require][0];\nrequire('./lib.cjs');\nhanded('./lib.cjs');",
        "const handed = [require][0];\nglobalThis.load = () => handed(globalThis.name);\nrequire('./lib.cjs');\nglobalThis.name = './lib.cjs';",
        "const handed = [require][0];\nglobalThis.load = () => handed(globalThis.name);\nrequire('./lib.cjs');\nexports.name = require.resolve('./lib.cjs');",
    ];
    for main in spelled {
        assert_eq!(
            files_that_run_again(&[("main.cjs", main), lib]),
            ["lib.cjs"],
            "{main}"
        );
    }
    let unspelled = "const handed = [require][0];\nglobalThis.load = () => handed(globalThis.name);\nrequire('./lib.cjs');";
    assert!(files_that_run_again(&[("main.cjs", unspelled), lib]).is_empty());
    let held_by_a_pattern = "const handed = [require][0];\nglobalThis.load = () => handed(globalThis.name);\nrequire(globalThis.first ? './lib.cjs' : './other.cjs');";
    let files = [("main.cjs", held_by_a_pattern), lib, other];
    assert_eq!(files_that_run_again(&files), ["lib.cjs", "other.cjs"]);
}

#[test]
fn a_file_that_has_ended_where_the_text_stands_that_spells_it_runs_once() {
    let lib = ("lib.cjs", "if (globalThis.first) throw 0;");
    let in_the_body = "require('./lib.cjs');\nconst handed = [require][0];\nhanded('./lib.cjs');";
    assert!(files_that_run_again(&[("main.cjs", in_the_body), lib]).is_empty());
    let in_a_function = "require('./lib.cjs');\nconst handed = [require][0];\nexports.again = () => handed('./lib.cjs');";
    assert!(files_that_run_again(&[("main.cjs", in_a_function), lib]).is_empty());
}

#[test]
fn a_function_of_a_file_below_may_ask_for_the_file_that_is_still_running() {
    let files = [
        ("main.cjs", "require('./store.cjs');"),
        ("store.cjs", "require('./cleanup.cjs');\nexports.late = 1;"),
        (
            "cleanup.cjs",
            "globalThis.hooks.push(() => require('./store.cjs'));",
        ),
    ];
    assert_eq!(files_that_run_again(&files), ["store.cjs", "cleanup.cjs"]);
}

#[test]
fn a_file_that_runs_again_leads_to_what_had_not_ended_and_not_to_what_had() {
    let files = [
        ("main.cjs", "require('./outer.cjs');"),
        (
            "outer.cjs",
            "const ended = require('./ended.cjs');\nglobalThis.retry = () => require('./outer.cjs');\nconst inner = require('./inner.cjs');",
        ),
        ("ended.cjs", "exports.name = 1;"),
        ("inner.cjs", "exports.name = 2;"),
    ];
    assert_eq!(files_that_run_again(&files), ["outer.cjs", "inner.cjs"]);
}

#[test]
fn a_file_that_has_ended_when_the_function_comes_to_be_runs_once() {
    let files = [
        (
            "main.cjs",
            "const ended = require('./ended.cjs');\nexports.again = () => require('./ended.cjs');",
        ),
        ("ended.cjs", "exports.name = 1;"),
    ];
    assert!(files_that_run_again(&files).is_empty());
}

#[test]
fn a_program_that_loads_nothing_in_a_function_runs_each_file_once() {
    let files = [
        (
            "main.cjs",
            "require('./first.cjs');\nrequire('./second.cjs');",
        ),
        ("first.cjs", "exports.name = 1;"),
        ("second.cjs", "exports.first = require('./first.cjs');"),
    ];
    assert!(files_that_run_again(&files).is_empty());
}

#[test]
fn a_finalizer_may_drop_what_the_handler_throws() {
    let lib = ("lib.cjs", "exports.v = 1;");
    let under_finalizer = "for (const turn of [1, 2]) {\n  try { throw 0; } catch { require('./lib.cjs'); } finally { continue; }\n}";
    assert_eq!(
        files_that_run_again(&[("main.cjs", under_finalizer), lib]),
        ["lib.cjs"]
    );
    let without = "try { throw 0; } catch { require('./lib.cjs'); }";
    assert!(files_that_run_again(&[("main.cjs", without), lib]).is_empty());
    let in_finalizer = "try { } finally { require('./lib.cjs'); }";
    assert!(files_that_run_again(&[("main.cjs", in_finalizer), lib]).is_empty());
}

#[test]
fn the_job_of_an_import_call_may_ask_for_the_running_file_behind_its_throw() {
    let main = ("main.cjs", "require('./flaky.cjs');");
    let calls_import = "exports.load = import('./flaky.cjs');\nif (globalThis.first) throw 0;";
    assert_eq!(
        files_that_run_again(&[main, ("flaky.cjs", calls_import)]),
        ["flaky.cjs"]
    );
    let requires = "try { require('./flaky.cjs'); } catch {}\nif (globalThis.first) throw 0;";
    assert!(files_that_run_again(&[main, ("flaky.cjs", requires)]).is_empty());
}

#[test]
fn a_file_of_a_required_graph_may_run_again_for_one_behind_it() {
    let graph = ("graph.mjs", "import './first.cjs';\nimport './second.cjs';");
    let first = ("first.cjs", "exports.value = 1;");
    let second = ("second.cjs", "exports.first = require('./first.cjs');");
    let run_again = |main| files_that_run_again(&[main, graph, first, second]);
    for required in [
        "require('./graph.mjs');",
        "exports.graph = require('./graph.mjs');",
    ] {
        assert_eq!(
            run_again(("main.cjs", required)),
            ["first.cjs"],
            "{required}"
        );
    }
    assert_eq!(
        run_again(("main.mjs", "require('./graph.mjs');")),
        ["first.cjs"]
    );
    for imported in ["import './graph.mjs';", "await import('./graph.mjs');"] {
        assert!(run_again(("main.mjs", imported)).is_empty(), "{imported}");
    }
    let conditional = (
        "second.cjs",
        "if (globalThis.late) exports.first = require('./first.cjs');",
    );
    let main = ("main.cjs", "require('./graph.mjs');");
    assert_eq!(
        files_that_run_again(&[main, graph, first, conditional]),
        ["first.cjs"]
    );
    let by_a_name = ("second.cjs", "require(globalThis.name);");
    let spells = ("spells.cjs", "globalThis.name = './first.cjs';");
    let graph = (
        "graph.mjs",
        "import './spells.cjs';\nimport './first.cjs';\nimport './second.cjs';",
    );
    assert_eq!(
        files_that_run_again(&[main, graph, spells, first, by_a_name]),
        ["spells.cjs", "first.cjs"]
    );
}

#[test]
fn what_files_of_a_required_graph_share_may_run_again() {
    let files = [
        ("main.cjs", "require('./graph.mjs');"),
        ("graph.mjs", "import './first.cjs';\nimport './second.cjs';"),
        ("first.cjs", "exports.shared = require('./shared.cjs');"),
        ("second.cjs", "exports.shared = require('./shared.cjs');"),
        ("shared.cjs", "exports.part = require('./part.cjs');"),
        ("part.cjs", "exports.value = 1;"),
    ];
    assert_eq!(files_that_run_again(&files), ["shared.cjs", "part.cjs"]);
    let mut within_one = files;
    within_one[2].1 =
        "exports.shared = require('./shared.cjs');\nexports.part = require('./part.cjs');";
    within_one[3].1 = "exports.value = 1;";
    assert!(files_that_run_again(&within_one).is_empty());
    let mut ended_ahead = files;
    ended_ahead[0].1 = "require('./shared.cjs');\nrequire('./graph.mjs');";
    assert!(files_that_run_again(&ended_ahead).is_empty());
}

#[test]
fn the_loader_may_run_a_file_of_a_required_graph_behind_a_file_that_required_it() {
    let files = [
        ("main.cjs", "require('./graph.mjs');"),
        ("graph.mjs", "import './first.cjs';\nimport './below.mjs';"),
        ("below.mjs", "import './second.cjs';"),
        ("first.cjs", "exports.second = require('./second.cjs');"),
        ("second.cjs", "exports.value = 1;"),
    ];
    assert_eq!(files_that_run_again(&files), ["second.cjs"]);
    let mut required_by_nobody = files;
    required_by_nobody[3].1 = "exports.value = 1;";
    assert!(files_that_run_again(&required_by_nobody).is_empty());
}

#[test]
fn a_graph_that_a_file_of_a_required_graph_requires_leaves_what_it_shares() {
    let files = [
        ("main.mjs", "import './legacy.cjs';"),
        ("legacy.cjs", "require('./outer.mjs');"),
        ("outer.mjs", "import './first.cjs';\nimport './second.cjs';"),
        (
            "first.cjs",
            "require('./inner.mjs');\nrequire('./third.cjs');",
        ),
        ("inner.mjs", "import './third.cjs';"),
        ("second.cjs", "exports.third = require('./third.cjs');"),
        ("third.cjs", "exports.value = 1;"),
    ];
    assert_eq!(files_that_run_again(&files), ["third.cjs"]);
    let mut without_second = files;
    without_second[5].1 = "exports.value = 1;";
    assert!(files_that_run_again(&without_second).is_empty());
}

#[test]
fn what_the_loader_runs_keeps_its_error_and_runs_once() {
    let asks_for_entry =
        "globalThis.retry = () => require('./main.cjs');\nif (globalThis.first) throw 0;";
    assert!(files_that_run_again(&[("main.cjs", asks_for_entry)]).is_empty());
    let flaky = (
        "flaky.cjs",
        "globalThis.retry = () => require('./flaky.cjs');\nif (globalThis.first) throw 0;",
    );
    let imports = ("main.mjs", "import './flaky.cjs';");
    assert!(files_that_run_again(&[imports, flaky]).is_empty());
    let requires = ("main.mjs", "require('./flaky.cjs');");
    assert_eq!(files_that_run_again(&[requires, flaky]), ["flaky.cjs"]);
}
