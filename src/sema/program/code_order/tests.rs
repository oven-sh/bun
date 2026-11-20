#![cfg(not(miri))]

mod answers;
mod file_ids;
mod governing_options;
mod types_program;

use super::*;
use crate::program::code_test_host::{StatementsHost, TestBuild, load_files};

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_build<R>(build: &TestBuild<'_>, test: impl FnOnce(&Files<'_>) -> R) -> R {
    let session = Session::new();
    test(&load_files(&session, build))
}

fn with_program<R>(
    host: &StatementsHost,
    entry_points: &[&str],
    test: impl FnOnce(&Files<'_>) -> R,
) -> R {
    with_build(&TestBuild::new(host, entry_points), test)
}

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let file = files.by_path.get(path.as_bytes());
    file.unwrap_or_else(|| panic!("{path} is not in the program"))
}

fn compiled_at<'s>(files: &Files<'s>, path: &str) -> &'s CompiledModule<'s> {
    let compiled = files.compiled(file_at(files, path));
    compiled.unwrap_or_else(|| panic!("{path} is not compiled"))
}

fn name_of(files: &Files<'_>, file: FileId) -> String {
    files.module(file).file_name().as_bstr().to_string()
}

fn names_of(files: &Files<'_>, ids: &[FileId]) -> Vec<String> {
    ids.iter().map(|&file| name_of(files, file)).collect()
}

fn all_files(files: &Files<'_>) -> Vec<FileId> {
    (0..files.modules.len() as u32).map(FileId).collect()
}

fn imported_files(files: &Files<'_>, file: FileId) -> Vec<FileId> {
    let mut imported: Vec<FileId> = files.module(file).imports.values().copied().collect();
    imported.sort_unstable();
    imported.dedup();
    imported
}
