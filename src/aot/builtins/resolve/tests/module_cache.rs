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
fn whoever_lists_the_keys_or_tests_an_entry_gets_at_none() {
    assert_reaches(
        &[
            "Object.keys(TABLE)",
            "Object.keys(TABLE ?? {})",
            "Object.getOwnPropertyNames(TABLE)",
            "Reflect.ownKeys(TABLE)",
            "key in TABLE",
            "TABLE ? 1 : 2",
            "typeof TABLE",
            "TABLE === undefined",
            "!TABLE[key]",
            "typeof TABLE[key]",
            "TABLE[key] === undefined",
            "TABLE[key] ? 1 : 2",
        ],
        false,
    );
    assert!(!reaches("for (const key in require.cache) key;"));
    assert!(!reaches("if (require.cache) Object.keys(require.cache);"));
}

#[test]
fn whoever_compares_what_an_entry_exports_gets_at_none() {
    assert_reaches(
        &[
            "TABLE[key].exports === plugin",
            "TABLE[key].exports !== plugin",
            "plugin === TABLE[key].exports",
            "TABLE.name.exports === plugin",
            "TABLE[key]['exports'] === plugin",
        ],
        false,
    );
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
fn whoever_takes_an_entry_out_or_stores_one_reads_none() {
    let reads = |source: &str| {
        with_case(SCRIPT, source, |case| {
            case.resolved.reads_entries_of_module_cache()
        })
    };
    for source in [
        "delete require.cache[key];",
        "require.cache[key] = entry;",
        "require.cache[key] = undefined;",
        "Reflect.deleteProperty(require.cache, key);",
        "for (const key of Object.keys(require.cache)) delete require.cache[key];",
        "require.cache[key].exports === plugin;",
        "plugin(require);",
        "plugin(module);",
        "var module = list[0]; plugin(exports, module);",
    ] {
        assert!(!reads(source), "{source}");
    }
    for source in [
        "require.cache[key].exports.member;",
        "typeof require.cache[key].exports;",
        "Object.values(require.cache);",
        "const entry = require.cache[key];",
        "plugin(require.cache);",
    ] {
        assert!(reads(source), "{source}");
    }
}
