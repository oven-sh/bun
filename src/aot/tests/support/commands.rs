use super::TestFailure;
use super::standalone_options::StandaloneBuild;
use super::test_file::{DiagnosticName, OptionWord, parse_decimal, parse_engine_diagnostic_name};
use bun_aot::emit::emit;
use bun_aot::ir::generated::{InternalErrorKind, StatisticId};
use bun_aot::ir::{FunctionId, Id, Program, print_function, print_program, run_serially};
use bun_aot::statistics::Statistics;
use bun_aot::{BuildFailed, WithoutServices, link_program};
use bun_ast::{Log, Metadata};
use bun_options_types::aot_options::AotOptions;
use std::ffi::OsStr;
use std::num::NonZeroU32;
use std::path::Path;
use std::process::Output;
use std::sync::Once;
use std::sync::atomic::{AtomicU32, Ordering};

const ENGINE_TOOL_VARIABLE: &str = "TESTAOT";
const ENGINE_TOOL_ARGUMENTS: [&str; 2] = ["print", "--wire"];
const EXIT_CODE_WITH_DIAGNOSTICS: i32 = 1;
const STDERR_LINES_SHOWN: usize = 3;

static NEXT_PROGRAM_FILE_NUMBER: AtomicU32 = AtomicU32::new(0);

#[derive(Default, Debug)]
pub struct CommandResult {
    pub output: String,
    pub diagnostics: Vec<(DiagnosticName, String)>,
    pub statistics: Vec<(StatisticId, u64)>,
    pub engine_was_skipped: Option<String>,
}

pub type CommandOutcome = Result<CommandResult, String>;

pub type Command = fn(&Program) -> String;

pub fn find_command(name: &str) -> Option<Command> {
    let command: Command = match name {
        "lower" => print_entry_functions,
        "link" | "emit" => print_program,
        _ => return None,
    };
    Some(command)
}

