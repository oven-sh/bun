#![allow(clippy::disallowed_methods)]

use super::FILES;
use crate::builtins::table::{self, RuntimeFunctionData, RuntimeFunctionRole};

const TABLE_FOLDER: &str = "prelude/";
const EXTENSION: &str = ".ts";

fn compiler_functions() -> impl Iterator<Item = (&'static str, &'static RuntimeFunctionData)> {
    let functions = table::runtime_functions().iter();
    functions.filter_map(|data| Some((data.file.strip_prefix(TABLE_FOLDER)?, data)))
}

fn file_text(stem: &str) -> &'static str {
    let file = FILES
        .iter()
        .find(|file| file.0.strip_suffix(EXTENSION) == Some(stem));
    file.unwrap_or_else(|| panic!("{stem}{EXTENSION} is not in FILES"))
        .1
}

fn exported_functions(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .filter_map(|line| line.strip_prefix("export function "))
        .filter_map(|rest| rest.split_once(['(', '<']))
        .map(|(name, _)| name)
}

fn exports_function(text: &str, name: &str) -> bool {
    exported_functions(text).any(|exported| exported == name)
}

fn find_duplicate<T: Copy + Ord>(items: impl IntoIterator<Item = T>) -> Option<T> {
    let mut sorted = Vec::from_iter(items);
    sorted.sort_unstable();
    let mut runs = sorted.chunk_by(|a, b| a == b);
    runs.find(|run| run.len() > 1).map(|run| run[0])
}

fn has_line(text: &str, expected: &str) -> bool {
    text.lines().any(|line| line.trim() == expected)
}

#[test]
fn files_are_listed_once() {
    let names: Vec<&str> = FILES.iter().map(|(name, _)| *name).collect();
    let expected = [
        "array-search.ts",
        "array-sort.ts",
        "array-traversal.ts",
        "decorators.ts",
        "json.ts",
        "written-lists.ts",
    ];
    assert_eq!(names, expected);
    for (name, text) in FILES {
        assert!(!text.is_empty(), "{name} is empty");
    }
}

#[test]
fn exports_function_is_exact() {
    let text = "export function sort<T>(a) {}\nexport function indexOf(a) {}\nfunction local() {}";
    assert!(exports_function(text, "sort"));
    assert!(exports_function(text, "indexOf"));
    for name in ["sor", "index", "Of", "local"] {
        assert!(!exports_function(text, name), "{name}");
    }
}

#[test]
fn every_compiler_function_is_exported() {
    assert!(compiler_functions().next().is_some());
    for (stem, data) in compiler_functions() {
        let name = data.export_name;
        assert_eq!(
            data.role,
            RuntimeFunctionRole::CompilerFunction,
            "{stem} {name}"
        );
        assert!(
            exports_function(file_text(stem), name),
            "{stem}{EXTENSION} has no line `export function {name}`"
        );
    }
    let keys = compiler_functions().map(|(stem, data)| (stem, data.export_name));
    assert_eq!(find_duplicate(keys), None);
}

#[test]
fn every_export_is_a_compiler_function() {
    for (file, text) in FILES {
        let stem = file.strip_suffix(EXTENSION);
        assert!(
            exported_functions(text).next().is_some(),
            "{file} exports nothing"
        );
        for name in exported_functions(text) {
            let mut functions = compiler_functions();
            let is_listed = functions
                .any(|(listed_stem, data)| Some(listed_stem) == stem && data.export_name == name);
            assert!(
                is_listed,
                "{file} exports {name}, which the table does not name"
            );
        }
    }
}

#[test]
fn chain_shape_constants() {
    let text = file_text("array-traversal");
    let lines = [
        "const linkMap = 1;",
        "const linkFilter = 2;",
        "const endArray = 0;",
        "const endLength = 1;",
        "const endForEach = 2;",
        "const endReduce = 3;",
        "const endSome = 4;",
        "const endEvery = 5;",
        "const endFind = 6;",
        "const endFindIndex = 7;",
        "const endJoin = 8;",
        "const endFlatMap = 9;",
        "const firstLinkShift = 4;",
        "const secondLinkShift = 6;",
        "const thirdLinkShift = 8;",
        "const hasInitialValueShift = 10;",
    ];
    for line in lines {
        assert!(
            has_line(text, line),
            "array-traversal.ts has no line `{line}`"
        );
    }
    assert!(!has_line(text, "const linkMap = 2;"));
}
