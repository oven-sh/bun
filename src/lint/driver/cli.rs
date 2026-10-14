//! The command line of `bun lint`: that of ESLint, what `bun check` has (`--threads`, `--timing`,
//! `--cwd`), and the flags of oxlint that its users have in their scripts.

use crate::args::{Argument, Group, Param, error};
pub use crate::args::{Help, UsageError};
use crate::configs::{Flavor, is_category, plugin_shorthand};
use crate::paths;
use bun_clap as clap;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{NativePlugins, parse_rule_id};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;

const RULES: &[Param] = &[
    clap::param!("-c, --config <path>             Use this config file instead of looking for one"),
    clap::param!("--no-config-lookup              Do not look for a config file"),
    clap::param!(
        "--rule <rule>...                Set a rule: <b>--rule 'eqeqeq: [error, smart]'<r>"
    ),
    clap::param!("--rules                         List the built-in rules"),
    clap::param!("--explain <rule>                Print the documentation of a rule"),
    clap::param!("--init                          Add a <b>[lint]<r> section to <b>bunfig.toml<r>"),
    clap::param!(
        "--global <name>...              Define global variables: <b>--global a,b:true<r>"
    ),
    clap::param!(
        "--no-inline-config              Ignore <b>eslint-disable<r> and other config comments"
    ),
    clap::param!(
        "--report-unused-disable-directives  Report <b>eslint-disable<r> comments that disable nothing"
    ),
    clap::param!("--print-config <path>           Print the config for a file and exit"),
    clap::param!(
        "--doctor                        Show which rules run natively and which packages you can remove"
    ),
    clap::param!(
        "--allow-unsupported             Warn instead of failing when the config has a rule or file that is not supported"
    ),
];

const FILES: &[Param] = &[
    clap::param!("--staged                        Only lint files that are staged in git"),
    clap::param!(
        "--changed <ref>?                Only lint files that differ from a branch or commit <d>(default: the default branch)<r>"
    ),
    clap::param!("--ignore-pattern <pattern>...   Skip files that match this pattern"),
    clap::param!(
        "--ignore-path <path>            Read ignore patterns from this file instead of <b>.eslintignore<r>"
    ),
    clap::param!("--no-ignore                     Lint ignored files too"),
    clap::param!("--ext <ext>...                  Also lint files with these extensions"),
    clap::param!("--stdin                         Lint code from standard input"),
    clap::param!(
        "--stdin-filename <path>         The file name to use for code from standard input"
    ),
    clap::param!("--list-files                    Print the files that would be linted and exit"),
    clap::param!("--no-error-on-unmatched-pattern  Do not fail when an argument matches no file"),
    clap::param!("--cwd <path>                    Set the working directory"),
];

const OUTPUT: &[Param] = &[
    clap::param!(
        "-f, --format <name>             <b>pretty<r> <d>(default)<r>, <b>stylish<r>, <b>json<r>, <b>json-with-metadata<r>, <b>unix<r>, <b>github<r>, <b>agent<r>, <b>checkstyle<r>, <b>junit<r>, <b>gitlab<r>, <b>sarif<r>"
    ),
    clap::param!(
        "--all                           Show every problem <d>(<b>pretty<r><d> and <b>agent<r><d> group identical problems above 50)<r>"
    ),
    clap::param!("-o, --output-file <path>        Write the report to a file"),
    clap::param!("--quiet                         Report errors only"),
    clap::param!(
        "--max-warnings <n>              Exit with 1 if there are more warnings than this"
    ),
    clap::param!("--color                         Always use colors"),
    clap::param!("--no-color                      Never use colors"),
    clap::param!("--timing                        Print how long each phase took"),
];

const FIXING: &[Param] = &[
    clap::param!("--fix                           Fix problems and write the files"),
    clap::param!(
        "--fix-dry-run                   Fix without writing. The <b>json<r> format has the fixed code"
    ),
    clap::param!(
        "--fix-type <type>...            Only apply fixes from rules of these types: <b>directive<r>, <b>problem<r>, <b>suggestion<r>, <b>layout<r>"
    ),
    clap::param!("--fix-suggestions               Apply suggestions"),
    clap::param!(
        "--fix-dangerously               Apply every fix and suggestion, even those that can change behavior"
    ),
];

const TYPES: &[Param] = &[
    clap::param!("--type-aware                    Also run the rules that need types"),
    clap::param!("--no-type-aware                 Skip the rules that need types"),
    clap::param!(
        "--tsconfig <path>               Use this tsconfig.json for the rules that need types"
    ),
    clap::param!("--type-check                    With <b>--type-aware<r>, report type errors too"),
    clap::param!(
        "--infer-globals                 Also treat what the project's types declare as globals"
    ),
    clap::param!("--no-infer-globals              Do not take globals from the project's types"),
];

