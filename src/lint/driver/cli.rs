//! The command line of `bun lint`: that of ESLint, what `bun check` has (`--threads`, `--timing`,
//! `--cwd`), and the flags of oxlint that its users have in their scripts.

pub use crate::args::UsageError;
use crate::args::{Argument, Param, error};
use bun_clap as clap;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::NativePlugins;
use bun_lint::options::Json;

/// A flag without a description is understood, and not listed in the help.
pub const PARAMS: &[Param] = &[
    clap::param!(
        "-c, --config <path>             Use this configuration file instead of looking for one"
    ),
    clap::param!("--no-config-lookup              Do not look for a configuration file"),
    clap::param!(
        "--flavor <tool>                 Whose configuration files count where there are both: <b>eslint<r> or <b>oxlint<r>"
    ),
    clap::param!(
        "--rule <rule>...                Configure a rule: <b>--rule 'eqeqeq: [error, smart]'<r>"
    ),
    clap::param!(
        "--global <name>...              Define global variables: <b>--global a,b:true<r>"
    ),
    clap::param!(
        "--parser-options <options>...   Set parser options: <b>--parser-options projectService:true<r>"
    ),
    clap::param!("--ext <ext>...                  Lint files with these extensions too"),
    clap::param!("--fix                           Fix what can be fixed, and write the files"),
    clap::param!(
        "--fix-dry-run                   Fix without writing. The <b>json<r> format has the fixed code"
    ),
    clap::param!(
        "--fix-type <type>...            Only apply fixes of rules of these types: <b>directive<r>, <b>problem<r>, <b>suggestion<r>, <b>layout<r>"
    ),
    clap::param!("--ignore-pattern <pattern>...   Ignore the files that match"),
    clap::param!("--no-ignore                     Lint ignored files too"),
    clap::param!(
        "--no-warn-ignored               Do not warn about an ignored file that is named as an argument"
    ),
    clap::param!("--stdin                         Lint the code on standard input"),
    clap::param!(
        "--stdin-filename <path>         The file name that the code on standard input is linted as"
    ),
    clap::param!("--quiet                         Report errors only"),
    clap::param!(
        "--max-warnings <n>              Exit with 1 if there are more warnings than this"
    ),
    clap::param!(
        "-f, --format <name>             <b>stylish<r> <d>(default)<r>, <b>pretty<r>, <b>json<r>, <b>json-with-metadata<r>, <b>unix<r>, <b>github<r>, <b>agent<r>, <b>checkstyle<r>, <b>junit<r>, <b>gitlab<r>, <b>sarif<r>"
    ),
    clap::param!(
        "--all                           Show every problem <d>(<b>pretty<r><d> and <b>agent<r><d> group identical problems above 50)<r>"
    ),
    clap::param!("-o, --output-file <path>        Write the report to a file"),
    clap::param!("--color                         Always use colors"),
    clap::param!("--no-color                      Never use colors"),
    clap::param!(
        "--no-inline-config              Ignore <b>eslint-disable<r> and other configuration comments"
    ),
    clap::param!(
        "--report-unused-disable-directives  Report <b>eslint-disable<r> comments that disable nothing, as errors"
    ),
    clap::param!(
        "--report-unused-disable-directives-severity <severity>  The same, as <b>off<r>, <b>warn<r> or <b>error<r>"
    ),
    clap::param!(
        "--report-unused-inline-configs <severity>  Report configuration comments that change nothing"
    ),
    clap::param!(
        "--suppress-all                  Tolerate the errors that there are now: write them to <b>eslint-suppressions.json<r>"
    ),
    clap::param!("--suppress-rule <rule>...       The same for the errors of a rule"),
    clap::param!(
        "--suppressions-location <path>  Another file than <b>eslint-suppressions.json<r>"
    ),
    clap::param!("--prune-suppressions            Remove from that file what no longer occurs"),
    clap::param!(
        "--pass-on-unpruned-suppressions  Do not fail if that file has what no longer occurs"
    ),
    clap::param!("--no-error-on-unmatched-pattern  Do not fail if an argument matches no file"),
    clap::param!(
        "--pass-on-no-patterns           Exit with 0 if there are no arguments, instead of linting <b>.<r>"
    ),
    clap::param!("--exit-on-fatal-error           Exit with 2 if a file cannot be parsed"),
    clap::param!(
        "--allow-unsupported             Only warn about rules and files of the configuration that cannot be linted yet"
    ),
    clap::param!(
        "--native-plugin-rules <plugins>  The plugins whose built-in rules run in place of the installed package: <b>import,react-hooks<r> <d>(default: all)<r>"
    ),
    clap::param!(
        "--no-native-plugin-rules        Run the rules of the installed plugins, in JavaScript, not the built-in ones"
    ),
    clap::param!(
        "--print-config <path>           Print the configuration of a file, and lint nothing"
    ),
    clap::param!(
        "--type-aware                    Run the rules that need types, whatever the configuration says"
    ),
    clap::param!("--no-type-aware                 Skip the rules that need types"),
    clap::param!(
        "--infer-globals                 The globals of a file are what the types of its project declare, too"
    ),
    clap::param!(
        "--no-infer-globals              Without a configuration file: those of browsers and of Node.js"
    ),
    clap::param!(
        "-p, --project/--tsconfig <path>  The tsconfig.json for the rules that need types"
    ),
    clap::param!("--type-check                    With <b>--type-aware<r>: report type errors too"),
    clap::param!(
        "-A, --allow <rule>...           With an <b>.oxlintrc.json<r>: turn a rule or a category off"
    ),
    clap::param!("-W, --warn <rule>...            The same: make it a warning"),
    clap::param!("-D, --deny <rule>...            The same: make it an error"),
    clap::param!("--deny-warnings                 Exit with 1 if there are warnings"),
    clap::param!("--silent                        Print no problems"),
    clap::param!(
        "--ignore-path <path>            A file with patterns to ignore, in place of <b>.eslintignore<r>"
    ),
    clap::param!(
        "--disable-nested-config         Use the configuration file of the working directory for every file"
    ),
    clap::param!("--fix-suggestions               Apply suggestions, as oxlint does"),
    clap::param!("--fix-dangerously               Apply every fix and suggestion, as oxlint does"),
    clap::param!(
        "--init                          Write an <b>.oxlintrc.json<r> with the defaults of oxlint"
    ),
    clap::param!("--rules                         List the rules that are built in"),
    clap::param!(
        "--threads <n>                   Number of threads <d>(default: one per CPU core)<r>"
    ),
    clap::param!("--timing                        Print how long each phase took"),
    clap::param!("--cwd <path>                    Set the working directory"),
    clap::param!("-h, --help                      Print this help menu"),
    // The opposites of the above, which ESLint takes too.
    clap::param!("--config-lookup"),
    clap::param!("--ignore"),
    clap::param!("--warn-ignored"),
    clap::param!("--inline-config"),
    clap::param!("--error-on-unmatched-pattern"),
    // ESLint's, with little or nothing to do here.
    clap::param!("--list-files"),
    clap::param!("--stats"),
    clap::param!("--env-info"),
    clap::param!("-v, --version"),
    clap::param!("--debug"),
    clap::param!("--cache"),
    clap::param!("--cache-file <path>"),
    clap::param!("--cache-location <path>"),
    clap::param!("--cache-strategy <strategy>"),
    clap::param!("--concurrency <n>"),
    clap::param!("--flag <flag>..."),
    clap::param!("--parser <name>"),
    clap::param!("--plugin <name>..."),
    clap::param!("--inspect-config"),
    // ESLint 8's.
    clap::param!("--eslintrc"),
    clap::param!("--env <name>..."),
    clap::param!("--rulesdir <path>..."),
    clap::param!("--resolve-plugins-relative-to <path>"),
    clap::param!("--mcp"),
    // oxlint's.
    clap::param!("--lsp"),
    clap::param!("--disable-unicorn-plugin"),
    clap::param!("--disable-oxc-plugin"),
    clap::param!("--disable-typescript-plugin"),
    clap::param!("--import-plugin"),
    clap::param!("--react-plugin"),
    clap::param!("--jsdoc-plugin"),
    clap::param!("--jest-plugin"),
    clap::param!("--vitest-plugin"),
    clap::param!("--jsx-a11y-plugin"),
    clap::param!("--nextjs-plugin"),
    clap::param!("--react-perf-plugin"),
    clap::param!("--promise-plugin"),
    clap::param!("--node-plugin"),
    clap::param!("--vue-plugin"),
];

