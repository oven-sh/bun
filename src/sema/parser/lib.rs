//! A parser that writes `bun_sema::hir` directly: no syntax tree in between.
//!
//! It is a recursive descent parser with the structure of TypeScript's own (parser.go of
//! typescript-go, Copyright Microsoft Corporation, Apache License 2.0): comments name the function a
//! piece of code corresponds to. Where that parser looks ahead or parses speculatively, so does
//! this one, so both decide every ambiguity the same way.
//!
//! It is compiled twice. The one instance parses what is valid: it has no error recovery and reports
//! no error, and a text that it cannot vouch for is refused ([`Refusal`]). The other
//! ([`Options::recovers`], [`Options::reads_jsdoc`]) goes on after an error as TypeScript's parser does,
//! and reports what that reports. [`summarize`] and its kin ask the first, and the second for what the
//! first has refused.

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

/// Why a text is not parsed.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash, PartialOrd, Ord)]
pub enum Refusal {
    /// A token that the grammar does not allow where it is. In a speculative parse this only ends
    /// the speculation.
    Syntax,
    /// The text is valid for the grammar, and TypeScript reports an error about it while parsing.
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
    /// Not written yet.
    Jsx,
    Json,
    AwaitInScript,
    Decorators,
    Unsupported,
}

impl Refusal {
    /// The scanner has met what is no token.
    pub(crate) fn is_of_scanner(self) -> bool {
        matches!(
            self,
            Refusal::NotUtf8
                | Refusal::Unterminated
                | Refusal::UnexpectedCharacter
                | Refusal::ConflictMarker
                | Refusal::InvalidEscape
                | Refusal::EscapedKeyword
                | Refusal::UnusualNumber
                | Refusal::UnusualRegex
                | Refusal::UnusualPrivateName
        )
    }

    /// How many reasons there are.
    pub const COUNT: usize = Refusal::Unsupported as usize + 1;

    /// All of them, by their numbers.
    pub const ALL: [Refusal; Refusal::COUNT] = [
        Refusal::Syntax,
        Refusal::Reported,
        Refusal::TooLarge,
        Refusal::TooDeep,
        Refusal::NotUtf8,
        Refusal::Unterminated,
        Refusal::UnexpectedCharacter,
        Refusal::ConflictMarker,
        Refusal::InvalidEscape,
        Refusal::EscapedKeyword,
        Refusal::UnusualNumber,
        Refusal::UnusualRegex,
        Refusal::UnusualPrivateName,
        Refusal::Jsx,
        Refusal::Json,
        Refusal::AwaitInScript,
        Refusal::Decorators,
        Refusal::Unsupported,
    ];
}

/// A refusal, and where it comes from.
#[derive(Copy, Clone, Debug)]
pub struct Refused {
    pub why: Refusal,
    /// The position in the text.
    pub at: u32,
    /// The line of this crate that refused.
    pub by: &'static core::panic::Location<'static>,
    /// The end of the last token that was scanned.
    pub after: u32,
}

impl Refused {
    #[track_caller]
    fn new(why: Refusal) -> Refused {
        Refused {
            why,
            at: 0,
            by: core::panic::Location::caller(),
            after: 0,
        }
    }
}

/// How a text is read.
#[derive(Copy, Clone, Default)]
pub struct Options {
    /// `.d.ts` and the like.
    pub is_declaration_file: bool,
    /// JSX is part of the grammar, and `<T>e` is not.
    pub is_jsx: bool,
    /// `.js`, `.jsx`, `.mjs`, `.cjs`
    pub is_javascript: bool,
    /// `.json`: `parseJSONText`. With `is_javascript` and `is_jsx`, as `initializeState` has it.
    pub is_json: bool,
    /// The top level is not an await context.
    pub await_is_a_name: bool,
    /// For oxc, in a file whose name does not say what it is: until something says that it is a module, an `await` at the top
    /// level is a name unless a word or a literal follows it.
    pub is_module_or_script: bool,
    /// Goes on after a syntax error as TypeScript's parser does, and reports it.
    pub recovers: bool,
    /// The tags of JSDoc comments are read as TypeScript's parser reads them: in a JavaScript file
    /// they become types, casts and declarations, in a TypeScript file they are only looked at for
    /// what the checker asks about them. Only [`parse`] does it, and only for TypeScript's dialect.
    pub reads_jsdoc: bool,
    pub dialect: bun_sema::resolve::Dialect,
    /// Not the whole text is parsed.
    pub part: Option<Part>,
}

