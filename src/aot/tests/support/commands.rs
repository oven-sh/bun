use super::TestFailure;
use super::test_file::{
    DiagnosticName, OptionWord, Place, parse_decimal, parse_engine_diagnostic_name,
};
use bun_aot::emit::emit_with_bodies_in_bytes;
use bun_aot::ir::generated::{InternalErrorKind, StatisticId};
use bun_aot::ir::{
    FunctionId, Id, Program, REWRITTEN_TYPE, print_function, print_program,
    print_program_held_to_engine, run_serially,
};
use bun_aot::link::LinkedFunctions;
use bun_aot::statistics::Statistics;
use bun_aot::{BuildFailed, link_program};
use bun_ast::{Log, Metadata};
use bun_bundler::aot::testing::{FrontEndInputs, with_front_end_inputs};
use bun_options_types::aot_options::{AotOptions, TargetPlatform};
use bun_sema_driver::Libs;
use std::ffi::OsStr;
use std::mem::take;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::Once;
use std::sync::atomic::{AtomicU32, Ordering};

const ENGINE_TOOL_VARIABLE: &str = "TESTAOT";
const ENGINE_TOOL_ARGUMENTS: [&str; 2] = ["print", "--wire"];
const EXIT_CODE_WITH_DIAGNOSTICS: i32 = 1;
const STDERR_LINES_SHOWN: usize = 3;

static NEXT_PROGRAM_FILE_NUMBER: AtomicU32 = AtomicU32::new(0);

