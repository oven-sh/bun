use bstr::BStr;
use bun_aot::engine::EngineModuleId;
use bun_bundler::aot::AotEntryPoint;
use bun_core::{ZBox, strings};
use bun_options_types::trim::TrimRequest;
use bun_trim::{
    Decision, ExecutableSettings as TrimSettings, Feature, FeatureSet, OptionRequirement,
    RuntimeRequirement, TrimRequestError, TrimSummary, UnseenCodeCause, UnsupportedReason,
    UsedFeatures,
};

use super::build::{
    corrupted_program, executable_location, graph_path, pair_entry_points, trim_trailing_separators,
};
use super::printing::{write_executable_details, write_megabytes};
use super::reports::write_file;
use super::trimming::{Trimming, add_build_option_requirements, collect_exec_argv_requirements};
use super::*;

const ORIGINS: [RequestOrigin; 3] = [
    RequestOrigin::CompileCommand,
    RequestOrigin::BuildFlag,
    RequestOrigin::BuildApi,
];
const DEFAULT_FLAGS: Flags =
    Flags::DISABLE_AUTOLOAD_TSCONFIG.union(Flags::DISABLE_AUTOLOAD_PACKAGE_JSON);
const MISSING_DIRECTORY_FILE: &[u8] = b"/bun-compile-command-missing-directory/file";

fn default_settings() -> TrimSettings {
    TrimSettings {
        autoloads_bunfig: true,
        autoloads_package_json: false,
        autoloads_tsconfig: false,
        embeds_source_maps: false,
        exec_argv: Vec::new(),
    }
}

fn requirement(requirement: RuntimeRequirement, label: &str) -> OptionRequirement {
    OptionRequirement {
        requirement,
        label: Box::from(label.as_bytes()),
    }
}

fn message_of(failure: &CompileFailure, origin: RequestOrigin) -> String {
    let mut message = Vec::new();
    failure.write_message(origin, &CompileTarget::default(), &mut message);
    BStr::new(&message).to_string()
}

fn assert_messages(failure: &CompileFailure, expected: [&str; 3]) {
    for (origin, expected) in ORIGINS.into_iter().zip(expected) {
        assert_eq!(message_of(failure, origin), expected);
    }
}

fn not_found() -> bun_sys::Error {
    bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::open)
}

#[test]
fn autoload_settings_follow_flags() {
    let autoloads = |flags: Flags| {
        let settings = trim_settings_of(flags, b"", false);
        let package_files = [settings.autoloads_package_json, settings.autoloads_tsconfig];
        (settings.autoloads_bunfig, package_files)
    };
    assert_eq!(
        trim_settings_of(DEFAULT_FLAGS, b"", false),
        default_settings()
    );
    let without_bunfig = DEFAULT_FLAGS | Flags::DISABLE_AUTOLOAD_BUNFIG;
    assert_eq!(autoloads(without_bunfig), (false, [false, false]));
    assert_eq!(
        autoloads(Flags::DISABLE_AUTOLOAD_TSCONFIG),
        (true, [true, false])
    );
    assert_eq!(
        autoloads(Flags::DISABLE_AUTOLOAD_PACKAGE_JSON),
        (true, [false, true])
    );
    assert_eq!(autoloads(Flags::empty()), (true, [true, true]));
    let without_env_files = DEFAULT_FLAGS | Flags::DISABLE_DEFAULT_ENV_FILES;
    assert_eq!(
        trim_settings_of(without_env_files, b"", false),
        default_settings()
    );
}

#[test]
fn exec_argv_requirements_are_passed_on() {
    let exec_argv = b"--inspect --smol -c own.toml";
    let expected = vec![
        requirement(RuntimeRequirement::Feature(Feature::Inspector), "--inspect"),
        requirement(RuntimeRequirement::Feature(Feature::Bunfig), "--config"),
    ];
    assert_eq!(collect_exec_argv_requirements(exec_argv), expected);
    assert_eq!(
        trim_settings_of(DEFAULT_FLAGS, exec_argv, false),
        TrimSettings {
            exec_argv: expected,
            ..default_settings()
        }
    );
}

fn requirements_of(options: &AotOptions, exec_argv: &[u8]) -> Vec<OptionRequirement> {
    let mut requirements = collect_exec_argv_requirements(exec_argv);
    add_build_option_requirements(options, &mut requirements);
    requirements
}

#[test]
fn default_build_requires_only_what_exec_argv_does() {
    let options = AotOptions::default();
    assert!(requirements_of(&options, b"").is_empty());
    assert_eq!(
        requirements_of(&options, b"-r ./a.ts"),
        [requirement(RuntimeRequirement::RuntimeCode, "--preload")]
    );
    let without_function_source = AotOptions {
        embeds_function_source: false,
        ..Default::default()
    };
    assert!(requirements_of(&without_function_source, b"").is_empty());
}