const OTHER: &[Param] = &[
    clap::param!(
        "--threads <n>                   Number of threads <d>(default: one per CPU core)<r>"
    ),
    clap::param!("-v, --version                   Print the version of Bun"),
    clap::param!(
        "-h, --help                      Print the common flags. With <b>--all<r>, every flag"
    ),
    clap::param!("--help-all                      The same as <b>--help --all<r>"),
];

const OF_ESLINT: &[Param] = &[
    clap::param!(
        "--flavor <tool>                 Use the <b>eslint<r> or the <b>oxlint<r> config in a project that has both"
    ),
    clap::param!("-p, --project <path>            The same as <b>--tsconfig<r>"),
    clap::param!(
        "--parser-options <options>...   Set parser options: <b>--parser-options projectService:true<r>"
    ),
    clap::param!("--parser <name>                 Parse files with this package"),
    clap::param!("--plugin <name>...              Load ESLint plugins: paths or package names"),
    clap::param!(
        "--native-plugin-rules <plugins>  Use the built-in rules for these plugins only: <b>import,react-hooks<r> <d>(default: all)<r>"
    ),
    clap::param!(
        "--no-native-plugin-rules        Run plugin rules from the installed packages, in JavaScript"
    ),
    clap::param!(
        "--report-unused-disable-directives-severity <severity>  Report unused <b>eslint-disable<r> comments as <b>off<r>, <b>warn<r> or <b>error<r>"
    ),
    clap::param!(
        "--report-unused-inline-configs <severity>  Report config comments that change nothing"
    ),
    clap::param!(
        "--no-warn-ignored               Do not warn when an argument names an ignored file"
    ),
    clap::param!(
        "--suppress-all                  Record the current errors in <b>eslint-suppressions.json<r> and stop reporting them"
    ),
    clap::param!("--suppress-rule <rule>...       The same, for the errors of one rule"),
    clap::param!(
        "--suppressions-location <path>  Use this file instead of <b>eslint-suppressions.json<r>"
    ),
    clap::param!(
        "--prune-suppressions            Remove recorded errors that no longer occur from that file"
    ),
    clap::param!(
        "--pass-on-unpruned-suppressions  Do not fail when that file has errors that no longer occur"
    ),
    clap::param!(
        "--pass-on-no-patterns           Exit with 0 when there are no arguments, instead of linting <b>.<r>"
    ),
    clap::param!("--exit-on-fatal-error           Exit with 2 if a file cannot be parsed"),
    clap::param!("--concurrency <n>               The same as <b>--threads<r>"),
    clap::param!(
        "--env-info                      Print the versions of Bun, ESLint and TypeScript"
    ),
    clap::param!("--stats                         No effect"),
    clap::param!("--debug                         No effect"),
    clap::param!("--flag <flag>...                No effect"),
    clap::param!("--cache                         No effect. Every run lints every file"),
    clap::param!("--cache-file <path>             No effect"),
    clap::param!("--cache-location <path>         No effect"),
    clap::param!("--cache-strategy <strategy>     No effect"),
    clap::param!("--inspect-config                Not supported"),
    clap::param!("--mcp                           Not supported"),
    clap::param!("--no-eslintrc                   ESLint 8: do not look for <b>.eslintrc<r> files"),
    clap::param!("--env <name>...                 ESLint 8: turn on these environments"),
    clap::param!("--rulesdir <path>...            ESLint 8: load rules from these directories"),
    clap::param!(
        "--resolve-plugins-relative-to <path>  ESLint 8: look for plugins from this directory"
    ),
];

