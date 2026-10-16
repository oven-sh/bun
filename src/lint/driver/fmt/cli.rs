//! The command line of `bun fmt`: that of Prettier, but that files are written unless a flag
//! says otherwise, and what `bun check` has (`--threads`, `--timing`, `--cwd`).

use crate::args::{Argument, Group, Param, error};
pub use crate::args::{Help, UsageError};
use crate::paths;
use bun_clap as clap;
use bun_core::strings;

const OPTIONS: &[Param] = &[
    clap::param!("--config <path>                 Use this config file instead of looking for one"),
    clap::param!("--no-config                     Do not look for a config file"),
    clap::param!("--no-editorconfig               Do not read <b>.editorconfig<r>"),
    clap::param!("--init                          Add a <b>[fmt]<r> section to <b>bunfig.toml<r>"),
    clap::param!(
        "--doctor                        Show which files are formatted natively and which packages you can remove"
    ),
    clap::param!("--print-width <n>               The line length to wrap at <d>(default: 80)<r>"),
    clap::param!("--tab-width <n>                 Spaces per indentation level <d>(default: 2)<r>"),
    clap::param!("--use-tabs                      Indent with tabs"),
    clap::param!("--no-semi                       Only print semicolons where they are needed"),
    clap::param!("--single-quote                  Use single quotes"),
    clap::param!("--jsx-single-quote              Use single quotes in JSX"),
    clap::param!(
        "--quote-props <when>            <b>as-needed<r> <d>(default)<r>, <b>consistent<r>, or <b>preserve<r>"
    ),
    clap::param!(
        "--trailing-comma <where>        <b>all<r> <d>(default)<r>, <b>es5<r>, or <b>none<r>"
    ),
    clap::param!(
        "--no-bracket-spacing            No spaces inside the braces of an object literal"
    ),
    clap::param!(
        "--bracket-same-line             Put the closing bracket of a multi-line element at the end of the last line"
    ),
    clap::param!("--arrow-parens <when>           <b>always<r> <d>(default)<r> or <b>avoid<r>"),
    clap::param!(
        "--object-wrap <how>             <b>preserve<r> <d>(default)<r> or <b>collapse<r>"
    ),
    clap::param!("--single-attribute-per-line     One attribute per line in HTML, Vue, and JSX"),
    clap::param!(
        "--html-whitespace-sensitivity <how>  <b>css<r> <d>(default)<r>, <b>strict<r>, or <b>ignore<r>"
    ),
    clap::param!(
        "--vue-indent-script-and-style   Indent the code in the script and style tags of Vue files"
    ),
    clap::param!(
        "--prose-wrap <how>              <b>preserve<r> <d>(default)<r>, <b>always<r>, or <b>never<r>"
    ),
    clap::param!("--embedded-language-formatting <which>  <b>auto<r> <d>(default)<r> or <b>off<r>"),
    clap::param!(
        "--end-of-line <which>           <b>lf<r> <d>(default)<r>, <b>crlf<r>, <b>cr<r>, or <b>auto<r>"
    ),
    clap::param!("--no-insert-final-newline       Do not end files with a newline"),
    clap::param!("--sort-imports                  Sort and group imports"),
    clap::param!("--sort-tailwindcss              Sort Tailwind CSS classes"),
    clap::param!("--sort-package-json             Sort the keys of <b>package.json<r>"),
    clap::param!("--jsdoc                         Format JSDoc comments"),
    clap::param!(
        "--svelte                        Format Svelte components <d>(default without a Prettier or oxfmt config)<r>"
    ),
    clap::param!("--no-svelte                     Do not format Svelte components"),
];