#[test]
fn inspector_is_required_once() {
    let inspector = RuntimeRequirement::Feature(Feature::Inspector);
    let admits_inspector = AotOptions {
        admits_inspector: true,
        ..Default::default()
    };
    assert_eq!(
        requirements_of(&admits_inspector, b""),
        [requirement(inspector, "--compile-inspector")]
    );
    assert_eq!(
        requirements_of(&admits_inspector, b"--inspect-wait"),
        [requirement(inspector, "--inspect-wait")]
    );
    assert_eq!(
        requirements_of(&admits_inspector, b"-r ./a.ts"),
        [
            requirement(RuntimeRequirement::RuntimeCode, "--preload"),
            requirement(inspector, "--compile-inspector"),
        ]
    );
}

#[test]
fn validating_build_requires_image_compiler() {
    let image_compiler = RuntimeRequirement::Feature(Feature::ImageCompiler);
    let with_words = |words: &[&[u8]]| AotOptions {
        option_words: words.iter().map(|word| Box::from(*word)).collect(),
        ..Default::default()
    };
    assert_eq!(
        requirements_of(&with_words(&[b"limit=MaxSiteCaches:0", b"validate"]), b""),
        [requirement(image_compiler, "--aot-validate")]
    );
    assert!(requirements_of(&with_words(&[b"check=verify-each-pass"]), b"").is_empty());
}

#[test]
fn option_without_requirement_changes_no_setting() {
    assert_eq!(
        trim_settings_of(DEFAULT_FLAGS, b"--smol", false),
        default_settings()
    );
}

#[test]
fn source_maps_are_passed_on() {
    assert_eq!(
        trim_settings_of(DEFAULT_FLAGS, b"", true),
        TrimSettings {
            embeds_source_maps: true,
            ..default_settings()
        }
    );
}

#[test]
fn disabled_request_plans_nothing_for_program_that_is_not_compiled() {
    let template = ZBox::from_bytes(MISSING_DIRECTORY_FILE);
    let used = UsedFeatures::with_cause(UnseenCodeCause::ProgramNotCompiled);
    let planned = plan_trimming(
        &used,
        &default_settings(),
        &TrimRequest::default(),
        &template,
    );
    assert!(matches!(planned, Ok(None)));
}

#[test]
fn disabled_request_reads_template_for_compiled_program() {
    let template = ZBox::from_bytes(MISSING_DIRECTORY_FILE);
    let (used, settings) = (UsedFeatures::default(), default_settings());
    let planned = plan_trimming(&used, &settings, &TrimRequest::default(), &template);
    assert!(matches!(
        planned,
        Err(CompileFailure::TemplateUnreadable { .. })
    ));
}

#[test]
fn enabled_request_reads_template() {
    let template = ZBox::from_bytes(MISSING_DIRECTORY_FILE);
    let (used, settings) = (UsedFeatures::default(), default_settings());
    let request = TrimRequest {
        removes_unused: true,
        ..TrimRequest::default()
    };
    let planned = plan_trimming(&used, &settings, &request, &template);
    assert!(matches!(
        planned,
        Err(CompileFailure::TemplateUnreadable { .. })
    ));
}

#[test]
fn build_without_trim_request_has_no_decision() {
    let trimming = Trimming::NotAsked {
        without_tools: None,
    };
    assert!(trimming.plan().is_none());
    assert!(trimming.decision().is_none());
    assert!(trimming.has_edges());
}

#[test]
fn decision_without_plan_reports_unread_edges() {
    for has_edges in [true, false] {
        let trimming = Trimming::Decided {
            decision: Decision::empty(),
            has_edges,
            without_tools: None,
        };
        assert!(trimming.plan().is_none());
        assert_eq!(trimming.decision(), Some(&Decision::empty()));
        assert_eq!(trimming.has_edges(), has_edges);
    }
}

#[test]
fn unavailable_compiler_messages() {
    assert_messages(
        &CompileFailure::NoCompiler,
        [
            "ahead-of-time compilation isn't available in this build of Bun",
            "--aot isn't available in this build of Bun",
            "compile.aot isn't available in this build of Bun",
        ],
    );
    assert_messages(
        &CompileFailure::NoIdentity(IdentityError::NoBuildId),
        [
            "ahead-of-time compilation isn't available in this build of Bun: it was linked without a build id",
            "--aot isn't available in this build of Bun: it was linked without a build id",
            "compile.aot isn't available in this build of Bun: it was linked without a build id",
        ],
    );
    for error in [
        IdentityError::Malformed,
        IdentityError::UnrecognizedExecutable,
    ] {
        assert_messages(
            &CompileFailure::NoIdentity(error),
            [
                "ahead-of-time compilation isn't available in this build of Bun: its build id could not be read",
                "--aot isn't available in this build of Bun: its build id could not be read",
                "compile.aot isn't available in this build of Bun: its build id could not be read",
            ],
        );
    }
}

