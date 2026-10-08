//! The command line of `bun format`: that of Prettier, but that files are written unless a flag
//! says otherwise, and what `bun check` has (`--threads`, `--timing`, `--cwd`).

pub use crate::args::UsageError;
use crate::args::{Argument, Param, error};
use bun_clap as clap;

/// A flag without a description is understood, and not listed in the help.
pub const PARAMS: &[Param] = &[
    clap::param!("-c, --check                     Do not write. Exit with 1 if a file is not formatted"),
    clap::param!("-l, --list-different            Do not write. Print the files that are not formatted, and exit with 1 if there are any"),
    clap::param!("--stdin-filepath <path>         Format standard input as that file, and print the result"),
    clap::param!("--config <path>                 Use this configuration file instead of looking for one"),
    clap::param!("--no-config                     Do not look for a configuration file"),
    clap::param!("--disable-nested-config         Use the configuration file of the working directory for every file"),
    clap::param!("--no-editorconfig               Do not read <b>.editorconfig<r>"),
    clap::param!("--config-precedence <which>     <b>cli-override<r> <d>(default)<r>, <b>file-override<r>, or <b>prefer-file<r>"),
    clap::param!("--ignore-path <path>...         Files with patterns to ignore <d>(default: .gitignore and .prettierignore)<r>"),
    clap::param!("--with-node-modules             Format files in <b>node_modules<r> too"),
    clap::param!("--no-error-on-unmatched-pattern  Do not fail if an argument matches no file"),
    clap::param!("-u, --ignore-unknown            Say nothing about a file that there is no parser for"),
    clap::param!("--find-config-path <path>       Print the configuration file of a file, and format nothing"),
    clap::param!("--log-level <level>             <b>silent<r>, <b>error<r>, <b>warn<r>, <b>log<r> <d>(default)<r>, or <b>debug<r>"),
    clap::param!("--print-width <n>               The line length to wrap at <d>(default: 80)<r>"),
    clap::param!("--tab-width <n>                 Spaces per indentation level <d>(default: 2)<r>"),
    clap::param!("--use-tabs                      Indent with tabs"),
    clap::param!("--no-semi                       Only print semicolons where they are needed"),
    clap::param!("--single-quote                  Use single quotes"),
    clap::param!("--jsx-single-quote              Use single quotes in JSX"),
    clap::param!("--quote-props <when>            <b>as-needed<r> <d>(default)<r>, <b>consistent<r>, or <b>preserve<r>"),
    clap::param!("--trailing-comma <where>        <b>all<r> <d>(default)<r>, <b>es5<r>, or <b>none<r>"),
    clap::param!("--no-bracket-spacing            No spaces between the braces of an object literal"),
    clap::param!("--bracket-same-line             Put the closing bracket of a multi-line element at the end of the last line"),
    clap::param!("--arrow-parens <when>           <b>always<r> <d>(default)<r> or <b>avoid<r>"),
    clap::param!("--object-wrap <how>             <b>preserve<r> <d>(default)<r> or <b>collapse<r>"),
    clap::param!("--single-attribute-per-line     One attribute per line in JSX"),
    clap::param!("--end-of-line <which>           <b>lf<r> <d>(default)<r>, <b>crlf<r>, <b>cr<r>, or <b>auto<r>"),
    clap::param!("--require-pragma                Only format files that start with a comment that has <b>@format<r> or <b>@prettier<r>"),
    clap::param!("--check-ignore-pragma           Do not format files that start with a comment that has <b>@noformat<r> or <b>@noprettier<r>"),
    clap::param!("--threads <n>                   Number of threads <d>(default: one per CPU core)<r>"),
    clap::param!("--timing                        Print how long each phase took"),
    clap::param!("--cwd <path>                    Set the working directory"),
    clap::param!("-h, --help                      Print this help menu"),
    // The opposites of the above.
    clap::param!("-w, --write"),
    clap::param!("--editorconfig"),
    clap::param!("--semi"),
    clap::param!("--bracket-spacing"),
    clap::param!("--error-on-unmatched-pattern"),
    // Prettier's, with little or nothing to do here.
    clap::param!("--experimental-ternaries"),
    clap::param!("--experimental-operator-position <where>"),
    clap::param!("--embedded-language-formatting <which>"),
    clap::param!("--insert-pragma"),
    clap::param!("--parser <name>"),
    clap::param!("--plugin <name>..."),
    clap::param!("--cache"),
    clap::param!("--cache-location <path>"),
    clap::param!("--cache-strategy <strategy>"),
    clap::param!("--color"),
    clap::param!("-v, --version"),
    // oxfmt's.
    clap::param!("--init"),
    clap::param!("--migrate <source>"),
    clap::param!("--lsp"),
    // Ours.
    clap::param!("--config-cache"),
    clap::param!("--list-files"),
    clap::param!("--verify"),
];

