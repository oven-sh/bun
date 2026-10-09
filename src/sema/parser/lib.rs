//! A parser that writes `bun_sema::hir` directly: no syntax tree in between.
//!
//! It is a recursive descent parser with the structure of TypeScript's own (parser.go of
//! typescript-go, Copyright Microsoft Corporation, Apache License 2.0): comments name the function a
//! piece of code corresponds to. Where that parser looks ahead or parses speculatively, so does
//! this one, so both decide every ambiguity the same way.
//!
//! It parses what is valid. It has no error recovery and reports no error: a text that it cannot
//! vouch for is refused ([`Refusal`]), and the caller hands that text to the parser that recovers
//! from errors as TypeScript does.

#![forbid(unsafe_code)]
#![feature(portable_simd)]

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
    COUNTS, Counts, Summary, ThreadCaches, summarize, summarize_as, summarize_in,
    with_part_in_place, with_summary, with_summary_in_place,
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
    fn is_of_scanner(self) -> bool {
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
    /// Goes on after a syntax error as TypeScript's parser does, and reports it. Not finished: what
    /// is not written yet is refused as without it.
    pub recovers: bool,
    /// The tags of JSDoc comments are read as TypeScript's parser reads them: in a JavaScript file
    /// they become types, casts and declarations, in a TypeScript file they are only looked at for
    /// what the checker asks about them. Only [`parse`] does it, and only for TypeScript's dialect.
    pub reads_jsdoc: bool,
    pub dialect: bun_sema::resolve::Dialect,
    pub goal: Goal,
}

/// What is parsed.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub enum Goal {
    /// The text, which is a file.
    #[default]
    File,
    /// What the text starts with, as acorn's `parseExpressionAt` does it: nothing is said about what
    /// follows, and nothing of it is read but one token. The file has one statement.
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
    stacks: parser::Stacks,
    /// The emptied lists of a file that is no longer needed.
    recycled: FileBuilder,
    /// What `parser::jsdoc::read_by_checker` says of the TypeScript file that is parsed for the
    /// second time. Otherwise 0.
    jsdoc_wanted: u8,
}

impl Scratch {
    /// Takes the lists of `file` for the next file.
    pub fn recycle(&mut self, file: FileBuilder) {
        self.recycled = file;
    }

    /// The first error in the text that was refused last, if the parser had reported one before it
    /// gave up.
    pub fn error_before_refusal(&self) -> Option<&bun_sema::hir::Diagnostic> {
        let errors = self.recycled.diagnostics.iter();
        errors
            .filter(|it| it.kind == bun_sema::hir::DiagnosticKind::Parse)
            .min_by_key(|it| it.start)
    }

    /// The atoms of the file with the text `text`, which [`parse_with_own_atoms`] has parsed last.
    pub fn atoms<'a>(&'a self, text: &'a [u8]) -> FileAtoms<'a> {
        self.names.of_file(text)
    }
}

/// What [`parse`] returns beside the file.
pub struct Parsed {
    pub file: FileBuilder,
    /// `await` was read as a keyword at the top level.
    pub has_top_level_await: bool,
    /// The end of the last token of what [`Options::goal`] asks for.
    pub end: u32,
}

/// `parser::run`. What follows a part of a text need not be a token: then the text ends before it.
fn run(
    text: &[u8],
    options: Options,
    atoms: Option<&dyn Intern>,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    let refused = match parser::run(text, options, atoms, scratch) {
        Err(refused) if options.goal != Goal::File && refused.why.is_of_scanner() => refused,
        done => return done,
    };
    let before = text.get(..refused.after as usize).unwrap_or_default();
    let at = refused.after;
    parser::run(before, options, atoms, scratch).or(Err(Refused { at, ..refused }))
}

/// The HIR of `text`. Names are interned in `atoms`.
pub fn parse(
    text: &[u8],
    options: Options,
    atoms: &dyn Intern,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    let parsed = run(text, options, Some(atoms), scratch)?;
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
    let parsed = run(text, options, Some(atoms), scratch);
    scratch.jsdoc_wanted = 0;
    parsed
}

/// The HIR of `text`, with atoms that are the file's own: `Scratch::atoms` knows them until the next
/// file is parsed.
pub fn parse_with_own_atoms(
    text: &[u8],
    options: Options,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    run(text, options, None, scratch)
}

/// The number of tokens of `text`, as far as that can be told without parsing. For benchmarks of
/// the scanner alone.
pub fn count_tokens(text: &[u8], atoms: &dyn Intern, scratch: &mut Scratch) -> usize {
    use token::T;
    scratch.names.belong_to(atoms);
    let mut lx = lexer::Lexer::new(text, atoms, &mut scratch.names);
    let (mut count, mut previous) = (0, T::Eof);
    // For each open brace, whether it is that of a substitution.
    let mut braces: Vec<bool> = Vec::new();
    loop {
        lx.next();
        match lx.token {
            T::Eof => return count,
            T::OpenBrace => braces.push(false),
            T::CloseBrace => {
                if braces.pop() == Some(true) {
                    lx.rescan_template_continuation();
                }
            }
            T::Slash | T::SlashEquals
                if !matches!(
                    previous,
                    T::Identifier
                        | T::Number
                        | T::String
                        | T::CloseParen
                        | T::CloseBracket
                        | T::CloseBrace
                        | T::This
                        | T::NoSubstitutionTemplate
                        | T::TemplateTail
                ) =>
            {
                lx.rescan_slash();
            }
            _ => {}
        }
        if matches!(lx.token, T::TemplateHead | T::TemplateMiddle) {
            braces.push(true);
        }
        previous = lx.token;
        count += 1;
    }
}
