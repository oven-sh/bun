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
pub use parser::keyword_suggestion;

use bun_sema::atom::Intern;
use bun_sema::hir::FileBuilder;
pub use summarize::{
    COUNTS, Counts, PartError, Parts, Summary, ThreadCaches, summarize, summarize_as, summarize_in,
    with_summary, with_summary_in_place,
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
    /// and only for TypeScript's dialect.
    pub reads_jsdoc: bool,
    pub dialect: bun_sema::resolve::Dialect,
    /// Parse only this part of the text.
    pub part: Option<Part>,
    /// Records what a formatter needs to attach comments to nodes: `enclosing_node`, `preceding_node` and
    /// `following_node` of `hir::Comment`, and the HTML-like comments of a script.
    pub attach_comments: bool,
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
    let parsed = parser::run(text, options, Some(atoms), scratch)?;
    if !options.reads_jsdoc || options.is_javascript {
        return Ok(parsed);
    }
    // Which comments of a TypeScript file get read depends on all of its comments, so that takes a second parse.
    let is_declaration_file = options.is_declaration_file;
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
