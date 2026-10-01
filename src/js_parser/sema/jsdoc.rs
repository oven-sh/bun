//! Reads the JSDoc comments of a JavaScript file. A port of jsdoc.go of TypeScript 7.0.2's parser.
//!
//! It runs between the parse pass and the lowering, over the comments the lexer recorded. The tags are read here, with a scanner of
//! their own (`ScanJSDocToken`). What they hold of ordinary syntax is read by the parser, whose lexer is pointed into the comment, and
//! is kept like the type syntax of a TypeScript file. [`super::reparse`] makes ordinary nodes of the tags of the comments that belong
//! to a node.

use bun_ast::op::Level;
use bun_ast::ts_syntax as ts;
use bun_ast::{ExprData, Range, StoreStr};
use bun_sema::hir::Flags;

use super::TypeSyntax;
use crate::Error;
use crate::lexer::{LexerSnapshot, T};
use crate::p::P;
use crate::parse::lists::ListKind;

// ───────────────────────────── what is read ─────────────────────────────

/// An identifier in a tag: from where to where. One that is missing has no length.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct Name {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl Name {
    pub(crate) fn is_missing(self) -> bool {
        self.start == self.end
    }

    pub(crate) fn text(self, source: &[u8]) -> &[u8] {
        &source[self.start as usize..self.end as usize]
    }
}

/// `JSDocTypeExpression`: what `parseJSDocType` reads.
#[derive(Copy, Clone)]
pub(crate) struct TypeExpr {
    /// The type, without the `...` before it and the `=` after it.
    pub(crate) ty: ts::TypeId,
    /// Where it starts, the `...` included.
    pub(crate) pos: u32,
    /// Where the token after it starts.
    pub(crate) end: u32,
    /// `...T` (`JSDocVariadicType`)
    pub(crate) is_variadic: bool,
    /// `T=` (`JSDocOptionalType`)
    pub(crate) is_optional: bool,
}

/// The type of a `@param`, `@property` or `@typedef` tag.
pub(crate) enum TagType {
    None,
    Expr(TypeExpr),
    /// `JSDocTypeLiteral`: made of the `@property` or `@param` tags that follow.
    Literal {
        properties: Vec<Tag>,
        is_array: bool,
        pos: u32,
    },
}

/// `JSDocParameterOrPropertyTag`
pub(crate) struct Property {
    /// `a.b.c`
    pub(crate) name: Vec<Name>,
    /// `[name]`, `[name=default]`
    pub(crate) is_bracketed: bool,
    pub(crate) is_name_first: bool,
    pub(crate) ty: TagType,
}

/// `JSDocSignature`
pub(crate) struct Signature {
    /// `@param` and `@this` tags.
    pub(crate) params: Vec<Tag>,
    /// The type of the `@returns` tag.
    pub(crate) ret: Option<TypeExpr>,
    pub(crate) pos: u32,
}

pub(crate) struct TypeParameter {
    pub(crate) name: Name,
    /// `const`, `in`, `out`, and nothing for a modifier that cannot be on a type parameter, with where each is.
    pub(crate) modifiers: Vec<(Flags, u32)>,
    /// `[T=Default]`
    pub(crate) default: Option<TypeExpr>,
}

/// `JSDocTemplateTag`
pub(crate) struct Template {
    /// `@template {Constraint} T`: of the first type parameter.
    pub(crate) constraint: Option<TypeExpr>,
    pub(crate) params: Vec<TypeParameter>,
}

/// The name of a `@typedef` or a `@callback`: `A.B.C` is `C` in the namespaces `A` and `B`.
pub(crate) struct DeclaredName {
    pub(crate) namespaces: Vec<Name>,
    pub(crate) name: Name,
}

pub(crate) struct Typedef {
    pub(crate) name: DeclaredName,
    pub(crate) ty: TagType,
}

pub(crate) struct Callback {
    pub(crate) name: DeclaredName,
    pub(crate) signature: Signature,
}

/// `ExpressionWithTypeArguments`, of `@implements`, `@augments` and `@extends`
pub(crate) struct ClassName {
    /// `a.b.c`
    pub(crate) name: Vec<Name>,
    pub(crate) type_args: Option<ts::IdList<ts::Type>>,
    /// Where the token after the type arguments starts.
    pub(crate) end: u32,
}

pub(crate) struct ImportSpecifier {
    pub(crate) imported: StoreStr,
    pub(crate) imported_pos: u32,
    pub(crate) local: StoreStr,
    pub(crate) local_pos: u32,
}

/// `JSDocImportTag`
#[derive(Default)]
pub(crate) struct Import {
    /// `importClause != nil`
    pub(crate) has_clause: bool,
    pub(crate) default: Option<Name>,
    pub(crate) namespace: Option<Name>,
    pub(crate) named: Vec<ImportSpecifier>,
    /// The module specifier and where it is. `None` if it is no string.
    pub(crate) specifier: Option<(StoreStr, u32)>,
    pub(crate) mode: ts::ResolutionMode,
    /// Where the token after it starts.
    pub(crate) end: u32,
}

pub(crate) enum TagKind {
    Type(TypeExpr),
    Satisfies(TypeExpr),
    This(TypeExpr),
    Return(Option<TypeExpr>),
    /// `@param`, `@arg`, `@argument`
    Param(Property),
    /// `@property`, `@prop`. Only under a `@typedef`.
    Property(Property),
    Template(Template),
    Typedef(Typedef),
    Callback(Callback),
    Overload(Signature),
    Import(Import),
    Implements(ClassName),
    /// `@augments`, `@extends`
    Augments(ClassName),
    /// `@public`, `@private`, `@protected`, `@readonly`, `@override`
    Modifier(Flags),
    /// Any other. Nothing is made of it.
    Other,
}

pub(crate) struct Tag {
    pub(crate) kind: TagKind,
    /// Where the `@` is.
    pub(crate) pos: u32,
    /// Where the name after the `@` is.
    pub(crate) name_pos: u32,
}

/// A JSDoc comment that has tags.
pub(crate) struct JsDoc {
    /// Where its `/**` starts and its `*/` ends.
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) tags: Vec<Tag>,
    /// What the parser objects to in it: start and code.
    pub(crate) errors: Vec<(u32, u32)>,
    /// What the checker objects to in its syntax, which it only sees once that is reparsed.
    pub(crate) checker_errors: Vec<(u32, u32)>,
    /// `hir::File::error_arguments`
    pub(crate) error_arguments: Vec<(u32, Box<str>)>,
    /// `hir::File::error_ends`
    pub(crate) error_ends: Vec<(u32, u32, u32)>,
}

/// The JSDoc comments of a file that can have tags, in source order.
#[derive(Default)]
pub(crate) struct Comments {
    pub(crate) list: Vec<JsDoc>,
}

impl Comments {
    /// Which one starts at `start`.
    pub(crate) fn at(&self, start: u32) -> Option<usize> {
        self.list.binary_search_by_key(&start, |doc| doc.start).ok()
    }
}

/// `isJSDocLikeText`
pub(crate) fn is_jsdoc_like(comment: &[u8]) -> bool {
    comment.len() >= 4 && comment[1] == b'*' && comment[2] == b'*' && comment[3] != b'/'
}

