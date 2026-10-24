use super::*;
use crate::cli::arguments::{AUTO_PARAMS, AUTO_REQUIREMENT_ROWS};

const FEATURE_REMOVED: &str =
    " can't be used with this executable because --trim removed the feature it needs";
const NO_COMMAND_LINE: &str = " can't be used with this executable because it doesn't include the Bun command line. Run bun instead";
const ONLY_COMPILED_CODE: &str = " can't be used with this executable because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag";
const ONLY_CODE_OF_THE_BUILD: &str = " can't be used with this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code";
const IGNORED_WITHOUT_FUNCTION_SOURCE: &str = " is ignored by this executable because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag";
const NO_DEBUGGER: &str =
    " can't be used with this executable. Rebuild it with --compile-inspector";
const DEFAULT_BUILD: BuildRecord = BuildRecord {
    omits_function_source: false,
    admits_inspector: false,
    loads_code_from_disk: false,
};
const WITHOUT_FUNCTION_SOURCE: BuildRecord = BuildRecord {
    omits_function_source: true,
    admits_inspector: false,
    loads_code_from_disk: false,
};
const WITH_INSPECTOR: BuildRecord = BuildRecord {
    omits_function_source: false,
    admits_inspector: true,
    loads_code_from_disk: false,
};
const WITH_INSPECTOR_WITHOUT_FUNCTION_SOURCE: BuildRecord = BuildRecord {
    omits_function_source: true,
    admits_inspector: true,
    loads_code_from_disk: false,
};
const LOADS_CODE_FROM_DISK: BuildRecord = BuildRecord {
    omits_function_source: false,
    admits_inspector: false,
    loads_code_from_disk: true,
};
const DEBUG_ONLY_ROW: RowName = RowName::Long(b"breakpoint-resolve");

fn text(bytes: &[u8]) -> String {
    BStr::new(bytes).to_string()
}

fn message_of(option: &UnusableOption) -> String {
    let mut message = Vec::new();
    option.write_message(&mut message);
    text(&message)
}

fn with_words<R>(options: &str, then: impl FnOnce(&[&[u8]]) -> R) -> R {
    let words = split_option_words(options.as_bytes());
    let words: Vec<&[u8]> = words.iter().map(Vec::as_slice).collect();
    then(&words)
}

fn split(options: &str) -> Vec<String> {
    let words = split_option_words(options.as_bytes());
    words.iter().map(|word| text(word)).collect()
}

fn written_options(options: &str) -> Vec<(String, Option<String>)> {
    with_words(options, |words| {
        let written = walk_option_words(words).into_iter();
        written
            .map(|option| (text(&label_of(option.index)), option.value.map(text)))
            .collect()
    })
}

fn written_labels(options: &str) -> Vec<String> {
    let written = written_options(options).into_iter();
    written.map(|(label, _)| label).collect()
}

fn requirements(options: &str) -> Vec<(RuntimeRequirement, String)> {
    let requirements = read_exec_argv(options.as_bytes()).requirements.into_iter();
    let described = requirements.map(|option| (option.requirement, text(&option.label)));
    described.collect()
}

fn obstacle_without_anything(requirement: RuntimeRequirement) -> Option<Obstacle> {
    find_obstacle(requirement, Some(WITHOUT_FUNCTION_SOURCE), |_| false)
}

fn message_without_anything(options: &str) -> Option<String> {
    let unusable = with_words(options, |words| {
        find_unusable_option(words, obstacle_without_anything)
    });
    unusable.map(|option| message_of(&option))
}

fn message_untrimmed(options: &str, build: Option<BuildRecord>) -> Option<String> {
    let obstacle_to = |requirement| find_obstacle(requirement, build, |_| true);
    let unusable = with_words(options, |words| find_unusable_option(words, obstacle_to));
    unusable.map(|option| message_of(&option))
}

fn names_of_long(name: &[u8]) -> &'static clap::Names {
    &AUTO_PARAMS[index_of_long(AUTO_PARAMS, name)].names
}