const FILES: &[Param] = &[
    clap::param!(
        "--staged                        Only format files that are staged in git, and stage them again"
    ),
    clap::param!(
        "--changed <ref>?                Only format files that differ from a branch or commit <d>(default: the default branch)<r>"
    ),
    clap::param!(
        "--stdin-filepath <path>         Format standard input as this file and print the result"
    ),
    clap::param!(
        "--ignore-path <path>...         Read ignore patterns from these files <d>(default: .gitignore and .prettierignore)<r>"
    ),
    clap::param!("--ignore-pattern <pattern>...   Skip files that match this pattern"),
    clap::param!("--with-node-modules             Format files in <b>node_modules<r> too"),
    clap::param!("--no-error-on-unmatched-pattern  Do not fail when an argument matches no file"),
    clap::param!("-u, --ignore-unknown            Ignore files in an unknown language"),
    clap::param!(
        "--allow-unsupported             Warn instead of failing when the language of a file is not supported"
    ),
    clap::param!(
        "--list-files                    Print the files that would be formatted and exit"
    ),
    clap::param!("--cwd <path>                    Set the working directory"),
];

const OUTPUT: &[Param] = &[
    clap::param!(
        "-c, --check                     Do not write. Exit with 1 if a file needs formatting"
    ),
    clap::param!(
        "-l, --list-different            Do not write. Print the files that need formatting and exit with 1 if there are any"
    ),
    clap::param!(
        "--log-level <level>             <b>silent<r>, <b>error<r>, <b>warn<r>, <b>log<r> <d>(default)<r>, or <b>debug<r>"
    ),
    clap::param!(
        "-f, --format <name>             With <b>--doctor<r>, print the report as <b>json<r>"
    ),
    clap::param!("--color                         Always use colors"),
    clap::param!("--no-color                      Never use colors"),
    clap::param!("--timing                        Print how long each phase took"),
];

const OTHER: &[Param] = &[
    clap::param!(
        "--threads <n>                   Number of threads <d>(default: one per CPU core)<r>"
    ),
    clap::param!(
        "--debug-check                   Do not write. Fail if formatting a file would change what it means"
    ),
    clap::param!("-v, --version                   Print the version of Bun"),
    clap::param!(
        "-h, --help                      Print the common flags. With <b>--all<r>, every flag"
    ),
    clap::param!("--all                           With <b>--help<r>, print every flag"),
    clap::param!("--help-all                      The same as <b>--help --all<r>"),
];

const OF_PRETTIER: &[Param] = &[
    clap::param!("-w, --write                     Write the files. This is the default"),
    clap::param!(
        "--config-precedence <which>     <b>cli-override<r> <d>(default)<r>, <b>file-override<r>, or <b>prefer-file<r>"
    ),
    clap::param!(
        "--find-config-path <path>       Print the path of the config for a file and exit"
    ),
    clap::param!(
        "--parser <name>                 Read every file with this parser. Without files, format standard input"
    ),
    clap::param!("--plugin <name>...              Load these plugins"),
    clap::param!(
        "--require-pragma                Only format files that start with a <b>@format<r> or <b>@prettier<r> comment"
    ),
    clap::param!(
        "--check-ignore-pragma           Skip files that start with a <b>@noformat<r> or <b>@noprettier<r> comment"
    ),
    clap::param!(
        "--insert-pragma                 Put a <b>@format<r> comment at the top of formatted files"
    ),
    clap::param!("--range-start <offset>          Only format the statements from this offset on"),
    clap::param!("--range-end <offset>            Only format the statements up to this offset"),
    clap::param!(
        "--cursor-offset <offset>        For standard input, print on stderr where this offset ends up"
    ),
    clap::param!(
        "--experimental-ternaries        Put the question mark of a ternary after the condition"
    ),
    clap::param!(
        "--experimental-operator-position <where>  <b>end<r> <d>(default)<r> or <b>start<r>"
    ),
    clap::param!("--jsx-bracket-same-line         The old name of <b>--bracket-same-line<r>"),
    clap::param!("--cache                         No effect. Every run formats every file"),
    clap::param!("--cache-location <path>         No effect"),
    clap::param!("--cache-strategy <strategy>     No effect"),
    clap::param!("--experimental-cli              No effect"),
];

