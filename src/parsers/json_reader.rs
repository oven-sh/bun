//! The JSON / JSONC parser: one pass of recursive descent over the text into the immutable JSON AST
//! (`E::JsonTape` rows). White space is skipped where it is met, and a string is stepped through
//! with the kernel that the lexer of JavaScript reads its strings with.
//!
//! A *token* starts at a `{ } [ ] : ,`, at a quote, or at the first byte of a run of bytes that are
//! none of these, no ` \t\n\r` and in no comment. So a run can be `true`, `12`, `nul\u006c`, or white
//! space that is not ASCII with what follows it. `at` is always at the start of a token or at the end
//! of the text.
use bun_alloc::Arena as Bump;
use bun_ast::LexerLog;
use bun_ast::expr::Data;
use bun_ast::{E, Expr, Loc, Log, Range, Source};
use bun_core::StackCheck;
use bun_core::lexer as identifier;
use bun_core::strings;
use bun_core::strings::CodePoint;
use std::simd::cmp::{SimdPartialEq, SimdPartialOrd};
use std::simd::u8x16;

use crate::json::JSONOptions;
use crate::json_index::{IndexError, is_ls_ps};
use crate::json_stage2::is_exotic_whitespace;

type PResult<T = ()> = crate::Result<T>;

type DupMap = bun_collections::HashMap<u64, (), bun_collections::IdentityContext<u64>>;

pub(crate) struct Parser<'a, 's> {
    contents: &'s [u8],
    source: &'s Source,
    log: &'a mut Log,
    /// The start of the token that is looked at.
    at: usize,
    /// Where the white space and the comments before `at` start.
    gap_start: usize,
    /// The first comment that has been passed.
    pub(crate) first_comment: Option<Range>,
    /// What is wrong with a `/`. There are no tokens from there on.
    pub(crate) index_error: Option<IndexError>,
    opts: JSONOptions,
    is_json5: bool,
    /// Where the first token of a text of JSON5 starts.
    first_token: usize,
    token_start: usize,
    prev_error_loc: Loc,
    stack_check: StackCheck,
    scratch_props: Vec<E::PropertyJSON>,
    scratch_json_items: Vec<E::JsonValue>,
    scratch_prop_value_locs: Vec<Loc>,
    scratch_item_locs: Vec<Loc>,
    scratch_str: Vec<u8>,
    tape: Option<core::ptr::NonNull<E::JsonTape>>,
    tape_owned: bool,
    dup_hashes: Vec<u64>,
    dup_maps: Vec<DupMap>,
    spill_depth: usize,
}

impl<'s> LexerLog<'s> for Parser<'_, 's> {
    type Err = crate::Error;
    #[inline]
    fn log_mut(&mut self) -> &mut Log {
        self.log
    }
    #[inline]
    fn source(&self) -> &'s Source {
        self.source
    }
    #[inline]
    fn prev_error_loc_mut(&mut self) -> &mut Loc {
        &mut self.prev_error_loc
    }
    #[inline]
    fn start(&self) -> usize {
        self.token_start
    }
    #[inline]
    fn is_log_disabled(&self) -> bool {
        false
    }
    fn syntax_err() -> crate::Error {
        crate::Error::SyntaxError
    }
}

impl Drop for Parser<'_, '_> {
    fn drop(&mut self) {
        drop(self.take_tape());
    }
}

#[inline]
fn is_identifier_start(c: u8) -> bool {
    matches!(c, b'$' | b'_' | b'a'..=b'z' | b'A'..=b'Z')
}
#[inline]
fn is_identifier_continue(c: u8) -> bool {
    is_identifier_start(c) || c.is_ascii_digit()
}

/// Whether white space that is not ` \t\n\r` can start with `c`.
#[inline(always)]
fn is_rare(c: u8) -> bool {
    c >= 0x80 || c == 0x0B || c == 0x0C
}

/// What is before the place from which a token is looked for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Before {
    /// A token that is complete.
    Token,
    /// A byte of a run, which can go on.
    Run,
    /// The same, and it is a backslash that is not escaped itself: a quote that follows opens no string.
    Backslash,
}

/// A bit for each of `bytes` that is `quote`, a backslash or a control character.
#[inline(always)]
fn special_bytes(bytes: &[u8; 16], quote: u8) -> u32 {
    let bytes = u8x16::from_array(*bytes);
    let special = bytes.simd_eq(u8x16::splat(quote))
        | bytes.simd_eq(u8x16::splat(b'\\'))
        | bytes.simd_lt(u8x16::splat(0x20));
    special.to_bitmask() as u32
}

/// The index of the lowest bit of `bits`, which are 16. 16 if there is none.
#[inline(always)]
fn first_of_16(bits: u32) -> usize {
    (bits | (1 << 16)).trailing_zeros() as usize
}

/// How many of the first 16 bytes of `text` are before the first `quote`, backslash or control
/// character. 0 if `text` is shorter.
#[inline(always)]
fn short_plain_len(text: &[u8], quote: u8) -> usize {
    match text.first_chunk::<16>() {
        Some(bytes) => first_of_16(special_bytes(bytes, quote)),
        None => 0,
    }
}

/// How many bytes of `text` are before the first `quote`, backslash or control character. It can also
/// stop at a byte that is not printable ASCII.
#[inline(always)]
fn plain_len(text: &[u8], quote: u8) -> Option<usize> {
    if bun_core::env::IS_NATIVE {
        bun_highway::index_of_interesting_character_in_string_literal(text, quote)
    } else {
        plain_len_of_any_text(text, quote)
    }
}

/// How many bytes at the start of `text` are ASCII, no backslash and no control character.
#[inline]
fn plain_ascii_len(text: &[u8]) -> usize {
    let is_plain = |b: &&u8| (0x20..0x80).contains(*b) && **b != b'\\';
    let Some((first, rest)) = text.split_first_chunk::<16>() else {
        return text.iter().take_while(is_plain).count();
    };
    let is_not_ascii = u8x16::from_array(*first).simd_ge(u8x16::splat(0x80));
    let found = special_bytes(first, b'\\') | is_not_ascii.to_bitmask() as u32;
    if found != 0 {
        return first_of_16(found);
    }
    if !bun_core::env::IS_NATIVE {
        return 16 + rest.iter().take_while(is_plain).count();
    }
    16 + plain_len(rest, b'\\').unwrap_or(rest.len())
}

#[inline(always)]
fn loc_at(p: usize) -> Loc {
    // No text has more than `i32::MAX` bytes.
    Loc { start: p as i32 }
}

/// How many bytes of `text` are before the first `quote`, backslash or control character. For text
/// that is not ASCII, at which the kernel stops.
fn plain_len_of_any_text(text: &[u8], quote: u8) -> Option<usize> {
    let mut i = 0;
    while let Some(bytes) = text.get(i..).and_then(|rest| rest.first_chunk::<16>()) {
        let found = special_bytes(bytes, quote);
        if found != 0 {
            return Some(i + first_of_16(found));
        }
        i += 16;
    }
    while let Some(&b) = text.get(i) {
        if b == quote || b == b'\\' || b < 0x20 {
            return Some(i);
        }
        i += 1;
    }
    None
}

impl<'a, 's> Parser<'a, 's> {
    /// `source` has at most `i32::MAX` bytes.
    pub(crate) fn new(
        source: &'s Source,
        log: &'a mut Log,
        opts: JSONOptions,
        tape_alloc: E::TapeAlloc,
    ) -> Self {
        // `root_ptr` both times: it takes `&mut JsonTape`, so neither arm can
        // hand `tape` a frozen, shared-reborrow pointer. The parser writes
        // through `tape` for the rest of the parse.
        let (tape, tape_owned) = match tape_alloc {
            E::TapeAlloc::Global => (Box::leak(Box::new(E::JsonTape::empty())).root_ptr(), true),
            E::TapeAlloc::Arena(arena) => {
                // SAFETY: the caller's arena (lifetime-erased) outlives the parse and the AST.
                let arena: &Bump = unsafe { arena.as_ref() };
                (
                    arena.alloc(E::JsonTape::empty_in(tape_alloc)).root_ptr(),
                    false,
                )
            }
        };
        let mut parser = Parser {
            contents: &source.contents,
            source,
            log,
            at: 0,
            gap_start: 0,
            first_comment: None,
            index_error: None,
            opts,
            is_json5: false,
            first_token: 0,
            token_start: 0,
            prev_error_loc: Loc::EMPTY,
            stack_check: StackCheck::init(),
            scratch_props: Vec::new(),
            scratch_json_items: Vec::new(),
            scratch_prop_value_locs: Vec::new(),
            scratch_item_locs: Vec::new(),
            scratch_str: Vec::new(),
            tape: Some(tape),
            tape_owned,
            dup_hashes: Vec::new(),
            dup_maps: Vec::new(),
            spill_depth: 0,
        };
        parser.skip_from(0);
        parser
    }

    pub(crate) fn take_tape(&mut self) -> Option<Box<E::JsonTape>> {
        let tape = self.tape.take()?;
        if !self.tape_owned {
            return None;
        }
        // SAFETY: `tape` came from `Box::leak` in `new` (`tape_owned`) and is taken exactly once.
        Some(unsafe { Box::from_raw(tape.as_ptr()) })
    }

    // ───────────────────────────── tokens ─────────────────────────────