/// The flags that ESLint has and oxlint has not, which tell whom a run stands in for.
const ONLY_OF_ESLINT: [&[u8]; 36] = [
    b"config-lookup",
    b"rule",
    b"global",
    b"parser-options",
    b"ext",
    b"fix-dry-run",
    b"fix-type",
    b"warn-ignored",
    b"stdin",
    b"stdin-filename",
    b"output-file",
    b"color",
    b"inline-config",
    b"report-unused-inline-configs",
    b"pass-on-no-patterns",
    b"exit-on-fatal-error",
    b"concurrency",
    b"suppress-rule",
    b"suppressions-location",
    b"pass-on-unpruned-suppressions",
    b"stats",
    b"env-info",
    b"parser",
    b"plugin",
    b"cache",
    b"cache-file",
    b"cache-location",
    b"cache-strategy",
    b"flag",
    b"debug",
    b"inspect-config",
    b"mcp",
    b"eslintrc",
    b"env",
    b"rulesdir",
    b"resolve-plugins-relative-to",
];

/// The other way round, beside `--import-plugin` and the like.
const ONLY_OF_OXLINT: [&[u8]; 11] = [
    b"allow",
    b"warn",
    b"deny",
    b"deny-warnings",
    b"silent",
    b"disable-nested-config",
    b"fix-suggestions",
    b"fix-dangerously",
    b"type-check",
    b"rules",
    b"lsp",
];

