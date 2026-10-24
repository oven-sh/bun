use super::*;
use RequestOrigin::{BuildApi, BuildFlag, CompileCommand};

fn executable<'a>() -> CompileFlags<'a> {
    CompileFlags {
        is_executable: true,
        ..Default::default()
    }
}

fn compiled<'a>() -> CompileFlags<'a> {
    CompileFlags {
        aot: true,
        ..executable()
    }
}

fn names(list: &[&'static str]) -> Vec<&'static [u8]> {
    list.iter().map(|name| name.as_bytes()).collect()
}

fn word(key: &'static str, value: &'static str) -> (&'static str, Option<&'static [u8]>) {
    (key, Some(value.as_bytes()))
}

fn text(error: &OptionError<'_>, origin: RequestOrigin) -> String {
    let mut message = Vec::new();
    error.write_message(origin, &mut message);
    String::from_utf8(message).unwrap()
}

fn rejected<'a>(flags: CompileFlags<'a>) -> OptionError<'a> {
    resolve(&flags).err().expect("the flags are rejected")
}

fn aot_options(flags: CompileFlags<'_>) -> Box<AotOptions> {
    resolve(&flags)
        .ok()
        .expect("accepted")
        .aot
        .expect("compiled ahead of time")
}

fn assert_messages(flags: CompileFlags<'_>, command_line: &str, api: &str) {
    let error = rejected(flags);
    assert_eq!(text(&error, BuildFlag), command_line);
    assert_eq!(text(&error, BuildApi), api);
}

#[test]
fn both_aot_and_no_aot_comes_first() {
    let flags = CompileFlags {
        aot: true,
        no_aot: true,
        ..Default::default()
    };
    assert_eq!(
        text(&rejected(flags), CompileCommand),
        "Cannot use both --aot and --no-aot"
    );
}

#[test]
fn rejects_options_without_executable() {
    assert_messages(
        CompileFlags {
            aot: true,
            ..Default::default()
        },
        "--aot requires --compile",
        "compile.aot requires compile",
    );
    let trim = TrimFlags {
        removes_unused: true,
        ..Default::default()
    };
    assert_messages(
        CompileFlags {
            trim,
            ..Default::default()
        },
        "--trim requires --compile",
        "compile.trim requires compile",
    );
    let trim = TrimFlags {
        locales: Some(names(&["en"])),
        ..Default::default()
    };
    assert_messages(
        CompileFlags {
            trim,
            ..Default::default()
        },
        "--trim requires --compile",
        "compile.trim requires compile",
    );
    let trim = TrimFlags {
        allow: names(&["sqlite"]),
        ..Default::default()
    };
    assert_messages(
        CompileFlags {
            trim,
            ..Default::default()
        },
        "--trim requires --compile",
        "compile.trim requires compile",
    );
    let trim = TrimFlags {
        remove_internal: names(&["Sqlite"]),
        ..Default::default()
    };
    assert_messages(
        CompileFlags {
            trim,
            ..Default::default()
        },
        "--trim-without requires --compile",
        "--trim-without requires --compile",
    );
}

#[test]
fn rejects_options_without_aot() {
    assert_messages(
        CompileFlags {
            logs_type_mismatches: true,
            ..executable()
        },
        "--aot-log-type-mismatches requires --aot",
        "compile.aotLogTypeMismatches requires compile.aot: true",
    );
    assert_messages(
        CompileFlags {
            explain: names(&[""]),
            ..executable()
        },
        "--explain requires --aot",
        "compile.aotExplain requires compile.aot: true",
    );
    assert_messages(
        CompileFlags {
            has_huge_heap: true,
            ..executable()
        },
        "--aot-huge-heap requires --aot",
        "--aot-huge-heap requires compile.aot: true",
    );
    assert_messages(
        CompileFlags {
            is_in_place: true,
            ..executable()
        },
        "--compile-in-place requires --aot",
        "--compile-in-place requires compile.aot: true",
    );
    let flags = CompileFlags {
        developer_words: vec![("validate", None), word("limit", "1")],
        ..executable()
    };
    assert_eq!(
        text(&rejected(flags), BuildFlag),
        "--aot-validate requires --aot"
    );
    let flags = CompileFlags {
        developer_words: vec![("no-builtin-modules", None)],
        ..executable()
    };
    assert_eq!(
        text(&rejected(flags), BuildFlag),
        "--no-builtin-modules requires --aot"
    );
}

