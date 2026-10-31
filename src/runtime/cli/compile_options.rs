use core::num::NonZeroU32;

use bun_aot::engine::{self, RejectedOptionWord};
use bun_aot::report;
use bun_clap as clap;
use bun_core::{CodeGenerationFromStrings, Global, Output, strings};
use bun_options_types::aot_options::{
    AotOptions, BuildReportRequest, ExplainSet, HeapSize, ImagesBelow, ReportDetail,
};
use bun_options_types::bundle_enums::Format;
use bun_options_types::compile_target::CompileTarget;
use bun_options_types::context::{Debugger, HotReload};
use bun_options_types::trim::{Feature, TrimFeature, TrimRequest};
use bun_trim::{TrimError, TrimRequestError};

use super::compile_command::{CompileFailure, RequestOrigin, print_error_and_notes};
use super::run_compiled;
use super::startup_options::read_exec_argv;
use crate::cli::arguments::{AUTO_PARAMS, BUILD_ONLY_PARAMS, ParamType};
use crate::cli::command::{Context, Tag};

const MAX_SUGGESTION_DISTANCE: usize = 3;
const CODE_GENERATION_FLAG: &[u8] = b"--disallow-code-generation-from-strings";
pub(crate) const COMPILE_AOT_KEYS: &[&str] = &[
    "aot",
    "aotCheck",
    "aotDisable",
    "aotExplain",
    "aotHeat",
    "aotLogTypeMismatches",
    "aotTesting",
    "aotValidate",
];
const EXPLAIN_ALLOWED: &str =
    "one of text, json, guards, guards-json, trim, missed-optimizations, allocations, statistics";
const LOCALES_ALLOWED: &str = "a list of locale tags, like en,de-AT";
const REPORT_DETAIL_ALLOWED: &str = "one of summary, functions, sites";

const EXPLAIN_NAMES: &[(&[u8], ExplainSet)] = &[
    (b"", ExplainSet::TEXT),
    (b"text", ExplainSet::TEXT),
    (b"json", ExplainSet::JSON),
    (b"guards", ExplainSet::CHECKS),
    (b"guards-json", ExplainSet::CHECKS_JSON),
    (b"trim", ExplainSet::RUNTIME_USE),
    (b"missed-optimizations", ExplainSet::DECLINES),
    (b"allocations", ExplainSet::ALLOCATIONS),
    (b"statistics", ExplainSet::STATISTICS),
    (b"unknown-code", ExplainSet::ONLY_UNKNOWN_CODE),
    (b"unproven-type", ExplainSet::ONLY_UNPROVEN_TYPE),
    (b"mutation", ExplainSet::ONLY_MUTATION),
    (b"limit", ExplainSet::ONLY_LIMIT),
];

#[derive(Copy, Clone)]
enum Form {
    Flag,
    One,
    Many,
}

macro_rules! developer_flag {
    ($key:literal, $form:expr) => {
        ($key, concat!("--aot-", $key), $form)
    };
}

const DEVELOPER_FLAGS: &[(&str, &str, Form)] = &[
    developer_flag!("validate", Form::Flag),
    developer_flag!("check", Form::Many),
    developer_flag!("disable", Form::Many),
    developer_flag!("only-passes", Form::One),
    developer_flag!("disable-in", Form::One),
    developer_flag!("limit", Form::One),
    developer_flag!("heat", Form::One),
    developer_flag!("flow", Form::One),
    developer_flag!("testing", Form::Many),
    developer_flag!("sabotage", Form::One),
    developer_flag!("count-branches", Form::Flag),
    developer_flag!("count-arrivals", Form::Flag),
    developer_flag!("drop-guard", Form::One),
    developer_flag!("layout-seed", Form::One),
    developer_flag!("report", Form::One),
    developer_flag!("report-detail", Form::One),
    developer_flag!("verify-each-pass", Form::Flag),
    developer_flag!("references", Form::One),
    developer_flag!("threads", Form::One),
    developer_flag!("erase-types", Form::Flag),
    developer_flag!("refuse-code-from-disk", Form::Flag),
    developer_flag!("separate-programs", Form::Flag),
    developer_flag!("out", Form::One),
    developer_flag!("symbols", Form::Flag),
    ("no-builtin-modules", "--no-builtin-modules", Form::Flag),
];

struct FlagGroup {
    flags: &'static [&'static str],
    other_commands: &'static str,
    other_params: &'static [ParamType],
}

const RUN_FLAGS: FlagGroup = FlagGroup {
    flags: &[
        "--aot",
        "--aot-allow-code-from-disk",
        "--aot-log-type-mismatches",
    ],
    other_commands: "bun build",
    other_params: BUILD_ONLY_PARAMS,
};

const BUILD_FLAGS: FlagGroup = FlagGroup {
    flags: &[
        "--aot",
        "--aot-allow-code-from-disk",
        "--aot-huge-heap",
        "--aot-log-type-mismatches",
    ],
    other_commands: "bun run and bun test",
    other_params: AUTO_PARAMS,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum OptionName {
    Compile,
    Aot,
    LogTypeMismatches,
    Explain,
    HugeHeap,
    InPlace,
    FunctionSource,
    Obfuscate,
    ExternalSourceMap,
    Inspector,
    CodeFromDisk,
    ExecArgv,
    Trim,
    TrimWithout,
    TrimTemplate,
    TrimLocales,
    CodeGenerationFromStrings,
    Threads,
    References,
    Report,
    ReportDetail,
    List,
    Developer(&'static str),
}

#[derive(Default)]
pub(crate) struct TrimFlags<'a> {
    pub removes_unused: bool,
    pub allow: Vec<&'a [u8]>,
    pub remove: Vec<&'a [u8]>,
    pub remove_internal: Vec<&'a [u8]>,
    pub locales: Option<Vec<&'a [u8]>>,
    pub logs: bool,
    pub is_template: bool,
}

impl TrimFlags<'_> {
    fn asks_to_remove_unused(&self) -> bool {
        self.removes_unused
            || !self.allow.is_empty()
            || !self.remove.is_empty()
            || self.locales.is_some()
            || self.logs
    }
}

