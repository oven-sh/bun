//! The JSON / JSONC parser: one pass of recursive descent over the text into the immutable JSON AST
//! (`E::JsonTape` rows). White space is skipped where it is met, and a string is stepped through
//! with the kernel that the lexer of JavaScript reads its strings with.
//!
//! A *token* starts at a `{ } [ ] : ,`, at a quote, or at the first byte of a run of bytes that are
//! none of these, no ` \t\n\r` and in no comment. So a run can be `true`, `12`, `true`, or white
//! space that is not ASCII with what follows it. `at` is always at the start of a token or at the end
//! of the text.
use bun_alloc::Arena as Bump;
use bun_ast::LexerLog;
use bun_ast::expr::Data;
use bun_ast::{E, Expr, Loc, Log, Range, Source};
use bun_core::StackCheck;
use bun_core::strings;
use bun_core::strings::CodePoint;
use bun_highway::index_of_interesting_character_in_string_literal as plain_len;

use crate::json::JSONOptions;
use crate::json_index::{IndexError, is_ls_ps};
use crate::json_stage2::{
    ident_len, is_exotic_whitespace, push_codepoint, read_trail_surrogate_escape,
};

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

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGH_BITS: u64 = 0x8080_8080_8080_8080;

/// A bit in each of `bytes` that is `quote`, a backslash or a control character, exact up to the first.
#[inline(always)]
fn special_bytes(bytes: &[u8; 8], quote: u8) -> u64 {
    let word = u64::from_le_bytes(*bytes);
    // A byte that is zero, or less than 0x20, borrows. What is not ASCII is never meant.
    let is_quote = (word ^ (ONES * u64::from(quote))).wrapping_sub(ONES);
    let is_backslash = (word ^ (ONES * u64::from(b'\\'))).wrapping_sub(ONES);
    let is_control = word.wrapping_sub(ONES * 0x20);
    (is_quote | is_backslash | is_control) & !word & HIGH_BITS
}

/// How many of the first 16 bytes of `text` are before the first `quote`, backslash or control
/// character. 0 if `text` is shorter.
#[inline(always)]
fn short_plain_len(text: &[u8], quote: u8) -> usize {
    let Some((first, rest)) = text.split_first_chunk::<8>() else {
        return 0;
    };
    let Some(second) = rest.first_chunk::<8>() else {
        return 0;
    };
    let found = special_bytes(first, quote);
    if found != 0 {
        return (found.trailing_zeros() / 8) as usize;
    }
    // 64 zeros if there is none.
    8 + (special_bytes(second, quote).trailing_zeros() / 8) as usize
}

/// How many bytes at the start of `text` are ASCII, no backslash and no control character.
#[inline]
fn plain_ascii_len(text: &[u8]) -> usize {
    let Some((first, rest)) = text.split_first_chunk::<8>() else {
        let is_plain = |b: &&u8| (0x20..0x80).contains(*b) && **b != b'\\';
        return text.iter().take_while(is_plain).count();
    };
    let found = special_bytes(first, b'\\') | (u64::from_le_bytes(*first) & HIGH_BITS);
    if found != 0 {
        return (found.trailing_zeros() / 8) as usize;
    }
    8 + plain_len(rest, b'\\').unwrap_or(rest.len())
}

#[inline(always)]
fn loc_at(p: usize) -> Loc {
    // No text has more than `i32::MAX` bytes.
    Loc { start: p as i32 }
}

/// How many bytes of `text` are before the first `quote`, backslash or control character. For text
/// that is not ASCII, at which the kernel stops.
fn plain_len_by_words(text: &[u8], quote: u8) -> Option<usize> {
    let mut i = 0;
    while let Some(bytes) = text.get(i..).and_then(|rest| rest.first_chunk::<8>()) {
        let found = special_bytes(bytes, quote);
        if found != 0 {
            return Some(i + (found.trailing_zeros() / 8) as usize);
        }
        i += 8;
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
                // The indentation of the line, by words.
                while let Some(bytes) = contents.get(at..).and_then(|it| it.first_chunk::<8>()) {
                    let other = u64::from_le_bytes(*bytes) ^ (ONES * u64::from(b' '));
                    at += (other.trailing_zeros() / 8) as usize;
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

    /// The start of the first token at `i` or behind it. `is_in_run`: `i` is behind a byte of a run.
    /// `is_escaped`: that byte is a backslash which is not escaped itself.
    #[cold]
    fn token_from(&mut self, mut i: usize, mut is_in_run: bool, mut is_escaped: bool) -> usize {
        let contents = self.contents;
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
            Some(b'{' | b'}' | b'[' | b']' | b':' | b',') => self.token_from(p + 1, false, false),
            Some(&c) => self.token_from(p + 1, true, c == b'\\'),
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
                false => plain_len_by_words(rest, quote)?,
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
                    Some(close) => self.token_from(close + 1, false, false),
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

    pub(crate) fn unexpected_here(&mut self) -> crate::Error {
        self.unexpected(self.at)
    }

    // ───────────────────────────── values ─────────────────────────────

    pub(crate) fn parse_value(&mut self) -> PResult<Expr> {
        let start = self.at;
        if start >= self.contents.len() {
            self.token_start = self.contents.len();
            return Err(self.unexpected(start));
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
            self.token_start = self.contents.len();
            return Err(self.unexpected(start));
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

    /// The string at `at`.
    #[inline(always)]
    fn parse_string_utf8(&mut self) -> PResult<E::Str> {
        let open = self.at;
        let quote = self.contents[open];
        let rest = &self.contents[open + 1..];
        let len = short_plain_len(rest, quote);
        if rest.get(len) == Some(&quote) {
            self.skip_from(open + len + 2);
            return Ok(E::Str::new(&rest[..len]));
        }
        self.parse_long_string(open, open + 1 + len)
    }

    /// A string of more than 16 bytes, at the end of the text, or with a backslash or a control
    /// character in it. None of them, and no quote, is before `from`.
    #[inline(never)]
    fn parse_long_string(&mut self, open: usize, from: usize) -> PResult<E::Str> {
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
            return Err(self.too_deeply_nested(loc));
        }
        self.bump();
        let mark = self.scratch_json_items.len();
        self.peek();
        let mut is_single_line = !self.is_after_newline();
        let mut close_loc = Loc::EMPTY;
        let result: PResult = loop {
            let (b, p) = self.peek();
            if p >= self.contents.len() {
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
            unsafe { E::ArrayJSON::new(self.tape_ptr(), first, count, is_single_line, close_loc) },
            loc,
        ))
    }

    fn parse_object(&mut self, loc: Loc) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.too_deeply_nested(loc));
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
            let key = if b == b'"' || b == b'\'' {
                match self.parse_string_utf8() {
                    Ok(d) => d,
                    Err(e) => break Err(e),
                }
            } else {
                self.expected(key_start, "string");
                break Err(self.unexpected(key_start));
            };
            let key_loc = loc_at(key_start);

            if warn_dup && self.check_duplicate_key(mark, hmark, key.slice()) {
                let key_range = self.token_range(key_start);
                self.warn_duplicate_key(key.slice(), key_range);
            }

            if self.peek_byte() == b':' {
                self.bump();
            } else {
                self.expected(self.at, "\":\"");
                break Err(crate::Error::ParserError);
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
            unsafe { E::ObjectJSON::new(self.tape_ptr(), first, count, is_single_line, close_loc) },
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