#[test]
fn cross_compile_error_uses_request_origin() {
    let reason = "can't cross-compile. It only builds for the platform it runs on";
    let error = rejected(CompileFlags {
        is_cross_compile: true,
        ..compiled()
    });
    assert_eq!(text(&error, BuildFlag), format!("--aot {reason}"));
    assert_eq!(text(&error, BuildApi), format!("compile.aot {reason}"));
    assert_eq!(
        text(&error, CompileCommand),
        format!(
            "bun compile {reason}\nnote: run this on the target platform, or pass --no-aot to bundle your code with the Bun runtime instead, like bun build --compile"
        )
    );
}

#[test]
fn plain_aot_build_has_default_options() {
    let settings = resolve(&compiled()).ok().expect("accepted");
    let options = settings.aot.expect("compiled ahead of time");
    assert_eq!(options.heap, HeapSize::Standard);
    assert!(options.embeds_function_source);
    assert!(options.explain.is_empty());
    assert!(!options.trim.is_enabled());
    assert!(
        !options.reports_type_mismatches
            && !options.erases_types
            && !options.emits_symbols
            && !options.runs_in_place
    );
    assert!(!options.omits_builtin_modules);
    assert!(!options.obfuscates && !options.forbids_text_evaluation && !options.admits_inspector);
    assert!(options.ir_output_path.is_none());
    assert!(options.build_report.is_none());
    assert!(options.thread_count.is_none());
    assert!(options.option_words.is_empty());
}

#[test]
fn omits_function_source_needs_no_aot() {
    let settings = resolve(&CompileFlags {
        omits_function_source: true,
        ..executable()
    })
    .ok()
    .expect("accepted");
    assert!(settings.aot.is_none());
    let settings = resolve(&CompileFlags {
        omits_function_source: true,
        ..compiled()
    })
    .ok()
    .expect("accepted");
    assert!(
        !settings
            .aot
            .expect("compiled ahead of time")
            .embeds_function_source
    );
}

#[test]
fn type_mismatches_are_logged_on_request() {
    assert!(!aot_options(compiled()).reports_type_mismatches);
    assert!(
        aot_options(CompileFlags {
            logs_type_mismatches: true,
            ..compiled()
        })
        .reports_type_mismatches
    );
}

#[test]
fn explain_values_accumulate() {
    assert_eq!(
        explain_set(&[b"".as_slice(), b"guards"]).ok(),
        Some(ExplainSet::TEXT | ExplainSet::CHECKS)
    );
    assert_eq!(
        explain_set(&[b"guards-json".as_slice(), b"trim"]).ok(),
        Some(ExplainSet::CHECKS_JSON | ExplainSet::RUNTIME_USE)
    );
    assert_eq!(
        explain_set(&[b"missed-optimizations".as_slice(), b"allocations"]).ok(),
        Some(ExplainSet::DECLINES | ExplainSet::ALLOCATIONS)
    );
    assert_eq!(
        explain_set(&[b"text".as_slice(), b""]).ok(),
        Some(ExplainSet::TEXT)
    );
    assert_eq!(
        explain_set(&[b"mutation".as_slice()]).ok(),
        Some(ExplainSet::ONLY_MUTATION)
    );
    assert_eq!(
        explain_set(&[b"statistics".as_slice()]).ok(),
        Some(ExplainSet::STATISTICS)
    );
    assert_eq!(explain_set(&[]).ok(), Some(ExplainSet::empty()));
    for value in [
        "nonsense",
        "throws",
        "throws-json",
        "runtime-use",
        "declines",
    ] {
        let error = explain_set(&[value.as_bytes()]).err().expect("rejected");
        assert_eq!(
            text(&error, CompileCommand),
            format!(
                "Invalid value for --explain: \"{value}\". Must be one of text, json, guards, guards-json, trim, missed-optimizations, allocations, statistics"
            )
        );
    }
}

#[test]
fn explain_limit_is_family() {
    assert_eq!(
        explain_set(&[b"limit".as_slice()]).ok(),
        Some(ExplainSet::ONLY_LIMIT)
    );
    assert_eq!(
        explain_set(&[b"limit".as_slice(), b"mutation"]).ok(),
        Some(ExplainSet::ONLY_LIMIT | ExplainSet::ONLY_MUTATION)
    );
    assert_eq!(
        aot_options(CompileFlags {
            explain: names(&["limit"]),
            ..compiled()
        })
        .explain,
        ExplainSet::ONLY_LIMIT
    );
}