/// A part of a text, as acorn's `parseExpressionAt` reads one: nothing is said about what follows it, and nothing of that
/// is read but one token. The file has one statement.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Part {
    pub goal: Goal,
    /// Where it starts.
    pub from: u32,
    /// Where the text ends for the parser.
    pub until: u32,
}

/// What a [`Part`] is.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Goal {
    /// `parseExpression`: an expression statement.
    Expression,
    /// `var`, `let` or `const` and their declarations, with or without a `;` behind them.
    Declaration,
    /// `parseType`: the type of a type alias without a name.
    Type,
}

/// What a thread keeps from one file to the next: the caches of names, and the capacity of every
/// list.
#[derive(Default)]
pub struct Scratch {
    names: names::Names,
    stops: bun_highway::ScannerStopsBuffer,
    stacks: parser::Stacks,
    declared: parser::Declared,
    /// A file that is no longer needed: its lists are for the next one, and so is the box. A file is large, and goes from
    /// hand to hand.
    recycled: Option<Box<FileBuilder>>,
    /// What `parser::jsdoc::read_by_checker` says of the TypeScript file that is parsed for the
    /// second time. Otherwise 0.
    jsdoc_wanted: u8,
    /// Of the text that was parsed last.
    html_opens: lexer::HtmlOpens,
    /// The text that was parsed last has an `await` at its top level, and each of them can be a name: `await (a)`.
    has_only_ambiguous_awaits: bool,
}

impl Scratch {
    /// Takes the lists of `file` for the next file.
    pub fn recycle(&mut self, file: Box<FileBuilder>) {
        self.recycled = Some(file);
    }

    /// An error in the text that was refused last, which has `len` bytes, if the parser had reported
    /// one before it gave up: the first in the text, or the one that was reported first.
    pub fn error_before_refusal(
        &self,
        is_first_in_text: bool,
        len: usize,
    ) -> Option<&bun_sema::hir::Diagnostic> {
        let errors = self.recycled.iter().flat_map(|it| &it.diagnostics);
        // From a refusal on the parser is at the end of the text.
        let mut errors = errors.filter(|it| {
            it.kind == bun_sema::hir::DiagnosticKind::Parse && (it.start as usize) < len
        });
        match is_first_in_text {
            true => errors.min_by_key(|it| it.start),
            false => errors.next(),
        }
    }

    /// The atoms of the file with the text `text`, which [`parse_with_own_atoms`] has parsed last.
    pub fn atoms<'a>(&'a self, text: &'a [u8]) -> FileAtoms<'a> {
        self.names.of_file(text)
    }
}

/// What [`parse`] returns beside the file.
pub struct Parsed {
    pub file: Box<FileBuilder>,
    /// `await` was read as a keyword at the top level.
    pub has_top_level_await: bool,
    /// The end of the last token of [`Options::part`], or of the text, and the end of the token behind it: the last that has
    /// been looked at.
    pub end: (u32, u32),
}

/// The HIR of `text`. Names are interned in `atoms`.
pub(crate) fn parse(
    text: &[u8],
    options: Options,
    atoms: &dyn Intern,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    let parsed = parser::run(text, options, Some(atoms), scratch)?;
    if !options.reads_jsdoc || options.is_javascript {
        return Ok(parsed);
    }
    // Which comments of a TypeScript file are read depends on all of them.
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

/// The HIR of `text`, with atoms that are the file's own: `Scratch::atoms` knows them until the next
/// file is parsed.
pub(crate) fn parse_with_own_atoms(
    text: &[u8],
    options: Options,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    parser::run(text, options, None, scratch)
}
