#![feature(linkage)]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

pub mod support;

use bun_sema_standalone::for_each_parallel;
use std::any::Any;
use std::fmt::Display;
use std::io::Write;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, Once, OnceLock, PoisonError};
use support::TestFailure;
use support::check_lines::match_check_lines;
use support::commands::{
    Command, CommandInput, CommandOutcome, CommandResult, FrontEndWords, find_command,
    parse_option_words,
};
use support::test_file::{
    DiagnosticName, RunDirective, TestFile, holds, is_test_file_name, parse_test_file,
};

const AREAS: [&str; 2] = ["commands", "lower"];
const TEST_ROOT: [&str; 3] = ["test", "aot", "ir"];
const FOLDERS_WITHOUT_TESTS: [&str; 2] = ["imports", "node_modules"];
const MAX_UNEXPECTED_DIAGNOSTICS_SHOWN: usize = 5;
const FILTER_VARIABLE: &str = "AOT_IR_FILTER";
const JOB_COUNT_VARIABLE: &str = "AOT_IR_JOBS";
const OUTPUT_FOLDER_VARIABLE: &str = "AOT_IR_OUTPUT";

// A panic hook has no other way to learn which files are running.
static RUNNING_FILES: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct FoundTest {
    path: PathBuf,
    display_path: String,
}

#[derive(Default)]
struct TestOutcome {
    failures: Vec<TestFailure>,
    skipped: Vec<TestFailure>,
}

struct FinishedRun<'a> {
    file: &'a TestFile,
    run: &'a RunDirective,
    command: &'static str,
    result: &'a CommandResult,
}

#[test]
fn commands() {
    run_area("commands");
}

#[test]
fn lower() {
    run_area("lower");
}

#[test]
fn every_area_tested() {
    let root = test_root();
    let mut folders = sorted_entry_names(&root);
    folders.retain(|name| root.join(name).is_dir());
    assert_eq!(folders, AREAS);
}

fn repository_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("src/aot is two folders below the repository root")
}

fn test_root() -> PathBuf {
    repository_root().join(PathBuf::from_iter(TEST_ROOT))
}

fn display_folder_of(area: &str) -> String {
    format!("{}/{area}", TEST_ROOT.join("/"))
}

fn sorted_entry_names(folder: &Path) -> Vec<String> {
    let entries = std::fs::read_dir(folder)
        .unwrap_or_else(|error| panic!("cannot list {}: {error}", folder.display()));
    let mut names: Vec<String> = entries
        .map(|entry| match entry {
            Ok(entry) => entry.file_name().to_string_lossy().into_owned(),
            Err(error) => panic!("cannot list {}: {error}", folder.display()),
        })
        .collect();
    names.sort_unstable();
    names
}

fn find_tests(folder: &Path, display_folder: &str, found: &mut Vec<FoundTest>) {
    for name in sorted_entry_names(folder) {
        let path = folder.join(&name);
        let display_path = format!("{display_folder}/{name}");
        if path.is_dir() {
            if !FOLDERS_WITHOUT_TESTS.contains(&name.as_str()) {
                find_tests(&path, &display_path, found);
            }
        } else if is_test_file_name(&name) {
            found.push(FoundTest { path, display_path });
        }
    }
}

fn find_area_tests(area: &str) -> Vec<FoundTest> {
    let mut tests = Vec::new();
    find_tests(&test_root().join(area), &display_folder_of(area), &mut tests);
    tests
}