#[test]
fn developer_members() {
    let flags = CompileFlags {
        developer_words: vec![
            word("references", "wide"),
            word("threads", "3"),
            ("erase-types", None),
            word("out", "ir.txt"),
            ("symbols", None),
            ("no-builtin-modules", None),
        ],
        ..compiled()
    };
    let options = resolve(&flags)
        .ok()
        .expect("accepted")
        .aot
        .expect("compiled ahead of time");
    assert_eq!(options.heap, HeapSize::Huge);
    assert_eq!(options.thread_count.map(NonZeroU32::get), Some(3));
    assert!(options.erases_types && options.emits_symbols && options.omits_builtin_modules);
    assert_eq!(
        options.ir_output_path.as_deref(),
        Some(b"ir.txt".as_slice())
    );
    assert!(options.option_words.is_empty());

    let flags = CompileFlags {
        has_huge_heap: true,
        developer_words: vec![word("references", "narrow")],
        ..compiled()
    };
    assert_eq!(
        resolve(&flags)
            .ok()
            .expect("accepted")
            .aot
            .expect("compiled ahead of time")
            .heap,
        HeapSize::Huge
    );

    let flags = CompileFlags {
        developer_words: vec![word("references", "medium")],
        ..compiled()
    };
    assert_eq!(
        text(&rejected(flags), BuildFlag),
        "Invalid value for --aot-references: \"medium\". Must be one of narrow, wide"
    );
    for count in ["many", "0", "-1", ""] {
        let flags = CompileFlags {
            developer_words: vec![word("threads", count)],
            ..compiled()
        };
        assert_eq!(
            text(&rejected(flags), BuildFlag),
            format!(
                "Invalid value for --aot-threads: \"{count}\". Must be a whole number above zero"
            )
        );
    }
}

#[test]
fn developer_flags_are_build_parameters() {
    for &(key, name, form) in DEVELOPER_FLAGS {
        assert_eq!(developer_flag_name(key), name);
        let long = name.strip_prefix("--").expect("a long flag").as_bytes();
        let param = BUILD_ONLY_PARAMS
            .iter()
            .find(|param| param.names.long == Some(long))
            .expect(name);
        let takes_value = match form {
            Form::Flag => clap::Values::None,
            Form::One => clap::Values::One,
            Form::Many => clap::Values::Many,
        };
        assert!(param.takes_value == takes_value, "{name}");
    }
}

#[test]
fn option_word_spelling() {
    assert_eq!(option_word("validate", None), b"validate");
    assert_eq!(option_word("limit", Some(b"9")), b"limit=9");
    assert_eq!(
        option_word("verify-each-pass", None),
        b"check=verify-each-pass"
    );
}

#[test]
fn remaining_messages() {
    let error = OptionError::DeveloperWord {
        word: b"limit=x".to_vec(),
        sentence: b"not a number".to_vec(),
    };
    assert_eq!(text(&error, BuildFlag), "--aot-limit=x: not a number");
    let error = OptionError::Requires {
        option: OptionName::CodeGenerationFromStrings,
        needed: OptionName::Compile,
    };
    assert_eq!(
        text(&error, BuildFlag),
        "--disallow-code-generation-from-strings requires --compile"
    );
    let error = OptionError::InvalidValue {
        option: OptionName::List,
        value: b"passes",
        allowed: "registry",
    };
    assert_eq!(
        text(&error, CompileCommand),
        "Invalid value for --aot-list: \"passes\". Must be registry"
    );
}

#[test]
fn code_generation_flag_precedes_exec_argv() {
    assert_eq!(
        prepend_code_generation_flag(b"", b"")
            .ok()
            .expect("accepted"),
        b"--disallow-code-generation-from-strings"
    );
    assert_eq!(
        prepend_code_generation_flag(b"strict", b"--smol")
            .ok()
            .expect("accepted"),
        b"--disallow-code-generation-from-strings=strict --smol"
    );
    let error = prepend_code_generation_flag(b"strcit", b"")
        .err()
        .expect("rejected");
    assert_eq!(
        text(&error, BuildFlag),
        "Invalid value for --disallow-code-generation-from-strings: \"strcit\". Must be \"strict\", or no value"
    );
}

