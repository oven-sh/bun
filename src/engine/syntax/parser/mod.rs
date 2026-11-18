//! Recursive descent with one token of lookahead. What takes `BUILD` makes a tree if that is true, and only checks
//! the syntax and resolves names if it is not.

mod class;
mod context;
mod cover;
mod expression;
mod failure;
mod function;
mod goal;
mod iteration;
mod literal;
mod member;
mod module;
mod node;
mod pattern;
mod statement;

use bun_engine_text::Text;

use crate::ast::{Ast, Element, ExprId, PatternId, StmtId};
use crate::cache::SourceCache;
use crate::error::{Complaint, Error, ErrorKind};
use crate::lexer::Lexer;
use crate::names::{Name, Names};
use crate::options::Options;
use crate::scope::Scopes;
use crate::source::{Source, narrow};
use crate::token::{Token, TokenKind};

use context::{Context, Facts};
use cover::Pass;
use failure::{Failed, Parsed, Skipped};

/// In the order of those at one offset.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum PauseKind {
    /// The parameters of a function with braces.
    Enter,
    Pause,
    /// Its closing brace.
    Leave,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct PausePosition {
    pub offset: u32,
    pub kind: PauseKind,
}

/// Keeps its memory from one parse to the next, unless that is a lot.
#[derive(Default)]
pub struct Parser {
    ast: Ast,
    scopes: Scopes,
    stacks: Stacks,
    scratch: Vec<u16>,
    narrowed: Vec<u8>,
    last_length: u32,
}

/// What it took to parse more units than this is not kept.
const LONG: u32 = 1 << 16;

#[derive(Default)]
struct Stacks {
    operands: Vec<expression::Pending>,
    /// Prefix operators, and `new`.
    prefixes: Vec<(TokenKind, u32)>,
    branches: Vec<statement::Branch>,
    memo: cover::Memo,
    local_exports: Vec<module::LocalExport>,
    /// By the index of a name.
    module_roles: Vec<module::Roles>,
}

impl Parser {
    pub fn parse(
        &mut self,
        source: Text<'_>,
        options: &Options<'_>,
        cache: Option<&mut SourceCache>,
    ) -> Result<&Ast, Error> {
        self.run(source, options, cache, None)?;
        Ok(&self.ast)
    }

    pub fn last_length(&self) -> u32 {
        self.last_length
    }

    /// For code that has no source.
    pub fn no_tree(&mut self) -> &Ast {
        self.ast.clear();
        &self.ast
    }

    /// Where a debugger can pause, in the functions inside too, in the order of the source.
    pub fn pause_positions(
        &mut self,
        source: Text<'_>,
        options: &Options<'_>,
    ) -> Result<Vec<PausePosition>, Error> {
        let mut positions = Vec::new();
        self.run(source, options, None, Some(&mut positions))?;
        positions.sort_unstable();
        positions.dedup();
        Ok(positions)
    }

    /// `end` is that of the next range to parse.
    #[cold]
    #[inline(never)]
    fn release_memory(&mut self, end: u32) {
        let mut narrowed = core::mem::take(&mut self.narrowed);
        if narrowed.len() / 4 > end as usize {
            narrowed = Vec::new();
        }
        if self.last_length > LONG {
            *self = Parser::default();
        }
        self.narrowed = narrowed;
    }