#[derive(Default)]
pub(crate) struct CompileFlags<'a> {
    pub is_executable: bool,
    pub aot: bool,
    pub no_aot: bool,
    pub logs_type_mismatches: bool,
    pub explain: Vec<&'a [u8]>,
    pub has_huge_heap: bool,
    pub is_in_place: bool,
    pub omits_function_source: bool,
    pub obfuscates: bool,
    /// `--sourcemap=external`. With `--aot` it means what `--obfuscate` means.
    pub has_external_source_map: bool,
    pub admits_inspector: bool,
    pub allows_code_from_disk: bool,
    pub trim: TrimFlags<'a>,
    pub developer_words: Vec<(&'static str, Option<&'a [u8]>)>,
    pub is_cross_compile: bool,
    pub exec_argv: &'a [u8],
}

pub(crate) struct CompileSettings {
    pub aot: Option<Box<AotOptions>>,
    pub trim: TrimRequest,
}

pub(crate) enum OptionError<'a> {
    Requires {
        option: OptionName,
        needed: OptionName,
    },
    EmbeddedOptionLoadsCode {
        option: Box<[u8]>,
        excluded_by: OptionName,
    },
    BothAotAndNoAot,
    CrossCompile,
    HardenedBunRunsOnlyCompiledCode,
    InvalidValue {
        option: OptionName,
        value: &'a [u8],
    },
    DeveloperWord {
        key: &'static str,
        word: Vec<u8>,
        sentence: Vec<u8>,
    },
    Trim(TrimError),
    UnknownCompileKey {
        key: &'a [u8],
        suggestion: Option<&'static str>,
    },
    KeyBelongsInCompile {
        key: &'a [u8],
    },
}

fn allowed_values(option: OptionName) -> &'static str {
    match option {
        OptionName::Explain => EXPLAIN_ALLOWED,
        OptionName::TrimLocales => LOCALES_ALLOWED,
        OptionName::ReportDetail => REPORT_DETAIL_ALLOWED,
        OptionName::References => "one of narrow, wide",
        OptionName::Threads => "a whole number above zero",
        OptionName::CodeGenerationFromStrings => "\"strict\", or no value",
        OptionName::List => "registry",
        _ => unreachable!("{option:?} takes any value"),
    }
}

fn write_spelling(option: OptionName, origin: RequestOrigin, out: &mut Vec<u8>) {
    use OptionName as Name;
    use RequestOrigin::{BuildApi, BuildFlag, CompileCommand};
    let spelling = match (option, origin) {
        (Name::Compile, BuildFlag | CompileCommand) => "--compile",
        (Name::Compile, BuildApi) => "compile",
        (Name::Aot, BuildFlag | CompileCommand) => "--aot",
        (Name::Aot, BuildApi) => "compile.aot",
        (Name::LogTypeMismatches, BuildFlag | CompileCommand) => "--aot-log-type-mismatches",
        (Name::LogTypeMismatches, BuildApi) => "compile.aotLogTypeMismatches",
        (Name::Explain, BuildFlag | CompileCommand) => "--explain",
        (Name::Explain, BuildApi) => "compile.aotExplain",
        (Name::Trim, BuildFlag | CompileCommand) => "--trim",
        (Name::Trim, BuildApi) => "compile.trim",
        (Name::TrimLocales, BuildFlag | CompileCommand) => "--trim-locales",
        (Name::TrimLocales, BuildApi) => "compile.trim.locales",
        (Name::Obfuscate, BuildFlag | CompileCommand) => "--obfuscate",
        (Name::Obfuscate, BuildApi) => "compile.obfuscate",
        (Name::ExternalSourceMap, BuildFlag | CompileCommand) => "--sourcemap=external",
        (Name::ExternalSourceMap, BuildApi) => "sourcemap: \"external\"",
        (Name::FunctionSource, BuildFlag | CompileCommand) => "--no-compile-function-source",
        (Name::FunctionSource, BuildApi) => "compile.functionSource: false",
        (Name::Inspector, BuildFlag | CompileCommand) => "--compile-inspector",
        (Name::Inspector, BuildApi) => "compile.inspector",
        (Name::CodeFromDisk, BuildFlag | CompileCommand) => "--aot-allow-code-from-disk",
        (Name::CodeFromDisk, BuildApi) => "compile.allowCodeFromDisk",
        (Name::ExecArgv, BuildFlag | CompileCommand) => "--compile-exec-argv",
        (Name::ExecArgv, BuildApi) => "compile.execArgv",
        (Name::CodeGenerationFromStrings, BuildFlag | CompileCommand) => {
            "--disallow-code-generation-from-strings"
        }
        (Name::CodeGenerationFromStrings, BuildApi) => "disallowCodeGenerationFromStrings",
        (Name::HugeHeap, _) => "--aot-huge-heap",
        (Name::InPlace, _) => "--compile-in-place",
        (Name::TrimWithout, _) => "--trim-without",
        (Name::TrimTemplate, _) => "--trim-template",
        (Name::Threads, _) => "--aot-threads",
        (Name::References, _) => "--aot-references",
        (Name::Report, _) => "--aot-report",
        (Name::ReportDetail, _) => "--aot-report-detail",
        (Name::List, _) => "--aot-list",
        (Name::Developer("validate"), BuildApi) => "compile.aotValidate",
        (Name::Developer("check"), BuildApi) => "compile.aotCheck",
        (Name::Developer("disable"), BuildApi) => "compile.aotDisable",
        (Name::Developer("heat"), BuildApi) => "compile.aotHeat",
        (Name::Developer("testing"), BuildApi) => "compile.aotTesting",
        (Name::Developer(key), _) => developer_flag_name(key),
    };
    out.extend_from_slice(spelling.as_bytes());
}