#[test]
fn code_generation_follows_executable_startup() {
    let cases: [(&[u8], bool); 10] = [
        (b"", false),
        (b"--smol", false),
        (b"--disallow-code-generation-from-strings", true),
        (b"--disallow-code-generation-from-strings=strict", true),
        (b"--smol --disallow-code-generation-from-strings", true),
        (b"--title --disallow-code-generation-from-strings", false),
        (b"--title=--disallow-code-generation-from-strings", false),
        (b"app.ts --disallow-code-generation-from-strings", false),
        (b"--disallow-code-generation-from-strings 'strict'", false),
        (b"--disallow-code-generation-from-stringsx", false),
    ];
    for (exec_argv, is_disallowed) in cases {
        assert_eq!(
            disallows_code_generation_from_strings(exec_argv),
            is_disallowed,
            "{}",
            String::from_utf8_lossy(exec_argv)
        );
    }
}

fn assert_flag_message(group: &FlagGroup, name: &'static [u8], expected: &str) {
    let flag = clap::UnknownLongFlag {
        name,
        is_from_bun_options: false,
    };
    let message = unknown_flag_message(group, &flag).expect("rejected");
    assert_eq!(String::from_utf8(message).unwrap(), expected);
}

#[test]
fn build_unknown_flags() {
    let all = "The --aot flags for this command are --aot, --aot-allow-code-from-disk, --aot-huge-heap, --aot-log-type-mismatches";
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-log-type-mismatch",
        &format!(
            "unknown flag --aot-log-type-mismatch. Did you mean --aot-log-type-mismatches? {all}"
        ),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-log-mismatches",
        &format!("unknown flag --aot-log-mismatches. {all}"),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-type-errors",
        &format!("unknown flag --aot-type-errors. {all}"),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-audit",
        &format!("unknown flag --aot-audit. {all}"),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aott",
        &format!("unknown flag --aott. Did you mean --aot? {all}"),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-",
        &format!("unknown flag --aot-. Did you mean --aot? {all}"),
    );
    assert_flag_message(
        &BUILD_FLAGS,
        b"aot-graph-fd",
        &format!("--aot-graph-fd is only valid with bun run and bun test. {all}"),
    );
}

#[test]
fn run_unknown_flags() {
    let all = "The --aot flags for this command are --aot, --aot-log-type-mismatches";
    assert_flag_message(
        &RUN_FLAGS,
        b"aot-log-type-mismatch",
        &format!(
            "unknown flag --aot-log-type-mismatch. Did you mean --aot-log-type-mismatches? {all}"
        ),
    );
    assert_flag_message(
        &RUN_FLAGS,
        b"aot-audit",
        &format!("unknown flag --aot-audit. {all}"),
    );
    assert_flag_message(
        &RUN_FLAGS,
        b"aot-validate",
        &format!("--aot-validate is only valid with bun build. {all}"),
    );
    assert_flag_message(
        &RUN_FLAGS,
        b"aott",
        &format!("unknown flag --aott. Did you mean --aot? {all}"),
    );
    assert_flag_message(
        &RUN_FLAGS,
        b"aot-nothing-like-it",
        &format!("unknown flag --aot-nothing-like-it. {all}"),
    );
}

#[test]
fn flags_from_bun_options() {
    let other_command = clap::UnknownLongFlag {
        name: b"aot-graph-fd",
        is_from_bun_options: true,
    };
    assert!(unknown_flag_message(&BUILD_FLAGS, &other_command).is_none());
    let no_command = clap::UnknownLongFlag {
        name: b"aott",
        is_from_bun_options: true,
    };
    assert!(unknown_flag_message(&RUN_FLAGS, &no_command).is_some());
    let other_name = clap::UnknownLongFlag {
        name: b"never-a-flag",
        is_from_bun_options: false,
    };
    assert!(unknown_flag_message(&RUN_FLAGS, &other_name).is_none());
}

#[test]
fn suggestions_for_compile_keys() {
    assert_eq!(
        suggest(b"aotLogTypeMismatch", COMPILE_AOT_KEYS),
        Some("aotLogTypeMismatches")
    );
    assert_eq!(
        suggest(b"aotExplains", COMPILE_AOT_KEYS),
        Some("aotExplain")
    );
    assert_eq!(suggest(b"aott", COMPILE_AOT_KEYS), Some("aot"));
    assert_eq!(
        suggest(b"aot_log_type_mismatches", COMPILE_AOT_KEYS),
        Some("aotLogTypeMismatches")
    );
    assert_eq!(suggest(b"aotTypeErrors", COMPILE_AOT_KEYS), None);
    assert_eq!(suggest(b"aotSomethingElse", COMPILE_AOT_KEYS), None);
    assert_eq!(suggest(b"aot-nothing-like-it", BUILD_FLAGS.flags), None);
}