#[test]
fn program_that_loads_code_from_disk_takes_options_that_load_code() {
    for omits_function_source in [false, true] {
        let build = BuildRecord {
            omits_function_source,
            ..LOADS_CODE_FROM_DISK
        };
        assert_eq!(build.obstacle_to(RuntimeRequirement::RuntimeCode), None);
        assert!(
            build
                .obstacle_to(RuntimeRequirement::WholeRuntime)
                .is_some()
        );
        assert!(build.obstacle_to(INSPECTOR_REQUIREMENT).is_some());
    }
}

#[test]
fn every_parameter_has_requirement() {
    let params = AUTO_TABLE.params();
    assert_eq!(AUTO_REQUIREMENTS.len(), params.len());
    assert_eq!(AUTO_PARAMS.len(), params.len());
    for (converted, declared) in params.iter().zip(AUTO_PARAMS) {
        assert_eq!(converted.names.long, declared.names.long);
        assert_eq!(converted.names.short, declared.names.short);
    }
}

#[test]
fn every_row_names_parameter() {
    for &(name, requirement) in AUTO_REQUIREMENT_ROWS {
        let params = AUTO_PARAMS.iter().enumerate();
        let named: Vec<usize> = params
            .filter(|(_, param)| row_names_param(name, &param.names))
            .map(|(index, _)| index)
            .collect();
        if name == DEBUG_ONLY_ROW && named.is_empty() {
            continue;
        }
        assert_eq!(named.len(), 1, "{name:?}");
        assert_eq!(AUTO_REQUIREMENTS[named[0]], requirement, "{name:?}");
    }
}

#[test]
fn rows_do_not_repeat() {
    for (index, (name, _)) in AUTO_REQUIREMENT_ROWS.iter().enumerate() {
        let mut earlier = AUTO_REQUIREMENT_ROWS[..index].iter();
        assert!(
            earlier.all(|(earlier_name, _)| earlier_name != name),
            "{name:?}"
        );
    }
}

#[test]
fn row_names_parameter_by_primary_name() {
    let help = names_of_long(b"help");
    assert!(row_names_param(RowName::Long(b"help"), help));
    assert!(!row_names_param(RowName::Long(b"hel"), help));
    assert!(!row_names_param(RowName::Short(b'h'), help));
    assert!(!row_names_param(RowName::Positional, help));

    let is_auto_install = |param: &&ParamType| param.names.short == Some(b'i');
    let auto_install = &AUTO_PARAMS.iter().find(is_auto_install).unwrap().names;
    assert!(row_names_param(RowName::Short(b'i'), auto_install));
    assert!(!row_names_param(RowName::Short(b'h'), auto_install));
    assert!(!row_names_param(RowName::Long(b"i"), auto_install));
    assert!(!row_names_param(RowName::Positional, auto_install));
}

#[test]
fn first_row_of_parameter_decides() {
    let params = &AUTO_PARAMS[index_of_long(AUTO_PARAMS, b"help")..][..1];
    let rows = [
        (RowName::Long(b"smol"), RuntimeRequirement::RuntimeCode),
        (RowName::Long(b"help"), RuntimeRequirement::WholeRuntime),
        (RowName::Long(b"help"), RuntimeRequirement::Nothing),
    ];
    let found: [RuntimeRequirement; 1] = requirements_of(params, &rows);
    assert_eq!(found, [RuntimeRequirement::WholeRuntime]);
}

#[test]
#[should_panic(expected = "a runtime parameter declares no requirement")]
fn parameter_without_row_is_rejected() {
    let rows = [(RowName::Positional, RuntimeRequirement::Nothing)];
    let _: [RuntimeRequirement; 1] = requirements_of(&AUTO_PARAMS[..1], &rows);
}

#[test]
#[should_panic(expected = "no runtime parameter has this long name")]
fn undeclared_long_name_is_rejected() {
    index_of_long(AUTO_PARAMS, b"max-old-space-size");
}

#[test]
fn words_split_at_whitespace() {
    assert_eq!(split(""), [""; 0]);
    assert_eq!(split("  --smol\t-r  a.ts \n"), ["--smol", "-r", "a.ts"]);
    assert_eq!(split("--title=a --title b"), ["--title=a", "--title", "b"]);
}