fn developer_flag_name(key: &str) -> &'static str {
    let flag = DEVELOPER_FLAGS
        .iter()
        .find(|(flag_key, ..)| *flag_key == key);
    flag.expect("a key of DEVELOPER_FLAGS").1
}

impl OptionError<'_> {
    pub(crate) fn write_message(&self, origin: RequestOrigin, out: &mut Vec<u8>) {
        match self {
            OptionError::Requires { option, needed } => {
                write_spelling(*option, origin, out);
                out.extend_from_slice(b" requires ");
                write_spelling(*needed, origin, out);
                if origin == RequestOrigin::BuildApi && *needed == OptionName::Aot {
                    out.extend_from_slice(b": true");
                }
            }
            OptionError::EmbeddedOptionLoadsCode {
                option,
                excluded_by,
            } => {
                write_spelling(*excluded_by, origin, out);
                out.extend_from_slice(b" does not support ");
                out.extend_from_slice(option);
                out.extend_from_slice(b" in ");
                write_spelling(OptionName::ExecArgv, origin, out);
                out.extend_from_slice(
                    b" because the executable only runs code that was compiled into it",
                );
            }
            OptionError::BothAotAndNoAot => {
                out.extend_from_slice(b"Cannot use both --aot and --no-aot")
            }
            OptionError::CrossCompile => CompileFailure::CrossCompilation.write_message(
                origin,
                &CompileTarget::default(),
                out,
            ),
            OptionError::HardenedBunRunsOnlyCompiledCode => {
                write_spelling(OptionName::CodeFromDisk, origin, out);
                out.extend_from_slice(
                    b" is not available in this build of Bun. Its executables only run code that was compiled into them",
                );
            }
            OptionError::InvalidValue { option, value } => {
                out.extend_from_slice(b"Invalid value for ");
                write_spelling(*option, origin, out);
                out.extend_from_slice(b": \"");
                out.extend_from_slice(value);
                out.extend_from_slice(b"\". Must be ");
                out.extend_from_slice(allowed_values(*option).as_bytes());
            }
            OptionError::DeveloperWord {
                key,
                word,
                sentence,
            } => {
                if origin == RequestOrigin::BuildApi {
                    write_spelling(OptionName::Developer(*key), origin, out);
                } else {
                    out.extend_from_slice(b"--aot-");
                    out.extend_from_slice(word);
                }
                out.extend_from_slice(b": ");
                out.extend_from_slice(sentence);
            }
            OptionError::Trim(error) => error.write_message(out),
            OptionError::UnknownCompileKey { key, suggestion } => {
                write_unknown_compile_key(key, *suggestion, out)
            }
            OptionError::KeyBelongsInCompile { key } => {
                out.push(b'"');
                out.extend_from_slice(key);
                out.extend_from_slice(b"\" goes inside compile. Write compile: { ");
                out.extend_from_slice(key);
                out.extend_from_slice(b": ... }");
            }
        }
    }
}

fn write_unknown_compile_key(key: &[u8], suggestion: Option<&str>, out: &mut Vec<u8>) {
    out.extend_from_slice(b"compile.");
    out.extend_from_slice(key);
    out.extend_from_slice(b" is not a valid option.");
    if let Some(suggestion) = suggestion {
        out.extend_from_slice(b" Did you mean compile.");
        out.extend_from_slice(suggestion.as_bytes());
        out.push(b'?');
    }
    out.extend_from_slice(b" Options that start with \"aot\": ");
    out.extend_from_slice(COMPILE_AOT_KEYS.join(", ").as_bytes());
}

pub(crate) fn resolve<'a>(flags: &CompileFlags<'a>) -> Result<CompileSettings, OptionError<'a>> {
    check_combination(flags)?;
    let explain = explain_set(&flags.explain)?;
    let trim = resolve_trim(flags)?;
    if !flags.aot {
        return Ok(CompileSettings { aot: None, trim });
    }
    let embedded = read_exec_argv(flags.exec_argv);
    let obfuscates = flags.obfuscates || flags.has_external_source_map;
    // The source text has every name that an obfuscated build leaves out.
    let embeds_function_source = !flags.omits_function_source && !obfuscates;
    let admits_inspector = flags.admits_inspector || embedded.admits_inspector();
    if (!embeds_function_source || !admits_inspector)
        && let Some(option) = embedded.first_that_loads_code()
    {
        let excluded_by = if flags.omits_function_source {
            OptionName::FunctionSource
        } else if flags.obfuscates {
            OptionName::Obfuscate
        } else if flags.has_external_source_map {
            OptionName::ExternalSourceMap
        } else {
            OptionName::Aot
        };
        return Err(OptionError::EmbeddedOptionLoadsCode {
            option: option.label.clone(),
            excluded_by,
        });
    }
    let mut options = AotOptions {
        heap: if flags.has_huge_heap {
            HeapSize::Huge
        } else {
            HeapSize::Standard
        },
        embeds_function_source,
        explain,
        trim,
        reports_type_mismatches: flags.logs_type_mismatches,
        obfuscates,
        code_generation_from_strings: embedded.code_generation_from_strings,
        admits_inspector,
        loads_code_from_disk: flags.allows_code_from_disk,
        runs_in_place: flags.is_in_place,
        ..Default::default()
    };
    for &(key, value) in &flags.developer_words {
        apply_developer_word(key, value, &mut options)?;
    }
    Ok(CompileSettings {
        aot: Some(Box::new(options)),
        trim: TrimRequest::default(),
    })
}

