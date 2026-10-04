//! Parses the JSDoc comments of a JavaScript file. A port of jsdoc.go of TypeScript 7.0.2's parser.
//!
//! It runs between the parse pass and the lowering pass, over the comments the lexer recorded. The
//! tags are parsed here with their own scanner (`ScanJSDocToken`). Ordinary syntax inside them is
//! parsed by the main parser, whose lexer is repositioned into the comment, and is saved like the
//! type syntax of a TypeScript file. [`super::reparse`] turns the tags of comments attached to a
//! node into ordinary nodes.

use crate::sema::ts_syntax as ts;
use bun_ast::op::Level;
use bun_ast::{Range, StoreStr};
use bun_core::lexer::scan_identifier_parts;
use bun_sema::hir::{Diagnostic, DiagnosticKind, Flags, TypeNodeKind};

use super::TypeSyntax;
use crate::Error;
use crate::lexer::{
    CodePoint, LexerSnapshot, PropertyModifierKeyword, T, char_and_size, end_of_run,
    is_identifier_continue, is_identifier_start, is_white_space_single_line, last_char,
    peek_unicode_escape, starts_with_line_break,
};
use crate::p::P;
use crate::parse::lists::ListKind;

// ───────────────────────────── parsed tags ─────────────────────────────

/// The span of an identifier in a tag. A missing identifier has an empty span.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct Name {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The token's source text.
    pub(crate) text: StoreStr,
}

impl Name {
    fn missing(at: u32) -> Name {
        Name {
            start: at,
            end: at,
            text: StoreStr::EMPTY,
        }
    }

    pub(crate) fn is_missing(self) -> bool {
        self.start == self.end
    }
}

/// `JSDocTypeExpression`: what `parseJSDocType` reads.
#[derive(Copy, Clone)]
pub(crate) struct TypeExpr {
    /// The type, without the `...` before it and the `=` after it.
    pub(crate) ty: ts::TypeId,
    /// Start position, including the `...`.
    pub(crate) pos: u32,
    /// Start of the next token.
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
    /// `JSDocTypeLiteral`: built from the `@property` or `@param` tags that follow.
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
    /// `GetTextOfJSDocComment(tag.CommentList())` for a tag nested in another tag. Empty for any
    /// other tag.
    pub(crate) comment: Box<[u8]>,
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
    /// Position of its first token: the `[`, a modifier, or the name.
    pub(crate) pos: u32,
    pub(crate) name: Name,
    /// `node.Modifiers()`, each with its position.
    pub(crate) modifiers: Vec<(Flags, u32)>,
    /// `[T=Default]`
    pub(crate) default: Option<TypeExpr>,
    /// `node.End()`
    pub(crate) end: u32,
}

/// `JSDocTemplateTag`
pub(crate) struct Template {
    /// `@template {Constraint} T`: applies to the first type parameter.
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
    pub(crate) type_args: Option<ts::Types>,
    /// Start of the token after the type arguments.
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
    /// Position of the first token of the import clause, and of the `*` of `* as namespace`.
    pub(crate) clause_start: u32,
    /// `importClause.End()`
    pub(crate) clause_end: u32,
    pub(crate) namespace_start: u32,
    pub(crate) named: Vec<ImportSpecifier>,
    /// The module specifier and its position. `None` if it is not a string.
    pub(crate) specifier: Option<(StoreStr, u32)>,
    pub(crate) module: Option<ts::ModuleSpecifier>,
    /// Start of the next token.
    pub(crate) end: u32,
}

pub(crate) enum TagKind {
    Type(TypeExpr),
    Satisfies(TypeExpr),
    /// With the text of the tag.
    This(TypeExpr, StoreStr),
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
    /// With the tag name that was used.
    Augments(ClassName, StoreStr),
    /// `@public`, `@private`, `@protected`, `@readonly`, `@override`
    Modifier(Flags),
    /// Any other tag. Ignored.
    Other,
}

pub(crate) struct Tag {
    pub(crate) kind: TagKind,
    /// Position of the `@`.
    pub(crate) pos: u32,
    /// Position of the name after the `@`.
    pub(crate) name_pos: u32,
    /// `node.End()`: the start of the next tag, or else the position before the `*/`.
    pub(crate) end: u32,
}

