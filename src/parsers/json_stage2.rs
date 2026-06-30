//! Stage 2 of the JSON parser: recursive descent over the structural index
//! built by [`crate::json_index`] (stage 1).
//!
//! The parser never iterates bytes of the document except:
//!   - inside string bodies that stage 1 marked dirty (escape or control
//!     character in the same 64-byte block) — everything else is zero-copy
//!   - inside number / keyword tokens (bounded by two consecutive indices)
//!   - in whitespace gaps, only on error paths and for `is_single_line`
//!     newline checks (gaps are empty in minified JSON)
//!
//! Accepted inputs (strict JSON plus the lenient extensions `JSONOptions`
//! gates), error messages, duplicate-key warnings, and `is_single_line` are
//! part of the parser's contract — differentially tested against
//! `JSON.parse`; see `json.rs` for the entry points.
//!
//! The only thing built here is the immutable JSON AST (`E::ObjectJSON`
//! / `E::ArrayJSON` rows on the document's [`E::JsonTape`], one `Expr` per
//! container); the classic `E::Object` tree some entry points return is
//! materialized from it at their boundary (`json::materialize`). Strings are
//! always UTF-8 (WTF-8 for lone surrogates), zero-copy from the source
//! unless they contain escapes.
use bun_alloc::Arena as Bump;
use bun_ast::LexerLog;
use bun_ast::expr::Data;
use bun_ast::{E, Expr, Loc, Log, Range, Source, usize2loc};
use bun_core::StackCheck;
use bun_core::strings;
use bun_core::strings::CodePoint;

use crate::json::JSONOptions;
use crate::json_index::{self as jidx, StructuralIndex};

type PResult<T = ()> = Result<T, bun_core::Error>;

/// Duplicate-key spill map (see [`Parser::check_duplicate_key`]). Keys are
/// already wyhash values, so the identity context hashes nothing.
type DupMap = bun_collections::HashMap<u64, (), bun_collections::IdentityContext<u64>>;

pub(crate) struct Parser<'a, 's, 'i> {
    contents: &'s [u8],
    source: &'s Source,
    log: &'a mut Log,
    idx: &'i mut StructuralIndex<'s>,
    pub cursor: usize,
    opts: JSONOptions,
    /// Start of the token currently being parsed; error locations point here.
    token_start: usize,
    prev_error_loc: Loc,
    stack_check: StackCheck,
    /// Reusable build stacks for container contents: a closing container's
    /// direct children are appended to the tape as one contiguous block.
    scratch_props: Vec<E::PropertyJSON>,
    scratch_json_items: Vec<E::JsonValue>,
    /// Parallel to the two stacks above when `opts.record_value_locs`: each
    /// property value's / item's start location, block-appended to the tape
    /// with its row. Empty otherwise.
    scratch_prop_value_locs: Vec<Loc>,
    scratch_item_locs: Vec<Loc>,
    /// Reused escape-decode buffer (`parse_string_slow`), cleared per string.
    scratch_str: Vec<u8>,
    /// The document's [`E::JsonTape`]. With [`E::TapeAlloc::Global`] it is
    /// heap-allocated and owned by the parser (raw, from `Box::leak`) until
    /// [`Self::take_tape`] hands it to the caller, and [`Drop`] reclaims it
    /// on the error paths that never get there. With [`E::TapeAlloc::Arena`]
    /// it lives in — and is bulk-freed with — the caller's arena, and the
    /// parser never frees it. `None` only after `take_tape`.
    tape: Option<core::ptr::NonNull<E::JsonTape>>,
    /// Whether `tape` is the parser's to free (`TapeAlloc::Global`).
    tape_owned: bool,
    /// Parallel to `scratch_props` (only when duplicate-key warnings
    /// are on): the wyhash of every key of the in-progress objects, so
    /// duplicate detection is a contiguous `u64` scan, not pointer-chasing.
    dup_hashes: Vec<u64>,
    /// Duplicate-key spill maps for objects with more than `DUP_LINEAR_MAX`
    /// keys, one per nesting level of such objects (`spill_depth` is the
    /// number currently active). Pooled across the document and cleared when
    /// their object closes, so each stays the size of one object.
    dup_maps: Vec<DupMap>,
    spill_depth: usize,
}

impl<'s> LexerLog<'s> for Parser<'_, 's, '_> {
    type Err = bun_core::Error;
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
    fn syntax_err() -> bun_core::Error {
        bun_core::err!("SyntaxError")
    }
}

/// A parse that errors out never reaches `take_tape`: reclaim the tape it
/// leaked in `new` (everything that pointed into it is unreachable).
impl Drop for Parser<'_, '_, '_> {
    fn drop(&mut self) {
        drop(self.take_tape());
    }
}

// JSON only ever needs the ASCII subset of identifier classification
// (keywords, `\uXXXX`-escaped keywords); everything else errors.
#[inline]
fn is_identifier_start(c: u8) -> bool {
    matches!(c, b'$' | b'_' | b'a'..=b'z' | b'A'..=b'Z')
}
#[inline]
fn is_identifier_continue(c: u8) -> bool {
    is_identifier_start(c) || c.is_ascii_digit()
}

/// Unicode whitespace accepted between any two tokens beyond ASCII
/// space/tab/newline: VT, FF, LS, PS, BOM, and the Zs space separators
/// (the JavaScript `WhiteSpace` / `LineTerminator` set).
#[inline]
pub(crate) fn is_exotic_whitespace(cp: CodePoint) -> bool {
    matches!(cp, 0x000B | 0x000C | 0x2028 | 0x2029 | 0xFEFF)
        || strings::is_unicode_space_separator(cp as u32)
}

impl<'a, 's, 'i> Parser<'a, 's, 'i> {
    pub(crate) fn new(
        source: &'s Source,
        log: &'a mut Log,
        idx: &'i mut StructuralIndex<'s>,
        opts: JSONOptions,
        tape_alloc: E::TapeAlloc,
    ) -> Self {
        // The document's tape: a leaked `Box` the parser owns until it hands
        // it to the caller (`Global`), or a value in the caller's arena that
        // the arena owns from the start (`Arena` — nothing here, including
        // an early-error `Drop`, may free it).
        let (tape, tape_owned) = match tape_alloc {
            E::TapeAlloc::Global => (
                core::ptr::NonNull::from(Box::leak(Box::new(E::JsonTape::empty()))),
                true,
            ),
            E::TapeAlloc::Arena(arena) => {
                // SAFETY: the caller's arena (lifetime-erased) outlives the
                // parse and the AST.
                let arena: &Bump = unsafe { arena.as_ref() };
                (
                    core::ptr::NonNull::from(&*arena.alloc(E::JsonTape::empty_in(tape_alloc))),
                    false,
                )
            }
        };
        Parser {
            contents: &source.contents,
            source,
            log,
            idx,
            cursor: 0,
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
        }
    }