    /// To the token that starts at `from` or behind it. `from` is behind a token.
    #[inline(always)]
    fn skip_from(&mut self, from: usize) {
        let contents = self.contents;
        let mut at = from;
        while let Some(&b) = contents.get(at) {
            if b > b' ' {
                if b != b'/' {
                    break;
                }
                at = self.comment_end(at);
            } else if b == b'\n' {
                at += 1;
                // The indentation of the line, 16 blanks at a time.
                while let Some(bytes) = contents.get(at..).and_then(|it| it.first_chunk::<16>()) {
                    let other = u8x16::from_array(*bytes).simd_ne(u8x16::splat(b' '));
                    let other = other.to_bitmask() as u32;
                    at += first_of_16(other);
                    if other != 0 {
                        break;
                    }
                }
            } else if matches!(b, b' ' | b'\t' | b'\r') {
                at += 1;
            } else {
                break;
            }
        }
        self.gap_start = from;
        self.at = at;
    }

    /// Whether there is a `\n` or a `\r` between the token before and `at`.
    #[inline(always)]
    fn is_after_newline(&self) -> bool {
        self.gap_start != self.at
            && (self.contents.get(self.gap_start) == Some(&b'\n') || self.has_newline_in_gap())
    }

    #[inline(never)]
    fn has_newline_in_gap(&self) -> bool {
        let gap = self.contents.get(self.gap_start..self.at);
        strings::contains_any(gap.unwrap_or_default(), b"\n\r")
    }

    /// [`Self::skip_from`] behind a run that ends at `end`. `false`, and nothing is done: a `/` that
    /// starts no comment follows, or a comment without an end. All of it belongs to the run then.
    #[inline(always)]
    fn skip_behind_run(&mut self, end: usize) -> bool {
        let start = self.at;
        self.skip_from(end);
        if self.index_error.is_some() {
            self.at = start;
            return false;
        }
        true
    }

    /// Past a token of one byte.
    #[inline(always)]
    fn bump(&mut self) {
        self.skip_from(self.at + 1);
    }

    /// The end of the comment that starts at `start`, where there is a `/`. The end of the text if it is
    /// none, or has no end.
    #[cold]
    fn comment_end(&mut self, start: usize) -> usize {
        let contents = self.contents;
        let end = match contents.get(start + 1) {
            Some(b'/') => {
                let mut i = start + 2;
                while i < contents.len()
                    && !matches!(contents[i], b'\n' | b'\r')
                    && !is_ls_ps(contents, i)
                {
                    i += 1;
                }
                i
            }
            Some(b'*') => match strings::index_of(&contents[start + 2..], b"*/") {
                Some(len) => start + 2 + len + 2,
                None => {
                    self.index_error
                        .get_or_insert(IndexError::UnterminatedBlockComment { pos: start });
                    return contents.len();
                }
            },
            _ => {
                self.index_error
                    .get_or_insert(IndexError::UnexpectedSlash { pos: start });
                return contents.len();
            }
        };
        self.first_comment.get_or_insert(Range {
            loc: loc_at(start),
            len: (end - start) as i32,
        });
        end
    }

    /// The start of the first token at `i` or behind it.
    #[cold]
    fn token_from(&mut self, mut i: usize, before: Before) -> usize {
        let contents = self.contents;
        let mut is_in_run = before != Before::Token;
        let mut is_escaped = before == Before::Backslash;
        while let Some(&c) = contents.get(i) {
            let was_escaped = core::mem::take(&mut is_escaped);
            match c {
                b'"' | b'\'' if !was_escaped => return i,
                b'/' => {
                    is_in_run = false;
                    i = self.comment_end(i);
                }
                b'{' | b'}' | b'[' | b']' | b':' | b',' => return i,
                b' ' | b'\t' | b'\n' | b'\r' => {
                    is_in_run = false;
                    i += 1;
                }
                _ => {
                    if !is_in_run {
                        return i;
                    }
                    is_escaped = c == b'\\' && !was_escaped;
                    i += 1;
                }
            }
        }
        contents.len()
    }

    /// The start of the token behind the one at `p`, which is no string.
    #[cold]
    fn next_token(&mut self, p: usize) -> usize {
        match self.contents.get(p) {
            None => self.contents.len(),
            Some(b'{' | b'}' | b'[' | b']' | b':' | b',') => self.token_from(p + 1, Before::Token),
            Some(b'\\') => self.token_from(p + 1, Before::Backslash),
            Some(_) => self.token_from(p + 1, Before::Run),
        }
    }

