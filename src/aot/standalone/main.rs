#![feature(linkage)]

mod engine_stubs;
#[allow(unreachable_pub, reason = "the ir_tests of bun_aot include this file")]
mod options;

use bun_aot::emit::ProgramBytes;
use bun_aot::ir::print_program;
use bun_aot::{BuildFailed, WithoutServices, emit_program, link_program};
use bun_ast::{Loader, Log};
use bun_core::{Fd, ZBox, strings};
use bun_sys::File;
use options::StandaloneBuild;
use std::ffi::OsString;
use std::process::ExitCode;
use std::sync::atomic::Ordering;

const USAGE: &str = "\
bun-aot compile <entry>.. --aot-out=<file | -> [--text] { flag }

  --aot-out=<file | ->          write the program to this file (-: stdout)
  --text                        write IR text instead of bytes
  --no-builtin-modules          name engine built-ins only, load none of Bun's own modules
  --aot-erase-types             compile with types erased
  --aot-type-errors=throw|log   throw on a type mismatch, or report it
  --aot-threads=<n>             thread count (default: one per core, at most 16)
  --no-compile-function-source  do not embed the source text of functions
  --in-place                    public paths are the real paths, as in bun run --aot
  --conditions=<name>           add a package.json condition (repeatable)
  --main-fields=<a,b>           package.json main fields, in order
  --preserve-symlinks           do not resolve symlinks to their real paths
  --tsconfig-override=<path>    use this tsconfig.json for every file
  --loader=<.ext:name>          loader of a file extension (repeatable)
  --external=<package>          do not compile this package (repeatable)
  --packages=external|bundle    compile no package, or every package
  --root=<dir>                  directory that public paths are relative to
  --no-macros                   do not run macros";

const EXIT_SUCCESS: u8 = 0;
const EXIT_FAILURE: u8 = 1;
const EXIT_USAGE: u8 = 2;

#[derive(Copy, Clone)]
enum FlagShape {
    Switch,
    Value,
}
use FlagShape::{Switch, Value};

#[derive(Copy, Clone)]
enum Flag {
    Output,
    Text,
    NoBuiltinModules,
    EraseTypes,
    TypeErrors,
    Threads,
    NoFunctionSource,
    InPlace,
    Conditions,
    MainFields,
    PreserveSymlinks,
    TsconfigOverride,
    Loader,
    External,
    Packages,
    Root,
    NoMacros,
}

static FLAGS: &[(&str, FlagShape, Flag)] = &[
    ("--aot-out", Value, Flag::Output),
    ("--text", Switch, Flag::Text),
    ("--no-builtin-modules", Switch, Flag::NoBuiltinModules),
    ("--aot-erase-types", Switch, Flag::EraseTypes),
    ("--aot-type-errors", Value, Flag::TypeErrors),
    ("--aot-threads", Value, Flag::Threads),
    (
        "--no-compile-function-source",
        Switch,
        Flag::NoFunctionSource,
    ),
    ("--in-place", Switch, Flag::InPlace),
    ("--conditions", Value, Flag::Conditions),
    ("--main-fields", Value, Flag::MainFields),
    ("--preserve-symlinks", Switch, Flag::PreserveSymlinks),
    ("--tsconfig-override", Value, Flag::TsconfigOverride),
    ("--loader", Value, Flag::Loader),
    ("--external", Value, Flag::External),
    ("--packages", Value, Flag::Packages),
    ("--root", Value, Flag::Root),
    ("--no-macros", Switch, Flag::NoMacros),
];

static BUNDLER_FLAGS: &[&str] = &["--define", "--drop", "--feature", "--env"];

enum Destination {
    Stdout,
    File(Vec<u8>),
}

impl Destination {
    fn name(&self) -> &[u8] {
        match self {
            Destination::Stdout => b"-",
            Destination::File(path) => path,
        }
    }
}

struct Command {
    build: StandaloneBuild,
    destination: Destination,
    is_text: bool,
}

