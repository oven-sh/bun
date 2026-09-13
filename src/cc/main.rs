//! `bun-cc`: compile C files to one BIR module.
//!
//! ```text
//! bun-cc input.c [more.c ...] -o out.bir [--target x86_64-linux] [-I dir] [-isystem dir] [-D name[=value]] [-U name]
//! bun-cc input.c --dump
//! bun-cc input.c -E
//! ```

// A standalone command-line tool: it may only depend on std, so it reads files and prints
// with std rather than bun_sys / bun_core::output.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)]

use std::process::ExitCode;

use bun_cc::{CompileOptions, HostFiles, HostFilesAnyCase, Target};

const USAGE: &str = "usage: bun-cc <input.c>... (-o <out.bir> | --dump | -E | --dump-tokens | --emit-dts) [options]
several input files are compiled separately and linked into one module (-E, --dump-tokens and --emit-dts take one)
--emit-dts writes TypeScript declarations for the exported functions, to -o or to standard output
options:
  --target <arch>-<os>   x86_64-linux aarch64-linux x86_64-macos aarch64-macos x86_64-windows aarch64-windows
  -I <dir>               add a directory to the include search path
  -isystem <dir>         add a system include directory
  -nostdinc              do not search the host's default system include directories
  -D <name>[=<value>]    define a macro
  -U <name>              undefine a macro
  -fno-replace-aggregates  keep every local array and structure in memory
  --stats                say how big the module is and what was optimized
  -fgnuc-version=<x.y.z> claim to be GNU C x.y.z (predefines __GNUC__ and friends); 0 = do not";