const OF_OXLINT: &[Param] = &[
    clap::param!("-A, --allow <rule>...           Turn off a rule or a category"),
    clap::param!("-W, --warn <rule>...            Make a rule or a category a warning"),
    clap::param!("-D, --deny <rule>...            Make a rule or a category an error"),
    clap::param!("--deny-warnings                 Exit with 1 if there are warnings"),
    clap::param!("--silent                        Print no problems"),
    clap::param!(
        "--disable-nested-config         Use the config file in the working directory for every file"
    ),
    clap::param!("--lsp                           Not supported"),
    clap::param!("--import-plugin                 Turn on the <b>import<r> plugin"),
    clap::param!("--react-plugin                  Turn on the <b>react<r> plugin"),
    clap::param!("--jsdoc-plugin                  Turn on the <b>jsdoc<r> plugin"),
    clap::param!("--jest-plugin                   Turn on the <b>jest<r> plugin"),
    clap::param!("--vitest-plugin                 Turn on the <b>vitest<r> plugin"),
    clap::param!("--jsx-a11y-plugin               Turn on the <b>jsx-a11y<r> plugin"),
    clap::param!("--nextjs-plugin                 Turn on the <b>nextjs<r> plugin"),
    clap::param!("--react-perf-plugin             Turn on the <b>react-perf<r> plugin"),
    clap::param!("--promise-plugin                Turn on the <b>promise<r> plugin"),
    clap::param!("--node-plugin                   Turn on the <b>node<r> plugin"),
    clap::param!("--vue-plugin                    Turn on the <b>vue<r> plugin"),
    clap::param!("--disable-unicorn-plugin        Turn off the <b>unicorn<r> plugin"),
    clap::param!("--disable-oxc-plugin            Turn off the <b>oxc<r> plugin"),
    clap::param!("--disable-typescript-plugin     Turn off the <b>typescript<r> plugin"),
];

/// Flags that `--help` lists in their `--no-..` form.
const OPPOSITES: &[Param] = &[
    clap::param!("--config-lookup"),
    clap::param!("--ignore"),
    clap::param!("--warn-ignored"),
    clap::param!("--inline-config"),
    clap::param!("--error-on-unmatched-pattern"),
    clap::param!("--eslintrc"),
];

pub const HELP: Help = Help {
    groups: &[
        Group {
            title: "Rules",
            params: RULES,
        },
        Group {
            title: "Files",
            params: FILES,
        },
        Group {
            title: "Output",
            params: OUTPUT,
        },
        Group {
            title: "Fixing",
            params: FIXING,
        },
        Group {
            title: "Types",
            params: TYPES,
        },
        Group {
            title: "Other",
            params: OTHER,
        },
        Group {
            title: "Compatibility with ESLint",
            params: OF_ESLINT,
        },
        Group {
            title: "Compatibility with oxlint",
            params: OF_OXLINT,
        },
    ],
    common: &[
        b"fix",
        b"staged",
        b"changed",
        b"rule",
        b"rules",
        b"explain",
        b"type-aware",
        b"quiet",
        b"max-warnings",
        b"init",
        b"doctor",
    ],
};

const _: () = assert!(
    HELP.describes_every_flag(),
    "A flag of `bun lint` has no description, so `--help --all` leaves it out."
);

pub(crate) const PARAMS: &[Param] = clap::concat_params!(
    RULES, FILES, OUTPUT, FIXING, TYPES, OTHER, OF_ESLINT, OF_OXLINT, OPPOSITES
);

/// Flags only ESLint has. A flag never picks the tool. These lists only let a run reject flags that can't work with its config.
const ONLY_OF_ESLINT: [&[u8]; 35] = [
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

/// Flags only oxlint has, besides `--import-plugin` and friends. Flags that `--help` lists as Bun's own don't belong here.
const ONLY_OF_OXLINT: [&[u8]; 8] = [
    b"allow",
    b"warn",
    b"deny",
    b"deny-warnings",
    b"silent",
    b"disable-nested-config",
    b"rules",
    b"lsp",
];

/// Those of [`ONLY_OF_ESLINT`] that nothing can be done about with a configuration of oxlint.
const NOTHING_TO_OXLINT: [&[u8]; 3] = [b"ext", b"parser", b"report-unused-inline-configs"];

/// Those that ESLint 8 has and ESLint 9 has not.
const ONLY_OF_ESLINT_8: [&[u8]; 4] = [
    b"eslintrc",
    b"env",
    b"rulesdir",
    b"resolve-plugins-relative-to",
];

/// A flag of the command line that only one of the two tools has.
#[derive(Clone, Debug)]
pub struct OfOneTool {
    tool: Tool,
    name: &'static [u8],
    value: Vec<u8>,
    is_on: bool,
}

impl OfOneTool {
    /// Whether the flag can't work in a run that uses a `flavor` config.
    fn means_nothing_to(&self, flavor: Flavor) -> bool {
        let is_of_eslint_8 = ONLY_OF_ESLINT_8.contains(&self.name);
        match (self.tool, flavor) {
            // The opposite of `--no-eslintrc` asks for nothing.
            _ if self.name == b"eslintrc" && self.is_on => false,
            (Tool::Eslint, Flavor::Oxlint) => {
                is_of_eslint_8 || NOTHING_TO_OXLINT.contains(&self.name)
            }
            (Tool::Eslint, Flavor::Eslint) => is_of_eslint_8,
            (Tool::Eslint, Flavor::EslintRc | Flavor::BuiltIn) | (Tool::Oxlint, Flavor::Oxlint) => {
                false
            }
            // Without a config file every built-in rule is available, so there are no plugins to turn on or off.
            (Tool::Oxlint, Flavor::BuiltIn) => self.name.ends_with(b"-plugin"),
            (Tool::Oxlint, _) => match self.name {
                b"allow" | b"warn" | b"deny" => is_category(&self.value),
                name => name.ends_with(b"-plugin"),
            },
        }
    }

    /// As it is written, and whose it is.
    fn written(&self) -> (Vec<u8>, &'static [u8]) {
        let flag: Vec<u8> = match self.name {
            b"allow" => b"-A".to_vec(),
            b"warn" => b"-W".to_vec(),
            b"deny" => b"-D".to_vec(),
            name if self.is_on => [b"--", name].concat(),
            name => [b"--no-", name].concat(),
        };
        let space: &[u8] = if self.value.is_empty() { b"" } else { b" " };
        let whose: &[u8] = match self.tool {
            Tool::Oxlint => b"oxlint",
            Tool::Eslint if ONLY_OF_ESLINT_8.contains(&self.name) => b"ESLint 8",
            Tool::Eslint => b"ESLint",
        };
        ([&flag[..], space, &self.value].concat(), whose)
    }
}

/// `--flavor`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tool {
    Eslint,
    Oxlint,
}