fn run_area(area: &str) {
    let display_folder = display_folder_of(area);
    let mut tests = find_area_tests(area);
    assert!(!tests.is_empty(), "{display_folder} has no test file");
    if let Ok(filter) = std::env::var(FILTER_VARIABLE) {
        tests.retain(|test| test.display_path.contains(&filter));
    }
    name_running_files_on_panic();

    let outcomes: Vec<OnceLock<TestOutcome>> = tests.iter().map(|_| OnceLock::new()).collect();
    let threads = match std::env::var(JOB_COUNT_VARIABLE) {
        Ok(count) => parse_job_count(&count).get(),
        Err(_) => std::thread::available_parallelism().map_or(1, usize::from),
    };
    for_each_parallel(threads.min(tests.len()), tests.len(), |index| {
        let outcome = run_guarded_test_file(&tests[index]);
        let is_first_run = outcomes[index].set(outcome).is_ok();
        assert!(is_first_run, "{} ran twice", tests[index].display_path);
    });

    let mut failed_file_count = 0;
    let mut skipped: Vec<&TestFailure> = Vec::new();
    for (test, outcome) in tests.iter().zip(&outcomes) {
        let path = &test.display_path;
        let outcome = outcome.get().expect("every test has run");
        for TestFailure { line, message } in &outcome.failures {
            println!("FAIL {path}:{line}: {message}");
        }
        for TestFailure { line, message } in &outcome.skipped {
            println!("SKIP {path}:{line}: {message}");
        }
        failed_file_count += usize::from(!outcome.failures.is_empty());
        skipped.extend(&outcome.skipped);
    }
    if let Some(summary) = describe_skipped_runs(&display_folder, &skipped) {
        // The test harness hides what a passing test prints, and this line has to be seen.
        let _ = std::io::stderr().write_all(summary.as_bytes());
    }
    assert!(
        failed_file_count == 0,
        "{failed_file_count} of {} files failed",
        tests.len()
    );
}

fn describe_skipped_runs(display_folder: &str, skipped: &[&TestFailure]) -> Option<String> {
    let first = skipped.first()?;
    Some(format!(
        "SKIP {display_folder}: the engine verified none of {} runs: {}\n",
        skipped.len(),
        first.message
    ))
}

fn parse_job_count(count: &str) -> NonZeroUsize {
    match count.parse() {
        Ok(count) => count,
        Err(_) => panic!("{JOB_COUNT_VARIABLE} is {count}, which is not a count above 0"),
    }
}

fn lock_running_files() -> MutexGuard<'static, Vec<String>> {
    RUNNING_FILES.lock().unwrap_or_else(PoisonError::into_inner)
}

fn describe_running_files(running_files: &[String]) -> String {
    let mut text = String::new();
    for path in running_files {
        text.push_str("PANIC ");
        text.push_str(path);
        text.push('\n');
    }
    text
}

fn name_running_files_on_panic() {
    static HOOK: Once = Once::new();
    HOOK.call_once(|| {
        let report_panic = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // The hook of a test process that aborts on a panic does not return.
            let running_files = describe_running_files(&lock_running_files());
            let _ = std::io::stderr().write_all(running_files.as_bytes());
            report_panic(info);
        }));
    });
}

fn run_guarded_test_file(test: &FoundTest) -> TestOutcome {
    lock_running_files().push(test.display_path.clone());
    let outcome = std::panic::catch_unwind(|| run_test_file(test)).unwrap_or_else(|payload| {
        fail_whole_file(format!("panicked: {}", panic_message(payload.as_ref())))
    });
    lock_running_files().retain(|path| *path != test.display_path);
    outcome
}

fn run_test_file(test: &FoundTest) -> TestOutcome {
    let Ok(bytes) = std::fs::read(&test.path) else {
        return fail_whole_file("cannot be read".to_owned());
    };
    let Ok(text) = String::from_utf8(bytes) else {
        return fail_whole_file("is not UTF-8".to_owned());
    };
    run_test_text(&test.path, text)
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    if let Some(message) = payload.downcast_ref::<&str>() {
        message
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message
    } else {
        "the payload is not text"
    }
}

fn fail_whole_file(message: String) -> TestOutcome {
    TestOutcome {
        failures: vec![TestFailure { line: 1, message }],
        skipped: Vec::new(),
    }
}

fn create_failure(command: &str, line: u32, why: impl Display) -> TestFailure {
    TestFailure {
        line,
        message: format!("{command}: {why}"),
    }
}

fn run_test_text(path: &Path, text: String) -> TestOutcome {
    let file = parse_test_file(text);
    let mut outcome = TestOutcome::default();
    if !file.errors.is_empty() {
        outcome.failures.extend(file.errors.into_iter().map(|error| TestFailure {
            line: error.line,
            message: error.message,
        }));
        return outcome;
    }
    let words = match parse_option_words(&file.option_words) {
        Ok(words) => words,
        Err(failure) => {
            outcome.failures.push(failure);
            return outcome;
        }
    };
    for run in &file.runs {
        run_directive(path, &file, words, run, &mut outcome);
    }
    outcome.failures.sort_by_key(|failure| failure.line);
    outcome
}