/// `isObjectOrObjectArrayTypeReference`
fn is_object_or_object_array(syntax: &ts::Syntax, ty: ts::TypeId) -> bool {
    if ty.is_none() {
        return false;
    }
    match syntax[ty].data {
        ts::TypeData::Keyword(ts::Keyword::Object) => true,
        ts::TypeData::Array(element) => is_object_or_object_array(syntax, element),
        ts::TypeData::Reference { name, args } => {
            args.is_empty() && matches!(&syntax[name], [name] if &*name.text == b"Object")
        }
        _ => false,
    }
}

/// Reads every JSDoc comment the lexer of `p` recorded. `syntax` is what the parser kept of the file, to which the types in the
/// comments are added.
pub(crate) fn read_comments<'a>(
    p: &mut P<'a, true, false>,
    syntax: TypeSyntax,
) -> (TypeSyntax, Comments) {
    let mut comments = Comments::default();
    if !syntax.keep_types || !p.lexer.tolerant {
        return (syntax, comments);
    }
    let source: &'a [u8] = p.lexer.contents;
    let ranges = core::mem::take(&mut p.lexer.all_comments);
    p.type_syntax = Some(Box::new(syntax));
    // `PCJSDocComment`: like `PCJsxChildren`, any token is an element of it, so no list skips a token it has no use for.
    let outer_contexts = core::mem::replace(
        &mut p.lexer.list_contexts,
        1 << ListKind::JsxChildren as u32,
    );
    for range in &ranges {
        let (start, end) = (range.loc.to_usize(), range.end_i().min(source.len()));
        let comment = &source[start.min(end)..end];
        if !is_jsdoc_like(comment) || !comment.ends_with(b"*/") || !comment.contains(&b'@') {
            continue;
        }
        if comments
            .list
            .last()
            .is_some_and(|last| last.start as usize >= start)
        {
            continue;
        }
        comments.list.push(Reader::read(p, source, start, end));
    }
    p.lexer.contents = source;
    p.lexer.all_comments = ranges;
    p.lexer.list_contexts = outer_contexts;
    p.lexer.skips_jsdoc_asterisks = false;
    let syntax = *p.type_syntax.take().expect("set above");
    (syntax, comments)
}

// ───────────────────────────── tokens ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Token {
    EndOfFile,
    Whitespace,
    NewLine,
    /// `JSDocCommentTextToken`
    CommentText,
    At,
    Asterisk,
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    LessThan,
    Equals,
    Comma,
    Dot,
    DotDotDot,
    Backtick,
    /// An identifier or a keyword.
    Word,
    /// A character `ScanJSDocToken` makes nothing of.
    Unknown,
    Other,
}

fn token_of(token: T) -> Token {
    match token {
        T::TEndOfFile => Token::EndOfFile,
        T::TAt => Token::At,
        T::TAsterisk => Token::Asterisk,
        T::TOpenBrace => Token::OpenBrace,
        T::TCloseBrace => Token::CloseBrace,
        T::TOpenBracket => Token::OpenBracket,
        T::TCloseBracket => Token::CloseBracket,
        T::TLessThan => Token::LessThan,
        T::TEquals => Token::Equals,
        T::TComma => Token::Comma,
        T::TDot => Token::Dot,
        T::TDotDotDot => Token::DotDotDot,
        // `tokenIsIdentifierOrKeyword`
        _ if token as u8 >= T::TPrivateIdentifier as u8 => Token::Word,
        _ => Token::Other,
    }
}

/// The token the lexer of the parser is at, as a name.
fn name_at_token(p: &P<'_, true, false>) -> Name {
    Name {
        start: p.lexer.start as u32,
        end: p.lexer.end as u32,
    }
}

/// `IsWhiteSpaceSingleLine`, in ASCII.
fn is_blank(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | 0x0B | 0x0C)
}

/// `IsIdentifierStart`. What is not ASCII is taken for a letter.
fn is_word_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || matches!(c, b'_' | b'$') || c >= 0x80
}

fn is_word_part(c: u8) -> bool {
    is_word_start(c) || c.is_ascii_digit()
}

/// `peekUnicodeEscape`: the code point that the `\uXXXX` or `\u{X}` at `at` stands for, and where the escape ends.
fn unicode_escape(text: &[u8], at: usize) -> Option<(u32, usize)> {
    if text.get(at) != Some(&b'\\') || text.get(at + 1) != Some(&b'u') {
        return None;
    }
    let is_extended = text.get(at + 2) == Some(&b'{');
    let start = at + 2 + usize::from(is_extended);
    let (mut end, mut value) = (start, 0u32);
    while let Some(digit) = text.get(end).and_then(|&c| (c as char).to_digit(16)) {
        if !is_extended && end == start + 4 {
            break;
        }
        value = value.saturating_mul(16).saturating_add(digit);
        end += 1;
    }
    if is_extended {
        return (end > start && value <= 0x10FFFF && text.get(end) == Some(&b'}'))
            .then_some((value, end + 1));
    }
    (end == start + 4).then_some((value, end))
}

/// `IsIdentifierPart` if `is_part`, else `IsIdentifierStart`, of a code point.
fn is_word_code_point(c: u32, is_part: bool) -> bool {
    match u8::try_from(c) {
        Ok(c) if is_part => is_word_part(c),
        Ok(c) => is_word_start(c),
        Err(_) => true,
    }
}

/// `scanIdentifierParts`: where the identifier that goes on at `at` ends.
fn end_of_word_parts(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(&c) if is_word_part(c) => at += 1,
            Some(b'\\') => match unicode_escape(text, at) {
                Some((c, end)) if is_word_code_point(c, true) => at = end,
                _ => return at,
            },
            _ => return at,
        }
    }
}

/// The identifier `text` with what its unicode escapes stand for in their place.
pub(crate) fn unescaped_name(text: &[u8]) -> Vec<u8> {
    let mut name = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&c) = text.get(at) {
        match unicode_escape(text, at).and_then(|(c, end)| Some((char::from_u32(c)?, end))) {
            Some((c, end)) => {
                name.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                at = end;
            }
            None => {
                name.push(c);
                at += 1;
            }
        }
    }
    name
}

/// `jsdocState`
#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    BeginningOfLine,
    SawAsterisk,
    SavingComments,
    SavingBackticks,
}

impl State {
    fn saving(in_fenced_code_block: bool) -> State {
        if in_fenced_code_block {
            State::SavingBackticks
        } else {
            State::SavingComments
        }
    }

    fn is_saving(self) -> bool {
        matches!(self, State::SavingComments | State::SavingBackticks)
    }
}

/// `propertyLikeParse`
const PROPERTY: u8 = 1;
const PARAMETER: u8 = 2;
const CALLBACK_PARAMETER: u8 = 4;

/// `ParserState`
struct Mark<'a> {
    token: Token,
    full_start: usize,
    start: usize,
    end: usize,
    has_newline_before: bool,
    is_in_lexer: bool,
    lexer: LexerSnapshot<'a>,
    logged: usize,
    errors: u32,
}

struct Reader<'p, 'a> {
    p: &'p mut P<'a, true, false>,
    /// The source, up to the `*/` of the comment.
    text: &'a [u8],
    token: Token,
    /// `TokenFullStart`, unless the token is in the lexer, which is asked then.
    full_start: usize,
    /// `TokenStart`
    start: usize,
    /// Where the scanner is: `TokenEnd`.
    end: usize,
    /// `HasPrecedingLineBreak`
    has_newline_before: bool,
    /// The token is the one the lexer of the parser is at.
    is_in_lexer: bool,
}