fn check_combination<'a>(flags: &CompileFlags<'a>) -> Result<(), OptionError<'a>> {
    if flags.aot && flags.no_aot {
        return Err(OptionError::BothAotAndNoAot);
    }
    if !flags.is_executable {
        check_requires_executable(flags)?;
    }
    if flags.aot {
        check_aot_combination(flags)
    } else {
        check_requires_aot(flags)
    }
}

fn check_requires_executable<'a>(flags: &CompileFlags<'a>) -> Result<(), OptionError<'a>> {
    let trim = &flags.trim;
    let option = if flags.aot {
        OptionName::Aot
    } else if trim.asks_to_remove_unused() {
        OptionName::Trim
    } else if !trim.remove_internal.is_empty() {
        OptionName::TrimWithout
    } else if trim.is_template {
        OptionName::TrimTemplate
    } else {
        return Ok(());
    };
    Err(OptionError::Requires {
        option,
        needed: OptionName::Compile,
    })
}

fn check_requires_aot<'a>(flags: &CompileFlags<'a>) -> Result<(), OptionError<'a>> {
    let option = if flags.logs_type_mismatches {
        OptionName::LogTypeMismatches
    } else if !flags.explain.is_empty() {
        OptionName::Explain
    } else if flags.has_huge_heap {
        OptionName::HugeHeap
    } else if flags.is_in_place {
        OptionName::InPlace
    } else if flags.obfuscates {
        OptionName::Obfuscate
    } else if flags.admits_inspector {
        OptionName::Inspector
    } else if flags.allows_code_from_disk {
        OptionName::CodeFromDisk
    } else if let Some(&(key, _)) = flags.developer_words.first() {
        OptionName::Developer(key)
    } else {
        return Ok(());
    };
    Err(OptionError::Requires {
        option,
        needed: OptionName::Aot,
    })
}

fn check_aot_combination<'a>(flags: &CompileFlags<'a>) -> Result<(), OptionError<'a>> {
    if flags.is_cross_compile {
        return Err(OptionError::CrossCompile);
    }
    if flags.allows_code_from_disk && cfg!(bun_hardened) {
        return Err(OptionError::HardenedBunRunsOnlyCompiledCode);
    }
    Ok(())
}

pub(crate) fn explain_set<'a>(values: &[&'a [u8]]) -> Result<ExplainSet, OptionError<'a>> {
    let mut set = ExplainSet::empty();
    for &value in values {
        match EXPLAIN_NAMES.iter().find(|(name, _)| *name == value) {
            Some(&(_, member)) => set |= member,
            None => {
                return Err(OptionError::InvalidValue {
                    option: OptionName::Explain,
                    value,
                });
            }
        }
    }
    Ok(set)
}

fn check_unknown_names<'a>(names: Vec<&[u8]>) -> Result<(), OptionError<'a>> {
    match TrimRequestError::for_unknown_names(names) {
        Some(error) => Err(OptionError::Trim(TrimError::Request(error))),
        None => Ok(()),
    }
}

fn resolve_trim<'a>(flags: &CompileFlags<'a>) -> Result<TrimRequest, OptionError<'a>> {
    let trim = &flags.trim;
    let mut unknown: Vec<&[u8]> = Vec::new();
    let mut allow: Vec<TrimFeature> = Vec::with_capacity(trim.allow.len());
    for &name in &trim.allow {
        match TrimFeature::from_name(name) {
            Some(feature) => allow.push(feature),
            None => unknown.push(name),
        }
    }
    let mut remove: Vec<TrimFeature> = Vec::with_capacity(trim.remove.len());
    for &name in &trim.remove {
        match TrimFeature::from_name(name) {
            Some(feature) => remove.push(feature),
            None => unknown.push(name),
        }
    }
    check_unknown_names(unknown)?;
    if let Some(&name) = remove.iter().find(|name| allow.contains(name)) {
        return Err(OptionError::Trim(TrimError::Request(
            TrimRequestError::AllowedAndRemoved(name),
        )));
    }

    let mut unknown_internal: Vec<&[u8]> = Vec::new();
    let mut remove_internal: Vec<Feature> = Vec::with_capacity(trim.remove_internal.len());
    for &name in &trim.remove_internal {
        match Feature::from_name(name) {
            Some(feature) => remove_internal.push(feature),
            None => unknown_internal.push(name),
        }
    }
    check_unknown_names(unknown_internal)?;

    if let Some(&value) = trim.locales.iter().flatten().find(|tag| tag.is_empty()) {
        return Err(OptionError::InvalidValue {
            option: OptionName::TrimLocales,
            value,
        });
    }

    Ok(TrimRequest {
        removes_unused: trim.asks_to_remove_unused(),
        allow,
        remove,
        remove_internal,
        locales: trim
            .locales
            .as_ref()
            .map(|tags| tags.iter().map(|tag| Box::from(*tag)).collect()),
        logs: trim.logs,
        is_template: trim.is_template,
    })
}

