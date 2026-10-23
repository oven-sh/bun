use super::TestFailure;
use super::standalone_options::StandaloneBuild;
use super::test_file::{DiagnosticName, OptionWord, parse_decimal, parse_engine_diagnostic_name};
use bun_aot::emit::emit;
use bun_aot::ir::generated::{InternalErrorKind, StatisticId};
use bun_aot::ir::{FunctionId, Id, Program, print_function, print_program, run_serially};
use bun_aot::statistics::Statistics;
use bun_aot::{BuildFailed, WithoutServices, link_program};
use bun_ast::{Log, Metadata};
use std::ffi::OsStr;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Once;
use std::sync::atomic::{AtomicU32, Ordering};

const ENGINE_TOOL_VARIABLE: &str = "TESTAOT";
const ENGINE_TOOL_ARGUMENTS: [&str; 2] = ["print", "--wire"];
const EXIT_CODE_WITH_DIAGNOSTICS: i32 = 1;
const STDERR_LINES_SHOWN: usize = 3;

static NEXT_PROGRAM_FILE_NUMBER: AtomicU32 = AtomicU32::new(0);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct FrontEndWords {
    pub erases_types: bool,
    pub reports_type_mismatches: bool,
    pub thread_count: NonZeroU32,
}

impl Default for FrontEndWords {
    fn default() -> FrontEndWords {
        FrontEndWords {
            erases_types: false,
            reports_type_mismatches: false,
            thread_count: NonZeroU32::MIN,
        }
    }
}

pub struct CommandInput<'a> {
    pub path: &'a Path,
    pub words: FrontEndWords,
}

#[derive(Default)]
pub struct CommandResult {
    pub output: String,
    pub diagnostics: Vec<(DiagnosticName, String)>,
    pub statistics: Vec<(StatisticId, u64)>,
    pub engine_was_skipped: Option<String>,
}

pub enum CommandOutcome {
    Finished(CommandResult),
    Failed(String),
}

pub struct Command {
    pub name: &'static str,
    pub run: fn(&CommandInput<'_>) -> CommandOutcome,
}

pub static COMMANDS: [Command; 3] = [
    Command {
        name: "lower",
        run: run_lower,
    },
    Command {
        name: "link",
        run: run_link,
    },
    Command {
        name: "emit",
        run: run_link,
    },
];

#[derive(PartialEq, Eq, Debug)]
enum EngineAnswer {
    Text(String),
    Diagnostics(Vec<(DiagnosticName, String)>),
    /// The tool and these tests were built from two states of the schema, so it reads nothing that they emit.
    OtherSchema,
}

pub fn find_command(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.name == name)
}

pub fn parse_option_words(words: &[OptionWord]) -> Result<FrontEndWords, TestFailure> {
    let mut parsed = FrontEndWords::default();
    for option in words {
        if !try_apply_option_word(&mut parsed, &option.word) {
            return Err(TestFailure {
                line: option.line,
                message: format!("unknown option word {}", option.word),
            });
        }
    }
    Ok(parsed)
}

fn try_apply_option_word(words: &mut FrontEndWords, word: &str) -> bool {
    match word {
        "erase-types" => words.erases_types = true,
        "type-errors=throw" => words.reports_type_mismatches = false,
        "type-errors=log" => words.reports_type_mismatches = true,
        _ => {
            let count = word.strip_prefix("threads=");
            match count.and_then(parse_decimal::<NonZeroU32>) {
                Some(count) => words.thread_count = count,
                None => return false,
            }
        }
    }
    true
}

fn create_build(input: &CommandInput<'_>) -> StandaloneBuild {
    static OUTPUT: Once = Once::new();
    // A thread of Bun's pool asserts that Bun's `main` has set up the output.
    OUTPUT.call_once(bun_core::output::stdio::init);
    let folder = input.path.parent().expect("a test file is in a folder");
    let name = input.path.file_name().expect("a test file has a name");
    let mut build = StandaloneBuild::new(
        folder.as_os_str().as_encoded_bytes().to_vec(),
        vec![name.as_encoded_bytes().to_vec()],
    );
    build.omits_builtin_modules = true;
    build.aot.erases_types = input.words.erases_types;
    build.aot.reports_type_mismatches = input.words.reports_type_mismatches;
    build.aot.thread_count = Some(input.words.thread_count);
    build
}