#[test]
fn misplaced_keys() {
    let all = "Options that start with \"aot\": aot, aotExplain, aotLogTypeMismatches";
    let error = misplaced_key(b"aott", true).expect("rejected");
    assert_eq!(
        text(&error, BuildApi),
        format!("compile.aott is not a valid option. Did you mean compile.aot? {all}")
    );
    let error = misplaced_key(b"aotSomethingElse", true).expect("rejected");
    assert_eq!(
        text(&error, BuildApi),
        format!("compile.aotSomethingElse is not a valid option. {all}")
    );
    let error = misplaced_key(b"aotExplain", false).expect("rejected");
    assert_eq!(
        text(&error, BuildApi),
        "\"aotExplain\" goes inside compile. Write compile: { aotExplain: ... }"
    );
    assert!(misplaced_key(b"aot", true).is_none());
    assert!(misplaced_key(b"outfile", true).is_none());
    assert!(misplaced_key(b"aott", false).is_none());
    assert!(misplaced_key(b"entrypoints", false).is_none());
}

#[test]
fn unknown_trim_names() {
    let trim = TrimFlags {
        allow: names(&["no-such-feature"]),
        ..Default::default()
    };
    let error = rejected(CompileFlags {
        trim,
        ..executable()
    });
    assert!(matches!(
        error,
        OptionError::Trim(TrimError::Request(TrimRequestError::UnknownName(_)))
    ));

    let trim = TrimFlags {
        allow: names(&["nothing", "nobody", "nowhere", "nothing"]),
        ..Default::default()
    };
    match rejected(CompileFlags {
        trim,
        ..executable()
    }) {
        OptionError::Trim(TrimError::Request(TrimRequestError::UnknownNames(names))) => {
            assert_eq!(names.len(), 3)
        }
        _ => panic!("expected three unknown names"),
    }

    let trim = TrimFlags {
        remove_internal: names(&["NoSuchFeature"]),
        ..Default::default()
    };
    let error = rejected(CompileFlags {
        trim,
        ..executable()
    });
    assert!(matches!(
        error,
        OptionError::Trim(TrimError::Request(TrimRequestError::UnknownName(_)))
    ));

    let trim = TrimFlags {
        remove: names(&["no-such-feature"]),
        ..Default::default()
    };
    let error = rejected(CompileFlags {
        trim,
        ..executable()
    });
    assert!(matches!(
        error,
        OptionError::Trim(TrimError::Request(TrimRequestError::UnknownName(_)))
    ));
}

#[test]
fn trim_name_in_both_lists() {
    let trim = TrimFlags {
        allow: names(&["ffi", "sqlite"]),
        remove: names(&["sqlite"]),
        ..Default::default()
    };
    let error = rejected(CompileFlags {
        trim,
        ..executable()
    });
    assert!(matches!(
        error,
        OptionError::Trim(TrimError::Request(TrimRequestError::AllowedAndRemoved(
            TrimFeature::Sqlite
        )))
    ));
}

#[test]
fn trim_request_destination() {
    let trim = TrimFlags {
        removes_unused: true,
        ..Default::default()
    };
    let settings = resolve(&CompileFlags { trim, ..compiled() })
        .ok()
        .expect("accepted");
    assert!(
        settings
            .aot
            .expect("compiled ahead of time")
            .trim
            .is_enabled()
    );
    assert!(!settings.trim.is_enabled());

    let trim = TrimFlags {
        removes_unused: true,
        ..Default::default()
    };
    let settings = resolve(&CompileFlags {
        trim,
        ..executable()
    })
    .ok()
    .expect("accepted");
    assert!(settings.aot.is_none());
    assert!(settings.trim.is_enabled());
}

#[test]
fn exec_argv_sets_inspector_and_forbidden_code() {
    let read = |exec_argv: &'static [u8]| {
        let options = aot_options(CompileFlags {
            exec_argv,
            ..compiled()
        });
        (options.forbids_text_evaluation, options.admits_inspector)
    };
    assert_eq!(read(b""), (false, false));
    assert_eq!(read(b"--smol --max-old-space-size=4096"), (false, false));
    assert_eq!(
        read(b"--disallow-code-generation-from-strings"),
        (true, false)
    );
    assert_eq!(read(b"--inspect"), (false, true));
    assert_eq!(read(b"--preload ./a.ts"), (false, false));
    assert_eq!(read(b"--title --inspect"), (false, false));
    assert_eq!(
        read(b"--disallow-code-generation-from-strings=strict --inspect-brk -r ./a.ts"),
        (true, true)
    );
}