impl CompileSettings {
    pub(crate) fn trim_request(&self) -> &TrimRequest {
        self.aot.as_ref().map_or(&self.trim, |aot| &aot.trim)
    }
}

fn resolve_report_detail(value: &[u8]) -> Result<ReportDetail, OptionError<'_>> {
    match value {
        b"summary" => Ok(ReportDetail::Summary),
        b"functions" => Ok(ReportDetail::Functions),
        b"sites" => Ok(ReportDetail::Sites),
        _ => Err(OptionError::InvalidValue {
            option: OptionName::ReportDetail,
            value,
        }),
    }
}

pub(crate) fn apply_developer_word<'a>(
    key: &'static str,
    value: Option<&'a [u8]>,
    options: &mut AotOptions,
) -> Result<(), OptionError<'a>> {
    let text = value.unwrap_or_default();
    match key {
        "report" => {
            options.build_report = Some(BuildReportRequest {
                path: Box::from(text),
                detail: ReportDetail::Summary,
            })
        }
        "report-detail" => {
            let detail = resolve_report_detail(text)?;
            let missing_report = OptionError::Requires {
                option: OptionName::ReportDetail,
                needed: OptionName::Report,
            };
            options.build_report.as_mut().ok_or(missing_report)?.detail = detail;
        }
        "references" => match text {
            b"narrow" => {}
            b"wide" => options.heap = HeapSize::Huge,
            _ => {
                return Err(OptionError::InvalidValue {
                    option: OptionName::References,
                    value: text,
                });
            }
        },
        "threads" => {
            let count = strings::parse_int::<u32>(text, 10)
                .ok()
                .and_then(NonZeroU32::new);
            let invalid = OptionError::InvalidValue {
                option: OptionName::Threads,
                value: text,
            };
            options.thread_count = Some(count.ok_or(invalid)?);
        }
        "erase-types" => options.erases_types = true,
        "refuse-code-from-disk" => options.loads_code_from_disk = false,
        "separate-programs" => options.separates_programs = true,
        "symbols" if options.obfuscates => {
            return Err(OptionError::DeveloperWord {
                key,
                word: key.as_bytes().to_vec(),
                sentence: b"cannot be used with --obfuscate or --sourcemap=external, which keep function names out of the executable".to_vec(),
            });
        }
        "symbols" => options.emits_symbols = true,
        "no-builtin-modules" => options.omits_builtin_modules = true,
        "out" => options.ir_output_path = Some(Box::from(text)),
        // The other words of --aot-testing are the engine's.
        "testing" if text == b"NoExecutable" => options.writes_no_executable = true,
        _ => {
            let word = option_word(key, value);
            // The engine's table of these words names every pass of the compiler. Without the compiler the build fails whatever the word is.
            let rejected = bun_removable_features::removable_body!(AotCompiler, ReturnDefault, {
                engine::check_option_word(&options.option_words, &word).err()
            });
            if let Some(RejectedOptionWord { word, sentence }) = rejected {
                return Err(OptionError::DeveloperWord {
                    key,
                    word,
                    sentence,
                });
            }
            options.option_words.push(word.into_boxed_slice());
        }
    }
    Ok(())
}

fn option_word(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    if key == "verify-each-pass" {
        return b"check=verify-each-pass".to_vec();
    }
    let mut word = key.as_bytes().to_vec();
    if let Some(value) = value {
        word.push(b'=');
        word.extend_from_slice(value);
    }
    word
}

fn normalize_name(name: &[u8]) -> Vec<u8> {
    name.iter()
        .filter(|byte| !matches!(byte, b'-' | b'_'))
        .map(u8::to_ascii_lowercase)
        .collect()
}

fn suggest(written: &[u8], candidates: &[&'static str]) -> Option<&'static str> {
    let written = normalize_name(written);
    let mut best: Option<(&'static str, usize)> = None;
    for &candidate in candidates {
        let distance = strings::edit_distance(
            written.iter().copied(),
            &normalize_name(candidate.as_bytes()),
        );
        if distance <= MAX_SUGGESTION_DISTANCE
            && best.is_none_or(|(_, smallest)| distance < smallest)
        {
            best = Some((candidate, distance));
        }
    }
    best.map(|(candidate, _)| candidate)
}

pub(crate) fn misplaced_key<'a>(key: &'a [u8], is_inside_compile: bool) -> Option<OptionError<'a>> {
    let is_aot_key = COMPILE_AOT_KEYS.iter().any(|known| known.as_bytes() == key);
    if is_inside_compile {
        (key.starts_with(b"aot") && !is_aot_key).then(|| OptionError::UnknownCompileKey {
            key,
            suggestion: suggest(key, COMPILE_AOT_KEYS),
        })
    } else {
        is_aot_key.then_some(OptionError::KeyBelongsInCompile { key })
    }
}

pub(crate) fn is_aot_requested(cmd: Tag, args: &clap::Args<clap::Help>) -> bool {
    if cmd == Tag::CompileCommand {
        !args.flag(b"--no-aot") && !args.flag(b"--library")
    } else {
        args.flag(b"--aot")
    }
}

fn exit_with_message(message: &[u8]) -> ! {
    print_error_and_notes(message);
    Global::exit(1);
}

fn exit_with_error(error: &OptionError<'_>, origin: RequestOrigin) -> ! {
    let mut message = Vec::new();
    error.write_message(origin, &mut message);
    exit_with_message(&message);
}

pub(crate) fn code_generation_from_strings(exec_argv: &[u8]) -> CodeGenerationFromStrings {
    read_exec_argv(exec_argv).code_generation_from_strings
}

pub(crate) fn prepend_code_generation_flag<'a>(
    level: &'a [u8],
    exec_argv: &[u8],
) -> Result<Vec<u8>, OptionError<'a>> {
    if CodeGenerationFromStrings::from_flag_value(level).is_none() {
        return Err(OptionError::InvalidValue {
            option: OptionName::CodeGenerationFromStrings,
            value: level,
        });
    }
    let level_separator: &[u8] = if level.is_empty() { b"" } else { b"=" };
    let argument_separator: &[u8] = if exec_argv.is_empty() { b"" } else { b" " };
    Ok([
        CODE_GENERATION_FLAG,
        level_separator,
        level,
        argument_separator,
        exec_argv,
    ]
    .concat())
}

