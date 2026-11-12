//! A parser that writes `bun_sema::hir` directly, with no syntax tree in between.
//!
//! It's a recursive descent parser structured like TypeScript's own (parser.go of typescript-go, Copyright Microsoft
//! Corporation, Apache License 2.0). Comments cite the function each piece of code corresponds to. It looks ahead and
//! parses speculatively in the same places as that parser, so both resolve every ambiguity the same way.
//!
//! It's compiled twice. The first instance only parses valid code. It has no error recovery, reports no errors, and
//! rejects any text it can't vouch for ([`Rejection`]). The second ([`Options::recovers`], [`Options::reads_jsdoc`])
//! continues after an error the way TypeScript's parser does and reports the same errors. [`summarize`] and its
//! siblings try the first instance and fall back to the second for text the first rejected.

#![forbid(unsafe_code)]

mod lexer;
mod names;
mod parser;
mod pragmas;
mod summarize;
mod token;

pub use names::FileAtoms;
pub use parser::{AppendedExpression, AppendedExpressionFilter, keyword_suggestion};

use bun_sema::atom::Intern;
use bun_sema::hir::FileBuilder;
pub use summarize::{
    COUNTS, CompileParseOptions, Counts, PartError, Parts, Summary, ThreadCaches,
    parse_appended_expressions, parse_for_compile, parse_for_compile_in, summarize, summarize_as,
    summarize_in, summarize_top_level, with_summary, with_summary_in_place,
};

/// Why the parser rejected a text.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash, PartialOrd, Ord)]
pub enum Rejection {
    /// A token the grammar doesn't allow at its position. In a speculative parse this only ends the speculation.
    Syntax,
    /// The grammar accepts the text, but TypeScript reports an error about it while parsing.
    Reported,
    TooLarge,
    TooDeep,
    NotUtf8,
    Unterminated,
    UnexpectedCharacter,
    ConflictMarker,
    InvalidEscape,
    EscapedKeyword,
    UnusualNumber,
    UnusualRegex,
    UnusualPrivateName,
    /// Not implemented yet.
    Jsx,
    Json,
    AwaitInScript,
    Decorators,
    Unsupported,
}

impl Rejection {
    /// True if the scanner hit something that isn't a token.
    pub(crate) fn is_scanner_error(self) -> bool {
        matches!(
            self,
            Rejection::NotUtf8
                | Rejection::Unterminated
                | Rejection::UnexpectedCharacter
                | Rejection::ConflictMarker
                | Rejection::InvalidEscape
                | Rejection::EscapedKeyword
                | Rejection::UnusualNumber
                | Rejection::UnusualRegex
                | Rejection::UnusualPrivateName
        )
    }

    /// The number of reasons.
    pub const COUNT: usize = Rejection::Unsupported as usize + 1;

    /// Every reason, indexed by its discriminant.
    pub const ALL: [Rejection; Rejection::COUNT] = [
        Rejection::Syntax,
        Rejection::Reported,
        Rejection::TooLarge,
        Rejection::TooDeep,
        Rejection::NotUtf8,
        Rejection::Unterminated,
        Rejection::UnexpectedCharacter,
        Rejection::ConflictMarker,
        Rejection::InvalidEscape,
        Rejection::EscapedKeyword,
        Rejection::UnusualNumber,
        Rejection::UnusualRegex,
        Rejection::UnusualPrivateName,
        Rejection::Jsx,
        Rejection::Json,
        Rejection::AwaitInScript,
        Rejection::Decorators,
        Rejection::Unsupported,
    ];
}

/// A refusal and where it came from.
#[derive(Copy, Clone, Debug)]
pub struct Rejected {
    pub why: Rejection,
    /// The position in the text.
    pub at: u32,
    /// The line in this crate that rejected the text.
    pub by: &'static core::panic::Location<'static>,
    /// The end of the last scanned token.
    pub after: u32,
}

impl Rejected {
    #[track_caller]
    fn new(why: Rejection) -> Rejected {
        Rejected {
            why,
            at: 0,
            by: core::panic::Location::caller(),
            after: 0,
        }
    }
}

