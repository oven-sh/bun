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
use std::io::{BufRead, BufReader, Lines, Read, Write};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command as Process, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, Once, OnceLock, PoisonError};
use std::thread::JoinHandle;
use support::TestFailure;
use support::check_lines::match_check_lines;
use support::commands::{
    Command, CommandOutcome, CommandResult, Project, find_command, parse_option_words, run_commands,
};
use support::test_file::{
    DiagnosticName, Place, RunDirective, TestFile, holds, is_test_file_name, parse_test_file,
};

const AREAS: [&str; 2] = ["commands", "lower"];
const TEST_ROOT: [&str; 3] = ["test", "aot", "ir"];
const FOLDERS_WITHOUT_TESTS: [&str; 2] = ["imports", "node_modules"];
const MAX_UNEXPECTED_DIAGNOSTICS_SHOWN: usize = 5;
const FILTER_VARIABLE: &str = "AOT_IR_FILTER";
const JOB_COUNT_VARIABLE: &str = "AOT_IR_JOBS";
const OUTPUT_FOLDER_VARIABLE: &str = "AOT_IR_OUTPUT";
/// Set to write the check lines below `GENERATED` anew.
const UPDATE_VARIABLE: &str = "AOT_IR_UPDATE";
/// `<index>/<count>`: which of the files this program runs itself, for a debugger.
const SHARE_VARIABLE: &str = "AOT_IR_SHARE";
/// The program sets it for the copies that it starts: a copy runs the files whose numbers it reads, a line each.
const READS_FILE_NUMBERS_VARIABLE: &str = "AOT_IR_READS_FILE_NUMBERS";
/// What a copy prints behind the lines of a file.
const END_OF_FILE_MARK: &str = "DONE";
const PROJECT_FILE: &str = "tsconfig.json";
const STDERR_LINES_SHOWN: usize = 12;
/// Set where a run that the engine did not verify is a failure, as in CI.
const ENGINE_IS_REQUIRED_VARIABLE: &str = "AOT_IR_REQUIRES_ENGINE";

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

fn test_root() -> PathBuf {
    let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("src/aot is two folders below the repository root");
    let root = repository_root.join(PathBuf::from_iter(TEST_ROOT));
    // The resolver names a file by its real path, and a file of a package is known by the folders above it.
    std::fs::canonicalize(&root).unwrap_or(root)
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
    let folder = test_root().join(area);
    find_tests(&folder, &display_folder_of(area), &mut tests);
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

    let jobs = match std::env::var(JOB_COUNT_VARIABLE) {
        Ok(count) => parse_job_count(&count).get(),
        Err(_) => std::thread::available_parallelism().map_or(1, usize::from),
    };
    if std::env::var_os(READS_FILE_NUMBERS_VARIABLE).is_some() {
        return run_files_named_on_input(&tests);
    }
    match std::env::var(SHARE_VARIABLE) {
        Ok(share) => {
            let (index, count) = parse_share(&share);
            let mut position = 0;
            tests.retain(|_| {
                position += 1;
                (position - 1) % count == index
            });
        }
        Err(_) if !tests.is_empty() => {
            return run_area_in_copies(area, jobs.min(tests.len()), &tests);
        }
        Err(_) => {}
    }

    let outcomes: Vec<OnceLock<TestOutcome>> = tests.iter().map(|_| OnceLock::new()).collect();
    for_each_parallel(1, tests.len(), |index| {
        let outcome = run_guarded_test_file(&tests[index]);
        let is_first_run = outcomes[index].set(outcome).is_ok();
        assert!(is_first_run, "{} ran twice", tests[index].display_path);
    });

    // Without capture the harness leaves the name of the test in front of the first line.
    println!();
    let mut failed_file_count = 0;
    let mut skipped: Vec<&TestFailure> = Vec::new();
    for (test, outcome) in tests.iter().zip(&outcomes) {
        let outcome = outcome.get().expect("every test has run");
        print_outcome(test, outcome);
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
    assert!(
        skipped.is_empty() || std::env::var_os(ENGINE_IS_REQUIRED_VARIABLE).is_none(),
        "the engine verified none of {} runs, and {ENGINE_IS_REQUIRED_VARIABLE} is set",
        skipped.len()
    );
}

fn parse_share(share: &str) -> (usize, usize) {
    let parts = share.split_once('/');
    let numbers = parts.and_then(|(index, count)| Some((index.parse().ok()?, count.parse().ok()?)));
    match numbers {
        Some((index, count)) if index < count => (index, count),
        _ => panic!("{SHARE_VARIABLE} is {share}, which is not <index>/<count>"),
    }
}

fn print_outcome(test: &FoundTest, outcome: &TestOutcome) {
    let path = &test.display_path;
    for TestFailure { line, message } in &outcome.failures {
        println!("FAIL {path}:{line}: {message}");
    }
    for TestFailure { line, message } in &outcome.skipped {
        println!("SKIP {path}:{line}: {message}");
    }
}

fn run_files_named_on_input(tests: &[FoundTest]) {
    println!();
    for_each_parallel(1, 1, |_| {
        for line in std::io::stdin().lines() {
            let line = line.expect("the input is text");
            let test = line.parse().ok().and_then(|index: usize| tests.get(index));
            let test = test.unwrap_or_else(|| panic!("{line} is not the number of a file"));
            print_outcome(test, &run_guarded_test_file(test));
            println!("{END_OF_FILE_MARK}");
        }
    });
}

/// A copy of this program that runs one file after another.
struct ProgramCopy {
    process: Child,
    numbers: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    errors: JoinHandle<String>,
}

impl ProgramCopy {
    fn start(area: &str) -> ProgramCopy {
        let program = std::env::current_exe().expect("a test program knows its path");
        let mut process = Process::new(&program)
            .args([area, "--exact", "--nocapture", "--test-threads=1"])
            .env(READS_FILE_NUMBERS_VARIABLE, "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| panic!("cannot start {}: {error}", program.display()));
        let pipes = (
            process.stdin.take(),
            process.stdout.take(),
            process.stderr.take(),
        );
        let (Some(numbers), Some(output), Some(mut errors)) = pipes else {
            unreachable!("all three are pipes");
        };
        ProgramCopy {
            process,
            numbers,
            lines: BufReader::new(output).lines(),
            // A copy that nobody listens to waits once the pipe is full.
            errors: std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let _ = errors.read_to_end(&mut bytes);
                String::from_utf8_lossy(&bytes).into_owned()
            }),
        }
    }

    /// The lines of the file. `None`: the copy has ended over it.
    fn run(&mut self, index: usize) -> Option<Vec<String>> {
        writeln!(self.numbers, "{index}").ok()?;
        let mut lines = Vec::new();
        loop {
            match self.lines.next()?.ok()? {
                line if line == END_OF_FILE_MARK => return Some(lines),
                line => lines.push(line),
            }
        }
    }

    /// How it ended, and what it wrote as errors.
    fn end(self) -> (ExitStatus, String) {
        let ProgramCopy {
            mut process,
            numbers,
            errors,
            ..
        } = self;
        drop(numbers);
        let status = process.wait().expect("a started copy ends");
        (status, errors.join().unwrap_or_default())
    }
}