#[test]
fn inspector_comes_from_its_option_or_exec_argv() {
    let read = |admits_inspector: bool, exec_argv: &'static [u8]| {
        aot_options(CompileFlags {
            admits_inspector,
            exec_argv,
            ..compiled()
        })
        .admits_inspector
    };
    assert!(!read(false, b""));
    assert!(read(true, b""));
    assert!(read(false, b"--inspect-wait"));
    assert!(read(true, b"--inspect"));
    assert!(read(true, b"--preload ./a.ts"));
    assert!(!read(false, b"--preload ./a.ts"));
}

#[test]
fn inspector_requires_aot() {
    assert_messages(
        CompileFlags {
            admits_inspector: true,
            ..executable()
        },
        "--compile-inspector requires --aot",
        "compile.inspector requires compile.aot: true",
    );
}

#[test]
fn code_from_disk_requires_aot() {
    assert_messages(
        CompileFlags {
            allows_code_from_disk: true,
            ..executable()
        },
        "--aot-allow-code-from-disk requires --aot",
        "compile.allowCodeFromDisk requires compile.aot: true",
    );
}

#[test]
fn code_from_disk_is_loaded_only_where_it_is_asked_for() {
    let loads = |allows_code_from_disk, developer_words| {
        let flags = CompileFlags {
            aot: true,
            allows_code_from_disk,
            developer_words,
            ..executable()
        };
        let Ok(settings) = resolve(&flags) else {
            panic!("the flags are valid");
        };
        settings.aot.unwrap().loads_code_from_disk
    };
    assert!(!loads(false, vec![]));
    assert!(!loads(false, vec![("refuse-code-from-disk", None)]));
    if !cfg!(bun_hardened) {
        assert!(loads(true, vec![]));
        assert!(!loads(true, vec![("refuse-code-from-disk", None)]));
    }
}

#[test]
fn build_without_function_source_embeds_no_option_that_loads_code() {
    let reason = "because the executable only runs code that was compiled into it";
    let loading: [(&[u8], &str); 5] = [
        (b"--preload ./a.ts", "--preload"),
        (b"--smol -r ./a.ts", "--preload"),
        (b"--import ./a.ts --hot", "--import"),
        (b"-e 1", "--eval"),
        (b"--watch", "--watch"),
    ];
    for (exec_argv, label) in loading {
        assert_messages(
            CompileFlags {
                omits_function_source: true,
                exec_argv,
                ..compiled()
            },
            &format!(
                "--no-compile-function-source does not support {label} in --compile-exec-argv {reason}"
            ),
            &format!(
                "compile.functionSource: false does not support {label} in compile.execArgv {reason}"
            ),
        );
        assert_messages(
            CompileFlags {
                omits_function_source: true,
                obfuscates: true,
                exec_argv,
                ..compiled()
            },
            &format!(
                "--no-compile-function-source does not support {label} in --compile-exec-argv {reason}"
            ),
            &format!(
                "compile.functionSource: false does not support {label} in compile.execArgv {reason}"
            ),
        );
        assert_messages(
            CompileFlags {
                obfuscates: true,
                exec_argv,
                ..compiled()
            },
            &format!("--obfuscate does not support {label} in --compile-exec-argv {reason}"),
            &format!("compile.obfuscate does not support {label} in compile.execArgv {reason}"),
        );
        assert!(
            aot_options(CompileFlags {
                exec_argv,
                ..compiled()
            })
            .embeds_function_source
        );
        assert!(
            resolve(&CompileFlags {
                omits_function_source: true,
                exec_argv,
                ..executable()
            })
            .is_ok()
        );
    }
    let loading_nothing: [&[u8]; 5] = [
        b"",
        b"--smol",
        b"--inspect",
        b"--title --preload",
        b"app.ts --preload ./a.ts",
    ];
    for exec_argv in loading_nothing {
        assert!(
            !aot_options(CompileFlags {
                omits_function_source: true,
                exec_argv,
                ..compiled()
            })
            .embeds_function_source
        );
    }
}

