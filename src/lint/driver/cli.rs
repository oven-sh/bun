//! The command line of `bun lint`: that of ESLint, what `bun check` has (`--threads`, `--timing`,
//! `--cwd`), and the flags of oxlint that its users have in their scripts.

use bun_clap as clap;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::options::Json;

type Param = clap::Param<clap::Help>;

/// A flag without a description is understood, and not listed in the help.
pub const PARAMS: &[Param] = &[
    clap::param!("-c, --config <path>             Use this configuration file instead of looking for one"),
    clap::param!("--no-config-lookup              Do not look for a configuration file"),
    clap::param!("--rule <rule>...                Configure a rule: <b>--rule 'eqeqeq: [error, smart]'<r>"),
    clap::param!("--global <name>...              Define global variables: <b>--global a,b:true<r>"),
    clap::param!("--parser-options <options>...   Set parser options: <b>--parser-options projectService:true<r>"),
    clap::param!("--ext <ext>...                  Lint files with these extensions too"),
    clap::param!("--fix                           Fix what can be fixed, and write the files"),
    clap::param!("--fix-dry-run                   Fix without writing. The <b>json<r> format has the fixed code"),
    clap::param!("--fix-type <type>...            Only apply fixes of rules of these types: <b>directive<r>, <b>problem<r>, <b>suggestion<r>, <b>layout<r>"),
    clap::param!("--ignore-pattern <pattern>...   Ignore the files that match"),
    clap::param!("--no-ignore                     Lint ignored files too"),
    clap::param!("--no-warn-ignored               Do not warn about an ignored file that is named as an argument"),
    clap::param!("--stdin                         Lint the code on standard input"),
    clap::param!("--stdin-filename <path>         The file name that the code on standard input is linted as"),
    clap::param!("--quiet                         Report errors only"),
    clap::param!("--max-warnings <n>              Exit with 1 if there are more warnings than this"),
    clap::param!("-f, --format <name>             <b>stylish<r> <d>(default)<r>, <b>pretty<r>, <b>json<r>, <b>json-with-metadata<r>, <b>unix<r>, <b>github<r>, <b>agent<r>"),
    clap::param!("-o, --output-file <path>        Write the report to a file"),
    clap::param!("--color                         Always use colors"),
    clap::param!("--no-color                      Never use colors"),
    clap::param!("--no-inline-config              Ignore <b>eslint-disable<r> and other configuration comments"),
    clap::param!("--report-unused-disable-directives  Report <b>eslint-disable<r> comments that disable nothing, as errors"),
    clap::param!("--report-unused-disable-directives-severity <severity>  The same, as <b>off<r>, <b>warn<r> or <b>error<r>"),
    clap::param!("--report-unused-inline-configs <severity>  Report configuration comments that change nothing"),
    clap::param!("--no-error-on-unmatched-pattern  Do not fail if an argument matches no file"),
    clap::param!("--pass-on-no-patterns           Exit with 0 if there are no arguments, instead of linting <b>.<r>"),
    clap::param!("--exit-on-fatal-error           Exit with 2 if a file cannot be parsed"),
    clap::param!("--print-config <path>           Print the configuration of a file, and lint nothing"),
    clap::param!("--type-aware                    Run the rules that need types, whatever the configuration says"),
    clap::param!("--no-type-aware                 Skip the rules that need types"),
    clap::param!("-p, --project/--tsconfig <path>  The tsconfig.json for the rules that need types"),
    clap::param!("--threads <n>                   Number of threads <d>(default: one per CPU core)<r>"),
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
    clap::param!("--init"),
    clap::param!("--mcp"),
    clap::param!("--suppress-all"),
    clap::param!("--suppress-rule <rule>..."),
    clap::param!("--suppressions-location <path>"),
    clap::param!("--prune-suppressions"),
    clap::param!("--pass-on-unpruned-suppressions"),
    // oxlint's.
    clap::param!("-A, --allow <rule>..."),
    clap::param!("-W, --warn <rule>..."),
    clap::param!("-D, --deny <rule>..."),
    clap::param!("--deny-warnings"),
    clap::param!("--silent"),
    clap::param!("--ignore-path <path>"),
    clap::param!("--disable-nested-config"),
];

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
    pub stats: bool,
    pub env_info: bool,
    pub version: bool,
    pub help: bool,
    /// Flags of ESLint that are accepted and have no effect, as they were written.
    pub without_effect: Vec<&'static [u8]>,
    /// `--type-aware`, `--no-type-aware`. `None`: as the configuration says.
    pub type_aware: Option<bool>,
    pub project: Option<Vec<u8>>,
    /// `0`: the number of cores.
    pub threads: usize,
    pub timing: bool,
    pub cwd: Option<Vec<u8>>,
    /// oxlint's `-A`, `-W`, `-D`, in order: a rule or a category.
    pub filters: Vec<(Severity, Vec<u8>)>,
    pub deny_warnings: bool,
    pub silent: bool,
    pub ignore_path: Option<Vec<u8>>,
    pub disable_nested_config: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            patterns: Vec::new(),
            config: None,
            config_lookup: true,
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
            stats: false,
            env_info: false,
            version: false,
            help: false,
            without_effect: Vec::new(),
            type_aware: None,
            project: None,
            threads: 0,
            timing: false,
            cwd: None,
            filters: Vec::new(),
            deny_warnings: false,
            silent: false,
            ignore_path: None,
            disable_nested_config: false,
        }
    }
}