fn main() -> ExitCode {
    let mut inputs: Vec<String> = Vec::new();
    let mut output: Option<String> = None;
    let mut dump = false;
    let mut dump_tokens = false;
    let mut preprocess_only = false;
    let mut nostdinc = false;
    let mut dump_predefined = false;
    let mut emit_dts = false;
    let mut stats = false;
    let mut target = Target::host();
    let mut include_dirs = Vec::new();
    let mut system_dirs = Vec::new();
    let mut defines = Vec::new();
    let mut undefines = Vec::new();
    let mut gnu_version_flag = None;
    let mut replace_aggregates = true;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        // Options that take a value either attached (`-Idir`) or as the next argument.
        let mut value_of = |flag: &str| -> Option<Option<String>> {
            let rest = arg.strip_prefix(flag)?;
            Some(if rest.is_empty() {
                args.next()
            } else {
                Some(rest.to_string())
            })
        };
        if arg == "-isystem" {
            match args.next() {
                Some(dir) => system_dirs.push(dir),
                None => return usage_error("-isystem needs a directory"),
            }
        } else if let Some(value) = value_of("-I") {
            match value {
                Some(dir) => include_dirs.push(dir),
                None => return usage_error("-I needs a directory"),
            }
        } else if let Some(value) = value_of("-D") {
            let Some(definition) = value else {
                return usage_error("-D needs a macro name");
            };
            let mut name = definition.clone();
            let mut body = None;
            if let Some(eq) = definition.bytes().position(|b| b == 61) {
                name = definition[..eq].to_string();
                body = Some(definition[eq + 1..].to_string());
            }
            defines.push((name, body));
        } else if let Some(value) = value_of("-U") {
            match value {
                Some(name) => undefines.push(name),
                None => return usage_error("-U needs a macro name"),
            }
        } else if let Some(version) = arg.strip_prefix("-fgnuc-version=") {
            match bun_cc::parse_gnu_version(version) {
                Some(parsed) => gnu_version_flag = Some(parsed),
                None => return usage_error("-fgnuc-version needs major[.minor[.patch]], or 0"),
            }
        } else {
            match arg.as_str() {
                "-o" => match args.next() {
                    Some(path) => output = Some(path),
                    None => return usage_error("-o needs a path"),
                },
                "--dump" => dump = true,
                "--dump-tokens" => dump_tokens = true,
                "-E" => preprocess_only = true,
                "-nostdinc" => nostdinc = true,
                "--dump-predefined" => dump_predefined = true,
                "--emit-dts" => emit_dts = true,
                "--stats" => stats = true,
                "-fno-replace-aggregates" => replace_aggregates = false,
                "--target" => match args.next().as_deref().and_then(Target::parse) {
                    Some(t) => target = t,
                    None => return usage_error("--target needs one of the listed targets"),
                },
                "-h" | "--help" => {
                    println!("{USAGE}");
                    return ExitCode::SUCCESS;
                }
                other if other.starts_with('-') => {
                    return usage_error(&format!("unknown option '{other}'"));
                }
                _ => inputs.push(arg),
            }
        }
    }
    let gnu_version = gnu_version_flag.unwrap_or_else(|| CompileOptions::new(target).gnu_version);
    if dump_predefined {
        match gnu_version {
            Some(version) => print!("{}", bun_cc::predefined_macros_as_gnu(target, version)),
            None => print!("{}", bun_cc::predefined_macros(target)),
        }
        return ExitCode::SUCCESS;
    }
    let Some(input) = inputs.first().cloned() else {
        return usage_error("no input file");
    };
    if inputs.len() > 1 && (preprocess_only || dump_tokens || emit_dts) {
        return usage_error("-E, --dump-tokens and --emit-dts take one input file");
    }
    if output.is_none() && !dump && !dump_tokens && !preprocess_only && !emit_dts && !stats {
        return usage_error("nothing to do: pass -o, --dump, -E or --dump-tokens");
    }

    let source = match std::fs::read(&input) {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("bun-cc: cannot read '{input}': {e}");
            return ExitCode::FAILURE;
        }
    };

    if dump_tokens {
        match bun_cc::dump_tokens(&source, &input) {
            Ok(text) => print!("{text}"),
            Err(diagnostics) => return report(&diagnostics),
        }
    }

    if !nostdinc {
        system_dirs.extend(bun_cc::default_system_include_dirs(target));
        if cfg!(windows) && target.os == bun_cc::Os::Windows {
            let variable = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
            let roots: Vec<String> = ["ProgramFiles", "ProgramFiles(x86)"]
                .into_iter()
                .filter_map(variable)
                .collect();
            let roots: Vec<&str> = roots.iter().map(String::as_str).collect();
            system_dirs.extend(bun_cc::msvc_system_include_dirs(
                variable("INCLUDE").as_deref(),
                &roots,
            ));
        }
    }
    let options = CompileOptions {
        target,
        include_dirs,
        system_include_dirs: system_dirs,
        defines,
        undefines,
        gnu_version,
        replace_aggregates,
        // (A Windows SDK copied to another system keeps its spellings.)
        file_provider: if target.os == bun_cc::Os::Windows && !cfg!(windows) {
            &HostFilesAnyCase
        } else {
            &HostFiles
        },
    };

    if emit_dts {
        return match bun_cc::typescript_declarations(&source, &input, &options) {
            Ok(text) => match &output {
                Some(path) => match std::fs::write(path, text) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(e) => {
                        eprintln!("bun-cc: cannot write '{path}': {e}");
                        ExitCode::FAILURE
                    }
                },
                None => {
                    print!("{text}");
                    ExitCode::SUCCESS
                }
            },
            Err(diagnostics) => report(&diagnostics),
        };
    }
    if preprocess_only {
        return match bun_cc::preprocess(&source, &input, &options) {
            Ok(text) => {
                print!("{text}");
                ExitCode::SUCCESS
            }
            Err(diagnostics) => report(&diagnostics),
        };
    }
    if !dump && output.is_none() && !stats {
        return ExitCode::SUCCESS;
    }

    let mut sources = vec![source];
    for path in &inputs[1..] {
        match std::fs::read(path) {
            Ok(bytes) => sources.push(bytes),
            Err(e) => {
                eprintln!("bun-cc: cannot read '{path}': {e}");
                return ExitCode::FAILURE;
            }
        }
    }
    let units: Vec<(&[u8], &str)> = sources
        .iter()
        .zip(&inputs)
        .map(|(source, name)| (source.as_slice(), name.as_str()))
        .collect();
    let compiled = if units.len() == 1 {
        bun_cc::compile_with_warnings(units[0].0, units[0].1, &options)
    } else {
        bun_cc::compile_many(&units, &options)
    };
    let bir = match compiled {
        Ok(output) => {
            for warning in &output.warnings {
                eprintln!("{warning}");
            }
            if stats {
                eprintln!(
                    "bun-cc: {} bytes of BIR; {} local aggregates replaced by their elements; {} loads and {} stores combined from bytes",
                    output.bir.len(),
                    output.replaced_aggregates,
                    output.combined_accesses.0,
                    output.combined_accesses.1
                );
            }
            output.bir
        }
        Err(diagnostics) => return report(&diagnostics),
    };
    if dump {
        match bun_cc::disassemble(&bir) {
            Ok(text) => print!("{text}"),
            Err(e) => {
                eprintln!("bun-cc: {e}");
                return ExitCode::FAILURE;
            }
        }
    }
    if let Some(path) = output {
        if let Err(e) = std::fs::write(&path, &bir) {
            eprintln!("bun-cc: cannot write '{path}': {e}");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}

fn report(diagnostics: &[bun_cc::Diagnostic]) -> ExitCode {
    for d in diagnostics {
        eprintln!("{d}");
    }
    ExitCode::FAILURE
}

fn usage_error(msg: &str) -> ExitCode {
    eprintln!("bun-cc: {msg}\n{USAGE}");
    ExitCode::FAILURE
}