impl<'p, 'a> Reader<'p, 'a> {
    /// `parseJSDocComment`, of the comment from `start` to `end`.
    fn read(p: &'p mut P<'a, true, false>, source: &'a [u8], start: usize, end: usize) -> JsDoc {
        let text = &source[..end - 2];
        p.lexer.contents = text;
        p.lexer.all_comments.clear();
        p.lexer.prev_error_loc = bun_ast::Loc::EMPTY;
        p.lexer.stuck = 0;
        p.lexer.is_log_disabled = false;
        p.scopes_in_order.truncate(0);
        let logged = {
            let log = p.log();
            (log.msgs.len(), log.errors, log.warnings)
        };
        let mut reader = Reader {
            p,
            text,
            token: Token::Unknown,
            full_start: start + 3,
            start: start + 3,
            end: start + 3,
            has_newline_before: false,
            is_in_lexer: false,
        };
        let tags = reader.comment(start);
        let (errors, checker_errors, error_arguments, error_ends) = reader.take_errors(logged);
        JsDoc {
            start: start as u32,
            end: end as u32,
            tags,
            errors,
            checker_errors,
            error_arguments,
            error_ends,
        }
    }

    /// What was logged since the log had `before` messages, errors and warnings, by the codes TypeScript has for it: the errors of
    /// its parser, and those of its checker.
    #[allow(clippy::type_complexity)]
    fn take_errors(
        &mut self,
        before: (usize, u32, u32),
    ) -> (
        Vec<(u32, u32)>,
        Vec<(u32, u32)>,
        Vec<(u32, Box<str>)>,
        Vec<(u32, u32, u32)>,
    ) {
        let source = self.p.source.contents();
        let log = self.p.log();
        let (mut errors, mut checker_errors) = (Vec::new(), Vec::new());
        let (mut error_arguments, mut error_ends) = (Vec::new(), Vec::new());
        for msg in log.msgs.drain(before.0..) {
            if msg.kind != bun_ast::Kind::Err {
                continue;
            }
            let Some(offset) = msg.data.location.as_ref().map(|location| location.offset) else {
                continue;
            };
            let at = source.get(offset..).unwrap_or_default();
            match super::early_error(&msg.data.text, at) {
                // `checkTypeReferenceNode`: `A.<T>` is as good as `A<T>` in a comment.
                Some((0 | 8020, _)) | None => {}
                Some((code, delta)) => {
                    // `Lexer::ts_grammar_error`, `P::ts_checker_error`
                    let is_of_checker =
                        msg.data.text.starts_with(b"TG") || msg.data.text.starts_with(b"TC");
                    let list = if is_of_checker {
                        &mut checker_errors
                    } else {
                        &mut errors
                    };
                    let start = (offset as i64 + i64::from(delta)).max(0) as u32;
                    list.push((start, code));
                    if let Some(token) = super::error_argument(&msg.data.text) {
                        error_arguments.push((start, token));
                    }
                    // `ScanJSDocToken` makes no token of `</`.
                    error_ends.extend(super::error_end(&msg.data, source, false));
                }
            }
        }
        (log.errors, log.warnings) = (before.1, before.2);
        (errors, checker_errors, error_arguments, error_ends)
    }

    /// `parseErrorAt`
    fn error(&mut self, start: usize, len: usize, code: u32) {
        let range = Range {
            loc: bun_ast::usize2loc(start),
            len: len as i32,
        };
        self.p.lexer.ts_error(range, code);
    }

    /// `parseErrorAtCurrentToken`
    fn error_at_token(&mut self, code: u32) {
        self.error(self.start, self.end - self.start, code);
    }

    /// `parseErrorAtCurrentToken`, of `'{0}' expected.`
    fn expected_at_token(&mut self, token: &str) {
        let range = Range {
            loc: bun_ast::usize2loc(self.start),
            len: (self.end - self.start) as i32,
        };
        self.p.lexer.ts_expected(range, token);
    }

    /// `nodePos`
    fn full_start(&self) -> usize {
        if self.is_in_lexer {
            self.p.lexer.full_start().to_usize()
        } else {
            self.full_start
        }
    }

    fn token_len(&self) -> usize {
        self.end - self.start
    }