/// Why the command line cannot be used: a line for the user. The exit code is 2, as ESLint's.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct UsageError(pub Vec<u8>);

fn error<T>(parts: &[&[u8]]) -> Result<T, UsageError> {
    Err(UsageError(parts.concat()))
}

fn find_long(name: &[u8]) -> Option<&'static Param> {
    let is_it = |param: &&Param| param.names.long == Some(name) || param.names.long_aliases.contains(&name);
    PARAMS.iter().find(is_it)
}

fn find_short(name: u8) -> Option<&'static Param> {
    PARAMS.iter().find(|param| param.names.short == Some(name))
}

/// How many single-character edits turn `a` into `b`.
fn distance(a: &[u8], b: &[u8]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let substituted = diagonal + usize::from(x != y);
            diagonal = row[j + 1];
            row[j + 1] = substituted.min(row[j] + 1).min(diagonal + 1);
        }
    }
    row[b.len()]
}

fn unknown<T>(written: &[u8], name: &[u8]) -> Result<T, UsageError> {
    let closest = (PARAMS.iter().filter_map(|param| param.names.long)).min_by_key(|long| distance(name, long));
    match closest {
        Some(closest) => error(&[b"Invalid option '", written, b"' - perhaps you meant '--", closest, b"'?"]),
        None => error(&[b"Invalid option '", written, b"'."]),
    }
}

/// The elements of optionator's `[String]`.
fn list(value: &[u8]) -> Vec<Vec<u8>> {
    if value.trim_ascii().is_empty() {
        return Vec::new();
    }
    strings::split(value, b",").map(|item| item.trim_ascii().to_vec()).collect()
}

fn severity(name: &[u8], value: &[u8]) -> Result<Severity, UsageError> {
    match value {
        b"off" | b"0" => Ok(Severity::Off),
        b"warn" | b"1" => Ok(Severity::Warn),
        b"error" | b"2" => Ok(Severity::Error),
        _ => error(&[b"Option ", name, b": '", value, b"' not one of off, warn, error, 0, 1, or 2."]),
    }
}

fn object(name: &[u8], value: &[u8], into: &mut Vec<(Vec<u8>, Json)>) -> Result<(), UsageError> {
    let Some(entries) = bun_lint::linter::parse_levn_object(value) else {
        return error(&[b"Invalid value for option '", name, b"' - expected type Object, received value: ", value, b"."]);
    };
    // `mergeRepeatedObjects`
    for (key, value) in entries {
        match into.iter_mut().find(|it| it.0 == key) {
            Some(entry) => entry.1 = value,
            None => into.push((key, value)),
        }
    }
    Ok(())
}

