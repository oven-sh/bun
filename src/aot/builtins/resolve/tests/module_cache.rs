use super::*;

fn reaches(source: &str) -> bool {
    with_case(SCRIPT, source, |case| case.resolved.reaches_module_cache())
}

const TABLES: [(&str, &str); 3] = [
    ("", "require.cache"),
    ("const cache = require.cache;", "cache"),
    ("const Module = require('node:module');", "Module._cache"),
];

fn assert_reaches(uses: &[&str], expected: bool) {
    for (declared, table) in TABLES {
        for written in uses {
            let written = written.replace("TABLE", table);
            for source in [
                format!("{declared} {written};"),
                format!("{declared} function f(key, plugin) {{ return {written}; }}"),
                format!(
                    "{declared} class C {{ field = {written}; method(key, plugin) {{ return {written}; }} }}"
                ),
            ] {
                assert_eq!(reaches(&source), expected, "{source}");
            }
        }
    }
}

#[test]
fn every_other_use_gets_at_the_entries() {
    assert_reaches(
        &[
            "TABLE[key].exports",
            "TABLE[key].exports.member",
            "TABLE[key].exports()",
            "TABLE[key].exports == plugin",
            "typeof TABLE[key].exports",
            "!TABLE[key].exports",
            "TABLE[key].exports = plugin",
            "delete TABLE[key].exports",
            "TABLE[key].children",
            "TABLE[key].parent === plugin",
            "TABLE[key].require(key)",
            "[TABLE[key]]",
            "plugin(TABLE[key])",
            "delete TABLE[key]",
            "TABLE[key] = plugin",
            "TABLE[key] = undefined",
            "Reflect.deleteProperty(TABLE, key)",
            "Object.defineProperty(TABLE, key, plugin)",
            "Object.defineProperties(TABLE, plugin)",
            "Object.setPrototypeOf(TABLE, plugin)",
            "Object.assign(TABLE, plugin)",
            "Object.values(TABLE)",
            "Object.entries(TABLE)",
            "plugin(TABLE)",
            "[TABLE]",
            "({ ...TABLE })",
        ],
        true,
    );
    assert!(reaches(
        "const entry = require.cache[key]; entry.exports === plugin;"
    ));
    assert!(reaches("const { cache } = require; Object.keys(cache);"));
    assert!(reaches(
        "let cache = require.cache; cache = other; cache[key].exports.member;"
    ));
    assert!(reaches("module.exports = require.cache;"));
    assert!(!reaches("plugin(require);"));
    assert!(!reaches("plugin(module);"));
    assert!(!reaches("var module = list[0]; plugin(exports, module);"));
}

#[test]
fn an_entry_that_is_handed_on_in_a_test_run_has_its_key_noted() {
    const SCRIPT_OF_TEST_RUN: Setup = Setup {
        runs_tests: true,
        ..SCRIPT
    };
    let count_keys = |setup: Setup, source: &str| {
        with_case(setup, source, |case| {
            let resolved = &case.resolved;
            let taken_out = resolved.keys_taken_out_of_module_cache().len();
            (resolved.keys_of_entries_handed_on().len(), taken_out)
        })
    };
    for (declared, table) in TABLES {
        for (written, expected) in [
            ("plugin(TABLE[key])", 1),
            ("[TABLE[key]]", 1),
            ("Object.defineProperty(TABLE[key], 'exports', plugin)", 1),
            ("Object.defineProperties(TABLE[key], plugin)", 1),
            ("Reflect.deleteProperty(TABLE[key], 'exports')", 1),
            ("delete TABLE[key].exports", 1),
            ("delete TABLE[key][plugin]", 1),
            ("TABLE[key].__defineGetter__('exports', plugin)", 1),
            ("const entry = TABLE[key]; plugin(entry)", 1),
            ("const entry = TABLE[key]; delete entry.exports", 1),
            ("const entry = TABLE[key]; const other = entry", 1),
            ("const entry = TABLE[key]; plugin = () => entry", 1),
            ("let entry = TABLE[key]; entry = plugin", 1),
            ("const entry = TABLE[key]", 0),
            ("const { exports } = TABLE[key]", 0),
            ("const { ...rest } = TABLE[key]", 0),
            (
                "const entry = TABLE[key]; const { exports: { a } } = entry",
                0,
            ),
            (
                "const entry = TABLE[key]; entry ? entry.exports.a : plugin",
                0,
            ),
            ("const entry = TABLE[key]; entry.exports = plugin", 0),
            ("const entry = TABLE[key]; plugin = () => entry.loaded", 0),
            ("TABLE[key].exports", 0),
            ("TABLE[key]?.exports", 0),
            ("TABLE[key].exports.member", 0),
            ("TABLE[key].exports = plugin", 0),
            ("TABLE[key].loaded", 0),
            ("typeof TABLE[key]", 0),
            ("!TABLE[key]", 0),
            ("TABLE[key] === undefined", 0),
            ("if (TABLE[key]) plugin()", 0),
        ] {
            let source = format!("{declared} {};", written.replace("TABLE", table));
            assert_eq!(
                count_keys(SCRIPT_OF_TEST_RUN, &source),
                (expected, 0),
                "{source}"
            );
            assert_eq!(count_keys(SCRIPT, &source), (0, 0), "{source}");
        }
    }
}

#[test]
fn table_stored_in_a_variable_goes_out_of_sight() {
    for table in ["Module._cache", "Module._extensions"] {
        let source = format!(
            "const Module = require('node:module'); var a; (a = {table}).fs ?? (a.fs = entry);"
        );
        with_case(SCRIPT, &source, |case| {
            assert!(case.resolved.loses_sight_of_module_cache(), "{source}");
        });
    }
}