/// `--flavor`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tool {
    Eslint,
    Oxlint,
}

/// ESLint's `fixTypes`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FixType {
    Directive,
    Problem,
    Suggestion,
    Layout,
}

/// What the command line says. The fields are ESLint's `ParsedCLIOptions`, by their names.
#[derive(Clone, Debug)]
pub struct Options {
    /// ESLint's `_`: files, directories and patterns.
    pub patterns: Vec<Vec<u8>>,
    pub config: Option<Vec<u8>>,
    pub config_lookup: bool,
    pub flavor: Option<Tool>,
    /// The command line has a flag that ESLint has and oxlint has not.
    pub has_flag_of_eslint: bool,
    /// The other way round.
    pub has_flag_of_oxlint: bool,
    pub ext: Option<Vec<Vec<u8>>>,
    pub global: Vec<Vec<u8>>,
    pub parser: Option<Vec<u8>>,
    pub parser_options: Vec<(Vec<u8>, Json)>,
    pub plugin: Vec<Vec<u8>>,
    pub rule: Vec<(Vec<u8>, Json)>,
    pub fix: bool,
    pub fix_dry_run: bool,
    pub fix_type: Option<Vec<FixType>>,
    pub ignore: bool,
    pub ignore_pattern: Vec<Vec<u8>>,
    pub stdin: bool,
    pub stdin_filename: Option<Vec<u8>>,
    pub quiet: bool,
    /// `-1`: any number.
    pub max_warnings: i64,
    pub output_file: Option<Vec<u8>>,
    pub format: Option<Vec<u8>>,
    pub color: Option<bool>,
    pub inline_config: bool,
    pub report_unused_disable_directives: bool,
    pub report_unused_disable_directives_severity: Option<Severity>,
    pub report_unused_inline_configs: Option<Severity>,
    pub error_on_unmatched_pattern: bool,
    pub exit_on_fatal_error: bool,
    pub warn_ignored: bool,
    pub pass_on_no_patterns: bool,
    pub print_config: Option<Vec<u8>>,
    pub suppress_all: bool,
    pub suppress_rule: Option<Vec<Vec<u8>>>,
    pub suppressions_location: Option<Vec<u8>>,
    pub prune_suppressions: bool,
    pub pass_on_unpruned_suppressions: bool,
    pub stats: bool,
    pub env_info: bool,
    pub version: bool,
    pub help: bool,
    /// Flags of ESLint that are accepted and have no effect, as they were written.
    pub without_effect: Vec<&'static [u8]>,
    /// oxlint's `--fix-suggestions`: the first suggestion of a problem is applied like a fix.
    pub fix_suggestions: bool,
    /// oxlint's `--fix-dangerously`.
    pub fix_dangerously: bool,
    /// `--fix` itself, and not another flag that sets [`Options::fix`].
    pub fix_safely: bool,
    /// oxlint's `--rules`: lists the rules, and lints nothing.
    pub rules: bool,
    /// oxlint's `--import-plugin` and `--disable-oxc-plugin`, ..: a plugin by the name that it has
    /// in `plugins`, and whether it is on.
    pub plugins: Vec<(&'static [u8], bool)>,
    /// `--type-aware`, `--no-type-aware`. `None`: as the configuration says.
    pub type_aware: Option<bool>,
    /// The command line has `--type-aware`.
    pub has_type_aware_flag: bool,
    /// `--infer-globals`, `--no-infer-globals`. `None`: only without a configuration file.
    pub infer_globals: Option<bool>,
    pub project: Option<Vec<u8>>,
    /// `0`: the number of cores.
    pub threads: usize,
    pub timing: bool,
    /// Identical problems are not grouped.
    pub all: bool,
    /// Print the files that would be linted, and lint nothing.
    pub list_files: bool,
    /// oxlint's `--init`: write an `.oxlintrc.json` with its defaults.
    pub init: bool,
    /// oxlint's `--type-check`: report what the type checker reports too.
    pub type_check: bool,
    pub cwd: Option<Vec<u8>>,
    /// oxlint's `-A`, `-W`, `-D`, in order: a rule or a category.
    pub filters: Vec<(Severity, Vec<u8>)>,
    pub deny_warnings: bool,
    pub silent: bool,
    pub ignore_path: Option<Vec<u8>>,
    pub disable_nested_config: bool,
    /// What the configuration asks for and cannot be done is a warning, and not an error at the end.
    pub allow_unsupported: bool,
    pub native_plugin_rules: NativePlugins,
    /// The defaults of the flags of `bun format`, for the rule `bun/format`. No flag sets them.
    pub of_bun_format: Option<Box<crate::fmt::cli::Options>>,
    /// Not ESLint 8's `--no-eslintrc`: its configuration files are looked for.
    pub eslintrc: bool,
    /// ESLint 8's `--env`.
    pub env: Vec<Vec<u8>>,
    /// ESLint 8's `--rulesdir`.
    pub rulesdir: Vec<Vec<u8>>,
    /// ESLint 8's `--resolve-plugins-relative-to`.
    pub resolve_plugins_relative_to: Option<Vec<u8>>,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            patterns: Vec::new(),
            config: None,
            config_lookup: true,
            flavor: None,
            has_flag_of_eslint: false,
            has_flag_of_oxlint: false,
            ext: None,
            global: Vec::new(),
            parser: None,
            parser_options: Vec::new(),
            plugin: Vec::new(),
            rule: Vec::new(),
            fix: false,
            fix_dry_run: false,
            fix_type: None,
            ignore: true,
            ignore_pattern: Vec::new(),
            stdin: false,
            stdin_filename: None,
            quiet: false,
            max_warnings: -1,
            output_file: None,
            format: None,
            color: None,
            inline_config: true,
            report_unused_disable_directives: false,
            report_unused_disable_directives_severity: None,
            report_unused_inline_configs: None,
            error_on_unmatched_pattern: true,
            exit_on_fatal_error: false,
            warn_ignored: true,
            pass_on_no_patterns: false,
            print_config: None,
            suppress_all: false,
            suppress_rule: None,
            suppressions_location: None,
            prune_suppressions: false,
            pass_on_unpruned_suppressions: false,
            stats: false,
            env_info: false,
            version: false,
            help: false,
            without_effect: Vec::new(),
            fix_suggestions: false,
            fix_dangerously: false,
            fix_safely: false,
            rules: false,
            plugins: Vec::new(),
            type_aware: None,
            infer_globals: None,
            has_type_aware_flag: false,
            project: None,
            threads: 0,
            timing: false,
            all: false,
            list_files: false,
            init: false,
            type_check: false,
            cwd: None,
            filters: Vec::new(),
            deny_warnings: false,
            silent: false,
            ignore_path: None,
            disable_nested_config: false,
            allow_unsupported: false,
            native_plugin_rules: NativePlugins::All,
            of_bun_format: None,
            eslintrc: true,
            env: Vec::new(),
            rulesdir: Vec::new(),
            resolve_plugins_relative_to: None,
        }
    }
}