#[test]
fn cross_compilation_note_only_for_command() {
    assert_messages(
        &CompileFailure::CrossCompilation,
        [
            "bun compile can't cross-compile. It only builds for the platform it runs on\nnote: run this on the target platform, or pass --no-aot to bundle your code with the Bun runtime instead, like bun build --compile",
            "--aot can't cross-compile. It only builds for the platform it runs on",
            "compile.aot can't cross-compile. It only builds for the platform it runs on",
        ],
    );
}

#[test]
fn other_messages_ignore_origin() {
    let path = || b"./other-bun".to_vec();
    let target = CompileTarget::default();
    let unreadable = format!("failed to read executable for '{target}': {}", not_found());
    assert!(strings::contains(unreadable.as_bytes(), b"ENOENT"));
    let not_written = format!("failed to write out/report.json: {}", not_found());
    let cases: [(CompileFailure, &str); 9] = [
        (
            CompileFailure::TemplateUnreadable { error: not_found() },
            unreadable.as_str(),
        ),
        (
            CompileFailure::TemplateIsNotBun { path: path() },
            "./other-bun can't run code compiled by this Bun. It isn't a Bun executable, or it's a different version. Use the same version of Bun, built for this platform",
        ),
        (
            CompileFailure::TemplateDiffers {
                path: path(),
                difference: b"sizeof(Instance) is 8 there and 16 here".to_vec(),
            },
            "./other-bun can't run code compiled by this Bun: sizeof(Instance) is 8 there and 16 here\nnote: use a build of the same revision of Bun with the same configuration",
        ),
        (
            CompileFailure::Build {
                refused_entry_points: None,
                files_checked: 0,
            },
            "",
        ),
        (CompileFailure::Assets("no asset".to_owned()), "no asset"),
        (
            CompileFailure::Trim(UnsupportedReason::NoTrimTable.into()),
            "this build of Bun doesn't support --trim (NoTrimTable)",
        ),
        (
            CompileFailure::Executable(CompileError::Message(b"no target".to_vec())),
            "no target",
        ),
        (
            corrupted_program(),
            "failed to create executable: CorruptedCompiledProgram",
        ),
        (
            CompileFailure::FileNotWritten {
                path: b"out/report.json".to_vec(),
                error: not_found(),
            },
            not_written.as_str(),
        ),
    ];
    for (failure, expected) in &cases {
        assert_messages(failure, [*expected; 3]);
    }
}

#[test]
fn trim_request_error_keeps_its_message() {
    let unknown_name = || {
        let name = Box::from(&b"no-such-feature"[..]);
        TrimError::Request(TrimRequestError::UnknownName(name))
    };
    let mut expected = Vec::new();
    unknown_name().write_message(&mut expected);
    assert!(strings::contains(
        &expected,
        b"unknown name \"no-such-feature\""
    ));
    let expected = BStr::new(&expected).to_string();
    assert_messages(
        &CompileFailure::Trim(unknown_name()),
        [expected.as_str(); 3],
    );
}

#[test]
fn unwritable_file_is_failure() {
    let Err(failure) = write_file(Fd::cwd(), MISSING_DIRECTORY_FILE, b"{}") else {
        panic!("a file was written in a directory that does not exist");
    };
    let CompileFailure::FileNotWritten { path, .. } = &failure else {
        panic!("{}", message_of(&failure, RequestOrigin::CompileCommand));
    };
    assert_eq!(BStr::new(path), BStr::new(MISSING_DIRECTORY_FILE));
    let message = message_of(&failure, RequestOrigin::CompileCommand);
    let prefix = format!("failed to write {}: ", BStr::new(MISSING_DIRECTORY_FILE));
    assert!(message.starts_with(&prefix), "{message}");
    assert!(
        strings::contains(message.as_bytes(), b"ENOENT"),
        "{message}"
    );
}

#[test]
#[allow(clippy::disallowed_methods)]
fn written_file_contains_last_bytes() {
    let name = format!("bun-compile-command-written-{}.json", std::process::id());
    let file = std::env::temp_dir().join(name);
    let path = file.as_os_str().as_encoded_bytes();
    let written = write_file(Fd::cwd(), path, b"first, longer contents")
        .and_then(|()| write_file(Fd::cwd(), path, b"{}"));
    let contents = bun_sys::File::read_from(Fd::cwd(), path);
    let _ = std::fs::remove_file(&file);
    assert!(written.is_ok());
    assert_eq!(contents.ok().as_deref(), Some(&b"{}"[..]));
}

