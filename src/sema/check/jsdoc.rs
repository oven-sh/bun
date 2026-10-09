//! JSDoc comments: where their tags are, and where the type, the name, the default and the text of each tag are.
//!
//! There is one reader: the part of jsdoc.go, of TypeScript 7's parser, that decides where these are. It passes over types and
//! default values by their brackets. With [`Flavor::Oxc`] it answers as the crate oxc_jsdoc in the five places that ask for
//! the flavor: `starts_tag`, `next_jsdoc_comment_text_token`, the `{` in the two loops, and `parse_tag`. `LineStartRule` and the
//! three `find_*` follow the parser of `oxc_jsdoc`, which is under the MIT license.
//!
//! test/cli/lint/oracle/jsdoc/outline.py compares both flavors with models of them, with oxlint and with TypeScript.

use super::spans::{end_of_brackets, skip_trivia, token_end};
use bstr::ByteSlice;
use bun_core::{lexer, strings};
use smallvec::SmallVec;
use std::borrow::Cow;

/// Whose rules a comment is read by.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Flavor {
    /// jsdoc.go of TypeScript 7.
    TypeScript,
    /// The crate oxc_jsdoc, which oxlint and oxfmt read comments with.
    Oxc,
}

/// A range of the text, in bytes. Nothing in a comment is at 0, so `0..0` says that there is none.
#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub struct Range {
    pub start: u32,
    pub end: u32,
}

impl Range {
    const NONE: Range = Range { start: 0, end: 0 };

    const fn new(start: u32, end: u32) -> Range {
        Range { start, end }
    }

    #[inline]
    pub const fn is_none(self) -> bool {
        self.end == 0
    }

    #[inline]
    pub const fn is_some(self) -> bool {
        !self.is_none()
    }
}

/// A tag.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Tag {
    /// The `@`.
    pub at: u32,
    /// The name is `at + 1..name_end`. It can be empty.
    pub name_end: u32,
    /// `{type}`, with the braces.
    pub ty: Range,
    /// `name`, `a.b`, `[name]`, `[name = default]`, with the brackets. `A.B` of a `@typedef`.
    pub name: Range,
    /// What is between the `=` and the `]`. In `[name=]` it is empty and not `NONE`.
    pub default: Range,
    /// Where the description starts, which ends at `end`. 0 for a `@type` in a `@typedef`, which has none.
    pub text: u32,
    /// Where the next tag starts that is not in this one, or the end of what the comment says.
    pub end: u32,
    /// How many tags it is in: a `@property` of a `@typedef` is in one. 0 with `Flavor::Oxc`.
    pub depth: u8,
}

/// A comment that starts with `/**`, is not `/**/`, and is closed.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Comment {
    /// Of the `/**`.
    pub start: u32,
    /// Behind the `*/`.
    pub end: u32,
    /// Its tags are `Outline::tags[first_tag..][..tag_count]`.
    first_tag: u32,
    tag_count: u32,
}

/// The JSDoc comments of a text, in order, and their tags, in order.
#[derive(Default)]
pub struct Outline {
    pub comments: Vec<Comment>,
    tags: Vec<Tag>,
}

/// `isJSDocLikeText`, of a comment that is closed: `/**` and not `/**/`, with `*/` behind the `/**`.
fn is_jsdoc_like(comment: &[u8]) -> bool {
    comment.len() >= 5
        && comment.starts_with(b"/**")
        && comment[3] != b'/'
        && comment.ends_with(b"*/")
}

impl Outline {
    /// Those of `comments`, which is `hir::FileIn::comments` of `text`. `is_stack_low` is asked before a tag is read inside
    /// another tag. `Flavor::Oxc` never asks.
    pub fn read(
        text: &[u8],
        comments: &[(u32, u32)],
        flavor: Flavor,
        is_stack_low: &dyn Fn() -> bool,
    ) -> Outline {
        let mut outline = Outline::default();
        for &comment in comments {
            outline.push(text, comment, flavor, is_stack_low);
        }
        outline
    }

    /// Adds one comment, which is behind those that are there, if it is a JSDoc comment.
    fn push(
        &mut self,
        text: &[u8],
        (start, end): (u32, u32),
        flavor: Flavor,
        is_stack_low: &dyn Fn() -> bool,
    ) {
        let (from, to) = (start as usize, end as usize);
        let written = text.get(from..to).unwrap_or_default();
        if !is_jsdoc_like(written) {
            return;
        }
        let first_tag = self.tags.len() as u32;
        if strings::contains_char(written, b'@') {
            let mut reader = Reader::new(text, from, to, flavor, false, is_stack_low);
            reader.parse_jsdoc_comment_worker(from);
            self.tags.extend_from_slice(&reader.tags);
        }
        self.comments.push(Comment {
            start,
            end,
            first_tag,
            tag_count: self.tags.len() as u32 - first_tag,
        });
    }

    /// The index of the comment whose `/**` is at `start`.
    pub fn index_at(&self, start: u32) -> Option<usize> {
        self.comments
            .binary_search_by_key(&start, |comment| comment.start)
            .ok()
    }

    /// Empty if there is no such comment.
    pub fn tags_of(&self, comment: usize) -> &[Tag] {
        let Some(comment) = self.comments.get(comment) else {
            return &[];
        };
        let first = comment.first_tag as usize;
        self.tags
            .get(first..first + comment.tag_count as usize)
            .unwrap_or_default()
    }
}

/// A `JSDocLink`, `JSDocLinkCode` or `JSDocLinkPlain` that has a name.
pub(super) struct Link<'a> {
    /// `a.b`. A missing name is empty.
    pub(super) name: Vec<Cow<'a, [u8]>>,
    /// The position of the tag whose comment it is in, if that tag is nested in another tag and so
    /// is not among `jsdoc.Tags`.
    pub(super) nested_tag: Option<usize>,
}

/// `parseJSDocComment` for the comment of `source` from `start` to `end`: each `{@link a.b}`,
/// `{@linkcode a.b}` and `{@linkplain a.b}` that has a name.
pub(super) fn links<'a>(
    source: &'a [u8],
    start: usize,
    end: usize,
    is_stack_low: &'a dyn Fn() -> bool,
) -> Vec<Link<'a>> {
    let mut reader = Reader::new(source, start, end, Flavor::TypeScript, true, is_stack_low);
    reader.parse_jsdoc_comment_worker(start);
    reader.links
}

/// The tags of the comment of `source` from `start` to `end`, by TypeScript.
pub(super) fn tags(
    source: &[u8],
    start: usize,
    end: usize,
    is_stack_low: &dyn Fn() -> bool,
) -> SmallVec<[Tag; 8]> {
    let mut reader = Reader::new(source, start, end, Flavor::TypeScript, false, is_stack_low);
    reader.parse_jsdoc_comment_worker(start);
    reader.tags
}