fn apply_code_generation_flag(
    args: &clap::Args<clap::Help>,
    ctx: Context<'_>,
    origin: RequestOrigin,
) {
    let Some(level) = args.option(CODE_GENERATION_FLAG) else {
        return;
    };
    if !ctx.bundler_options.compile {
        exit_with_error(
            &OptionError::Requires {
                option: OptionName::CodeGenerationFromStrings,
                needed: OptionName::Compile,
            },
            origin,
        );
    }
    match prepend_code_generation_flag(
        level,
        ctx.bundler_options
            .compile_exec_argv
            .as_deref()
            .unwrap_or_default(),
    ) {
        Ok(exec_argv) => ctx.bundler_options.compile_exec_argv = Some(exec_argv.into_boxed_slice()),
        Err(error) => exit_with_error(&error, origin),
    }
}

fn read_developer_words(
    args: &clap::Args<clap::Help>,
) -> Vec<(&'static str, Option<&'static [u8]>)> {
    let mut words = Vec::new();
    for &(key, name, form) in DEVELOPER_FLAGS {
        let name = name.as_bytes();
        match form {
            Form::Flag => {
                if args.flag(name) {
                    words.push((key, None));
                }
            }
            Form::One => {
                if let Some(value) = args.option(name) {
                    words.push((key, Some(value)));
                }
            }
            Form::Many => words.extend(args.options(name).iter().map(|&value| (key, Some(value)))),
        }
    }
    words
}

fn split_at_commas<'v>(values: &'v [&'static [u8]]) -> impl Iterator<Item = &'static [u8]> + 'v {
    values
        .iter()
        .flat_map(|&value| bun_core::strings::split(value, b","))
}

fn read_build_flags<'c>(
    cmd: Tag,
    args: &clap::Args<clap::Help>,
    ctx: &'c Context<'_>,
) -> CompileFlags<'c> {
    let options = &ctx.bundler_options;
    let no_aot = cmd == Tag::CompileCommand && args.flag(b"--no-aot") && args.flag(b"--aot");
    let locale_lists = args.options(b"--trim-locales");
    CompileFlags {
        is_executable: options.compile,
        aot: is_aot_requested(cmd, args) || no_aot,
        no_aot,
        logs_type_mismatches: args.flag(b"--aot-log-type-mismatches"),
        explain: args.options(b"--explain").to_vec(),
        has_huge_heap: args.flag(b"--aot-huge-heap"),
        is_in_place: args.flag(b"--compile-in-place"),
        omits_function_source: args.flag(b"--no-compile-function-source"),
        obfuscates: args.flag(b"--obfuscate"),
        has_external_source_map: args.option(b"--sourcemap") == Some(b"external"),
        admits_inspector: args.flag(b"--compile-inspector"),
        allows_code_from_disk: args.flag(b"--aot-allow-code-from-disk"),
        trim: TrimFlags {
            removes_unused: args.flag(b"--trim"),
            remove_internal: split_at_commas(args.options(b"--trim-without"))
                .filter(|name| !name.is_empty())
                .collect(),
            locales: (!locale_lists.is_empty()).then(|| split_at_commas(locale_lists).collect()),
            is_template: args.flag(b"--trim-template"),
            ..Default::default()
        },
        developer_words: read_developer_words(args),
        is_cross_compile: !options.compile_target.is_this_bun(),
        exec_argv: options.compile_exec_argv.as_deref().unwrap_or_default(),
    }
}

fn list_and_exit(list: &[u8], origin: RequestOrigin) -> ! {
    if list != b"registry" {
        exit_with_error(
            &OptionError::InvalidValue {
                option: OptionName::List,
                value: list,
            },
            origin,
        );
    }
    if !engine::has_compiler() {
        let mut message = Vec::new();
        CompileFailure::NoCompiler.write_message(origin, &CompileTarget::default(), &mut message);
        exit_with_message(&message);
    }
    let _ = Output::writer().write_all(&report::registry::write());
    Output::flush();
    Global::exit(0);
}

