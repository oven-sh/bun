use bstr::BStr;
use bun_aot::ir::generated::AdmittedCode;
use bun_clap as clap;
use bun_core::strings::const_bytes_eq;
use bun_core::{CodeGenerationFromStrings, Global, Output};
use bun_options_types::context::ContextData;
use bun_options_types::global_cache::GlobalCache;
use bun_removable_features::{Feature, RuntimeRequirement, is_removed, is_trimmed};
use bun_resolver::StandaloneModuleGraph;
use bun_resolver::compiled_program::CompiledProgram;
use bun_trim::OptionRequirement;

use crate::cli::arguments::{
    AUTO_REQUIREMENTS, AUTO_TABLE, CODE_GENERATION_PARAM, HOT_RELOAD_PARAMS, NODE_SHORT_ALIASES,
    ParamType,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RowName {
    Long(&'static [u8]),
    Short(u8),
    Positional,
}

pub(crate) type RequirementRow = (RowName, RuntimeRequirement);

const fn row_names_param(row: RowName, names: &clap::Names) -> bool {
    match row {
        RowName::Long(name) => matches!(names.long, Some(long) if const_bytes_eq(long, name)),
        RowName::Short(name) => {
            names.long.is_none() && matches!(names.short, Some(short) if short == name)
        }
        RowName::Positional => names.long.is_none() && names.short.is_none(),
    }
}

pub(crate) const fn requirements_of<const N: usize>(
    params: &[ParamType],
    rows: &[RequirementRow],
) -> [RuntimeRequirement; N] {
    assert!(params.len() == N);
    let mut requirements = [RuntimeRequirement::Nothing; N];
    let mut index = 0;
    while index < N {
        let mut row = 0;
        while row < rows.len() && !row_names_param(rows[row].0, &params[index].names) {
            row += 1;
        }
        if row == rows.len() {
            panic!("a runtime parameter declares no requirement");
        }
        requirements[index] = rows[row].1;
        index += 1;
    }
    requirements
}

pub(crate) const fn index_of_long(params: &[ParamType], name: &[u8]) -> usize {
    let mut index = 0;
    while index < params.len() {
        if matches!(params[index].names.long, Some(long) if const_bytes_eq(long, name)) {
            return index;
        }
        index += 1;
    }
    panic!("no runtime parameter has this long name")
}

#[derive(Clone, PartialEq, Eq, Debug)]
enum OptionOrigin {
    Flag(Box<[u8]>),
    EnvironmentVariable(&'static str),
    BunfigKey(&'static str),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Obstacle {
    FeatureRemoved,
    NoCommandLine,
    BuiltWithoutFunctionSource,
    RunsOnlyCompiledCode,
    BuiltWithoutInspector,
}

#[derive(Clone, PartialEq, Eq, Debug)]
struct UnusableOption {
    origin: OptionOrigin,
    obstacle: Obstacle,
}

impl UnusableOption {
    /// `--preload` and its kin. `--disallow-code-generation-from-strings=strict` refuses their file in an executable
    /// built without `--aot` too.
    fn loads_file_before_program(&self) -> bool {
        let names_file = match &self.origin {
            OptionOrigin::Flag(label) => {
                matches!(&label[..], b"--preload" | b"--require" | b"--import")
            }
            OptionOrigin::EnvironmentVariable(name) => *name == "BUN_INSPECT_PRELOAD",
            OptionOrigin::BunfigKey(_) => false,
        };
        names_file
            && matches!(
                self.obstacle,
                Obstacle::RunsOnlyCompiledCode | Obstacle::BuiltWithoutFunctionSource
            )
    }

    fn write_message(&self, out: &mut Vec<u8>) {
        self.write_sentence(b" can't be used with this executable", out);
    }

    fn write_warning(&self, out: &mut Vec<u8>) {
        self.write_sentence(b" is ignored by this executable", out);
    }

    fn write_sentence(&self, what_happens: &[u8], out: &mut Vec<u8>) {
        match &self.origin {
            OptionOrigin::Flag(label) => out.extend_from_slice(label),
            OptionOrigin::EnvironmentVariable(name) => out.extend_from_slice(name.as_bytes()),
            OptionOrigin::BunfigKey(key) => {
                out.push(b'"');
                out.extend_from_slice(key.as_bytes());
                out.extend_from_slice(b"\" in bunfig.toml");
            }
        }
        let reason: &[u8] = match self.obstacle {
            Obstacle::FeatureRemoved => b" because --trim removed the feature it needs",
            Obstacle::NoCommandLine => b" because it doesn't include the Bun command line. Run bun instead",
            Obstacle::BuiltWithoutFunctionSource => {
                b" because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag"
            }
            Obstacle::RunsOnlyCompiledCode => {
                b" because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code"
            }
            Obstacle::BuiltWithoutInspector => b". Rebuild it with --compile-inspector",
        };
        out.extend_from_slice(what_happens);
        out.extend_from_slice(reason);
    }
}

pub(crate) const INSPECTOR_REQUIREMENT: RuntimeRequirement =
    RuntimeRequirement::Feature(Feature::Inspector);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct BuildRecord {
    omits_function_source: bool,
    admits_inspector: bool,
    loads_code_from_disk: bool,
}

impl BuildRecord {
    fn obstacle_to(self, requirement: RuntimeRequirement) -> Option<Obstacle> {
        match requirement {
            // The build allowed for files that it has not seen, whoever names them.
            RuntimeRequirement::RuntimeCode if self.loads_code_from_disk => None,
            // What the build proved holds while nothing but the code it saw runs.
            RuntimeRequirement::RuntimeCode | RuntimeRequirement::WholeRuntime
                if self.omits_function_source =>
            {
                Some(Obstacle::BuiltWithoutFunctionSource)
            }
            RuntimeRequirement::RuntimeCode | RuntimeRequirement::WholeRuntime => {
                (!self.admits_inspector).then_some(Obstacle::RunsOnlyCompiledCode)
            }
            RuntimeRequirement::Feature(Feature::Inspector) => {
                (!self.admits_inspector).then_some(Obstacle::BuiltWithoutInspector)
            }
            RuntimeRequirement::Nothing | RuntimeRequirement::Feature(_) => None,
        }
    }
}

fn obstacle_of_removal(requirement: RuntimeRequirement) -> Obstacle {
    match requirement {
        RuntimeRequirement::Feature(feature)
            if Feature::all_outside_compiled_programs().contains(feature) =>
        {
            Obstacle::NoCommandLine
        }
        _ => Obstacle::FeatureRemoved,
    }
}

/// `build`: what the image of the compiled program records, `None` where no compiled program runs.
fn find_obstacle(
    requirement: RuntimeRequirement,
    build: Option<BuildRecord>,
    is_available: impl Fn(RuntimeRequirement) -> bool,
) -> Option<Obstacle> {
    let obstacle = build.and_then(|build| build.obstacle_to(requirement));
    obstacle.or_else(|| (!is_available(requirement)).then_some(obstacle_of_removal(requirement)))
}

#[derive(Copy, Clone)]
pub(crate) struct WrittenOption<'w> {
    pub index: usize,
    pub value: Option<&'w [u8]>,
}

pub(crate) fn walk_option_words<'w>(words: &'w [&'w [u8]]) -> Vec<WrittenOption<'w>> {
    // `AUTO_PARAMS` would retain the help texts in a trimmed executable.
    let params = AUTO_TABLE.params();
    let mut iterator = clap::args::SliceIterator::new(words);
    let mut stream =
        clap::streaming::StreamingClap::over_words(params, &mut iterator, NODE_SHORT_ALIASES);
    let mut options = Vec::new();
    while let Ok(Some(arg)) = stream.next() {
        let names = &arg.param.names;
        if names.long.is_none() && names.short.is_none() {
            break;
        }
        let index = params
            .iter()
            .position(|param| core::ptr::eq(param, arg.param));
        options.push(WrittenOption {
            index: index.expect("the stream returns parameters of its table"),
            value: arg.value,
        });
    }
    options
}

fn label_of(index: usize) -> Vec<u8> {
    let names = &AUTO_TABLE.params()[index].names;
    match (names.long, names.short) {
        (Some(long), _) => [&b"--"[..], long].concat(),
        (None, Some(short)) => vec![b'-', short],
        (None, None) => Vec::new(),
    }
}

fn bootstrap_flag_name(flag: &[u8]) -> &[u8] {
    let text = flag.strip_prefix(b"--").unwrap_or(flag);
    // `append_options_env` leaves a quoted value in the option's word.
    let name_end = text
        .iter()
        .position(|byte| *byte == b'=' || byte.is_ascii_whitespace());
    &text[..name_end.unwrap_or(text.len())]
}

pub(crate) struct ExecArgvOptions {
    pub requirements: Vec<OptionRequirement>,
    pub forbids_text_evaluation: bool,
}

impl ExecArgvOptions {
    fn first_with(&self, requirement: RuntimeRequirement) -> Option<&OptionRequirement> {
        self.requirements
            .iter()
            .find(|option| option.requirement == requirement)
    }

    pub(crate) fn admits_inspector(&self) -> bool {
        self.first_with(INSPECTOR_REQUIREMENT).is_some()
    }

    pub(crate) fn first_that_loads_code(&self) -> Option<&OptionRequirement> {
        let loads_code = |option: &&OptionRequirement| {
            matches!(
                option.requirement,
                RuntimeRequirement::RuntimeCode | RuntimeRequirement::WholeRuntime
            )
        };
        self.requirements.iter().find(loads_code)
    }
}

fn add_requirement(
    requirements: &mut Vec<OptionRequirement>,
    requirement: RuntimeRequirement,
    label: Vec<u8>,
) {
    let option = OptionRequirement {
        requirement,
        label: label.into_boxed_slice(),
    };
    if !requirements.contains(&option) {
        requirements.push(option);
    }
}

fn forbids_text_evaluation(option: &WrittenOption<'_>) -> bool {
    option.index == CODE_GENERATION_PARAM
        && CodeGenerationFromStrings::from_flag_value(option.value.unwrap_or_default()).is_some()
}

fn read_option_words(words: &[&[u8]]) -> ExecArgvOptions {
    let mut requirements = Vec::new();
    // The runtime looks for these in every word, a value or what follows a positional included.
    let needs_library = |word: &&&[u8]| {
        bun_core::is_bootstrap_flag(word)
            && !bun_core::is_stack_trace_limit_flag(word)
            && bootstrap_flag_name(word) != b"trace-env-native-stack"
    };
    for flag in words.iter().filter(needs_library) {
        let label = [&b"--"[..], bootstrap_flag_name(flag)].concat();
        add_requirement(&mut requirements, RuntimeRequirement::WholeRuntime, label);
    }
    let options = walk_option_words(words);
    for option in &options {
        let requirement = AUTO_REQUIREMENTS[option.index];
        if requirement != RuntimeRequirement::Nothing {
            add_requirement(&mut requirements, requirement, label_of(option.index));
        }
        if HOT_RELOAD_PARAMS.contains(&option.index) {
            let reloading = RuntimeRequirement::Feature(Feature::HotReload);
            add_requirement(&mut requirements, reloading, label_of(option.index));
        }
    }
    ExecArgvOptions {
        requirements,
        forbids_text_evaluation: options.iter().any(forbids_text_evaluation),
    }
}

// What a module of the library carries out prints or writes something for whoever started the program, and the program does the same without it.
fn is_only_for_diagnosis(requirement: RuntimeRequirement) -> bool {
    requirement == RuntimeRequirement::WholeRuntime
}

fn find_options_with_obstacle(
    words: &[&[u8]],
    obstacle_to: impl Fn(RuntimeRequirement) -> Option<Obstacle>,
    are_only_for_diagnosis: bool,
) -> impl Iterator<Item = UnusableOption> {
    let requirements = read_option_words(words).requirements.into_iter();
    let asked_for = requirements
        .filter(move |option| is_only_for_diagnosis(option.requirement) == are_only_for_diagnosis);
    asked_for.filter_map(move |option| {
        Some(UnusableOption {
            obstacle: obstacle_to(option.requirement)?,
            origin: OptionOrigin::Flag(option.label),
        })
    })
}

fn find_unusable_option(
    words: &[&[u8]],
    obstacle_to: impl Fn(RuntimeRequirement) -> Option<Obstacle>,
) -> Option<UnusableOption> {
    find_options_with_obstacle(words, obstacle_to, false).next()
}

fn find_ignored_options(
    words: &[&[u8]],
    obstacle_to: impl Fn(RuntimeRequirement) -> Option<Obstacle>,
) -> Vec<UnusableOption> {
    find_options_with_obstacle(words, obstacle_to, true).collect()
}

fn uses_package_manager(cache: GlobalCache) -> bool {
    !matches!(cache, GlobalCache::auto | GlobalCache::disable)
}

// The arguments are checked before the file is read, so an unusable setting comes from the file.
fn find_unusable_bunfig_setting(
    ctx: &ContextData,
    obstacle_to: impl Fn(RuntimeRequirement) -> Option<Obstacle>,
) -> Option<UnusableOption> {
    let settings = [
        (
            "preload",
            RuntimeRequirement::RuntimeCode,
            !ctx.preloads.is_empty(),
        ),
        (
            "serve.static.plugins",
            RuntimeRequirement::RuntimeCode,
            ctx.args
                .serve_plugins
                .as_ref()
                .is_some_and(|plugins| !plugins.is_empty()),
        ),
        (
            "install.auto",
            RuntimeRequirement::Feature(Feature::Install),
            uses_package_manager(ctx.debug.global_cache),
        ),
    ];
    let mut written = settings.into_iter().filter(|(_, _, is_set)| *is_set);
    written.find_map(|(key, requirement, _)| {
        let obstacle = obstacle_to(requirement)?;
        // `ignore_code_of_bunfig` has dealt with it.
        (obstacle != Obstacle::RunsOnlyCompiledCode).then_some(UnusableOption {
            origin: OptionOrigin::BunfigKey(key),
            obstacle,
        })
    })
}

struct OptionWord(Vec<u8>);

impl bun_core::OptionsEnvArg for OptionWord {
    fn from_slice(bytes: &[u8]) -> OptionWord {
        OptionWord(bytes.to_vec())
    }

    fn from_buf(bytes: Vec<u8>) -> OptionWord {
        OptionWord(bytes)
    }
}

pub(crate) fn split_option_words(options: &[u8]) -> Vec<Vec<u8>> {
    // `append_options_env` inserts from index 1.
    let mut words = vec![OptionWord(Vec::new())];
    bun_core::append_options_env(options, &mut words);
    words.into_iter().skip(1).map(|word| word.0).collect()
}

pub(crate) fn read_exec_argv(exec_argv: &[u8]) -> ExecArgvOptions {
    let words = split_option_words(exec_argv);
    let words: Vec<&[u8]> = words.iter().map(Vec::as_slice).collect();
    read_option_words(&words)
}

fn exit_for(option: &UnusableOption) -> ! {
    // Whoever set the flag expects its error, as the engine words it and as an uncaught error is printed.
    if option.loads_file_before_program()
        && bun_core::code_generation_from_strings_by_flags() == CodeGenerationFromStrings::Strict
    {
        bun_core::pretty_errorln!(
            "<r><red>EvalError<r><d>:<r> <b>Code generation from strings disallowed for this context<r>"
        );
        bun_core::pretty_errorln!("<r>\n<d>{}<r>", Global::unhandled_error_bun_version_string);
        Global::exit(1)
    }
    let mut message = Vec::new();
    option.write_message(&mut message);
    Output::err_generic("{}", (BStr::new(&message),));
    Global::exit(1)
}

fn exit_if_unusable(option: Option<UnusableOption>) {
    if let Some(option) = option {
        exit_for(&option);
    }
}

fn compiled_program() -> Option<&'static CompiledProgram> {
    bun_standalone_graph::Graph::get_ref()?.compiled_program()
}

fn build_of_this_executable() -> Option<BuildRecord> {
    let program = compiled_program()?;
    let admitted = bun_jsc::compiled_program::admitted_code_of(program)?;
    Some(BuildRecord {
        omits_function_source: bun_jsc::compiled_program::omits_function_source(program),
        admits_inspector: admitted.contains(AdmittedCode::INSPECTOR),
        loads_code_from_disk: bun_jsc::compiled_program::loads_code_outside_image(program),
    })
}

fn obstacle_in_this_executable(requirement: RuntimeRequirement) -> Option<Obstacle> {
    find_obstacle(
        requirement,
        build_of_this_executable(),
        RuntimeRequirement::is_available,
    )
}

#[inline]
pub(crate) fn refuse_code_without_interpreter() {
    if is_removed(Feature::Interpreter) {
        bun_core::disallow_code_generation_for_removed_interpreter();
    }
}

/// Before `bun_jsc::initialize`, which fixes the engine's options.
pub(crate) fn refuse_code_the_compiler_did_not_see() {
    let admits = bun_jsc::compiled_program::admits_unknown_javascript;
    if compiled_program().is_some_and(|program| !admits(program)) {
        bun_core::disallow_code_generation_for_compiled_program();
    }
}

#[inline]
pub(crate) fn may_refuse_options() -> bool {
    is_trimmed() || compiled_program().is_some()
}

#[cold]
#[inline(never)]
pub(crate) fn reject_unusable_arguments() {
    let words: Vec<&[u8]> = bun_core::argv().iter().skip(1).collect();
    // The parser raises the level behind this. What is refused here is refused in the words of the level.
    if words.contains(&&b"--disallow-code-generation-from-strings=strict"[..]) {
        bun_core::disallow_code_generation_from_strings(CodeGenerationFromStrings::Strict);
    }
    exit_if_unusable(find_unusable_option(&words, obstacle_in_this_executable));
    warn_of_ignored_options(&words);
}

/// `words`: the options of the process, or the `execArgv` of a Worker.
#[cold]
#[inline(never)]
pub(crate) fn warn_of_ignored_options(words: &[&[u8]]) {
    for option in find_ignored_options(words, obstacle_in_this_executable) {
        let mut message = Vec::new();
        option.write_warning(&mut message);
        bun_core::warn!("{}", BStr::new(&message));
    }
}

#[cold]
#[inline(never)]
pub(crate) fn reject_unusable_bunfig_settings(ctx: &mut ContextData) {
    // The file may be there for `bun`. Nobody chose to leave the package manager out of this executable, so it resolves as with "disable".
    if !is_trimmed() && is_removed(Feature::Install) {
        ctx.debug.global_cache = GlobalCache::disable;
    }
    ignore_code_of_bunfig(
        ctx,
        obstacle_in_this_executable(RuntimeRequirement::RuntimeCode),
    );
    exit_if_unusable(find_unusable_bunfig_setting(
        ctx,
        obstacle_in_this_executable,
    ));
}

// The file is the one that happens to lie in the working directory, and it may be there for `bun`.
fn ignore_code_of_bunfig(ctx: &mut ContextData, obstacle_to_code: Option<Obstacle>) {
    if obstacle_to_code == Some(Obstacle::RunsOnlyCompiledCode) {
        ctx.preloads.clear();
        ctx.args.serve_plugins = None;
    }
}

#[cold]
#[inline(never)]
pub(crate) fn reject_unusable_inspect_preload() {
    let obstacle = obstacle_in_this_executable(RuntimeRequirement::RuntimeCode);
    exit_if_unusable(obstacle.map(|obstacle| UnusableOption {
        origin: OptionOrigin::EnvironmentVariable("BUN_INSPECT_PRELOAD"),
        obstacle,
    }));
}

pub(crate) fn is_debugger_admitted() -> bool {
    build_of_this_executable().is_none_or(|build| build.admits_inspector)
}

/// `flag`: the option that asks for the debugger, `None` where `BUN_INSPECT` does.
#[cold]
#[inline(never)]
pub(crate) fn exit_for_unadmitted_debugger(flag: Option<&'static str>) -> ! {
    exit_for(&UnusableOption {
        origin: match flag {
            Some(flag) => OptionOrigin::Flag(Box::from(flag.as_bytes())),
            None => OptionOrigin::EnvironmentVariable("BUN_INSPECT"),
        },
        obstacle: Obstacle::BuiltWithoutInspector,
    })
}