/// The position of the bracket that closes the brackets around `from`, or the end of `text`. Brackets in strings and comments count
/// as well.
pub(super) fn closing_bracket_after(text: &[u8], from: usize) -> u32 {
    let mut depth = 0u32;
    for (i, &c) in text.iter().enumerate().skip(from) {
        match c {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return i as u32,
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
    }
    text.len() as u32
}

/// `parseTag`: whether the parser of the tag `name` takes a `{` that follows the name, as
/// `tryParseTypeExpression`, `parseJSDocTypeExpression`,
/// `parseExpressionWithTypeArgumentsForAugments` and `tryParseImportClause` do.
fn jsdoc_tag_takes_brace(name: &[u8]) -> bool {
    matches!(
        name,
        b"implements"
            | b"augments"
            | b"extends"
            | b"this"
            | b"return"
            | b"returns"
            | b"template"
            | b"type"
            | b"satisfies"
            | b"exception"
            | b"throws"
            | b"import"
    )
}

/// The tokens that the parser of JSDoc comments has to tell apart to find the tags and the links.
#[derive(Copy, Clone, PartialEq, Eq)]
enum JSDocToken {
    EndOfFile,
    WhitespaceTrivia,
    NewLineTrivia,
    /// `KindJSDocCommentTextToken`
    CommentText,
    At,
    Asterisk,
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    Equals,
    Dot,
    Backtick,
    /// `tokenIsIdentifierOrKeyword`
    Identifier,
    PrivateIdentifier,
    Other,
}

/// `jsdocState`
#[derive(Copy, Clone, PartialEq, Eq)]
enum JSDocState {
    BeginningOfLine,
    SawAsterisk,
    SavingComments,
    SavingBackticks,
}

impl JSDocState {
    fn saving(in_backticks: bool) -> JSDocState {
        if in_backticks {
            JSDocState::SavingBackticks
        } else {
            JSDocState::SavingComments
        }
    }

    fn is_saving(self) -> bool {
        matches!(
            self,
            JSDocState::SavingComments | JSDocState::SavingBackticks
        )
    }

    /// The state after a backtick.
    fn toggle_backticks(self) -> JSDocState {
        JSDocState::saving(self != JSDocState::SavingBackticks)
    }
}

/// `ScannerState`
#[derive(Copy, Clone)]
struct JSDocScannerState {
    token: JSDocToken,
    /// `TokenFullStart`
    full_start: usize,
    /// `TokenStart`
    start: usize,
    /// `TokenEnd`
    pos: usize,
    /// `HasPrecedingLineBreak`
    has_preceding_line_break: bool,
}

/// What is kept of a `JSDocTypeExpression`.
#[derive(Copy, Clone)]
struct JSDocTypeExpression {
    /// `isObjectOrObjectArrayTypeReference(node.Type())`
    is_object_or_object_array: bool,
    /// `node.End()`
    end: usize,
}

/// What `tryParseChildTag` returns.
enum JSDocChildTag<'a> {
    /// `JSDocParameterTag`, `JSDocPropertyTag`: `node.Name()`.
    ParameterOrProperty(Vec<Cow<'a, [u8]>>),
    /// `JSDocTypeTag`: its type, if that is in braces.
    Type(Option<JSDocTypeExpression>),
    /// `JSDocTemplateTag`, `JSDocThisTag`
    Other,
}

/// `propertyLikeParse`
const PROPERTY: u8 = 1;
const PARAMETER: u8 = 2;
const CALLBACK_PARAMETER: u8 = 4;

/// `isObjectOrObjectArrayTypeReference` for the type that `text` starts with: a type expression
/// without its `{`.
fn is_object_or_object_array_type_reference(text: &[u8]) -> bool {
    // `Scan` with `skipJSDocLeadingAsterisks`: the start and the end of the token after `at`.
    let token_after = |at: usize| {
        let mut start = skip_trivia(text, at);
        if text.get(start) == Some(&b'*')
            && (at..start).any(|i| super::spans::line_break_len(text, i) != 0)
        {
            start = skip_trivia(text, start + 1);
        }
        (start, token_end(text, start, false))
    };
    let (start, mut end) = token_after(0);
    if !matches!(&text[start..end], b"Object" | b"object") {
        return false;
    }
    // `parsePostfixTypeOrHigher`
    loop {
        let (open, after_open) = token_after(end);
        let (close, after_close) = token_after(after_open);
        match (text.get(open), text.get(close)) {
            (None | Some(b'}'), _) => return true,
            (Some(b'['), Some(b']')) => end = after_close,
            _ => return false,
        }
    }
}

/// What oxc_jsdoc knows at a position of a comment: `parse_jsdoc`, without the split. Its parentheses and square brackets are
/// not here. They are forgotten at each `\n`, and only blanks and `*` are between a `\n` and a tag.
struct LineStartRule {
    /// Up to where it has read.
    seen: usize,
    curly_brace_depth: u32,
    /// How many backticks have opened the code that this is in.
    backtick_count: usize,
    /// `"`, `'` or 0.
    quote: u8,
    at_line_start: bool,
    line_seen_star: bool,
    spaces_after_star: u32,
}

impl LineStartRule {
    /// `at`: behind the `/**`.
    fn new(at: usize) -> Self {
        LineStartRule {
            seen: at,
            curly_brace_depth: 0,
            backtick_count: 0,
            quote: 0,
            at_line_start: true,
            line_seen_star: false,
            spaces_after_star: 0,
        }
    }

    fn advance(&mut self, text: &[u8], upto: usize) {
        while self.seen < upto {
            let Some(&byte) = text.get(self.seen) else {
                return;
            };
            let is_plain = self.backtick_count == 0 && self.quote == 0;
            let mut len = 1;
            match byte {
                b'`' if self.quote == 0 => {
                    let run = text[self.seen..].iter().take_while(|&&next| next == b'`');
                    len = run.count();
                    if self.backtick_count == 0 {
                        self.backtick_count = len;
                    } else if self.backtick_count == len {
                        self.backtick_count = 0;
                    }
                }
                b'"' | b'\'' if is_plain => self.quote = byte,
                b'"' | b'\'' if self.quote == byte => self.quote = 0,
                b'\n' => self.quote = 0,
                b'{' if is_plain => {
                    self.curly_brace_depth = self.curly_brace_depth.saturating_add(1);
                }
                b'}' if is_plain => {
                    self.curly_brace_depth = self.curly_brace_depth.saturating_sub(1);
                }
                _ => {}
            }
            if byte == b'\n' {
                self.at_line_start = true;
                self.line_seen_star = false;
                self.spaces_after_star = 0;
            } else if self.at_line_start {
                match byte {
                    b'*' => {
                        self.line_seen_star = true;
                        self.spaces_after_star = 0;
                    }
                    b' ' | b'\t' | b'\r' => {
                        let blanks = u32::from(self.line_seen_star);
                        self.spaces_after_star = self.spaces_after_star.saturating_add(blanks);
                    }
                    _ => self.at_line_start = false,
                }
            }
            self.seen += len;
        }
    }

    fn allows_tag(&self) -> bool {
        self.at_line_start
            && self.curly_brace_depth == 0
            && self.backtick_count == 0
            && !(self.line_seen_star && self.spaces_after_star >= 5)
    }
}

/// `find_token_range` of oxc_jsdoc: where the first word of `text` is. A `{` ends it as well: `@kind{type}`.
fn find_token_range(text: &[u8]) -> Option<std::ops::Range<usize>> {
    let mut start = None;
    let mut index = 0;
    while index < text.len() {
        let (c, len) = bstr::decode_utf8(&text[index..]);
        if c.is_some_and(|c| c.is_whitespace() || c == '{') {
            if let Some(start) = start {
                return Some(start..index);
            }
        } else {
            start.get_or_insert(index);
        }
        index += len;
    }
    start.map(|start| start..text.len())
}

/// `find_type_range`: where the `{...}` is that `text` starts with, after white space.
fn find_type_range(text: &[u8]) -> Option<std::ops::Range<usize>> {
    let trimmed = text.trim_start_with(char::is_whitespace);
    if !trimmed.starts_with(b"{") {
        return None;
    }
    let offset = text.len() - trimmed.len();
    let mut brace_count = 0usize;
    for (index, &byte) in trimmed.iter().enumerate() {
        match byte {
            b'{' => brace_count += 1,
            b'}' if brace_count == 1 => return Some(offset..offset + index + 1),
            b'}' => brace_count -= 1,
            _ => {}
        }
    }
    None
}

/// `find_type_name_range`: like a token, but there can be white space in `[name = default]`.
fn find_type_name_range(text: &[u8]) -> Option<std::ops::Range<usize>> {
    if !text.trim_start_with(char::is_whitespace).starts_with(b"[") {
        return find_token_range(text);
    }
    let mut bracket = 0i32;
    let mut start = None;
    let mut index = 0;
    while index < text.len() {
        let (c, len) = bstr::decode_utf8(&text[index..]);
        if c.is_some_and(char::is_whitespace) {
            if bracket == 0
                && let Some(start) = start
            {
                return Some(start..index);
            }
        } else {
            match c {
                Some('[') => bracket = bracket.saturating_add(1),
                Some(']') => bracket = bracket.saturating_sub(1),
                _ => {}
            }
            start.get_or_insert(index);
        }
        index += len;
    }
    start
        .filter(|_| bracket == 0)
        .map(|start| start..text.len())
}

/// `mark`
#[derive(Copy, Clone)]
struct Mark {
    scanner: JSDocScannerState,
    links: usize,
    tags: usize,
}

/// `textsEqual(parent, child.AsQualifiedName().Left)`
fn is_property_of(child: &[Cow<'_, [u8]>], parent: &[Cow<'_, [u8]>]) -> bool {
    child.split_last().is_some_and(|(_, left)| left == parent)
}

/// The part of jsdoc.go, of TypeScript's parser, that finds the tags and the links in a JSDoc comment.
struct Reader<'a> {
    flavor: Flavor,
    /// `links` is filled and `tags` is not. Otherwise it is the other way round.
    keeps_links: bool,
    /// `Checker::is_stack_low`
    is_stack_low: &'a dyn Fn() -> bool,
    /// See `is_too_deep`.
    is_out_of_stack: bool,
    /// The source, up to the `*/` of the comment.
    text: &'a [u8],
    scanner: JSDocScannerState,
    links: Vec<Link<'a>>,
    /// `Link::nested_tag` of the links in the comment of the tag that is being parsed.
    nested_tag: Option<usize>,
    /// A tag is before the tags that are in it.
    tags: SmallVec<[Tag; 8]>,
    /// The index in `tags` of the tag that is being parsed.
    row: usize,
    /// `Tag::depth` of the next tag.
    depth: u8,
    /// Where a search of `parse_child_parameter_or_property_tag` has started, and the `@` or the end that it has found.
    /// A `@type` in a `@typedef` leaves its text to that search, which goes past tags that are not first on their line: in a
    /// line of `@typedef T @type {X} text` each would go to the end of the line.
    child_search: Option<(usize, usize)>,
    /// For `Flavor::Oxc`.
    rule: LineStartRule,
}