#[cold]
#[inline(never)]
pub(crate) fn parse_build_flags(cmd: Tag, args: &clap::Args<clap::Help>, ctx: Context<'_>) {
    let origin = if cmd == Tag::CompileCommand {
        RequestOrigin::CompileCommand
    } else {
        RequestOrigin::BuildFlag
    };
    if let Some(list) = args.option(b"--aot-list") {
        list_and_exit(list, origin);
    }
    apply_code_generation_flag(args, &mut *ctx, origin);

    let settings = match resolve(&read_build_flags(cmd, args, &ctx)) {
        Ok(settings) => settings,
        Err(error) => exit_with_error(&error, origin),
    };
    let options = &mut ctx.bundler_options;
    if settings.aot.is_some() {
        if args
            .option(b"--sourcemap")
            .is_some_and(|setting| setting != b"none" && setting != b"external")
        {
            bun_core::note!(
                "only --sourcemap=external has an effect with --aot: a compiled program reports the positions of its sources already"
            );
        }
        options.bytecode = false;
        options.output_format = Format::Esm;
        options.compile_target = CompileTarget::default();
    }
    if settings.trim_request().removes_unused && !args.flag(b"--compile-autoload-bunfig") {
        options.compile_autoload_bunfig = false;
    }
    options.aot = settings.aot;
    options.trim = settings.trim;
}

/// `bun test --aot` runs compiled code. `bun run --aot` checks the program and runs it from its source.
fn compiles_before_run(cmd: Tag, args: &clap::Args<clap::Help>) -> bool {
    args.flag(b"--debug-aot")
        || args.flag(b"--aot-log-type-mismatches")
        || (cmd == Tag::TestCommand && args.flag(b"--aot"))
}

pub(crate) fn checks_before_each_run(cmd: Tag, args: &clap::Args<clap::Help>) -> bool {
    if cmd == Tag::RunAsNodeCommand {
        return false;
    }
    args.option(b"--aot-checked").is_some()
        || (args.flag(b"--aot") && !compiles_before_run(cmd, args))
}

#[inline]
pub(crate) fn parse_runtime_flags(cmd: Tag, args: &clap::Args<clap::Help>, ctx: Context<'_>) {
    if cmd == Tag::RunAsNodeCommand {
        return;
    }
    let has_aot_flag = args.option(b"--aot-decode-crash-report").is_some()
        || args.flag(b"--aot-build-id")
        || args.option(b"--aot-graph-fd").is_some()
        || args.option(b"--aot-checked").is_some()
        || args.flag(b"--aot")
        || args.flag(b"--debug-aot")
        || args.flag(b"--aot-log-type-mismatches")
        || args.flag(b"--aot-allow-code-from-disk")
        || args.flag(b"--aot-huge-heap");
    if has_aot_flag {
        apply_runtime_flags(cmd, args, ctx);
    }
}

#[cold]
#[inline(never)]
fn apply_runtime_flags(cmd: Tag, args: &clap::Args<clap::Help>, ctx: Context<'_>) {
    if args.flag(b"--aot-build-id") {
        run_compiled::print_build_id_and_exit();
    }
    if let Some(report) = args.option(b"--aot-decode-crash-report") {
        run_compiled::set_crash_report(report);
    }
    if let Some(descriptor) = args.option(b"--aot-graph-fd") {
        run_compiled::use_graph_descriptor(descriptor);
        return;
    }
    if let Some(check_result) = args.option(b"--aot-checked") {
        run_compiled::use_check_result(check_result);
        return;
    }
    if let Some(descriptor) = args.option(b"--aot-build-test-part") {
        run_compiled::use_test_part_descriptor(descriptor);
    }
    let reports_type_mismatches = args.flag(b"--aot-log-type-mismatches");
    let has_huge_heap = args.flag(b"--aot-huge-heap");
    let compiles = compiles_before_run(cmd, args);
    if has_huge_heap && !compiles {
        exit_with_message(
            b"--aot-huge-heap is only valid with bun build --compile --aot and bun compile",
        );
    }
    let loads_code_from_disk = args.flag(b"--aot-allow-code-from-disk");
    if !(args.flag(b"--aot") || compiles) {
        if loads_code_from_disk {
            exit_with_message(b"--aot-allow-code-from-disk requires --aot");
        }
        return;
    }
    if loads_code_from_disk && cfg!(bun_hardened) {
        exit_with_error(
            &OptionError::HardenedBunRunsOnlyCompiledCode,
            RequestOrigin::BuildFlag,
        );
    }
    check_runtime_conflicts(&ctx, compiles);
    let test_words = bun_core::env_var::BUN_DEBUG_TEST_AOT_WORDS
        .get_not_empty()
        .filter(|_| compiles && cmd == Tag::TestCommand);
    let option_words = test_words
        .into_iter()
        .flat_map(|words| strings::split(words, b","));
    let (part_words, mut option_words): (Vec<&[u8]>, Vec<&[u8]>) =
        option_words.partition(|word| word.starts_with(b"TestRun"));
    let is_part_of_test_files = !run_compiled::images_below_test_part().is_empty()
        && !run_compiled::builds_what_test_parts_share();
    // The functions of a test file are handed to `test` and `describe`, which call each of them once, and what they call often is in another
    // program. Ranked among themselves, three quarters of them would count as warm or hot, and their program is built while other tests run.
    // So they are ranked as those of a very large program are: what has many callers is hot, a loop is warm, the rest is cold.
    // A layer is a part of the run too: who calls its functions often is in the programs above. A run is cut into layers because it is large, and
    // an executable of all of it ranks them that way.
    let is_part_of_run = is_part_of_test_files || run_compiled::builds_what_test_parts_share();
    if is_part_of_run && !option_words.iter().any(|word| word.starts_with(b"heat=")) {
        option_words.push(b"heat=ReadOffStructure");
    }
    let part_limit = |name: &[u8]| {
        (part_words.iter())
            .find_map(|word| word.strip_prefix(name))
            .and_then(|digits| bun_core::fmt::parse_int::<u64>(digits, 10).ok())
    };
    ctx.bundler_options.aot = Some(Box::new(AotOptions {
        test_run_part_files: part_limit(b"TestRunPartFiles:").map(|files| files as u32),
        test_run_is_one_program: part_words.contains(&&b"TestRunLayers:0"[..]),
        source_that_fits_in_memory: (cmd == Tag::TestCommand && compiles)
            .then(|| run_compiled::source_that_fits_in_memory(ctx)),
        is_part_of_test_files,
        entry_points_run_again: cmd == Tag::TestCommand
            && ctx.test_options.repeat_count > 1
            && !run_compiled::builds_what_test_parts_share(),
        // `VirtualMachine::use_isolation_source_provider_cache()`: there the transpiler hands the loader the record of a module, which says that it is TypeScript.
        typescript_drops_absent_exports: cmd == Tag::TestCommand
            && ctx.test_options.isolate
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false),
        imports_are_in_other_images: !run_compiled::images_below_test_part().is_empty(),
        shares_realms: run_compiled::builds_what_test_parts_share()
            || !run_compiled::images_below_test_part().is_empty(),
        runs_in_several_realms: cmd == Tag::TestCommand && ctx.test_options.isolate,
        images_below: ImagesBelow {
            images: run_compiled::images_below_test_part(),
            holds_module: Some(run_compiled::is_module_below_test_part),
            wait_for_all: run_compiled::begins_beside_build_below()
                .then_some(run_compiled::wait_for_program_below),
        },
        replaced_by_tests: run_compiled::replaced_below_test_part(),
        thread_count: run_compiled::threads_of_test_part(),
        option_words: option_words.into_iter().map(Box::from).collect(),
        heap: if has_huge_heap {
            HeapSize::Huge
        } else {
            HeapSize::Standard
        },
        reports_type_mismatches,
        runs_in_place: true,
        checks_only: !compiles,
        runs_tests: cmd == Tag::TestCommand,
        counts_executions: cmd == Tag::TestCommand && compiles && ctx.test_options.coverage.enabled,
        // A test writes a module at run time and imports it, as under plain `bun test`.
        loads_code_from_disk: loads_code_from_disk
            || (cmd == Tag::TestCommand && compiles && !cfg!(bun_hardened)),
        ..Default::default()
    }));
}