fn run_directive(
    path: &Path,
    file: &TestFile,
    words: FrontEndWords,
    run: &RunDirective,
    outcome: &mut TestOutcome,
) {
    let command = match resolve_command(run) {
        Ok(command) => command,
        Err(failure) => {
            outcome.failures.push(failure);
            return;
        }
    };
    let command_outcome = (command.run)(&CommandInput { path, words });
    if let Some(folder) = std::env::var_os(OUTPUT_FOLDER_VARIABLE) {
        write_command_outcome(Path::new(&folder), path, run, &command_outcome);
    }
    record_command_outcome(file, run, command.name, command_outcome, outcome);
}

fn describe_command_outcome(outcome: &CommandOutcome) -> String {
    let result = match outcome {
        CommandOutcome::Finished(result) => result,
        CommandOutcome::Failed(why) => return format!("FAILED: {why}\n"),
    };
    let mut text = result.output.clone();
    for (name, message) in &result.diagnostics {
        text.push_str(&format!("DIAGNOSTIC: {} ({message})\n", diagnostic_text(*name)));
    }
    for (statistic, value) in &result.statistics {
        text.push_str(&format!("STATISTIC: {} = {value}\n", statistic.name()));
    }
    text
}

fn write_command_outcome(
    folder: &Path,
    test: &Path,
    run: &RunDirective,
    outcome: &CommandOutcome,
) {
    let root = test_root();
    let mut name = test.strip_prefix(&root).unwrap_or(test).as_os_str().to_owned();
    name.push(format!(".{}.txt", run.prefix));
    let target = folder.join(name);
    let written = std::fs::create_dir_all(target.parent().unwrap_or(folder))
        .and_then(|()| std::fs::write(&target, describe_command_outcome(outcome)));
    if let Err(error) = written {
        panic!("cannot write {}: {error}", target.display());
    }
}

fn record_command_outcome(
    file: &TestFile,
    run: &RunDirective,
    command: &'static str,
    command_outcome: CommandOutcome,
    outcome: &mut TestOutcome,
) {
    match command_outcome {
        CommandOutcome::Finished(result) => {
            let finished = FinishedRun {
                file,
                run,
                command,
                result: &result,
            };
            finished.check_expectations(&mut outcome.failures);
            if let Some(why) = &result.engine_was_skipped {
                outcome.skipped.push(create_failure(command, run.line, why));
            }
        }
        CommandOutcome::Failed(why) => {
            outcome.failures.push(create_failure(command, run.line, why));
        }
    }
}

fn resolve_command(run: &RunDirective) -> Result<&'static Command, TestFailure> {
    let Some(command) = find_command(&run.command) else {
        return Err(TestFailure {
            line: run.line,
            message: format!("unknown command {}", run.command),
        });
    };
    if !run.arguments.is_empty() {
        return Err(TestFailure {
            line: run.line,
            message: format!("{} takes no argument", command.name),
        });
    }
    Ok(command)
}

fn diagnostic_text(name: DiagnosticName) -> String {
    match name {
        DiagnosticName::User(kind) => kind.name().to_owned(),
        DiagnosticName::Internal(kind) => kind.name().to_owned(),
        DiagnosticName::FrontEnd(code) => format!("TS{code}"),
        DiagnosticName::Build => "Build".to_owned(),
        DiagnosticName::Resolve => "Resolve".to_owned(),
    }
}

fn is_reported_by_engine(name: DiagnosticName) -> bool {
    match name {
        DiagnosticName::User(_) | DiagnosticName::Internal(_) => true,
        DiagnosticName::FrontEnd(_) | DiagnosticName::Build | DiagnosticName::Resolve => false,
    }
}