const OF_OXFMT: &[Param] = &[
    clap::param!(
        "--flavor <which>                Without a config file, format like <b>prettier<r> or like <b>oxfmt<r>"
    ),
    clap::param!(
        "--disable-nested-config         Use the config file in the working directory for every file"
    ),
    clap::param!("--migrate <source>              Not supported"),
    clap::param!("--lsp                           Not supported"),
];

/// Flags that `--help` lists in their `--no-..` form.
const OPPOSITES: &[Param] = &[
    clap::param!("--editorconfig"),
    clap::param!("--semi"),
    clap::param!("--bracket-spacing"),
    clap::param!("--error-on-unmatched-pattern"),
    clap::param!("--insert-final-newline"),
];

pub const HELP: Help = Help {
    groups: &[
        Group {
            title: "Options",
            params: OPTIONS,
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
            title: "Other",
            params: OTHER,
        },
        Group {
            title: "Compatibility with Prettier",
            params: OF_PRETTIER,
        },
        Group {
            title: "Compatibility with oxfmt",
            params: OF_OXFMT,
        },
    ],
    common: &[
        b"check",
        b"staged",
        b"changed",
        b"stdin-filepath",
        b"print-width",
        b"use-tabs",
        b"no-semi",
        b"single-quote",
        b"init",
        b"doctor",
    ],
};

const _: () = assert!(
    HELP.describes_every_flag(),
    "A flag of `bun fmt` has no description, so `--help --all` leaves it out."
);

pub(crate) const PARAMS: &[Param] = clap::concat_params!(
    OPTIONS,
    FILES,
    OUTPUT,
    OTHER,
    OF_PRETTIER,
    OF_OXFMT,
    OPPOSITES
);

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