    /// Hand the document's [`E::JsonTape`] — and ownership of it, when the
    /// parser owns it — to the caller. The AST just produced borrows the
    /// tape, so it must outlive every use of the root `Expr`; an
    /// arena-allocated tape (`None` here) is already owned by the arena.
    pub(crate) fn take_tape(&mut self) -> Option<Box<E::JsonTape>> {
        let tape = self.tape.take()?;
        if !self.tape_owned {
            return None;
        }
        // SAFETY: `tape` came from `Box::leak` in `new` (`tape_owned`) and
        // is given out exactly once (`take`); nothing else frees it.
        Some(unsafe { Box::from_raw(tape.as_ptr()) })
    }

    /// Does some string indexed so far contain a `\` or a control character?
    /// (If not, no string seen by the parser needs its body scanned.)
    #[inline(always)]
    fn any_string_needs_scan(&self) -> bool {
        self.idx.flags & (jidx::FLAG_HAS_BACKSLASH_IN_STRING | jidx::FLAG_HAS_CTRL_IN_STRING) != 0
    }

    // ── token cursor ─────────────────────────────────────────────────────

    /// Byte position of the cursor's index (the sentinel yields `len`).
    #[inline(always)]
    fn pos_at(&mut self, cursor: usize) -> usize {
        self.idx.at(cursor)
    }