pub(crate) const INVALID_FIX_TYPE: &[u8] = b"Invalid Options:\n- 'fixTypes' must be an array of any of \"directive\", \"problem\", \"suggestion\", and \"layout\".";

/// ESLint's `fixTypes`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FixType {
    Directive,
    Problem,
    Suggestion,
    Layout,
}

/// One entry of `[[lint.overrides]]`.
#[derive(Clone, Debug, Default)]
pub struct Override {
    /// Globs matched against the path relative to the working directory. A glob without a slash matches the file name.
    pub files: Vec<Vec<u8>>,
    pub excluded: Vec<Vec<u8>>,
    pub rules: Vec<(Vec<u8>, Json)>,
    /// bunfig.toml location of each entry in `rules`.
    pub places: Vec<crate::bunfig::RuleOfBunfig>,
    pub globals: Vec<(Vec<u8>, Json)>,
    pub settings: Vec<(Vec<u8>, Json)>,
}

/// What the command line says. The fields are ESLint's `ParsedCLIOptions`, by their names.
#[derive(Clone, Debug)]
pub struct Options {
    /// ESLint's `_`: files, directories and patterns.
    pub patterns: Vec<Vec<u8>>,
    pub config: Option<Vec<u8>>,
    pub config_lookup: bool,
    pub flavor: Option<Tool>,
    /// In the order of the command line.
    pub of_one_tool: Vec<OfOneTool>,
    pub ext: Option<Vec<Vec<u8>>>,
    pub global: Vec<Vec<u8>>,
    /// `[lint.globals]` from bunfig.toml. `--global` is applied after it.
    pub globals: Vec<(Vec<u8>, Json)>,
    pub parser: Option<Vec<u8>>,
    pub parser_options: Vec<(Vec<u8>, Json)>,
    /// `[lint.settings]` from bunfig.toml. Same as `settings` in an ESLint or oxlint config. There's no flag for it.
    pub settings: Vec<(Vec<u8>, Json)>,
    pub plugin: Vec<Vec<u8>>,
    /// About the first entries of `plugin`, which came from `plugins` in `[lint]`.
    pub plugins_of_bunfig: Vec<crate::bunfig::PluginOfBunfig>,
    pub rule: Vec<(Vec<u8>, Json)>,
    /// bunfig.toml locations for the first entries of `rule`, which came from `[lint.rules]`.
    pub rules_of_bunfig: Vec<crate::bunfig::RuleOfBunfig>,
    /// The bunfig that was read, as written: `bunfig.toml`, or the path from `bun --config=<path> lint`.
    pub bunfig: Vec<u8>,
    /// It has a `[lint]` section, which was read.
    pub has_section_of_bunfig: bool,
    /// `bun --config=<path>` names it.
    pub is_bunfig_named: bool,
    /// [`Options::config`] is what bunfig.toml says.
    pub is_config_of_bunfig: bool,
    /// [`Options::suppressions_location`] is what the flag says.
    pub is_suppressions_location_of_flag: bool,
    /// `[[lint.overrides]]` from bunfig.toml. There's no flag for it.
    pub overrides: Vec<Override>,
    /// Only set if there are `overrides`. The command line's options on their own, because its rules and globals apply
    /// after the overrides.
    pub of_command_line: Option<Box<Options>>,
    pub fix: bool,
    pub fix_dry_run: bool,
    pub fix_type: Option<Vec<FixType>>,
    pub ignore: bool,
    pub ignore_pattern: Vec<Vec<u8>>,
    /// How many of them, the first, are of bunfig.toml: those start where that file is.
    pub ignore_patterns_of_bunfig: usize,
    /// `--staged`, `--changed`
    pub only: Option<crate::git::Only>,
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
    /// Empty: no file is named, as for oxlint.
    pub print_config: Option<Vec<u8>>,
    /// Report what a run would do with this config, without linting.
    pub doctor: bool,
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
    /// Print this rule's docs page, without linting.
    pub explain: Option<Vec<u8>>,
    /// oxlint's `--import-plugin` and `--disable-oxc-plugin`, ..: a plugin by the name that it has
    /// in `plugins`, and whether it is on.
    pub plugins: Vec<(&'static [u8], bool)>,
    /// `--type-aware`, `--no-type-aware`. `None`: as the configuration says.
    pub type_aware: Option<bool>,
    /// `--infer-globals`, `--no-infer-globals`. `None`: only without a configuration file.
    pub infer_globals: Option<bool>,
    /// `--infer-globals=fast`: `InferGlobals::ByOptions` without a configuration file. It is to become what is done there
    /// without a flag, once it costs a project that reports no name next to nothing.
    pub infers_globals_by_options: bool,
    pub tsconfig: Option<Vec<u8>>,
    /// `0`: the number of cores.
    pub threads: usize,
    pub timing: bool,
    /// Identical problems are not grouped.
    pub all: bool,
    /// Print the files that would be linted, and lint nothing.
    pub list_files: bool,
    /// Add `[lint]` to bunfig.toml.
    pub init: bool,
    /// oxlint's `--type-check`: report what the type checker reports too.
    pub type_check: bool,
    pub cwd: Option<Vec<u8>>,
    /// oxlint's `-A`, `-W`, `-D`, in order: a rule or a category.
    pub filters: Vec<(Severity, Vec<u8>)>,
    pub deny_warnings: bool,
    pub silent: bool,
    pub ignore_path: Option<Vec<u8>>,
    /// `ignorePath` of bunfig.toml as it is written there: to oxlint it is a name, for every directory.
    pub ignore_file_name_of_bunfig: Option<Vec<u8>>,
    pub disable_nested_config: bool,
    /// What the configuration asks for and cannot be done is a warning, and not an error at the end.
    pub allow_unsupported: bool,
    pub native_plugin_rules: NativePlugins,
    /// The defaults of the flags of `bun fmt`, for the rule `bun/format`. No flag sets them.
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
            of_one_tool: Vec::new(),
            ext: None,
            global: Vec::new(),
            globals: Vec::new(),
            parser: None,
            parser_options: Vec::new(),
            settings: Vec::new(),
            plugin: Vec::new(),
            plugins_of_bunfig: Vec::new(),
            rule: Vec::new(),
            rules_of_bunfig: Vec::new(),
            bunfig: b"bunfig.toml".to_vec(),
            has_section_of_bunfig: false,
            is_bunfig_named: false,
            is_config_of_bunfig: false,
            is_suppressions_location_of_flag: false,
            overrides: Vec::new(),
            of_command_line: None,
            fix: false,
            fix_dry_run: false,
            fix_type: None,
            ignore: true,
            ignore_pattern: Vec::new(),
            ignore_patterns_of_bunfig: 0,
            only: None,
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
            doctor: false,
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
            explain: None,
            plugins: Vec::new(),
            type_aware: None,
            infer_globals: None,
            infers_globals_by_options: false,
            tsconfig: None,
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
            ignore_file_name_of_bunfig: None,
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

/// `value`: a path or a pattern, or a list of them, which are written from `directory`. `always`: also what starts with `**/`.
fn start_at(directory: &[u8], value: &mut Json, always: bool) {
    match value {
        Json::Array(all) => all
            .iter_mut()
            .for_each(|it| start_at(directory, it, always)),
        Json::String(it) if !it.is_empty() => {
            let (not, written) = match it.strip_prefix(b"!") {
                Some(rest) => (&b"!"[..], paths::from_native(rest)),
                None => (&b""[..], paths::from_native(it)),
            };
            if !paths::is_absolute(&written) && (always || !written.starts_with(b"**/")) {
                *it = [not, &paths::join_normalized(directory, &written)].concat();
            }
        }
        _ => {}
    }
}

/// optionator's `mergeRepeatedObjects`
pub(crate) fn merge(into: &mut Vec<(Vec<u8>, Json)>, entries: Vec<(Vec<u8>, Json)>) {
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
        let is_of_oxlint = ONLY_OF_OXLINT.contains(&name) || name.ends_with(b"-plugin");
        let is_of_eslint = ONLY_OF_ESLINT.contains(&name);
        if is_of_oxlint || is_of_eslint {
            self.of_one_tool.push(OfOneTool {
                tool: if is_of_oxlint {
                    Tool::Oxlint
                } else {
                    Tool::Eslint
                },
                name,
                value: text.to_vec(),
                is_on,
            });
        }
        match name {
            b"config" => (self.config, self.is_config_of_bunfig) = (owned(), false),
            b"config-lookup" => self.config_lookup = is_on,
            b"flavor" => {
                self.flavor = Some(match text {
                    b"eslint" => Tool::Eslint,
                    b"oxlint" => Tool::Oxlint,
                    _ => {
                        return error(&[b"--flavor must be eslint or oxlint, not \"", text, b"\""]);
                    }
                })
            }
            b"rule" => {
                let mut said = Vec::new();
                object(name, text, &mut said)?;
                // What bunfig.toml has about them is no longer what counts.
                for (at, place) in self.rules_of_bunfig.iter_mut().enumerate() {
                    if (self.rule.get(at)).is_some_and(|it| said.iter().any(|said| said.0 == it.0))
                    {
                        place.setting = Json::Null;
                    }
                }
                merge(&mut self.rule, said);
            }
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
                            return error(&[INVALID_FIX_TYPE]);
                        }
                    });
                }
            }
            b"ignore-pattern" => self.ignore_pattern.push(text.to_vec()),
            b"staged" | b"changed" => crate::git::Only::set(&mut self.only, name, value, is_on)?,
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
            b"doctor" => self.doctor = is_on,
            b"type-aware" => self.type_aware = Some(is_on),
            b"infer-globals" => self.infer_globals = Some(is_on),
            b"tsconfig" | b"project" => self.tsconfig = owned(),
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
                        return error(&[b"--threads takes a number, not \"", text, b"\""]);
                    }
                },
            },
            b"timing" => self.timing = is_on,
            b"all" => self.all = is_on,
            b"list-files" => self.list_files = is_on,
            b"init" => self.init = is_on,
            b"cwd" => self.cwd = owned(),
            b"help" => self.help = is_on,
            b"help-all" => (self.help, self.all) = (is_on, is_on),
            b"version" => self.version = is_on,
            b"suppress-all" => self.suppress_all = is_on,
            b"suppress-rule" => self
                .suppress_rule
                .get_or_insert_default()
                .extend(list(text)),
            b"suppressions-location" => {
                self.suppressions_location = owned();
                self.is_suppressions_location_of_flag = true;
            }
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
            b"ignore-path" => {
                self.ignore_path = owned();
                self.ignore_file_name_of_bunfig = None;
            }
            b"disable-nested-config" => self.disable_nested_config = is_on,
            b"allow-unsupported" => self.allow_unsupported = is_on,
            b"native-plugin-rules" => match NativePlugins::parse(text) {
                Ok(which) => self.native_plugin_rules = which,
                Err(name) => {
                    return error(&[
                        b"Unknown plugin \"",
                        name,
                        b"\" in --native-plugin-rules\n  Available plugins: ",
                        NativePlugins::names()
                            .collect::<Vec<_>>()
                            .join(", ")
                            .as_bytes(),
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
            b"explain" => self.explain = owned(),
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

    /// As `--parser-options` with what `options` is.
    pub(crate) fn add_parser_options(&mut self, options: Vec<(Vec<u8>, Json)>) {
        merge(&mut self.parser_options, options);
    }

    /// Call after reading bunfig.toml. A key is never rejected as another tool's flag.
    pub(crate) fn forget_whose_flags_it_has(&mut self) {
        self.of_one_tool.clear();
    }

    /// Returns the first flag that can't work with a `flavor` config, as written, and the tool it belongs to.
    pub(crate) fn flag_that_means_nothing_to(
        &self,
        flavor: Flavor,
    ) -> Option<(Vec<u8>, &'static [u8])> {
        let mut flags = self.of_one_tool.iter();
        Some(flags.find(|it| it.means_nothing_to(flavor))?.written())
    }

    /// `args`: what follows `lint` on the command line.
    pub fn parse(args: &[&[u8]]) -> Result<Options, UsageError> {
        Options::default().with(args)
    }

    /// `self`: what the bunfig at `path` says, which is a path from the working directory. What is a path in it starts at
    /// [`Options::start_of_bunfig`]. `is_named`: [`Options::is_bunfig_named`].
    pub fn of_bunfig_at(mut self, path: &[u8], is_named: bool, cwd: &[u8]) -> Options {
        self.bunfig = paths::from_native(path);
        self.has_section_of_bunfig = true;
        self.is_bunfig_named = is_named;
        self.is_config_of_bunfig = self.config.is_some();
        self.is_suppressions_location_of_flag = false;
        self.ignore_patterns_of_bunfig = self.ignore_pattern.len();
        self.ignore_file_name_of_bunfig
            .clone_from(&self.ignore_path);
        let directory = paths::dirname(&self.bunfig).to_vec();
        if directory != b"." && !is_named {
            let all = [
                &mut self.config,
                &mut self.ignore_path,
                &mut self.suppressions_location,
                &mut self.tsconfig,
            ];
            for it in all.into_iter().flatten() {
                let written = paths::from_native(it);
                if !paths::is_absolute(&written) {
                    *it = paths::join_normalized(&directory, &written);
                }
            }
        }
        self.start_settings_at_bunfig(cwd);
        self
    }

    /// `rules`, with where bunfig.toml has them: `places`. The rules read the paths and the patterns in their options from the
    /// working directory. In what the file has they are written from where the file is.
    pub(crate) fn from_the_working_directory(
        &self,
        rules: &[(Vec<u8>, Json)],
        places: &[crate::bunfig::RuleOfBunfig],
        is_oxlint: bool,
        cwd: &[u8],
    ) -> Vec<(Vec<u8>, Json)> {
        let mut rules = rules.to_vec();
        let Some(directory) = self.way_to_bunfig() else {
            return rules;
        };
        for (at, (id, setting)) in rules.iter_mut().enumerate() {
            // `--rule` may have replaced this entry.
            if places.get(at).is_none_or(|it| it.setting != *setting) {
                continue;
            }
            let (prefix, name) = parse_rule_id(id);
            if !Plugin::spelled(&plugin_shorthand(prefix)).any(|it| it == Plugin::Import) {
                continue;
            }
            // What is held against the whole path of a file is the same from everywhere if it starts with `**/`. With what files
            // are looked for it is not.
            let (keys, finds_files): (&[&[u8]], bool) = match name {
                b"no-restricted-paths" => (&[b"basePath"], false),
                // oxlint holds them against what is written in the import.
                b"no-unassigned-import" if !is_oxlint => (&[b"allow"], false),
                b"no-unused-modules" => (&[b"src", b"ignoreExports"], true),
                b"no-extraneous-dependencies" => (
                    &[
                        b"packageDir",
                        b"devDependencies",
                        b"optionalDependencies",
                        b"peerDependencies",
                        b"bundledDependencies",
                    ],
                    false,
                ),
                _ => continue,
            };
            let Json::Array(parts) = setting else {
                continue;
            };
            let Some(Json::Object(options)) = parts.get_mut(1) else {
                continue;
            };
            // What is the working directory if nothing is said.
            let usual = match name {
                b"no-restricted-paths" => Some((&b"basePath"[..], Json::String(b".".to_vec()))),
                b"no-unused-modules" => {
                    Some((&b"src"[..], Json::Array(vec![Json::String(b".".to_vec())])))
                }
                _ => None,
            };
            if let Some((key, value)) = usual.filter(|it| !options.iter().any(|at| at.0 == it.0)) {
                options.push((key.to_vec(), value));
            }
            for (key, value) in options.iter_mut().filter(|it| keys.contains(&&it.0[..])) {
                match (name, &key[..], &mut *value) {
                    // The name of a package is held against them too, as it is written: `dotenv/config`. It is one if there is
                    // nothing of that name beside bunfig.toml.
                    (b"no-unassigned-import", _, Json::Array(all)) => {
                        let is_path = |it: &[u8]| {
                            let first = it.strip_prefix(b"!").unwrap_or(it);
                            let first = strings::split(first, b"/").next().unwrap_or_default();
                            strings::contains_any(first, b"*?[{(")
                                || matches!(first, b"." | b"..")
                                || {
                                    let beside = paths::join_normalized(directory, first);
                                    bun_sys::exists(&paths::resolve(cwd, &beside))
                                }
                        };
                        let paths = all.iter_mut().filter(|it| it.as_str().is_some_and(is_path));
                        paths.for_each(|it| start_at(directory, it, finds_files));
                    }
                    // `path.resolve(cwd, "")`
                    (_, b"basePath", Json::String(it)) if it.is_empty() => *it = directory.to_vec(),
                    (_, b"packageDir", Json::Array(all)) => {
                        for it in all {
                            match it {
                                Json::String(it) if it.is_empty() => *it = directory.to_vec(),
                                it => start_at(directory, it, finds_files),
                            }
                        }
                    }
                    _ => start_at(directory, value, finds_files),
                }
            }
        }
        rules
    }

    /// The bunfig.toml above the working directory whose `[lint]` was found.
    pub(crate) fn bunfig_above(&self) -> Option<&[u8]> {
        (self.way_to_bunfig().is_some() && self.has_section_of_bunfig).then_some(&self.bunfig)
    }

    /// From the working directory to the directory above it that has bunfig.toml.
    fn way_to_bunfig(&self) -> Option<&[u8]> {
        let directory = paths::dirname(&self.bunfig);
        (directory != b"." && !self.is_bunfig_named).then_some(directory)
    }

    /// `settings` and `parserOptions`, which only bunfig.toml has so far: see [`Options::from_the_working_directory`].
    fn start_settings_at_bunfig(&mut self, cwd: &[u8]) {
        let Some(directory) = self.way_to_bunfig().map(<[u8]>::to_vec) else {
            return;
        };
        fn options_of<'a>(json: &'a mut Json, key: &[u8]) -> Option<&'a mut Json> {
            let Json::Object(entries) = json else {
                return None;
            };
            Some(&mut entries.iter_mut().find(|it| it.0 == key)?.1)
        }
        // All that `require_resolver` of the rules reads and that is a path.
        fn start_options_at(directory: &[u8], cwd: &[u8], name: &[u8], options: &mut Json) {
            // By its short name, by the name of its package, or by a path into that.
            let is =
                |it: &[u8]| name == it || strings::contains(name, &[b"-resolver-", it].concat());
            if is(b"node") {
                // Whole: `resolve` goes about one that is relative in a way of its own.
                if let Some(value) = options_of(options, b"paths") {
                    start_at(&paths::resolve(cwd, directory), value, true);
                }
            } else if is(b"typescript") {
                if let Some(value) = options_of(options, b"project") {
                    start_at(directory, value, true);
                }
                let file =
                    options_of(options, b"tsconfig").and_then(|it| options_of(it, b"configFile"));
                if let Some(value) = file {
                    start_at(directory, value, true);
                }
            }
        }
        fn start_resolver_at(directory: &[u8], cwd: &[u8], resolver: &mut Json) {
            match resolver {
                Json::Array(all) => all
                    .iter_mut()
                    .for_each(|it| start_resolver_at(directory, cwd, it)),
                Json::Object(all) => (all.iter_mut())
                    .for_each(|it| start_options_at(directory, cwd, &it.0, &mut it.1)),
                _ => {}
            }
        }
        let of_overrides = self.overrides.iter_mut().map(|it| &mut it.settings);
        for (key, value) in std::iter::once(&mut self.settings)
            .chain(of_overrides)
            .flatten()
        {
            match &key[..] {
                b"import/resolver" | b"import-x/resolver" => {
                    start_resolver_at(&directory, cwd, value);
                }
                // "backward compatibility"
                b"import/resolve" => start_options_at(&directory, cwd, b"node", value),
                _ => {}
            }
        }
        // `project` starts at `tsconfigRootDir`.
        let has_root = self
            .parser_options
            .iter()
            .any(|it| it.0 == b"tsconfigRootDir");
        let key: &[u8] = if has_root {
            b"tsconfigRootDir"
        } else {
            b"project"
        };
        for (_, value) in self.parser_options.iter_mut().filter(|it| it.0 == key) {
            start_at(&directory, value, true);
        }
    }

    /// Whether a rule is named that holds a file against what `bun fmt` prints, and so needs `[fmt]`.
    pub fn names_a_format_rule(&self) -> bool {
        let of_overrides = self.overrides.iter().flat_map(|it| &it.rules);
        let of_filters = self.filters.iter().map(|it| &it.1[..]);
        let names = self.rule.iter().chain(of_overrides).map(|it| &it.0[..]);
        let mut names = names.chain(of_filters);
        names.any(|it| matches!(it, b"bun/format" | b"prettier/prettier"))
    }

    /// Where the paths and the patterns in bunfig.toml start: where the file is, which is the project to a run from any
    /// directory of it. `--config` can name a file that is kept anywhere, and then it is the working directory.
    pub(crate) fn start_of_bunfig(&self, cwd: &[u8]) -> Vec<u8> {
        match self.is_bunfig_named {
            true => cwd.to_vec(),
            false => paths::dirname(&paths::resolve(cwd, &self.bunfig)).to_vec(),
        }
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
        if !defaults.overrides.is_empty() {
            defaults.of_command_line = Some(Box::new(alone));
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
                b"--infer-globals=fast" => options.infers_globals_by_options = true,
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
                    rewritten.push(b"--print-config=");
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