/// A JSDoc comment that has tags.
pub(crate) struct JsDoc {
    /// Start of its `/**` and end of its `*/`.
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) tags: Vec<Tag>,
    /// The diagnostics in the comment. `JsDoc`: parse errors. Other kinds: checker errors, reported only for the parts that are reparsed.
    pub(crate) diagnostics: Vec<Diagnostic>,
}

/// The JSDoc comments of a file that can have tags, in source order.
#[derive(Default)]
pub(crate) struct Comments {
    pub(crate) list: Vec<JsDoc>,
    /// The HIR nodes of the types in them.
    pub(crate) types: super::clone_types::CommentTypes,
}

impl Comments {
    /// Index of the comment that starts at `start`.
    pub(crate) fn at(&self, start: u32) -> Option<usize> {
        self.list.binary_search_by_key(&start, |doc| doc.start).ok()
    }
}

/// `isJSDocLikeText`
pub(crate) fn is_jsdoc_like(comment: &[u8]) -> bool {
    comment.len() >= 4 && comment[1] == b'*' && comment[2] == b'*' && comment[3] != b'/'
}

/// `isObjectOrObjectArrayTypeReference`
fn is_object_or_object_array(file: &bun_sema::hir::FileBuilder, ty: ts::TypeId) -> bool {
    if ty.is_none() {
        return false;
    }
    match file[ty].kind {
        TypeNodeKind::Keyword(ts::Keyword::Object) => true,
        TypeNodeKind::Array(element) => is_object_or_object_array(file, element),
        TypeNodeKind::Ref { name, args } => {
            args.is_empty() && file.texts(name).eq([bun_sema::atom::known::Object])
        }
        _ => false,
    }
}