    /// The bytes of the scalar run starting at index `cursor`
    /// (`[idx[cursor], idx[cursor+1])`).
    #[inline(always)]
    fn run(&mut self, cursor: usize) -> &'s [u8] {
        let (a, b) = (self.pos_at(cursor), self.pos_at(cursor + 1));
        &self.contents[a..b]
    }

    /// Range of the token at `cursor` for error reporting: scalar runs are
    /// trimmed to their non-whitespace extent, strings span quote to quote.
    fn token_range(&mut self, cursor: usize) -> Range {
        let p = self.pos_at(cursor);
        if p >= self.contents.len() {
            return Range {
                loc: usize2loc(self.contents.len()),
                len: 0,
            };
        }
        let len = match self.contents[p] {
            b'{' | b'}' | b'[' | b']' | b':' | b',' => 1,
            b'"' | b'\'' => {
                let close = self.pos_at(cursor + 1);
                if close < self.contents.len() && self.contents[close] == self.contents[p] {
                    close + 1 - p
                } else {
                    1
                }
            }
            _ => {
                let run = self.run(cursor);
                let mut e = run.len();
                while e > 0 && (run[e - 1] == b' ' || run[e - 1].is_ascii_whitespace()) {
                    e -= 1;
                }
                e.max(1)
            }
        };
        Range {
            loc: usize2loc(p),
            len: len as i32,
        }
    }

    /// "Unexpected X" + `ParserError` (the JS lexer's `unexpected()`
    /// message shape, which callers' error matchers depend on).
    #[cold]
    fn unexpected(&mut self, cursor: usize) -> bun_core::Error {
        let r = self.token_range(cursor);
        let p = self.pos_at(cursor);
        if p >= self.contents.len() {
            let _ = self.add_range_error(r, format_args!("Unexpected end of file"));
        } else {
            let raw = &self.contents[p..p + (r.len as usize).max(1)];
            let _ = self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)));
        }
        bun_core::err!("ParserError")
    }

    /// Log "Expected X but found Y". Every caller fails the parse after
    /// logging (some via [`Self::unexpected`], which adds its own message).
    #[cold]
    fn expected(&mut self, cursor: usize, what: &str) {
        let r = self.token_range(cursor);
        let p = self.pos_at(cursor);
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

    /// The per-character "Unsupported syntax: ..." hard errors for JS-only
    /// punctuation reached outside of strings (any other junk byte flows to
    /// `expected`/`unexpected` instead).
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

    /// Error for a junk byte at a token position: either
    /// "Unsupported syntax: ..." (for JS punctuation) or "Unexpected x".
    #[cold]
    fn junk_byte_error(&mut self, cursor: usize, pos: usize, c: u8) -> bun_core::Error {
        if let Some(msg) = Self::js_punct_message(c) {
            // "Unsupported syntax" diagnostics point at the position just
            // past the offending character.
            self.add_error(pos + 1, format_args!("Unsupported syntax: {msg}"));
            return bun_core::err!("SyntaxError");
        }
        self.unexpected(cursor)
    }

    /// Exotic unicode whitespace (BOM, NBSP, U+2028, VT, FF, ...) is
    /// accepted between any two tokens. Those bytes are not whitespace to
    /// stage 1 (they are ordinary scalar-run bytes), so this works on byte
    /// positions: decode codepoints forward from the current token position
    /// until the first non-whitespace one — stepping over any comment that
    /// follows it with no intervening ASCII whitespace, which therefore
    /// lives inside the same index run — then resync the cursor onto the
    /// index containing (or starting at) that position.
    ///
    /// Returns the first non-whitespace byte position, which is either
    /// exactly at `pos_at(cursor)` (a fresh token) or inside the cursor's
    /// run, or `None` at end of input.
    #[cold]
    fn skip_unicode_ws(&mut self) -> Option<usize> {
        let start = self.pos_at(self.cursor);
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
            if p >= self.contents.len() || !self.opts.allow_comments || self.contents[p] != b'/' {
                break;
            }
            match self.contents.get(p + 1) {
                Some(b'/') => {
                    p += 2;
                    while p < self.contents.len()
                        && !matches!(self.contents[p], b'\n' | b'\r')
                        && !jidx::is_ls_ps(self.contents, p)
                    {
                        p += 1;
                    }
                }
                Some(b'*') => {
                    // The indexer rejects unterminated block comments
                    // before stage 2 runs; treat one as end of input.
                    let Some(close) = strings::index_of(&self.contents[p + 2..], b"*/") else {
                        p = self.contents.len();
                        break 'outer;
                    };
                    p += 2 + close as usize + 2;
                }
                // A `/` that opens no comment: the indexer already
                // reported it; stop here.
                _ => break,
            }
        }
        if p >= self.contents.len() {
            // Trailing whitespace: park the cursor on the sentinel.
            while self.pos_at(self.cursor) < self.contents.len() {
                self.cursor += 1;
            }
            return None;
        }
        // Advance past every index that is entirely behind `p`.
        while self.pos_at(self.cursor) < p && self.pos_at(self.cursor + 1) <= p {
            self.cursor += 1;
        }
        Some(p)
    }

    /// Token byte at the cursor (0xFF at end of input), skipping exotic
    /// whitespace first.
    #[inline(always)]
    fn peek_byte(&mut self) -> u8 {
        self.peek().0
    }

    /// [`Self::peek_byte`] plus the byte position of the cursor's index after
    /// the skip (== `pos_at(self.cursor)`, the sentinel `len` at end of
    /// input), so container loops resolve both in one window access.
    #[inline(always)]
    fn peek(&mut self) -> (u8, usize) {
        let p = self.pos_at(self.cursor);
        if p >= self.contents.len() {
            return (0xFF, p);
        }
        let b = self.contents[p];
        if b >= 0x80 || b == 0x0B || b == 0x0C {
            let b = match self.skip_unicode_ws() {
                None => 0xFF,
                Some(np) => self.contents[np],
            };
            return (b, self.pos_at(self.cursor));
        }
        (b, p)
    }

    /// Is there a newline in the whitespace gap immediately before byte `p`?
    /// (`has_newline_before` of the token starting at `p`, which the cursor
    /// points at; drives `is_single_line`.) In minified documents the gap is
    /// empty (the byte before `p` already decides), so only that byte is
    /// examined inline.
    #[inline(always)]
    fn newline_before(&mut self, p: usize) -> bool {
        if p == 0 {
            // Start of file counts as a newline before it.
            return true;
        }
        match self.contents[p - 1] {
            b'\n' | b'\r' => true,
            // Anything else defers to the gap scan, which also steps over
            // comments (a newline inside `/* … */` still breaks the line).
            _ => self.newline_in_gap_before(p),
        }
    }

    /// See [`Self::newline_before`]: the rest of a non-empty whitespace gap.
    ///
    /// Everything between the end of the previous token and `p` is the gap:
    /// whitespace, (JSONC) comments, exotic-whitespace runs the cursor
    /// skipped — and the unscanned tail of the previous token, which can
    /// never contain a raw newline (a string with one is a syntax error; no
    /// other token spans lines). So "is there a newline before this token",
    /// including one hidden inside a block comment, is "does any byte after
    /// the previous *token* and before `p` equal `\n` or `\r`".
    fn newline_in_gap_before(&mut self, p: usize) -> bool {
        // Walk back to the previous index that is a token (not a skipped
        // run of exotic whitespace, which is part of the gap). A token index
        // is a structural byte, a quote, or the first byte of a scalar run;
        // string bodies (the only token bytes that can hold arbitrary
        // newline-free data) end at their closing-quote index. The walk is
        // bounded by the index window's look-behind; layouts with that many
        // separate whitespace runs before one token give up (cosmetic).
        let mut hi = p;
        for step in 1..=(jidx::LOOKBEHIND - 2) {
            if self.cursor < step {
                // Start of file counts as a newline before it.
                return true;
            }
            let j = self.cursor - step;
            let q = self.pos_at(j);
            let b = self.contents[q];
            let run = self.run(j);
            if (b >= 0x80 || b == 0x0B || b == 0x0C) && self.rest_is_ws_cold(run) {
                if self.contents[q..hi]
                    .iter()
                    .any(|&b| matches!(b, b'\n' | b'\r'))
                {
                    return true;
                }
                hi = q;
                continue;
            }
            return self.contents[q + 1..hi]
                .iter()
                .any(|&b| matches!(b, b'\n' | b'\r'));
        }
        false
    }

    // ── values ───────────────────────────────────────────────────────────

    /// After the root value, only whitespace may remain (used by the
    /// `CHECK_LEN` entry point). Exotic unicode whitespace appears as
    /// scalar-run indices; plain ASCII whitespace never produces an index.
    pub(crate) fn at_trailing_end(&mut self) -> bool {
        loop {
            let p = self.pos_at(self.cursor);
            if p >= self.contents.len() {
                return true;
            }
            let run = self.run(self.cursor);
            let b = run[0];
            if (b >= 0x80 || b == 0x0B || b == 0x0C) && self.rest_is_ws_cold(run) {
                self.cursor += 1;
                continue;
            }
            return false;
        }
    }

    /// "Unexpected X" at the cursor + `ParserError`.
    pub(crate) fn unexpected_here(&mut self) -> bun_core::Error {
        self.unexpected(self.cursor)
    }

    /// A value as an `Expr`: only the document root (and the exotic-
    /// whitespace re-dispatch) needs one — containers inside the document
    /// are [`E::JsonValue`] rows (see [`Self::parse_json_value`]).
    pub(crate) fn parse_value(&mut self) -> PResult<Expr> {
        let cursor = self.cursor;
        let start = self.pos_at(cursor);
        if start >= self.contents.len() {
            self.token_start = self.contents.len();
            return Err(self.unexpected(cursor));
        }
        let loc = usize2loc(start);
        self.token_start = start;
        match self.contents[start] {
            b'{' => self.parse_object(loc),
            b'[' => self.parse_array(loc),
            b'"' | b'\'' => {
                let s = self.parse_string()?;
                Ok(Expr::init(s, loc))
            }
            _ => self.parse_scalar(loc),
        }
    }

    /// The document's [`E::JsonTape`].
    #[inline]
    fn tape_ref(&self) -> &'a E::JsonTape {
        // SAFETY: heap-allocated in `Parser::new`; the lifetime-erased
        // contract is that the caller keeps it alive for the AST's lifetime.
        unsafe { self.tape.expect("the tape was already taken").as_ref() }
    }

    /// The document's [`E::JsonTape`], mutably. The parser is its only
    /// writer; nothing reads it until parsing returns.
    #[inline]
    fn tape_mut(&mut self) -> &mut E::JsonTape {
        // SAFETY: see `tape_ref`; exclusively owned until `take_tape`.
        unsafe { self.tape.expect("the tape was already taken").as_mut() }
    }

    /// Append `scratch_props[mark..]` (one closing object's direct
    /// children, contiguous on top of the scratch stack) as a block to the
    /// property tape and return its `(first, count)` span.
    fn push_props_block(&mut self, mark: usize) -> (u32, u32) {
        // SAFETY: see `tape_mut`. The raw-derived `&mut` is not a borrow of
        // `self`, so the (disjoint, parser-owned) scratch stack can be read
        // alongside it.
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

    /// See [`Self::push_props_block`]; the array-item tape.
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

    /// A container's child value: nested containers and strings become
    /// inline [`E::JsonValue`]s (no `Expr`, no Store node); every other kind
    /// of token goes through the ordinary scalar path, whose `Expr` payload
    /// is inline in `Data` (numbers, booleans, null) — so the only Store
    /// traffic in a document is one node per container.
    ///
    /// Also returns the value's location (its first non-whitespace byte —
    /// a scalar's index run can begin with exotic unicode whitespace),
    /// recorded in the tape for [`crate::json::materialize`].
    #[inline(always)]
    fn parse_json_value(&mut self) -> PResult<(E::JsonValue, Loc)> {
        let cursor = self.cursor;
        let start = self.pos_at(cursor);
        if start >= self.contents.len() {
            self.token_start = self.contents.len();
            return Err(self.unexpected(cursor));
        }
        let loc = usize2loc(start);
        self.token_start = start;
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
            b'"' | b'\'' => Ok((E::JsonValue::String(self.parse_string_utf8_at(start)?), loc)),
            _ => {
                let e = self.parse_scalar(loc)?;
                let value_loc = e.loc;
                Ok((
                    match e.data {
                        Data::ENumber(n) => E::JsonValue::Number(n),
                        Data::EBoolean(b) => E::JsonValue::Boolean(b.value),
                        Data::ENull(_) => E::JsonValue::Null,
                        // `.env` auto-quoting and `\uXXXX`-escaped identifiers
                        // can produce a string from the scalar path.
                        Data::EString(r) => E::JsonValue::String(r.get().data),
                        // Exotic whitespace before the value re-dispatches
                        // through `parse_value::<true>`, which can return a
                        // container.
                        Data::EObjectJSON(r) => E::JsonValue::Object(r),
                        Data::EArrayJSON(r) => E::JsonValue::Array(r),
                        _ => unreachable!("not a JSON leaf"),
                    },
                    value_loc,
                ))
            }
        }
    }

    // ── strings ──────────────────────────────────────────────────────────

    /// Locate the body of the string whose opening quote is at `open` (the
    /// byte position of the cursor's index, which every caller has already
    /// resolved) and whether it needs a body scan (a `\` or a control
    /// character may be inside). Advances the cursor past both quote indices.
    #[inline(always)]
    fn string_body_at(&mut self, open: usize) -> PResult<(&'s [u8], bool)> {
        let i = self.cursor;
        debug_assert_eq!(open, self.pos_at(i));
        let close = self.pos_at(i + 1);
        let quote = self.contents[open];
        self.token_start = open;
        if close >= self.contents.len() || self.contents[close] != quote {
            // Stage 1 found no partner quote.
            self.add_default_error(b"Unterminated string literal")?;
            unreachable!()
        }
        self.cursor = i + 2;
        let body = &self.contents[open + 1..close];
        let dirty =
            self.any_string_needs_scan() && self.idx.is_dirty(open + 1, close.max(open + 1));
        Ok((body, dirty))
    }

    /// Parse the string whose opening quote is at the cursor's index into an
    /// `E::String` node (the document root; everything nested stores the
    /// bare [`E::Str`] of [`Self::parse_string_utf8_at`]).
    fn parse_string(&mut self) -> PResult<E::EString> {
        let open = self.pos_at(self.cursor);
        Ok(E::EString::init(self.parse_string_utf8_at(open)?.slice()))
    }

    /// [`Self::parse_string`] for callers that only keep the string's bytes:
    /// the clean-string fast path is just the body slice, no `E::EString`.
    /// `open` is the opening quote's byte position (`pos_at(self.cursor)`),
    /// which every caller has already resolved.
    #[inline(always)]
    fn parse_string_utf8_at(&mut self, open: usize) -> PResult<E::Str> {
        let (body, dirty) = self.string_body_at(open)?;
        if dirty {
            return Ok(self.parse_string_slow(body)?.data);
        }
        Ok(E::Str::new(body))
    }

    /// Copy decoded string bytes the AST keeps alive into the document's
    /// [`E::JsonTape`] (which owns everything the AST allocates).
    fn alloc_owned_str(&mut self, bytes: &[u8]) -> E::Str {
        self.tape_mut().alloc_str(bytes)
    }

    /// Dirty-block path: find the first `\` or control character; decode if
    /// escaped, error on raw control characters, zero-copy otherwise.
    #[cold]
    fn parse_string_slow(&mut self, body: &'s [u8]) -> PResult<E::EString> {
        let mut first_special = None;
        for (k, &b) in body.iter().enumerate() {
            if b == b'\\' || b < 0x20 {
                first_special = Some(k);
                break;
            }
        }
        let Some(k) = first_special else {
            return Ok(E::EString::init(body));
        };
        if body[k] != b'\\' {
            // Raw control character inside a string.
            return Err(self.string_control_char_error(body[k]));
        }
        // Escape decode, with the main loop's raw-control-character check
        // folded in. The decoded bytes are WTF-8: lone surrogates from
        // `\uXXXX` keep their 3-byte encoding, which the printer and
        // `to_js` both understand.
        // One reusable decode buffer per parser: this path runs once per
        // escaped string, which large registry manifests hit thousands of
        // times.
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        self.decode_escapes(body, &mut buf)?;
        let owned = self.alloc_owned_str(&buf);
        self.scratch_str = buf;
        Ok(E::EString::init(owned.slice()))
    }

    #[cold]
    fn string_control_char_error(&mut self, c: u8) -> bun_core::Error {
        // \r and \n end the line => "Unterminated string literal"; any other
        // raw control character is a plain syntax error.
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

    /// See [`decode_string_escapes`].
    #[inline]
    fn decode_escapes(&mut self, body: &[u8], buf: &mut Vec<u8>) -> PResult {
        decode_string_escapes::<false, _>(self, body, buf)
    }

    // ── scalars (numbers, keywords, junk) ────────────────────────────────

    /// Parse the scalar run at the cursor. Hot for `true`/`false`/`null` and
    /// numbers; everything else is the cold path.
    fn parse_scalar(&mut self, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let run = self.run(cursor);
        debug_assert!(!run.is_empty());
        match run[0] {
            b't' if run.len() >= 4 && &run[..4] == b"true" && self.run_rest_is_ws(cursor, 4) => {
                self.cursor += 1;
                Ok(Expr::init(E::Boolean { value: true }, loc))
            }
            b'f' if run.len() >= 5 && &run[..5] == b"false" && self.run_rest_is_ws(cursor, 5) => {
                self.cursor += 1;
                Ok(Expr::init(E::Boolean { value: false }, loc))
            }
            b'n' if run.len() >= 4 && &run[..4] == b"null" && self.run_rest_is_ws(cursor, 4) => {
                self.cursor += 1;
                Ok(Expr::init(E::Null {}, loc))
            }
            b'0'..=b'9' | b'.' | b'-' => self.parse_number(loc),
            _ => self.parse_scalar_cold(loc),
        }
    }

    /// After a keyword/number of `n` bytes, the rest of its run must be
    /// whitespace (it is almost always empty).
    #[inline]
    fn run_rest_is_ws(&mut self, cursor: usize, n: usize) -> bool {
        let run = self.run(cursor);
        run.len() == n || self.rest_is_ws_cold(&run[n..])
    }

    /// ASCII whitespace fast check + the cold fallback for everything else
    /// a scalar run's tail may legally hold: exotic unicode whitespace and,
    /// in the comment dialects, comments (`1 /* note */,` — the indexer
    /// emits no index inside a comment, so its bytes stay in the run).
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
                b'/' if self.opts.allow_comments => match rest.get(i + 1) {
                    Some(b'/') => {
                        i += 2;
                        while i < rest.len() && !matches!(rest[i], b'\n' | b'\r') {
                            i += 1;
                        }
                    }
                    Some(b'*') => {
                        // The indexer guarantees `*/` exists (an unterminated
                        // block comment is an index error before stage 2).
                        let Some(close) = rest[i + 2..].windows(2).position(|w| w == b"*/") else {
                            return false;
                        };
                        i += 2 + close + 2;
                    }
                    _ => return false,
                },
                _ => {
                    // One (possibly exotic-whitespace) codepoint.
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

    // ── containers ───────────────────────────────────────────────────────

    fn parse_array(&mut self, loc: Loc) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(bun_core::err!("StackOverflow"));
        }
        self.cursor += 1; // [
        let mark = self.scratch_json_items.len();
        // `peek` skips any exotic-whitespace runs so `here` is the first
        // real token (or closer) inside the container.
        let (_, here) = self.peek();
        let mut is_single_line = !self.newline_before(here);
        let mut close_loc = Loc::EMPTY;
        let result: PResult = loop {
            let (b, p) = self.peek();
            let cursor = self.cursor;
            if p >= self.contents.len() {
                // Unterminated array: hard error.
                self.token_start = self.contents.len();
                self.expected(cursor, "\"]\"");
                break Err(bun_core::err!("ParserError"));
            }
            if b == b']' {
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                close_loc = usize2loc(p);
                self.cursor += 1;
                break Ok(());
            }
            if self.scratch_json_items.len() != mark {
                // Expect a `,` here.
                if b != b',' {
                    if let Some(msg) = Self::js_punct_message(b) {
                        self.add_error(p + 1, format_args!("Unsupported syntax: {msg}"));
                        break Err(bun_core::err!("SyntaxError"));
                    }
                    self.expected(cursor, "\",\"");
                    break Err(bun_core::err!("ParserError"));
                }
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                self.cursor += 1; // ,
                let (after_b, after) = self.peek();
                if after_b == b']' {
                    // Trailing comma.
                    if !self.opts.allow_trailing_commas {
                        let r = Range {
                            loc: usize2loc(p),
                            len: 1,
                        };
                        let _ = self.add_range_error(
                            r,
                            format_args!("JSON does not support trailing commas"),
                        );
                    }
                    if is_single_line && self.newline_before(after) {
                        is_single_line = false;
                    }
                    close_loc = usize2loc(after);
                    self.cursor += 1; // ]
                    break Ok(());
                }
                if is_single_line && self.newline_before(after) {
                    is_single_line = false;
                }
            }
            // See the object loop: the item's location is recorded in
            // lockstep with the item itself.
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
            E::ArrayJSON::new(self.tape_ref(), first, count, is_single_line, close_loc),
            loc,
        ))
    }

    fn parse_object(&mut self, loc: Loc) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(bun_core::err!("StackOverflow"));
        }
        self.cursor += 1; // {
        let mark = self.scratch_props.len();
        let hmark = self.dup_hashes.len();
        // `peek` skips any exotic-whitespace runs so `here` is the first
        // real token (or closer) inside the container.
        let (_, here) = self.peek();
        let mut is_single_line = !self.newline_before(here);
        let mut close_loc = Loc::EMPTY;
        let warn_dup = self.opts.json_warn_duplicate_keys;

        let result: PResult = loop {
            let (mut b, mut p) = self.peek();
            let cursor = self.cursor;
            if p >= self.contents.len() {
                // Unterminated object: hard error.
                self.token_start = self.contents.len();
                self.expected(cursor, "\"}\"");
                break Err(bun_core::err!("ParserError"));
            }
            if b == b'}' {
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                close_loc = usize2loc(p);
                self.cursor += 1;
                break Ok(());
            }
            if self.scratch_props.len() != mark {
                if b != b',' {
                    if let Some(msg) = Self::js_punct_message(b) {
                        self.add_error(p + 1, format_args!("Unsupported syntax: {msg}"));
                        break Err(bun_core::err!("SyntaxError"));
                    }
                    self.expected(cursor, "\",\"");
                    break Err(bun_core::err!("ParserError"));
                }
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                self.cursor += 1; // ,
                let (after_b, after) = self.peek();
                if after_b == b'}' {
                    if !self.opts.allow_trailing_commas {
                        let r = Range {
                            loc: usize2loc(p),
                            len: 1,
                        };
                        let _ = self.add_range_error(
                            r,
                            format_args!("JSON does not support trailing commas"),
                        );
                    }
                    if is_single_line && self.newline_before(after) {
                        is_single_line = false;
                    }
                    close_loc = usize2loc(after);
                    self.cursor += 1; // }
                    break Ok(());
                }
                if is_single_line && self.newline_before(after) {
                    is_single_line = false;
                }
                b = after_b;
                p = after;
            }

            // ── key ──
            let key_cursor = self.cursor;
            // `peek` already resolved the cursor's byte position.
            let key_start = p;
            debug_assert_eq!(key_start, self.pos_at(key_cursor));
            self.token_start = key_start;
            let key = if b == b'"' || b == b'\'' {
                match self.parse_string_utf8_at(key_start) {
                    Ok(d) => d,
                    Err(e) => break Err(e),
                }
            } else {
                // Not a string key: "Expected string but found X", then bail
                // out of the object.
                self.expected(key_cursor, "string");
                break Err(self.unexpected(key_cursor));
            };
            let key_loc = usize2loc(key_start);

            if warn_dup && self.check_duplicate_key(mark, hmark, key.slice()) {
                // Cold: the warning is the only consumer of the key's full
                // range (`token_range` re-derives it from the index window).
                let key_range = self.token_range(key_cursor);
                self.warn_duplicate_key(key.slice(), key_range);
            }

            // ── : ──
            let colon_b = self.peek_byte();
            let colon_cursor = self.cursor;
            if colon_b == b':' {
                self.cursor += 1;
            } else {
                self.expected(colon_cursor, "\":\"");
                break Err(bun_core::err!("ParserError"));
            }

            // ── value ──
            // The value and its location, recorded for `materialize` so it
            // never re-scans the source. Pushed together with the row: a
            // nested container inside this value pushes its own rows and
            // locations in between.
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
        // If this object spilled past the linear window, release its map.
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
            E::ObjectJSON::new(self.tape_ref(), first, count, is_single_line, close_loc),
            loc,
        ))
    }

    /// Number of keys an object can have before duplicate detection switches
    /// from a linear scan of the object's key hashes to the spill map.
    const DUP_LINEAR_MAX: usize = 32;

    /// Is `key` (decoded UTF-8) a duplicate of an earlier key of the object
    /// whose properties start at `scratch_props[mark]` /
    /// `dup_hashes[hmark]`? Records the key.
    ///
    /// Hash-first: small objects scan their contiguous hash stack and confirm
    /// a hit by comparing the actual keys. An object past `DUP_LINEAR_MAX`
    /// keys spills to a hash map of its own: `dup_maps[spill_depth - 1]`,
    /// taken when the object crosses the threshold and released (cleared)
    /// when it closes, so nested large objects each have their own map and
    /// every map stays the size of a single object. (A first version shared
    /// one map across the document, which both let a nested large object
    /// poison its parent's membership test and made the map monotonically
    /// grow: on a large registry manifest a quarter of the parse went to
    /// growing and probing it.)
    fn check_duplicate_key(&mut self, mark: usize, hmark: usize, key: &[u8]) -> bool {
        let h = bun_wyhash::hash(key);
        let n_prior = self.dup_hashes.len() - hmark;
        let dup = if n_prior <= Self::DUP_LINEAR_MAX {
            if n_prior == Self::DUP_LINEAR_MAX {
                // The object is getting big: take this nesting level's map
                // and seed it with everything so far (the map was left
                // cleared by whichever object used it last).
                if self.dup_maps.len() == self.spill_depth {
                    self.dup_maps.push(DupMap::default());
                }
                let map = &mut self.dup_maps[self.spill_depth];
                self.spill_depth += 1;
                debug_assert!(map.is_empty());
                for &ph in &self.dup_hashes[hmark..] {
                    map.insert(ph, ());
                }
                // The current key goes in too: later keys only consult the
                // map, so leaving it out would never warn on its duplicates.
                map.insert(h, ());
            }
            match self.dup_hashes[hmark..].iter().position(|&ph| ph == h) {
                None => false,
                Some(i) => {
                    // Hash hit: confirm against the real key (the property at
                    // `mark + i` — hashes and completed properties stay in
                    // step because the hash is pushed before the value).
                    self.scratch_props[mark + i].key.slice() == key
                }
            }
        } else {
            // This object's map: it is the innermost spilled object, since
            // any large object opened after it has already been closed (and
            // released its map) by the time we are back parsing its keys.
            self.dup_maps[self.spill_depth - 1].insert(h, ()).is_some()
        };
        self.dup_hashes.push(h);
        dup
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

    // ── numbers ──────────────────────────────────────────────────────────

    /// Numeric literal at the cursor's run, ported from the JS lexer's
    /// `parse_numeric_literal_or_dot`: decimal/hex/octal/binary, legacy
    /// octal, `_` separators, exponent, and the "identifier cannot follow a
    /// number" check.
    fn parse_number(&mut self, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let full_run = self.run(cursor);
        let start = self.pos_at(cursor);

        // `-` is its own token, so `- 5` (whitespace between) is accepted.
        // A `-` run with nothing else defers to the next run.
        let (neg, num_off, num_run): (bool, usize, &[u8]) = if full_run[0] == b'-' {
            if full_run.len() > 1 && !self.rest_is_ws_cold(&full_run[1..]) {
                if !matches!(full_run[1], b'0'..=b'9' | b'.') {
                    self.expected(cursor, "number");
                    return Err(self.unexpected(cursor));
                }
                (true, 1, &full_run[1..])
            } else {
                // The digits are the next run (if any).
                self.cursor += 1;
                let next = self.cursor;
                let p = self.pos_at(next);
                if p >= self.contents.len() || !matches!(self.contents[p], b'0'..=b'9' | b'.') {
                    self.expected(next, "number");
                    return Err(self.unexpected(next));
                }
                self.token_start = p;
                let run = self.run(next);
                let (value, used) = self.parse_number_text(run, p)?;
                if !self.rest_is_ws_cold(&run[used..]) {
                    return Err(self.number_trailing_junk(p + used));
                }
                self.cursor += 1;
                return Ok(Expr::init(E::Number::new(-value), loc));
            }
        } else {
            (false, 0, full_run)
        };

        let (value, used) = self.parse_number_text(num_run, start + num_off)?;
        if !self.rest_is_ws_cold(&num_run[used..]) {
            return Err(self.number_trailing_junk(start + num_off + used));
        }
        self.cursor += 1;
        let value = if neg { -value } else { value };
        Ok(Expr::init(E::Number::new(value), loc))
    }

    #[cold]
    fn number_trailing_junk(&mut self, pos: usize) -> bun_core::Error {
        let c = self.contents[pos];
        if is_identifier_start(c) || c == b'\\' {
            // "An identifier can't immediately follow a number."
            self.token_start = pos;
            match self.syntax_error() {
                Err(e) => e,
                Ok(()) => unreachable!(),
            }
        } else {
            // The previous token (the number) is at `cursor - 1`; report the
            // junk byte itself.
            self.junk_byte_error(self.cursor, pos, c)
        }
    }

    /// Parses one numeric literal at the start of `t` (no sign), returning
    /// (value, bytes consumed). `pos` is its absolute offset (for errors).
    fn parse_number_text(&mut self, t: &[u8], pos: usize) -> PResult<(f64, usize)> {
        self.token_start = pos;
        let n = t.len();
        let first = t[0];
        let mut i = 1;

        // `.` with no digit after it is a syntax error in JSON.
        if first == b'.' && (n < 2 || !t[1].is_ascii_digit()) {
            return Err(self.syntax_err_at(pos));
        }

        // Radix literals.
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

        // Decimal: digits ( . digits )? ( [eE] [+-]? digits )?, with `_`
        // separators.
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
        // BigInt suffix: JSON has no bigint literal, so the trailing `n`
        // falls into the identifier-start error below.
        let text = &t[..i];
        let value: f64 = if !has_dot_or_exp && !underscores && text.len() < 10 {
            // Fast path: short integers.
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
            // All bytes are ASCII digits/./e/+/-.
            match core::str::from_utf8(digits)
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
            {
                Some(v) => v,
                None => {
                    self.add_error(pos, format_args!("Invalid number"));
                    return Err(bun_core::err!("SyntaxError"));
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
            // Re-parse as decimal (e.g. `018` is 18).
            let text = &t[..i];
            let s = core::str::from_utf8(text).expect("ascii");
            match s.parse::<f64>() {
                Ok(v) => value = v,
                Err(_) => {
                    self.add_error(
                        pos,
                        format_args!("Invalid number {}", bstr::BStr::new(text)),
                    );
                    return Err(bun_core::err!("SyntaxError"));
                }
            }
        }
        Ok((value, i))
    }

    #[cold]
    fn syntax_err_at(&mut self, pos: usize) -> bun_core::Error {
        self.token_start = pos;
        match self.syntax_error() {
            Err(e) => e,
            Ok(()) => unreachable!(),
        }
    }

    // ── cold scalar path ─────────────────────────────────────────────────

    /// Scalar runs that are not `true`/`false`/`null` or a number: exotic
    /// unicode whitespace, `\uXXXX`-escaped identifiers, identifiers, and
    /// garbage. Never taken by well-formed JSON.
    #[cold]
    fn parse_scalar_cold(&mut self, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let run = self.run(cursor);
        let start = self.pos_at(cursor);

        // Leading unicode whitespace (BOM, NBSP, LS/PS, VT, FF...): decode it
        // away from the source, then either re-dispatch on a fresh token or
        // parse the rest of the run the first real byte lands in.
        if run[0] >= 0x80 || run[0] == 0x0B || run[0] == 0x0C {
            let Some(p) = self.skip_unicode_ws() else {
                // Nothing but whitespace where a value was expected.
                self.token_start = self.contents.len();
                return Err(self.unexpected(self.cursor));
            };
            if p != start {
                if p == self.pos_at(self.cursor) {
                    // Whitespace-only run (BOM, exotic unicode spaces):
                    // re-dispatch on the next token.
                    return self.parse_value();
                }
                return self.parse_scalar_tail(p);
            }
        }

        // `\uXXXX`-escaped identifiers: an escaped keyword is still that
        // keyword (yes, really).
        if run[0] == b'\\' {
            return self.parse_escaped_identifier(loc);
        }

        if is_identifier_start(run[0]) {
            // An identifier that isn't a keyword: "Unexpected x".
            return Err(self.unexpected(cursor));
        }
        if run[0] >= 0x80 {
            return Err(self.unexpected(cursor));
        }
        Err(self.junk_byte_error(cursor, start, run[0]))
    }

    /// Re-dispatch a value that starts mid-run (after leading exotic
    /// whitespace): only numbers, keywords, escaped identifiers, or junk are
    /// possible (strings and containers always start their own index).
    #[cold]
    fn parse_scalar_tail(&mut self, pos: usize) -> PResult<Expr> {
        let end = self.pos_at(self.cursor + 1);
        let tail = &self.contents[pos..end];
        let loc_tail = usize2loc(pos);
        self.token_start = pos;
        match tail[0] {
            b't' if tail.starts_with(b"true") && self.rest_is_ws_cold(&tail[4..]) => {
                self.cursor += 1;
                Ok(Expr::init(E::Boolean { value: true }, loc_tail))
            }
            b'f' if tail.starts_with(b"false") && self.rest_is_ws_cold(&tail[5..]) => {
                self.cursor += 1;
                Ok(Expr::init(E::Boolean { value: false }, loc_tail))
            }
            b'n' if tail.starts_with(b"null") && self.rest_is_ws_cold(&tail[4..]) => {
                self.cursor += 1;
                Ok(Expr::init(E::Null {}, loc_tail))
            }
            b'0'..=b'9' | b'.' | b'-' => {
                // `parse_number_text` takes no sign; strip a leading `-`,
                // which must be followed by a digit or `.`.
                let (neg, body, body_pos) = if tail[0] == b'-' {
                    if tail.len() < 2 || !matches!(tail[1], b'0'..=b'9' | b'.') {
                        self.expected(self.cursor, "number");
                        return Err(self.unexpected(self.cursor));
                    }
                    (true, &tail[1..], pos + 1)
                } else {
                    (false, tail, pos)
                };
                let (value, used) = self.parse_number_text(body, body_pos)?;
                if !self.rest_is_ws_cold(&body[used..]) {
                    return Err(self.number_trailing_junk(body_pos + used));
                }
                self.cursor += 1;
                let value = if neg { -value } else { value };
                Ok(Expr::init(E::Number::new(value), loc_tail))
            }
            c if is_identifier_start(c) => {
                let r = Range {
                    loc: usize2loc(pos),
                    len: ident_len(tail) as i32,
                };
                let raw = &tail[..ident_len(tail)];
                let _ =
                    self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)));
                Err(bun_core::err!("ParserError"))
            }
            b'\\' => self.parse_escaped_identifier(loc_tail),
            c => Err(self.junk_byte_error(self.cursor, pos, c)),
        }
    }

    /// A `\uXXXX`-escaped spelling of `true` / `false` / `null`: port of
    /// the JS lexer's `scan_identifier_with_escapes` (the JSON-relevant
    /// subset: the decoded identifier must be one of those keywords).
    #[cold]
    fn parse_escaped_identifier(&mut self, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let run = self.run(cursor);
        let start = self.pos_at(cursor);
        self.token_start = start;
        // First pass: validate the escape syntax and find the extent.
        let mut i = 0;
        while i < run.len() {
            let c = run[i];
            if c == b'\\' {
                if run.get(i + 1) != Some(&b'u') {
                    return self.syntax_error().map(|_| unreachable!());
                }
                i += 2;
                // Exactly four hex digits: JSON escapes have no `\u{...}`
                // form (the decode pass rejects it too).
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
            return Err(self.junk_byte_error(self.cursor, pos, self.contents[pos]));
        }
        // Second pass: decode and match keywords.
        let mut buf: Vec<u8> = Vec::with_capacity(text.len());
        self.decode_escapes(text, &mut buf)?;
        self.cursor += 1;
        match buf.as_slice() {
            b"true" => Ok(Expr::init(E::Boolean { value: true }, loc)),
            b"false" => Ok(Expr::init(E::Boolean { value: false }, loc)),
            b"null" => Ok(Expr::init(E::Null {}, loc)),
            _ => {
                self.cursor -= 1;
                Err(self.unexpected(self.cursor))
            }
        }
    }
}