#[test]
fn executable_location_follows_platform() {
    let in_directory: &[u8] = if cfg!(windows) { b"out/app" } else { b"app" };
    assert_eq!(executable_location(Fd::cwd(), b"out/app").1, in_directory);
    assert_eq!(executable_location(Fd::cwd(), b"app").1, b"app");
}

#[test]
fn megabytes_have_one_decimal() {
    let cases: [(u64, &str); 5] = [
        (0, "0.0 MB"),
        (49_999, "0.0 MB"),
        (50_000, "0.1 MB"),
        (30_849_999, "30.8 MB"),
        (u64::MAX, "18446744073709.5 MB"),
    ];
    for (bytes, expected) in cases {
        let mut text = Vec::new();
        write_megabytes(&mut text, bytes);
        assert_eq!(BStr::new(&text), expected);
    }
}

fn executable_details(executable: Option<ExecutableDetails>, untyped_note: &[u8]) -> Vec<u8> {
    let outcome = CompileOutcome {
        output_files: Vec::new(),
        graph_bytes: None,
        metafile: None,
        summary: Vec::new(),
        report_messages: Vec::new(),
        trim_log_lines: Vec::new(),
        executable,
        untyped_note: untyped_note.to_vec(),
        module_count: 0,
        engine_time: Duration::ZERO,
        executable_time: Duration::ZERO,
    };
    let mut details = Vec::new();
    write_executable_details(&outcome, &mut details);
    details
}

#[test]
fn executable_details_need_trim_summary() {
    let executable = |trim_summary: Option<TrimSummary>| ExecutableDetails {
        trim_summary,
        size: 60_000_000,
        ..Default::default()
    };
    let trim_summary = TrimSummary {
        removed: FeatureSet::EMPTY,
        cut_bytes: 30_000_000,
        filled_bytes: 849_999,
        file_bytes_saved: 0,
        uncut: None,
        format: None,
    };
    assert_eq!(BStr::new(&executable_details(None, b"")), "");
    assert_eq!(
        BStr::new(&executable_details(Some(executable(None)), b"")),
        ""
    );
    assert_eq!(
        BStr::new(&executable_details(None, b"1 file untyped")),
        "  1 file untyped"
    );
    let mut trimmed_size = Vec::new();
    write_trimmed_size(&executable(None), &mut trimmed_size);
    assert_eq!(BStr::new(&trimmed_size), "");
    write_trimmed_size(&executable(Some(trim_summary.clone())), &mut trimmed_size);
    assert_eq!(
        BStr::new(&trimmed_size),
        "  60.0 MB (30.8 MB of unused Bun APIs removed)"
    );
    assert_eq!(
        BStr::new(&executable_details(
            Some(executable(Some(trim_summary))),
            b"1 file untyped"
        )),
        "  60.0 MB (30.8 MB of unused Bun APIs removed)  1 file untyped"
    );
}

#[test]
fn entry_points_pair_with_module_ids() {
    let entry_points = [&b"a.js"[..], b"b.js"].map(|name| AotEntryPoint {
        source_path: [&b"/src/"[..], name].concat(),
        module_path: [&b"/$bunfs/root/"[..], name].concat(),
    });
    let module_ids = [EngineModuleId(7), EngineModuleId(3)];
    let pairs = pair_entry_points(&entry_points, &module_ids, true)
        .ok()
        .unwrap();
    assert_eq!(pairs.len(), 2);
    assert_eq!(pairs[1].module_id, EngineModuleId(3));
    assert_eq!(pairs[1].source_path, b"/src/b.js");
    assert_eq!(pairs[1].module_path, b"/$bunfs/root/b.js");
    let embedded = pair_entry_points(&entry_points, &module_ids, false)
        .ok()
        .unwrap();
    assert_eq!(embedded[1].source_path, b"/$bunfs/root/b.js");
    assert_eq!(embedded[1].module_path, b"/$bunfs/root/b.js");
    let unpaired = pair_entry_points(&entry_points, &module_ids[..1], true);
    assert!(matches!(unpaired, Err(CompileFailure::Graph(_))));
}

#[test]
fn asset_paths_have_no_trailing_separator() {
    assert_eq!(trim_trailing_separators(b"./public//"), b"./public");
    assert_eq!(trim_trailing_separators(b"public"), b"public");
    assert_eq!(
        graph_path(b"/app/public", b"/js/a.js"),
        b"/app/public/js/a.js"
    );
    assert_eq!(graph_path(b"/app/data.json", b""), b"/app/data.json");
}