/// The elements of optionator's `[String]`.
fn list(value: &[u8]) -> Vec<Vec<u8>> {
    if value.trim_ascii().is_empty() {
        return Vec::new();
    }
    strings::split(value, b",")
        .map(|item| item.trim_ascii().to_vec())
        .collect()
}

pub(crate) fn severity(name: &[u8], value: &[u8]) -> Result<Severity, UsageError> {
    match value {
        b"off" | b"0" => Ok(Severity::Off),
        b"warn" | b"1" => Ok(Severity::Warn),
        b"error" | b"2" => Ok(Severity::Error),
        _ => error(&[
            b"Option ",
            name,
            b": '",
            value,
            b"' not one of off, warn, error, 0, 1, or 2.",
        ]),
    }
}

fn object(name: &[u8], value: &[u8], into: &mut Vec<(Vec<u8>, Json)>) -> Result<(), UsageError> {
    let Some(entries) = bun_lint::linter::parse_levn_object(value) else {
        return error(&[
            b"Invalid value for option '",
            name,
            b"' - expected type Object, received value: ",
            value,
            b".",
        ]);
    };
    merge(into, entries);
    Ok(())
}

/// optionator's `mergeRepeatedObjects`
fn merge(into: &mut Vec<(Vec<u8>, Json)>, entries: Vec<(Vec<u8>, Json)>) {
    for (key, value) in entries {
        match into.iter_mut().find(|it| it.0 == key) {
            Some(entry) => entry.1 = value,
            None => into.push((key, value)),
        }
    }
}