#[inline]
fn ident_len(t: &[u8]) -> usize {
    t.iter()
        .take_while(|&&c| is_identifier_continue(c))
        .count()
        .max(1)
}

/// Append `cp` to `buf` as WTF-8 (1–4 bytes; surrogate code points get the
/// 3-byte encoding the rest of the pipeline understands).
#[inline]
fn push_codepoint(buf: &mut Vec<u8>, cp: CodePoint) {
    if cp < 0 {
        return;
    }
    let mut tmp = [0u8; 4];
    let n = strings::encode_wtf8_rune(&mut tmp, cp as u32);
    buf.extend_from_slice(&tmp[..n]);
}

/// After a high-surrogate `\uXXXX`, consume an *immediately following*
/// low-surrogate `\uXXXX` and return its value. The cursor is advanced only
/// on a match; on `None` it is untouched and the caller re-reads the next
/// codepoint normally.
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

/// Decode the escapes of a string body into WTF-8 bytes, plus the enclosing
/// scan loop's check that runs before it: raw control characters are errors
/// ("Unterminated string literal" for `\r`/`\n`, a plain syntax error
/// otherwise). A `\uXXXX` high surrogate immediately followed by a `\uXXXX`
/// low surrogate is one code point; an unpaired surrogate keeps its own
/// 3-byte WTF-8 encoding (`JSON.parse` round-trips it as a lone code unit).
/// Generic over the error reporter so the `.env` auto-quote path can reuse
/// it without a full parser.
/// `ALLOW_RAW_CONTROL`: a real string literal rejects raw control characters
/// in its body; an implicitly-quoted `.env`/`--define` value (the whole
/// input is the "string") passes them through — it can legitimately contain
/// newlines and tabs.
fn decode_string_escapes<
    's,
    const ALLOW_RAW_CONTROL: bool,
    L: LexerLog<'s, Err = bun_core::Error>,