#[test]
fn exec_argv_is_accepted_whatever_trim_removes() {
    for flags in [compiled(), executable()] {
        let trim = TrimFlags {
            removes_unused: true,
            ..Default::default()
        };
        assert!(
            resolve(&CompileFlags {
                trim,
                exec_argv: b"--smol --help --preload ./a.ts",
                ..flags
            })
            .is_ok()
        );
    }
}

#[test]
fn obfuscate_requires_aot() {
    assert_messages(
        CompileFlags {
            obfuscates: true,
            ..executable()
        },
        "--obfuscate requires --aot",
        "compile.obfuscate requires compile.aot: true",
    );
    assert!(
        aot_options(CompileFlags {
            obfuscates: true,
            ..compiled()
        })
        .obfuscates
    );
}

#[test]
fn obfuscated_build_embeds_no_function_source() {
    assert!(
        !aot_options(CompileFlags {
            obfuscates: true,
            ..compiled()
        })
        .embeds_function_source
    );
    assert!(aot_options(compiled()).embeds_function_source);
}

#[test]
fn report_path_is_kept() {
    let options = aot_options(CompileFlags {
        developer_words: vec![word("report", "out/report.json")],
        ..compiled()
    });
    let expected = BuildReportRequest {
        path: Box::from(&b"out/report.json"[..]),
        detail: ReportDetail::Summary,
    };
    assert_eq!(options.build_report, Some(expected));
    assert!(options.option_words.is_empty());
}

#[test]
fn report_detail_values() {
    for (value, detail) in [
        ("summary", ReportDetail::Summary),
        ("functions", ReportDetail::Functions),
        ("sites", ReportDetail::Sites),
    ] {
        let options = aot_options(CompileFlags {
            developer_words: vec![word("report", "report.json"), word("report-detail", value)],
            ..compiled()
        });
        assert_eq!(
            options.build_report.as_ref().map(|report| report.detail),
            Some(detail),
            "{value}"
        );
    }
    for value in ["all", "Sites", ""] {
        let flags = CompileFlags {
            developer_words: vec![word("report", "report.json"), word("report-detail", value)],
            ..compiled()
        };
        assert_eq!(
            text(&rejected(flags), BuildFlag),
            format!(
                "Invalid value for --aot-report-detail: \"{value}\". Must be one of summary, functions, sites"
            )
        );
    }
}

#[test]
fn report_detail_requires_report() {
    let flags = CompileFlags {
        developer_words: vec![word("report-detail", "sites")],
        ..compiled()
    };
    assert_messages(
        flags,
        "--aot-report-detail requires --aot-report",
        "--aot-report-detail requires --aot-report",
    );
}

#[test]
fn report_is_read_before_report_detail() {
    let position = |key: &str| {
        DEVELOPER_FLAGS
            .iter()
            .position(|(flag_key, ..)| *flag_key == key)
            .expect("a key of DEVELOPER_FLAGS")
    };
    assert!(position("report") < position("report-detail"));
}

#[test]
fn trim_locales_are_split() {
    let lists: [&'static [u8]; 2] = [b"en,de-AT", b"fr"];
    assert_eq!(
        split_at_commas(&lists).collect::<Vec<_>>(),
        names(&["en", "de-AT", "fr"])
    );

    let trim = TrimFlags {
        removes_unused: true,
        locales: Some(names(&["en", "de-AT"])),
        ..Default::default()
    };
    let settings = resolve(&CompileFlags {
        trim,
        ..executable()
    })
    .ok()
    .expect("accepted");
    let expected: Vec<Box<[u8]>> = vec![Box::from(&b"en"[..]), Box::from(&b"de-AT"[..])];
    assert_eq!(settings.trim.locales, Some(expected));
    assert_eq!(
        resolve(&executable()).ok().expect("accepted").trim.locales,
        None
    );
}

#[test]
fn empty_locale_is_rejected() {
    let lists: [&'static [u8]; 1] = [b"en,,fr"];
    let trim = TrimFlags {
        removes_unused: true,
        locales: Some(split_at_commas(&lists).collect()),
        ..Default::default()
    };
    assert_messages(
        CompileFlags {
            trim,
            ..executable()
        },
        "Invalid value for --trim-locales: \"\". Must be a list of locale tags, like en,de-AT",
        "Invalid value for compile.trim.locales: \"\". Must be a list of locale tags, like en,de-AT",
    );
}