/// Parser options.
#[derive(Copy, Clone, Default)]
pub struct Options {
    /// `.d.ts` and the like.
    pub is_declaration_file: bool,
    /// JSX is part of the grammar and `<T>e` isn't.
    pub is_jsx: bool,
    /// `.js`, `.jsx`, `.mjs`, `.cjs`
    pub is_javascript: bool,
    /// `.json`: `parseJSONText`. Set together with `is_javascript` and `is_jsx`, as in `initializeState`.
    pub is_json: bool,
    /// The top level isn't an await context.
    pub await_is_a_name: bool,
    /// For oxc, in a file whose name doesn't tell whether it's a module or a script. Until something marks it as a
    /// module, a top-level `await` is a name unless a word or a literal follows it.
    pub is_module_or_script: bool,
    /// Report syntax errors and continue after them, like TypeScript's parser.
    pub recovers: bool,
    /// Read JSDoc tags the way TypeScript's parser does. In a JavaScript file they become types, casts and
    /// declarations. In a TypeScript file only the tags the checker looks at are read. Only [`parse`] supports this,
    /// for TypeScript's dialect and for JavaScript parsed with `compiles`.
    pub reads_jsdoc: bool,
    pub dialect: bun_sema::resolve::Dialect,
    /// Parse only this part of the text.
    pub part: Option<Part>,
    /// Records what a formatter needs to attach comments to nodes: `enclosing_node`, `preceding_node` and
    /// `following_node` of `hir::Comment`, and the HTML-like comments of a script.
    pub attach_comments: bool,
    /// Parsing for `bun compile`.
    pub compiles: bool,
    /// The lexer reads text as `bun run` does. `compiles` implies it.
    pub reads_as_bun_run: bool,
    /// With `compiles`, in a file whose name names no language, such as a script without an extension: it is read as TypeScript, and `bun run` accepts the octal forms of JavaScript in it.
    pub accepts_legacy_octal: bool,
    /// With `compiles`: the engine gets the text as it is written, so a comment says of no call that it is pure.
    pub ignores_pure_comments: bool,
    /// Functions have empty bodies wherever `parser/skipped_blocks.rs` can step over their blocks.
    pub skips_function_blocks: bool,
    /// Of a TypeScript module only the `import` and `export` statements in front of the others are parsed. A text whose
    /// other statements may name a file, or declare what other files see, is rejected (`parser/skipped_blocks.rs`).
    pub reads_module_statements_alone: bool,
}

/// A part of a text, parsed like acorn's `parseExpressionAt`: whatever follows it isn't checked, and only one token of
/// it is scanned. The resulting file has one statement.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Part {
    pub goal: Goal,
    /// Where it starts.
    pub from: u32,
    /// Where the parser treats the text as ending.
    pub until: u32,
}

/// What a [`Part`] is parsed as.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Goal {
    /// `parseExpression`: an expression statement.
    Expression,
    /// `var`, `let` or `const` with its declarations, with or without a trailing `;`.
    Declaration,
    /// `parseType`: the type of an unnamed type alias.
    Type,
}

/// What a thread reuses from one file to the next: the name caches and every list's allocation.
#[derive(Default)]
pub struct Scratch {
    names: names::Names,
    stops: bun_highway::ScannerStopsBuffer,
    stacks: parser::Stacks,
    declared: parser::Declared,
    /// A file that's no longer needed. The next file reuses its lists and its box. It's boxed because a `FileBuilder`
    /// is large and gets moved around a lot.
    recycled: Option<Box<FileBuilder>>,
    /// The result of `parser::jsdoc::read_by_checker` while a TypeScript file is parsed a second time. Otherwise 0.
    jsdoc_wanted: u8,
    /// From the last parsed text.
    html_opens: lexer::HtmlOpens,
    /// True if the last parsed text has a top-level `await` and every one of them could be a name: `await (a)`.
    has_only_ambiguous_awaits: bool,
}

impl Scratch {
    /// Keeps `file` so the next file can reuse its lists.
    pub fn recycle(&mut self, file: Box<FileBuilder>) {
        self.recycled = Some(file);
    }

    /// Returns an error the parser reported in the last rejected text (`len` bytes long) before it gave up, if any:
    /// either the first in the text or the first reported.
    pub fn error_before_rejection(
        &self,
        is_first_in_text: bool,
        len: usize,
    ) -> Option<&bun_sema::hir::Diagnostic> {
        let errors = self.recycled.iter().flat_map(|it| &it.diagnostics);
        // Once it gives up, the parser is at the end of the text, so errors reported there don't count.
        let mut errors = errors.filter(|it| {
            it.kind == bun_sema::hir::DiagnosticKind::Parse && (it.start as usize) < len
        });
        match is_first_in_text {
            true => errors.min_by_key(|it| it.start),
            false => errors.next(),
        }
    }