enum ProgramOutput {
    Text(String),
    Bytes(ProgramBytes),
}

impl ProgramOutput {
    fn as_slice(&self) -> &[u8] {
        match self {
            ProgramOutput::Text(text) => text.as_bytes(),
            ProgramOutput::Bytes(bytes) => bytes.as_slice(),
        }
    }
}

fn main() -> ExitCode {
    bun_core::output::stdio::init();
    let _flush = bun_core::output::flush_guard();
    // The stack of the main thread is 8 MB on macOS and Linux.
    bun_sema_standalone::native::set_stack_size(7 << 20);
    bun_core::output::ENABLE_ANSI_COLORS_STDERR.store(false, Ordering::Relaxed);
    ExitCode::from(match decode_arguments(std::env::args_os().skip(1)) {
        Ok(arguments) => run(&arguments),
        Err(message) => {
            write_to_stderr(format!("{message}\n").as_bytes());
            EXIT_USAGE
        }
    })
}

fn decode_arguments(arguments: impl Iterator<Item = OsString>) -> Result<Vec<String>, String> {
    let invalid = |argument: OsString| format!("{argument:?} is not valid UTF-8");
    arguments
        .map(|argument| argument.into_string().map_err(invalid))
        .collect()
}

fn run(arguments: &[String]) -> u8 {
    let Ok(working_directory) = std::env::current_dir() else {
        write_to_stderr(b"bun-aot: cannot read the working directory\n");
        return EXIT_FAILURE;
    };
    let working_directory = working_directory.into_os_string().into_encoded_bytes();
    let command = match parse_command(arguments, working_directory) {
        Ok(command) => command,
        Err(message) => {
            write_to_stderr(format!("{message}\n").as_bytes());
            return EXIT_USAGE;
        }
    };

    let mut log = Log::init();
    let built = build_program(&command, &mut log);
    let mut text = String::new();
    let _ = log.print(&mut text);
    write_to_stderr(text.as_bytes());
    let program = match built {
        Ok(program) => program,
        Err(message) => {
            write_to_stderr(format!("{message}\n").as_bytes());
            return EXIT_FAILURE;
        }
    };

    match write_program(&command.destination, program.as_slice()) {
        Ok(()) => EXIT_SUCCESS,
        Err(error) => {
            let path = command.destination.name();
            let errno = error.name();
            write_to_stderr(&[b"bun-aot: cannot write ", path, b": ", errno, b"\n"].concat());
            EXIT_FAILURE
        }
    }
}

fn write_to_stderr(bytes: &[u8]) {
    let _ = File::from_fd(Fd::stderr()).write_all(bytes);
}

fn parse_command(arguments: &[String], working_directory: Vec<u8>) -> Result<Command, String> {
    let Some((subcommand, arguments)) = arguments.split_first() else {
        return Err(USAGE.to_owned());
    };
    if subcommand != "compile" {
        return Err(USAGE.to_owned());
    }
    let mut build = StandaloneBuild::new(working_directory, Vec::new());
    let mut destination = None;
    let mut is_text = false;
    for argument in arguments {
        if !argument.starts_with('-') {
            build.entry_points.push(argument.as_bytes().to_vec());
            continue;
        }
        let (flag, name, value) = find_flag(argument)?;
        let bytes = value.as_bytes();
        match flag {
            Flag::Output => {
                destination = Some(match value {
                    "-" => Destination::Stdout,
                    _ => Destination::File(bytes.to_vec()),
                });
            }
            Flag::Text => is_text = true,
            Flag::NoBuiltinModules => build.omits_builtin_modules = true,
            Flag::EraseTypes => build.aot.erases_types = true,
            Flag::TypeErrors => {
                let choices = [("throw", false), ("log", true)];
                build.aot.reports_type_mismatches = parse_choice(name, value, choices)?;
            }
            Flag::Threads => {
                let invalid = |_| invalid_value(name, value, "a thread count");
                build.aot.thread_count = Some(value.parse().map_err(invalid)?);
            }
            Flag::NoFunctionSource => build.aot.embeds_function_source = false,
            Flag::InPlace => build.aot.runs_in_place = true,
            Flag::Conditions => build.conditions.push(bytes.to_vec()),
            Flag::MainFields => build.main_fields = parse_main_fields(name, value)?,
            Flag::PreserveSymlinks => build.preserves_symlinks = true,
            Flag::TsconfigOverride => build.tsconfig_override = Some(bytes.to_vec()),
            Flag::Loader => build.loaders.push(parse_loader(name, value)?),
            Flag::External => build.external_packages.push(parse_package_name(name, value)?),
            Flag::Packages => {
                let choices = [("external", true), ("bundle", false)];
                build.are_all_packages_external = parse_choice(name, value, choices)?;
            }
            Flag::Root => build.root_directory = Some(bytes.to_vec()),
            Flag::NoMacros => build.runs_macros = false,
        }
    }
    match destination {
        Some(destination) if !build.entry_points.is_empty() => Ok(Command {
            build,
            destination,
            is_text,
        }),
        _ => Err(USAGE.to_owned()),
    }
}