fn create_command_result(log: &Log, statistics: &Statistics) -> CommandResult {
    let diagnostics = log
        .msgs
        .iter()
        .map(|message| {
            let name = match message.metadata {
                Metadata::TypeScript { code, .. } => DiagnosticName::FrontEnd(code),
                Metadata::Build => DiagnosticName::Build,
                Metadata::Resolve(_) => DiagnosticName::Resolve,
            };
            let text = String::from_utf8_lossy(&message.data.text).into_owned();
            (name, text)
        })
        .collect();
    let counted = StatisticId::ALL
        .into_iter()
        .map(|id| (id, statistics.get(id)))
        .filter(|&(_, value)| value != 0)
        .collect();
    CommandResult {
        diagnostics,
        statistics: counted,
        ..CommandResult::default()
    }
}

fn print_log(log: &Log) -> String {
    let mut text = String::new();
    let _ = log.print(&mut text);
    text
}

fn failed_build_outcome(log: &Log, failed: &BuildFailed) -> CommandOutcome {
    if failed.is_internal_error {
        return CommandOutcome::Failed(format!(
            "internal error in stage {}: {}",
            failed.stage.name(),
            print_log(log)
        ));
    }
    CommandOutcome::Finished(create_command_result(log, &failed.statistics))
}

fn run_front_end(input: &CommandInput<'_>, select: fn(&Program) -> String) -> CommandOutcome {
    let build = create_build(input);
    let mut log = Log::init();
    let linked = match link_program(&build.options(), &WithoutServices, &mut log) {
        Ok(linked) => linked,
        Err(failed) => return failed_build_outcome(&log, &failed),
    };
    let mut result = create_command_result(&log, &linked.summary.statistics);
    result.output = select(&linked.program);
    let text = print_program(&linked.program);
    let bytes = match emit(linked.program, &run_serially) {
        Ok(bytes) => bytes,
        Err(error) => return CommandOutcome::Failed(format!("emit failed: {error:?}")),
    };
    let byte_count = bytes.as_slice().len() as u64;
    result
        .statistics
        .push((StatisticId::ProgramBytes, byte_count));
    let testaot = std::env::var_os(ENGINE_TOOL_VARIABLE);
    check_with_engine(testaot.as_deref(), bytes.as_slice(), &text, result)
}

fn check_with_engine(
    testaot: Option<&OsStr>,
    program: &[u8],
    front_end_text: &str,
    mut result: CommandResult,
) -> CommandOutcome {
    let Some(testaot) = testaot else {
        result.engine_was_skipped = Some(format!("{ENGINE_TOOL_VARIABLE} is not set"));
        return CommandOutcome::Finished(result);
    };
    match print_with_engine(testaot, program) {
        Ok(EngineAnswer::Text(engine_text)) => {
            match find_first_difference(&engine_text, front_end_text) {
                Some(difference) => CommandOutcome::Failed(difference),
                None => CommandOutcome::Finished(result),
            }
        }
        Ok(EngineAnswer::Diagnostics(diagnostics)) => {
            result.diagnostics.extend(diagnostics);
            CommandOutcome::Finished(result)
        }
        Ok(EngineAnswer::OtherSchema) => {
            let why = format!("{ENGINE_TOOL_VARIABLE} was built from another schema");
            result.engine_was_skipped = Some(why);
            CommandOutcome::Finished(result)
        }
        Err(why) => CommandOutcome::Failed(why),
    }
}

fn print_entry_functions(program: &Program) -> String {
    let mut output = String::new();
    let entry_module = program.entries[0].module;
    for (index, function) in program.functions.iter().enumerate() {
        if function.module == entry_module {
            let id = FunctionId::new(index);
            print_function(program.name_tables(), id, function, &mut output);
        }
    }
    output
}

fn run_lower(input: &CommandInput<'_>) -> CommandOutcome {
    run_front_end(input, print_entry_functions)
}