    /// Returns the atoms of the file that [`parse_with_own_atoms`] parsed last. `text` is that file's text.
    pub fn atoms<'a>(&'a self, text: &'a [u8]) -> FileAtoms<'a> {
        self.names.file_atoms(text)
    }
}

/// The result of [`parse`].
pub struct Parsed {
    pub file: Box<FileBuilder>,
    /// True if a top-level `await` was parsed as a keyword.
    pub has_top_level_await: bool,
    /// True if `await` is a name somewhere outside every function, as in `var await`.
    pub names_await_at_top_level: bool,
    /// The end of the last token of [`Options::part`] (or of the text), and the end of the token after it, which is the
    /// last one scanned.
    pub end: (u32, u32),
}

/// Parses `text` into HIR. Names are interned in `atoms`.
pub(crate) fn parse(
    text: &[u8],
    options: Options,
    atoms: &dyn Intern,
    scratch: &mut Scratch,
) -> Result<Parsed, Rejected> {
    let is_declaration_file = options.is_declaration_file;
    // Which comments of a TypeScript file get read depends on all of its comments. The text says which it will most likely
    // be, and the comments that the parse has found say whether that was right.
    if options.reads_jsdoc && !options.is_javascript && !options.skips_function_blocks {
        let guessed = parser::jsdoc::guess_what_checker_reads(text, is_declaration_file);
        if guessed != 0 {
            scratch.jsdoc_wanted = guessed;
            let parsed = parser::run(text, options, Some(atoms), scratch);
            scratch.jsdoc_wanted = 0;
            if let Ok(parsed) = parsed {
                let comments = &parsed.file.comments;
                if parser::jsdoc::read_by_checker(text, comments, is_declaration_file) == guessed {
                    return Ok(parsed);
                }
                scratch.recycle(parsed.file);
            }
        }
    }
    let parsed = parser::run(text, options, Some(atoms), scratch)?;
    // Nobody reads the comments of a tree of which something was left out.
    let is_left_out = parsed.file.rare_syntax & bun_sema::hir::rare::LEFT_OUT != 0;
    if !options.reads_jsdoc || options.is_javascript || is_left_out {
        return Ok(parsed);
    }
    let comments = &parsed.file.comments;
    let wanted = parser::jsdoc::read_by_checker(text, comments, is_declaration_file);
    if wanted == 0 {
        return Ok(parsed);
    }
    scratch.recycle(parsed.file);
    scratch.jsdoc_wanted = wanted;
    let parsed = parser::run(text, options, Some(atoms), scratch);
    scratch.jsdoc_wanted = 0;
    parsed
}

/// Parses `text` into HIR with file-local atoms. `Scratch::atoms` resolves them until the next file is parsed.
pub(crate) fn parse_with_own_atoms(
    text: &[u8],
    options: Options,
    scratch: &mut Scratch,
) -> Result<Parsed, Rejected> {
    parser::run(text, options, None, scratch)
}

/// True if parsing `text` as TypeScript reports "File appears to be binary."
pub fn appears_to_be_binary(text: &[u8], is_jsx: bool) -> bool {
    const FILE_APPEARS_TO_BE_BINARY: u32 = 1490;
    // The scanner reports it only at bytes that aren't UTF-8 and at U+FFFD.
    let has_replacement_character = bun_core::strings::contains(text, "\u{FFFD}".as_bytes());
    if !has_replacement_character && core::str::from_utf8(text).is_ok() {
        return false;
    }
    let options = Options {
        is_jsx,
        recovers: true,
        compiles: true,
        ..Options::default()
    };
    parse_with_own_atoms(text, options, &mut Scratch::default()).is_ok_and(|parsed| {
        let mut diagnostics = parsed.file.diagnostics.iter();
        diagnostics.any(|it| it.code == FILE_APPEARS_TO_BE_BINARY)
    })
}

#[cfg(test)]
mod entries_tests {
    use super::parser::ENTRIES;
    use super::{summarize, summarize_top_level};
    use bun_sema::atom::Interner;
    use bun_sema::hir::rare;
    use bun_sema::session::Session;