impl FinishedRun<'_> {
    fn check_expectations(&self, failures: &mut Vec<TestFailure>) {
        self.compare_diagnostics(failures);
        self.compare_statistics(failures);
        self.compare_output(failures);
    }

    fn report(&self, failures: &mut Vec<TestFailure>, line: u32, why: impl Display) {
        failures.push(create_failure(self.command, line, why));
    }

    fn compare_diagnostics(&self, failures: &mut Vec<TestFailure>) {
        let listed = &self.file.diagnostics;
        let reported = &self.result.diagnostics;
        let engine_was_skipped = self.result.engine_was_skipped.is_some();
        for expected in listed {
            if engine_was_skipped && is_reported_by_engine(expected.name) {
                continue;
            }
            let name = diagnostic_text(expected.name);
            let count = reported
                .iter()
                .filter(|(name, _)| *name == expected.name)
                .count();
            let why = if count == 0 {
                format!("{name} was not reported")
            } else if expected.count.is_some_and(|listed_count| listed_count as usize != count) {
                format!("{name} was reported {count} times")
            } else {
                continue;
            };
            self.report(failures, expected.line, why);
        }

        let mut unexpected = reported
            .iter()
            .filter(|(name, _)| listed.iter().all(|expected| expected.name != *name));
        for (name, message) in unexpected.by_ref().take(MAX_UNEXPECTED_DIAGNOSTICS_SHOWN) {
            let why = format!("unexpected {}: {message}", diagnostic_text(*name));
            self.report(failures, self.run.line, why);
        }
        let hidden_count = unexpected.count();
        if hidden_count > 0 {
            let why = format!("and {hidden_count} more");
            self.report(failures, self.run.line, why);
        }
    }

    fn compare_statistics(&self, failures: &mut Vec<TestFailure>) {
        for expected in &self.file.statistics {
            let mut statistics = self.result.statistics.iter();
            let counted = statistics.find(|(id, _)| *id == expected.name);
            let actual = counted.map_or(0, |&(_, value)| value);
            if !holds(expected.comparison, actual, expected.value) {
                let why = format!("{} is {actual}", expected.name.name());
                self.report(failures, expected.line, why);
            }
        }
    }

    fn compare_output(&self, failures: &mut Vec<TestFailure>) {
        let lines = self.file.check_lines_for(&self.run.prefix);
        if let Err(failure) = match_check_lines(lines, &hide_function_texts(&self.result.output)) {
            self.report(failures, failure.line, failure.message);
        }
    }
}