/// `--config-precedence`
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Precedence {
    /// The command line overrides the configuration file.
    #[default]
    CliOverride,
    FileOverride,
    /// The command line counts only if there is no configuration file.
    PreferFile,
}

/// `--log-level`
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum LogLevel {
    Silent,
    Error,
    Warn,
    #[default]
    Log,
    Debug,
}

/// What the command line says.
#[derive(Clone, Debug)]
pub struct Options {
    /// Files, directories and patterns.
    pub patterns: Vec<Vec<u8>>,
    pub check: bool,
    pub list_different: bool,
    pub write: bool,
    pub stdin_filepath: Option<Vec<u8>>,
    pub config: Option<Vec<u8>>,
    /// `false`: `--no-config`.
    pub config_lookup: bool,
    pub disable_nested_config: bool,
    pub editorconfig: bool,
    pub config_precedence: Precedence,
    /// `None`: `.gitignore` and `.prettierignore`.
    pub ignore_path: Option<Vec<Vec<u8>>>,
    pub with_node_modules: bool,
    pub error_on_unmatched_pattern: bool,
    /// Nothing is said about a file that there is no parser for.
    pub ignore_unknown: bool,
    pub find_config_path: Option<Vec<u8>>,
    pub log_level: LogLevel,
    /// The options of Prettier, by the names that they have in a configuration file, and their
    /// values as they are written in JSON, a string without its quotes.
    pub format: Vec<(&'static [u8], Vec<u8>)>,
    pub plugins: Vec<Vec<u8>>,
    pub color: Option<bool>,
    pub version: bool,
    pub help: bool,
    /// `0`: the number of cores.
    pub threads: usize,
    pub timing: bool,
    pub cwd: Option<Vec<u8>>,
    /// What a configuration file that is a program evaluates to is kept for the next run.
    pub config_cache: bool,
    /// Before a file is written, what is written is parsed and compared with what was there.
    pub verify: bool,
    /// Prints the files that would be formatted, and formats nothing.
    pub list_files: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            patterns: Vec::new(),
            check: false,
            list_different: false,
            write: false,
            stdin_filepath: None,
            config: None,
            config_lookup: true,
            disable_nested_config: false,
            editorconfig: true,
            config_precedence: Precedence::default(),
            ignore_path: None,
            with_node_modules: false,
            error_on_unmatched_pattern: true,
            ignore_unknown: false,
            find_config_path: None,
            log_level: LogLevel::default(),
            format: Vec::new(),
            plugins: Vec::new(),
            color: None,
            version: false,
            help: false,
            threads: 0,
            timing: false,
            cwd: None,
            config_cache: true,
            verify: true,
            list_files: false,
        }
    }
}

/// The name in a configuration file of the option that a flag sets.
fn option_of(flag: &[u8]) -> Option<&'static [u8]> {
    Some(match flag {
        b"print-width" => b"printWidth",
        b"tab-width" => b"tabWidth",
        b"use-tabs" => b"useTabs",
        b"semi" => b"semi",
        b"single-quote" => b"singleQuote",
        b"jsx-single-quote" => b"jsxSingleQuote",
        b"quote-props" => b"quoteProps",
        b"trailing-comma" => b"trailingComma",
        b"bracket-spacing" => b"bracketSpacing",
        b"bracket-same-line" => b"bracketSameLine",
        b"arrow-parens" => b"arrowParens",
        b"object-wrap" => b"objectWrap",
        b"single-attribute-per-line" => b"singleAttributePerLine",
        b"end-of-line" => b"endOfLine",
        b"experimental-ternaries" => b"experimentalTernaries",
        b"experimental-operator-position" => b"experimentalOperatorPosition",
        b"embedded-language-formatting" => b"embeddedLanguageFormatting",
        b"require-pragma" => b"requirePragma",
        b"insert-pragma" => b"insertPragma",
        b"check-ignore-pragma" => b"checkIgnorePragma",
        _ => return None,
    })
}

