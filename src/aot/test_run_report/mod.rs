//! What a build says of itself in the stage log, one line a fact, where tests look whether a run stayed closed.
//! Every function returns at once unless `statistics::logs_stages()`, and is handed what its caller has worked out anyway.

#[cfg(test)]
mod tests;

use bstr::BStr;

use crate::builtins::{BuiltinId, table};
use crate::engine::EngineResult;
use crate::ir::generated::UnseenCodeCause;
use crate::statistics::logs_stages;

#[derive(Default, Clone)]
pub(crate) struct CountsOfScan {
    pub files_at_start: usize,
    pub files_beside: usize,
    pub milliseconds: u128,
    pub builtins: usize,
    pub names_added: usize,
    pub exports: usize,
    pub modules: usize,
    pub handed_on: usize,
    pub mocks_any_module: bool,
    pub hands_on_any_module: bool,
    pub spies_on_objects_from_somewhere: bool,
    pub texts_left_out: usize,
    pub files_read: usize,
    pub runners: usize,
    pub runners_beside_all: usize,
}

#[derive(Copy, Clone)]
pub(crate) enum FileLeavesOpen {
    MocksUnspelledModule,
    HandsOnUnspelledModule,
    LetsSpyOnGo,
    /// `export const watch = (object, name) => spyOn(object, name)`: with how many texts the other files pass to it.
    SpiesUnderNamesFromOutside {
        texts_passed: usize,
    },
    HoldsTextThatSpies {
        loads_by_unknown_path: bool,
    },
}

fn say(line: &str) {
    bun_core::print_errorln!("{}", line);
    // Each thread has a buffer of its own, and a thread of the pool flushes it for nobody.
    bun_core::Output::flush();
}

fn line_of_texts(counts: &CountsOfScan) -> String {
    format!(
        "AOT test run | files that hold code as text which nothing near them can run {} | of {} files read {} can run code that no build has seen, {} of them beside every test file",
        counts.texts_left_out, counts.files_read, counts.runners, counts.runners_beside_all,
    )
}

fn line_of_scan(counts: &CountsOfScan) -> String {
    format!(
        "AOT test run | scan of {} files and {} beside them | {} ms | sites: built-ins {} | names added {} | exports {} | modules {} | handed on {} | mocks any module {} | hands on any module {} | spies on objects from somewhere {}",
        counts.files_at_start,
        counts.files_beside,
        counts.milliseconds,
        counts.builtins,
        counts.names_added,
        counts.exports,
        counts.modules,
        counts.handed_on,
        counts.mocks_any_module,
        counts.hands_on_any_module,
        counts.spies_on_objects_from_somewhere,
    )
}

/// The line on the texts comes first: harness/fixed-runs.ts holds the two in that order.
pub(crate) fn say_scan(counts: &CountsOfScan) {
    if logs_stages() {
        say(&line_of_texts(counts));
        say(&line_of_scan(counts));
    }
}

fn line_of_what_tests_replace(
    variables: usize,
    files: usize,
    mocked: usize,
    any_name: bool,
    names: usize,
    any_module: bool,
) -> String {
    format!(
        "AOT test run | variables that tests may replace {variables} in {files} files | modules that may be mocked {mocked} | a spy under any name {any_name} | names that spies on objects from somewhere spell {names} | such a spy may reach any module {any_module}"
    )
}

pub(crate) fn say_what_tests_replace(
    variables: usize,
    files: usize,
    mocked: usize,
    any_name: bool,
    names: usize,
    any_module: bool,
) {
    if logs_stages() {
        say(&line_of_what_tests_replace(
            variables, files, mocked, any_name, names, any_module,
        ));
    }
}

fn line_of_files_that_may_run_again(count: usize) -> String {
    format!("AOT modules | CommonJS files that may run again {count}")
}

pub(crate) fn say_files_that_may_run_again(count: usize) {
    if logs_stages() {
        say(&line_of_files_that_may_run_again(count));
    }
}

fn line_of_whose_files(
    of_tests: usize,
    behind_helpers: usize,
    of_product: usize,
    of_neither: usize,
) -> String {
    format!(
        "AOT test run | files of the project and its packages: the tests' {of_tests}, {behind_helpers} of them imported by a file that takes nothing from the test runner | the product's {of_product} | neither's {of_neither}"
    )
}

pub(crate) fn say_whose_files(
    of_tests: usize,
    behind_helpers: usize,
    of_product: usize,
    of_neither: usize,
) {
    if logs_stages() {
        say(&line_of_whose_files(
            of_tests,
            behind_helpers,
            of_product,
            of_neither,
        ));
    }
}

fn line_of_load_that_goes_on(files_of_workers: usize) -> String {
    format!("AOT load goes on | with {files_of_workers} more files that Workers start from")
}

/// Nothing where the load has taken in no such file.
pub(crate) fn say_load_goes_on(files_of_workers: usize) {
    if files_of_workers != 0 && logs_stages() {
        say(&line_of_load_that_goes_on(files_of_workers));
    }
}

fn line_of_entries_that_may_answer(modules: usize) -> String {
    format!(
        "AOT test run | an entry in require.cache may answer require() of {modules} modules of the library"
    )
}