// Builds of one process wait for each other wherever they ask for its one pool, so each job is a process. It runs many files, since the
// first build of a process pays for what all of them read. A file that ends its process fails alone: the rest goes to a new copy.
fn run_area_in_copies(area: &str, jobs: usize, tests: &[FoundTest]) {
    let file_count = tests.len();
    let next = AtomicUsize::new(0);
    let outputs: Vec<OnceLock<Vec<String>>> = (0..file_count).map(|_| OnceLock::new()).collect();
    for_each_parallel(jobs, jobs, |_| {
        let mut copy = None;
        loop {
            let index = next.fetch_add(1, Ordering::Relaxed);
            if index >= file_count {
                break;
            }
            let running = copy.get_or_insert_with(|| ProgramCopy::start(area));
            let lines = running.run(index).unwrap_or_else(|| {
                let (status, errors) = copy.take().expect("it ran the file").end();
                let lines: Vec<&str> = errors.lines().collect();
                let shown = &lines[lines.len().saturating_sub(STDERR_LINES_SHOWN)..];
                let path = &tests[index].display_path;
                let mut lines = vec![format!(
                    "FAIL {path}:1: the test program ended with {status}:"
                )];
                lines.extend(shown.iter().map(|&line| line.to_owned()));
                lines
            });
            let _ = outputs[index].set(lines);
        }
        if let Some(copy) = copy {
            copy.end();
        }
    });
    let mut failed_files: Vec<&str> = Vec::new();
    let mut first_skipped_run = None;
    let mut skipped_runs = 0;
    for (test, output) in tests.iter().zip(&outputs) {
        let lines = output.get().expect("every file has run");
        let has_failed = lines.iter().any(|line| line.starts_with("FAIL "));
        for line in lines {
            if line.starts_with("SKIP ") {
                skipped_runs += 1;
                first_skipped_run = first_skipped_run.or(Some(line));
            } else if has_failed {
                println!("{line}");
            }
        }
        if has_failed {
            failed_files.push(&test.display_path);
        }
    }
    if let Some(line) = first_skipped_run {
        let why = line.rsplit(": ").next().unwrap_or_default();
        let folder = display_folder_of(area);
        eprintln!("SKIP {folder}: the engine verified none of {skipped_runs} runs: {why}");
    }
    assert!(
        failed_files.is_empty(),
        "{} of {file_count} files failed",
        failed_files.len()
    );
    assert!(
        skipped_runs == 0 || std::env::var_os(ENGINE_IS_REQUIRED_VARIABLE).is_none(),
        "the engine verified none of {skipped_runs} runs, and {ENGINE_IS_REQUIRED_VARIABLE} is set"
    );
}