impl<'a> Reader<'a> {
    /// For the comment of `source` from `start` to `end`.
    fn new(
        source: &'a [u8],
        start: usize,
        end: usize,
        flavor: Flavor,
        keeps_links: bool,
        is_stack_low: &'a dyn Fn() -> bool,
    ) -> Self {
        Reader {
            flavor,
            keeps_links,
            is_stack_low,
            is_out_of_stack: false,
            text: source.get(..end.saturating_sub(2)).unwrap_or_default(),
            scanner: JSDocScannerState {
                token: JSDocToken::Other,
                full_start: start + 3,
                start: start + 3,
                pos: start + 3,
                has_preceding_line_break: false,
            },
            links: Vec::new(),
            nested_tag: None,
            tags: SmallVec::new(),
            row: 0,
            depth: 0,
            child_search: None,
            rule: LineStartRule::new(start + 3),
        }
    }

    /// Whether a tag is not to be parsed inside another one. Every cycle of calls in this parser goes through
    /// `try_parse_child_tag`, one level for each tag of `@param {Object} a`, `@param {Object} a.b`, `@param {Object} a.b.c`.
    /// Once the stack has been low, each further tag of the comment would get as deep again.
    fn is_too_deep(&mut self) -> bool {
        self.is_out_of_stack |= (self.is_stack_low)();
        self.is_out_of_stack
    }