fn find_flag(argument: &str) -> Result<(Flag, &'static str, &str), String> {
    let (name, value) = match strings::index_of_char_usize(argument.as_bytes(), b'=') {
        Some(equals) => (&argument[..equals], Some(&argument[equals + 1..])),
        None => (argument, None),
    };
    let Some(&(name, shape, flag)) = FLAGS.iter().find(|entry| entry.0 == name) else {
        return Err(describe_unknown_flag(argument, name));
    };
    match (shape, value) {
        (Switch, None) => Ok((flag, name, "")),
        (Switch, Some(_)) => Err(format!("{name} takes no value")),
        (Value, Some(value)) if !value.is_empty() => Ok((flag, name, value)),
        (Value, _) => Err(format!("{name} needs a value: {name}=<value>")),
    }
}

fn describe_unknown_flag(argument: &str, name: &str) -> String {
    if let Some(word) = argument.strip_prefix("--aot-") {
        return format!("{argument} is an option of the engine: pass {word} to testaot");
    }
    if BUNDLER_FLAGS.contains(&name) {
        return format!("{name} needs the bundler's services: use bun compile --aot-out=");
    }
    format!("unknown flag {name}")
}

fn invalid_value(name: &str, value: &str, expected: &str) -> String {
    format!("{name}: {value} is not {expected}")
}

fn parse_choice(name: &str, value: &str, choices: [(&str, bool); 2]) -> Result<bool, String> {
    match choices.iter().find(|choice| choice.0 == value) {
        Some(choice) => Ok(choice.1),
        None => {
            let expected = format!("{} or {}", choices[0].0, choices[1].0);
            Err(invalid_value(name, value, &expected))
        }
    }
}

fn parse_main_fields(name: &str, value: &str) -> Result<Vec<Vec<u8>>, String> {
    let fields: Vec<Vec<u8>> = strings::split(value.as_bytes(), b",")
        .map(<[u8]>::to_vec)
        .collect();
    if fields.iter().any(Vec::is_empty) {
        return Err(invalid_value(name, value, "a comma-separated list of field names"));
    }
    Ok(fields)
}

fn parse_loader(name: &str, value: &str) -> Result<(Vec<u8>, Loader), String> {
    let (extension, loader_name) = match strings::index_of_char_usize(value.as_bytes(), b':') {
        Some(colon) if colon > 1 && value.starts_with('.') => {
            (&value[..colon], &value[colon + 1..])
        }
        _ => return Err(invalid_value(name, value, "an extension and a loader, as in .txt:text")),
    };
    match Loader::from_string(loader_name.as_bytes()) {
        Some(loader) => Ok((extension.as_bytes().to_vec(), loader)),
        None => Err(invalid_value(name, loader_name, "a loader")),
    }
}

fn parse_package_name(name: &str, value: &str) -> Result<Vec<u8>, String> {
    if value.starts_with(['.', '/']) || strings::contains_char(value.as_bytes(), b'*') {
        return Err(invalid_value(name, value, "a package name"));
    }
    Ok(value.as_bytes().to_vec())
}