/// One entry of `[[fmt.overrides]]`.
#[derive(Clone, Debug, Default)]
pub struct Override {
    /// Globs matched against the path relative to where bunfig.toml is. A glob without a slash matches the file name.
    pub files: Vec<Vec<u8>>,
    pub excluded: Vec<Vec<u8>>,
    /// Same format as [`Options::format`].
    pub format: Vec<(&'static [u8], Vec<u8>)>,
}

impl Override {
    /// Drops the options that the command-line flag `name` replaces. A flag that only turns a feature on keeps the
    /// override's options for it.
    fn give_way_to(&mut self, name: &[u8], value: &[u8]) {
        self.format.retain(|it| {
            let (whole, is_part) = match strings::split_once_char(it.0, b'.') {
                Some((whole, _)) => (whole, true),
                None => (it.0, false),
            };
            whole != name || (value == b"true" && (is_part || it.1 != b"false"))
        });
    }
}

/// What the command line says.
#[derive(Clone, Debug)]
pub struct Options {
    /// Files, directories and patterns.
    pub patterns: Vec<Vec<u8>>,
    pub check: bool,
    /// What follows `-c`, which is `--check` for Prettier and `--config <path>` for oxfmt, and
    /// whether `--check` is there too.
    after_short_c: Option<(Vec<u8>, bool)>,
    pub list_different: bool,
    pub write: bool,
    /// The flags of which oxfmt takes one, once: as they follow each other on the command line, by their long names.
    modes: Vec<&'static [u8]>,
    pub stdin_filepath: Option<Vec<u8>>,
    pub config: Option<Vec<u8>>,
    /// `false`: `--no-config`.
    pub config_lookup: bool,
    pub disable_nested_config: bool,
    pub editorconfig: bool,
    pub config_precedence: Precedence,
    /// `None`: `.gitignore` and `.prettierignore`.
    pub ignore_path: Option<Vec<Vec<u8>>>,
    /// Lines of an ignore file that is in the working directory.
    pub ignore_pattern: Vec<Vec<u8>>,
    /// How many of them, the first, are of bunfig.toml: lines of an ignore file that is where that file is.
    pub ignore_patterns_of_bunfig: usize,
    /// The bunfig that was read, or would have been: a path from the working directory.
    pub bunfig: Vec<u8>,
    /// It has a `[fmt]` section, which was read.
    pub has_section_of_bunfig: bool,
    /// `bun --config=<path>` names it.
    pub is_bunfig_named: bool,
    /// `--staged`, `--changed`
    pub only: Option<crate::git::Only>,
    pub with_node_modules: bool,
    pub error_on_unmatched_pattern: bool,
    /// Nothing is said about a file that there is no parser for.
    pub ignore_unknown: bool,
    /// Files that Prettier or oxfmt would format and this formatter cannot are no error.
    pub allow_unsupported: bool,
    /// `--flavor oxfmt`, or `false`: `--flavor prettier`.
    pub is_like_oxfmt: Option<bool>,
    /// Add `[fmt]` to bunfig.toml.
    pub init: bool,
    /// Report what a run would do with this config, without formatting.
    pub doctor: bool,
    /// `-f json`
    pub as_json: bool,
    pub find_config_path: Option<Vec<u8>>,
    pub log_level: LogLevel,
    /// Prettier's options and Bun's extra features, by their config-file names. Values are JSON text, except that
    /// strings have no quotes.
    pub format: Vec<(&'static [u8], Vec<u8>)>,
    /// Only `[fmt]` can set these.
    pub overrides: Vec<Override>,
    pub plugins: Vec<Vec<u8>>,
    pub color: Option<bool>,
    pub version: bool,
    pub help: bool,
    /// With `help`, list every flag.
    pub all: bool,
    /// `0`: the number of cores.
    pub threads: usize,
    pub timing: bool,
    pub cwd: Option<Vec<u8>>,
    /// Nothing is written. What would be written is parsed and compared with what is there.
    pub debug_check: bool,
    /// Prints the files that would be formatted, and formats nothing.
    pub list_files: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            patterns: Vec::new(),
            check: false,
            after_short_c: None,
            list_different: false,
            write: false,
            modes: Vec::new(),
            stdin_filepath: None,
            config: None,
            config_lookup: true,
            disable_nested_config: false,
            editorconfig: true,
            config_precedence: Precedence::default(),
            ignore_path: None,
            ignore_pattern: Vec::new(),
            ignore_patterns_of_bunfig: 0,
            bunfig: b"bunfig.toml".to_vec(),
            has_section_of_bunfig: false,
            is_bunfig_named: false,
            only: None,
            with_node_modules: false,
            error_on_unmatched_pattern: true,
            ignore_unknown: false,
            allow_unsupported: false,
            is_like_oxfmt: None,
            init: false,
            doctor: false,
            as_json: false,
            find_config_path: None,
            log_level: LogLevel::default(),
            format: Vec::new(),
            overrides: Vec::new(),
            plugins: Vec::new(),
            color: None,
            version: false,
            help: false,
            all: false,
            threads: 0,
            timing: false,
            cwd: None,
            debug_check: false,
            list_files: false,
        }
    }
}