#[test]
fn quotes_group_words() {
    assert_eq!(split("'a b' \"c d\" e\\ f"), ["a b", "c d", "e f"]);
    assert_eq!(split("--title='a b' --smol"), ["--title='a b'", "--smol"]);
    assert_eq!(split("--title 'a b' --smol"), ["--title 'a b'", "--smol"]);
}

#[test]
fn labels_are_primary_names() {
    assert_eq!(written_labels(""), [""; 0]);
    assert_eq!(written_labels("--help -h"), ["--help", "--help"]);
    assert_eq!(
        written_labels("--preload=a -r b"),
        ["--preload", "--preload"]
    );
    assert_eq!(
        written_labels("--eval 1 -e 1 --print 1 -p 1"),
        ["--eval", "--eval", "--print", "--print"]
    );
    assert_eq!(written_labels("-i -c -b"), ["-i", "--config", "--bun"]);
}

#[test]
fn options_carry_values() {
    let option = |label: &str, value: Option<&str>| (label.to_owned(), value.map(str::to_owned));
    assert_eq!(
        written_options("--preload=a -r b -r=c -rd --smol --inspect --inspect=9229"),
        [
            option("--preload", Some("a")),
            option("--preload", Some("b")),
            option("--preload", Some("c")),
            option("--preload", Some("d")),
            option("--smol", None),
            option("--inspect", None),
            option("--inspect", Some("9229")),
        ]
    );
}

#[test]
fn chained_shorts_are_separate_options() {
    assert_eq!(written_labels("-bh"), ["--bun", "--help"]);
    assert_eq!(written_labels("-bi -h"), ["--bun", "-i", "--help"]);
    assert_eq!(written_labels("-be 1 -h"), ["--bun", "--eval", "--help"]);
    assert_eq!(
        requirements("-bi"),
        [(
            RuntimeRequirement::Feature(Feature::Install),
            "-i".to_owned()
        )]
    );
}

#[test]
fn node_alias_is_resolved() {
    for (from, to) in NODE_SHORT_ALIASES {
        assert!(
            !bun_core::strings::contains_char(from, b'='),
            "{}",
            BStr::new(from)
        );
        assert!(!to.is_empty(), "{}", BStr::new(from));
    }
    assert_eq!(
        written_options("-pe x --smol"),
        [
            ("--print".to_owned(), Some("x".to_owned())),
            ("--smol".to_owned(), None),
        ]
    );
    assert_eq!(
        requirements("-pe x"),
        [(RuntimeRequirement::RuntimeCode, "--print".to_owned())]
    );
}

#[test]
fn option_value_is_not_option() {
    assert_eq!(written_labels("--title=--help"), ["--title"]);
    assert_eq!(written_labels("--title --help"), ["--title"]);
    assert_eq!(written_labels("--title -h"), ["--title"]);
    assert_eq!(written_labels("-r --help --smol"), ["--preload", "--smol"]);
    assert_eq!(written_labels("-e-h"), ["--eval"]);
    assert_eq!(
        written_labels("--inspect=-h --smol"),
        ["--inspect", "--smol"]
    );

    let embedded = read_exec_argv(b"--title --inspect");
    assert!(embedded.requirements.is_empty());
    assert!(!embedded.admits_inspector());
}

#[test]
fn optional_values_take_no_word() {
    assert_eq!(written_labels("--inspect --help"), ["--inspect", "--help"]);
    assert_eq!(written_labels("-c --help"), ["--config", "--help"]);
    assert_eq!(written_labels("-c own.toml --help"), ["--config"]);
}

#[test]
fn unknown_long_flags_are_skipped() {
    assert_eq!(written_labels("--sql-preconnecting --help"), ["--help"]);
    assert_eq!(written_labels("--helpful=1 --smol"), ["--smol"]);
    assert_eq!(written_labels("--preload './a.ts' --smol"), ["--smol"]);
}