    /// The run at `p`, with the white space and the comments behind it.
    #[cold]
    fn run(&mut self, p: usize) -> &'s [u8] {
        let end = self.next_token(p);
        &self.contents[p..end]
    }

    /// Past the run at `at`, to `next`, which is the token behind it.
    #[cold]
    fn pass_run(&mut self, next: usize) {
        self.gap_start = self.at + 1;
        self.at = next;
    }

    /// To the last token that does not start behind `p`. All tokens on the way are runs.
    #[cold]
    fn pass_runs_up_to(&mut self, p: usize) {
        while self.at < p {
            let next = self.next_token(self.at);
            if next > p {
                break;
            }
            self.at = next;
        }
    }

    /// Where the string that starts at `open` ends: its closing quote, and the first backslash or control
    /// character in it. There is none of the three before `from`.
    #[inline(never)]
    fn string_close_from(&self, open: usize, from: usize) -> Option<(usize, Option<usize>)> {
        let contents = self.contents;
        let quote = contents[open];
        let mut first_special = None;
        let mut is_ascii = true;
        let mut i = from;
        loop {
            let rest = contents.get(i..)?;
            i += match is_ascii {
                true => plain_len(rest, quote)?,
                false => plain_len_of_any_text(rest, quote)?,
            };
            let b = contents[i];
            if b == quote {
                return Some((i, first_special));
            }
            if b == b'\\' {
                first_special.get_or_insert(i);
                i += 2;
            } else if b < 0x20 {
                first_special.get_or_insert(i);
                i += 1;
            } else {
                is_ascii = false;
            }
        }
    }

    /// The closing quote of the string that starts at `open`.
    fn string_close(&self, open: usize) -> Option<usize> {
        Some(self.string_close_from(open, open + 1)?.0)
    }

    /// Looks for comments and for what is wrong with a `/` in all that has not been read.
    #[cold]
    pub(crate) fn read_the_rest(&mut self) {
        let mut p = self.at;
        while let Some(&c) = self.contents.get(p) {
            p = match c {
                b'"' | b'\'' => match self.string_close(p) {
                    Some(close) => self.token_from(close + 1, Before::Token),
                    None => break,
                },
                _ => self.next_token(p),
            };
        }
    }

    fn token_range(&mut self, p: usize) -> Range {
        if p >= self.contents.len() {
            return Range {
                loc: loc_at(self.contents.len()),
                len: 0,
            };
        }
        let len = match self.contents[p] {
            b'{' | b'}' | b'[' | b']' | b':' | b',' => 1,
            b'"' | b'\'' => match self.string_close(p) {
                Some(close) => close + 1 - p,
                None => 1,
            },
            _ => {
                let run = self.run(p);
                let mut e = run.len();
                while e > 0 && (run[e - 1] == b' ' || run[e - 1].is_ascii_whitespace()) {
                    e -= 1;
                }
                e.max(1)
            }
        };
        Range {
            loc: loc_at(p),
            len: len as i32,
        }
    }

    #[cold]
    fn unexpected(&mut self, p: usize) -> crate::Error {
        let r = self.token_range(p);
        if p >= self.contents.len() {
            let _ = self.add_range_error(r, format_args!("Unexpected end of file"));
        } else {
            let raw = &self.contents[p..p + (r.len as usize).max(1)];
            let _ = self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)));
        }
        crate::Error::ParserError
    }

    #[cold]
    fn expected(&mut self, p: usize, what: &str) {
        let r = self.token_range(p);
        if p >= self.contents.len() {
            let _ = self.add_range_error(r, format_args!("Expected {what} but found end of file"));
        } else {
            let raw = &self.contents[p..p + (r.len as usize).max(1)];
            let _ = self.add_range_error(
                r,
                format_args!("Expected {what} but found \"{}\"", bstr::BStr::new(raw)),
            );
        }
    }

    fn js_punct_message(c: u8) -> Option<&'static str> {
        Some(match c {
            b'#' => "Private identifiers are not allowed in JSON",
            b';' => "Semicolons are not allowed in JSON",
            b'@' => "Decorators are not allowed in JSON",
            b'~' => "~ is not allowed in JSON",
            b'%' | b'&' | b'|' | b'^' | b'+' | b'=' | b'<' | b'>' | b'!' | b'`' => {
                "Operators are not allowed in JSON"
            }
            _ => return None,
        })
    }

    #[cold]
    fn junk_byte_error(&mut self, p: usize, pos: usize, c: u8) -> crate::Error {
        if let Some(msg) = Self::js_punct_message(c) {
            self.add_error(pos + 1, format_args!("Unsupported syntax: {msg}"));
            return crate::Error::SyntaxError;
        }
        self.unexpected(p)
    }

    /// Past white space of all kinds and comments, from `at` on. Returns where they end, which can be in
    /// the run at `at` afterwards. `None`: at the end of the text.
    #[cold]
    fn skip_unicode_ws(&mut self) -> Option<usize> {
        let start = self.at;
        let mut p = start;
        'outer: loop {
            let from = p;
            let iterator = strings::CodepointIterator::init(&self.contents[from..]);
            let mut iter = strings::Cursor::default();
            while iterator.next(&mut iter) {
                let is_ws =
                    matches!(iter.c, 0x09 | 0x0A | 0x0D | 0x20) || is_exotic_whitespace(iter.c);
                if !is_ws {
                    break;
                }
                p = from + iter.i as usize + iter.width as usize;
            }
            if p >= self.contents.len() || self.contents[p] != b'/' {
                break;
            }
            match self.contents.get(p + 1) {
                Some(b'/') => {
                    p += 2;
                    while p < self.contents.len()
                        && !matches!(self.contents[p], b'\n' | b'\r')
                        && !is_ls_ps(self.contents, p)
                    {
                        p += 1;
                    }
                }
                Some(b'*') => {
                    let Some(close) = strings::index_of(&self.contents[p + 2..], b"*/") else {
                        p = self.contents.len();
                        break 'outer;
                    };
                    p += 2 + close + 2;
                }
                _ => break,
            }
        }
        let p = p.min(self.contents.len());
        self.pass_runs_up_to(p);
        (p < self.contents.len()).then_some(p)
    }

    #[inline(always)]
    fn peek_byte(&mut self) -> u8 {
        self.peek().0
    }

    /// The first byte that is no white space, 0xFF at the end of the text, and the start of its token.
    #[inline(always)]
    fn peek(&mut self) -> (u8, usize) {
        let p = self.at;
        let Some(&b) = self.contents.get(p) else {
            return (0xFF, p);
        };
        // One comparison for all that a token usually starts with.
        if !(0x0D..0x80).contains(&b) {
            return self.peek_behind_rare_white_space(b);
        }
        (b, p)
    }

    #[cold]
    fn peek_behind_rare_white_space(&mut self, b: u8) -> (u8, usize) {
        if self.is_json5 {
            return self.json5_peek();
        }
        if !is_rare(b) {
            return (b, self.at);
        }
        let b = match self.skip_unicode_ws() {
            None => 0xFF,
            Some(np) => self.contents[np],
        };
        (b, self.at)
    }

    pub(crate) fn at_trailing_end(&mut self) -> bool {
        loop {
            let p = self.at;
            if p >= self.contents.len() {
                return true;
            }
            if is_rare(self.contents[p]) {
                let run = self.run(p);
                if self.rest_is_ws_cold(run) {
                    self.at = p + run.len();
                    continue;
                }
            }
            return false;
        }
    }

    /// A value is expected at the end of the text.
    #[cold]
    fn unexpected_end(&mut self) -> crate::Error {
        let end = self.contents.len();
        if self.is_json5 {
            return self.json5_error(Json5Error::UnexpectedEof, end);
        }
        self.token_start = end;
        self.unexpected(end)
    }

    pub(crate) fn unexpected_here(&mut self) -> crate::Error {
        self.unexpected(self.at)
    }

    // ───────────────────────────── values ─────────────────────────────

    pub(crate) fn parse_value(&mut self) -> PResult<Expr> {
        let start = self.at;
        if start >= self.contents.len() {
            return Err(self.unexpected_end());
        }
        let loc = loc_at(start);
        self.token_start = start;
        match self.contents[start] {
            b'{' => self.parse_object(loc),
            b'[' => self.parse_array(loc),
            b'"' | b'\'' => {
                let s = E::EString::init(self.parse_string_utf8()?.slice());
                Ok(Expr::init(s, loc))
            }
            _ => self.parse_scalar(loc),
        }
    }

    /// The tape allocation's own pointer, for the nodes that store it.
    ///
    /// Not a `&JsonTape`: parsing keeps appending to the tape after a node is
    /// built, and every such write invalidates a pointer derived from a shared
    /// reborrow (see [`E::ObjectJSON::new`]).
    #[inline]
    fn tape_ptr(&self) -> core::ptr::NonNull<E::JsonTape> {
        self.tape.expect("the tape was already taken")
    }

    #[inline]
    fn tape_mut(&mut self) -> &mut E::JsonTape {
        // SAFETY: allocated in `Parser::new` and exclusively owned until
        // `take_tape`; a fresh reborrow of the root pointer per call.
        unsafe { self.tape.expect("the tape was already taken").as_mut() }
    }

    fn push_props_block(&mut self, mark: usize) -> (u32, u32) {
        // SAFETY: see `tape_mut`; the raw-derived `&mut` is not a borrow of `self`.
        let tape = unsafe { self.tape.expect("the tape was already taken").as_mut() };
        let locs: &[Loc] = if self.opts.record_value_locs {
            &self.scratch_prop_value_locs[mark..]
        } else {
            &[]
        };
        let span = tape.append_props(&self.scratch_props[mark..], locs);
        self.scratch_props.truncate(mark);
        self.scratch_prop_value_locs
            .truncate(mark.min(self.scratch_prop_value_locs.len()));
        span
    }

    fn push_items_block(&mut self, mark: usize) -> (u32, u32) {
        // SAFETY: see `push_props_block`.
        let tape = unsafe { self.tape.expect("the tape was already taken").as_mut() };
        let locs: &[Loc] = if self.opts.record_value_locs {
            &self.scratch_item_locs[mark..]
        } else {
            &[]
        };
        let span = tape.append_items(&self.scratch_json_items[mark..], locs);
        self.scratch_json_items.truncate(mark);
        self.scratch_item_locs
            .truncate(mark.min(self.scratch_item_locs.len()));
        span
    }

    #[inline(always)]
    fn parse_json_value(&mut self) -> PResult<(E::JsonValue, Loc)> {
        let start = self.at;
        if start >= self.contents.len() {
            return Err(self.unexpected_end());
        }
        let loc = loc_at(start);
        match self.contents[start] {
            b'{' => {
                let e = self.parse_object(loc)?;
                let Data::EObjectJSON(r) = e.data else {
                    unreachable!()
                };
                Ok((E::JsonValue::Object(r), e.loc))
            }
            b'[' => {
                let e = self.parse_array(loc)?;
                let Data::EArrayJSON(r) = e.data else {
                    unreachable!()
                };
                Ok((E::JsonValue::Array(r), e.loc))
            }
            b'"' | b'\'' => Ok((E::JsonValue::String(self.parse_string_utf8()?), loc)),
            _ => {
                let e = self.parse_scalar(loc)?;
                let value_loc = e.loc;
                Ok((
                    match e.data {
                        Data::ENumber(n) => E::JsonValue::Number(n),
                        Data::EBoolean(b) => E::JsonValue::Boolean(b.value),
                        Data::ENull(_) => E::JsonValue::Null,
                        Data::EString(r) => E::JsonValue::String(r.get().data),
                        Data::EObjectJSON(r) => E::JsonValue::Object(r),
                        Data::EArrayJSON(r) => E::JsonValue::Array(r),
                        _ => unreachable!("not a JSON leaf"),
                    },
                    value_loc,
                ))
            }
        }
    }

    /// The string at `at`, which is in double quotes. `IS_NAME`: a colon that follows at once is passed
    /// too, and that is returned.
    #[inline(always)]
    fn parse_short_string<const IS_NAME: bool>(&mut self) -> PResult<(E::Str, bool)> {
        let open = self.at;
        let rest = &self.contents[open + 1..];
        let len = short_plain_len(rest, b'"');
        if rest.get(len) == Some(&b'"') {
            let has_colon = IS_NAME && rest.get(len + 1) == Some(&b':');
            self.skip_from(open + len + 2 + usize::from(has_colon));
            return Ok((E::Str::new(&rest[..len]), has_colon));
        }
        Ok((self.parse_long_string(open, open + 1 + len)?, false))
    }

    /// The string at `at`.
    #[inline(always)]
    fn parse_string_utf8(&mut self) -> PResult<E::Str> {
        match self.contents[self.at] {
            b'"' => Ok(self.parse_short_string::<false>()?.0),
            _ => self.parse_long_string(self.at, self.at + 1),
        }
    }

    /// A string of more than 16 bytes, at the end of the text, or with a backslash or a control
    /// character in it. None of them, and no quote, is before `from`.
    #[inline(never)]
    fn parse_long_string(&mut self, open: usize, from: usize) -> PResult<E::Str> {
        if self.is_json5 {
            let (string, end) = self.json5_string(open)?;
            self.skip_from(end);
            return Ok(string);
        }
        self.token_start = open;
        let Some((close, first_special)) = self.string_close_from(open, from) else {
            self.add_default_error(b"Unterminated string literal")?;
            unreachable!()
        };
        let body = &self.contents[open + 1..close];
        self.skip_from(close + 1);
        let Some(first_special) = first_special else {
            return Ok(E::Str::new(body));
        };
        let special = self.contents[first_special];
        if special != b'\\' {
            return Err(self.string_control_char_error(special));
        }
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        self.decode_escapes(body, &mut buf)?;
        let owned = self.alloc_owned_str(&buf);
        self.scratch_str = buf;
        Ok(owned)
    }

    fn alloc_owned_str(&mut self, bytes: &[u8]) -> E::Str {
        self.tape_mut().alloc_str(bytes)
    }

    #[cold]
    fn string_control_char_error(&mut self, c: u8) -> crate::Error {
        if c == b'\r' || c == b'\n' {
            match self.add_default_error(b"Unterminated string literal") {
                Err(e) => e,
                Ok(()) => unreachable!(),
            }
        } else {
            match self.syntax_error() {
                Err(e) => e,
                Ok(()) => unreachable!(),
            }
        }
    }

    #[inline]
    fn decode_escapes(&mut self, body: &[u8], buf: &mut Vec<u8>) -> PResult {
        decode_string_escapes(self, body, buf)
    }

    /// Whether the run at `at`, which is read up to `end`, ends there, with what usually follows. It is
    /// passed then.
    #[inline(always)]
    fn ends_at(&mut self, end: usize) -> bool {
        matches!(
            self.contents.get(end),
            None | Some(b' ' | b'\t' | b'\n' | b'\r' | b',' | b']' | b'}')
        ) && self.skip_behind_run(end)
    }

    #[inline(always)]
    fn parse_scalar(&mut self, loc: Loc) -> PResult<Expr> {
        let start = self.at;
        let rest = &self.contents[start..];
        match rest[0] {
            b't' if rest.starts_with(b"true") && self.ends_at(start + 4) => {
                Ok(Expr::init(E::Boolean { value: true }, loc))
            }
            b'f' if rest.starts_with(b"false") && self.ends_at(start + 5) => {
                Ok(Expr::init(E::Boolean { value: false }, loc))
            }
            b'n' if rest.starts_with(b"null") && self.ends_at(start + 4) => {
                Ok(Expr::init(E::Null {}, loc))
            }
            b'0'..=b'9' | b'.' | b'-' => self.parse_number(loc),
            _ => self.parse_rare_scalar(loc),
        }
    }

    /// A run that is no number, or not followed by what usually follows.
    #[cold]
    fn parse_rare_scalar(&mut self, loc: Loc) -> PResult<Expr> {
        if self.is_json5 {
            return self.parse_json5_scalar(loc);
        }
        self.token_start = self.at;
        let run = self.run(self.at);
        let next = self.at + run.len();
        debug_assert!(!run.is_empty());
        match run[0] {
            b't' if run.starts_with(b"true") && self.rest_is_ws_cold(&run[4..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Boolean { value: true }, loc))
            }
            b'f' if run.starts_with(b"false") && self.rest_is_ws_cold(&run[5..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Boolean { value: false }, loc))
            }
            b'n' if run.starts_with(b"null") && self.rest_is_ws_cold(&run[4..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Null {}, loc))
            }
            _ => self.parse_scalar_cold(loc),
        }
    }

    #[cold]
    fn rest_is_ws_cold(&self, rest: &[u8]) -> bool {
        if rest
            .iter()
            .all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        {
            return true;
        }
        let mut i = 0;
        while i < rest.len() {
            match rest[i] {
                b' ' | b'\t' | b'\n' | b'\r' => i += 1,
                b'/' => match rest.get(i + 1) {
                    Some(b'/') => {
                        i += 2;
                        i += strings::index_of_any(&rest[i..], b"\n\r").unwrap_or(rest.len() - i);
                    }
                    Some(b'*') => {
                        let Some(close) = strings::index_of(&rest[i + 2..], b"*/") else {
                            return false;
                        };
                        i += 2 + close + 2;
                    }
                    _ => return false,
                },
                _ => {
                    let iterator = strings::CodepointIterator::init(&rest[i..]);
                    let mut iter = strings::Cursor::default();
                    if !iterator.next(&mut iter) || !is_exotic_whitespace(iter.c) {
                        return false;
                    }
                    i += (iter.width as usize).max(1);
                }
            }
        }
        true
    }

    fn parse_array(&mut self, loc: Loc) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(match self.is_json5 {
                true => crate::Error::StackOverflow,
                false => self.too_deeply_nested(loc),
            });
        }
        self.bump();
        let mark = self.scratch_json_items.len();
        self.peek();
        let mut is_single_line = !self.is_after_newline();
        let mut close_loc = Loc::EMPTY;
        let result: PResult = loop {
            let (b, p) = self.peek();
            if p >= self.contents.len() {
                if self.is_json5 {
                    break Err(match self.scratch_json_items.len() != mark {
                        true => self.json5_expected_comma(p, b']'),
                        false => self.unexpected_end(),
                    });
                }
                self.token_start = self.contents.len();
                self.expected(p, "\"]\"");
                break Err(crate::Error::ParserError);
            }
            if b == b']' {
                is_single_line = is_single_line && !self.is_after_newline();
                close_loc = loc_at(p);
                self.bump();
                break Ok(());
            }
            if self.scratch_json_items.len() != mark {
                if b != b',' {
                    if self.is_json5 {
                        break Err(self.json5_expected_comma(p, b']'));
                    }
                    if let Some(msg) = Self::js_punct_message(b) {
                        self.add_error(p + 1, format_args!("Unsupported syntax: {msg}"));
                        break Err(crate::Error::SyntaxError);
                    }
                    self.expected(p, "\",\"");
                    break Err(crate::Error::ParserError);
                }
                is_single_line = is_single_line && !self.is_after_newline();
                self.bump();
                let (after_b, after) = self.peek();
                is_single_line = is_single_line && !self.is_after_newline();
                if after_b == b']' {
                    if !self.opts.allow_trailing_commas {
                        let r = Range {
                            loc: loc_at(p),
                            len: 1,
                        };
                        let _ = self.add_range_error(
                            r,
                            format_args!("JSON does not support trailing commas"),
                        );
                    }
                    close_loc = loc_at(after);
                    self.bump();
                    break Ok(());
                }
            }
            match self.parse_json_value() {
                Ok((item, item_loc)) => {
                    if self.opts.record_value_locs {
                        self.scratch_item_locs.push(item_loc);
                    }
                    self.scratch_json_items.push(item)
                }
                Err(e) => break Err(e),
            }
        };
        if let Err(e) = result {
            self.scratch_json_items.truncate(mark);
            self.scratch_item_locs
                .truncate(mark.min(self.scratch_item_locs.len()));
            return Err(e);
        }
        let (first, count) = self.push_items_block(mark);
        Ok(Expr::init(
            // SAFETY: `tape_ptr` is the tape allocation's own pointer, and the
            // tape outlives the AST (`take_tape` hands it to the caller).
            unsafe {
                let is_single_line = is_single_line && !self.is_json5;
                E::ArrayJSON::new(self.tape_ptr(), first, count, is_single_line, close_loc)
            },
            loc,
        ))
    }

    fn parse_object(&mut self, loc: Loc) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(match self.is_json5 {
                true => crate::Error::StackOverflow,
                false => self.too_deeply_nested(loc),
            });
        }
        self.bump();
        let mark = self.scratch_props.len();
        let hmark = self.dup_hashes.len();
        self.peek();
        let mut is_single_line = !self.is_after_newline();
        let mut close_loc = Loc::EMPTY;
        let warn_dup = self.opts.json_warn_duplicate_keys;

        let result: PResult = loop {
            let (mut b, mut p) = self.peek();
            if p >= self.contents.len() {
                if self.is_json5 {
                    break Err(match self.scratch_props.len() != mark {
                        true => self.json5_expected_comma(p, b'}'),
                        false => self.unexpected_end(),
                    });
                }
                self.token_start = self.contents.len();
                self.expected(p, "\"}\"");
                break Err(crate::Error::ParserError);
            }
            if b == b'}' {
                is_single_line = is_single_line && !self.is_after_newline();
                close_loc = loc_at(p);
                self.bump();
                break Ok(());
            }
            if self.scratch_props.len() != mark {
                if b != b',' {
                    if self.is_json5 {
                        break Err(self.json5_expected_comma(p, b'}'));
                    }
                    if let Some(msg) = Self::js_punct_message(b) {
                        self.add_error(p + 1, format_args!("Unsupported syntax: {msg}"));
                        break Err(crate::Error::SyntaxError);
                    }
                    self.expected(p, "\",\"");
                    break Err(crate::Error::ParserError);
                }
                is_single_line = is_single_line && !self.is_after_newline();
                self.bump();
                let (after_b, after) = self.peek();
                is_single_line = is_single_line && !self.is_after_newline();
                if after_b == b'}' {
                    if !self.opts.allow_trailing_commas {
                        let r = Range {
                            loc: loc_at(p),
                            len: 1,
                        };
                        let _ = self.add_range_error(
                            r,
                            format_args!("JSON does not support trailing commas"),
                        );
                    }
                    close_loc = loc_at(after);
                    self.bump();
                    break Ok(());
                }
                b = after_b;
                p = after;
            }

            let key_start = p;
            let key = if b == b'"' {
                self.parse_short_string::<true>()
            } else if b == b'\'' {
                self.parse_long_string(key_start, key_start + 1)
                    .map(|key| (key, false))
            } else if self.is_json5 {
                self.parse_json5_name(key_start).map(|key| (key, false))
            } else {
                self.expected(key_start, "string");
                break Err(self.unexpected(key_start));
            };
            let (key, has_colon) = match key {
                Ok(key) => key,
                Err(e) => break Err(e),
            };
            let key_loc = loc_at(key_start);

            if warn_dup && self.check_duplicate_key(mark, hmark, key.slice()) {
                let key_range = self.token_range(key_start);
                self.warn_duplicate_key(key.slice(), key_range);
            }

            if !has_colon {
                if self.peek_byte() != b':' {
                    if self.is_json5 {
                        break Err(self.json5_expected_colon());
                    }
                    self.expected(self.at, "\":\"");
                    break Err(crate::Error::ParserError);
                }
                self.bump();
            }

            let (value, value_loc) = match self.parse_json_value() {
                Ok(v) => v,
                Err(e) => break Err(e),
            };
            if self.opts.record_value_locs {
                self.scratch_prop_value_locs.push(value_loc);
            }
            self.scratch_props.push(E::PropertyJSON {
                key,
                key_loc,
                value,
            });
        };
        if self.dup_hashes.len() - hmark > Self::DUP_LINEAR_MAX {
            self.spill_depth -= 1;
            self.dup_maps[self.spill_depth].clear();
        }
        self.dup_hashes.truncate(hmark);
        if let Err(e) = result {
            self.scratch_props.truncate(mark);
            self.scratch_prop_value_locs
                .truncate(mark.min(self.scratch_prop_value_locs.len()));
            return Err(e);
        }

        let (first, count) = self.push_props_block(mark);
        Ok(Expr::init(
            // SAFETY: see `parse_array`.
            unsafe {
                let is_single_line = is_single_line && !self.is_json5;
                E::ObjectJSON::new(self.tape_ptr(), first, count, is_single_line, close_loc)
            },
            loc,
        ))
    }

    const DUP_LINEAR_MAX: usize = 32;

    fn check_duplicate_key(&mut self, mark: usize, hmark: usize, key: &[u8]) -> bool {
        let h = bun_wyhash::hash(key);
        let n_prior = self.dup_hashes.len() - hmark;
        let dup = if n_prior <= Self::DUP_LINEAR_MAX {
            if n_prior == Self::DUP_LINEAR_MAX {
                if self.dup_maps.len() == self.spill_depth {
                    self.dup_maps.push(DupMap::default());
                }
                let map = &mut self.dup_maps[self.spill_depth];
                self.spill_depth += 1;
                debug_assert!(map.is_empty());
                for &ph in &self.dup_hashes[hmark..] {
                    map.insert(ph, ());
                }
                map.insert(h, ());
            }
            match self.dup_hashes[hmark..].iter().position(|&ph| ph == h) {
                None => false,
                Some(i) => self.scratch_props[mark + i].key.slice() == key,
            }
        } else {
            self.dup_maps[self.spill_depth - 1].insert(h, ()).is_some()
        };
        self.dup_hashes.push(h);
        dup
    }

    #[cold]
    fn too_deeply_nested(&mut self, loc: Loc) -> crate::Error {
        let _ = self.add_range_error(
            Range { loc, len: 1 },
            format_args!("JSON document is too deeply nested"),
        );
        crate::Error::StackOverflow
    }

    #[cold]
    fn warn_duplicate_key(&mut self, key_text: &[u8], key_range: Range) {
        let source = self.source;
        self.log.add_range_warning_fmt(
            Some(source),
            key_range,
            format_args!(
                "Duplicate key \"{}\" in object literal",
                bstr::BStr::new(key_text)
            ),
        );
    }

    fn parse_number(&mut self, loc: Loc) -> PResult<Expr> {
        if self.is_json5 {
            return self.parse_json5_scalar(loc);
        }
        let start = self.at;
        let rest = &self.contents[start..];

        if rest[0] == b'-' {
            return self.parse_negative_number_at(start, loc);
        }

        let (value, used) = self.parse_number_text(rest, start)?;
        if !self.ends_at(start + used) {
            let run = self.run(start);
            if !self.rest_is_ws_cold(&run[used..]) {
                return Err(self.number_trailing_junk(start + used));
            }
            self.pass_run(start + run.len());
        }
        Ok(Expr::init(E::Number::new(value), loc))
    }

    #[cold]
    fn parse_negative_number_at(&mut self, minus_pos: usize, loc: Loc) -> PResult<Expr> {
        self.token_start = minus_pos;
        let contents = self.contents;
        let Some(q) = crate::json::skip_ws_and_comments(contents, minus_pos + 1) else {
            self.pass_runs_up_to(contents.len());
            self.expected(self.at, "number");
            return Err(self.unexpected(self.at));
        };
        self.pass_runs_up_to(q);
        if !matches!(contents[q], b'0'..=b'9' | b'.') {
            self.expected(self.at, "number");
            return Err(self.unexpected(self.at));
        }
        self.token_start = q;
        let next = self.next_token(self.at);
        let run = &contents[q..next];
        let (value, used) = self.parse_number_text(run, q)?;
        if !self.rest_is_ws_cold(&run[used..]) {
            return Err(self.number_trailing_junk(q + used));
        }
        self.pass_run(next);
        Ok(Expr::init(E::Number::new(-value), loc))
    }

    #[cold]
    fn number_trailing_junk(&mut self, pos: usize) -> crate::Error {
        let c = self.contents[pos];
        if is_identifier_start(c) || c == b'\\' {
            self.token_start = pos;
            match self.syntax_error() {
                Err(e) => e,
                Ok(()) => unreachable!(),
            }
        } else {
            self.junk_byte_error(self.at, pos, c)
        }
    }

    fn parse_number_text(&mut self, t: &[u8], pos: usize) -> PResult<(f64, usize)> {
        self.token_start = pos;
        let n = t.len();
        let first = t[0];
        let mut i = 1;

        if first == b'.' && (n < 2 || !t[1].is_ascii_digit()) {
            return Err(self.syntax_err_at(pos));
        }

        if first == b'0' && n > 1 {
            let (radix, prefix_len, legacy_octal): (u32, usize, bool) = match t[1] {
                b'b' | b'B' => (2, 2, false),
                b'o' | b'O' => (8, 2, false),
                b'x' | b'X' => (16, 2, false),
                b'0'..=b'7' | b'_' => (8, 1, true),
                b'8' | b'9' => (10, 1, true),
                _ => (0, 0, false),
            };
            if radix != 0 {
                return self.parse_radix_number(t, pos, radix, prefix_len, legacy_octal);
            }
        }

        let mut has_dot_or_exp = first == b'.';
        let mut underscores = false;
        let mut last_underscore_end: usize = usize::MAX;
        macro_rules! digits {
            () => {
                while i < n {
                    match t[i] {
                        b'0'..=b'9' => i += 1,
                        b'_' => {
                            if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
                                return Err(self.syntax_err_at(pos));
                            }
                            if i == 0 {
                                return Err(self.syntax_err_at(pos));
                            }
                            last_underscore_end = i;
                            underscores = true;
                            i += 1;
                        }
                        _ => break,
                    }
                }
            };
        }
        if first != b'.' {
            digits!();
        }
        if i < n && t[i] == b'.' && (first != b'.') {
            if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
                return Err(self.syntax_err_at(pos));
            }
            has_dot_or_exp = true;
            i += 1;
            if i < n && t[i] == b'_' {
                return Err(self.syntax_err_at(pos));
            }
            digits!();
        } else if first == b'.' {
            digits!();
        }
        if i < n && (t[i] == b'e' || t[i] == b'E') {
            if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
                return Err(self.syntax_err_at(pos));
            }
            has_dot_or_exp = true;
            i += 1;
            if i < n && (t[i] == b'+' || t[i] == b'-') {
                i += 1;
            }
            if i >= n || !t[i].is_ascii_digit() {
                return Err(self.syntax_err_at(pos));
            }
            digits!();
        }
        if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
            return Err(self.syntax_err_at(pos));
        }
        let text = &t[..i];
        let value: f64 = if !has_dot_or_exp && !underscores && text.len() < 10 {
            let mut v: u32 = 0;
            for &c in text {
                v = v * 10 + (c - b'0') as u32;
            }
            v as f64
        } else {
            let owned: Vec<u8>;
            let digits: &[u8] = if underscores {
                owned = text.iter().copied().filter(|&c| c != b'_').collect();
                &owned
            } else {
                text
            };
            match core::str::from_utf8(digits)
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
            {
                Some(v) => v,
                None => {
                    self.add_error(pos, format_args!("Invalid number"));
                    return Err(crate::Error::SyntaxError);
                }
            }
        };
        Ok((value, i))
    }

    #[cold]
    fn parse_radix_number(
        &mut self,
        t: &[u8],
        pos: usize,
        radix: u32,
        prefix_len: usize,
        legacy_octal: bool,
    ) -> PResult<(f64, usize)> {
        let n = t.len();
        let mut i = prefix_len;
        let mut value: f64 = 0.0;
        let mut is_first = true;
        let mut is_invalid_legacy_octal = false;
        let mut last_underscore_end: usize = usize::MAX;
        let base = radix as f64;
        while i < n {
            let c = t[i];
            let digit: u32 = match c {
                b'_' => {
                    if (last_underscore_end != usize::MAX && i == last_underscore_end + 1)
                        || is_first
                        || legacy_octal
                    {
                        return Err(self.syntax_err_at(pos));
                    }
                    last_underscore_end = i;
                    i += 1;
                    continue;
                }
                b'0' | b'1' => (c - b'0') as u32,
                b'2'..=b'7' => {
                    if radix == 2 {
                        return Err(self.syntax_err_at(pos));
                    }
                    (c - b'0') as u32
                }
                b'8' | b'9' => {
                    if legacy_octal {
                        is_invalid_legacy_octal = true;
                    } else if radix < 10 {
                        return Err(self.syntax_err_at(pos));
                    }
                    (c - b'0') as u32
                }
                b'A'..=b'F' => {
                    if radix != 16 {
                        return Err(self.syntax_err_at(pos));
                    }
                    (c - b'A' + 10) as u32
                }
                b'a'..=b'f' => {
                    if radix != 16 {
                        return Err(self.syntax_err_at(pos));
                    }
                    (c - b'a' + 10) as u32
                }
                _ => break,
            };
            value = value * base + digit as f64;
            i += 1;
            is_first = false;
        }
        if is_first {
            return Err(self.syntax_err_at(pos));
        }
        if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
            return Err(self.syntax_err_at(pos));
        }
        if is_invalid_legacy_octal {
            let text = &t[..i];
            let s = core::str::from_utf8(text).expect("ascii");
            match s.parse::<f64>() {
                Ok(v) => value = v,
                Err(_) => {
                    self.add_error(
                        pos,
                        format_args!("Invalid number {}", bstr::BStr::new(text)),
                    );
                    return Err(crate::Error::SyntaxError);
                }
            }
        }
        Ok((value, i))
    }

    #[cold]
    fn syntax_err_at(&mut self, pos: usize) -> crate::Error {
        self.token_start = pos;
        match self.syntax_error() {
            Err(e) => e,
            Ok(()) => unreachable!(),
        }
    }

    #[cold]
    fn parse_scalar_cold(&mut self, loc: Loc) -> PResult<Expr> {
        let start = self.at;
        let first = self.contents[start];

        if is_rare(first) {
            let Some(p) = self.skip_unicode_ws() else {
                self.token_start = self.contents.len();
                return Err(self.unexpected(self.at));
            };
            if p != start {
                if p == self.at {
                    return self.parse_value();
                }
                return self.parse_scalar_tail(p);
            }
        }

        if first == b'\\' {
            return self.parse_escaped_identifier(start, loc);
        }

        if is_identifier_start(first) {
            return Err(self.unexpected(start));
        }
        if first >= 0x80 {
            return Err(self.unexpected(start));
        }
        Err(self.junk_byte_error(start, start, first))
    }

    /// What is in the run at `at` from `pos` on, behind white space.
    #[cold]
    fn parse_scalar_tail(&mut self, pos: usize) -> PResult<Expr> {
        let next = self.next_token(self.at);
        let tail = &self.contents[pos..next];
        let loc_tail = loc_at(pos);
        self.token_start = pos;
        match tail[0] {
            b't' if tail.starts_with(b"true") && self.rest_is_ws_cold(&tail[4..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Boolean { value: true }, loc_tail))
            }
            b'f' if tail.starts_with(b"false") && self.rest_is_ws_cold(&tail[5..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Boolean { value: false }, loc_tail))
            }
            b'n' if tail.starts_with(b"null") && self.rest_is_ws_cold(&tail[4..]) => {
                self.pass_run(next);
                Ok(Expr::init(E::Null {}, loc_tail))
            }
            b'-' => self.parse_negative_number_at(pos, loc_tail),
            b'0'..=b'9' | b'.' => {
                let (value, used) = self.parse_number_text(tail, pos)?;
                if !self.rest_is_ws_cold(&tail[used..]) {
                    return Err(self.number_trailing_junk(pos + used));
                }
                self.pass_run(next);
                Ok(Expr::init(E::Number::new(value), loc_tail))
            }
            c if is_identifier_start(c) => {
                let r = Range {
                    loc: loc_at(pos),
                    len: ident_len(tail) as i32,
                };
                let raw = &tail[..ident_len(tail)];
                let _ =
                    self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)));
                Err(crate::Error::ParserError)
            }
            b'\\' => self.parse_escaped_identifier(pos, loc_tail),
            c => Err(self.junk_byte_error(self.at, pos, c)),
        }
    }

    #[cold]
    fn parse_escaped_identifier(&mut self, start: usize, loc: Loc) -> PResult<Expr> {
        let next = self.next_token(self.at);
        let run = &self.contents[start..next];
        self.token_start = start;
        let mut i = 0;
        while i < run.len() {
            let c = run[i];
            if c == b'\\' {
                if run.get(i + 1) != Some(&b'u') {
                    return self.syntax_error().map(|_| unreachable!());
                }
                i += 2;
                for _ in 0..4 {
                    if !run.get(i).is_some_and(|c| c.is_ascii_hexdigit()) {
                        return self.syntax_error().map(|_| unreachable!());
                    }
                    i += 1;
                }
                continue;
            }
            if !is_identifier_continue(c) {
                break;
            }
            i += 1;
        }
        let text = &run[..i];
        if !self.rest_is_ws_cold(&run[i..]) {
            let pos = start + i;
            return Err(self.junk_byte_error(self.at, pos, self.contents[pos]));
        }
        let mut buf: Vec<u8> = Vec::with_capacity(text.len());
        self.decode_escapes(text, &mut buf)?;
        let value = match buf.as_slice() {
            b"true" => Expr::init(E::Boolean { value: true }, loc),
            b"false" => Expr::init(E::Boolean { value: false }, loc),
            b"null" => Expr::init(E::Null {}, loc),
            _ => return Err(self.unexpected(self.at)),
        };
        self.pass_run(next);
        Ok(value)
    }

    // ───────────────────────────── JSON5 ─────────────────────────────
    //
    // Objects, arrays, strings in double quotes without a backslash, `true`, `false` and `null` are read
    // by what reads JSON. What follows is the rest of https://spec.json5.org/, and what is said about a
    // text that is not JSON5. A token is looked at as a whole before it is said that it is in the
    // wrong place: what is wrong in it comes first.

    /// From now on the text is read as JSON5.
    pub(crate) fn read_as_json5(&mut self) {
        self.is_json5 = true;
        self.peek();
        self.first_token = self.at;
    }

    #[cold]
    fn json5_error(&mut self, error: Json5Error, pos: usize) -> crate::Error {
        // Nothing has been read behind a `/` that starts no comment, nor in a comment without an end.
        let (error, pos) = match self.index_error {
            Some(IndexError::UnexpectedSlash { pos }) => (Json5Error::UnexpectedCharacter, pos),
            Some(IndexError::UnterminatedBlockComment { .. }) => {
                (Json5Error::UnterminatedComment, self.contents.len())
            }
            _ => (error, pos),
        };
        self.log
            .add_error(Some(self.source), loc_at(pos), error.message());
        crate::Error::SyntaxError
    }

    /// Whether the text ends at `p`. A NUL ends it too.
    fn json5_is_end(&self, p: usize) -> bool {
        matches!(self.contents.get(p), None | Some(0))
    }

    /// How many bytes of white space that is not ASCII are at `p`.
    fn json5_white_space_len(&self, p: usize) -> usize {
        match self.contents.get(p..).unwrap_or_default() {
            // U+00A0
            [0xC2, 0xA0, ..] => 2,
            // U+FEFF, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
            [0xEF, 0xBB, 0xBF, ..]
            | [0xE1, 0x9A, 0x80, ..]
            | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
            | [0xE2, 0x81, 0x9F, ..]
            | [0xE3, 0x80, 0x80, ..] => 3,
            _ => 0,
        }
    }

    /// [`Self::peek`] where white space of JSON5 that is not ` \t\n\r` can be.
    #[cold]
    fn json5_peek(&mut self) -> (u8, usize) {
        loop {
            let p = self.at;
            let len = match self.contents.get(p) {
                Some(0x0B | 0x0C) => 1,
                Some(0x80..) => self.json5_white_space_len(p),
                _ => 0,
            };
            if len == 0 {
                return (self.contents.get(p).copied().unwrap_or(0xFF), p);
            }
            self.skip_from(p + len);
        }
    }

    /// Nothing but white space and comments follows the value.
    pub(crate) fn json5_end(&mut self) -> PResult {
        let (_, p) = self.peek();
        if self.index_error.is_none() && self.json5_is_end(p) {
            return Ok(());
        }
        self.json5_can_start_value()?;
        Err(self.json5_error(Json5Error::TrailingData, p))
    }

    /// Looks at the token at `at`, which is not what is expected there. Returns whether a value can
    /// start with it.
    #[cold]
    fn json5_can_start_value(&mut self) -> PResult<bool> {
        let p = self.at;
        match self.contents.get(p) {
            None | Some(0 | b'}' | b']' | b':' | b',') => Ok(false),
            Some(b'{' | b'[') => Ok(true),
            Some(_) => self.json5_leaf(p).map(|_| true),
        }
    }

    /// What is said where a `,` or `close` is expected, at `p`.
    #[cold]
    fn json5_expected_comma(&mut self, p: usize, close: u8) -> crate::Error {
        let (unterminated, expected_close) = match close {
            b'}' => (
                Json5Error::UnterminatedObject,
                Json5Error::ExpectedClosingBrace,
            ),
            _ => (
                Json5Error::UnterminatedArray,
                Json5Error::ExpectedClosingBracket,
            ),
        };
        if self.json5_is_end(p) {
            return self.json5_error(unterminated, p);
        }
        match self.json5_can_start_value() {
            Ok(true) => self.json5_error(Json5Error::ExpectedComma, p),
            Ok(false) => self.json5_error(expected_close, p),
            Err(error) => error,
        }
    }

    /// What is said where a `:` is expected, at `at`.
    #[cold]
    fn json5_expected_colon(&mut self) -> crate::Error {
        let p = self.at;
        match self.json5_can_start_value() {
            Ok(_) => self.json5_error(Json5Error::ExpectedColon, p),
            Err(error) => error,
        }
    }

    /// The value at `at`, which is no object, no array and no string.
    #[cold]
    fn parse_json5_scalar(&mut self, loc: Loc) -> PResult<Expr> {
        let p = self.at;
        if self.contents.get(p).is_some_and(|c| is_rare(*c)) && self.json5_peek().1 != p {
            return self.parse_value();
        }
        match self.contents.get(p) {
            None | Some(0) => return Err(self.json5_error(Json5Error::UnexpectedEof, p)),
            Some(b'}' | b']' | b':' | b',') => {
                return Err(self.json5_error(Json5Error::UnexpectedToken, p));
            }
            Some(_) => {}
        }
        let (leaf, end) = self.json5_leaf(p)?;
        let value = match leaf {
            Json5Leaf::String(it) => Expr::init(E::EString::init(it.slice()), loc),
            Json5Leaf::Number(it) => Expr::init(E::Number::new(it), loc),
            Json5Leaf::Boolean(value) => Expr::init(E::Boolean { value }, loc),
            Json5Leaf::Null => Expr::init(E::Null {}, loc),
            Json5Leaf::Identifier(it) => match it.slice() {
                b"NaN" => Expr::init(E::Number::new(f64::NAN), loc),
                b"Infinity" => Expr::init(E::Number::new(f64::INFINITY), loc),
                _ => return Err(self.json5_error(Json5Error::UnexpectedToken, p)),
            },
        };
        self.skip_from(end);
        Ok(value)
    }

    /// The name at `p`, which is not in double quotes.
    #[cold]
    fn parse_json5_name(&mut self, p: usize) -> PResult<E::Str> {
        match self.contents.get(p) {
            None | Some(0) => return Err(self.json5_error(Json5Error::UnexpectedEof, p)),
            Some(b'{' | b'}' | b'[' | b']' | b':' | b',') => {
                return Err(self.json5_error(Json5Error::InvalidIdentifier, p + 1));
            }
            Some(_) => {}
        }
        let (leaf, end) = self.json5_leaf(p)?;
        let name = match leaf {
            Json5Leaf::String(it) | Json5Leaf::Identifier(it) => it,
            Json5Leaf::Boolean(true) => E::Str::new(b"true"),
            Json5Leaf::Boolean(false) => E::Str::new(b"false"),
            Json5Leaf::Null => E::Str::new(b"null"),
            Json5Leaf::Number(_) => {
                return Err(self.json5_error(Json5Error::InvalidIdentifier, end));
            }
        };
        self.skip_from(end);
        Ok(name)
    }

    /// The token at `p`, which is no punctuation and not the end of the text, and where it ends.
    #[cold]
    fn json5_leaf(&mut self, p: usize) -> PResult<(Json5Leaf, usize)> {
        let c = self.contents[p];
        let keyword = match c {
            b't' => Some((b"true".as_slice(), Json5Leaf::Boolean(true))),
            b'f' => Some((b"false".as_slice(), Json5Leaf::Boolean(false))),
            b'n' => Some((b"null".as_slice(), Json5Leaf::Null)),
            _ => None,
        };
        if let Some((keyword, leaf)) = keyword
            && self.json5_is_keyword(p, keyword)
        {
            return Ok((leaf, p + keyword.len()));
        }
        match c {
            b'"' | b'\'' => {
                let (string, end) = self.json5_string(p)?;
                Ok((Json5Leaf::String(string), end))
            }
            b'+' | b'-' => {
                let (number, end) = self.json5_signed(p)?;
                Ok((Json5Leaf::Number(number), end))
            }
            b'0'..=b'9' | b'.' => {
                let (number, end) = self.json5_number(p)?;
                Ok((Json5Leaf::Number(number), end))
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' => {
                let (name, end) = self.json5_identifier(p)?;
                Ok((Json5Leaf::Identifier(name), end))
            }
            0x80.. if identifier::is_identifier_start(self.json5_code_point(p).0 as u32) => {
                let (name, end) = self.json5_identifier(p)?;
                Ok((Json5Leaf::Identifier(name), end))
            }
            _ => Err(self.json5_error(Json5Error::UnexpectedCharacter, p)),
        }
    }

    /// Whether `keyword` is at `p`, and no name that starts with it.
    fn json5_is_keyword(&self, p: usize, keyword: &[u8]) -> bool {
        let rest = &self.contents[p..];
        rest.starts_with(keyword)
            && !rest
                .get(keyword.len())
                .is_some_and(|c| is_identifier_continue(*c) || *c == b'\\' || *c >= 0x80)
    }

    /// The number behind the sign at `p`.
    fn json5_signed(&mut self, p: usize) -> PResult<(f64, usize)> {
        let is_negative = self.contents[p] == b'-';
        let (number, end) = match self.contents.get(p + 1) {
            Some(b'0'..=b'9' | b'.') => self.json5_number(p + 1)?,
            Some(b'I') if self.json5_is_keyword(p + 1, b"Infinity") => (f64::INFINITY, p + 9),
            Some(b'N') if self.json5_is_keyword(p + 1, b"NaN") => (f64::NAN, p + 4),
            None | Some(0) => {
                let error = match p == self.first_token {
                    true => Json5Error::UnexpectedEof,
                    false => Json5Error::UnexpectedToken,
                };
                return Err(self.json5_error(error, p));
            }
            Some(_) => return Err(self.json5_error(Json5Error::UnexpectedCharacter, p + 1)),
        };
        Ok((if is_negative { -number } else { number }, end))
    }

    fn json5_number(&mut self, start: usize) -> PResult<(f64, usize)> {
        let contents = self.contents;
        let digits = |from: usize| {
            let rest = contents.get(from..).unwrap_or_default();
            rest.iter().take_while(|c| c.is_ascii_digit()).count()
        };
        if contents[start] == b'0' {
            match contents.get(start + 1) {
                Some(b'x' | b'X') => return self.json5_hex_number(start),
                Some(b'0'..=b'9') => {
                    return Err(self.json5_error(Json5Error::LeadingZeros, start));
                }
                _ => {}
            }
        }
        let integer = digits(start);
        let mut pos = start + integer;
        let mut has_digits = integer > 0;
        if contents.get(pos) == Some(&b'.') {
            let fraction = digits(pos + 1);
            pos += 1 + fraction;
            has_digits |= fraction > 0;
        }
        if !has_digits {
            return Err(self.json5_error(Json5Error::InvalidNumber, pos));
        }
        if matches!(contents.get(pos), Some(b'e' | b'E')) {
            pos += 1;
            pos += usize::from(matches!(contents.get(pos), Some(b'+' | b'-')));
            let exponent = digits(pos);
            if exponent == 0 {
                return Err(self.json5_error(Json5Error::InvalidNumber, pos));
            }
            pos += exponent;
        }
        match bun_core::wtf::parse_double(&contents[start..pos]) {
            Ok(number) => Ok((number, pos)),
            Err(_) => Err(self.json5_error(Json5Error::InvalidNumber, pos)),
        }
    }

    fn json5_hex_number(&mut self, start: usize) -> PResult<(f64, usize)> {
        let digits = &self.contents[start + 2..];
        let len = digits.iter().take_while(|c| c.is_ascii_hexdigit()).count();
        let end = start + 2 + len;
        match bun_core::fmt::parse_int::<u64>(&digits[..len], 16) {
            Ok(value) if len > 0 => Ok((value as f64, end)),
            _ => Err(self.json5_error(Json5Error::InvalidHexNumber, end)),
        }
    }

    /// The string that starts at `open`, and where it ends.
    fn json5_string(&mut self, open: usize) -> PResult<(E::Str, usize)> {
        let contents = self.contents;
        let quote = contents[open];
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        let mut has_escape = false;
        // What is in `buf` is the value up to here.
        let mut copied_to = open + 1;
        let mut pos = open + 1;
        let end = loop {
            let plain = plain_len_of_any_text(contents.get(pos..).unwrap_or_default(), quote);
            let Some(plain) = plain else {
                break Err((Json5Error::UnterminatedString, contents.len()));
            };
            pos += plain;
            match contents[pos] {
                b'\\' => {
                    has_escape = true;
                    buf.extend_from_slice(&contents[copied_to..pos]);
                    match json5_escape(contents, pos + 1, &mut buf) {
                        Ok(end) => pos = end,
                        Err(error) => break Err(error),
                    }
                    copied_to = pos;
                }
                b'\n' | b'\r' => break Err((Json5Error::UnterminatedString, pos)),
                c if c == quote => break Ok(pos),
                // Other control characters are allowed.
                _ => pos += 1,
            }
        };
        let string = end.map(|end| match has_escape {
            false => (E::Str::new(&contents[open + 1..end]), end + 1),
            true => {
                buf.extend_from_slice(&contents[copied_to..end]);
                (self.alloc_owned_str(&buf), end + 1)
            }
        });
        self.scratch_str = buf;
        string.map_err(|(error, pos)| self.json5_error(error, pos))
    }

    /// The code point at `p`, and how many bytes it has. A byte that starts none counts for itself.
    fn json5_code_point(&self, p: usize) -> (i32, usize) {
        let first = self.contents[p];
        let len = usize::from(strings::wtf8_byte_sequence_length(first));
        let Some(sequence) = self.contents.get(p..p + len).filter(|_| first >= 0x80) else {
            return (i32::from(first), 1);
        };
        let mut bytes = [0u8; 4];
        bytes[..len].copy_from_slice(sequence);
        match strings::decode_wtf8_rune_t(bytes, len as u8, -1i32) {
            ..0 => (i32::from(first), 1),
            decoded => (decoded, len),
        }
    }

    /// The name without quotes that starts at `start`, and where it ends.
    fn json5_identifier(&mut self, start: usize) -> PResult<(E::Str, usize)> {
        let contents = self.contents;
        // All of it is ASCII, as a rule.
        let rest = &contents[start..];
        let len = rest
            .iter()
            .take_while(|c| is_identifier_continue(**c))
            .count();
        let goes_on = rest.get(len).is_some_and(|c| *c == b'\\' || *c >= 0x80);
        if len > 0 && !goes_on && !rest[0].is_ascii_digit() {
            return Ok((E::Str::new(&rest[..len]), start + len));
        }
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        let mut pos = start;
        let error = loop {
            if pos >= contents.len() {
                break None;
            }
            let is_first = pos == start;
            let is_allowed = |cp: i32| match is_first {
                true => identifier::is_identifier_start(cp as u32),
                false => identifier::is_identifier_part(cp as u32),
            };
            let (mut cp, len) = self.json5_code_point(pos);
            if cp == i32::from(b'\\') {
                if contents.get(pos + 1) != Some(&b'u') {
                    break Some((Json5Error::InvalidUnicodeEscape, pos + 1));
                }
                let (value, digits) = bun_core::fmt::parse_hex_prefix(&contents[pos + 2..], 4);
                pos += 2 + digits;
                if digits < 4 {
                    break Some((Json5Error::InvalidUnicodeEscape, pos));
                }
                cp = value as i32;
            } else if is_allowed(cp) {
                pos += len;
            }
            if !is_allowed(cp) {
                match is_first {
                    true => break Some((Json5Error::InvalidIdentifier, pos)),
                    false => break None,
                }
            }
            push_codepoint(&mut buf, cp);
        };
        let name = match buf == contents[start..pos] {
            true => E::Str::new(&contents[start..pos]),
            false => self.alloc_owned_str(&buf),
        };
        self.scratch_str = buf;
        match error {
            Some((error, pos)) => Err(self.json5_error(error, pos)),
            None => Ok((name, pos)),
        }
    }
}