pub fn parse_option_words(words: &[OptionWord]) -> Result<AotOptions, TestFailure> {
    let mut aot = AotOptions {
        thread_count: Some(NonZeroU32::MIN),
        ..AotOptions::default()
    };
    for OptionWord { word, line } in words {
        match word.as_str() {
            "erase-types" => aot.erases_types = true,
            "type-errors=silent" => aot.reports_type_mismatches = false,
            "type-errors=log" => aot.reports_type_mismatches = true,
            _ => {
                let count = word.strip_prefix("threads=");
                let Some(count) = count.and_then(parse_decimal::<NonZeroU32>) else {
                    let message = format!("unknown option word {word}");
                    return Err(TestFailure::new(*line, message));
                };
                aot.thread_count = Some(count);
            }
        }
    }
    Ok(aot)
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

fn failed_build_outcome(log: &Log, failed: &BuildFailed) -> CommandOutcome {
    if failed.is_internal_error {
        let mut text = String::new();
        let _ = log.print(&mut text);
        let stage = failed.stage.name();
        return Err(format!("internal error in stage {stage}: {text}"));
    }
    Ok(create_command_result(log, &failed.statistics))
}

pub fn run_command(command: Command, path: &Path, aot: &AotOptions) -> CommandOutcome {
    static OUTPUT: Once = Once::new();
    // A thread of Bun's pool asserts that Bun's `main` has set up the output.
    OUTPUT.call_once(bun_core::output::stdio::init);
    let folder = path.parent().expect("a test file is in a folder");
    let name = path.file_name().expect("a test file has a name");
    let mut build = StandaloneBuild::new(
        folder.as_os_str().as_encoded_bytes().to_vec(),
        vec![name.as_encoded_bytes().to_vec()],
    );
    build.omits_builtin_modules = true;
    build.aot = aot.clone();
    let mut log = Log::init();
    let linked = match link_program(&build.options(), &WithoutServices, &mut log) {
        Ok(linked) => linked,
        Err(failed) => return failed_build_outcome(&log, &failed),
    };
    let mut result = create_command_result(&log, &linked.summary.statistics);
    result.output = command(&linked.program);
    let text = print_program(&linked.program);
    let bytes =
        emit(linked.program, &run_serially).map_err(|error| format!("emit failed: {error:?}"))?;
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
        return Ok(result);
    };
    let output = print_with_engine(testaot, program)?;
    if output.status.success() {
        let engine_text = String::from_utf8_lossy(&output.stdout);
        return match find_first_difference(&engine_text, front_end_text) {
            Some(difference) => Err(difference),
            None => Ok(result),
        };
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if reports_other_schema(&stderr) {
        let why = format!("{ENGINE_TOOL_VARIABLE} was built from another schema");
        result.engine_was_skipped = Some(why);
        return Ok(result);
    }
    let exit_code = output.status.code();
    if exit_code == Some(EXIT_CODE_WITH_DIAGNOSTICS) {
        let diagnostics = parse_engine_diagnostics(&stderr);
        if !diagnostics.is_empty() {
            result.diagnostics.extend(diagnostics);
            return Ok(result);
        }
    }
    let exit = match exit_code {
        Some(code) => format!("exit code {code}"),
        None => output.status.to_string(),
    };
    let shown: Vec<&str> = stderr.lines().take(STDERR_LINES_SHOWN).collect();
    Err(format!("testaot print: {exit}: {}", shown.join("; ")))
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

fn print_with_engine(testaot: &OsStr, program: &[u8]) -> Result<Output, String> {
    let number = NEXT_PROGRAM_FILE_NUMBER.fetch_add(1, Ordering::Relaxed);
    let name = format!("bun-aot-ir-{}-{number}.bin", std::process::id());
    let file = std::env::temp_dir().join(name);
    let output = std::fs::write(&file, program)
        .map_err(|error| format!("cannot write {}: {error}", file.display()))
        .and_then(|()| {
            let mut command = std::process::Command::new(testaot);
            let output = command.args(ENGINE_TOOL_ARGUMENTS).arg(&file).output();
            output.map_err(|error| format!("testaot print: cannot be started: {error}"))
        });
    let _ = std::fs::remove_file(&file);
    output
}

/// The tool and these tests were built from two states of the schema, so it reads nothing that they emit.
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

    fn create_failed_build(is_internal_error: bool) -> BuildFailed {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::FunctionsLowered, 3);
        BuildFailed {
            stage: Stage::LinkAndEmit,
            is_internal_error,
            statistics,
            compilation: None,
            refused_entry_points: None,
            is_one_program: false,
            brought_bun_types: false,
        }
    }

    fn check_with_tool(testaot: Option<&str>, front_end_text: &str) -> CommandOutcome {
        let result = CommandResult {
            output: "function f0\n".to_owned(),
            ..CommandResult::default()
        };
        check_with_engine(testaot.map(OsStr::new), b"", front_end_text, result)
    }

    fn parse(words: &[&str]) -> Result<(bool, bool, u32), TestFailure> {
        let words = words.iter().zip(1..).map(|(word, line)| OptionWord {
            word: (*word).to_owned(),
            line,
        });
        let aot = parse_option_words(&words.collect::<Vec<_>>())?;
        let thread_count = aot.thread_count.map_or(0, NonZeroU32::get);
        Ok((aot.erases_types, aot.reports_type_mismatches, thread_count))
    }

    #[test]
    fn command_lookup() {
        for name in ["lower", "link", "emit"] {
            assert!(find_command(name).is_some(), "{name}");
        }
        for name in ["print", "verify", "compile", ""] {
            assert!(find_command(name).is_none(), "{name}");
        }
    }

    #[test]
    fn front_end_words() {
        assert_eq!(parse(&[]), Ok((false, false, 1)));
        let listed = ["erase-types", "type-errors=log", "threads=4"];
        assert_eq!(parse(&listed), Ok((true, true, 4)));
        let listed = [
            "type-errors=log",
            "threads=4",
            "type-errors=silent",
            "threads=2",
        ];
        assert_eq!(parse(&listed), Ok((false, false, 2)));
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
            "validate",
            "check=verify-each-pass",
            "disable=flow-results",
            "limit=MaxTypeNodes:1",
            "layout-seed=9",
        ] {
            let message = format!("unknown option word {word}");
            let failure = parse(&["erase-types", word]).unwrap_err();
            assert_eq!(failure, TestFailure::new(2, message.clone()));
            let failure = parse(&[word]).unwrap_err();
            assert_eq!(failure, TestFailure::new(1, message));
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
        let messages: [(&[u8], Metadata); 3] = [
            (b"not assignable", type_error),
            (b"no entry", Metadata::Build),
            (b"not found", resolve_error),
        ];
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
        let result = failed_build_outcome(&log, &create_failed_build(false))
            .expect("a user's error is judged by the DIAGNOSTIC lines");
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
        let why = failed_build_outcome(&Log::init(), &create_failed_build(true))
            .expect_err("a test cannot expect an internal error");
        let prefix = "internal error in stage LinkAndEmit: ";
        assert!(why.starts_with(prefix), "{why}");
    }

    #[test]
    fn missing_engine_variable_is_recorded() {
        let result =
            check_with_tool(None, "").expect("the CHECK lines are compared without the engine");
        let why = result.engine_was_skipped.as_deref();
        assert_eq!(why, Some("TESTAOT is not set"));
        assert_eq!(result.output, "function f0\n");
    }

    #[test]
    fn missing_engine_executable_fails_command() {
        let why = check_with_tool(Some("/nonexistent/testaot"), "")
            .expect_err("a tool that cannot be started verifies nothing");
        let prefix = "testaot print: cannot be started: ";
        assert!(why.starts_with(prefix), "{why}");
    }

    #[test]
    fn missing_engine_cannot_start() {
        let why = print_with_engine(OsStr::new("/nonexistent/testaot"), b"").unwrap_err();
        let prefix = "testaot print: cannot be started: ";
        assert!(why.starts_with(prefix), "{why}");
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

    #[cfg(unix)]
    #[test]
    fn engine_exit_code_without_diagnostic_fails() {
        let why = check_with_tool(Some("false"), "").unwrap_err();
        assert!(why.starts_with("testaot print: exit code 1: "), "{why}");
    }

    #[cfg(unix)]
    #[test]
    fn engine_text_must_equal_front_end_text() {
        let result = check_with_tool(Some("true"), "").expect("both texts are empty");
        assert_eq!(result.engine_was_skipped, None);
        let why = check_with_tool(Some("true"), "entry\n").expect_err("the engine printed nothing");
        let expected = "line 1: the engine prints <nothing>, the front end entry";
        assert_eq!(why, expected);
    }

    #[test]
    fn engine_diagnostic_lines_are_parsed() {
        let stderr = "UnprovenInt32: a.ts:1:2: not an int32\n\
            reading program.bin\n\
            IdOutOfRange: f3: v9\n\
            Unknown: nothing\n\
            NoSuchKind: text\n";
        let unproven = DiagnosticName::User(UserDiagnosticKind::UnprovenInt32);
        let out_of_range = DiagnosticName::Internal(InternalErrorKind::IdOutOfRange);
        let expected = [
            (unproven, "a.ts:1:2: not an int32".to_owned()),
            (out_of_range, "f3: v9".to_owned()),
        ];
        assert_eq!(parse_engine_diagnostics(stderr), expected);
        assert!(parse_engine_diagnostics("").is_empty());
    }

    #[test]
    fn first_difference() {
        for (engine_text, front_end_text, expected) in [
            ("", "", None),
            ("a\nb\n", "a\nb\n", None),
            ("a\r\nb\r\n", "a\nb\n", None),
            (
                "a\nb\nc\n",
                "a\nx\ny\n",
                Some("line 2: the engine prints b, the front end x"),
            ),
            (
                "a\n",
                "a\nb\n",
                Some("line 2: the engine prints <nothing>, the front end b"),
            ),
            (
                "a\nb\n",
                "a\n",
                Some("line 2: the engine prints b, the front end <nothing>"),
            ),
        ] {
            let difference = find_first_difference(engine_text, front_end_text);
            assert_eq!(difference.as_deref(), expected);
        }
    }
}