fn describe_skipped_runs(display_folder: &str, skipped: &[&TestFailure]) -> Option<String> {
    let (count, why) = (skipped.len(), &skipped.first()?.message);
    Some(format!(
        "SKIP {display_folder}: the engine verified none of {count} runs: {why}\n"
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
    let run = || match std::fs::read(&test.path).map(String::from_utf8) {
        Ok(Ok(text)) => run_test_text(&test.path, &text),
        Ok(Err(_)) => fail_whole_file("is not UTF-8"),
        Err(_) => fail_whole_file("cannot be read"),
    };
    let outcome = std::panic::catch_unwind(run).unwrap_or_else(|payload| {
        fail_whole_file(format!("panicked: {}", panic_message(payload.as_ref())))
    });
    lock_running_files().retain(|path| *path != test.display_path);
    outcome
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

fn fail_whole_file(message: impl Into<String>) -> TestOutcome {
    TestOutcome {
        failures: vec![TestFailure::new(1, message)],
        skipped: Vec::new(),
    }
}

fn create_failure(run: &RunDirective, line: u32, why: impl Display) -> TestFailure {
    TestFailure::new(line, format!("{}: {why}", run.command))
}

struct TemporaryFolder(PathBuf);

impl Drop for TemporaryFolder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn link_to(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    return match target.is_dir() {
        true => std::os::windows::fs::symlink_dir(target, link),
        false => std::os::windows::fs::symlink_file(target, link),
    };
}

/// The sections as files of a folder of their own. A tree without a project at its root gets the one that every other test sees.
fn write_sections(file: &TestFile) -> std::io::Result<TemporaryFolder> {
    static NEXT_FOLDER_NUMBER: AtomicU32 = AtomicU32::new(0);
    let number = NEXT_FOLDER_NUMBER.fetch_add(1, Ordering::Relaxed);
    let name = format!("bun-aot-ir-{}-{number}", std::process::id());
    let path = std::env::temp_dir().join(name);
    std::fs::create_dir_all(&path)?;
    // A place is printed from the root, and the front end names a file by its real path.
    let folder = TemporaryFolder(std::fs::canonicalize(&path).unwrap_or(path));
    let create_parent = |path: &Path| std::fs::create_dir_all(path.parent().unwrap_or(path));
    for section in &file.sections {
        let path = folder.0.join(&section.path);
        create_parent(&path)?;
        std::fs::write(path, &section.text)?;
    }
    if file
        .sections
        .iter()
        .all(|section| section.path != PROJECT_FILE)
    {
        std::fs::copy(test_root().join(PROJECT_FILE), folder.0.join(PROJECT_FILE))?;
    }
    for link in &file.links {
        let path = folder.0.join(&link.path);
        create_parent(&path)?;
        link_to(&folder.0.join(&link.target), &path)?;
    }
    Ok(folder)
}

fn project_of_sections(file: &TestFile, root: &Path) -> Project {
    let first = file.sections.first().map(|section| &section.path);
    let entry_points = match file.entry_points.is_empty() {
        true => first.into_iter().collect::<Vec<_>>(),
        false => file.entry_points.iter().collect(),
    };
    Project {
        root: root.to_owned(),
        working_directory: match &file.working_directory {
            Some(folder) => root.join(folder),
            None => root.to_owned(),
        },
        entry_points: entry_points
            .into_iter()
            .map(|path| root.join(path))
            .collect(),
    }
}

/// `None` for a run whose line is wrong, which `failures` says.
fn run_all(
    file: &TestFile,
    project: &Project,
    failures: &mut Vec<TestFailure>,
) -> Vec<Option<CommandOutcome>> {
    let commands: Vec<Option<Command>> = (file.runs.iter())
        .map(|run| {
            let command = find_command(&run.command);
            if command.is_none() {
                let message = format!("unknown command {}", run.command);
                failures.push(TestFailure::new(run.line, message));
            } else if !run.arguments.is_empty() {
                let message = format!("{} takes no argument", run.command);
                failures.push(TestFailure::new(run.line, message));
                return None;
            }
            command
        })
        .collect();
    let words_of = |index: usize| -> Vec<&str> {
        let words = file.option_words_for(&file.runs[index].prefix);
        words.into_iter().map(|word| word.word.as_str()).collect()
    };
    let mut outcomes: Vec<Option<CommandOutcome>> = file.runs.iter().map(|_| None).collect();
    let mut is_done = vec![false; file.runs.len()];
    for first in 0..file.runs.len() {
        if is_done[first] || commands[first].is_none() {
            continue;
        }
        // Runs with the same options print one build.
        let together: Vec<usize> = (first..file.runs.len())
            .filter(|&index| commands[index].is_some() && words_of(index) == words_of(first))
            .collect();
        for &index in &together {
            is_done[index] = true;
        }
        let aot = match parse_option_words(file.option_words_for(&file.runs[first].prefix)) {
            Ok(aot) => aot,
            Err(failure) => {
                failures.push(failure);
                continue;
            }
        };
        let printers: Vec<Command> = together
            .iter()
            .filter_map(|&index| commands[index])
            .collect();
        for (index, outcome) in together
            .into_iter()
            .zip(run_commands(&printers, project, &aot))
        {
            outcomes[index] = Some(outcome);
        }
    }
    outcomes
}

fn check_same_runs(
    file: &TestFile,
    outcomes: &[Option<CommandOutcome>],
    failures: &mut Vec<TestFailure>,
) {
    let result_of = |prefix: &String| {
        let index = file.runs.iter().position(|run| run.prefix == *prefix)?;
        outcomes[index].as_ref()?.as_ref().ok()
    };
    for same in &file.same_runs {
        let [first, second] = &same.prefixes;
        let (Some(a), Some(b)) = (result_of(first), result_of(second)) else {
            continue;
        };
        let mut lines = a.output.lines().zip(b.output.lines()).zip(1..);
        let difference = lines.find(|((a, b), _)| a != b);
        let why = match difference {
            Some(((a, b), number)) => format!("line {number}: {first} prints {a}, {second} {b}"),
            None if a.output != b.output => "one prints more lines".to_owned(),
            None if a.diagnostics != b.diagnostics || a.places != b.places => {
                "their diagnostics differ".to_owned()
            }
            None => continue,
        };
        let message = format!("{first} and {second} differ: {why}");
        failures.push(TestFailure::new(same.line, message));
    }
}

fn run_test_text(path: &Path, text: &str) -> TestOutcome {
    let mut file = parse_test_file(text);
    let mut outcome = TestOutcome::default();
    if !file.errors.is_empty() {
        outcome.failures = file.errors;
        return outcome;
    }
    let tree = match file.sections.is_empty() {
        true => None,
        false => match write_sections(&file) {
            Ok(tree) => Some(tree),
            Err(error) => return fail_whole_file(format!("cannot write its sections: {error}")),
        },
    };
    let project = match &tree {
        Some(tree) => project_of_sections(&file, &tree.0),
        None => Project::of_file(path),
    };
    let outcomes = run_all(&file, &project, &mut outcome.failures);
    if std::env::var_os(UPDATE_VARIABLE).is_some()
        && let Some(updated) = write_generated_lines(text, &file, &outcomes)
    {
        if let Err(error) = std::fs::write(path, &updated) {
            return fail_whole_file(format!("cannot be written: {error}"));
        }
        file = parse_test_file(&updated);
        if !file.errors.is_empty() {
            outcome.failures = file.errors;
            return outcome;
        }
    }
    check_same_runs(&file, &outcomes, &mut outcome.failures);
    for (run, command_outcome) in file.runs.iter().zip(outcomes) {
        let Some(command_outcome) = command_outcome else {
            continue;
        };
        if let Some(folder) = std::env::var_os(OUTPUT_FOLDER_VARIABLE) {
            write_command_outcome(Path::new(&folder), path, run, &command_outcome);
        }
        record_command_outcome(&file, run, command_outcome, &mut outcome);
    }
    outcome.failures.sort_by_key(|failure| failure.line);
    outcome
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'$')
}

/// An id that is counted over the whole program, the library in front: it moves when anything in front of it does.
fn is_program_wide_id(token: &str) -> bool {
    let mut bytes = token.bytes();
    matches!(bytes.next(), Some(b'f' | b'g' | b'm' | b'L' | b'w' | b'd'))
        && token.len() > 1
        && bytes.all(|byte| byte.is_ascii_digit())
}

/// A pattern that one printed line matches. Positions in the source are left out, and an id of the program is a variable.
fn pattern_of(line: &str, ids: &mut Vec<String>) -> String {
    let (bytes, mut pattern) = (line.trim().as_bytes(), String::new());
    let (mut at, mut is_quoted) = (0, false);
    while at < bytes.len() {
        let byte = bytes[at];
        let rest = &bytes[at..];
        let digits = |from: usize| {
            rest[from..]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count()
        };
        if is_quoted {
            is_quoted = byte != b'"';
            if byte == b'\\' && rest.len() > 1 {
                pattern.push('\\');
                at += 1;
            }
        } else if byte == b'"' {
            is_quoted = true;
        } else if rest.starts_with(b" @") && digits(2) > 0 {
            at += 2 + digits(2);
            // A word may stand behind the positions.
            let is_last = !bytes[at..].starts_with(b" @");
            if is_last && at < bytes.len() {
                pattern.push_str("{{*}}");
            }
            continue;
        } else if rest.starts_with(b"text={start=") {
            pattern.push_str("text={{*}}");
            at += bun_core::strings::index_of_char_usize(rest, b'}')
                .map_or(rest.len(), |end| end + 1);
            continue;
        } else if rest.starts_with(b"position=") && digits(9) > 0 {
            pattern.push_str("position={{*}}");
            at += 9 + digits(9);
            continue;
        } else if is_token_byte(byte) && (at == 0 || !is_token_byte(bytes[at - 1])) {
            let length = rest.iter().take_while(|&&byte| is_token_byte(byte)).count();
            let token = &line.trim()[at..at + length];
            if is_program_wide_id(token) {
                let known = ids.iter().position(|id| id == token);
                let number = known.unwrap_or_else(|| {
                    ids.push(token.to_owned());
                    ids.len() - 1
                });
                // Three brackets would not read as a bracket and a variable.
                if pattern.ends_with('[') {
                    pattern.pop();
                    pattern.push_str("{{*}}");
                }
                pattern.push_str(&format!("[[{}_{number}]]", &token[..1]));
            } else {
                pattern.push_str(token);
            }
            at += length;
            continue;
        }
        // The two marks of a pattern, where the text has them.
        match rest.starts_with(b"{{") || rest.starts_with(b"[[") {
            true => pattern.push_str("{{*}}"),
            false => pattern.push_str(
                &line.trim()[at..]
                    .chars()
                    .next()
                    .map_or(String::new(), String::from),
            ),
        }
        at += line.trim()[at..].chars().next().map_or(1, char::len_utf8);
    }
    pattern
}

fn name_of_function(header: &str) -> Option<&str> {
    let (_, rest) = header.split_once(" name=\"")?;
    rest.split_once('"').map(|(name, _)| name)
}

fn generate_check_lines(prefix: &str, output: &str, functions: &[String], text: &mut String) {
    let mut ids = Vec::new();
    let mut is_wanted = false;
    for line in output.lines() {
        if line.starts_with("function ") {
            let name = name_of_function(line);
            let is_listed = |word: &str| functions.iter().any(|listed| listed == word);
            is_wanted = is_listed("*") || name.is_some_and(is_listed);
            if !is_wanted {
                continue;
            }
            let (label, rest) = match name {
                Some(name) => {
                    let mark = format!("name=\"{name}\"");
                    let end = line.find(&mark).map_or(line.len(), |at| at + mark.len());
                    (format!("function {{{{*}}}}{mark}"), &line[end..])
                }
                None => ("function ".to_owned(), &line["function ".len()..]),
            };
            match name {
                Some(_) => text.push_str(&format!("// {prefix}-LABEL: {label}\n")),
                None => text.push_str(&format!("// {prefix}: {label}{{{{*}}}}\n")),
            }
            let rest = match name {
                Some(_) => rest,
                None => rest.split_once(' ').map_or("", |(_, rest)| rest),
            };
            if !rest.trim().is_empty() {
                text.push_str(&format!("// {prefix}: {}\n", pattern_of(rest, &mut ids)));
            }
            is_wanted = line.ends_with('{');
        } else if is_wanted && !line.trim().is_empty() {
            text.push_str(&format!(
                "// {prefix}-NEXT: {}\n",
                pattern_of(line, &mut ids)
            ));
            is_wanted = line != "}";
        }
    }
}

/// The text of the file with the lines below `GENERATED` written from what the runs print. `None`: the file has no such line.
fn write_generated_lines(
    text: &str,
    file: &TestFile,
    outcomes: &[Option<CommandOutcome>],
) -> Option<String> {
    let generated = file.generated.as_ref()?;
    let kept = text.split_inclusive('\n').take(generated.line as usize);
    let mut updated: String = kept.collect();
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    for (run, outcome) in file.runs.iter().zip(outcomes) {
        if let Some(Ok(result)) = outcome {
            let output = hide_function_texts(&result.output);
            generate_check_lines(&run.prefix, &output, &generated.functions, &mut updated);
        }
    }
    Some(updated)
}

fn describe_command_outcome(outcome: &CommandOutcome) -> String {
    let result = match outcome {
        Ok(result) => result,
        Err(why) => return format!("FAILED: {why}\n"),
    };
    let mut text = result.output.clone();
    for (name, message) in &result.diagnostics {
        let name = diagnostic_text(*name);
        text.push_str(&format!("DIAGNOSTIC: {name} ({message})\n"));
    }
    for (statistic, value) in &result.statistics {
        text.push_str(&format!("STATISTIC: {} = {value}\n", statistic.name()));
    }
    text
}

fn write_command_outcome(folder: &Path, test: &Path, run: &RunDirective, outcome: &CommandOutcome) {
    let below_root = test.strip_prefix(test_root()).unwrap_or(test);
    let mut name = below_root.as_os_str().to_owned();
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
    command_outcome: CommandOutcome,
    outcome: &mut TestOutcome,
) {
    match command_outcome {
        Ok(result) => {
            check_expectations(file, run, &result, &mut outcome.failures);
            if let Some(why) = &result.engine_was_skipped {
                outcome.skipped.push(create_failure(run, run.line, why));
            }
        }
        Err(why) => outcome.failures.push(create_failure(run, run.line, why)),
    }
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

fn check_expectations(
    file: &TestFile,
    run: &RunDirective,
    result: &CommandResult,
    failures: &mut Vec<TestFailure>,
) {
    let mut report = |line: u32, why: String| failures.push(create_failure(run, line, why));
    let listed = &file.diagnostics;
    let reported = &result.diagnostics;
    let engine_was_skipped = result.engine_was_skipped.is_some();
    let place_of = |index: usize| result.places.get(index).and_then(Option::as_ref);
    for expected in listed {
        if engine_was_skipped && is_reported_by_engine(expected.name) {
            continue;
        }
        let name = diagnostic_text(expected.name);
        if let Some(place) = &expected.place {
            let mut at_place = (reported.iter().zip(0..)).filter(|((name, _), index)| {
                *name == expected.name && place_of(*index) == Some(place)
            });
            if at_place.next().is_none() {
                let Place { file, line } = place;
                report(
                    expected.line,
                    format!("{name} was not reported at {file}:{line}"),
                );
            }
            continue;
        }
        let count = reported
            .iter()
            .filter(|(name, _)| *name == expected.name)
            .count();
        if count == 0 {
            report(expected.line, format!("{name} was not reported"));
        } else if expected
            .count
            .is_some_and(|listed_count| listed_count as usize != count)
        {
            report(expected.line, format!("{name} was reported {count} times"));
        }
    }

    // A name that is listed with places is expected at those alone.
    let is_expected = |name: DiagnosticName, index: usize| {
        let mut of_name = listed.iter().filter(|expected| expected.name == name);
        of_name
            .any(|expected| expected.place.is_none() || expected.place.as_ref() == place_of(index))
    };
    let mut unexpected =
        (reported.iter().zip(0..)).filter(|((name, _), index)| !is_expected(*name, *index));
    for ((name, message), index) in unexpected.by_ref().take(MAX_UNEXPECTED_DIAGNOSTICS_SHOWN) {
        let name = diagnostic_text(*name);
        match place_of(index) {
            Some(Place { file, line }) => {
                report(
                    run.line,
                    format!("unexpected {name} at {file}:{line}: {message}"),
                );
            }
            None => report(run.line, format!("unexpected {name}: {message}")),
        }
    }
    let hidden_count = unexpected.count();
    if hidden_count > 0 {
        report(run.line, format!("and {hidden_count} more"));
    }

    for expected in &file.statistics {
        let mut statistics = result.statistics.iter();
        let counted = statistics.find(|(id, _)| *id == expected.name);
        let actual = counted.map_or(0, |&(_, value)| value);
        if !holds(expected.comparison, actual, expected.value) {
            let name = expected.name.name();
            report(expected.line, format!("{name} is {actual}"));
        }
    }

    let lines = file.check_lines_for(&run.prefix);
    if let Err(failure) = match_check_lines(lines, &hide_function_texts(&result.output)) {
        report(failure.line, failure.message);
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
    use std::sync::Barrier;

    const PROGRAM_WITH_IMPORT: &str = "lower-entry-functions.ts";
    /// The program sets it for the copies that `builds_run_side_by_side` starts.
    const BUILDS_SIDE_BY_SIDE_VARIABLE: &str = "AOT_IR_BUILDS_SIDE_BY_SIDE";
    const PROCESSES_THAT_BUILD: usize = 32;
    const BUILDS_SIDE_BY_SIDE: usize = 4;
    const BUILDS_OF_A_THREAD: usize = 2;

    #[test]
    fn text_of_a_module_is_hidden_from_the_check_lines() {
        let output = "module m0 path=\"a\" functionText=\"// CHECK-NOT: Call\\x0af(\\x22x\\x22);\"\n  v0 = Call\nmodule m1 functionText=\"\" kind=Data\n";
        let hidden = "module m0 path=\"a\" functionText=\"\"\n  v0 = Call\nmodule m1 functionText=\"\" kind=Data\n";
        assert_eq!(hide_function_texts(output), hidden);
        let without_module = "function f0 {\n}\n";
        assert_eq!(hide_function_texts(without_module), without_module);
    }

    fn failure_lines(failures: &[TestFailure]) -> Vec<u32> {
        failures.iter().map(|failure| failure.line).collect()
    }

    fn display_paths(area: &str) -> Vec<String> {
        let tests = find_area_tests(area).into_iter();
        tests.map(|test| test.display_path).collect()
    }

    #[track_caller]
    fn expect_failures_on_program(directives: &str, lines: &[u32]) {
        let path = test_root().join("commands").join(PROGRAM_WITH_IMPORT);
        let outcome = OnceLock::new();
        for_each_parallel(1, 1, |_| {
            assert!(outcome.set(run_test_text(&path, directives)).is_ok());
        });
        let outcome: TestOutcome = outcome.into_inner().expect("the run has finished");
        let failures = &outcome.failures;
        assert_eq!(failure_lines(failures), lines, "{failures:?}");
    }

    fn parse_directives(directives: &str) -> TestFile {
        let file = parse_test_file(directives);
        assert!(file.errors.is_empty(), "{:?}", file.errors);
        file
    }

    fn finished_run_failures(directives: &str, result: &CommandResult) -> Vec<u32> {
        let file = parse_directives(directives);
        let mut failures = Vec::new();
        check_expectations(&file, &file.runs[0], result, &mut failures);
        failure_lines(&failures)
    }

    fn record_outcome_with_expectations(command_outcome: CommandOutcome) -> TestOutcome {
        let directives = "// RUN: emit\n\
            // DIAGNOSTIC: TS2322\n\
            // STATISTIC: ProgramBytes >= 1\n\
            // CHECK: Add\n";
        let file = parse_directives(directives);
        let mut outcome = TestOutcome::default();
        record_command_outcome(&file, &file.runs[0], command_outcome, &mut outcome);
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
                assert!(
                    !folders.any(|folder| FOLDERS_WITHOUT_TESTS.contains(&folder)),
                    "{path}"
                );
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
    fn check_lines_are_matched() {
        let directives = "// RUN: lower\n// CHECK-LABEL: name=\"add\"\n// CHECK: Return\n";
        expect_failures_on_program(directives, &[]);
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

    fn build_side_by_side() {
        let path = test_root().join("commands").join(PROGRAM_WITH_IMPORT);
        let directives = "// RUN: lower\n// CHECK-LABEL: name=\"add\"\n// CHECK: Return\n";
        let start = Barrier::new(BUILDS_SIDE_BY_SIDE);
        for_each_parallel(BUILDS_SIDE_BY_SIDE, BUILDS_SIDE_BY_SIDE, |_| {
            start.wait();
            for _ in 0..BUILDS_OF_A_THREAD {
                let failures = run_test_text(&path, directives).failures;
                assert!(failures.is_empty(), "{failures:?}");
            }
        });
    }

    // Only its first builds meet what a process sets up once, so there are many processes.
    #[test]
    fn builds_run_side_by_side() {
        if std::env::var_os(BUILDS_SIDE_BY_SIDE_VARIABLE).is_some() {
            return build_side_by_side();
        }
        let program = std::env::current_exe().expect("a test program knows its path");
        for_each_parallel(PROCESSES_THAT_BUILD, PROCESSES_THAT_BUILD, |_| {
            let output = Process::new(&program)
                .args(["tests::builds_run_side_by_side", "--exact", "--nocapture"])
                .env(BUILDS_SIDE_BY_SIDE_VARIABLE, "1")
                .output()
                .unwrap_or_else(|error| panic!("cannot start {}: {error}", program.display()));
            let errors = String::from_utf8_lossy(&output.stderr);
            assert!(output.status.success(), "{}: {errors}", output.status);
        });
    }

    #[test]
    fn failures_before_any_run() {
        for (directives, line) in [
            ("// RUN: lower\n// NOTE: x\n// CHECK: NoSuchOperation\n", 2),
            ("// RUN: no-such-command\n", 1),
            ("// RUN: print\n", 1),
            ("// RUN: verify\n", 1),
            ("// RUN: compile\n", 1),
            ("// RUN: lower f0\n", 1),
            ("// RUN: lower\n// FORM: AsRead\n", 2),
            (
                "// RUN: lower\n// CHECK: Add\n// OPTIONS: threads=1 nonsense\n",
                3,
            ),
            ("// RUN: lower\n// OPTIONS: validate\n", 2),
        ] {
            let outcome = run_test_text(Path::new("never-read.ts"), directives);
            let failures = &outcome.failures;
            assert_eq!(failure_lines(failures), [line], "{failures:?}");
            assert!(outcome.skipped.is_empty());
        }
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
        let with_engine = CommandResult::default();
        assert_eq!(finished_run_failures(listed, &with_engine), [2, 3]);
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
        let absent_is_zero = "// RUN: link\n\
            // STATISTIC: MaxNestingDepthHits = 0\n\
            // STATISTIC: MaxNestingDepthHits >= 1\n";
        assert_eq!(finished_run_failures(absent_is_zero, &result), [3]);
    }

    #[test]
    fn finished_outcome_checks_expectations() {
        let outcome = record_outcome_with_expectations(Ok(CommandResult::default()));
        assert_eq!(failure_lines(&outcome.failures), [2, 3, 4]);
        assert!(outcome.skipped.is_empty());
    }

    #[test]
    fn failed_outcome_ignores_expectations() {
        let outcome = record_outcome_with_expectations(Err("internal error".to_owned()));
        let expected = TestFailure::new(1, "emit: internal error");
        assert_eq!(outcome.failures, [expected]);
        assert!(outcome.skipped.is_empty());
    }

    #[test]
    fn skipped_engine_is_reported_beside_expectations() {
        let outcome = record_outcome_with_expectations(Ok(CommandResult {
            engine_was_skipped: Some("TESTAOT is not set".to_owned()),
            ..CommandResult::default()
        }));
        assert_eq!(failure_lines(&outcome.failures), [2, 3, 4]);
        let expected = TestFailure::new(1, "emit: TESTAOT is not set");
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
        let skipped = [1, 4].map(|line| TestFailure::new(line, "lower: TESTAOT is not set"));
        let skipped: Vec<&TestFailure> = skipped.iter().collect();
        let summary = describe_skipped_runs("test/aot/ir/lower", &skipped);
        let expected = "SKIP test/aot/ir/lower: the engine verified none of 2 runs: \
            lower: TESTAOT is not set\n";
        assert_eq!(summary.as_deref(), Some(expected));
        assert_eq!(describe_skipped_runs("test/aot/ir/lower", &[]), None);
    }

    #[test]
    fn a_generated_pattern_leaves_positions_out_and_binds_ids_of_the_program() {
        let mut ids = Vec::new();
        let pattern = pattern_of(
            "    v4 = Call v1, f12 site=w3 key=\"f12 @9\" @298",
            &mut ids,
        );
        assert_eq!(pattern, "v4 = Call v1, [[f_0]] site=[[w_1]] key=\"f12 @9\"");
        let pattern = pattern_of("v10 = ElemGet v3, v9 @4333 @4324 callers", &mut ids);
        assert_eq!(pattern, "v10 = ElemGet v3, v9{{*}} callers");
        let pattern = pattern_of("functionTypes=[f12, w3] {", &mut ids);
        assert_eq!(pattern, "functionTypes={{*}}[[f_0]], [[w_1]]] {");
        let pattern = pattern_of(
            "x=f12 position=17 text={start=1 end=2} casts=[[{{a}}]] L2.b",
            &mut ids,
        );
        assert_eq!(
            pattern,
            "x=[[f_0]] position={{*}} text={{*}} casts={{*}}[{{*}}{a}}]] L2.b"
        );
        assert!(support::check_lines::parse_check_pattern(&pattern).is_ok());
    }

    #[test]
    fn generated_lines_hold_each_named_function_whole() {
        let output = "function f7 name=\"a\" module=m1 {\n  b0():\n    Return v0 @3\n}\nfunction f8 name=\"b\" {\n  b0():\n}\nfunction f9 name=\"c\" module=m1\nentry module=m1\n";
        let mut text = String::new();
        generate_check_lines("P", output, &["a".to_owned(), "c".to_owned()], &mut text);
        let expected = "// P-LABEL: function {{*}}name=\"a\"\n// P: module=[[m_0]] {\n// P-NEXT: b0():\n// P-NEXT: Return v0\n// P-NEXT: }\n// P-LABEL: function {{*}}name=\"c\"\n// P: module=[[m_0]]\n";
        assert_eq!(text, expected);
    }
}