/// What is wrong with a text that is not JSON5.
#[derive(Clone, Copy)]
enum Json5Error {
    UnexpectedCharacter,
    UnexpectedToken,
    UnexpectedEof,
    UnterminatedString,
    UnterminatedComment,
    UnterminatedObject,
    UnterminatedArray,
    UnterminatedEscape,
    InvalidNumber,
    LeadingZeros,
    InvalidHexNumber,
    InvalidHexEscape,
    InvalidUnicodeEscape,
    OctalEscape,
    ExpectedColon,
    ExpectedComma,
    ExpectedClosingBrace,
    ExpectedClosingBracket,
    InvalidIdentifier,
    TrailingData,
}

impl Json5Error {
    fn message(self) -> &'static [u8] {
        match self {
            Json5Error::UnexpectedCharacter => b"Unexpected character",
            Json5Error::UnexpectedToken => b"Unexpected token",
            Json5Error::UnexpectedEof => b"Unexpected end of input",
            Json5Error::UnterminatedString => b"Unterminated string",
            Json5Error::UnterminatedComment => b"Unterminated multi-line comment",
            Json5Error::UnterminatedObject => b"Unterminated object",
            Json5Error::UnterminatedArray => b"Unterminated array",
            Json5Error::UnterminatedEscape => b"Unexpected end of input in escape sequence",
            Json5Error::InvalidNumber => b"Invalid number",
            Json5Error::LeadingZeros => b"Leading zeros are not allowed in JSON5",
            Json5Error::InvalidHexNumber => b"Invalid hex number",
            Json5Error::InvalidHexEscape => b"Invalid hex escape",
            Json5Error::InvalidUnicodeEscape => b"Invalid unicode escape: expected 4 hex digits",
            Json5Error::OctalEscape => b"Octal escape sequences are not allowed in JSON5",
            Json5Error::ExpectedColon => b"Expected ':' after object key",
            Json5Error::ExpectedComma => b"Expected ','",
            Json5Error::ExpectedClosingBrace => b"Expected '}'",
            Json5Error::ExpectedClosingBracket => b"Expected ']'",
            Json5Error::InvalidIdentifier => b"Invalid identifier start character",
            Json5Error::TrailingData => b"Unexpected token after JSON5 value",
        }
    }
}