impl Options {
    /// Takes in the flag that is called `name`. `value`: `None` for a flag that takes none.
    /// `is_on`: it is not written `--no-..`.
    pub(crate) fn set(
        &mut self,
        name: &'static [u8],
        value: Option<&[u8]>,
        is_on: bool,
    ) -> Result<(), UsageError> {
        let text = value.unwrap_or_default();
        let owned = || Some(text.to_vec());
        self.has_flag_of_eslint |= ONLY_OF_ESLINT.contains(&name);
        self.has_flag_of_oxlint |= ONLY_OF_OXLINT.contains(&name) || name.ends_with(b"-plugin");
        match name {
            b"config" => self.config = owned(),
            b"config-lookup" => self.config_lookup = is_on,
            b"flavor" => {
                self.flavor = Some(match text {
                    b"eslint" => Tool::Eslint,
                    b"oxlint" => Tool::Oxlint,
                    _ => {
                        return error(&[
                            b"Option flavor: '",
                            text,
                            b"' not one of eslint or oxlint.",
                        ]);
                    }
                })
            }
            b"rule" => object(name, text, &mut self.rule)?,
            b"global" => self.global.extend(list(text)),
            b"parser-options" => object(name, text, &mut self.parser_options)?,
            b"ext" => self.ext.get_or_insert_default().extend(list(text)),
            b"fix" => (self.fix, self.fix_safely) = (is_on, is_on),
            b"fix-dry-run" => self.fix_dry_run = is_on,
            b"fix-type" => {
                for item in list(text) {
                    self.fix_type.get_or_insert_default().push(match &item[..] {
                        b"directive" => FixType::Directive,
                        b"problem" => FixType::Problem,
                        b"suggestion" => FixType::Suggestion,
                        b"layout" => FixType::Layout,
                        _ => {
                            return error(&[
                                b"Invalid Options:\n- 'fixTypes' must be an array of any of \"directive\", \"problem\", \"suggestion\", and \"layout\".",
                            ]);
                        }
                    });
                }
            }
            b"ignore-pattern" => self.ignore_pattern.push(text.to_vec()),
            b"ignore" => self.ignore = is_on,
            b"warn-ignored" => self.warn_ignored = is_on,
            b"stdin" => self.stdin = is_on,
            b"stdin-filename" => self.stdin_filename = owned(),
            b"quiet" => self.quiet = is_on,
            b"max-warnings" => match std::str::from_utf8(text)
                .ok()
                .and_then(|it| it.parse().ok())
            {
                Some(count) => self.max_warnings = count,
                None => {
                    return error(&[
                        b"Invalid value for option 'max-warnings' - expected type Int, received value: ",
                        text,
                        b".",
                    ]);
                }
            },
            b"format" => self.format = owned(),
            b"output-file" => self.output_file = owned(),
            b"color" => self.color = Some(is_on),
            b"inline-config" => self.inline_config = is_on,
            b"report-unused-disable-directives" => self.report_unused_disable_directives = is_on,
            b"report-unused-disable-directives-severity" => {
                self.report_unused_disable_directives_severity = Some(severity(name, text)?);
            }
            b"report-unused-inline-configs" => {
                self.report_unused_inline_configs = Some(severity(name, text)?)
            }
            b"error-on-unmatched-pattern" => self.error_on_unmatched_pattern = is_on,
            b"pass-on-no-patterns" => self.pass_on_no_patterns = is_on,
            b"exit-on-fatal-error" => self.exit_on_fatal_error = is_on,
            b"print-config" => self.print_config = owned(),
            b"type-aware" => (self.type_aware, self.has_type_aware_flag) = (Some(is_on), is_on),
            b"infer-globals" => self.infer_globals = Some(is_on),
            b"project" => self.project = owned(),
            b"threads" | b"concurrency" => match (name, text) {
                (b"concurrency", b"auto" | b"off") => {}
                _ => match bun_core::fmt::parse_decimal::<usize>(text) {
                    // For oxlint 0 is as many as there are cores.
                    Some(count) if count > 0 || name == b"threads" => self.threads = count,
                    _ if name == b"concurrency" => {
                        return error(&[
                            b"Option concurrency: '",
                            text,
                            b"' is not a positive integer, 'auto' or 'off'.",
                        ]);
                    }
                    _ => {
                        return error(&[b"--threads takes a number, not \"", text, b"\"."]);
                    }
                },
            },
            b"timing" => self.timing = is_on,
            b"all" => self.all = is_on,
            b"list-files" => self.list_files = is_on,
            b"init" => self.init = is_on,
            b"cwd" => self.cwd = owned(),
            b"help" => self.help = is_on,
            b"version" => self.version = is_on,
            b"suppress-all" => self.suppress_all = is_on,
            b"suppress-rule" => self
                .suppress_rule
                .get_or_insert_default()
                .extend(list(text)),
            b"suppressions-location" => self.suppressions_location = owned(),
            b"prune-suppressions" => self.prune_suppressions = is_on,
            b"pass-on-unpruned-suppressions" => self.pass_on_unpruned_suppressions = is_on,
            b"stats" => self.stats = is_on,
            b"env-info" => self.env_info = is_on,
            b"parser" => self.parser = owned(),
            b"plugin" => self.plugin.extend(list(text)),
            b"allow" => self.filters.push((Severity::Off, text.to_vec())),
            b"warn" => self.filters.push((Severity::Warn, text.to_vec())),
            b"deny" => self.filters.push((Severity::Error, text.to_vec())),
            b"deny-warnings" => self.deny_warnings = is_on,
            b"silent" => self.silent = is_on,
            b"ignore-path" => self.ignore_path = owned(),
            b"disable-nested-config" => self.disable_nested_config = is_on,
            b"allow-unsupported" => self.allow_unsupported = is_on,
            b"native-plugin-rules" => match NativePlugins::parse(text) {
                Ok(which) => self.native_plugin_rules = which,
                Err(name) => {
                    return error(&[
                        b"Option native-plugin-rules: '",
                        name,
                        b"' not one of ",
                        NativePlugins::names()
                            .collect::<Vec<_>>()
                            .join(", ")
                            .as_bytes(),
                        b".",
                    ]);
                }
            },
            b"eslintrc" => self.eslintrc = is_on,
            b"env" => self.env.extend(list(text)),
            b"rulesdir" => self.rulesdir.extend(list(text)),
            b"resolve-plugins-relative-to" => self.resolve_plugins_relative_to = owned(),
            b"fix-suggestions" => (self.fix, self.fix_suggestions) = (self.fix || is_on, is_on),
            b"fix-dangerously" => (self.fix, self.fix_dangerously) = (self.fix || is_on, is_on),
            // Type errors are what `bun check` reports.
            b"type-check" => self.type_check = is_on,
            b"rules" => self.rules = is_on,
            _ if is_on && name.ends_with(b"-plugin") => {
                let plugin = &name[..name.len() - b"-plugin".len()];
                self.plugins.push(match plugin.strip_prefix(b"disable-") {
                    Some(plugin) => (plugin, false),
                    None => (plugin, true),
                });
            }
            b"cache-strategy" if !matches!(text, b"metadata" | b"content") => {
                return error(&[
                    b"Option cache-strategy: '",
                    text,
                    b"' not one of metadata or content.",
                ]);
            }
            b"debug" | b"flag" | b"cache-file" | b"cache-location" | b"cache-strategy" => {}
            _ => {
                if is_on && !self.without_effect.contains(&name) {
                    self.without_effect.push(name);
                }
            }
        }
        Ok(())
    }