#[test]
fn unknown_flag_needs_nothing() {
    let embedded = read_exec_argv(b"--max-old-space-size=4096");
    assert!(embedded.requirements.is_empty());
    assert!(!embedded.forbids_text_evaluation);
    assert!(!embedded.admits_inspector());
    assert!(embedded.first_that_loads_code().is_none());
}

#[test]
fn walk_stops_at_first_positional() {
    assert_eq!(written_labels("positional --help"), [""; 0]);
    assert_eq!(written_labels("--smol app.ts --help"), ["--smol"]);
    assert_eq!(written_labels("--smol -- --help"), ["--smol"]);
    assert_eq!(written_labels("--smol --"), ["--smol"]);
    assert_eq!(written_labels("--smol - --help"), ["--smol"]);
    assert!(requirements("app.ts --inspect -r a").is_empty());
}

#[test]
fn walk_stops_at_malformed_word() {
    assert_eq!(written_labels("--smol=1 --help"), [""; 0]);
    assert_eq!(written_labels("-bZ --help"), ["--bun"]);
    assert_eq!(written_labels("-b=1 --help"), [""; 0]);
    assert_eq!(written_labels("--smol --title"), ["--smol"]);
    assert_eq!(written_labels("--smol -r"), ["--smol"]);
}

#[test]
fn inspect_admits_inspector() {
    for options in [
        "--inspect",
        "--inspect-wait",
        "--inspect-brk=9229",
        "--smol --inspect",
    ] {
        let embedded = read_exec_argv(options.as_bytes());
        assert!(embedded.admits_inspector(), "{options}");
        assert!(embedded.first_that_loads_code().is_none(), "{options}");
    }
    for options in [
        "",
        "--smol",
        "--inspector",
        "--preload a",
        "app.ts --inspect",
    ] {
        assert!(
            !read_exec_argv(options.as_bytes()).admits_inspector(),
            "{options}"
        );
    }
}

#[test]
fn first_option_that_loads_code_is_found() {
    let loading = [
        ("--preload a", "--preload"),
        ("-r a", "--preload"),
        ("--require a", "--require"),
        ("--import a", "--import"),
        ("--eval 1", "--eval"),
        ("-e 1", "--eval"),
        ("--print 1", "--print"),
        ("-p 1", "--print"),
        ("--hot", "--hot"),
        ("--watch", "--watch"),
        ("--inspect --smol --import a -r b", "--import"),
        ("--trace-exit", "--trace-exit"),
        ("--trace-env-js-stack", "--trace-env-js-stack"),
    ];
    for (options, label) in loading {
        let embedded = read_exec_argv(options.as_bytes());
        let found = embedded
            .first_that_loads_code()
            .map(|option| text(&option.label));
        assert_eq!(found.as_deref(), Some(label), "{options}");
    }
    let load_nothing = [
        "",
        "--smol",
        "--inspect",
        "--sql-preconnect",
        "--title --preload",
        "--smol --stack-trace-limit=3",
        "--trace-env-native-stack",
    ];
    for options in load_nothing {
        assert!(
            read_exec_argv(options.as_bytes())
                .first_that_loads_code()
                .is_none(),
            "{options}"
        );
    }
}

#[test]
fn code_generation_flag_is_found() {
    let forbidding = [
        "--disallow-code-generation-from-strings",
        "--disallow-code-generation-from-strings=strict",
        "--smol --disallow-code-generation-from-strings --title x",
    ];
    for options in forbidding {
        let embedded = read_exec_argv(options.as_bytes());
        assert!(embedded.forbids_text_evaluation, "{options}");
        assert!(embedded.requirements.is_empty(), "{options}");
    }
    let allowing = [
        "",
        "--smol",
        "--disallow-code-generation-from-strings=x",
        "--title --disallow-code-generation-from-strings",
        "--title=--disallow-code-generation-from-strings",
        "--disallow-code-generation-from-stringsx",
        "app.ts --disallow-code-generation-from-strings",
    ];
    for options in allowing {
        assert!(
            !read_exec_argv(options.as_bytes()).forbids_text_evaluation,
            "{options}"
        );
    }
}