impl Options {
    fn set(&mut self, name: &'static [u8], value: Option<&[u8]>, is_on: bool) -> Result<(), UsageError> {
        let text = value.unwrap_or_default();
        let owned = || Some(text.to_vec());
        if let Some(option) = option_of(name) {
            let value: &[u8] = value.unwrap_or(if is_on { b"true" } else { b"false" });
            self.format.retain(|it| it.0 != option);
            self.format.push((option, value.to_vec()));
            return Ok(());
        }
        match name {
            b"check" => self.check = is_on,
            b"list-different" => self.list_different = is_on,
            b"write" => self.write = is_on,
            b"stdin-filepath" => self.stdin_filepath = owned(),
            // `--no-config` is read as the opposite of a flag that takes a value.
            b"config" => self.config = owned(),
            b"disable-nested-config" => self.disable_nested_config = is_on,
            b"list-files" => self.list_files = is_on,
            b"init" | b"migrate" | b"lsp" => return error(&[b"bun format does not support --", name, b"."]),
            b"editorconfig" => self.editorconfig = is_on,
            b"config-precedence" => {
                self.config_precedence = match text {
                    b"cli-override" => Precedence::CliOverride,
                    b"file-override" => Precedence::FileOverride,
                    b"prefer-file" => Precedence::PreferFile,
                    _ => {
                        return error(&[
                            b"Invalid --config-precedence value. Expected \"cli-override\", \"file-override\" or \"prefer-file\", but received \"",
                            text,
                            b"\".",
                        ]);
                    }
                };
            }
            b"ignore-path" => self.ignore_path.get_or_insert_default().push(text.to_vec()),
            b"with-node-modules" => self.with_node_modules = is_on,
            b"error-on-unmatched-pattern" => self.error_on_unmatched_pattern = is_on,
            b"ignore-unknown" => self.ignore_unknown = is_on,
            b"find-config-path" => self.find_config_path = owned(),
            b"log-level" => {
                self.log_level = match text {
                    b"silent" => LogLevel::Silent,
                    b"error" => LogLevel::Error,
                    b"warn" => LogLevel::Warn,
                    b"log" => LogLevel::Log,
                    b"debug" => LogLevel::Debug,
                    _ => {
                        return error(&[
                            b"Invalid --log-level value. Expected \"debug\", \"error\", \"log\", \"silent\" or \"warn\", but received \"",
                            text,
                            b"\".",
                        ]);
                    }
                };
            }
            b"plugin" => self.plugins.push(text.to_vec()),
            b"color" => self.color = Some(is_on),
            b"version" => self.version = is_on,
            b"help" => self.help = is_on,
            b"threads" => match bun_core::fmt::parse_decimal::<usize>(text) {
                Some(count) if count > 0 => self.threads = count,
                _ => return error(&[b"--threads takes a number above zero, not \"", text, b"\"."]),
            },
            b"timing" => self.timing = is_on,
            b"cwd" => self.cwd = owned(),
            b"config-cache" => self.config_cache = is_on,
            b"verify" => self.verify = is_on,
            _ => {}
        }
        Ok(())
    }

    /// `args`: what follows `format` on the command line.
    pub fn parse(args: &[&[u8]]) -> Result<Options, UsageError> {
        let mut options = Options::default();
        // The one flag that takes a value and has an opposite.
        let args = args.iter().copied().filter(|arg| {
            let is_no_config = *arg == b"--no-config";
            options.config_lookup &= !is_no_config;
            !is_no_config
        });
        // `-c` is `--check` for Prettier and `--config` for oxfmt, which takes `-c=path`.
        let rewritten: Vec<Vec<u8>> = args
            .map(|arg| match arg.strip_prefix(b"-c=") {
                Some(path) => [b"--config=", path].concat(),
                None if arg == b"-V" => b"--version".to_vec(),
                None => arg.to_vec(),
            })
            .collect();
        let args: Vec<&[u8]> = rewritten.iter().map(Vec::as_slice).collect();
        crate::args::parse(PARAMS, &args, &mut |argument| match argument {
            Argument::Flag { name, value, is_on } => options.set(name, value, is_on),
            Argument::Positional(pattern) => {
                options.patterns.push(pattern.to_vec());
                Ok(())
            }
        })?;
        Ok(options)
    }
}
