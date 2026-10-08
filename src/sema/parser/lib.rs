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

#![feature(portable_simd)]

mod lexer;
mod names;
mod parser;
mod pragmas;
mod token;

use bun_sema::atom::Intern;
use bun_sema::hir::FileBuilder;

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
    HtmlComment,
    InvalidEscape,
    EscapedKeyword,
    UnusualNumber,
    UnusualRegex,
    UnusualPrivateName,
    /// Not written yet.
    Jsx,
    Json,
    JavaScript,
    AwaitInScript,
    Decorators,
    Unsupported,
}

impl Refusal {
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
        Refusal::HtmlComment,
        Refusal::InvalidEscape,
        Refusal::EscapedKeyword,
        Refusal::UnusualNumber,
        Refusal::UnusualRegex,
        Refusal::UnusualPrivateName,
        Refusal::Jsx,
        Refusal::Json,
        Refusal::JavaScript,
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
}

impl Refused {
    #[track_caller]
    fn new(why: Refusal) -> Refused {
        Refused {
            why,
            at: 0,
            by: core::panic::Location::caller(),
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
    /// The top level is not an await context.
    pub await_is_a_name: bool,
    pub dialect: bun_sema::resolve::Dialect,
}

/// What a thread keeps from one file to the next: the caches of names, and the capacity of every
/// list.
#[derive(Default)]
pub struct Scratch {
    names: names::Names,
    stacks: parser::Stacks,
    /// The emptied lists of a file that is no longer needed.
    recycled: FileBuilder,
}

impl Scratch {
    /// Takes the lists of `file` for the next file.
    pub fn recycle(&mut self, file: FileBuilder) {
        self.recycled = file;
    }
}

/// What [`parse`] returns beside the file.
pub struct Parsed {
    pub file: FileBuilder,
    /// `await` was read as a keyword at the top level.
    pub has_top_level_await: bool,
}

/// The HIR of `text`. Names are interned in `atoms`.
pub fn parse(
    text: &[u8],
    options: Options,
    atoms: &dyn Intern,
    scratch: &mut Scratch,
) -> Result<Parsed, Refused> {
    parser::Parser::run(text, options, atoms, scratch)
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