#[test]
fn requirements_do_not_repeat() {
    let runtime_code = RuntimeRequirement::RuntimeCode;
    assert_eq!(
        requirements("-r a --preload b --import c -r d"),
        [
            (runtime_code, "--preload".to_owned()),
            (runtime_code, "--import".to_owned()),
        ]
    );
    assert_eq!(
        requirements("--trace-exit --smol --trace-exit"),
        [(RuntimeRequirement::WholeRuntime, "--trace-exit".to_owned())]
    );
}

#[test]
fn hot_reload_options_need_reloader_and_runtime_code() {
    for label in ["--hot", "--watch"] {
        assert_eq!(
            requirements(label),
            [
                (RuntimeRequirement::RuntimeCode, label.to_owned()),
                (
                    RuntimeRequirement::Feature(Feature::HotReload),
                    label.to_owned()
                ),
            ]
        );
    }
    assert!(requirements("--watch-kill-signal SIGINT --no-clear-screen").is_empty());
}

#[test]
fn command_line_messages() {
    let cases = [
        ("--help", "--help"),
        ("-h", "--help"),
        ("-bh", "--help"),
        ("--smol --title=-h --help", "--help"),
        ("--aot", "--aot"),
        ("--aot-log-type-mismatches", "--aot-log-type-mismatches"),
        ("--debug-aot", "--debug-aot"),
        ("-i", "-i"),
        ("--install=fallback", "--install"),
        ("--install nonsense", "--install"),
    ];
    for (options, label) in cases {
        let expected = format!("{label}{NO_COMMAND_LINE}");
        assert_eq!(
            message_without_anything(options),
            Some(expected),
            "{options}"
        );
    }
}

#[test]
fn removed_feature_messages() {
    let cases = [
        ("--config=own.toml", "--config"),
        ("-c", "--config"),
        ("--cpu-prof", "--cpu-prof"),
        ("--heap-prof-md", "--heap-prof-md"),
        ("--sql-preconnect", "--sql-preconnect"),
        ("--redis-preconnect", "--redis-preconnect"),
        (
            "--fetch-preconnect=http://127.0.0.1:9",
            "--fetch-preconnect",
        ),
        (
            "--smol --fetch-preconnect http://127.0.0.1:9",
            "--fetch-preconnect",
        ),
    ];
    for (options, label) in cases {
        let expected = format!("{label}{FEATURE_REMOVED}");
        assert_eq!(
            message_without_anything(options),
            Some(expected),
            "{options}"
        );
    }
}

fn warning_of(option: &UnusableOption) -> String {
    let mut warning = Vec::new();
    option.write_warning(&mut warning);
    text(&warning)
}

fn warnings_without_anything(options: &str) -> Vec<String> {
    let ignored = with_words(options, |words| {
        find_ignored_options(words, obstacle_without_anything)
    });
    ignored.iter().map(warning_of).collect()
}

#[test]
fn options_that_native_code_carries_out_need_nothing() {
    let options = [
        "--stack-trace-limit=3",
        "--stack-trace-limit 3",
        "--stack-trace-limit '3'",
        "--stack-trace-limited",
        "--smol --stack-trace-limit=3",
        "--trace-env-native-stack",
    ];
    for options in options {
        assert_eq!(message_without_anything(options), None, "{options}");
        assert!(warnings_without_anything(options).is_empty(), "{options}");
        assert!(requirements(options).is_empty(), "{options}");
    }
}