    fn run(
        &mut self,
        text: Text<'_>,
        options: &Options<'_>,
        cache: Option<&mut SourceCache>,
        mut pauses: Option<&mut Vec<PausePosition>>,
    ) -> Result<(), Error> {
        let end = options.range.end.min(text.len() as u32);
        let start = options.range.start.min(end);
        if self.last_length > LONG || self.narrowed.len() > LONG as usize {
            self.release_memory(end);
        }
        self.last_length = end - start;
        let (mut outline, narrowed) = match cache {
            Some(cache) => (Some(&mut cache.outline), Some(&mut cache.narrowed)),
            None => (None, None),
        };
        let bytes = match (text, narrowed) {
            (Text::Latin1(bytes), _) => bytes,
            (Text::Utf16(units), Some(narrowed)) => {
                if narrowed.len() != units.len() {
                    narrow(units, 0..units.len(), narrowed);
                }
                narrowed
            }
            (Text::Utf16(units), None) => {
                narrow(units, start as usize..end as usize, &mut self.narrowed);
                &self.narrowed
            }
        };
        if let Some(outline) = &mut outline {
            outline.prepare(text.len(), options.is_module_code());
            core::mem::swap(*outline, &mut self.scopes.outline);
        }
        let known = self.scopes.outline.len();
        let (mut pass, mut rough_error) = (Pass::First, None);
        let result = loop {
            self.ast.clear();
            if self.last_length > LONG {
                self.ast.reserve(self.last_length as usize);
            }
            self.scopes.reset(options.capture_everything);
            self.stacks.clear();
            if pass != Pass::Informed {
                self.stacks.memo.clear();
            }
            let mut session = Session {
                context: Context::empty(),
                facts: Facts::empty(),
                assignments: 0,
                first_label: 0,
                stack_limit: options.stack_limit,
                lexer: Lexer::new(
                    Source { text, bytes },
                    (start, end),
                    core::mem::replace(&mut self.ast.names, Names::unallocated()),
                    core::mem::take(&mut self.scratch),
                    options.is_module_code(),
                    options.builtin,
                ),
                scopes: core::mem::take(&mut self.scopes),
                stacks: &mut self.stacks,
                ast: &mut self.ast,
                options,
                keeps_outline: outline.is_some() && pass != Pass::Scouting,
                knows_functions: known != 0,
                has_captured_as_told: false,
                pauses: pauses.as_deref_mut(),
                duplicate_parameter: None,
                complaint: None,
                eager_start: u32::MAX,
                pass,
                has_overflowed: false,
                is_weary: false,
                is_patient: rough_error.is_some(),
                units_read_again: 0,
                skipped: Skipped::default(),
            };
            let result = session.root().map_err(|Failed| session.error());
            let is_weary = session.is_weary;
            self.scopes = session.scopes;
            self.scratch = session.lexer.scratch;
            self.ast.names = session.lexer.names;
            if result.is_err() {
                self.scopes.outline.truncate(known);
            }
            pass = match (pass, result) {
                (Pass::First, _) if is_weary => match rough_error {
                    Some(error) => break Err(error),
                    None => Pass::Scouting,
                },
                (_, Err(error)) if error.kind != ErrorKind::Syntax => break Err(error),
                (Pass::Scouting, _) => Pass::Informed,
                (Pass::Informed, Err(error)) => {
                    rough_error = Some(error);
                    Pass::First
                }
                (_, result) => break result,
            };
            if let Some(pauses) = &mut pauses {
                pauses.clear();
            }
        };
        if let Some(outline) = outline {
            *outline = core::mem::take(&mut self.scopes.outline);
        }
        result
    }
}

impl Stacks {
    fn clear(&mut self) {
        self.operands.clear();
        self.prefixes.clear();
        self.branches.clear();
        self.local_exports.clear();
        self.module_roles.clear();
    }
}

#[repr(C)]
struct Session<'a> {
    lexer: Lexer<'a>,
    context: Context,
    facts: Facts,
    /// How many have been put in the tree.
    assignments: u32,
    /// Of the innermost function.
    first_label: u32,
    stack_limit: usize,
    ast: &'a mut Ast,
    scopes: Scopes,
    stacks: &'a mut Stacks,
    options: &'a Options<'a>,
    keeps_outline: bool,
    /// The outline was not empty to begin with.
    knows_functions: bool,
    has_captured_as_told: bool,
    pauses: Option<&'a mut Vec<PausePosition>>,
    duplicate_parameter: Option<Name>,
    complaint: Option<Complaint>,
    /// The last place where a function expression is likely to be called at once.
    eager_start: u32,
    pass: Pass,
    has_overflowed: bool,
    /// Of going back. The pass fails.
    is_weary: bool,
    /// There is an error. Which one to report depends on the order of the guesses.
    is_patient: bool,
    units_read_again: u64,
    skipped: Skipped,
}

/// What the code around an expression has to know of it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
enum Class {
    Identifier,
    Eval,
    Arguments,
    Member,
    ArgumentsLength,
    PrivateMember,
    Call,
    /// An optional chain that ends in a private name.
    OptionalPrivateMember,
    NewTarget,
    ImportMeta,
    /// Of an object or an array.
    Literal,
    String,
    /// Operators and their operands, without parentheses around them.
    Operation,
    Other,
}