/// Parses every JSDoc comment recorded by the lexer of `p`. `syntax` is the type syntax the parser
/// saved for the file. The types in the comments become nodes of a separate HIR.
pub(crate) fn read_comments<'a>(
    p: &mut P<'a, true, false, true>,
    mut syntax: TypeSyntax<'a>,
) -> (TypeSyntax<'a>, Comments) {
    let mut comments = Comments::default();
    if !syntax.save_types || !p.is_tolerant() {
        return (syntax, comments);
    }
    let source: &'a [u8] = p.lexer.contents;
    let ranges = core::mem::take(&mut p.lexer.all_comments);
    let flags = core::mem::take(&mut p.lexer.comment_flags);
    let file = core::mem::take(&mut syntax.b.file);
    let pending = core::mem::take(&mut syntax.b.pending);
    p.type_syntax = Some(Box::new(syntax));
    // `PCJSDocComment`: like `PCJsxChildren`, any token is an element of it, so list error recovery
    // never skips a token.
    let outer_contexts = core::mem::replace(
        &mut p.lexer.list_contexts,
        1 << ListKind::JsxChildren as u32,
    );
    for range in &ranges {
        let (start, end) = (range.loc.to_usize(), range.end_i().min(source.len()));
        let comment = &source[start.min(end)..end];
        if !is_jsdoc_like(comment)
            || !comment.ends_with(b"*/")
            || !bun_core::strings::contains_char(comment, b'@')
        {
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
    p.lexer.comment_flags = flags;
    p.lexer.list_contexts = outer_contexts;
    p.lexer.skips_jsdoc_asterisks = false;
    let mut syntax = *p.type_syntax.take().expect("set above");
    comments.types.file = core::mem::replace(&mut syntax.b.file, file);
    comments.types.pending = core::mem::replace(&mut syntax.b.pending, pending);
    comments.types.created = core::mem::take(&mut syntax.comment_rows);
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
    /// A character `ScanJSDocToken` does not recognize.
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

/// The parser lexer's current token, as a `Name`.
fn name_at_token(p: &P<'_, true, false, true>) -> Name {
    Name {
        start: p.lexer.start as u32,
        end: u32::try_from(p.lexer.end).expect("int cast"),
        text: StoreStr::new(p.lexer.raw()),
    }
}

/// The identifier `text` with its unicode escapes decoded.
pub(crate) fn unescaped_name(text: &[u8]) -> Vec<u8> {
    let mut name = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&c) = text.get(at) {
        let escape = if c == b'\\' {
            peek_unicode_escape(text, at)
        } else {
            None
        };
        match escape.and_then(|(c, len)| Some((char::from_u32(c as u32)?, len))) {
            Some((c, len)) => {
                name.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                at += len;
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
    p: &'p mut P<'a, true, false, true>,
    /// The source, up to the `*/` of the comment.
    text: &'a [u8],
    token: Token,
    /// `TokenFullStart`, unless the token belongs to the parser's lexer, which is queried instead.
    full_start: usize,
    /// `TokenStart`
    start: usize,
    /// The scanner position: `TokenEnd`.
    end: usize,
    /// `HasPrecedingLineBreak`
    has_newline_before: bool,
    /// The current token is the parser lexer's current token.
    is_in_lexer: bool,
    /// `tag_comments` collects the text in `comment_text`.
    saves_comment_text: bool,
    comment_text: Vec<u8>,
}

impl<'p, 'a> Reader<'p, 'a> {
    /// `parseJSDocComment` for the comment from `start` to `end`.
    fn read(
        p: &'p mut P<'a, true, false, true>,
        source: &'a [u8],
        start: usize,
        end: usize,
    ) -> JsDoc {
        let text = &source[..end - 2];
        p.lexer.contents = text;
        p.lexer.all_comments.clear();
        p.lexer.comment_flags.clear();
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
            saves_comment_text: false,
            comment_text: Vec::new(),
        };
        let tags = reader.comment(start);
        JsDoc {
            start: start as u32,
            end: end as u32,
            tags,
            diagnostics: reader.take_errors(logged),
        }
    }

    /// Removes the messages logged after `before` (the message, error and warning counts) and converts the errors to diagnostics.
    fn take_errors(&mut self, before: (usize, u32, u32)) -> Vec<Diagnostic> {
        let source = self.p.source.contents();
        let log = self.p.log();
        let errors = log
            .msgs
            .drain(before.0..)
            .filter(|msg| msg.kind == bun_ast::Kind::Err);
        let diagnostics = errors.filter_map(|msg| {
            // `ScanJSDocToken` does not scan `</` as one token.
            let mut diagnostic = super::diagnostic(&msg, source, false)??;
            if diagnostic.kind == DiagnosticKind::Parse {
                diagnostic.kind = DiagnosticKind::JsDoc;
            }
            // `checkTypeReferenceNode`: `A.<T>` is equivalent to `A<T>` in a JSDoc comment.
            (diagnostic.code != 8020).then_some(diagnostic)
        });
        let diagnostics = diagnostics.collect();
        (log.errors, log.warnings) = (before.1, before.2);
        diagnostics
    }

    /// `parseErrorAt`
    fn error(&mut self, start: usize, len: usize, code: u32) {
        let range = Range {
            loc: bun_ast::usize2loc(start),
            len: len as i32,
        };
        self.p.lexer.ts_error(range, code);
    }

    /// `'{0}' tag already specified.`, of the tag named `name`.
    fn tag_already_specified(&mut self, name: Name) {
        let range = Range {
            loc: bun_ast::usize2loc(name.start as usize),
            len: 0,
        };
        self.p.lexer.ts_error_about(range, 1223, name.text.slice());
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

    /// The parser cannot continue. The rest of the comment is skipped.
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
            b' ' | b'\t' | 0x0B | 0x0C => {
                end = end_of_run(text, end, is_white_space_single_line);
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
            b'\\' => match peek_unicode_escape(text, pos) {
                Some((c, len)) if is_identifier_start(c) => {
                    end = scan_identifier_parts(text, pos + len);
                    Token::Word
                }
                _ => Token::Unknown,
            },
            _ => {
                let (c, size) = char_and_size(text, pos);
                end = pos + size;
                if is_identifier_start(c) {
                    let is_part = |c| is_identifier_continue(c) || c == b'-' as CodePoint;
                    end = end_of_run(text, end, is_part);
                    if text.get(end) == Some(&b'\\') {
                        end = scan_identifier_parts(text, end);
                    }
                    Token::Word
                } else {
                    Token::Unknown
                }
            }
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
            if matches!(c, b'\n' | b'\r' | b'`')
                || c == 0xE2 && starts_with_line_break(&text[end..])
            {
                break;
            }
            if !in_backticks {
                if c == b'{' {
                    break;
                }
                // Elsewhere `@` only starts a tag after whitespace and before an identifier.
                if c == b'@'
                    && is_white_space_single_line(last_char(&text[..end]).0)
                    && is_identifier_start(char_and_size(text, end + 1).0)
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
        let (c, size) = char_and_size(self.text, self.end);
        size == 0
            || is_identifier_start(c)
            || is_white_space_single_line(c)
            || starts_with_line_break(&self.text[self.end..])
    }

    /// Switches back to this scanner at the parser lexer's current token. `result`: the result of
    /// the parse that got there.
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

    /// Makes the parser's lexer scan the token at or after `pos`.
    fn scan_from(&mut self, pos: usize) {
        let lexer = &mut self.p.lexer;
        lexer.current = pos;
        lexer.start = pos;
        lexer.end = pos;
        lexer.step();
        let result = lexer.next();
        self.leave_lexer(result);
    }

    /// Called before the parser continues from the current token: its lexer scans that token unless
    /// it already has.
    fn enter_lexer(&mut self) {
        if !self.is_in_lexer {
            let full_start = self.full_start;
            self.scan_from(self.start);
            self.p.lexer.token_full_start = full_start;
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

    // ───────────────────────────── syntax parsed by the main parser ─────────────────────────────

    /// `SetSkipJSDocLeadingAsterisks`
    fn set_skips_leading_asterisks(&mut self, skips: bool) {
        self.p.lexer.skips_jsdoc_asterisks = skips;
    }

    /// Records the range of nodes that `read` builds, for `DeepCloneReparse`.
    fn keeping_rows<R>(&mut self, read: impl FnOnce(&mut Self) -> R) -> R {
        let before = self.p.type_syntax_mut().rows();
        let result = read(self);
        let syntax = self.p.type_syntax_mut();
        let after = syntax.rows();
        // Nodes built by an abandoned speculative parse are gone.
        while syntax
            .comment_rows
            .last()
            .is_some_and(|created| created.1.types > before.types || created.1.ids > before.ids)
        {
            syntax.comment_rows.pop();
        }
        syntax.comment_rows.push((before, after));
        result
    }

    /// `parseTypeOrTypePredicate`, starting at the current token.
    fn read_type(&mut self) -> ts::TypeId {
        self.keeping_rows(Self::read_type_worker)
    }

    fn read_type_worker(&mut self) -> ts::TypeId {
        // `parseTypeReference` at an unrecognized token: the name is missing (1110), and the token
        // is not consumed.
        if !self.is_in_lexer && self.token == Token::Unknown {
            self.error_at_token(1110);
            self.p.emit_type_ref(StoreStr::EMPTY, self.start as u32);
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

    /// `parseTypeArguments`, starting at the current token.
    fn read_type_arguments(&mut self) -> Option<ts::Types> {
        if self.token != Token::LessThan {
            return None;
        }
        self.keeping_rows(|this| {
            this.enter_lexer();
            let result = this.p.skip_type_script_type_arguments::<false, false>();
            match this.leave_lexer(result) {
                Some(true) => this.p.type_syntax_mut().last_type_args.take(),
                _ => None,
            }
        })
    }

    /// `parseExpression`, starting at the current token. The result is discarded.
    fn read_expression(&mut self) {
        self.enter_lexer();
        self.p.scopes_in_order.truncate(0);
        let result = self.p.parse_expr(Level::Lowest);
        self.leave_lexer(result);
    }

    /// `parseImportTag`, starting at the token after the tag name.
    fn read_import(&mut self) -> Import {
        // Either only whitespace remains in the comment (`skipWhitespaceOrAsterisk` does not consume it), or `ScanJSDocToken` returned
        // `KindUnknown`, for example for a quote or a slash. `parseModuleSpecifier` reports TS1109 without consuming the token.
        let cannot_start_expression = matches!(
            self.token,
            Token::Whitespace | Token::NewLine | Token::Unknown
        );
        if !self.is_in_lexer && cannot_start_expression {
            self.error_at_token(1109);
            return Import {
                end: self.start as u32,
                ..Import::default()
            };
        }
        self.enter_lexer();
        let mut import = Import::default();
        self.p.scopes_in_order.truncate(0);
        self.p.begin_module_syntax(&Default::default());
        let result = Self::read_import_declaration(self.p, &mut import);
        import.module = self.p.end_module_specifier();
        self.p.lexer.skips_jsdoc_asterisks = false;
        self.leave_lexer(result);
        import.end = self.start as u32;
        import
    }

    fn read_import_declaration(
        p: &mut P<'a, true, false, true>,
        import: &mut Import,
    ) -> Result<(), Error> {
        import.clause_start = p.token_start();
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
                    import.namespace_start = p.token_start();
                    p.lexer.next()?;
                    p.lexer.expect_contextual_keyword(b"as")?;
                    if p.is_identifier_in_context() {
                        import.namespace = Some(name_at_token(p));
                        p.lexer.next()?;
                    } else {
                        let at = p.lexer.full_start().to_usize() as u32;
                        import.namespace = Some(Name::missing(at));
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
            import.clause_end = p.lexer.full_start().to_usize() as u32;
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

    /// `canFollowModifier` for a token the lexer scanned.
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
                is_object_or_object_array(&self.p.type_syntax_mut().b.file, expr.ty)
            }
            _ => false,
        }
    }

    fn is_array_type(&mut self, ty: Option<TypeExpr>) -> bool {
        match ty {
            Some(expr) if !expr.is_variadic && !expr.is_optional && expr.ty.is_some() => matches!(
                self.p.type_syntax_mut().b.file[expr.ty].kind,
                TypeNodeKind::Array(_)
            ),
            _ => false,
        }
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// `parseJSDocCommentWorker`. Only the state that determines where tags start is tracked, not
    /// the text.
    fn comment(&mut self, start: usize) -> Vec<Tag> {
        let line_start = bun_core::strings::last_index_of_char(&self.text[..start], b'\n')
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

    /// Whether only trailing whitespace remains, which belongs to no node.
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

    /// `skipWhitespaceOrAsterisk`. Returns the length of the indentation after the last line break.
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

    /// `parseTrailingTagComments` for the tag that starts at `start`. `indent_text`: the length of
    /// that text.
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
        self.comment_text.clear();
        if let Some(initial_margin) = initial_margin {
            // Straight to saving comments if there is some initial indentation.
            if initial_margin != 0 {
                margin = Some(indent);
                indent += initial_margin;
                if self.saves_comment_text {
                    let before = self.full_start();
                    self.comment_text.extend_from_slice(
                        &self.text[before.saturating_sub(initial_margin)..before],
                    );
                }
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
                    if self.saves_comment_text {
                        self.comment_text.extend_from_slice(self.token_text());
                    }
                }
                Token::At if !in_fenced_code_block && self.can_follow_at() => {
                    self.reset_pos(self.end - 1);
                    break;
                }
                Token::EndOfFile => break,
                Token::Whitespace => {
                    // Whitespace that crosses the margin is part of the comment.
                    if let Some(margin) =
                        margin.filter(|&margin| indent + self.token_len() > margin)
                    {
                        state = State::saving(in_fenced_code_block);
                        if self.saves_comment_text {
                            let past_margin = &self.token_text()[margin.saturating_sub(indent)..];
                            self.comment_text.extend_from_slice(past_margin);
                        }
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
                    // A leading asterisk: the comment continues at the next token.
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
                if self.saves_comment_text {
                    self.comment_text.extend_from_slice(self.token_text());
                }
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
        let kind = match name.text.slice() {
            b"implements" => {
                let class = self.class_name();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Implements(class)
            }
            b"augments" | b"extends" => {
                let class = self.class_name();
                self.trailing_comments(start, margin, indent_text);
                TagKind::Augments(class, name.text)
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
                    self.tag_already_specified(name);
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
            end: self.full_start() as u32,
        }
    }

    /// `parseJSDocIdentifierName`. `code`: the error reported if the name is missing.
    fn identifier_name(&mut self, code: Option<u32>) -> Name {
        if self.token != Token::Word {
            if let Some(code) = code {
                self.error_at_token(code);
            }
            return Name::missing(self.full_start() as u32);
        }
        let name = Name {
            start: self.start as u32,
            end: self.end as u32,
            text: StoreStr::new(self.token_text()),
        };
        self.next_jsdoc();
        name
    }

    /// `parseJSDocEntityName`
    fn entity_name(&mut self, code: Option<u32>) -> Vec<Name> {
        let mut names = vec![self.identifier_name(code)];
        // `y[]` is accepted as a name. The brackets are dropped.
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
        // A name in backquotes is not legal JSDoc, but occurs in the wild.
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
        // `removeLeadingNewlines`, `removeTrailingWhitespace`
        let comment: Box<[u8]> = match self.saves_comment_text {
            true => {
                let text = self.comment_text.trim_ascii_end();
                let newlines = text
                    .iter()
                    .take_while(|&&byte| byte == b'\r' || byte == b'\n')
                    .count();
                text[newlines..].into()
            }
            false => Box::default(),
        };
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
            comment,
        };
        Tag {
            kind: if target == PROPERTY {
                TagKind::Property(property)
            } else {
                TagKind::Param(property)
            },
            pos: start as u32,
            name_pos: tag_name.start,
            end: self.full_start() as u32,
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
                TagKind::Template(_) => {
                    self.error(child.name_pos as usize, b"template".len(), 8039)
                }
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

    /// `parseTypeTag`. Without an `indent` the trailing comment is not consumed: the tag is nested
    /// under a `@typedef`.
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
            self.tag_already_specified(name);
        }
        let ty = self.type_expression(true);
        if let Some(indent) = indent {
            self.trailing_comments(start, indent, indent_text);
        }
        Tag {
            kind: TagKind::Type(ty),
            pos: start as u32,
            name_pos: name.start,
            end: self.full_start() as u32,
        }
    }

    /// `parseThisTag`
    fn this_tag(&mut self, start: usize, name: Name, margin: usize, indent_text: usize) -> Tag {
        let ty = self.type_expression(true);
        self.skip_whitespace();
        self.trailing_comments(start, margin, indent_text);
        let end = self.full_start();
        Tag {
            kind: TagKind::This(ty, StoreStr::new(&self.text[start..end])),
            pos: start as u32,
            name_pos: name.start,
            end: end as u32,
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
                    TagKind::Template(_) => {
                        self.error(child.name_pos as usize, b"template".len(), 8039)
                    }
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
                TagKind::Template(_) => {
                    self.error(child.name_pos as usize, b"template".len(), 8039)
                }
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

    /// `parseChildParameterOrPropertyTag`. `name`: the name of the parent tag the child must belong
    /// to.
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

    /// `textsEqual` of `parent` and the part of `child` before its last dot.
    fn is_part_of(&self, child: &[Name], parent: &[Name]) -> bool {
        child.len() == parent.len() + 1 && child.iter().zip(parent).all(|(a, b)| a.text == b.text)
    }

    /// `tryParseChildTag`
    fn try_child_tag(&mut self, target: u8, indent: usize) -> Option<Tag> {
        let start = self.start;
        self.next_jsdoc();
        let name = self.identifier_name(Some(1003));
        let indent_text = self.skip_whitespace_or_asterisk();
        let fits = match name.text.slice() {
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
        let saved = std::mem::replace(&mut self.saves_comment_text, true);
        let tag = self.parameter_or_property_tag(start, name, target, indent);
        self.saves_comment_text = saved;
        Some(tag)
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
                word => {
                    match PropertyModifierKeyword::find(word).and_then(super::keep::modifier_flag) {
                        Some(flag) => Flags::from_bits_retain(flag.bits()),
                        None => break,
                    }
                }
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
        let pos = self.start as u32;
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
            pos,
            name,
            modifiers,
            default,
            end: self.full_start() as u32,
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
            end: self.full_start() as u32,
        }
    }
}