    /// `nextTokenJSDoc`, `ScanJSDocToken`
    fn next_token_jsdoc(&mut self) -> JSDocToken {
        let (text, start) = (self.text, self.scanner.pos);
        let mut pos = start + 1;
        let token = match text.get(start) {
            None => {
                pos = start;
                JSDocToken::EndOfFile
            }
            Some(b'\t' | 0x0B | 0x0C | b' ') => {
                pos = lexer::end_of_run(text, pos, lexer::is_white_space_single_line);
                JSDocToken::WhitespaceTrivia
            }
            Some(b'@') => JSDocToken::At,
            Some(b'\r') if text.get(pos) == Some(&b'\n') => {
                pos += 1;
                JSDocToken::NewLineTrivia
            }
            Some(b'\r' | b'\n') => JSDocToken::NewLineTrivia,
            Some(b'*') => JSDocToken::Asterisk,
            Some(b'{') => JSDocToken::OpenBrace,
            Some(b'}') => JSDocToken::CloseBrace,
            Some(b'[') => JSDocToken::OpenBracket,
            Some(b']') => JSDocToken::CloseBracket,
            Some(b'=') => JSDocToken::Equals,
            Some(b'.') => JSDocToken::Dot,
            Some(b'`') => JSDocToken::Backtick,
            Some(b'\\') => match lexer::peek_unicode_escape(text, start) {
                Some((escaped, len)) if lexer::is_identifier_start(escaped as u32) => {
                    pos = lexer::scan_identifier_parts(text, start + len);
                    JSDocToken::Identifier
                }
                _ => JSDocToken::Other,
            },
            Some(_) => {
                let (ch, size) = lexer::char_and_size(text, start);
                pos = start + size;
                if lexer::is_identifier_start(ch as u32) {
                    let is_part =
                        |ch: i32| lexer::is_identifier_part(ch as u32) || ch == i32::from(b'-');
                    pos = lexer::end_of_run(text, pos, is_part);
                    if text.get(pos) == Some(&b'\\') {
                        pos = lexer::scan_identifier_parts(text, pos);
                    }
                    JSDocToken::Identifier
                } else {
                    JSDocToken::Other
                }
            }
        };
        self.scanner = JSDocScannerState {
            token,
            full_start: start,
            start,
            pos,
            has_preceding_line_break: token == JSDocToken::NewLineTrivia,
        };
        token
    }

    /// `nextJSDocCommentTextToken`, `ScanJSDocCommentTextToken`
    fn next_jsdoc_comment_text_token(&mut self, in_backticks: bool) -> JSDocToken {
        let (text, start) = (self.text, self.scanner.pos);
        let is_oxc = self.flavor == Flavor::Oxc;
        let mut pos = start;
        while let Some(&ch) = text.get(pos) {
            if ch == b'`' || lexer::starts_with_line_break(&text[pos..]) {
                break;
            }
            // `starts_tag` is asked about each.
            if ch == b'@' && is_oxc {
                break;
            }
            if !in_backticks {
                if ch == b'{' {
                    break;
                }
                // "@ doesn't start a new tag inside ``, and elsewhere, only after whitespace and
                // before identifier"
                if ch == b'@'
                    && lexer::is_white_space_single_line(lexer::last_char(&text[..pos]).0)
                    && lexer::is_identifier_start(lexer::char_and_size(text, pos + 1).0 as u32)
                {
                    break;
                }
            }
            pos += 1;
        }
        if pos == start {
            return self.next_token_jsdoc();
        }
        self.scanner = JSDocScannerState {
            token: JSDocToken::CommentText,
            full_start: start,
            start,
            pos,
            has_preceding_line_break: false,
        };
        JSDocToken::CommentText
    }

    /// `CanFollowJSDocAt`
    fn can_follow_jsdoc_at(&self) -> bool {
        let (ch, size) = lexer::char_and_size(self.text, self.scanner.pos);
        size == 0
            || lexer::is_identifier_start(ch as u32)
            || lexer::is_white_space_single_line(ch)
            || lexer::starts_with_line_break(&self.text[self.scanner.pos..])
    }

    /// Whether the current token, an `@`, starts a tag.
    fn starts_tag(&mut self, in_fenced_code_block: bool) -> bool {
        match self.flavor {
            Flavor::TypeScript => !in_fenced_code_block && self.can_follow_jsdoc_at(),
            Flavor::Oxc => {
                self.rule.advance(self.text, self.scanner.start);
                self.rule.allows_tag()
            }
        }
    }

    /// `nextToken`, `Scan`
    fn next_token(&mut self) -> JSDocToken {
        let (text, full_start) = (self.text, self.scanner.pos);
        let start = skip_trivia(text, full_start);
        let pos = token_end(text, start, false);
        let token = match text.get(start) {
            None => JSDocToken::EndOfFile,
            Some(b'@') => JSDocToken::At,
            Some(b'{') => JSDocToken::OpenBrace,
            Some(b'}') => JSDocToken::CloseBrace,
            Some(b'[') => JSDocToken::OpenBracket,
            Some(b']') => JSDocToken::CloseBracket,
            Some(b'*') if pos == start + 1 => JSDocToken::Asterisk,
            Some(b'=') if pos == start + 1 => JSDocToken::Equals,
            Some(b'.') if pos == start + 1 => JSDocToken::Dot,
            Some(b'#') if text.get(start + 1) != Some(&b'!') => JSDocToken::PrivateIdentifier,
            Some(b'0'..=b'9') => JSDocToken::Other,
            Some(_) if super::spans::identifier_end(text, start) > start => JSDocToken::Identifier,
            Some(_) => JSDocToken::Other,
        };
        self.scanner = JSDocScannerState {
            token,
            full_start,
            start,
            pos,
            has_preceding_line_break: (full_start..start)
                .any(|at| super::spans::line_break_len(text, at) != 0),
        };
        token
    }

    /// `ResetPos`
    fn reset_pos(&mut self, pos: usize) {
        self.scanner.full_start = pos;
        self.scanner.start = pos;
        self.scanner.pos = pos;
    }