>(
    l: &mut L,
    body: &[u8],
    buf: &mut Vec<u8>,
) -> PResult {
    let iterator = strings::CodepointIterator::init(body);
    let mut iter = strings::Cursor::default();
    while iterator.next(&mut iter) {
        let c = iter.c;
        if c != '\\' as CodePoint {
            if !ALLOW_RAW_CONTROL && (0..0x20).contains(&c) {
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
        // Escape sequence. A trailing backslash is silently accepted.
        if !iterator.next(&mut iter) {
            return Ok(());
        }
        let c2 = iter.c;
        match c2 as u32 {
            0x62 => buf.push(0x08),                 // \b
            0x66 => buf.push(0x0c),                 // \f
            0x6E => buf.push(0x0a),                 // \n
            0x72 => buf.push(0x0d),                 // \r
            0x74 => buf.push(0x09),                 // \t
            0x76 => buf.push(0x0b),                 // \v (accepted, technically invalid)
            0x38 | 0x39 => push_codepoint(buf, c2), // \8 \9
            0x78 => {
                // \xNN
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
            0x22 | 0x5C | 0x2F => buf.push(c2 as u8), // " \ /
            0x75 => {
                // \uXXXX
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
    Ok(())
}

/// Minimal [`LexerLog`] for paths that have no parser (the `.env` auto-quote
/// string decoder). Errors point at the start of the source.
struct MiniLog<'a, 's> {
    log: &'a mut Log,
    source: &'s Source,
    prev_error_loc: Loc,
}

impl<'s> LexerLog<'s> for MiniLog<'_, 's> {
    type Err = bun_core::Error;
    fn log_mut(&mut self) -> &mut Log {
        self.log
    }
    fn source(&self) -> &'s Source {
        self.source
    }
    fn prev_error_loc_mut(&mut self) -> &mut Loc {
        &mut self.prev_error_loc
    }
    fn start(&self) -> usize {
        0
    }
    fn syntax_err() -> bun_core::Error {
        bun_core::err!("SyntaxError")
    }
}

/// Decode the body of an implicitly-quoted `.env`/`--define` value (the
/// "auto quote" path): escape sequences are processed and the result is
/// stored as a UTF-8 `E::String` in `bump`, exactly like a string literal
/// the JSON entry points decode.
pub(crate) fn decode_auto_quoted(
    source: &Source,
    log: &mut Log,
    bump: &Bump,
    body: &[u8],
    opts: JSONOptions,
) -> Result<E::String, bun_core::Error> {
    let mut l = MiniLog {
        log,
        source,
        prev_error_loc: Loc::EMPTY,
    };
    let mut body = body;
    if opts.ignore_leading_escape_sequences && body.first() == Some(&b'\\') {
        body = &body[1..];
    }
    let mut buf: Vec<u8> = Vec::with_capacity(body.len());
    decode_string_escapes::<true, _>(&mut l, body, &mut buf)?;
    Ok(E::String::init(bump.alloc_slice_copy(&buf)))
}