impl Class {
    #[inline(always)]
    fn is_identifier(self) -> bool {
        self <= Class::Arguments
    }

    #[inline(always)]
    fn is_eval_or_arguments(self) -> bool {
        matches!(self, Class::Eval | Class::Arguments)
    }

    #[inline(always)]
    fn is_reference(self) -> bool {
        self <= Class::PrivateMember
    }

    /// Of an expression that ends in an operand of this class.
    #[inline(always)]
    fn of_wrapper(self) -> Class {
        if self == Class::Operation {
            Class::Operation
        } else {
            Class::Other
        }
    }
}

#[derive(Clone, Copy)]
struct Expression {
    /// Its node. Without a tree, the name of an identifier or of a private member.
    word: u32,
    class: Class,
}

impl Expression {
    #[inline(always)]
    fn id(self) -> ExprId {
        ExprId::from_word(self.word)
    }
}

/// Stands for any node where there is no tree.
#[inline(always)]
fn nothing<T: Element>() -> T {
    T::from_word(u32::MAX)
}

type Statement = StmtId;
type Pattern = PatternId;

/// Whether `in` is an operator.
#[derive(Clone, Copy, PartialEq, Eq)]
enum In {
    Allowed,
    Forbidden,
}

impl Session<'_> {
    #[inline(always)]
    fn token(&self) -> Token {
        self.lexer.token
    }

    #[inline(always)]
    fn kind(&self) -> TokenKind {
        self.lexer.token.kind()
    }

    #[inline(always)]
    fn at(&self, kind: TokenKind) -> bool {
        self.lexer.token.kind() == kind
    }

    #[inline(always)]
    fn at_contextual(&self, name: Name) -> bool {
        self.lexer.token.is_contextual(name)
    }

    /// Of the token.
    #[inline(always)]
    fn start(&self) -> u32 {
        self.lexer.token.start()
    }

    #[inline(always)]
    fn previous_end(&self) -> u32 {
        self.lexer.previous_end
    }

    #[inline(always)]
    fn follows_newline(&self) -> bool {
        self.lexer.token.follows_newline()
    }

    #[inline(always)]
    fn next(&mut self) {
        self.lexer.next();
    }

    #[inline(always)]
    fn eat(&mut self, kind: TokenKind) -> bool {
        let is_there = self.at(kind);
        if is_there {
            self.next();
        }
        is_there
    }

    #[inline(always)]
    fn expect(&mut self, kind: TokenKind, sentence: &'static str) -> Parsed<()> {
        self.require(kind, sentence)?;
        self.next();
        Ok(())
    }

    /// Stays at the token.
    #[inline(always)]
    fn require(&mut self, kind: TokenKind, sentence: &'static str) -> Parsed<()> {
        if self.at(kind) {
            Ok(())
        } else {
            Err(self.fail(sentence))
        }
    }

    /// False if there is none and none can be inserted.
    #[inline(always)]
    fn eat_semicolon(&mut self) -> bool {
        self.eat(TokenKind::Semicolon)
            || self.follows_newline()
            || matches!(self.kind(), TokenKind::CloseBrace | TokenKind::End)
    }

    #[inline(always)]
    fn expect_semicolon(&mut self, sentence: &'static str) -> Parsed<()> {
        if self.eat_semicolon() {
            Ok(())
        } else {
            Err(self.fail(sentence))
        }
    }

    /// The token after this one.
    fn peek(&mut self) -> Token {
        let (token, previous_end) = (self.token(), self.previous_end());
        self.next();
        let next = self.token();
        self.lexer.restore(token, previous_end);
        next
    }

    /// The two tokens after this one.
    fn peek_twice(&mut self) -> (Token, Token) {
        let (token, previous_end) = (self.token(), self.previous_end());
        self.next();
        let (next, after) = (self.token(), self.peek());
        self.lexer.restore(token, previous_end);
        (next, after)
    }

    #[inline(always)]
    fn check_stack(&mut self) -> Parsed<()> {
        let marker = 0u8;
        if (&raw const marker).addr() < self.stack_limit {
            return Err(self.overflow());
        }
        Ok(())
    }

    /// For what scopes record.
    #[inline(always)]
    fn pop_scope<const BUILD: bool>(&mut self) -> Option<crate::ast::ScopeId> {
        self.scopes.pop::<BUILD>(self.ast)
    }
}