fn run_link(input: &CommandInput<'_>) -> CommandOutcome {
    run_front_end(input, print_program)
}

fn print_with_engine(testaot: &OsStr, program: &[u8]) -> Result<EngineAnswer, String> {
    let number = NEXT_PROGRAM_FILE_NUMBER.fetch_add(1, Ordering::Relaxed);
    let name = format!("bun-aot-ir-{}-{number}.bin", std::process::id());
    let file = std::env::temp_dir().join(name);
    let printed = print_file_with_engine(testaot, &file, program);
    let _ = std::fs::remove_file(&file);
    printed
}

fn print_file_with_engine(
    testaot: &OsStr,
    file: &Path,
    program: &[u8],
) -> Result<EngineAnswer, String> {
    std::fs::write(file, program)
        .map_err(|error| format!("cannot write {}: {error}", file.display()))?;
    let output = std::process::Command::new(testaot)
        .args(ENGINE_TOOL_ARGUMENTS)
        .arg(file)
        .output()
        .map_err(|error| format!("testaot print: cannot be started: {error}"))?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        return Ok(EngineAnswer::Text(text));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if reports_other_schema(&stderr) {
        return Ok(EngineAnswer::OtherSchema);
    }
    let exit_code = output.status.code();
    if exit_code == Some(EXIT_CODE_WITH_DIAGNOSTICS) {
        let diagnostics = parse_engine_diagnostics(&stderr);
        if !diagnostics.is_empty() {
            return Ok(EngineAnswer::Diagnostics(diagnostics));
        }
    }
    let exit = match exit_code {
        Some(code) => format!("exit code {code}"),
        None => output.status.to_string(),
    };
    let shown: Vec<&str> = stderr.lines().take(STDERR_LINES_SHOWN).collect();
    Err(format!("testaot print: {exit}: {}", shown.join("; ")))
}

fn reports_other_schema(stderr: &str) -> bool {
    let message = InternalErrorKind::SchemaMismatch.message();
    stderr.lines().any(|line| line.contains(message))
}

fn parse_engine_diagnostics(stderr: &str) -> Vec<(DiagnosticName, String)> {
    let lines = stderr.lines();
    lines
        .filter_map(|line| {
            let (kind, message) = line.split_once(": ")?;
            Some((parse_engine_diagnostic_name(kind)?, message.to_owned()))
        })
        .collect()
}