/// A token of JSON5 that is no punctuation.
enum Json5Leaf {
    String(E::Str),
    Number(f64),
    Boolean(bool),
    Null,
    Identifier(E::Str),
}

/// Appends what the escape sequence means whose backslash is before `pos`. Returns where it ends.
fn json5_escape(
    contents: &[u8],
    pos: usize,
    buf: &mut Vec<u8>,
) -> Result<usize, (Json5Error, usize)> {
    let Some(&c) = contents.get(pos) else {
        return Err((Json5Error::UnterminatedEscape, pos));
    };
    let mut pos = pos + 1;
    let hex = |pos: &mut usize, count: usize, error: Json5Error| {
        let rest = contents.get(*pos..).unwrap_or_default();
        let (value, digits) = bun_core::fmt::parse_hex_prefix(rest, count);
        *pos += digits;
        match digits < count {
            true => Err((error, *pos)),
            false => Ok(value),
        }
    };
    match c {
        b'b' => buf.push(0x08),
        b'f' => buf.push(0x0C),
        b'n' => buf.push(b'\n'),
        b'r' => buf.push(b'\r'),
        b't' => buf.push(b'\t'),
        b'v' => buf.push(0x0B),
        b'0' if !contents.get(pos).is_some_and(u8::is_ascii_digit) => buf.push(0),
        b'0'..=b'9' => return Err((Json5Error::OctalEscape, pos)),
        b'x' => {
            let value = hex(&mut pos, 2, Json5Error::InvalidHexEscape)?;
            push_codepoint(buf, value as CodePoint);
        }
        b'u' => {
            let lead = hex(&mut pos, 4, Json5Error::InvalidUnicodeEscape)?;
            if strings::u16_is_lead(lead as u16)
                && contents.get(pos..pos + 2) == Some(b"\\u".as_slice())
            {
                pos += 2;
                let trail = hex(&mut pos, 4, Json5Error::InvalidUnicodeEscape)?;
                match strings::decode_surrogate_pair(lead as u16, trail as u16) {
                    Some(pair) => push_codepoint(buf, pair as CodePoint),
                    None => {
                        push_codepoint(buf, lead as CodePoint);
                        push_codepoint(buf, trail as CodePoint);
                    }
                }
            } else {
                push_codepoint(buf, lead as CodePoint);
            }
        }
        // The line goes on.
        b'\r' => pos += usize::from(contents.get(pos) == Some(&b'\n')),
        b'\n' => {}
        0xE2 if matches!(contents.get(pos..pos + 2), Some([0x80, 0xA8 | 0xA9])) => pos += 2,
        _ => buf.push(c),
    }
    Ok(pos)
}