#[test]
fn options_for_diagnosis_are_ignored_with_a_warning() {
    let cases = [
        ("--trace-env", "--trace-env"),
        ("--trace-env-js-stack", "--trace-env-js-stack"),
        ("--trace-exit", "--trace-exit"),
        ("--trace-exits=1", "--trace-exits"),
        ("--trace-events-enabled", "--trace-events-enabled"),
        ("--trace-event-categories node", "--trace-event-categories"),
        (
            "--trace-event-file-pattern=trace.log",
            "--trace-event-file-pattern",
        ),
        ("--smol --trace-exit --stack-trace-limit=3", "--trace-exit"),
        ("--title --trace-exit", "--trace-exit"),
        ("positional --trace-exit", "--trace-exit"),
    ];
    for (options, label) in cases {
        assert_eq!(message_without_anything(options), None, "{options}");
        assert_eq!(
            warnings_without_anything(options),
            [format!("{label}{IGNORED_WITHOUT_FUNCTION_SOURCE}")],
            "{options}"
        );
    }
    assert_eq!(
        warnings_without_anything("--trace-exit --trace-env --trace-exit"),
        [
            format!("--trace-exit{IGNORED_WITHOUT_FUNCTION_SOURCE}"),
            format!("--trace-env{IGNORED_WITHOUT_FUNCTION_SOURCE}"),
        ]
    );
    let ignored_by = |build: Option<BuildRecord>, is_whole: bool| {
        let obstacle_to = |requirement| find_obstacle(requirement, build, |_| is_whole);
        let ignored = with_words("--trace-exit", |words| {
            find_ignored_options(words, obstacle_to)
        });
        ignored.iter().map(warning_of).collect::<Vec<_>>()
    };
    assert_eq!(
        ignored_by(Some(DEFAULT_BUILD), true),
        [
            "--trace-exit is ignored by this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code"
        ]
    );
    assert_eq!(
        ignored_by(None, false),
        ["--trace-exit is ignored by this executable because --trim removed the feature it needs"]
    );
    assert!(ignored_by(Some(WITH_INSPECTOR), true).is_empty());
    assert!(ignored_by(None, true).is_empty());
    // An option that ends the process is reported, whatever is ignored beside it.
    assert_eq!(
        message_without_anything("--trace-exit --help"),
        Some(format!("--help{NO_COMMAND_LINE}"))
    );
}

#[test]
fn code_loading_messages() {
    let cases = [
        ("--preload ./a.ts", "--preload"),
        ("--preload=./a.ts", "--preload"),
        ("-r ./a.ts", "--preload"),
        ("--require ./a.ts", "--require"),
        ("--import ./a.ts", "--import"),
        ("--eval 1", "--eval"),
        ("-e 1", "--eval"),
        ("--print 1", "--print"),
        ("-p 1", "--print"),
        ("--hot", "--hot"),
        ("--watch", "--watch"),
        ("--smol --title=-r --import ./a.ts", "--import"),
    ];
    for (options, label) in cases {
        let expected = Some(format!("{label}{ONLY_COMPILED_CODE}"));
        assert_eq!(message_without_anything(options), expected, "{options}");
        for build in [
            WITHOUT_FUNCTION_SOURCE,
            WITH_INSPECTOR_WITHOUT_FUNCTION_SOURCE,
        ] {
            assert_eq!(
                message_untrimmed(options, Some(build)),
                expected,
                "{options}"
            );
        }
        let of_default_build = Some(format!("{label}{ONLY_CODE_OF_THE_BUILD}"));
        assert_eq!(
            message_untrimmed(options, Some(DEFAULT_BUILD)),
            of_default_build,
            "{options}"
        );
        for build in [Some(WITH_INSPECTOR), None] {
            assert_eq!(message_untrimmed(options, build), None, "{options}");
        }
    }
}

#[test]
fn debugger_messages() {
    let cases = [
        ("--inspect", "--inspect"),
        ("--inspect=127.0.0.1:0", "--inspect"),
        ("--inspect-wait", "--inspect-wait"),
        ("--smol --inspect-brk", "--inspect-brk"),
    ];
    for (options, label) in cases {
        let expected = Some(format!("{label}{NO_DEBUGGER}"));
        assert_eq!(message_without_anything(options), expected, "{options}");
        for build in [DEFAULT_BUILD, WITHOUT_FUNCTION_SOURCE] {
            assert_eq!(
                message_untrimmed(options, Some(build)),
                expected,
                "{options}"
            );
        }
        for build in [
            Some(WITH_INSPECTOR),
            Some(WITH_INSPECTOR_WITHOUT_FUNCTION_SOURCE),
            None,
        ] {
            assert_eq!(message_untrimmed(options, build), None, "{options}");
        }
    }
}