fn find_first_difference(engine_text: &str, front_end_text: &str) -> Option<String> {
    let mut engine_lines = engine_text.lines();
    let mut front_end_lines = front_end_text.lines();
    let mut number = 1;
    loop {
        let engine_line = engine_lines.next();
        let front_end_line = front_end_lines.next();
        if engine_line != front_end_line {
            return Some(format!(
                "line {number}: the engine prints {}, the front end {}",
                engine_line.unwrap_or("<nothing>"),
                front_end_line.unwrap_or("<nothing>")
            ));
        }
        if engine_line.is_none() {
            return None;
        }
        number += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_aot::ir::generated::UserDiagnosticKind;
    use bun_aot::statistics::Stage;
    use bun_ast::{BabyString, Data, ImportKind, MetadataResolve, Msg, TypeScriptKind};
    use std::borrow::Cow;

    const MISSING_EXECUTABLE: &str = "/nonexistent/testaot";

    fn create_failed_build(is_internal_error: bool) -> BuildFailed {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::FunctionsLowered, 3);
        BuildFailed {
            stage: Stage::LinkAndEmit,
            is_internal_error,
            statistics,
            compilation: None,
            refused_entry_points: None,
        }
    }

    fn create_log(messages: [(&'static [u8], Metadata); 3]) -> Log {
        let mut log = Log::init();
        for (text, metadata) in messages {
            log.add_msg(Msg {
                data: Data {
                    text: Cow::Borrowed(text),
                    location: None,
                },
                metadata,
                ..Msg::default()
            });
        }
        log
    }

    fn create_result_with_output() -> CommandResult {
        CommandResult {
            output: "function f0\n".to_owned(),
            ..CommandResult::default()
        }
    }

    fn thread_count(count: u32) -> NonZeroU32 {
        NonZeroU32::new(count).unwrap()
    }

    fn parse(words: &[&str]) -> Result<FrontEndWords, TestFailure> {
        let words: Vec<OptionWord> = words
            .iter()
            .zip(1..)
            .map(|(word, line)| OptionWord {
                word: (*word).to_owned(),
                line,
            })
            .collect();
        parse_option_words(&words)
    }

    #[test]
    fn default_words() {
        let expected = FrontEndWords {
            erases_types: false,
            reports_type_mismatches: false,
            thread_count: thread_count(1),
        };
        assert_eq!(parse(&[]), Ok(expected));
    }

    #[test]
    fn front_end_words() {
        let expected = FrontEndWords {
            erases_types: true,
            reports_type_mismatches: true,
            thread_count: thread_count(4),
        };
        let words = ["erase-types", "type-errors=log", "threads=4"];
        assert_eq!(parse(&words), Ok(expected));
    }

    #[test]
    fn last_scalar_word_wins() {
        let words = [
            "type-errors=log",
            "threads=4",
            "type-errors=throw",
            "threads=2",
        ];
        let expected = FrontEndWords {
            thread_count: thread_count(2),
            ..FrontEndWords::default()
        };
        assert_eq!(parse(&words), Ok(expected));
    }

    #[test]
    fn unknown_words() {
        for word in [
            "nonsense",
            "out=program.bin",
            "erase-types=1",
            "type-errors",
            "type-errors=ignore",
            "threads",
            "threads=",
            "threads=0",
            "threads=+1",
            "threads=many",
            "threads=4294967296",
        ] {
            let failure = parse(&["erase-types", word]).unwrap_err();
            assert_eq!(failure.line, 2, "{word}");
        }
    }

    #[test]
    fn engine_words_are_unknown() {
        for word in [
            "validate",
            "check=verify-each-pass",
            "disable=flow-results",
            "limit=MaxTypeNodes:1",
            "layout-seed=9",
        ] {
            let failure = parse(&[word]).unwrap_err();
            assert_eq!(failure.message, format!("unknown option word {word}"));
        }
    }

    #[test]
    fn command_lookup() {
        for name in ["lower", "link", "emit"] {
            assert_eq!(find_command(name).expect(name).name, name);
        }
        for name in ["print", "verify", "compile", ""] {
            assert!(find_command(name).is_none(), "{name}");
        }
    }

    #[test]
    fn user_error_finishes_build() {
        let type_error = Metadata::TypeScript {
            code: 2322,
            kind: TypeScriptKind::Checker,
        };
        let resolve_error = Metadata::Resolve(MetadataResolve {
            specifier: BabyString::new(0, 0),
            import_kind: ImportKind::Stmt,
            err: bun_ast::Error::ModuleNotFound,
        });
        let log = create_log([
            (b"not assignable", type_error),
            (b"no entry", Metadata::Build),
            (b"not found", resolve_error),
        ]);
        let failed = create_failed_build(false);
        let CommandOutcome::Finished(result) = failed_build_outcome(&log, &failed) else {
            panic!("a user's error is judged by the DIAGNOSTIC lines");
        };
        let expected = [
            (DiagnosticName::FrontEnd(2322), "not assignable".to_owned()),
            (DiagnosticName::Build, "no entry".to_owned()),
            (DiagnosticName::Resolve, "not found".to_owned()),
        ];
        assert_eq!(result.diagnostics, expected);
        assert!(result.output.is_empty());
        assert_eq!(result.statistics, [(StatisticId::FunctionsLowered, 3)]);
        assert_eq!(result.engine_was_skipped, None);
    }

    #[test]
    fn internal_error_fails_command() {
        let CommandOutcome::Failed(why) =
            failed_build_outcome(&Log::init(), &create_failed_build(true))
        else {
            panic!("a test cannot expect an internal error");
        };
        let prefix = "internal error in stage LinkAndEmit: ";
        assert!(why.starts_with(prefix), "{why}");
    }

    #[test]
    fn missing_engine_variable_is_recorded() {
        let outcome = check_with_engine(None, b"", "", create_result_with_output());
        let CommandOutcome::Finished(result) = outcome else {
            panic!("the CHECK lines are compared without the engine");
        };
        assert_eq!(
            result.engine_was_skipped.as_deref(),
            Some("TESTAOT is not set")
        );
        assert_eq!(result.output, "function f0\n");
    }

    #[test]
    fn missing_engine_executable_fails_command() {
        let testaot = Some(OsStr::new(MISSING_EXECUTABLE));
        let outcome = check_with_engine(testaot, b"", "", create_result_with_output());
        let CommandOutcome::Failed(why) = outcome else {
            panic!("a tool that cannot be started verifies nothing");
        };
        assert!(
            why.starts_with("testaot print: cannot be started: "),
            "{why}"
        );
    }

    #[test]
    fn other_schema_is_recognized() {
        let message = InternalErrorKind::SchemaMismatch.message();
        assert!(reports_other_schema(&format!("{message}\n")));
        assert!(reports_other_schema(&format!(
            "testaot: x.bin: {message}\nmore\n"
        )));
        assert!(!reports_other_schema("testaot: unknown option\n"));
        assert!(!reports_other_schema(""));
    }

    #[test]
    fn missing_engine_cannot_start() {
        let why = print_with_engine(OsStr::new(MISSING_EXECUTABLE), b"").unwrap_err();
        assert!(
            why.starts_with("testaot print: cannot be started: "),
            "{why}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn engine_exit_code_without_diagnostic_fails() {
        let why = print_with_engine(OsStr::new("false"), b"").unwrap_err();
        assert!(why.starts_with("testaot print: exit code 1: "), "{why}");
    }

    #[cfg(unix)]
    #[test]
    fn engine_text_must_equal_front_end_text() {
        let testaot = Some(OsStr::new("true"));
        let equal = check_with_engine(testaot, b"", "", create_result_with_output());
        let CommandOutcome::Finished(result) = equal else {
            panic!("both texts are empty");
        };
        assert_eq!(result.engine_was_skipped, None);

        let different = check_with_engine(testaot, b"", "entry\n", create_result_with_output());
        let CommandOutcome::Failed(why) = different else {
            panic!("the engine printed nothing");
        };
        assert_eq!(
            why,
            "line 1: the engine prints <nothing>, the front end entry"
        );
    }

    #[test]
    fn engine_diagnostic_lines_are_parsed() {
        let stderr = "UnprovenInt32: a.ts:1:2: not an int32\n\
            reading program.bin\n\
            IdOutOfRange: f3: v9\n\
            Unknown: nothing\n\
            NoSuchKind: text\n";
        let expected = [
            (
                DiagnosticName::User(UserDiagnosticKind::UnprovenInt32),
                "a.ts:1:2: not an int32".to_owned(),
            ),
            (
                DiagnosticName::Internal(InternalErrorKind::IdOutOfRange),
                "f3: v9".to_owned(),
            ),
        ];
        assert_eq!(parse_engine_diagnostics(stderr), expected);
        assert!(parse_engine_diagnostics("").is_empty());
    }

    #[test]
    fn equal_texts_have_no_difference() {
        assert_eq!(find_first_difference("", ""), None);
        assert_eq!(find_first_difference("a\nb\n", "a\nb\n"), None);
        assert_eq!(find_first_difference("a\r\nb\r\n", "a\nb\n"), None);
    }

    #[test]
    fn first_difference_names_line() {
        let difference = find_first_difference("a\nb\nc\n", "a\nx\ny\n").unwrap();
        assert_eq!(difference, "line 2: the engine prints b, the front end x");
    }

    #[test]
    fn missing_line_differs() {
        let shorter_engine_text = find_first_difference("a\n", "a\nb\n").unwrap();
        assert_eq!(
            shorter_engine_text,
            "line 2: the engine prints <nothing>, the front end b"
        );
        let shorter_front_end_text = find_first_difference("a\nb\n", "a\n").unwrap();
        assert_eq!(
            shorter_front_end_text,
            "line 2: the engine prints b, the front end <nothing>"
        );
    }
}