#[inline]
fn ident_len(t: &[u8]) -> usize {
    t.iter()
        .take_while(|&&c| is_identifier_continue(c))
        .count()
        .max(1)
}

#[inline]
fn push_codepoint(buf: &mut Vec<u8>, cp: CodePoint) {
    if cp < 0 {
        return;
    }
    let mut tmp = [0u8; 4];
    let n = strings::encode_wtf8_rune(&mut tmp, cp as u32);
    buf.extend_from_slice(&tmp[..n]);
}

fn read_trail_surrogate_escape(
    iterator: &strings::CodepointIterator<'_>,
    iter: &mut strings::Cursor,
) -> Option<u16> {
    let mut probe = *iter;
    if !iterator.next(&mut probe) || probe.c != '\\' as CodePoint {
        return None;
    }
    if !iterator.next(&mut probe) || probe.c != 'u' as CodePoint {
        return None;
    }
    let mut value: u32 = 0;
    for _ in 0..4 {
        if !iterator.next(&mut probe) {
            return None;
        }
        value = value * 16 + bun_core::fmt::hex_digit_value_u32(probe.c as u32)? as u32;
    }
    if !strings::u16_is_trail(value as u16) {
        return None;
    }
    *iter = probe;
    Some(value as u16)
}

/// Appends the value of `body`, which is what is between the quotes of a string, to `buf`.
fn decode_string_escapes<'s, L: LexerLog<'s, Err = crate::Error>>(
    l: &mut L,
    body: &[u8],
    buf: &mut Vec<u8>,
) -> PResult {
    let iterator = strings::CodepointIterator::init(body);
    let mut iter = strings::Cursor::default();
    loop {
        // Printable ASCII is copied as it is.
        let from = iter.i as usize + iter.width as usize;
        let rest = body.get(from..).unwrap_or_default();
        let plain = plain_ascii_len(rest);
        if plain > 0 {
            buf.extend_from_slice(&rest[..plain]);
            iter.i = (from + plain - 1) as u32;
            iter.width = 1;
        }
        if !iterator.next(&mut iter) {
            return Ok(());
        }
        let c = iter.c;
        if c != '\\' as CodePoint {
            if (0..0x20).contains(&c) {
                if c == 0x0A || c == 0x0D {
                    l.add_default_error(b"Unterminated string literal")?;
                } else {
                    l.syntax_error()?;
                }
                unreachable!()
            }
            push_codepoint(buf, c);
            continue;
        }
        if !iterator.next(&mut iter) {
            return Ok(());
        }
        let c2 = iter.c;
        match c2 as u32 {
            0x62 => buf.push(0x08),
            0x66 => buf.push(0x0c),
            0x6E => buf.push(0x0a),
            0x72 => buf.push(0x0d),
            0x74 => buf.push(0x09),
            0x76 => buf.push(0x0b),
            0x38 | 0x39 => push_codepoint(buf, c2),
            0x78 => {
                let mut value: CodePoint = 0;
                for _ in 0..2 {
                    if !iterator.next(&mut iter) {
                        return l.syntax_error();
                    }
                    match bun_core::fmt::hex_digit_value_u32(iter.c as u32) {
                        Some(d) => value = (value * 16) | d as CodePoint,
                        None => return l.syntax_error(),
                    }
                }
                push_codepoint(buf, value);
            }
            0x22 | 0x5C | 0x2F => buf.push(c2 as u8),
            0x75 => {
                let mut value: u32 = 0;
                for _ in 0..4 {
                    if !iterator.next(&mut iter) {
                        return l.syntax_error();
                    }
                    match bun_core::fmt::hex_digit_value_u32(iter.c as u32) {
                        Some(d) => value = value * 16 + d as u32,
                        None => return l.syntax_error(),
                    }
                }
                if strings::u16_is_lead(value as u16)
                    && let Some(lo) = read_trail_surrogate_escape(&iterator, &mut iter)
                {
                    value = strings::u16_get_supplementary(value as u16, lo);
                }
                push_codepoint(buf, value as CodePoint);
            }
            _ => return l.syntax_error(),
        }
    }
}