    fn token_text(&self) -> &'a [u8] {
        &self.text[self.start..self.end]
    }

    /// `mark`
    fn mark(&self) -> Mark<'a> {
        let log = self.p.log();
        Mark {
            token: self.token,
            full_start: self.full_start,
            start: self.start,
            end: self.end,
            has_newline_before: self.has_newline_before,
            is_in_lexer: self.is_in_lexer,
            lexer: self.p.lexer.snapshot(),
            logged: log.msgs.len(),
            errors: log.errors,
        }
    }

    /// `rewind`
    fn rewind(&mut self, mark: &Mark<'a>) {
        self.token = mark.token;
        self.full_start = mark.full_start;
        self.start = mark.start;
        self.end = mark.end;
        self.has_newline_before = mark.has_newline_before;
        self.is_in_lexer = mark.is_in_lexer;
        self.p.lexer.restore(&mark.lexer);
        let log = self.p.log();
        log.msgs.truncate(mark.logged);
        log.errors = mark.errors;
        self.p.scopes_in_order.truncate(0);
    }

    /// `lookAhead`
    fn look_ahead<R>(&mut self, scan: impl FnOnce(&mut Self) -> R) -> R {
        let mark = self.mark();
        let result = scan(self);
        self.rewind(&mark);
        result
    }

    /// `ResetPos`: the token stays what it was.
    fn reset_pos(&mut self, pos: usize) {
        self.full_start = pos;
        self.start = pos;
        self.end = pos;
        self.is_in_lexer = false;
    }

    /// The parser cannot go on. Nothing more is read of the comment.
    fn give_up(&mut self) {
        self.reset_pos(self.text.len());
        self.token = Token::EndOfFile;
        self.has_newline_before = false;
    }

    /// `nextTokenJSDoc`, `ScanJSDocToken`
    fn next_jsdoc(&mut self) -> Token {
        let text = self.text;
        let pos = self.end;
        self.is_in_lexer = false;
        self.full_start = pos;
        self.start = pos;
        self.has_newline_before = false;
        let Some(&c) = text.get(pos) else {
            self.token = Token::EndOfFile;
            return self.token;
        };
        let mut end = pos + 1;
        self.token = match c {
            _ if is_blank(c) => {
                while text.get(end).is_some_and(|&c| is_blank(c)) {
                    end += 1;
                }
                Token::Whitespace
            }
            b'\r' | b'\n' => {
                if c == b'\r' && text.get(end) == Some(&b'\n') {
                    end += 1;
                }
                self.has_newline_before = true;
                Token::NewLine
            }
            b'@' => Token::At,
            b'*' => Token::Asterisk,
            b'{' => Token::OpenBrace,
            b'}' => Token::CloseBrace,
            b'[' => Token::OpenBracket,
            b']' => Token::CloseBracket,
            b'<' => Token::LessThan,
            b'=' => Token::Equals,
            b',' => Token::Comma,
            b'.' => Token::Dot,
            b'`' => Token::Backtick,
            b'(' | b')' | b'>' | b'#' => Token::Other,
            b'\\' => match unicode_escape(text, pos) {
                Some((c, after)) if is_word_code_point(c, false) => {
                    end = end_of_word_parts(text, after);
                    Token::Word
                }
                _ => Token::Unknown,
            },
            _ if is_word_start(c) => {
                while text.get(end).is_some_and(|&c| is_word_part(c) || c == b'-') {
                    end += 1;
                }
                if text.get(end) == Some(&b'\\') {
                    end = end_of_word_parts(text, end);
                }
                Token::Word
            }
            _ => Token::Unknown,
        };
        self.end = end;
        self.token
    }

    /// `nextJSDocCommentTextToken`, `ScanJSDocCommentTextToken`
    fn next_comment_text(&mut self, in_backticks: bool) -> Token {
        let text = self.text;
        let pos = self.end;
        let mut end = pos;
        while let Some(&c) = text.get(end) {
            if matches!(c, b'\n' | b'\r' | b'`') {
                break;
            }
            if !in_backticks {
                if c == b'{' {
                    break;
                }
                // Elsewhere `@` only starts a tag after whitespace and before an identifier.
                if c == b'@'
                    && end > 0
                    && is_blank(text[end - 1])
                    && text.get(end + 1).is_some_and(|&next| is_word_start(next))
                {
                    break;
                }
            }
            end += 1;
        }
        if end == pos {
            return self.next_jsdoc();
        }
        self.is_in_lexer = false;
        self.full_start = pos;
        self.start = pos;
        self.end = end;
        self.has_newline_before = false;
        self.token = Token::CommentText;
        self.token
    }

    /// `CanFollowJSDocAt`
    fn can_follow_at(&self) -> bool {
        match self.text.get(self.end) {
            None => true,
            Some(&c) => is_word_start(c) || is_blank(c) || matches!(c, b'\n' | b'\r'),
        }
    }

    /// Takes over the token the lexer of the parser is at. `result`: what came of getting there.
    fn leave_lexer<X, E>(&mut self, result: Result<X, E>) -> Option<X> {
        let Ok(value) = result else {
            self.give_up();
            return None;
        };
        let lexer = &self.p.lexer;
        self.token = token_of(lexer.token);
        self.start = lexer.start;
        self.end = lexer.end;
        self.has_newline_before = lexer.has_newline_before;
        self.is_in_lexer = true;
        Some(value)
    }

    /// Has the lexer of the parser scan the token that starts at or after `pos`.
    fn scan_from(&mut self, pos: usize) {
        let lexer = &mut self.p.lexer;
        lexer.current = pos;
        lexer.start = pos;
        lexer.end = pos;
        lexer.step();
        let result = lexer.next();
        self.leave_lexer(result);
    }

    /// Before the parser reads on from the current token: its lexer scans that token, unless it did.
    fn enter_lexer(&mut self) {
        if !self.is_in_lexer {
            self.scan_from(self.start);
        }
    }

    /// `nextToken`
    fn next_token(&mut self) {
        if self.is_in_lexer {
            let result = self.p.lexer.next();
            self.leave_lexer(result);
        } else {
            self.scan_from(self.end);
        }
    }

    /// `parseOptional`
    fn eat(&mut self, token: Token) -> bool {
        if self.token == token {
            self.next_token();
            return true;
        }
        false
    }

    /// `parseExpected`
    fn expect(&mut self, token: Token) -> bool {
        if self.eat(token) {
            return true;
        }
        self.expected_at_token(match token {
            Token::At => "@",
            Token::Asterisk => "*",
            Token::OpenBrace => "{",
            Token::CloseBrace => "}",
            Token::OpenBracket => "[",
            Token::CloseBracket => "]",
            Token::LessThan => "<",
            Token::Equals => "=",
            Token::Comma => ",",
            Token::Dot => ".",
            Token::DotDotDot => "...",
            Token::Backtick => "`",
            _ => "",
        });
        false
    }

    /// `parseOptionalJsdoc`
    fn eat_jsdoc(&mut self, token: Token) -> bool {
        if self.token == token {
            self.next_jsdoc();
            return true;
        }
        false
    }

    // ───────────────────────────── what the parser reads ─────────────────────────────

    /// `SetSkipJSDocLeadingAsterisks`
    fn set_skips_leading_asterisks(&mut self, skips: bool) {
        self.p.lexer.skips_jsdoc_asterisks = skips;
    }

    /// `parseTypeOrTypePredicate`, from the current token on.
    fn read_type(&mut self) -> ts::TypeId {
        // `parseTypeReference` at a token that is none: the name is missing (1110), and the token stays.
        if !self.is_in_lexer && self.token == Token::Unknown {
            self.error_at_token(1110);
            self.p.emit_type(ts::TypeData::Missing, self.start as u32);
            return self.p.last_type();
        }
        self.enter_lexer();
        self.p.clear_last_type();
        let result = self.p.skip_typescript_return_type();
        match self.leave_lexer(result) {
            Some(()) => self.p.last_type(),
            None => ts::TypeId::NONE,
        }
    }

    /// `parseTypeArguments`, from the current token on.
    fn read_type_arguments(&mut self) -> Option<ts::IdList<ts::Type>> {
        if self.token != Token::LessThan {
            return None;
        }
        self.enter_lexer();
        let result = self.p.skip_type_script_type_arguments::<false, false>();
        match self.leave_lexer(result) {
            Some(true) => self.p.type_syntax_mut().last_type_args.take(),
            _ => None,
        }
    }

    /// `parseExpression`, from the current token on. Nothing is made of it.
    fn read_expression(&mut self) {
        self.enter_lexer();
        self.p.scopes_in_order.truncate(0);
        let result = self.p.parse_expr(Level::Lowest);
        self.leave_lexer(result);
    }

    /// `parseImportTag`, from the token after the name of the tag on.
    fn read_import(&mut self) -> Import {
        // Nothing but blanks is left of the comment, and `skipWhitespaceOrAsterisk` leaves those. `parseModuleSpecifier` misses an
        // expression at that token, which stays.
        if !self.is_in_lexer && matches!(self.token, Token::Whitespace | Token::NewLine) {
            self.error_at_token(1109);
            return Import {
                end: self.start as u32,
                ..Import::default()
            };
        }
        self.enter_lexer();
        let from = self.start;
        let mut import = Import::default();
        self.p.scopes_in_order.truncate(0);
        let kept = self.p.type_syntax_mut().specifier_expressions.len();
        let result = Self::read_import_declaration(self.p, &mut import);
        // `reparseUnhosted` makes nothing of a tag without an import clause.
        if !import.has_clause {
            self.p
                .type_syntax_mut()
                .specifier_expressions
                .truncate(kept);
        }
        self.p.lexer.skips_jsdoc_asterisks = false;
        self.leave_lexer(result);
        import.end = self.start as u32;
        import.mode = self.resolution_mode_override(from);
        import
    }

    fn read_import_declaration(
        p: &mut P<'a, true, false>,
        import: &mut Import,
    ) -> Result<(), Error> {
        if p.is_identifier_in_context() {
            import.default = Some(name_at_token(p));
            p.lexer.next()?;
        }
        // `tryParseImportClause`
        if import.default.is_some() || matches!(p.lexer.token, T::TAsterisk | T::TOpenBrace) {
            import.has_clause = true;
            // `parseImportClause`
            let has_bindings = if import.default.is_none() {
                true
            } else if p.lexer.token == T::TComma {
                p.lexer.next()?;
                true
            } else {
                false
            };
            if has_bindings {
                p.lexer.skips_jsdoc_asterisks = true;
                if p.lexer.token == T::TAsterisk {
                    // `parseNamespaceImport`
                    p.lexer.next()?;
                    p.lexer.expect_contextual_keyword(b"as")?;
                    if p.is_identifier_in_context() {
                        import.namespace = Some(name_at_token(p));
                        p.lexer.next()?;
                    } else {
                        let at = p.lexer.full_start().to_usize() as u32;
                        import.namespace = Some(Name { start: at, end: at });
                        p.lexer.expect(T::TIdentifier)?;
                    }
                } else {
                    // `parseNamedImports`
                    for item in p.parse_import_clause()?.items.iter() {
                        import.named.push(ImportSpecifier {
                            imported: item.alias,
                            imported_pos: item.alias_loc.start.max(0) as u32,
                            local: item.original_name,
                            local_pos: item.name.loc.start.max(0) as u32,
                        });
                    }
                }
                p.lexer.skips_jsdoc_asterisks = false;
            }
            p.lexer.expect_contextual_keyword(b"from")?;
        }
        // `parseModuleSpecifier`, `tryParseImportAttributes`
        let is_string = p.lexer.token == T::TStringLiteral;
        let path = p.parse_path()?;
        if is_string {
            import.specifier = Some((StoreStr::new(path.text), path.loc.start.max(0) as u32));
        }
        Ok(())
    }

    /// `GetResolutionModeOverride`, of the import attributes the parser kept since it was at `from`.
    fn resolution_mode_override(&mut self, from: usize) -> ts::ResolutionMode {
        let Some(&(keyword, attributes)) = self.p.type_syntax_mut().import_attributes.last() else {
            return ts::ResolutionMode::None;
        };
        if (keyword.max(0) as usize) < from {
            return ts::ResolutionMode::None;
        }
        let ExprData::EObject(object) = &attributes.data else {
            return ts::ResolutionMode::None;
        };
        let [attribute] = object.properties.as_slice() else {
            return ts::ResolutionMode::None;
        };
        match (
            attribute.key.as_ref().map(|key| &key.data),
            attribute.value.as_ref().map(|value| &value.data),
        ) {
            (Some(ExprData::EString(name)), Some(ExprData::EString(value)))
                if name.eql_comptime(b"resolution-mode") =>
            {
                if value.eql_comptime(b"import") {
                    ts::ResolutionMode::Import
                } else if value.eql_comptime(b"require") {
                    ts::ResolutionMode::Require
                } else {
                    ts::ResolutionMode::None
                }
            }
            _ => ts::ResolutionMode::None,
        }
    }

    /// `canFollowModifier`, of a token the lexer scanned.
    fn can_follow_modifier(&self) -> bool {
        self.p.lexer.is_identifier_or_keyword()
            || matches!(
                self.p.lexer.token,
                T::TPrivateIdentifier
                    | T::TOpenBracket
                    | T::TOpenBrace
                    | T::TAsterisk
                    | T::TDotDotDot
                    | T::TStringLiteral
                    | T::TNumericLiteral
                    | T::TBigIntegerLiteral
            )
    }

    fn is_object_or_object_array(&mut self, ty: Option<TypeExpr>) -> bool {
        match ty {
            Some(expr) if !expr.is_variadic && !expr.is_optional => {
                is_object_or_object_array(&self.p.type_syntax_mut().ast, expr.ty)
            }
            _ => false,
        }
    }

    fn is_array_type(&mut self, ty: Option<TypeExpr>) -> bool {
        match ty {
            Some(expr) if !expr.is_variadic && !expr.is_optional && expr.ty.is_some() => matches!(
                self.p.type_syntax_mut().ast[expr.ty].data,
                ts::TypeData::Array(_)
            ),
            _ => false,
        }
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// `parseJSDocCommentWorker`. Of the text only what decides where the tags are is kept track of.
    fn comment(&mut self, start: usize) -> Vec<Tag> {
        let line_start = self.text[..start]
            .iter()
            .rposition(|&c| c == b'\n')
            .map_or(0, |at| at + 1);
        // For the leading `/** `.
        let mut indent = start + 4 - line_start;
        let mut tags: Vec<Tag> = Vec::new();
        let mut state = State::SawAsterisk;
        let mut backticks = 0;
        let mut in_fenced_code_block = false;

        self.next_jsdoc();
        while self.eat_jsdoc(Token::Whitespace) {}
        if self.eat_jsdoc(Token::NewLine) {
            state = State::BeginningOfLine;
            indent = 0;
        }
        loop {
            // Three or more backticks in a row open or close a fenced code block.
            if self.token != Token::Backtick && backticks > 0 {
                if backticks >= 3 {
                    in_fenced_code_block = !in_fenced_code_block;
                }
                backticks = 0;
            }
            match self.token {
                Token::At if !in_fenced_code_block && self.can_follow_at() => {
                    let tag = self.tag(&tags, indent);
                    tags.push(tag);
                    state = State::BeginningOfLine;
                }
                Token::NewLine => {
                    state = State::BeginningOfLine;
                    indent = 0;
                }
                Token::Asterisk if state != State::SawAsterisk => {
                    // The first asterisk of a line.
                    state = State::SawAsterisk;
                    indent += self.token_len();
                }
                Token::Whitespace => indent += self.token_len(),
                Token::EndOfFile => break,
                Token::Backtick => {
                    backticks += 1;
                    state = if state == State::SavingBackticks {
                        State::SavingComments
                    } else {
                        State::SavingBackticks
                    };
                    indent += self.token_len();
                }
                Token::Asterisk => {
                    // After a second asterisk no tag starts on the line.
                    state = State::SavingComments;
                    indent += self.token_len();
                }
                Token::At | Token::OpenBrace => {
                    state = State::saving(in_fenced_code_block);
                    indent += self.token_len();
                }
                _ => {
                    if state != State::SavingBackticks {
                        state = State::saving(in_fenced_code_block);
                    }
                    indent += self.token_len();
                }
            }
            if state.is_saving() {
                self.next_comment_text(state == State::SavingBackticks);
            } else {
                self.next_jsdoc();
            }
        }
        tags
    }

    /// `isNextNonwhitespaceTokenEndOfFile`
    fn is_next_nonwhitespace_token_end_of_file(&mut self) -> bool {
        loop {
            match self.next_jsdoc() {
                Token::EndOfFile => return true,
                Token::Whitespace | Token::NewLine => {}
                _ => return false,
            }
        }
    }

    /// Whether only whitespace is left, which is part of nothing.
    fn is_at_trailing_whitespace(&mut self) -> bool {
        matches!(self.token, Token::Whitespace | Token::NewLine)
            && self.look_ahead(Self::is_next_nonwhitespace_token_end_of_file)
    }

    /// `skipWhitespace`
    fn skip_whitespace(&mut self) {
        if self.is_at_trailing_whitespace() {
            return;
        }
        while matches!(self.token, Token::Whitespace | Token::NewLine) {
            self.next_jsdoc();
        }
    }

    /// `skipWhitespaceOrAsterisk`. Returns how long the indentation after the last line break is.
    fn skip_whitespace_or_asterisk(&mut self) -> usize {
        if self.is_at_trailing_whitespace() {
            return 0;
        }
        let mut preceding_line_break = self.has_newline_before;
        let mut seen_line_break = false;
        let mut indent = 0;
        while (preceding_line_break && self.token == Token::Asterisk)
            || matches!(self.token, Token::Whitespace | Token::NewLine)
        {
            indent += self.token_len();
            if self.token == Token::NewLine {
                preceding_line_break = true;
                seen_line_break = true;
                indent = 0;
            } else if self.token == Token::Asterisk {
                preceding_line_break = false;
            }
            self.next_jsdoc();
        }
        if seen_line_break { indent } else { 0 }
    }

    /// `parseTrailingTagComments`, of the tag that starts at `start`. `indent_text`: the length of that text.
    fn trailing_tag_comments(
        &mut self,
        start: usize,
        end: usize,
        mut margin: usize,
        indent_text: usize,
    ) -> bool {
        if indent_text == 0 {
            margin += end.saturating_sub(start);
        }
        self.tag_comments(margin, Some(indent_text.saturating_sub(margin)))
    }

    /// The same, up to the current token.
    fn trailing_comments(&mut self, start: usize, margin: usize, indent_text: usize) {
        let end = self.full_start();
        self.trailing_tag_comments(start, end, margin, indent_text);
    }

    /// `parseTagComments`. Returns whether there is a comment. `initial_margin`: the length of that text.
    fn tag_comments(&mut self, mut indent: usize, initial_margin: Option<usize>) -> bool {
        let mut state = State::BeginningOfLine;
        let mut backticks = 0;
        let mut in_fenced_code_block = false;
        let mut margin: Option<usize> = None;
        let mut has_text = false;
        if let Some(initial_margin) = initial_margin {
            // Straight to saving comments if there is some initial indentation.
            if initial_margin != 0 {
                margin = Some(indent);
                indent += initial_margin;
            }
            state = State::SawAsterisk;
        }
        loop {
            if self.token != Token::Backtick && backticks > 0 {
                if backticks >= 3 {
                    in_fenced_code_block = !in_fenced_code_block;
                }
                backticks = 0;
            }
            // `pushComment`
            let mut is_text = true;
            match self.token {
                Token::NewLine => {
                    state = State::BeginningOfLine;
                    indent = 0;
                    is_text = false;
                }
                Token::At if !in_fenced_code_block && self.can_follow_at() => {
                    self.reset_pos(self.end - 1);
                    break;
                }
                Token::EndOfFile => break,
                Token::Whitespace => {
                    // Whitespace that crosses the margin is part of the comment.
                    if margin.is_some_and(|margin| indent + self.token_len() > margin) {
                        state = State::saving(in_fenced_code_block);
                    }
                    indent += self.token_len();
                    is_text = false;
                }
                Token::At | Token::OpenBrace => state = State::saving(in_fenced_code_block),
                Token::Backtick => {
                    backticks += 1;
                    state = if state == State::SavingBackticks {
                        State::SavingComments
                    } else {
                        State::SavingBackticks
                    };
                }
                Token::Asterisk if state == State::BeginningOfLine => {
                    // A leading asterisk: the comment goes on at the next token.
                    state = State::SawAsterisk;
                    indent += 1;
                    is_text = false;
                }
                _ => {
                    if state != State::SavingBackticks {
                        state = State::saving(in_fenced_code_block);
                    }
                }
            }
            if is_text {
                margin.get_or_insert(indent);
                indent += self.token_len();
                has_text |= !self.token_text().trim_ascii().is_empty();
            }
            if state.is_saving() {
                self.next_comment_text(state == State::SavingBackticks);
            } else {
                self.next_jsdoc();
            }
        }
        has_text
    }

    /// `parseJSDocLinkPrefix`: whether `{@link`, `{@linkcode` or `{@linkplain` is next.
    fn is_at_link(&mut self) -> bool {
        self.skip_whitespace_or_asterisk();
        self.token == Token::OpenBrace
            && self.next_jsdoc() == Token::At
            && self.next_jsdoc() == Token::Word
            && matches!(self.token_text(), b"link" | b"linkcode" | b"linkplain")
    }

    // ───────────────────────────── tags ─────────────────────────────

    /// `parseTag`
    fn tag(&mut self, previous: &[Tag], margin: usize) -> Tag {
        let start = self.start;
        self.next_jsdoc();
        let name = self.identifier_name(Some(1003));
        let indent_text = self.skip_whitespace_or_asterisk();
        let text = self.text;
        let kind = match name.text(text) {
            b"implements" => {
                let class = self.class_name();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Implements(class)
            }
            b"augments" | b"extends" => {
                let class = self.class_name();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Augments(class)
            }
            word @ (b"public" | b"private" | b"protected" | b"readonly" | b"override") => {
                self.trailing_comments(start, margin, indent_text);
                TagKind::Modifier(match word {
                    b"public" => Flags::PUBLIC,
                    b"private" => Flags::PRIVATE,
                    b"protected" => Flags::PROTECTED,
                    b"readonly" => Flags::READONLY,
                    _ => Flags::OVERRIDE,
                })
            }
            b"this" => return self.this_tag(start, name, margin, indent_text),
            b"arg" | b"argument" | b"param" => {
                return self.parameter_or_property_tag(start, name, PARAMETER, margin);
            }
            b"return" | b"returns" => {
                // `parseReturnTag`
                if previous
                    .iter()
                    .any(|tag| matches!(tag.kind, TagKind::Return(_)))
                {
                    self.error(name.start as usize, 0, 1223);
                }
                let ty = self.try_type_expression();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Return(ty)
            }
            b"template" => return self.template_tag(start, name, margin, indent_text),
            b"type" => return self.type_tag(previous, start, name, Some(margin), indent_text),
            b"typedef" => self.typedef_tag(start, name, margin, indent_text),
            b"callback" => self.callback_tag(start, margin, indent_text),
            b"overload" => self.overload_tag(start, margin, indent_text),
            b"satisfies" => {
                let ty = self.type_expression(false);
                self.trailing_comments(start, margin, indent_text);
                TagKind::Satisfies(ty)
            }
            b"exception" | b"throws" => {
                self.try_type_expression();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Other
            }
            b"import" => {
                let import = self.read_import();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Import(import)
            }
            _ => {
                self.trailing_comments(start, margin, indent_text);
                TagKind::Other
            }
        };
        Tag {
            kind,
            pos: start as u32,
            name_pos: name.start,
        }
    }

    /// `parseJSDocIdentifierName`. `code`: what is said if there is none.
    fn identifier_name(&mut self, code: Option<u32>) -> Name {
        if self.token != Token::Word {
            if let Some(code) = code {
                self.error_at_token(code);
            }
            let at = self.full_start() as u32;
            return Name { start: at, end: at };
        }
        let name = Name {
            start: self.start as u32,
            end: self.end as u32,
        };
        self.next_jsdoc();
        name
    }

    /// `parseJSDocEntityName`
    fn entity_name(&mut self, code: Option<u32>) -> Vec<Name> {
        let mut names = vec![self.identifier_name(code)];
        // `y[]` is accepted as a name. The brackets are not kept.
        if self.eat(Token::OpenBracket) {
            self.expect(Token::CloseBracket);
        }
        while self.eat(Token::Dot) {
            names.push(self.identifier_name(Some(1003)));
            if self.eat(Token::OpenBracket) {
                self.expect(Token::CloseBracket);
            }
        }
        names
    }

    /// `parseJSDocType`
    fn jsdoc_type(&mut self) -> TypeExpr {
        self.set_skips_leading_asterisks(true);
        let pos = self.start as u32;
        let is_variadic = self.eat(Token::DotDotDot);
        let ty = self.read_type();
        self.set_skips_leading_asterisks(false);
        let is_optional = self.eat(Token::Equals);
        TypeExpr {
            ty,
            pos,
            end: self.start as u32,
            is_variadic,
            is_optional,
        }
    }

    /// `parseJSDocTypeExpression`
    fn type_expression(&mut self, may_omit_braces: bool) -> TypeExpr {
        let has_brace = if may_omit_braces {
            self.eat(Token::OpenBrace)
        } else {
            self.expect(Token::OpenBrace)
        };
        let ty = self.jsdoc_type();
        // `parseExpectedJSDoc`
        if has_brace && !self.eat_jsdoc(Token::CloseBrace) {
            self.expected_at_token("}");
        }
        ty
    }

    /// `tryParseTypeExpression`
    fn try_type_expression(&mut self) -> Option<TypeExpr> {
        self.skip_whitespace_or_asterisk();
        (self.token == Token::OpenBrace).then(|| self.type_expression(false))
    }

    /// `parseBracketNameInPropertyAndParamTag`
    fn bracket_name(&mut self, target: u8) -> (Vec<Name>, bool) {
        // `[foo]`, `foo`, `[foo.bar]` or `foo.bar`
        let is_bracketed = self.eat_jsdoc(Token::OpenBracket);
        if is_bracketed {
            self.skip_whitespace();
        }
        // A name in backquotes is no legal JSDoc, but occurs in the wild.
        let is_backquoted = self.eat_jsdoc(Token::Backtick);
        let name = self.entity_name(if target == PARAMETER {
            None
        } else {
            Some(1003)
        });
        if is_backquoted {
            self.expect(Token::Backtick);
        }
        if is_bracketed {
            self.skip_whitespace();
            // `[foo = 42]`
            if self.eat(Token::Equals) {
                self.read_expression();
            }
            self.expect(Token::CloseBracket);
        }
        (name, is_bracketed)
    }

    /// `parseParameterOrPropertyTag`
    fn parameter_or_property_tag(
        &mut self,
        start: usize,
        tag_name: Name,
        target: u8,
        indent: usize,
    ) -> Tag {
        let mut ty = self.try_type_expression();
        let mut is_name_first = ty.is_none();
        self.skip_whitespace_or_asterisk();
        let (name, is_bracketed) = self.bracket_name(target);
        let indent_text = self.skip_whitespace_or_asterisk();
        if is_name_first && !self.look_ahead(Self::is_at_link) {
            ty = self.try_type_expression();
        }
        self.trailing_comments(start, indent, indent_text);
        let ty = match self.nested_type_literal(ty, &name, target, indent) {
            Some(literal) => {
                is_name_first = true;
                literal
            }
            None => ty.map_or(TagType::None, TagType::Expr),
        };
        let property = Property {
            name,
            is_bracketed,
            is_name_first,
            ty,
        };
        Tag {
            kind: if target == PROPERTY {
                TagKind::Property(property)
            } else {
                TagKind::Param(property)
            },
            pos: start as u32,
            name_pos: tag_name.start,
        }
    }

    /// `parseNestedTypeLiteral`
    fn nested_type_literal(
        &mut self,
        ty: Option<TypeExpr>,
        name: &[Name],
        target: u8,
        indent: usize,
    ) -> Option<TagType> {
        if !self.is_object_or_object_array(ty) {
            return None;
        }
        let pos = self.full_start() as u32;
        let mut properties = Vec::new();
        loop {
            let mark = self.mark();
            let Some(child) = self.child_tag(target, indent, Some(name)) else {
                self.rewind(&mark);
                break;
            };
            match child.kind {
                TagKind::Param(_) | TagKind::Property(_) => properties.push(child),
                TagKind::Template(_) => self.error(child.name_pos as usize, 0, 8039),
                _ => {}
            }
        }
        if properties.is_empty() {
            return None;
        }
        Some(TagType::Literal {
            properties,
            is_array: self.is_array_type(ty),
            pos,
        })
    }

    /// `parseTypeTag`. Without an `indent` the comment after it is left: it is under a `@typedef`.
    fn type_tag(
        &mut self,
        previous: &[Tag],
        start: usize,
        name: Name,
        indent: Option<usize>,
        indent_text: usize,
    ) -> Tag {
        if previous
            .iter()
            .any(|tag| matches!(tag.kind, TagKind::Type(_)))
        {
            self.error(name.start as usize, 0, 1223);
        }
        let ty = self.type_expression(true);
        if let Some(indent) = indent {
            self.trailing_comments(start, indent, indent_text);
        }
        Tag {
            kind: TagKind::Type(ty),
            pos: start as u32,
            name_pos: name.start,
        }
    }

    /// `parseThisTag`
    fn this_tag(&mut self, start: usize, name: Name, margin: usize, indent_text: usize) -> Tag {
        let ty = self.type_expression(true);
        self.skip_whitespace();
        self.trailing_comments(start, margin, indent_text);
        Tag {
            kind: TagKind::This(ty),
            pos: start as u32,
            name_pos: name.start,
        }
    }

    /// `parseExpressionWithTypeArgumentsForAugments`
    fn class_name(&mut self) -> ClassName {
        let used_brace = self.eat(Token::OpenBrace);
        // `parsePropertyAccessEntityNameExpression`
        let mut name = vec![self.identifier_name(Some(1003))];
        while self.eat(Token::Dot) {
            name.push(self.identifier_name(Some(1003)));
        }
        self.set_skips_leading_asterisks(true);
        let type_args = self.read_type_arguments();
        self.set_skips_leading_asterisks(false);
        let end = self.start as u32;
        if used_brace {
            self.skip_whitespace();
            self.expect(Token::CloseBrace);
        }
        ClassName {
            name,
            type_args,
            end,
        }
    }

    /// `parseJSDocTypeNameWithNamespace`, or a missing name.
    fn declared_name(&mut self) -> DeclaredName {
        if self.token != Token::Word {
            return DeclaredName {
                namespaces: Vec::new(),
                name: self.identifier_name(Some(1003)),
            };
        }
        let mut namespaces = Vec::new();
        let mut name = self.identifier_name(None);
        while self.eat_jsdoc(Token::Dot) {
            namespaces.push(name);
            // `getInnermostNameOfJSDocNamespace`: after a last dot, the name of the namespace once more.
            if self.token != Token::Word {
                break;
            }
            name = self.identifier_name(None);
        }
        DeclaredName { namespaces, name }
    }

    /// `parseTypedefTag`
    fn typedef_tag(
        &mut self,
        start: usize,
        tag_name: Name,
        indent: usize,
        indent_text: usize,
    ) -> TagKind {
        let written = self.try_type_expression();
        self.skip_whitespace_or_asterisk();
        let name = self.declared_name();
        self.skip_whitespace();
        let has_comment = self.tag_comments(indent, None);
        let mut ty = written.map_or(TagType::None, TagType::Expr);
        if written.is_none() || self.is_object_or_object_array(written) {
            let mut has_children = false;
            let mut child_type: Option<TypeExpr> = None;
            let mut properties = Vec::new();
            loop {
                let mark = self.mark();
                let Some(child) = self.child_tag(PROPERTY, indent, None) else {
                    self.rewind(&mark);
                    break;
                };
                has_children = true;
                match child.kind {
                    TagKind::Template(_) => self.error(child.name_pos as usize, 0, 8039),
                    TagKind::Type(expr) if child_type.is_none() => child_type = Some(expr),
                    TagKind::Type(_) => self.error_at_token(8033),
                    _ => properties.push(child),
                }
            }
            if has_children {
                ty = match child_type {
                    Some(expr) if !self.is_object_or_object_array(child_type) => {
                        TagType::Expr(expr)
                    }
                    _ => TagType::Literal {
                        pos: properties.first().map_or(start as u32, |first| first.pos),
                        is_array: self.is_array_type(written),
                        properties,
                    },
                };
            }
        }
        if !has_comment {
            let end = (name.name.end.max(tag_name.end)) as usize;
            self.trailing_tag_comments(start, end, indent, indent_text);
        }
        TagKind::Typedef(Typedef { name, ty })
    }

    /// `parseJSDocSignature`
    fn signature(&mut self, pos: usize, indent: usize) -> Signature {
        // `parseCallbackTagParameters`
        let mut params = Vec::new();
        loop {
            let mark = self.mark();
            let Some(child) = self.child_tag(CALLBACK_PARAMETER, indent, None) else {
                self.rewind(&mark);
                break;
            };
            match child.kind {
                TagKind::Template(_) => self.error(child.name_pos as usize, 0, 8039),
                _ => params.push(child),
            }
        }
        let mut ret = None;
        let mut has_return_tag = false;
        let mark = self.mark();
        if self.eat_jsdoc(Token::At)
            && self.token == Token::At
            && let TagKind::Return(ty) = self.tag(&[], indent).kind
        {
            has_return_tag = true;
            ret = ty;
        }
        if !has_return_tag {
            self.rewind(&mark);
        }
        Signature {
            params,
            ret,
            pos: pos as u32,
        }
    }

    /// `parseCallbackTag`
    fn callback_tag(&mut self, start: usize, indent: usize, indent_text: usize) -> TagKind {
        let name = self.declared_name();
        self.skip_whitespace();
        let has_comment = self.tag_comments(indent, None);
        let pos = self.full_start();
        let signature = self.signature(pos, indent);
        if !has_comment {
            self.trailing_comments(start, indent, indent_text);
        }
        TagKind::Callback(Callback { name, signature })
    }

    /// `parseOverloadTag`
    fn overload_tag(&mut self, start: usize, indent: usize, indent_text: usize) -> TagKind {
        self.skip_whitespace();
        let has_comment = self.tag_comments(indent, None);
        let signature = self.signature(start, indent);
        if !has_comment {
            self.trailing_comments(start, indent, indent_text);
        }
        TagKind::Overload(signature)
    }

    /// `parseChildParameterOrPropertyTag`. `name`: that of the tag the child has to be a part of.
    fn child_tag(&mut self, target: u8, indent: usize, name: Option<&[Name]>) -> Option<Tag> {
        let mut can_parse_tag = true;
        let mut seen_asterisk = false;
        loop {
            match self.next_jsdoc() {
                Token::At => {
                    if can_parse_tag && self.can_follow_at() {
                        let child = self.try_child_tag(target, indent)?;
                        if let Some(name) = name
                            && let TagKind::Param(property) | TagKind::Property(property) =
                                &child.kind
                            && !self.is_part_of(&property.name, name)
                        {
                            return None;
                        }
                        return Some(child);
                    }
                    seen_asterisk = false;
                }
                Token::NewLine => {
                    can_parse_tag = true;
                    seen_asterisk = false;
                }
                Token::Asterisk => {
                    if seen_asterisk {
                        can_parse_tag = false;
                    }
                    seen_asterisk = true;
                }
                Token::Word => can_parse_tag = false,
                Token::EndOfFile => return None,
                _ => {}
            }
        }
    }

    /// `textsEqual`, of `parent` and what is left of the last dot in `child`.
    fn is_part_of(&self, child: &[Name], parent: &[Name]) -> bool {
        child.len() == parent.len() + 1
            && child
                .iter()
                .zip(parent)
                .all(|(a, b)| a.text(self.text) == b.text(self.text))
    }

    /// `tryParseChildTag`
    fn try_child_tag(&mut self, target: u8, indent: usize) -> Option<Tag> {
        let start = self.start;
        self.next_jsdoc();
        let name = self.identifier_name(Some(1003));
        let indent_text = self.skip_whitespace_or_asterisk();
        let text = self.text;
        let fits = match name.text(text) {
            b"type" if target == PROPERTY => {
                return Some(self.type_tag(&[], start, name, None, 0));
            }
            b"prop" | b"property" => PROPERTY,
            b"arg" | b"argument" | b"param" => PARAMETER | CALLBACK_PARAMETER,
            b"template" => return Some(self.template_tag(start, name, indent, indent_text)),
            b"this" => return Some(self.this_tag(start, name, indent, indent_text)),
            _ => return None,
        };
        if target & fits == 0 {
            return None;
        }
        Some(self.parameter_or_property_tag(start, name, target, indent))
    }

    /// `parseModifiersEx`, before the name of a type parameter.
    fn type_parameter_modifiers(&mut self) -> Vec<(Flags, u32)> {
        let mut modifiers = Vec::new();
        let mut has_static = false;
        while self.token == Token::Word {
            // `IsModifierKind`. Nothing that can follow `export` or `default` is a type parameter.
            let flag = match self.token_text() {
                b"const" => Flags::CONST,
                b"in" => Flags::IN,
                b"out" => Flags::OUT,
                b"abstract" | b"accessor" | b"async" | b"declare" | b"override" | b"private"
                | b"protected" | b"public" | b"readonly" | b"static" => Flags::empty(),
                _ => break,
            };
            let is_static = self.token_text() == b"static";
            if is_static && has_static {
                break;
            }
            // `nextTokenCanFollowModifier`
            let (mark, pos) = (self.mark(), self.start as u32);
            self.next_token();
            if !self.is_in_lexer
                || !self.can_follow_modifier()
                || self.has_newline_before && !is_static
            {
                self.rewind(&mark);
                break;
            }
            has_static |= is_static;
            modifiers.push((flag, pos));
        }
        modifiers
    }

    /// `parseTemplateTagTypeParameter`
    fn template_type_parameter(&mut self) -> Option<TypeParameter> {
        let is_bracketed = self.eat_jsdoc(Token::OpenBracket);
        if is_bracketed {
            self.skip_whitespace();
        }
        let modifiers = self.type_parameter_modifiers();
        let name = self.identifier_name(Some(1069));
        let mut default = None;
        if is_bracketed {
            self.skip_whitespace();
            self.expect(Token::Equals);
            default = Some(self.jsdoc_type());
            self.expect(Token::CloseBracket);
        }
        (!name.is_missing()).then_some(TypeParameter {
            name,
            modifiers,
            default,
        })
    }

    /// `parseTemplateTag`
    fn template_tag(&mut self, start: usize, name: Name, indent: usize, indent_text: usize) -> Tag {
        let constraint = (self.token == Token::OpenBrace).then(|| self.type_expression(false));
        // `parseTemplateTagTypeParameters`
        let mut params = Vec::new();
        loop {
            self.skip_whitespace();
            params.extend(self.template_type_parameter());
            self.skip_whitespace_or_asterisk();
            if !self.eat_jsdoc(Token::Comma) {
                break;
            }
        }
        self.trailing_comments(start, indent, indent_text);
        Tag {
            kind: TagKind::Template(Template { constraint, params }),
            pos: start as u32,
            name_pos: name.start,
        }
    }
}