    /// As `--rule` with what `rules` is.
    pub(crate) fn add_rules(&mut self, rules: Vec<(Vec<u8>, Json)>) {
        merge(&mut self.rule, rules);
    }

    /// As `--parser-options` with what `options` is.
    pub(crate) fn add_parser_options(&mut self, options: Vec<(Vec<u8>, Json)>) {
        merge(&mut self.parser_options, options);
    }

    /// What is set so far was not written for ESLint or for oxlint.
    pub(crate) fn forget_whose_flags_it_has(&mut self) {
        self.has_flag_of_eslint = false;
        self.has_flag_of_oxlint = false;
        self.has_type_aware_flag = false;
    }

    /// `args`: what follows `lint` on the command line.
    pub fn parse(args: &[&[u8]]) -> Result<Options, UsageError> {
        Options::default().with(args)
    }

    /// The same, where a flag that is not there is as `defaults` says: [`crate::bunfig::lint`].
    pub fn parse_over(mut defaults: Options, args: &[&[u8]]) -> Result<Options, UsageError> {
        let alone = Options::parse(args)?;
        let names = |flag: &[u8]| {
            args.iter().any(|arg| {
                let name = arg.strip_prefix(b"--").unwrap_or_default();
                name.strip_prefix(b"no-").unwrap_or(name).starts_with(flag)
            })
        };
        // ESLint refuses the flag and `..-severity` together. Either takes the place of what is there.
        if names(b"report-unused-disable-directives") {
            defaults.report_unused_disable_directives = false;
            defaults.report_unused_disable_directives_severity = None;
        }
        // ESLint refuses `--fix-type` in a run that fixes nothing. As a default it waits for one that does.
        if !alone.fix && !alone.fix_dry_run {
            defaults.fix_type = None;
        }
        defaults.with(args)
    }