    /// `TokenValue` of an identifier.
    fn token_value(&self) -> Cow<'a, [u8]> {
        super::spans::unescaped_identifier(&self.text[self.scanner.start..self.scanner.pos])
    }

    /// `mark`
    fn mark(&self) -> Mark {
        Mark {
            scanner: self.scanner,
            links: self.links.len(),
            tags: self.tags.len(),
        }
    }

    /// `rewind`
    fn rewind(&mut self, state: Mark) {
        self.scanner = state.scanner;
        self.links.truncate(state.links);
        self.tags.truncate(state.tags);
    }

    /// Starts the tag whose `@` is at `at`. Returns `row` of the tag that it is in, for `close_row`.
    fn open_row(&mut self, at: usize) -> usize {
        let outer = std::mem::replace(&mut self.row, self.tags.len());
        if !self.keeps_links {
            self.tags.push(Tag {
                at: at as u32,
                name_end: at as u32 + 1,
                ty: Range::NONE,
                name: Range::NONE,
                default: Range::NONE,
                text: 0,
                end: 0,
                depth: self.depth,
            });
        }
        outer
    }

    /// The tag ends before the current token.
    fn close_row(&mut self, outer: usize) {
        if let Some(row) = self.tags.get_mut(self.row) {
            row.end = self.scanner.full_start as u32;
        }
        self.row = outer;
    }

    /// `parseOptional`
    fn parse_optional(&mut self, token: JSDocToken) -> bool {
        let is_next = self.scanner.token == token;
        if is_next {
            self.next_token();
        }
        is_next
    }

    /// `parseOptionalJsdoc`
    fn parse_optional_jsdoc(&mut self, token: JSDocToken) -> bool {
        let is_next = self.scanner.token == token;
        if is_next {
            self.next_token_jsdoc();
        }
        is_next
    }

    /// `parseJSDocCommentWorker` for the comment that starts at `start`.
    fn parse_jsdoc_comment_worker(&mut self, start: usize) {
        // "initial indent is start+4 to account for leading `/** `". oxc_jsdoc has no margins.
        let mut indent = match self.flavor {
            Flavor::TypeScript => {
                let before = self.text.get(..start).unwrap_or_default();
                start + 4 - strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1)
            }
            Flavor::Oxc => 0,
        };
        let mut state = JSDocState::SawAsterisk;
        let mut backtick_count = 0;
        let mut in_fenced_code_block = false;
        self.next_token_jsdoc();
        while self.parse_optional_jsdoc(JSDocToken::WhitespaceTrivia) {}
        if self.parse_optional_jsdoc(JSDocToken::NewLineTrivia) {
            state = JSDocState::BeginningOfLine;
            indent = 0;
        }
        loop {
            // "Three or more consecutive backticks toggle the fenced code block state."
            if self.scanner.token != JSDocToken::Backtick && backtick_count > 0 {
                in_fenced_code_block ^= backtick_count >= 3;
                backtick_count = 0;
            }
            let token_len = self.scanner.pos - self.scanner.start;
            let token = self.scanner.token;
            match token {
                JSDocToken::At if self.starts_tag(in_fenced_code_block) => {
                    self.parse_tag(indent);
                    state = JSDocState::BeginningOfLine;
                }
                JSDocToken::NewLineTrivia => {
                    state = JSDocState::BeginningOfLine;
                    indent = 0;
                }
                // "Ignore the first asterisk on a line"
                JSDocToken::Asterisk if state != JSDocState::SawAsterisk => {
                    state = JSDocState::SawAsterisk;
                    indent += token_len;
                }
                JSDocToken::WhitespaceTrivia => indent += token_len,
                JSDocToken::EndOfFile => break,
                JSDocToken::Backtick => {
                    backtick_count += 1;
                    state = state.toggle_backticks();
                    indent += token_len;
                }
                JSDocToken::OpenBrace if self.can_start_link(in_fenced_code_block) => {
                    state = JSDocState::SavingComments;
                    if !self.parse_jsdoc_link() {
                        indent += token_len;
                    }
                }
                JSDocToken::Asterisk => {
                    state = JSDocState::SavingComments;
                    indent += token_len;
                }
                JSDocToken::At | JSDocToken::OpenBrace => {
                    state = JSDocState::saving(in_fenced_code_block);
                    indent += token_len;
                }
                _ => {
                    if state != JSDocState::SavingBackticks {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                    indent += token_len;
                }
            }
            if state.is_saving() {
                self.next_jsdoc_comment_text_token(state == JSDocState::SavingBackticks);
            } else {
                self.next_token_jsdoc();
            }
        }
    }

    /// Whether only white space follows, which `skipWhitespace` and `skipWhitespaceOrAsterisk` do
    /// not skip: `isNextNonwhitespaceTokenEndOfFile`.
    fn is_at_trailing_whitespace(&mut self) -> bool {
        let state = self.scanner;
        let mut token = state.token;
        while matches!(
            token,
            JSDocToken::WhitespaceTrivia | JSDocToken::NewLineTrivia
        ) {
            token = self.next_token_jsdoc();
        }
        self.scanner = state;
        token == JSDocToken::EndOfFile
    }

    /// `skipWhitespace`
    fn skip_whitespace(&mut self) {
        if self.is_at_trailing_whitespace() {
            return;
        }
        while matches!(
            self.scanner.token,
            JSDocToken::WhitespaceTrivia | JSDocToken::NewLineTrivia
        ) {
            self.next_token_jsdoc();
        }
    }

    /// `skipWhitespaceOrAsterisk`. Returns the length of the indentation after the last line break.
    fn skip_whitespace_or_asterisk(&mut self) -> usize {
        if self.is_at_trailing_whitespace() {
            return 0;
        }
        let mut preceding_line_break = self.scanner.has_preceding_line_break;
        let mut seen_line_break = false;
        let mut indent = 0;
        loop {
            match self.scanner.token {
                JSDocToken::Asterisk if preceding_line_break => {
                    preceding_line_break = false;
                    indent += 1;
                }
                JSDocToken::WhitespaceTrivia => indent += self.scanner.pos - self.scanner.start,
                JSDocToken::NewLineTrivia => {
                    preceding_line_break = true;
                    seen_line_break = true;
                    indent = 0;
                }
                _ => break,
            }
            self.next_token_jsdoc();
        }
        if seen_line_break { indent } else { 0 }
    }

    /// `parseTag`. Returns whether it is a `JSDocReturnTag`.
    fn parse_tag(&mut self, margin: usize) -> bool {
        let start = self.scanner.start;
        let outer = self.open_row(start);
        if self.flavor == Flavor::Oxc {
            self.parse_tag_of_oxc(start);
            self.close_row(outer);
            return false;
        }
        self.next_token_jsdoc();
        let tag_name = self.parse_tag_name();
        let indent_text = self.skip_whitespace_or_asterisk();
        match &*tag_name {
            b"arg" | b"argument" | b"param" => {
                self.parse_parameter_or_property_tag(start, PARAMETER, margin, None);
            }
            b"typedef" => self.parse_typedef_tag(start, margin, indent_text),
            b"callback" => self.parse_callback_tag(start, margin, indent_text),
            b"overload" => self.parse_overload_tag(start, margin, indent_text),
            _ => self.parse_tag_without_children(start, &tag_name, margin, indent_text),
        }
        self.close_row(outer);
        matches!(&*tag_name, b"return" | b"returns")
    }

    /// `parse_jsdoc_tag` of oxc_jsdoc for the tag whose `@` is at `at`, and what its `type_name_comment` finds in the tag.
    fn parse_tag_of_oxc(&mut self, at: usize) {
        let text = self.text;
        let written = |from: usize, to: usize| text.get(from..to).unwrap_or_default();
        let name_end = at + find_token_range(written(at, text.len())).map_or(1, |name| name.end);
        self.reset_pos(name_end);
        self.next_token_jsdoc();
        self.parse_tag_comments(0, None);
        let end = self.scanner.full_start;
        let found_from = |from: usize, found: Option<std::ops::Range<usize>>| {
            found.map_or(Range::NONE, |found| {
                Range::new((from + found.start) as u32, (from + found.end) as u32)
            })
        };
        let ty = found_from(name_end, find_type_range(written(name_end, end)));
        let after_type = if ty.is_some() {
            ty.end as usize
        } else {
            name_end
        };
        let name = found_from(after_type, find_type_name_range(written(after_type, end)));
        let name_text = written(name.start as usize, name.end as usize);
        let default = match strings::index_of_char(name_text, b'=') {
            Some(equals) if name_text.starts_with(b"[") && name_text.ends_with(b"]") => {
                Range::new(name.start + equals + 1, name.end - 1)
            }
            _ => Range::NONE,
        };
        if let Some(row) = self.tags.get_mut(self.row) {
            row.name_end = name_end as u32;
            row.ty = ty;
            row.name = name;
            row.default = default;
            row.text = if name.is_some() {
                name.end
            } else {
                after_type as u32
            };
        }
    }

    /// The name of a tag, behind its `@`.
    fn parse_tag_name(&mut self) -> Cow<'a, [u8]> {
        if self.scanner.token == JSDocToken::Identifier
            && let Some(row) = self.tags.get_mut(self.row)
        {
            row.name_end = self.scanner.pos as u32;
        }
        self.parse_jsdoc_identifier_name()
    }

    /// The parsers of the tags that have no tags nested in them. Of their syntax, only a type in
    /// braces right after the name is passed over. The rest is read as the comment.
    fn parse_tag_without_children(
        &mut self,
        start: usize,
        tag_name: &[u8],
        margin: usize,
        indent_text: usize,
    ) {
        if self.scanner.token == JSDocToken::OpenBrace && jsdoc_tag_takes_brace(tag_name) {
            self.parse_jsdoc_type_expression();
        }
        self.parse_trailing_tag_comments(start, self.scanner.full_start, margin, indent_text);
    }

    /// `parseJSDocIdentifierName`. A missing name is empty.
    fn parse_jsdoc_identifier_name(&mut self) -> Cow<'a, [u8]> {
        if self.scanner.token != JSDocToken::Identifier {
            return Cow::default();
        }
        let text = self.token_value();
        self.next_token_jsdoc();
        text
    }

    /// `parseJSDocEntityName`
    fn parse_jsdoc_entity_name(&mut self) -> Vec<Cow<'a, [u8]>> {
        let mut entity = Vec::new();
        loop {
            entity.push(self.parse_jsdoc_identifier_name());
            // "Note that y[] is accepted as an entity name"
            if self.parse_optional(JSDocToken::OpenBracket) {
                self.parse_optional(JSDocToken::CloseBracket);
            }
            if !self.parse_optional(JSDocToken::Dot) {
                return entity;
            }
        }
    }

    /// `parseJSDocTypeExpression` at a `{`. The type is passed over, not parsed.
    fn parse_jsdoc_type_expression(&mut self) -> JSDocTypeExpression {
        let (open, inside) = (self.scanner.start, self.scanner.pos);
        // No type starts with `@`, and `parseTagComments` ends at it: it starts a tag.
        let end = match self.text.get(inside) {
            Some(b'@') => inside,
            _ => (closing_bracket_after(self.text, inside) as usize + 1).min(self.text.len()),
        };
        self.reset_pos(end);
        self.next_token_jsdoc();
        if end > inside
            && let Some(row) = self.tags.get_mut(self.row)
            && row.ty.is_none()
        {
            row.ty = Range::new(open as u32, end as u32);
        }
        let written = &self.text[inside..end];
        JSDocTypeExpression {
            is_object_or_object_array: is_object_or_object_array_type_reference(written),
            end,
        }
    }

    /// `tryParseTypeExpression`
    fn try_parse_type_expression(&mut self) -> Option<JSDocTypeExpression> {
        self.skip_whitespace_or_asterisk();
        (self.scanner.token == JSDocToken::OpenBrace).then(|| self.parse_jsdoc_type_expression())
    }

    /// `parseBracketNameInPropertyAndParamTag`
    fn parse_bracket_name_in_property_and_param_tag(&mut self) -> Vec<Cow<'a, [u8]>> {
        let open = self.scanner.start;
        let is_bracketed = self.parse_optional_jsdoc(JSDocToken::OpenBracket);
        if is_bracketed {
            self.skip_whitespace();
        }
        let is_backquoted = self.parse_optional_jsdoc(JSDocToken::Backtick);
        let name = self.parse_jsdoc_entity_name();
        if is_backquoted {
            self.parse_optional(JSDocToken::Backtick);
        }
        if is_bracketed {
            self.skip_whitespace();
            // "May have an optional default, e.g. '[foo = 42]'". It is passed over, not parsed.
            if self.scanner.token == JSDocToken::Equals {
                let after = end_of_brackets(self.text, open);
                let close = after.map_or(self.text.len(), |after| after - 1);
                if let Some(row) = self.tags.get_mut(self.row) {
                    row.default = Range::new(self.scanner.pos as u32, close as u32);
                }
                self.reset_pos(close);
                self.next_token();
            }
            self.parse_optional(JSDocToken::CloseBracket);
        }
        self.set_name_from(open);
        name
    }

    /// `Tag::name` is from `start` to the current token.
    fn set_name_from(&mut self, start: usize) {
        if self.scanner.full_start > start
            && let Some(row) = self.tags.get_mut(self.row)
        {
            row.name = Range::new(start as u32, self.scanner.full_start as u32);
        }
    }

    /// `parseParameterOrPropertyTag`, `parseNestedTypeLiteral`. Returns `node.Name()`.
    /// `parent`: see `parse_child_parameter_or_property_tag`.
    fn parse_parameter_or_property_tag(
        &mut self,
        start: usize,
        target: u8,
        indent: usize,
        parent: Option<&[Cow<'a, [u8]>]>,
    ) -> Vec<Cow<'a, [u8]>> {
        let mut type_expression = self.try_parse_type_expression();
        self.skip_whitespace_or_asterisk();
        let name = self.parse_bracket_name_in_property_and_param_tag();
        // The caller rewinds. jsdoc.go reads on, and tries each tag that follows as a child of this one.
        if parent.is_some_and(|parent| !is_property_of(&name, parent)) {
            return name;
        }
        let indent_text = self.skip_whitespace_or_asterisk();
        if type_expression.is_none() {
            let state = self.scanner;
            let is_at_link = self.parse_jsdoc_link_prefix();
            self.scanner = state;
            if !is_at_link {
                type_expression = self.try_parse_type_expression();
            }
        }
        self.parse_trailing_tag_comments(start, self.scanner.full_start, indent, indent_text);
        if type_expression.is_some_and(|it| it.is_object_or_object_array) {
            while self
                .parse_child_parameter_or_property_tag(target, indent, Some(&name))
                .is_some()
            {}
        }
        name
    }

    /// `parseJSDocTypeNameWithNamespace`, or a missing name.
    fn parse_jsdoc_type_name_with_namespace(&mut self) {
        let start = self.scanner.start;
        while self.scanner.token == JSDocToken::Identifier {
            self.next_token_jsdoc();
            if !self.parse_optional_jsdoc(JSDocToken::Dot) {
                break;
            }
        }
        self.set_name_from(start);
    }

    /// `parseTypedefTag`
    fn parse_typedef_tag(&mut self, start: usize, indent: usize, indent_text: usize) {
        let type_expression = self.try_parse_type_expression();
        self.skip_whitespace_or_asterisk();
        self.parse_jsdoc_type_name_with_namespace();
        // `fullName.End()`
        let mut end = self.scanner.full_start;
        self.skip_whitespace();
        let has_comment = self.parse_tag_comments(indent, None);
        if type_expression.is_none_or(|it| it.is_object_or_object_array) {
            let mut has_children = false;
            let mut child_type_tag = None;
            while let Some(child) =
                self.parse_child_parameter_or_property_tag(PROPERTY, indent, None)
            {
                has_children = true;
                if let JSDocChildTag::Type(Some(written)) = child {
                    child_type_tag.get_or_insert(written);
                }
            }
            // `typeExpression.End()`
            if has_children {
                end = match child_type_tag {
                    Some(written) if !written.is_object_or_object_array => written.end,
                    _ => self.scanner.full_start,
                };
            }
        }
        if !has_comment {
            self.parse_trailing_tag_comments(start, end, indent, indent_text);
        }
    }

    /// `parseJSDocSignature`, `parseCallbackTagParameters`
    fn parse_jsdoc_signature(&mut self, indent: usize) {
        while self
            .parse_child_parameter_or_property_tag(CALLBACK_PARAMETER, indent, None)
            .is_some()
        {}
        let state = self.mark();
        let outer = self.nested_tag.replace(self.scanner.start);
        let depth = self.depth;
        self.depth = depth.saturating_add(1);
        if !(self.parse_optional_jsdoc(JSDocToken::At)
            && self.scanner.token == JSDocToken::At
            && self.is_at_return_tag()
            && self.parse_tag(indent))
        {
            self.rewind(state);
        }
        self.depth = depth;
        self.nested_tag = outer;
    }

    /// Whether the current token, an `@`, starts a `JSDocReturnTag`. jsdoc.go reads the tag, whatever it is, and rewinds if it
    /// is another: in a run of `@overload` each reads all that follow.
    fn is_at_return_tag(&mut self) -> bool {
        let state = self.scanner;
        let is_return = self.next_token_jsdoc() == JSDocToken::Identifier
            && matches!(&*self.token_value(), b"return" | b"returns");
        self.scanner = state;
        is_return
    }

    /// `parseCallbackTag`, which goes on like `parseOverloadTag` after the name.
    fn parse_callback_tag(&mut self, start: usize, indent: usize, indent_text: usize) {
        self.parse_jsdoc_type_name_with_namespace();
        self.parse_overload_tag(start, indent, indent_text);
    }

    /// `parseOverloadTag`
    fn parse_overload_tag(&mut self, start: usize, indent: usize, indent_text: usize) {
        self.skip_whitespace();
        let has_comment = self.parse_tag_comments(indent, None);
        self.parse_jsdoc_signature(indent);
        if !has_comment {
            self.parse_trailing_tag_comments(start, self.scanner.full_start, indent, indent_text);
        }
    }

    /// `parseChildParameterOrPropertyTag`, and the `rewind` of its callers if there is none.
    /// `name`: of the tag that a `@param` or a `@property` has to name a property of.
    fn parse_child_parameter_or_property_tag(
        &mut self,
        target: u8,
        indent: usize,
        name: Option<&[Cow<'a, [u8]>]>,
    ) -> Option<JSDocChildTag<'a>> {
        let state = self.mark();
        let from = self.scanner.pos;
        let mut can_parse_tag = true;
        let mut seen_asterisk = false;
        let child = loop {
            let token = self.next_token_jsdoc();
            match token {
                JSDocToken::At if can_parse_tag && self.can_follow_jsdoc_at() => {
                    self.note_child_search(from);
                    break self.try_parse_child_tag(target, indent, name);
                }
                JSDocToken::At => seen_asterisk = false,
                JSDocToken::NewLineTrivia => {
                    can_parse_tag = true;
                    seen_asterisk = false;
                }
                JSDocToken::Asterisk => {
                    can_parse_tag &= !seen_asterisk;
                    seen_asterisk = true;
                }
                JSDocToken::Identifier => can_parse_tag = false,
                JSDocToken::EndOfFile => {
                    self.note_child_search(from);
                    break None;
                }
                _ => {}
            }
            // Nothing counts before the next line, and from there on this search is that one.
            if (token == JSDocToken::NewLineTrivia || !can_parse_tag)
                && let Some((searched_from, found)) = self.child_search
                && searched_from <= from
                && self.scanner.pos <= found
            {
                self.reset_pos(found);
                can_parse_tag = true;
                seen_asterisk = false;
            }
        };
        let child = child.filter(|child| match (child, name) {
            (JSDocChildTag::ParameterOrProperty(child), Some(name)) => is_property_of(child, name),
            _ => true,
        });
        if child.is_none() {
            self.rewind(state);
        }
        child
    }

    /// The search from `from` ends at the current token. The one that has got further is kept.
    fn note_child_search(&mut self, from: usize) {
        let found = self.scanner.start;
        if self.child_search.is_none_or(|(_, before)| before < found) {
            self.child_search = Some((from, found));
        }
    }

    /// `tryParseChildTag`. `name`: see `parse_child_parameter_or_property_tag`.
    fn try_parse_child_tag(
        &mut self,
        target: u8,
        indent: usize,
        name: Option<&[Cow<'a, [u8]>]>,
    ) -> Option<JSDocChildTag<'a>> {
        if self.is_too_deep() {
            return None;
        }
        let start = self.scanner.full_start;
        let depth = self.depth;
        self.depth = depth.saturating_add(1);
        let outer_row = self.open_row(start);
        self.next_token_jsdoc();
        let tag_name = self.parse_tag_name();
        let indent_text = self.skip_whitespace_or_asterisk();
        let fits = match &*tag_name {
            b"prop" | b"property" => PROPERTY,
            b"arg" | b"argument" | b"param" => PARAMETER | CALLBACK_PARAMETER,
            _ => 0,
        };
        let outer = self.nested_tag.replace(start);
        let child = match &*tag_name {
            // `parseTypeTag` without an indent leaves the comment to the `@typedef`.
            b"type" if target == PROPERTY => {
                Some(JSDocChildTag::Type(self.try_parse_type_expression()))
            }
            b"template" | b"this" => {
                self.parse_tag_without_children(start, &tag_name, indent, indent_text);
                Some(JSDocChildTag::Other)
            }
            _ if target & fits != 0 => Some(JSDocChildTag::ParameterOrProperty(
                self.parse_parameter_or_property_tag(start, target, indent, name),
            )),
            _ => None,
        };
        self.nested_tag = outer;
        self.close_row(outer_row);
        self.depth = depth;
        child
    }

    /// `parseTrailingTagComments` for the tag that starts at `start`. `indent_text`: the length of
    /// that text.
    fn parse_trailing_tag_comments(
        &mut self,
        start: usize,
        end: usize,
        mut margin: usize,
        indent_text: usize,
    ) {
        if indent_text == 0 {
            margin += end.saturating_sub(start);
        }
        self.parse_tag_comments(margin, Some(indent_text.saturating_sub(margin)));
    }

    /// `parseTagComments`. `initial_margin`: the length of that text. Returns whether there is a
    /// comment.
    fn parse_tag_comments(&mut self, mut indent: usize, initial_margin: Option<usize>) -> bool {
        let mut state = match initial_margin {
            Some(_) => JSDocState::SawAsterisk,
            None => JSDocState::BeginningOfLine,
        };
        let mut backtick_count = 0;
        let mut in_fenced_code_block = false;
        let mut margin = None;
        let mut has_comment = false;
        if let Some(row) = self.tags.get_mut(self.row) {
            row.text = self.scanner.full_start as u32;
        }
        if let Some(initial_margin @ 1..) = initial_margin {
            margin = Some(indent);
            indent += initial_margin;
        }
        loop {
            if self.scanner.token != JSDocToken::Backtick && backtick_count > 0 {
                in_fenced_code_block ^= backtick_count >= 3;
                backtick_count = 0;
            }
            let token_len = self.scanner.pos - self.scanner.start;
            // `pushComment`
            let mut is_pushed = true;
            let token = self.scanner.token;
            match token {
                JSDocToken::NewLineTrivia => {
                    state = JSDocState::BeginningOfLine;
                    indent = 0;
                    is_pushed = false;
                }
                JSDocToken::At if self.starts_tag(in_fenced_code_block) => {
                    self.reset_pos(self.scanner.pos - 1);
                    break;
                }
                JSDocToken::EndOfFile => break,
                JSDocToken::WhitespaceTrivia => {
                    // "if the whitespace crosses the margin, take only the whitespace that passes
                    // the margin"
                    if margin.is_some_and(|margin| indent + token_len > margin) {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                    indent += token_len;
                    is_pushed = false;
                }
                JSDocToken::OpenBrace if self.can_start_link(in_fenced_code_block) => {
                    state = JSDocState::SavingComments;
                    is_pushed = !self.parse_jsdoc_link();
                    has_comment |= !is_pushed;
                }
                JSDocToken::At | JSDocToken::OpenBrace => {
                    state = JSDocState::saving(in_fenced_code_block);
                }
                JSDocToken::Backtick => {
                    backtick_count += 1;
                    state = state.toggle_backticks();
                }
                // "leading asterisks start recording on the *next* (non-whitespace) token"
                JSDocToken::Asterisk if state == JSDocState::BeginningOfLine => {
                    state = JSDocState::SawAsterisk;
                    indent += 1;
                    is_pushed = false;
                }
                _ => {
                    if state != JSDocState::SavingBackticks {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                }
            }
            if is_pushed {
                margin.get_or_insert(indent);
                indent += token_len;
                // `removeTrailingWhitespace`
                let is_white_space = lexer::is_white_space_single_line;
                has_comment |= lexer::end_of_run(self.text, self.scanner.start, is_white_space)
                    < self.scanner.pos;
            }
            if state.is_saving() {
                self.next_jsdoc_comment_text_token(state == JSDocState::SavingBackticks);
            } else {
                self.next_token_jsdoc();
            }
        }
        has_comment
    }

    /// Whether `parse_jsdoc_link` is asked about a `{`. For oxc_jsdoc a link is text.
    fn can_start_link(&self, in_fenced_code_block: bool) -> bool {
        !in_fenced_code_block && self.flavor == Flavor::TypeScript
    }

    /// `parseJSDocLink`. Returns whether there is a link at the current token, a `{`.
    fn parse_jsdoc_link(&mut self) -> bool {
        let state = self.scanner;
        if !self.parse_jsdoc_link_prefix() {
            self.scanner = state;
            return false;
        }
        self.next_token_jsdoc();
        self.skip_whitespace();
        let name = self.parse_jsdoc_link_name();
        if self.keeps_links && !name.is_empty() {
            let nested_tag = self.nested_tag;
            self.links.push(Link { name, nested_tag });
        }
        while !matches!(
            self.scanner.token,
            JSDocToken::CloseBrace | JSDocToken::NewLineTrivia | JSDocToken::EndOfFile
        ) {
            self.next_token_jsdoc();
        }
        true
    }

    /// `parseJSDocLinkName`. Empty if there is none.
    fn parse_jsdoc_link_name(&mut self) -> Vec<Cow<'a, [u8]>> {
        let mut name = Vec::new();
        if self.scanner.token != JSDocToken::Identifier {
            return name;
        }
        name.push(self.parse_identifier_name());
        while self.scanner.token == JSDocToken::Dot {
            name.push(match self.next_token() {
                JSDocToken::PrivateIdentifier => Cow::default(),
                _ => self.parse_identifier_name(),
            });
        }
        while self.scanner.token == JSDocToken::PrivateIdentifier {
            // `ReScanHashToken`
            self.scanner.pos = self.scanner.start + 1;
            self.next_token_jsdoc();
            name.push(self.parse_identifier());
        }
        name
    }

    /// `parseIdentifier`, outside a `yield` and an `await` context. A reserved word is left where
    /// it is, and the name is missing.
    fn parse_identifier(&mut self) -> Cow<'a, [u8]> {
        if self.scanner.token == JSDocToken::Identifier
            && super::errors_declaration_emit::is_reserved_word(&self.token_value())
        {
            return Cow::default();
        }
        self.parse_identifier_name()
    }

    /// `parseIdentifierName`
    fn parse_identifier_name(&mut self) -> Cow<'a, [u8]> {
        if self.scanner.token != JSDocToken::Identifier {
            return Cow::default();
        }
        let text = self.token_value();
        self.next_token();
        text
    }

    /// `parseJSDocLinkPrefix`
    fn parse_jsdoc_link_prefix(&mut self) -> bool {
        self.skip_whitespace_or_asterisk();
        self.scanner.token == JSDocToken::OpenBrace
            && self.next_token_jsdoc() == JSDocToken::At
            && self.next_token_jsdoc() == JSDocToken::Identifier
            && matches!(&*self.token_value(), b"link" | b"linkcode" | b"linkplain")
    }
}