#[test]
fn build_is_asked_only_about_options_that_load_code() {
    let options = "--help --aot -i --config=own.toml --cpu-prof --heap-prof --sql-preconnect --redis-preconnect --expose-internals --smol";
    assert_eq!(
        message_untrimmed(options, Some(WITHOUT_FUNCTION_SOURCE)),
        None
    );
    for requirement in AUTO_REQUIREMENTS {
        let expected = match requirement {
            RuntimeRequirement::RuntimeCode | RuntimeRequirement::WholeRuntime => {
                Some(Obstacle::BuiltWithoutFunctionSource)
            }
            RuntimeRequirement::Feature(Feature::Inspector) => {
                Some(Obstacle::BuiltWithoutInspector)
            }
            RuntimeRequirement::Nothing | RuntimeRequirement::Feature(_) => None,
        };
        let obstacle = find_obstacle(requirement, Some(WITHOUT_FUNCTION_SOURCE), |_| true);
        assert_eq!(obstacle, expected, "{requirement:?}");
        assert_eq!(
            find_obstacle(requirement, Some(WITH_INSPECTOR), |_| true),
            None
        );
    }
}

#[test]
fn option_that_build_allows_still_needs_its_feature() {
    for requirement in [INSPECTOR_REQUIREMENT, RuntimeRequirement::RuntimeCode] {
        for build in [Some(WITH_INSPECTOR), None] {
            let obstacle = find_obstacle(requirement, build, |_| false);
            assert_eq!(
                obstacle,
                Some(Obstacle::FeatureRemoved),
                "{requirement:?} {build:?}"
            );
        }
    }
}

#[test]
fn other_options_are_usable() {
    let options = [
        "",
        "--smol",
        "--no-install",
        "--title=--help",
        "--title --help",
        "--title -h",
        "--trace-warnings",
        "--trace-deprecation",
        "--sql-preconnecting",
        "--max-old-space-size=4096",
        "positional --help",
        "--cpu-prof-name profile --heap-prof-dir profiles",
        "--disallow-code-generation-from-strings",
    ];
    for options in options {
        assert_eq!(message_without_anything(options), None, "{options}");
    }
}

#[test]
fn first_unusable_option_is_reported() {
    let install = RuntimeRequirement::Feature(Feature::Install);
    let unusable = with_words("--help --trace-exit -r a -i", |words| {
        find_unusable_option(words, |requirement| {
            (requirement == install).then_some(Obstacle::FeatureRemoved)
        })
    });
    assert_eq!(
        message_of(&unusable.unwrap()),
        format!("-i{FEATURE_REMOVED}")
    );
    assert_eq!(
        message_without_anything("-r a --help"),
        Some(format!("--preload{ONLY_COMPILED_CODE}"))
    );
    assert_eq!(
        message_without_anything("--help -r a"),
        Some(format!("--help{NO_COMMAND_LINE}"))
    );
}

#[test]
fn available_requirements_make_every_option_usable() {
    let options = "--help --aot -i --sql-preconnect --trace-exit --preload a --hot --inspect";
    assert_eq!(
        with_words(options, |words| find_unusable_option(words, |_| None)),
        None
    );
}