    fn with(self, args: &[&[u8]]) -> Result<Options, UsageError> {
        let mut options = self;
        // What oxlint writes differently.
        let (mut rewritten, count): (Vec<&[u8]>, usize) = (Vec::new(), args.len());
        for (at, arg) in args.iter().copied().enumerate() {
            match arg {
                b"-V" => rewritten.push(b"--version"),
                // The opposite of a flag that takes a value.
                b"--no-native-plugin-rules" => rewritten.push(b"--native-plugin-rules=false"),
                _ if arg.starts_with(b"--debug=") => {
                    let written = &arg[b"--debug=".len()..];
                    let cannot_parse = [b"couldn't parse `", written, b"`: "].concat();
                    for option in strings::split(written, b",") {
                        rewritten.push(match option {
                            b"files" if written == b"files" => b"--list-files",
                            b"files" => {
                                return error(&[
                                    &cannot_parse[..],
                                    b"debug option 'files' cannot be combined with other debug options",
                                ]);
                            }
                            b"timings" => b"--timing",
                            _ => {
                                return error(&[
                                    &cannot_parse[..],
                                    b"'",
                                    option,
                                    b"' is not a known debug option",
                                ]);
                            }
                        });
                    }
                }
                // It takes no file.
                b"--print-config"
                    if args.get(at + 1).is_none_or(|next| next.starts_with(b"-"))
                        || at + 1 == count =>
                {
                    rewritten.extend([&b"--print-config"[..], b"__placeholder__.js"]);
                }
                arg => rewritten.push(arg),
            }
        }
        crate::args::parse(PARAMS, &rewritten, &mut |argument| match argument {
            Argument::Flag { name, value, is_on } => options.set(name, value, is_on),
            Argument::Positional(pattern) => {
                options.patterns.push(pattern.to_vec());
                Ok(())
            }
        })?;
        Ok(options)
    }
}
