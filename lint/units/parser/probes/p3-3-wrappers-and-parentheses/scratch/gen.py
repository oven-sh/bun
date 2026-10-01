import re
R = '/workspace/wt/parser/src/js_parser/'
def cut(path, start, end):
    s = open(R + path).read()
    a = s.index(start)
    b = s.index(end, a)
    return s[a:b]

pfx = open(R + 'parse/parse_prefix.rs').read()
sfx = open(R + 'parse/parse_suffix.rs').read()

open_paren = cut('parse/parse_prefix.rs', '    fn pfx_t_open_paren(p: &mut Self', '    #[inline]\n    fn pfx_t_false')
less_than_lint = cut('parse/parse_prefix.rs', '    /// `<T>x`, `<T>(x)` and `<T>(x) => {}` of a lint parse', '    #[inline]\n    fn pfx_t_import')
as_fns = cut('parse/parse_suffix.rs', '    fn sfx_handle_typescript_as(', '    fn sfx_t_dot(')
excl = cut('parse/parse_suffix.rs', '    fn sfx_t_exclamation(\n', '    fn sfx_t_minus_minus(')

lib = r'''
#![allow(dead_code)]
pub mod error {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Error { SyntaxError, Backtrack, StackOverflow, Lexer(crate::lexer::Error) }
    impl From<crate::lexer::Error> for Error {
        fn from(e: crate::lexer::Error) -> Self { Error::Lexer(e) }
    }
}
pub use error::Error;
pub type CrateResult<T> = Result<T, Error>;

pub mod lexer {
    use bun_ast::{Loc, Range};
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Error { SyntaxError, Backtrack }
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum T { TPlusPlus, TMinusMinus, TNoSubstitutionTemplateLiteral, TTemplateHead, TOpenParen, TOpenBracket, TQuestionDot, TCloseParen, TIdentifier, TEquals }
    impl T { pub fn is_assign(self) -> bool { self == T::TEquals } }
    #[derive(Clone, Copy)]
    pub struct LexerSnapshot<'a> { pub(crate) start: usize, pub(crate) contents: &'a [u8], pub(crate) all_comments_len: usize }
    pub struct Lexer<'a> {
        pub(crate) contents: &'a [u8],
        pub(crate) start: usize,
        pub end: usize,
        pub token: T,
        pub(crate) has_newline_before: bool,
        pub(crate) has_pure_comment_before: bool,
        pub(crate) is_log_disabled: bool,
        pub(crate) all_comments: Vec<Range>,
    }
    impl<'a> Lexer<'a> {
        pub fn loc(&self) -> Loc { Loc { start: self.start as i32 } }
        pub(crate) fn range(&self) -> Range { Range { loc: self.loc(), len: (self.end - self.start) as i32 } }
        pub(crate) fn raw(&self) -> &'a [u8] { &self.contents[self.start..self.end] }
        pub fn next(&mut self) -> Result<(), Error> { Ok(()) }
        pub fn expect(&mut self, token: T) -> Result<(), Error> { let _ = token; self.next() }
        pub(crate) fn expect_greater_than<const IS_INSIDE_JSX_ELEMENT: bool>(&mut self) -> Result<(), Error> { Ok(()) }
        pub(crate) fn is_contextual_keyword(&self, keyword: &'static [u8]) -> bool { self.token == T::TIdentifier && self.raw() == keyword }
        pub(crate) fn unexpected(&mut self) -> Result<(), Error> { Ok(()) }
        pub(crate) fn snapshot(&self) -> LexerSnapshot<'a> { LexerSnapshot { start: self.start, contents: self.contents, all_comments_len: self.all_comments.len() } }
        pub(crate) fn restore(&mut self, original: &LexerSnapshot<'a>) { self.start = original.start; }
    }
}

pub mod defines {
    #[derive(Default)]
    pub struct Define;
}

pub mod parser {
    #[derive(Clone, Copy, Default)]
    pub struct ParenExprOpts {
        pub(crate) is_async: bool,
        pub(crate) force_arrow_fn: bool,
        pub(crate) is_after_question_and_before_colon: bool,
    }
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum SkipTypeParameterResult { DidNotSkipAnything, CouldBeTypeCast, DefinitelyTypeParameters }
    #[derive(Default)]
    pub struct DeferredErrors;
}

pub mod op {
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Level { Lowest, Comma, Assign, Compare, Prefix, Postfix, New, Call, Member }
    impl Level {
        pub fn lt(self, b: Level) -> bool { (self as u8) < (b as u8) }
        pub fn gt(self, b: Level) -> bool { (self as u8) > (b as u8) }
        pub fn gte(self, b: Level) -> bool { (self as u8) >= (b as u8) }
    }
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum EFlags { None, AfterQuestionAndBeforeColon }
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum OptionalChain { Start, Continuation }
}

pub mod p {
    use crate::lexer::Lexer;
    use bun_ast::{Expr, Log, Source};
    #[derive(Default)]
    pub struct StartsForParseOnly {
        pub wrappers: crate::parse::wrappers::Wrappers,
        pub(crate) is_lint: bool,
    }
    impl StartsForParseOnly {
        /// The side table of `Parser::parse_for_lint`.
        pub(crate) fn for_lint() -> Box<StartsForParseOnly> {
            Box::new(StartsForParseOnly {
                is_lint: true,
                ..Default::default()
            })
        }
    }
    pub struct Options { pub ignore_dce_annotations: bool }
    pub struct ParserSnapshot<'a> { pub(crate) lexer: crate::lexer::LexerSnapshot<'a>, pub(crate) comments: Vec<u8> }
    pub struct P<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> {
        pub lexer: Lexer<'a>,
        pub(crate) starts_for_parse_only: Option<Box<StartsForParseOnly>>,
        pub(crate) options: Options,
        pub(crate) source: &'a Source,
        pub(crate) log: core::ptr::NonNull<Log>,
        pub(crate) allow_in: bool,
        pub(crate) forbid_suffix_after_as_loc: bun_ast::Loc,
        pub(crate) comments: Vec<u8>,
    }
    impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
        pub const IS_TYPESCRIPT_ENABLED: bool = TYPESCRIPT;
        #[allow(clippy::mut_from_ref)]
        pub(crate) fn log(&self) -> &mut Log { unsafe { &mut *self.log.as_ptr() } }
        pub(crate) fn mark_expr_as_parenthesized(&mut self, expr: &mut Expr) { let _ = expr; }
        /// Whether `Parser::parse_for_lint` runs this parse.
        #[inline]
        pub(crate) fn is_lint_parse(&self) -> bool {
            matches!(&self.starts_for_parse_only, Some(starts) if starts.is_lint)
        }
        pub(crate) fn restore_parser_snapshot(&mut self, snapshot: ParserSnapshot<'a>) {
            self.lexer.restore(&snapshot.lexer);
            self.comments = snapshot.comments;
            if let Some(starts) = &mut self.starts_for_parse_only {
                starts.wrappers.rewind_to(snapshot.lexer.start);
            }
        }
    }
}

pub mod parse {
    pub mod parse_entry {
        use crate::Error;
        use crate::defines::Define;
        use bun_alloc::Arena;
        pub struct Features { pub no_macros: bool, pub dont_bundle_twice: bool }
        pub struct Options<'a> { pub features: Features, pub marker: core::marker::PhantomData<&'a ()> }
        impl Options<'_> {
            pub fn init(jsx: u8, loader: bun_ast::Loader) -> Options<'static> { let _ = (jsx, loader); Options { features: Features { no_macros: false, dont_bundle_twice: false }, marker: core::marker::PhantomData } }
        }
        pub struct ParsedForLint<'p, 'a> {
            pub stmts: &'p [&'a u8],
            pub sidecar: &'p crate::p::StartsForParseOnly,
        }
        pub struct Parser<'a> { source: &'a bun_ast::Source }
        impl<'a> Parser<'a> {
            pub fn init(options: Options<'a>, log: &mut bun_ast::Log, source: &'a bun_ast::Source, define: &'a Define, bump: &'a Arena) -> Result<Parser<'a>, Error> {
                let _ = (options, log, define, bump);
                Ok(Parser { source })
            }
            pub fn parse_for_lint<R>(self, f: impl FnOnce(&ParsedForLint<'_, 'a>) -> R) -> Result<R, Error> {
                let sidecar = crate::p::StartsForParseOnly::for_lint();
                Ok(f(&ParsedForLint { stmts: &[], sidecar: &sidecar }))
            }
        }
    }

    #[path = "/workspace/wt/parser/src/js_parser/parse/wrappers.rs"]
    pub mod wrappers;

    pub mod sites {
        use crate::Error;
        use crate::lexer::T;
        use crate::op::{EFlags, Level, OptionalChain};
        use crate::p::P;
        use crate::parser::{DeferredErrors, ParenExprOpts, SkipTypeParameterResult};
        use bun_ast::{Expr, ExprData};

        type PResult<T> = crate::CrateResult<T>;
        #[derive(Clone, Copy, PartialEq, Eq)]
        enum Continuation { Next, Done }
        type CResult = core::result::Result<Continuation, Error>;

        impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
            pub fn parse_expr(&mut self, level: Level) -> Result<Expr, Error> { let _ = level; Ok(Expr::EMPTY) }
            pub(crate) fn parse_prefix(&mut self, level: Level, errors: Option<&mut DeferredErrors>, flags: EFlags) -> PResult<Expr> { Ok(Expr::EMPTY) }
            pub(crate) fn parse_suffix(&mut self, left: &mut Expr, level: Level, errors: Option<&mut DeferredErrors>, flags: EFlags) -> Result<(), Error> { Ok(()) }
            pub(crate) fn parse_paren_expr(&mut self, loc: bun_ast::Loc, level: Level, opts: ParenExprOpts) -> Result<Expr, Error> { Ok(Expr::EMPTY) }
            pub(crate) fn skip_type_script_type(&mut self, level: Level) -> Result<(), Error> { Ok(()) }
            pub fn build_type_script_type(&mut self, level: Level) -> Result<bun_ast::ts::Type, Error> { Ok(bun_ast::ts::Type::keyword(bun_ast::ts::KeywordKind::Any, 0, 0)) }
            pub(crate) fn try_skip_type_script_type_parameters_then_open_paren_with_backtracking(&mut self) -> SkipTypeParameterResult { SkipTypeParameterResult::DidNotSkipAnything }

__OPEN_PAREN__
__LESS_THAN_LINT__
__AS_FNS__
__EXCL__
            fn dispatch(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
                let mut optional_chain: Option<OptionalChain> = None;
                let old_optional_chain = optional_chain;
                let continuation = match p.lexer.token {
                    T::TOpenParen => {
                        Self::sfx_t_exclamation(p, &mut optional_chain, old_optional_chain, left)
                    }
                    _ => Self::sfx_handle_typescript_as(p, level, left),
                };
                continuation
            }

            fn less_than_dispatch(p: &mut Self, loc: bun_ast::Loc, level: Level, errors: Option<&mut DeferredErrors>, flags: EFlags) -> PResult<Expr> {
                if Self::IS_TYPESCRIPT_ENABLED {
                    if p.starts_for_parse_only.is_some() {
                        return Self::pfx_t_less_than_for_lint(p, loc, level, errors, flags);
                    }
                }
                Err(crate::Error::SyntaxError)
            }

            fn decorator(p: &mut Self) -> Result<Expr, Error> {
                if p.lexer.token == T::TOpenParen {
                    let open = p.lexer.loc();
                    p.lexer.next()?;
                    let expr = p.parse_expr(Level::Lowest)?;
                    if let Some(starts) = &mut p.starts_for_parse_only
                        && starts.is_lint
                    {
                        starts.wrappers.parenthesized(expr, open, p.lexer.loc());
                    }
                    p.lexer.expect(T::TCloseParen)?;
                    return Ok(expr);
                }
                let expr = Expr::EMPTY;
                if let Some(starts) = &mut p.starts_for_parse_only {
                    starts.wrappers.non_null(expr, p.lexer.loc());
                }
                Ok(expr)
            }
        }
    }
}
'''
lib = lib.replace('__OPEN_PAREN__', open_paren).replace('__LESS_THAN_LINT__', less_than_lint).replace('__AS_FNS__', as_fns).replace('__EXCL__', excl)
open('lib.rs', 'w').write(lib)
print(len(open_paren.splitlines()), len(less_than_lint.splitlines()), len(as_fns.splitlines()), len(excl.splitlines()))