impl Options {
    /// Takes in the flag that is called `name`. `value`: `None` for a flag that takes none.
    /// `is_on`: it is not written `--no-..`.
    fn set(&mut self, name: &'static [u8], value: Option<&[u8]>, is_on: bool) -> Result<(), UsageError> {
        let text = value.unwrap_or_default();
        let owned = || Some(text.to_vec());
        match name {
            b"config" => self.config = owned(),
            b"config-lookup" => self.config_lookup = is_on,
            b"rule" => object(name, text, &mut self.rule)?,
            b"global" => self.global.extend(list(text)),
            b"parser-options" => object(name, text, &mut self.parser_options)?,
            b"ext" => self.ext.get_or_insert_default().extend(list(text)),
            b"fix" => self.fix = is_on,
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
            b"max-warnings" => match std::str::from_utf8(text).ok().and_then(|it| it.parse().ok()) {
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
            b"report-unused-inline-configs" => self.report_unused_inline_configs = Some(severity(name, text)?),
            b"error-on-unmatched-pattern" => self.error_on_unmatched_pattern = is_on,
            b"pass-on-no-patterns" => self.pass_on_no_patterns = is_on,
            b"exit-on-fatal-error" => self.exit_on_fatal_error = is_on,
            b"print-config" => self.print_config = owned(),
            b"type-aware" => self.type_aware = Some(is_on),
            b"project" => self.project = owned(),
            b"threads" | b"concurrency" => match (name, text) {
                (b"concurrency", b"auto" | b"off") => {}
                _ => match bun_core::fmt::parse_decimal::<usize>(text) {
                    Some(count) if count > 0 => self.threads = count,
                    _ if name == b"concurrency" => {
                        return error(&[
                            b"Option concurrency: '",
                            text,
                            b"' is not a positive integer, 'auto' or 'off'.",
                        ]);
                    }
                    _ => return error(&[b"--threads takes a number above zero, not \"", text, b"\"."]),
                },
            },
            b"timing" => self.timing = is_on,
            b"cwd" => self.cwd = owned(),
            b"help" => self.help = is_on,
            b"version" => self.version = is_on,
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
            b"cache-strategy" if !matches!(text, b"metadata" | b"content") => {
                return error(&[b"Option cache-strategy: '", text, b"' not one of metadata or content."]);
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

    /// `args`: what follows `lint` on the command line. They are read as optionator, which ESLint
    /// uses, reads them.
    pub fn parse(args: &[&[u8]]) -> Result<Options, UsageError> {
        let mut options = Options::default();
        // The flag that the next argument is the value of.
        let mut awaited: Option<&'static Param> = None;
        let name_of = |param: &'static Param| param.names.long.unwrap_or_default();
        let is_flag = |param: &Param| param.takes_value == clap::Values::None;
        let boolean = |name: &[u8], value: &[u8]| match value {
            b"true" => Ok(true),
            b"false" => Ok(false),
            _ => error(&[b"Invalid value for option '", name, b"' - expected type Boolean, received value: ", value, b"."]),
        };
        let mut args = args.iter().copied();
        while let Some(arg) = args.next() {
            if arg == b"--" {
                options.patterns.extend(args.by_ref().map(<[u8]>::to_vec));
                break;
            }
            // `/^(--?)([a-zA-Z][-a-zA-Z0-9]*)(=)?(.*)?$/`
            let dashes = arg.iter().take_while(|byte| **byte == b'-').count().min(2);
            let rest = &arg[dashes..];
            let name_len = rest.iter().take_while(|byte| byte.is_ascii_alphanumeric() || **byte == b'-').count();
            if dashes > 0 && rest.first().is_some_and(u8::is_ascii_alphabetic) {
                if let Some(param) = awaited {
                    return error(&[b"Value for '", name_of(param), b"' of type '", param.id.value, b"' required."]);
                }
                let (name, value) = (&rest[..name_len], rest[name_len..].strip_prefix(b"="));
                if dashes == 1 {
                    for (at, short) in name.iter().enumerate() {
                        let Some(param) = find_short(*short) else {
                            return unknown(&[b'-', *short], &name[at..=at]);
                        };
                        match (at + 1 == name.len(), is_flag(param), value) {
                            (true, true, Some(value)) => options.set(name_of(param), None, boolean(name_of(param), value)?)?,
                            (true, false, Some(value)) => options.set(name_of(param), Some(value), true)?,
                            (true, false, None) => awaited = Some(param),
                            (_, true, _) => options.set(name_of(param), None, true)?,
                            (false, false, _) => {
                                return error(&[
                                    b"Can't set argument '",
                                    &name[at..=at],
                                    b"' when not last flag in a group of short flags.",
                                ]);
                            }
                        }
                    }
                    continue;
                }
                let (positive, is_negated) = match name.strip_prefix(b"no-") {
                    Some(positive) if !positive.is_empty() => (positive, true),
                    _ => (name, false),
                };
                let Some(param) = find_long(positive) else {
                    return unknown(&[b"--", positive].concat(), positive);
                };
                match (is_flag(param), value) {
                    (true, Some(value)) => options.set(name_of(param), None, boolean(positive, value)? != is_negated)?,
                    (true, None) => options.set(name_of(param), None, !is_negated)?,
                    (false, _) if is_negated => {
                        return error(&[b"Only use 'no-' prefix for Boolean options, not with '", positive, b"'."]);
                    }
                    (false, Some(value)) => options.set(name_of(param), Some(value), true)?,
                    (false, None) => awaited = Some(param),
                }
            } else if let [b'-', number @ ..] = arg
                && number.first().is_some_and(u8::is_ascii_digit)
                && number.last().is_some_and(u8::is_ascii_digit)
                && number.iter().all(|byte| byte.is_ascii_digit() || *byte == b'.')
                && strings::count_char(number, b'.') <= 1
            {
                return error(&[b"No -NUM option defined."]);
            } else if let Some(param) = awaited.take() {
                options.set(name_of(param), Some(arg), true)?;
            } else {
                options.patterns.push(arg.to_vec());
            }
        }
        if let Some(param) = awaited {
            return error(&[b"Value for '", name_of(param), b"' of type '", param.id.value, b"' required."]);
        }
        Ok(options)
    }
}