/// The name in a configuration file of the option that a flag sets.
pub(crate) fn option_of(flag: &[u8]) -> Option<&'static [u8]> {
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
        b"prose-wrap" => b"proseWrap",
        b"html-whitespace-sensitivity" => b"htmlWhitespaceSensitivity",
        b"vue-indent-script-and-style" => b"vueIndentScriptAndStyle",
        b"require-pragma" => b"requirePragma",
        b"insert-pragma" => b"insertPragma",
        b"check-ignore-pragma" => b"checkIgnorePragma",
        b"parser" => b"parser",
        b"cursor-offset" => b"cursorOffset",
        b"range-start" => b"rangeStart",
        b"range-end" => b"rangeEnd",
        b"jsx-bracket-same-line" => b"jsxBracketSameLine",
        b"sort-imports" => b"sortImports",
        b"sort-tailwindcss" => b"sortTailwindcss",
        b"sort-package-json" => b"sortPackageJson",
        b"jsdoc" => b"jsdoc",
        b"svelte" => b"svelte",
        b"insert-final-newline" => b"insertFinalNewline",
        _ => return None,
    })
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
        if let Some(option) = option_of(name) {
            // Already on, so keep it. `[fmt]` may have set a table of options for it.
            let is_on_already = |it: &(&[u8], Vec<u8>)| it.0 == option && it.1 != b"false";
            if value.is_none() && is_on && self.format.iter().any(is_on_already) {
                return Ok(());
            }
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
            b"init" => self.init = is_on,
            b"doctor" => self.doctor = is_on,
            b"format" if text == b"json" => self.as_json = true,
            b"format" => {
                return error(&[b"--format takes json, not \"", text, b"\""]);
            }
            b"flavor" => {
                self.is_like_oxfmt = match text {
                    b"oxfmt" => Some(true),
                    b"prettier" => Some(false),
                    _ => {
                        return error(&[
                            b"Invalid --flavor value. Expected \"oxfmt\" or \"prettier\", but received \"",
                            text,
                            b"\".",
                        ]);
                    }
                };
            }
            b"migrate" | b"lsp" => {
                return error(&[b"bun fmt does not support --", name]);
            }
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
            b"ignore-pattern" => self.ignore_pattern.push(text.to_vec()),
            b"staged" | b"changed" => crate::git::Only::set(&mut self.only, name, value, is_on)?,
            b"with-node-modules" => self.with_node_modules = is_on,
            b"error-on-unmatched-pattern" => self.error_on_unmatched_pattern = is_on,
            b"ignore-unknown" => self.ignore_unknown = is_on,
            b"allow-unsupported" => self.allow_unsupported = is_on,
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
            b"all" => self.all = is_on,
            b"help-all" => (self.help, self.all) = (is_on, is_on),
            b"threads" => match bun_core::fmt::parse_decimal::<usize>(text) {
                Some(count) if count > 0 => self.threads = count,
                _ => return error(&[b"--threads takes a number above zero, not \"", text, b"\""]),
            },
            b"timing" => self.timing = is_on,
            b"cwd" => self.cwd = owned(),
            b"debug-check" => self.debug_check = is_on,
            _ => {}
        }
        Ok(())
    }

    /// True for `bun fmt --parser x` with no paths. Like Prettier, that formats standard input, which has no file name
    /// then. An empty `--stdin-filepath` is no name either. It must never fall back to the working directory: one parser
    /// would rewrite every file there.
    pub(crate) fn formats_unnamed_stdin(&self) -> bool {
        let only_reports = self.doctor || self.list_files;
        self.patterns.is_empty()
            && self.stdin_filepath.as_ref().is_none_or(Vec::is_empty)
            && !only_reports
            && self.format.iter().any(|it| it.0 == b"parser")
    }

    /// As `--no-config --no-editorconfig`.
    pub(crate) fn ignore_configuration(&mut self) {
        self.config_lookup = false;
        self.editorconfig = false;
    }

    /// The same command line as oxfmt reads it, if that is another way.
    pub(crate) fn as_oxfmt_reads_it(&self) -> Option<Options> {
        let (path, checks) = self.after_short_c.as_ref()?;
        let mut options = self.clone();
        let at = options.patterns.iter().position(|it| it == path)?;
        options.config = Some(options.patterns.remove(at));
        options.check = *checks;
        Some(options)
    }

    /// Why the tool refuses the flags that say what the run does, in its words.
    pub(crate) fn refusal_of_modes(&self, is_oxfmt: bool) -> Option<Vec<u8>> {
        let of_debug_check = || {
            (self.write && self.debug_check)
                .then(|| b"Cannot use --write and --debug-check together.".to_vec())
        };
        if !is_oxfmt {
            return (self.check && self.list_different)
                .then(|| b"Cannot use --check and --list-different together.".to_vec())
                .or_else(of_debug_check);
        }
        // The second is what oxfmt stops at, whatever follows.
        let &[first, second, ..] = &self.modes[..] else {
            return of_debug_check();
        };
        Some(match first == second {
            true => [
                &b"argument `--"[..],
                second,
                b"` cannot be used multiple times in this context",
            ]
            .concat(),
            false => [
                &b"`--"[..],
                second,
                b"` cannot be used at the same time as `--",
                first,
                b"`",
            ]
            .concat(),
        })
    }

    /// `args`: what follows `format` on the command line.
    pub fn parse(args: &[&[u8]]) -> Result<Options, UsageError> {
        Options::default().with(args)
    }

    /// `self`: what the bunfig at `path` says, which is a path from the working directory. What is a path in it starts at
    /// [`Options::start_of_bunfig`]. `is_named`: [`Options::is_bunfig_named`].
    pub fn of_bunfig_at(mut self, path: &[u8], is_named: bool) -> Options {
        self.bunfig = paths::from_native(path);
        self.has_section_of_bunfig = true;
        self.is_bunfig_named = is_named;
        self.ignore_patterns_of_bunfig = self.ignore_pattern.len();
        let directory = paths::dirname(&self.bunfig).to_vec();
        if directory != b"." && !is_named {
            let files = self.ignore_path.iter_mut().flatten();
            for it in self.config.iter_mut().chain(files) {
                let written = paths::from_native(it);
                if !paths::is_absolute(&written) {
                    *it = paths::join_normalized(&directory, &written);
                }
            }
        }
        self
    }

    /// The bunfig.toml above the working directory whose `[fmt]` was found.
    pub(crate) fn bunfig_above(&self) -> Option<&[u8]> {
        let is_above = paths::dirname(&self.bunfig) != b"." && !self.is_bunfig_named;
        (is_above && self.has_section_of_bunfig).then_some(&self.bunfig)
    }

    /// Where the paths and the patterns in bunfig.toml start: where the file is. `--config` can name a file that is kept
    /// anywhere, and then it is the working directory.
    pub(crate) fn start_of_bunfig(&self, cwd: &[u8]) -> Vec<u8> {
        match self.is_bunfig_named {
            true => cwd.to_vec(),
            false => paths::dirname(&paths::resolve(cwd, &self.bunfig)).to_vec(),
        }
    }

    /// The same, where a flag that is not there is as `defaults` says: [`crate::bunfig::format`].
    pub fn parse_over(mut defaults: Options, args: &[&[u8]]) -> Result<Options, UsageError> {
        let alone = Options::parse(args)?;
        // `--config` and `--no-config` are refused together. Either takes the place of what is there.
        if alone.config.is_some() || !alone.config_lookup {
            (defaults.config, defaults.config_lookup) = (None, true);
        }
        for (name, value) in &alone.format {
            (defaults.overrides.iter_mut()).for_each(|it| it.give_way_to(name, value));
        }
        defaults.with(args)
    }

    fn with(self, args: &[&[u8]]) -> Result<Options, UsageError> {
        let mut options = self;
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
        if let Some(at) = args.iter().position(|arg| *arg == b"-c")
            && let Some(next) = args.get(at + 1).filter(|next| !next.starts_with(b"-"))
        {
            options.after_short_c = Some((next.to_vec(), args.contains(&&b"--check"[..])));
        }
        let flags = args.iter().take_while(|arg| **arg != b"--");
        options.modes = (flags.enumerate())
            .filter_map(|(at, arg)| -> Option<&'static [u8]> {
                match *arg {
                    // `--config` for oxfmt.
                    b"-c" if args.get(at + 1).is_some_and(|next| !next.starts_with(b"-")) => None,
                    b"--check" | b"-c" => Some(b"check"),
                    b"--list-different" | b"-l" => Some(b"list-different"),
                    b"--write" | b"-w" => Some(b"write"),
                    b"--init" => Some(b"init"),
                    b"--stdin-filepath" => Some(b"stdin-filepath"),
                    _ if arg.starts_with(b"--stdin-filepath=") => Some(b"stdin-filepath"),
                    _ => None,
                }
            })
            .collect();
        crate::args::parse(PARAMS, &args, &mut |argument| match argument {
            Argument::Flag { name, value, is_on } => options.set(name, value, is_on),
            Argument::Positional(pattern) => {
                options.patterns.push(pattern.to_vec());
                Ok(())
            }
        })?;
        if options.all && !options.help {
            return error(&[b"--all has no effect without --help"]);
        }
        Ok(options)
    }
}