// The record of a module prints the text of its file, with the directives of the test in it: a pattern would match itself there.
fn hide_function_texts(output: &str) -> String {
    const FIELD: &str = " functionText=\"";
    let mut hidden = String::with_capacity(output.len());
    let mut rest = output;
    while let Some(start) = rest.find(FIELD) {
        let (shown, text) = rest.split_at(start + FIELD.len());
        hidden.push_str(shown);
        // A quote in the text is printed as \x22.
        rest = &text[text.find('"').unwrap_or(text.len())..];
    }
    hidden.push_str(rest);
    hidden
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_aot::ir::generated::{InternalErrorKind, StatisticId, UserDiagnosticKind};

    const PROGRAM_WITH_IMPORT: &str = "lower-entry-functions.ts";

    #[test]
    fn text_of_a_module_is_hidden_from_the_check_lines() {
        let output = "module m0 path=\"a\" functionText=\"// CHECK-NOT: Call\\x0af(\\x22x\\x22);\"\n  v0 = Call\nmodule m1 functionText=\"\" kind=Data\n";
        let hidden = "module m0 path=\"a\" functionText=\"\"\n  v0 = Call\nmodule m1 functionText=\"\" kind=Data\n";
        assert_eq!(hide_function_texts(output), hidden);
        assert_eq!(hide_function_texts("function f0 {\n}\n"), "function f0 {\n}\n");
    }

    fn failure_lines(failures: &[TestFailure]) -> Vec<u32> {
        failures.iter().map(|failure| failure.line).collect()
    }

    fn display_paths(area: &str) -> Vec<String> {
        let tests = find_area_tests(area).into_iter();
        tests.map(|test| test.display_path).collect()
    }

    #[track_caller]
    fn expect_failures_before_any_run(directives: &str, lines: &[u32]) {
        let outcome = run_test_text(Path::new("never-read.ts"), directives.to_owned());
        let failures = &outcome.failures;
        assert_eq!(failure_lines(failures), lines, "{failures:?}");
        assert!(outcome.skipped.is_empty());
    }

    #[track_caller]
    fn expect_failures_on_program(directives: &str, lines: &[u32]) {
        let path = test_root().join("commands").join(PROGRAM_WITH_IMPORT);
        let outcome = OnceLock::new();
        for_each_parallel(1, 1, |_| {
            let is_first_run = outcome.set(run_test_text(&path, directives.to_owned())).is_ok();
            assert!(is_first_run);
        });
        let outcome: TestOutcome = outcome.into_inner().expect("the run has finished");
        let failures = &outcome.failures;
        assert_eq!(failure_lines(failures), lines, "{failures:?}");
    }

    fn parse_directives(directives: &str) -> TestFile {
        let file = parse_test_file(directives.to_owned());
        assert!(file.errors.is_empty(), "{:?}", file.errors);
        file
    }

    fn finished_run_failures(directives: &str, result: &CommandResult) -> Vec<u32> {
        let file = parse_directives(directives);
        let finished = FinishedRun {
            file: &file,
            run: &file.runs[0],
            command: "link",
            result,
        };
        let mut failures = Vec::new();
        finished.check_expectations(&mut failures);
        failure_lines(&failures)
    }

    fn record_outcome_with_expectations(command_outcome: CommandOutcome) -> TestOutcome {
        let directives = "// RUN: emit\n\
            // DIAGNOSTIC: TS2322\n\
            // STATISTIC: ProgramBytes >= 1\n\
            // CHECK: Add\n";
        let file = parse_directives(directives);
        let mut outcome = TestOutcome::default();
        record_command_outcome(&file, &file.runs[0], "emit", command_outcome, &mut outcome);
        outcome
    }

    fn type_errors(count: usize) -> CommandResult {
        let diagnostic = (DiagnosticName::FrontEnd(2322), "not assignable".to_owned());
        CommandResult {
            diagnostics: vec![diagnostic; count],
            ..CommandResult::default()
        }
    }

    #[test]
    fn import_folders_hold_no_tests() {
        let paths = display_paths("commands");
        assert!(paths.contains(&format!("test/aot/ir/commands/{PROGRAM_WITH_IMPORT}")));
        assert!(test_root().join("commands/imports/helper.ts").is_file());
        for area in AREAS {
            for path in display_paths(area) {
                let mut folders = path.split('/');
                let name = folders.next_back().expect("a path has a name");
                assert!(is_test_file_name(name), "{path}");
                assert!(!folders.any(|folder| FOLDERS_WITHOUT_TESTS.contains(&folder)), "{path}");
            }
        }
    }

    #[test]
    fn tests_are_found_below_family_folders() {
        let prefix = "test/aot/ir/lower/";
        let paths = display_paths("lower");
        assert!(!paths.is_empty());
        for path in &paths {
            let below_area = path.strip_prefix(prefix).expect(path);
            assert!(below_area.contains('/'), "{path} is in no family");
        }
    }

    #[test]
    fn matching_check_lines_pass() {
        let directives = "// RUN: lower\n// CHECK-LABEL: name=\"add\"\n// CHECK: Return\n";
        expect_failures_on_program(directives, &[]);
    }

    #[test]
    fn unmatched_check_line() {
        expect_failures_on_program("// RUN: lower\n// CHECK: NoSuchOperation\n", &[2]);
    }

    #[test]
    fn lower_prints_entry_module_only() {
        const HELPER: &str = "function {{*}}name=\"helper\"";
        expect_failures_on_program(&format!("// RUN: lower\n// CHECK-NOT: {HELPER}\n"), &[]);
        expect_failures_on_program(&format!("// RUN: link\n// CHECK-NOT: {HELPER}\n"), &[2]);
        expect_failures_on_program(&format!("// RUN: emit\n// CHECK: {HELPER}\n"), &[]);
    }

    #[test]
    fn emitted_bytes_are_counted() {
        let directives = "// RUN: lower\n\
            // STATISTIC: ProgramBytes >= 64\n\
            // STATISTIC: ProgramBytes = 0\n";
        expect_failures_on_program(directives, &[3]);
    }

    #[test]
    fn second_run_fails() {
        let directives = "// RUN(FIRST): lower\n\
            // RUN(SECOND): link\n\
            // FIRST: name=\"add\"\n\
            // SECOND: NoSuchOperation\n";
        expect_failures_on_program(directives, &[4]);
    }

    #[test]
    fn failures_sorted_by_line() {
        let directives = "// RUN(FIRST): lower\n\
            // RUN(SECOND): no-such-command\n\
            // FIRST: NoSuchOperation\n\
            // SECOND: name=\"add\"\n";
        expect_failures_on_program(directives, &[2, 3]);
    }

    #[test]
    fn malformed_directive() {
        let directives = "// RUN: lower\n// NOTE: x\n// CHECK: NoSuchOperation\n";
        expect_failures_before_any_run(directives, &[2]);
    }

    #[test]
    fn unknown_command() {
        expect_failures_before_any_run("// RUN: no-such-command\n", &[1]);
        expect_failures_before_any_run("// RUN: print\n", &[1]);
        expect_failures_before_any_run("// RUN: verify\n", &[1]);
    }

    #[test]
    fn unexpected_argument() {
        expect_failures_before_any_run("// RUN: lower f0\n", &[1]);
    }

    #[test]
    fn form_directive() {
        expect_failures_before_any_run("// RUN: lower\n// FORM: AsRead\n", &[2]);
    }

    #[test]
    fn unknown_option_word() {
        let directives = "// RUN: lower\n// CHECK: Add\n// OPTIONS: threads=1 nonsense\n";
        expect_failures_before_any_run(directives, &[3]);
        expect_failures_before_any_run("// RUN: lower\n// OPTIONS: validate\n", &[2]);
    }

    #[test]
    fn front_end_diagnostic() {
        let listed = "// RUN: link\n// DIAGNOSTIC: TS2322 2\n";
        assert!(finished_run_failures(listed, &type_errors(2)).is_empty());
        assert_eq!(finished_run_failures(listed, &type_errors(3)), [2]);
        let other = "// RUN: link\n// DIAGNOSTIC: TS2345\n";
        assert_eq!(finished_run_failures(other, &type_errors(1)), [2, 1]);
    }

    #[test]
    fn engine_diagnostics() {
        let unproven = DiagnosticName::User(UserDiagnosticKind::UnprovenInt32);
        let out_of_range = DiagnosticName::Internal(InternalErrorKind::IdOutOfRange);
        let result = CommandResult {
            diagnostics: vec![
                (unproven, "not an int32".to_owned()),
                (out_of_range, "v9".to_owned()),
            ],
            ..CommandResult::default()
        };
        let listed = "// RUN: link\n// DIAGNOSTIC: UnprovenInt32 1\n// DIAGNOSTIC: IdOutOfRange\n";
        assert!(finished_run_failures(listed, &result).is_empty());
        let user_only = "// RUN: link\n// DIAGNOSTIC: UnprovenInt32\n";
        assert_eq!(finished_run_failures(user_only, &result), [1]);
        let other = "// RUN: link\n// DIAGNOSTIC: ConstantNotInt32\n";
        assert_eq!(finished_run_failures(other, &result), [2, 1, 1]);
    }

    #[test]
    fn engine_diagnostic_is_not_judged_without_engine() {
        let listed = "// RUN: link\n// DIAGNOSTIC: UnprovenInt32\n// DIAGNOSTIC: TS2322\n";
        let without_engine = CommandResult {
            engine_was_skipped: Some("TESTAOT is not set".to_owned()),
            ..CommandResult::default()
        };
        assert_eq!(finished_run_failures(listed, &without_engine), [3]);
        assert_eq!(finished_run_failures(listed, &CommandResult::default()), [2, 3]);
    }

    #[test]
    fn build_and_resolve_diagnostics() {
        let result = CommandResult {
            diagnostics: vec![
                (DiagnosticName::Build, "no entry".to_owned()),
                (DiagnosticName::Resolve, "not found".to_owned()),
            ],
            ..CommandResult::default()
        };
        let listed = "// RUN: link\n// DIAGNOSTIC: Build\n// DIAGNOSTIC: Resolve 1\n";
        assert!(finished_run_failures(listed, &result).is_empty());
        let build_only = "// RUN: link\n// DIAGNOSTIC: Build\n";
        assert_eq!(finished_run_failures(build_only, &result), [1]);
        let miscounted = "// RUN: link\n// DIAGNOSTIC: Build 2\n// DIAGNOSTIC: Resolve\n";
        assert_eq!(finished_run_failures(miscounted, &result), [2]);
    }

    #[test]
    fn diagnostic_text_parses_back() {
        let names = [
            DiagnosticName::User(UserDiagnosticKind::UnprovenInt32),
            DiagnosticName::Internal(InternalErrorKind::IdOutOfRange),
            DiagnosticName::FrontEnd(2322),
            DiagnosticName::Build,
            DiagnosticName::Resolve,
        ];
        for name in names {
            let directives = format!("// RUN: link\n// DIAGNOSTIC: {}\n", diagnostic_text(name));
            assert_eq!(parse_directives(&directives).diagnostics[0].name, name);
        }
    }

    #[test]
    fn unexpected_diagnostic_cap() {
        let directives = "// RUN: link\n";
        assert_eq!(finished_run_failures(directives, &type_errors(5)), [1; 5]);
        assert_eq!(finished_run_failures(directives, &type_errors(7)), [1; 6]);
    }

    #[test]
    fn statistic_comparisons() {
        let directives = "// RUN: emit\n\
            // STATISTIC: ProgramBytes = 64\n\
            // STATISTIC: ProgramBytes = 63\n\
            // STATISTIC: ProgramBytes >= 64\n\
            // STATISTIC: ProgramBytes >= 65\n\
            // STATISTIC: ProgramBytes <= 64\n\
            // STATISTIC: ProgramBytes <= 63\n";
        let result = CommandResult {
            statistics: vec![(StatisticId::ProgramBytes, 64)],
            ..CommandResult::default()
        };
        assert_eq!(finished_run_failures(directives, &result), [3, 5, 7]);
    }

    #[test]
    fn absent_statistic_is_zero() {
        let directives = "// RUN: link\n\
            // STATISTIC: MaxNestingDepthHits = 0\n\
            // STATISTIC: MaxNestingDepthHits >= 1\n";
        let result = CommandResult {
            statistics: vec![(StatisticId::ProgramBytes, 64)],
            ..CommandResult::default()
        };
        assert_eq!(finished_run_failures(directives, &result), [3]);
    }

    #[test]
    fn finished_outcome_checks_expectations() {
        let finished = CommandOutcome::Finished(CommandResult::default());
        let outcome = record_outcome_with_expectations(finished);
        assert_eq!(failure_lines(&outcome.failures), [2, 3, 4]);
        assert!(outcome.skipped.is_empty());
    }

    #[test]
    fn failed_outcome_ignores_expectations() {
        let failed = CommandOutcome::Failed("internal error".to_owned());
        let outcome = record_outcome_with_expectations(failed);
        let expected = TestFailure {
            line: 1,
            message: "emit: internal error".to_owned(),
        };
        assert_eq!(outcome.failures, [expected]);
        assert!(outcome.skipped.is_empty());
    }

    #[test]
    fn skipped_engine_is_reported_beside_expectations() {
        let finished = CommandOutcome::Finished(CommandResult {
            engine_was_skipped: Some("TESTAOT is not set".to_owned()),
            ..CommandResult::default()
        });
        let outcome = record_outcome_with_expectations(finished);
        let expected = TestFailure {
            line: 1,
            message: "emit: TESTAOT is not set".to_owned(),
        };
        assert_eq!(failure_lines(&outcome.failures), [2, 3, 4]);
        assert_eq!(outcome.skipped, [expected]);
    }

    #[test]
    fn running_files_are_named_one_a_line() {
        let running_files = ["lower/a.ts".to_owned(), "lower/b.ts".to_owned()];
        let described = describe_running_files(&running_files);
        assert_eq!(described, "PANIC lower/a.ts\nPANIC lower/b.ts\n");
        assert_eq!(describe_running_files(&[]), "");
    }

    #[test]
    fn finished_file_is_not_running() {
        let test = FoundTest {
            path: PathBuf::from("no-such-folder/unreadable.ts"),
            display_path: "no-such-folder/unreadable.ts".to_owned(),
        };
        let outcome = run_guarded_test_file(&test);
        assert_eq!(outcome.failures[0].message, "cannot be read");
        assert!(!lock_running_files().contains(&test.display_path));
    }

    #[test]
    fn job_count_is_above_zero() {
        assert_eq!(parse_job_count("1").get(), 1);
        assert_eq!(parse_job_count("12").get(), 12);
    }

    #[test]
    #[should_panic(expected = "AOT_IR_JOBS is 0, which is not a count above 0")]
    fn zero_jobs_panic() {
        parse_job_count("0");
    }

    #[test]
    fn skipped_runs_are_summarized() {
        let skipped = [1, 4].map(|line| TestFailure {
            line,
            message: "lower: TESTAOT is not set".to_owned(),
        });
        let skipped: Vec<&TestFailure> = skipped.iter().collect();
        let summary = describe_skipped_runs("test/aot/ir/lower", &skipped);
        let expected = "SKIP test/aot/ir/lower: the engine verified none of 2 runs: \
            lower: TESTAOT is not set\n";
        assert_eq!(summary.as_deref(), Some(expected));
        assert_eq!(describe_skipped_runs("test/aot/ir/lower", &[]), None);
    }
}