#[derive(Default, Clone, Debug)]
pub struct CommandResult {
    pub output: String,
    pub diagnostics: Vec<(DiagnosticName, String)>,
    pub places: Vec<Option<Place>>,
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

pub struct Project {
    pub root: PathBuf,
    pub working_directory: PathBuf,
    pub entry_points: Vec<PathBuf>,
}

impl Project {
    pub fn of_file(path: &Path) -> Project {
        let folder = path.parent().expect("a test file is in a folder");
        let name = path.file_name().expect("a test file has a name");
        Project {
            root: folder.to_owned(),
            working_directory: folder.to_owned(),
            entry_points: vec![PathBuf::from(name)],
        }
    }
}

pub fn parse_option_words<'a>(
    words: impl IntoIterator<Item = &'a OptionWord>,
) -> Result<AotOptions, TestFailure> {
    let mut aot = AotOptions {
        thread_count: Some(NonZeroU32::MIN),
        omits_builtin_modules: true,
        ..AotOptions::default()
    };
    for OptionWord { word, line } in words {
        match word.as_str() {
            "erase-types" => aot.erases_types = true,
            "builtin-modules" => aot.omits_builtin_modules = false,
            "obfuscates" => aot.obfuscates = true,
            "entry-points-run-again" => aot.entry_points_run_again = true,
            "runs-in-place" => aot.runs_in_place = true,
            "runs-tests" => {
                aot.runs_tests = true;
                aot.runs_in_place = true;
            }
            "platform=darwin" => aot.platform = Some(TargetPlatform::Darwin),
            "platform=linux" => aot.platform = Some(TargetPlatform::Linux),
            "platform=windows" => aot.platform = Some(TargetPlatform::Windows),
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

fn find_places(log: &Log, root: &Path) -> Vec<Option<Place>> {
    let messages = log.msgs.iter();
    messages
        .map(|message| {
            let location = message.data.location.as_ref()?;
            let file = String::from_utf8_lossy(&location.file).into_owned();
            let below_root = Path::new(&file).strip_prefix(root).ok()?;
            Some(Place {
                file: below_root.to_string_lossy().replace('\\', "/"),
                line: u32::try_from(location.line).ok()?,
            })
        })
        .collect()
}

pub fn run_command(command: Command, path: &Path, aot: &AotOptions) -> CommandOutcome {
    let mut outcomes = run_commands(&[command], &Project::of_file(path), aot);
    outcomes.pop().expect("one command has one outcome")
}

pub fn run_commands(
    commands: &[Command],
    project: &Project,
    aot: &AotOptions,
) -> Vec<CommandOutcome> {
    let mut outputs = vec![String::new(); commands.len()];
    match build(commands, project, aot, &mut outputs) {
        Ok(result) => {
            let with_output = |output| {
                Ok(CommandResult {
                    output,
                    ..result.clone()
                })
            };
            outputs.into_iter().map(with_output).collect()
        }
        Err(why) => commands.iter().map(|_| Err(why.clone())).collect(),
    }
}

fn build(
    commands: &[Command],
    project: &Project,
    aot: &AotOptions,
    outputs: &mut [String],
) -> CommandOutcome {
    static OUTPUT: Once = Once::new();
    OUTPUT.call_once(bun_core::output::stdio::init);
    let bytes_of = |path: &Path| path.as_os_str().as_encoded_bytes().to_vec();
    let entry_points: Vec<Vec<u8>> = project
        .entry_points
        .iter()
        .map(|path| bytes_of(path))
        .collect();
    let entry_points: Vec<&[u8]> = entry_points.iter().map(Vec::as_slice).collect();
    let working_directory = bytes_of(&project.working_directory);
    let inputs = FrontEndInputs {
        working_directory: &working_directory,
        entry_points: &entry_points,
        options: aot,
        typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
    };
    let mut log = Log::init();
    let linked = with_front_end_inputs(&inputs, &mut log, |options, services, log| {
        link_program(options, services, log)
    });
    let Some(linked) = linked else {
        let mut result = create_command_result(&log, &Statistics::default());
        result.places = find_places(&log, &project.root);
        return Ok(result);
    };
    let linked = match linked {
        Ok(linked) => linked,
        Err(failed) => {
            let mut outcome = failed_build_outcome(&log, &failed);
            if let Ok(result) = &mut outcome {
                result.places = find_places(&log, &project.root);
            }
            return outcome;
        }
    };
    let mut result = create_command_result(&log, &linked.summary.statistics);
    result.places = find_places(&log, &project.root);
    let mut program = linked.program;
    for (command, output) in commands.iter().zip(outputs) {
        *output = command(&program);
    }
    let text = print_program_held_to_engine(&program);
    let functions = LinkedFunctions::of_program_functions(take(&mut program.functions));
    let bytes = emit_with_bodies_in_bytes(&mut program, functions, &run_serially)
        .map_err(|error| format!("emit failed: {error:?}"))?;
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
            result.places.resize(result.diagnostics.len(), None);
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

fn find_end_of_item(text: &str) -> usize {
    let mut depth = 0usize;
    let mut is_quoted = false;
    let mut bytes = text.bytes().enumerate();
    while let Some((index, byte)) = bytes.next() {
        match byte {
            b'\\' if is_quoted => {
                bytes.next();
            }
            b'"' => is_quoted = !is_quoted,
            _ if is_quoted => {}
            b'<' | b'[' | b'(' | b'{' => depth += 1,
            b'>' | b']' | b')' | b'}' | b',' | b' ' if depth == 0 => return index,
            b'>' | b']' | b')' | b'}' => depth -= 1,
            _ => {}
        }
    }
    text.len()
}

fn split_at_fields(line: &str) -> Option<(&str, Vec<&str>, &str)> {
    const LIST: &str = " fields=[";
    let start = line.find(LIST).filter(|_| line.starts_with("layout "))?;
    let mut rest = &line[start + LIST.len()..];
    let mut fields = Vec::new();
    while rest.starts_with('{') {
        let (field, behind) = rest.split_at(find_end_of_item(rest));
        fields.push(field);
        rest = behind.strip_prefix(", ").unwrap_or(behind);
    }
    Some((&line[..start], fields, rest.strip_prefix(']')?))
}

fn remove_inherited_fields(engine_line: &str, front_end_line: &str) -> String {
    let Some((head, fields, rest)) = split_at_fields(engine_line) else {
        return engine_line.to_owned();
    };
    let own_count = split_at_fields(front_end_line).map_or(0, |(_, fields, _)| fields.len());
    let (own, inherited) = fields.split_at(own_count.min(fields.len()));
    if !(inherited.iter()).all(|field| field.contains(" originLayout=L")) {
        return engine_line.to_owned();
    }
    if own.is_empty() {
        return format!("{head}{rest}");
    }
    format!("{head} fields=[{}]{rest}", own.join(", "))
}

fn remove_expectations_of_fields(line: &str) -> String {
    match line.starts_with("layout ") {
        true => (line.replace(" flags=[IsExpected]", "")).replace("IsExpected, ", ""),
        false => line.to_owned(),
    }
}

fn is_same_line(engine_line: &str, front_end_line: &str) -> bool {
    let engine_line = remove_inherited_fields(engine_line, front_end_line);
    let engine_line = remove_expectations_of_fields(&engine_line);
    let front_end_line = &remove_expectations_of_fields(front_end_line);
    let mut parts = front_end_line.split(REWRITTEN_TYPE);
    let first = parts.next().unwrap_or_default();
    let Some(mut rest) = engine_line.strip_prefix(first) else {
        return false;
    };
    for part in parts {
        match rest[find_end_of_item(rest)..].strip_prefix(part) {
            Some(behind) => rest = behind,
            None => return false,
        }
    }
    rest.is_empty()
}

fn find_first_difference(engine_text: &str, front_end_text: &str) -> Option<String> {
    let mut engine_lines = engine_text.lines();
    let mut front_end_lines = front_end_text.lines();
    let mut number = 1;
    loop {
        let engine_line = engine_lines.next();
        let front_end_line = front_end_lines.next();
        let is_same = match (engine_line, front_end_line) {
            (Some(engine_line), Some(front_end_line)) => is_same_line(engine_line, front_end_line),
            (engine_line, front_end_line) => engine_line == front_end_line,
        };
        if !is_same {
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
        }
    }

    fn check_with_tool(testaot: Option<&str>, front_end_text: &str) -> CommandOutcome {
        let result = CommandResult {
            output: "function f0\n".to_owned(),
            ..CommandResult::default()
        };
        check_with_engine(testaot.map(OsStr::new), b"", front_end_text, result)
    }

    fn parse(words: &[&str]) -> Result<(bool, u32), TestFailure> {
        let words = words.iter().zip(1..).map(|(word, line)| OptionWord {
            word: (*word).to_owned(),
            line,
        });
        let aot = parse_option_words(&words.collect::<Vec<_>>())?;
        let thread_count = aot.thread_count.map_or(0, NonZeroU32::get);
        Ok((aot.erases_types, thread_count))
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
        assert_eq!(parse(&[]), Ok((false, 1)));
        let listed = ["erase-types", "threads=4"];
        assert_eq!(parse(&listed), Ok((true, 4)));
        let listed = ["threads=4", "threads=2"];
        assert_eq!(parse(&listed), Ok((false, 2)));
    }

    #[test]
    fn unknown_words() {
        for word in [
            "nonsense",
            "erase-types=1",
            "threads",
            "threads=",
            "threads=0",
            "threads=+1",
            "threads=many",
            "threads=4294967296",
            "symbols",
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
            (
                "v1 = Convert v0 declared={type=Map<string, \"a> b\"|L2> flags=[A]} @1\n",
                "v1 = Convert v0 declared={type=\u{2026} flags=[A]} @1\n",
                None,
            ),
            (
                "b0(v0: anything, v1: L1|L2):\n",
                "b0(v0: \u{2026}, v1: \u{2026}):\n",
                None,
            ),
            (
                "v1 = TypeTest v0 testedType=L1 @1\n",
                "v1 = TypeTest v0 testedType=\u{2026} @2\n",
                Some(
                    "line 1: the engine prints v1 = TypeTest v0 testedType=L1 @1, the front end v1 = TypeTest v0 testedType=\u{2026} @2",
                ),
            ),
            (
                "layout L1 base=L0 fields=[{key=\"b\" declared={type=number} originLayout=L0 originField=1}, {key=\"a\" declared={type=number} originLayout=L0 originField=0}] supertypes=[L0]\n",
                "layout L1 base=L0 fields=[{key=\"b\" declared={type=number} originLayout=L0 originField=1}] supertypes=[L0]\n",
                None,
            ),
            (
                "layout L1 base=L0 fields=[{key=\"a\" declared={type=number} originLayout=L0 originField=0}] supertypes=[L0]\n",
                "layout L1 base=L0 supertypes=[L0]\n",
                None,
            ),
        ] {
            let difference = find_first_difference(engine_text, front_end_text);
            assert_eq!(difference.as_deref(), expected);
        }
    }
}