fn check_runtime_conflicts(ctx: &Context<'_>, compiles: bool) {
    match (ctx.debug.hot_reload, compiles) {
        (HotReload::None, _) | (_, false) => {}
        (HotReload::Watch, true) if ctx.debug.watch_flag => exit_with_message(
            b"--aot does not support --watch: the program is compiled once, before it starts. Watch without --aot, or run the command again after a change",
        ),
        (_, true) => exit_with_message(
            b"--aot does not support --hot: the program is compiled once, before it starts. Use --hot without --aot, or run the command again after a change",
        ),
    }
    let has_debugger = !matches!(ctx.runtime_options.debugger, Debugger::Unspecified)
        || bun_core::env_var::BUN_INSPECT.get_not_empty().is_some();
    if compiles && has_debugger {
        exit_with_message(b"--aot does not support the debugger (--inspect, BUN_INSPECT) for a program that is compiled. Debug it without --aot");
    }
    if !ctx.runtime_options.eval.script.is_empty() || ctx.runtime_options.interactive {
        exit_with_message(
            b"--aot can't compile code passed with -e, -p or --interactive. Pass a file instead",
        );
    }
}

fn unknown_flag_message(group: &FlagGroup, flag: &clap::UnknownLongFlag<'_>) -> Option<Vec<u8>> {
    if !flag.name.starts_with(b"aot") {
        return None;
    }
    let mut message = Vec::new();
    if group
        .other_params
        .iter()
        .any(|param| param.names.long == Some(flag.name))
    {
        if flag.is_from_bun_options {
            return None;
        }
        message.extend_from_slice(b"--");
        message.extend_from_slice(flag.name);
        message.extend_from_slice(b" is only valid with ");
        message.extend_from_slice(group.other_commands.as_bytes());
        message.push(b'.');
    } else {
        message.extend_from_slice(b"unknown flag --");
        message.extend_from_slice(flag.name);
        message.push(b'.');
        if let Some(suggestion) = suggest(flag.name, group.flags) {
            message.extend_from_slice(b" Did you mean ");
            message.extend_from_slice(suggestion.as_bytes());
            message.push(b'?');
        }
    }
    message.extend_from_slice(b" The --aot flags for this command are ");
    message.extend_from_slice(group.flags.join(", ").as_bytes());
    Some(message)
}

#[cold]
#[inline(never)]
pub(crate) fn reject_unknown_flags(cmd: Tag, unknown: &[clap::UnknownLongFlag<'static>]) {
    let group = match cmd {
        Tag::AutoCommand | Tag::RunCommand | Tag::TestCommand => &RUN_FLAGS,
        Tag::BuildCommand | Tag::CompileCommand => &BUILD_FLAGS,
        _ => return,
    };
    if let Some(message) = unknown
        .iter()
        .find_map(|flag| unknown_flag_message(group, flag))
    {
        exit_with_message(&message);
    }
}