fn build_program(command: &Command, log: &mut Log) -> Result<ProgramOutput, String> {
    let options = command.build.options();
    let built = if command.is_text {
        link_program(&options, &WithoutServices, log)
            .map(|linked| ProgramOutput::Text(print_program(&linked.program)))
    } else {
        emit_program(&options, &WithoutServices, log)
            .map(|emitted| ProgramOutput::Bytes(emitted.bytes))
    };
    built.map_err(|failed| describe_failure(&failed))
}

fn describe_failure(failed: &BuildFailed) -> String {
    let stage = failed.stage.name();
    let cause = if failed.is_internal_error {
        " (an internal error of the compiler)"
    } else {
        ""
    };
    format!("bun-aot: the build failed in stage {stage}{cause}")
}

fn write_program(destination: &Destination, bytes: &[u8]) -> bun_sys::Maybe<()> {
    match destination {
        Destination::Stdout => File::from_fd(Fd::stdout()).write_all(bytes),
        Destination::File(path) => replace_file(path, bytes),
    }
}

fn replace_file(path: &[u8], bytes: &[u8]) -> bun_sys::Maybe<()> {
    let suffix = format!(".{}.tmp", std::process::id());
    let temporary_path = ZBox::from_bytes(&[path, suffix.as_bytes()].concat());
    let destination_path = ZBox::from_bytes(path);
    let result = File::write_file(Fd::cwd(), &temporary_path, bytes).and_then(|()| {
        bun_sys::renameat(Fd::cwd(), &temporary_path, Fd::cwd(), &destination_path)
    });
    if result.is_err() {
        let _ = bun_sys::unlinkat(Fd::cwd(), &temporary_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::num::NonZeroU32;

    const PREFIX: [&str; 3] = ["compile", "a.ts", "--aot-out=a.bin"];

    fn owned(arguments: &[&str]) -> Vec<String> {
        arguments.iter().map(|&text| text.to_owned()).collect()
    }

    fn parse(flags: &[&str]) -> Result<Command, String> {
        parse_command(&owned(&[&PREFIX[..], flags].concat()), b"/project".to_vec())
    }

    fn accepted(flags: &[&str]) -> Command {
        parse(flags).unwrap_or_else(|message| panic!("{message}"))
    }

    fn rejection(flags: &[&str]) -> String {
        match parse(flags) {
            Ok(_) => panic!("{flags:?} was accepted"),
            Err(message) => message,
        }
    }

    fn byte_strings(texts: &[&str]) -> Vec<Vec<u8>> {
        texts.iter().map(|text| text.as_bytes().to_vec()).collect()
    }

    #[test]
    fn valid_arguments_are_decoded() {
        let arguments = ["compile", "a.ts"].map(OsString::from);
        assert_eq!(
            decode_arguments(arguments.into_iter()),
            Ok(owned(&["compile", "a.ts"]))
        );
    }

    #[cfg(unix)]
    #[test]
    fn invalid_utf8_argument_is_rejected() {
        use std::os::unix::ffi::OsStringExt;
        let arguments = [
            OsString::from("compile"),
            OsString::from_vec(b"\xFF.ts".to_vec()),
        ];
        assert_eq!(
            decode_arguments(arguments.into_iter()),
            Err("\"\\xFF.ts\" is not valid UTF-8".to_owned())
        );
    }

    #[test]
    fn usage_errors_exit_with_2() {
        let command_lines: [&[&str]; 9] = [
            &[],
            &["a.ts", "--aot-out=a.bin"],
            &["build", "a.ts", "--aot-out=a.bin"],
            &["compile", "--aot-out=a.bin"],
            &["compile", "a.ts"],
            &["compile", "a.ts", "--aot-out=a.bin", "--aot-validate"],
            &["compile", "a.ts", "--aot-out=a.bin", "--define=a=1"],
            &["compile", "a.ts", "--aot-out=a.bin", "--nonsense"],
            &["compile", "a.ts", "--aot-out=a.bin", "--aot-threads=x"],
        ];
        for command_line in command_lines {
            assert_eq!(run(&owned(command_line)), EXIT_USAGE, "{command_line:?}");
        }
    }

    #[test]
    fn incomplete_command_lines_print_usage() {
        let command_lines: [&[&str]; 4] = [
            &[],
            &["a.ts", "--aot-out=a.bin"],
            &["compile", "--aot-out=a.bin"],
            &["compile", "a.ts", "--text"],
        ];
        for command_line in command_lines {
            match parse_command(&owned(command_line), b"/project".to_vec()) {
                Ok(_) => panic!("{command_line:?} was accepted"),
                Err(message) => assert_eq!(message, USAGE, "{command_line:?}"),
            }
        }
    }

    #[test]
    fn usage_lists_every_flag() {
        for (name, ..) in FLAGS {
            let line_start = format!("\n  {name}");
            assert!(
                strings::contains(USAGE.as_bytes(), line_start.as_bytes()),
                "{name}"
            );
        }
    }

    #[test]
    fn command_without_flags_keeps_defaults() {
        let command = accepted(&[]);
        let defaults = StandaloneBuild::new(Vec::new(), Vec::new());
        let build = &command.build;
        assert!(matches!(&command.destination, Destination::File(path) if path == b"a.bin"));
        assert!(!command.is_text);
        assert_eq!(build.working_directory, b"/project");
        assert_eq!(build.entry_points, byte_strings(&["a.ts"]));
        assert_eq!(
            build.aot.embeds_function_source,
            defaults.aot.embeds_function_source
        );
        assert_eq!(build.aot.thread_count, defaults.aot.thread_count);
        assert_eq!(build.runs_macros, defaults.runs_macros);
        assert!(!build.aot.erases_types);
        assert!(!build.aot.reports_type_mismatches);
        assert!(!build.aot.runs_in_place);
        assert!(!build.omits_builtin_modules);
        assert!(!build.preserves_symlinks);
        assert!(!build.are_all_packages_external);
        assert!(build.conditions.is_empty());
        assert!(build.main_fields.is_empty());
        assert!(build.loaders.is_empty());
        assert!(build.external_packages.is_empty());
        assert!(build.tsconfig_override.is_none());
        assert!(build.root_directory.is_none());
    }

    #[test]
    fn flags_set_fields() {
        let command = accepted(&[
            "--text",
            "--no-builtin-modules",
            "--aot-erase-types",
            "--aot-type-errors=log",
            "--aot-threads=4",
            "--no-compile-function-source",
            "--in-place",
            "--conditions=worker",
            "--conditions=deno",
            "--main-fields=browser,main",
            "--preserve-symlinks",
            "--tsconfig-override=tsconfig.build.json",
            "--loader=.txt:json",
            "--loader=.foo:text",
            "--external=react",
            "--external=@scope/name",
            "--packages=external",
            "--root=src",
            "--no-macros",
            "lib/b.ts",
        ]);
        let build = &command.build;
        assert!(command.is_text);
        assert_eq!(build.entry_points, byte_strings(&["a.ts", "lib/b.ts"]));
        assert!(build.omits_builtin_modules);
        assert!(build.aot.erases_types);
        assert!(build.aot.reports_type_mismatches);
        assert_eq!(build.aot.thread_count.map(NonZeroU32::get), Some(4));
        assert!(!build.aot.embeds_function_source);
        assert!(build.aot.runs_in_place);
        assert_eq!(build.conditions, byte_strings(&["worker", "deno"]));
        assert_eq!(build.main_fields, byte_strings(&["browser", "main"]));
        assert!(build.preserves_symlinks);
        assert_eq!(
            build.tsconfig_override.as_deref(),
            Some(&b"tsconfig.build.json"[..])
        );
        assert_eq!(
            build.loaders,
            [
                (b".txt".to_vec(), Loader::Json),
                (b".foo".to_vec(), Loader::Text)
            ]
        );
        assert_eq!(
            build.external_packages,
            byte_strings(&["react", "@scope/name"])
        );
        assert!(build.are_all_packages_external);
        assert_eq!(build.root_directory.as_deref(), Some(&b"src"[..]));
        assert!(!build.runs_macros);
    }

    #[test]
    fn last_value_wins() {
        let command = accepted(&[
            "--aot-type-errors=log",
            "--aot-type-errors=throw",
            "--packages=external",
            "--packages=bundle",
            "--aot-threads=4",
            "--aot-threads=2",
            "--main-fields=module",
            "--main-fields=browser,main",
            "--aot-out=-",
        ]);
        assert!(!command.build.aot.reports_type_mismatches);
        assert!(!command.build.are_all_packages_external);
        assert_eq!(command.build.aot.thread_count.map(NonZeroU32::get), Some(2));
        assert_eq!(
            command.build.main_fields,
            byte_strings(&["browser", "main"])
        );
        assert!(matches!(command.destination, Destination::Stdout));
    }

    #[test]
    fn unknown_flags_are_rejected() {
        let cases = [
            (
                "--aot-validate",
                "--aot-validate is an option of the engine: pass validate to testaot",
            ),
            (
                "--aot-check=verify-each-pass",
                "--aot-check=verify-each-pass is an option of the engine: \
                 pass check=verify-each-pass to testaot",
            ),
            (
                "--define",
                "--define needs the bundler's services: use bun compile --aot-out=",
            ),
            (
                "--define=a=1",
                "--define needs the bundler's services: use bun compile --aot-out=",
            ),
            (
                "--drop=console",
                "--drop needs the bundler's services: use bun compile --aot-out=",
            ),
            (
                "--feature=FAST",
                "--feature needs the bundler's services: use bun compile --aot-out=",
            ),
            (
                "--env=inline",
                "--env needs the bundler's services: use bun compile --aot-out=",
            ),
            ("--nonsense", "unknown flag --nonsense"),
            ("--outfile=a", "unknown flag --outfile"),
            ("--defined", "unknown flag --defined"),
            ("-", "unknown flag -"),
        ];
        for (flag, message) in cases {
            assert_eq!(rejection(&[flag]), message);
        }
    }

    #[test]
    fn malformed_values_are_rejected() {
        let cases = [
            ("--aot-threads=x", "--aot-threads: x is not a thread count"),
            ("--aot-threads=0", "--aot-threads: 0 is not a thread count"),
            (
                "--aot-threads=-1",
                "--aot-threads: -1 is not a thread count",
            ),
            (
                "--aot-type-errors=warn",
                "--aot-type-errors: warn is not throw or log",
            ),
            (
                "--packages=all",
                "--packages: all is not external or bundle",
            ),
            ("--loader=.foo:nothing", "--loader: nothing is not a loader"),
            (
                "--loader=js:jsx",
                "--loader: js:jsx is not an extension and a loader, as in .txt:text",
            ),
            (
                "--loader=.:jsx",
                "--loader: .:jsx is not an extension and a loader, as in .txt:text",
            ),
            (
                "--loader=.js",
                "--loader: .js is not an extension and a loader, as in .txt:text",
            ),
            (
                "--main-fields=module,,main",
                "--main-fields: module,,main is not a comma-separated list of field names",
            ),
            (
                "--external=./a.js",
                "--external: ./a.js is not a package name",
            ),
            (
                "--external=/a.js",
                "--external: /a.js is not a package name",
            ),
            (
                "--external=*.png",
                "--external: *.png is not a package name",
            ),
            ("--text=1", "--text takes no value"),
            ("--root", "--root needs a value: --root=<value>"),
            ("--root=", "--root needs a value: --root=<value>"),
            ("--aot-out", "--aot-out needs a value: --aot-out=<value>"),
        ];
        for (flag, message) in cases {
            assert_eq!(rejection(&[flag]), message);
        }
    }
}