#[test]
fn bunfig_settings() {
    let message = |ctx: &ContextData| {
        let unusable = find_unusable_bunfig_setting(ctx, obstacle_without_anything);
        unusable.map(|option| message_of(&option))
    };
    let mut ctx = ContextData::default();
    assert_eq!(message(&ctx), None);

    let install_message = format!("\"install.auto\" in bunfig.toml{FEATURE_REMOVED}");
    let no_package_manager = format!("\"install.auto\" in bunfig.toml{NO_COMMAND_LINE}");
    for cache in [
        GlobalCache::force,
        GlobalCache::fallback,
        GlobalCache::allow_install,
    ] {
        ctx.debug.global_cache = cache;
        assert_eq!(message(&ctx), Some(no_package_manager.clone()), "{cache:?}");
    }
    ctx.debug.global_cache = GlobalCache::disable;
    assert_eq!(message(&ctx), None);

    ctx.preloads = vec![Box::from(&b"./a.ts"[..])];
    let expected = format!("\"preload\" in bunfig.toml{ONLY_COMPILED_CODE}");
    assert_eq!(message(&ctx), Some(expected.clone()));
    assert_eq!(find_unusable_bunfig_setting(&ctx, |_| None), None);

    let untrimmed = |build: Option<BuildRecord>| {
        let obstacle_to = |requirement| find_obstacle(requirement, build, |_| true);
        find_unusable_bunfig_setting(&ctx, obstacle_to).map(|option| message_of(&option))
    };
    assert_eq!(
        untrimmed(Some(WITHOUT_FUNCTION_SOURCE)),
        Some(expected.clone())
    );
    assert_eq!(
        untrimmed(Some(WITH_INSPECTOR_WITHOUT_FUNCTION_SOURCE)),
        Some(expected)
    );
    assert_eq!(untrimmed(Some(DEFAULT_BUILD)), None);
    assert_eq!(untrimmed(Some(WITH_INSPECTOR)), None);
    assert_eq!(untrimmed(None), None);

    let preloads = core::mem::take(&mut ctx.preloads);
    ctx.args.serve_plugins = Some(Vec::new());
    assert_eq!(message(&ctx), None);
    ctx.args.serve_plugins = Some(vec![Box::from(&b"bun-plugin-tailwind"[..])]);
    assert_eq!(
        message(&ctx),
        Some(format!(
            "\"serve.static.plugins\" in bunfig.toml{ONLY_COMPILED_CODE}"
        ))
    );
    let obstacle_in_default_build =
        |requirement| find_obstacle(requirement, Some(DEFAULT_BUILD), |_| true);
    assert_eq!(
        find_unusable_bunfig_setting(&ctx, obstacle_in_default_build),
        None
    );
    ctx.args.serve_plugins = None;
    ctx.preloads = preloads;

    ctx.debug.global_cache = GlobalCache::force;
    let runtime_code = RuntimeRequirement::RuntimeCode;
    let unusable = find_unusable_bunfig_setting(&ctx, |requirement| {
        (requirement != runtime_code).then_some(Obstacle::FeatureRemoved)
    });
    assert_eq!(
        unusable.map(|option| message_of(&option)),
        Some(install_message)
    );
}

#[test]
fn default_build_ignores_code_of_bunfig() {
    let with_code = || {
        let mut ctx = ContextData::default();
        ctx.preloads = vec![Box::from(&b"./a.ts"[..])];
        ctx.args.serve_plugins = Some(vec![Box::from(&b"bun-plugin-tailwind"[..])]);
        ctx
    };
    let runtime_code = RuntimeRequirement::RuntimeCode;
    let mut ctx = with_code();
    ignore_code_of_bunfig(
        &mut ctx,
        find_obstacle(runtime_code, Some(DEFAULT_BUILD), |_| true),
    );
    assert!(ctx.preloads.is_empty() && ctx.args.serve_plugins.is_none());
    for build in [Some(WITH_INSPECTOR), Some(WITHOUT_FUNCTION_SOURCE), None] {
        let mut ctx = with_code();
        ignore_code_of_bunfig(&mut ctx, find_obstacle(runtime_code, build, |_| true));
        assert_eq!(ctx.preloads.len(), 1, "{build:?}");
        assert!(ctx.args.serve_plugins.is_some(), "{build:?}");
    }
}

#[test]
fn environment_variable_messages() {
    let option = UnusableOption {
        origin: OptionOrigin::EnvironmentVariable("BUN_INSPECT_PRELOAD"),
        obstacle: Obstacle::BuiltWithoutFunctionSource,
    };
    assert_eq!(
        message_of(&option),
        format!("BUN_INSPECT_PRELOAD{ONLY_COMPILED_CODE}")
    );
    let option = UnusableOption {
        origin: OptionOrigin::EnvironmentVariable("BUN_INSPECT"),
        obstacle: Obstacle::BuiltWithoutInspector,
    };
    assert_eq!(message_of(&option), format!("BUN_INSPECT{NO_DEBUGGER}"));
}

#[test]
fn test_binary_has_everything() {
    for requirement in AUTO_REQUIREMENTS {
        assert!(requirement.is_available(), "{requirement:?}");
    }
}