/// Nothing where no module may be answered so.
pub(crate) fn say_entries_may_answer(modules: usize) {
    if modules != 0 && logs_stages() {
        say(&line_of_entries_that_may_answer(modules));
    }
}

fn line_of_why_every_file(path: &[u8], why: &str) -> String {
    format!(
        "AOT test run | every file may load again: {} {why}",
        BStr::new(path)
    )
}

pub(crate) fn say_why_every_file(path: &[u8], why: &str) {
    if logs_stages() {
        say(&line_of_why_every_file(path, why));
    }
}

fn line_of_what_file_replaces(path: &[u8], members: &[BuiltinId]) -> String {
    let members: Vec<String> = members.iter().map(|&it| table::text_of(it)).collect();
    format!(
        "AOT test run | {} replaces: {}",
        BStr::new(path),
        members.join(" ")
    )
}

/// Nothing of a file that replaces no member.
pub(crate) fn say_what_file_replaces(path: &[u8], members: &[BuiltinId]) {
    if !members.is_empty() && logs_stages() {
        say(&line_of_what_file_replaces(path, members));
    }
}

fn line_of_file_changed_on_disk(path: &[u8]) -> String {
    format!(
        "AOT test run | the run writes, moves or removes a file of its own, which is compared with the disk before it loads: {}",
        BStr::new(path)
    )
}

pub(crate) fn say_file_changed_on_disk(path: &[u8]) {
    if logs_stages() {
        say(&line_of_file_changed_on_disk(path));
    }
}

fn line_of_file_that_leaves_open(path: &[u8], what: FileLeavesOpen) -> String {
    let path = BStr::new(path);
    match what {
        FileLeavesOpen::MocksUnspelledModule => {
            format!("AOT test run | {path} mocks a module that it does not spell")
        }
        FileLeavesOpen::HandsOnUnspelledModule => {
            format!("AOT test run | {path} hands on a module that it does not spell")
        }
        FileLeavesOpen::LetsSpyOnGo => {
            format!("AOT test run | {path} lets spyOn go where nobody sees what it is called with")
        }
        FileLeavesOpen::SpiesUnderNamesFromOutside { texts_passed } => format!(
            "AOT test run | {path} spies on an object from somewhere under a name that it does not spell: {texts_passed} texts are passed to it"
        ),
        FileLeavesOpen::HoldsTextThatSpies {
            loads_by_unknown_path,
        } => format!(
            "AOT test run | {path} holds code in a string that spies under a name that nobody reads | it loads by a path that nobody reads itself {loads_by_unknown_path}"
        ),
    }
}

pub(crate) fn say_file_leaves_open(path: &[u8], what: FileLeavesOpen) {
    if logs_stages() {
        say(&line_of_file_that_leaves_open(path, what));
    }
}

fn line_of_package_that_takes_from_test_runner(
    path: &[u8],
    mocks_unspelled_module: bool,
    spies_under_unspelled_name: bool,
) -> String {
    format!(
        "AOT test run | a package takes from the test runner: {} | mocks a module that it does not spell {mocks_unspelled_module} | spies under a name that it does not spell {spies_under_unspelled_name}",
        BStr::new(path)
    )
}

/// `exports.mockModule = (path, factory) => mock.module(path, factory)` in a file below node_modules. Nothing of a package that spells all it mocks and spies on.
pub(crate) fn say_package_takes_from_test_runner(
    path: &[u8],
    mocks_unspelled_module: bool,
    spies_under_unspelled_name: bool,
) {
    if (mocks_unspelled_module || spies_under_unspelled_name) && logs_stages() {
        say(&line_of_package_that_takes_from_test_runner(
            path,
            mocks_unspelled_module,
            spies_under_unspelled_name,
        ));
    }
}

/// In the order of the line.
const CAUSES_OF_UNSEEN_CODE: [UnseenCodeCause; 6] = [
    UnseenCodeCause::LoadsCodeByName,
    UnseenCodeCause::LoadsModuleByName,
    UnseenCodeCause::EvaluatesText,
    UnseenCodeCause::ImportsUncompiledModule,
    UnseenCodeCause::RunsUnseenCode,
    UnseenCodeCause::OptionAdmitsCode,
];

fn line_of_code_that_build_does_not_see(records: [usize; 6]) -> String {
    let [
        by_name,
        compiled_by_name,
        texts,
        uncompiled,
        unseen,
        by_option,
    ] = records;
    format!(
        "AOT flow | code that the build does not see | loads code by name {by_name} | loads compiled files by name {compiled_by_name} | evaluates text {texts} | imports uncompiled code {uncompiled} | runs unseen code {unseen} | an option admits code {by_option}"
    )
}

/// How many records of each cause the engine has handed back, of a test run and of an executable alike.
pub(crate) fn say_code_that_build_does_not_see(engine: &EngineResult) {
    if logs_stages() {
        let records = engine.unseen_code();
        let counts = CAUSES_OF_UNSEEN_CODE
            .map(|cause| records.iter().filter(|it| it.cause == cause).count());
        say(&line_of_code_that_build_does_not_see(counts));
    }
}