    /// How often the parser is entered for `text`, how many statements the tree has, and whether it says that something
    /// was left out.
    fn count_entries(text: &str, is_short: bool) -> (u32, usize, bool) {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let (path, text) = (&b"/project/a.ts"[..], text.as_bytes());
        let before = ENTRIES.get();
        let file = match is_short {
            true => summarize_top_level(arena, path, None, text, &atoms, false, false, false),
            false => Some(summarize(
                arena, path, None, text, &atoms, false, false, false,
            )),
        };
        let file = file.expect("the text has no errors");
        let leaves_out = file.rare_syntax & rare::LEFT_OUT != 0;
        (ENTRIES.get() - before, file.stmts.len(), leaves_out)
    }

    #[test]
    fn the_short_form_enters_a_text_once_and_says_what_it_left_out() {
        let head = "import a from './a';\n";
        for (rest, statements, leaves_out) in [
            (
                "export const b = a;\nexport function f() { return b; }",
                1,
                true,
            ),
            ("export const c = () => import('./c');", 2, false),
            (
                "export function f() { return 1; }\nexport const c = 'import';",
                3,
                true,
            ),
            ("export * from './b';\nexport { c } from './c';", 3, false),
        ] {
            let text = format!("{head}{rest}");
            assert_eq!(
                count_entries(&text, true),
                (1, statements, leaves_out),
                "{rest}"
            );
        }
        assert_eq!(
            count_entries("const b = 2;\nexport const a = 1;", true),
            (1, 2, false)
        );
    }

    #[test]
    fn a_short_tree_that_left_nothing_out_has_the_statements_of_the_whole_tree() {
        for text in [
            "export * from './a';\nexport * from './b';",
            "import a from './a';\nexport const c = [a, () => import('./c')];",
            "declare global { interface Held { a: number } }\nexport {};",
        ] {
            let (short, whole) = (count_entries(text, true), count_entries(text, false));
            assert_eq!((short, whole.2), ((1, whole.1, false), false), "{text}");
        }
    }

    #[test]
    fn the_comments_that_are_read_are_known_before_the_first_token() {
        for (text, entries) in [
            ("export const a = 1;", 1),
            (
                "/** @param a one */\nexport function f(a: number) { return a; }",
                1,
            ),
            (
                "/** @param a one */\nexport function f(a: number) { return arguments.length + a; }",
                1,
            ),
            ("/** @augments A {@link B} */\nexport class C {}", 1),
            (
                "export const s = '@param';\nexport function f() { return arguments.length; }",
                2,
            ),
        ] {
            assert_eq!(count_entries(text, false).0, entries, "{text}");
        }
        let waits = "import './a';\n/** @param a one */\n\
                     export function f(a: number) { return arguments.length + a; }";
        assert_eq!(count_entries(waits, true), (1, 1, true));
    }
}

#[cfg(test)]
mod binary_tests {
    use super::appears_to_be_binary;

    #[test]
    fn executable_formats_and_noise_are_binary() {
        let files: [&[u8]; 5] = [
            b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x03\0\x3e\0\x01\0\0\0\xc0\x9a",
            b"\xcf\xfa\xed\xfe\x0c\0\0\x01\0\0\0\0\x06\0\0\0",
            b"MZ\x90\0\x03\0\0\0\x04\0\0\0\xff\xff\0\0\xb8\0",
            b"a = 1;\n\x9c\xe1\x02",
            "\u{FFFD}".as_bytes(),
        ];
        for file in files {
            assert!(appears_to_be_binary(file, true), "{file:?}");
            assert!(appears_to_be_binary(file, false), "{file:?}");
        }
    }

    #[test]
    fn text_is_not_binary_whatever_its_comments_and_strings_hold() {
        let files: [&[u8]; 6] = [
            b"",
            b"const n: number = 1;\n",
            "const s = \"\u{e9}\u{FFFD}\";\n".as_bytes(),
            b"// caf\xe9\nconsole.log(1);\n",
            b"/* \xff\xfe\0 */ console.log(1);\n",
            b"const s = 'caf\xe9';\n",
        ];
        for file in files {
            assert!(!appears_to_be_binary(file, true), "{file:?}");
            assert!(!appears_to_be_binary(file, false), "{file:?}");
        }
    }
}
