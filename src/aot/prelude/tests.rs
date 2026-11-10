#![allow(clippy::disallowed_methods)]

use super::{NAMES, files};
use crate::builtins::table::{self, RuntimeFunctionData, RuntimeFunctionRole};

const TABLE_FOLDER: &str = "prelude/";
const EXTENSION: &str = ".ts";

fn compiler_functions() -> impl Iterator<Item = (&'static str, &'static RuntimeFunctionData)> {
    let functions = table::runtime_functions().iter();
    functions.filter_map(|data| Some((data.file.strip_prefix(TABLE_FOLDER)?, data)))
}

fn texts() -> impl Iterator<Item = (&'static str, &'static str)> {
    files().map(|(name, text)| (name, std::str::from_utf8(text).unwrap()))
}

fn file_text(stem: &str) -> &'static str {
    let file = texts().find(|file| file.0.strip_suffix(EXTENSION) == Some(stem));
    file.unwrap_or_else(|| panic!("{stem}{EXTENSION} is not one of the files"))
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

#[test]
fn each_text_is_that_of_the_file_with_the_name() {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("prelude");
    assert_eq!(files().count(), NAMES.len());
    for (name, text) in files() {
        assert!(!text.is_empty(), "{name} is empty");
        assert!(std::fs::read(folder.join(name)).unwrap() == text, "{name}");
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
    for (file, text) in texts() {
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
