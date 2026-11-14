//! Stage 2 of the JSON parser: recursive descent over the structural index built by
//! [`crate::json_index`] (stage 1) into the immutable JSON AST (`E::JsonTape` rows).
use bun_alloc::Arena as Bump;
use bun_ast::LexerLog;
use bun_ast::expr::Data;
use bun_ast::{E, Expr, Loc, Log, Range, Source, usize2loc};
use bun_core::StackCheck;
use bun_core::strings;
use bun_core::strings::CodePoint;
use bun_simdutf_sys::simdutf;

use crate::json::JSONOptions;
use crate::json_index::{self as jidx, StructuralIndex};

type PResult<T = ()> = crate::Result<T>;

type DupMap = bun_collections::HashMap<u64, (), bun_collections::IdentityContext<u64>>;

pub(crate) struct Parser<'a, 's, 'i> {
    contents: &'s [u8],
    source: &'s Source<'s>,
    log: &'a mut Log,
    idx: &'i mut StructuralIndex<'s>,
    pub cursor: usize,
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

impl<'s> LexerLog<'s> for Parser<'_, 's, '_> {
    type Err = crate::Error;
    #[inline]
    fn log_mut(&mut self) -> &mut Log {
        self.log
    }
    #[inline]
    fn source(&self) -> &'s Source<'s> {
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

impl Drop for Parser<'_, '_, '_> {
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

#[inline]
pub(crate) fn is_exotic_whitespace(cp: CodePoint) -> bool {
    matches!(cp, 0x000B | 0x000C | 0x2028 | 0x2029 | 0xFEFF)
        || strings::is_unicode_space_separator(cp as u32)
}

impl<'a, 's, 'i> Parser<'a, 's, 'i> {
    pub(crate) fn new(
        source: &'s Source<'s>,
        log: &'a mut Log,
        idx: &'i mut StructuralIndex<'s>,
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

    pub(crate) fn take_tape(&mut self) -> Option<Box<E::JsonTape>> {
        let tape = self.tape.take()?;
        if !self.tape_owned {
            return None;
        }
        // SAFETY: `tape` came from `Box::leak` in `new` (`tape_owned`) and is taken exactly once.
        Some(unsafe { Box::from_raw(tape.as_ptr()) })
    }

    #[inline(always)]
    fn any_string_needs_scan(&self) -> bool {
        self.idx.flags & (jidx::FLAG_HAS_BACKSLASH_IN_STRING | jidx::FLAG_HAS_CTRL_IN_STRING) != 0
    }

    #[inline(always)]
    fn pos_at(&mut self, cursor: usize) -> usize {
        self.idx.at(cursor)
    }

    #[inline(always)]
    fn run(&mut self, cursor: usize) -> &'s [u8] {
        let (a, b) = (self.pos_at(cursor), self.pos_at(cursor + 1));
        &self.contents[a..b]
    }

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

    #[cold]
    fn unexpected(&mut self, cursor: usize) -> crate::Error {
        let r = self.token_range(cursor);
        let p = self.pos_at(cursor);
        if p >= self.contents.len() {
            let _ = self.add_range_error(r, format_args!("Unexpected end of file"));
        } else {
            let raw = &self.contents[p..p + (r.len as usize).max(1)];
            let raw = bun_core::fmt::escape_control_chars(raw);
            let _ = self.add_range_error(r, format_args!("Unexpected {raw}"));
        }
        crate::Error::ParserError
    }

    #[cold]
    fn expected(&mut self, cursor: usize, what: &str) {
        let r = self.token_range(cursor);
        let p = self.pos_at(cursor);
        if p >= self.contents.len() {
            let _ = self.add_range_error(r, format_args!("Expected {what} but found end of file"));
        } else {
            let raw = &self.contents[p..p + (r.len as usize).max(1)];
            let raw = bun_core::fmt::escape_control_chars(raw);
            let _ = self.add_range_error(r, format_args!("Expected {what} but found \"{raw}\""));
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
    fn junk_byte_error(&mut self, cursor: usize, pos: usize, c: u8) -> crate::Error {
        if let Some(msg) = Self::js_punct_message(c) {
            self.add_error(pos + 1, format_args!("Unsupported syntax: {msg}"));
            return crate::Error::SyntaxError;
        }
        self.unexpected(cursor)
    }

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
            if p >= self.contents.len() || self.contents[p] != b'/' {
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
                    let Some(close) = strings::index_of(&self.contents[p + 2..], b"*/") else {
                        p = self.contents.len();
                        break 'outer;
                    };
                    p += 2 + close as usize + 2;
                }
                _ => break,
            }
        }
        if p >= self.contents.len() {
            while self.pos_at(self.cursor) < self.contents.len() {
                self.cursor += 1;
            }
            return None;
        }
        while self.pos_at(self.cursor) < p && self.pos_at(self.cursor + 1) <= p {
            self.cursor += 1;
        }
        Some(p)
    }

    #[inline(always)]
    fn peek_byte(&mut self) -> u8 {
        self.peek().0
    }

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

    #[inline(always)]
    fn newline_before(&mut self, p: usize) -> bool {
        if p == 0 {
            return true;
        }
        match self.contents[p - 1] {
            b'\n' | b'\r' => true,
            _ => self.newline_in_gap_before(p),
        }
    }

    fn newline_in_gap_before(&mut self, p: usize) -> bool {
        let mut hi = p;
        for step in 1..=(jidx::LOOKBEHIND - 2) {
            if self.cursor < step {
                return true;
            }
            let j = self.cursor - step;
            let q = self.pos_at(j);
            let b = self.contents[q];
            let run = self.run(j);
            if (b >= 0x80 || b == 0x0B || b == 0x0C) && self.rest_is_ws_cold(run) {
                if strings::contains_any(&self.contents[q..hi], b"\n\r") {
                    return true;
                }
                hi = q;
                continue;
            }
            return strings::contains_any(&self.contents[q + 1..hi], b"\n\r");
        }
        false
    }

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

    pub(crate) fn unexpected_here(&mut self) -> crate::Error {
        self.unexpected(self.cursor)
    }

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

    #[inline(always)]
    fn string_body_at(&mut self, open: usize) -> PResult<(&'s [u8], bool)> {
        let i = self.cursor;
        debug_assert_eq!(open, self.pos_at(i));
        let close = self.pos_at(i + 1);
        let quote = self.contents[open];
        self.token_start = open;
        if close >= self.contents.len() || self.contents[close] != quote {
            self.add_default_error(b"Unterminated string literal")?;
            unreachable!()
        }
        self.cursor = i + 2;
        let body = &self.contents[open + 1..close];
        let dirty =
            self.any_string_needs_scan() && self.idx.is_dirty(open + 1, close.max(open + 1));
        Ok((body, dirty))
    }

    fn parse_string(&mut self) -> PResult<E::EString> {
        let open = self.pos_at(self.cursor);
        Ok(E::EString::init(self.parse_string_utf8_at(open)?.slice()))
    }

    #[inline(always)]
    fn parse_string_utf8_at(&mut self, open: usize) -> PResult<E::Str> {
        let (body, dirty) = self.string_body_at(open)?;
        if dirty {
            return Ok(self.parse_string_slow(body)?.data);
        }
        Ok(E::Str::new(body))
    }

    fn alloc_owned_str(&mut self, bytes: &[u8]) -> E::Str {
        self.tape_mut().alloc_str(bytes)
    }

    #[cold]
    fn parse_string_slow(&mut self, body: &'s [u8]) -> PResult<E::EString> {
        if self.idx.flags & jidx::FLAG_HAS_CTRL_IN_STRING != 0 {
            return self.parse_string_by_code_point(body);
        }
        // No string so far has a control character, so a string with no backslash is its text.
        let first = text_len(body);
        if first == body.len() {
            return Ok(E::EString::init(body));
        }
        self.decode_string(body, first)
    }

    /// `parse_string_slow` for a string with a backslash: `first` is the place of the first one.
    #[inline(never)]
    fn decode_string(&mut self, body: &'s [u8], first: usize) -> PResult<E::EString> {
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        let plain = decode_plain_text(body, first, &mut buf);
        if plain < body.len() {
            // The rest starts with a byte that is not UTF-8, or with a bad escape.
            self.decode_escapes(&body[plain..], &mut buf)?;
        }
        let owned = self.alloc_owned_str(&buf);
        self.scratch_str = buf;
        Ok(E::EString::init(owned.slice()))
    }

    /// What `parse_string_slow` does if a string of the document has a control character.
    #[cold]
    #[inline(never)]
    fn parse_string_by_code_point(&mut self, body: &'s [u8]) -> PResult<E::EString> {
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
            return Err(self.string_control_char_error(body[k]));
        }
        let mut buf = core::mem::take(&mut self.scratch_str);
        buf.clear();
        self.decode_escapes(body, &mut buf)?;
        let owned = self.alloc_owned_str(&buf);
        self.scratch_str = buf;
        Ok(E::EString::init(owned.slice()))
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
        decode_string_escapes::<false, _>(self, body, buf)
    }

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

    #[inline]
    fn run_rest_is_ws(&mut self, cursor: usize, n: usize) -> bool {
        let run = self.run(cursor);
        run.len() == n || self.rest_is_ws_cold(&run[n..])
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
        self.cursor += 1;
        let mark = self.scratch_json_items.len();
        let (_, here) = self.peek();
        let mut is_single_line = !self.newline_before(here);
        let mut close_loc = Loc::EMPTY;
        let result: PResult = loop {
            let (b, p) = self.peek();
            let cursor = self.cursor;
            if p >= self.contents.len() {
                self.token_start = self.contents.len();
                self.expected(cursor, "\"]\"");
                break Err(crate::Error::ParserError);
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
                if b != b',' {
                    if let Some(msg) = Self::js_punct_message(b) {
                        self.add_error(p + 1, format_args!("Unsupported syntax: {msg}"));
                        break Err(crate::Error::SyntaxError);
                    }
                    self.expected(cursor, "\",\"");
                    break Err(crate::Error::ParserError);
                }
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                self.cursor += 1;
                let (after_b, after) = self.peek();
                if after_b == b']' {
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
                    self.cursor += 1;
                    break Ok(());
                }
                if is_single_line && self.newline_before(after) {
                    is_single_line = false;
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
        self.cursor += 1;
        let mark = self.scratch_props.len();
        let hmark = self.dup_hashes.len();
        let (_, here) = self.peek();
        let mut is_single_line = !self.newline_before(here);
        let mut close_loc = Loc::EMPTY;
        let warn_dup = self.opts.json_warn_duplicate_keys;

        let result: PResult = loop {
            let (mut b, mut p) = self.peek();
            let cursor = self.cursor;
            if p >= self.contents.len() {
                self.token_start = self.contents.len();
                self.expected(cursor, "\"}\"");
                break Err(crate::Error::ParserError);
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
                        break Err(crate::Error::SyntaxError);
                    }
                    self.expected(cursor, "\",\"");
                    break Err(crate::Error::ParserError);
                }
                if is_single_line && self.newline_before(p) {
                    is_single_line = false;
                }
                self.cursor += 1;
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
                    self.cursor += 1;
                    break Ok(());
                }
                if is_single_line && self.newline_before(after) {
                    is_single_line = false;
                }
                b = after_b;
                p = after;
            }

            let key_cursor = self.cursor;
            let key_start = p;
            debug_assert_eq!(key_start, self.pos_at(key_cursor));
            self.token_start = key_start;
            let key = if b == b'"' || b == b'\'' {
                match self.parse_string_utf8_at(key_start) {
                    Ok(d) => d,
                    Err(e) => break Err(e),
                }
            } else {
                self.expected(key_cursor, "string");
                break Err(self.unexpected(key_cursor));
            };
            let key_loc = usize2loc(key_start);

            if warn_dup && self.check_duplicate_key(mark, hmark, key.slice()) {
                let key_range = self.token_range(key_cursor);
                self.warn_duplicate_key(key.slice(), key_range);
            }

            let colon_b = self.peek_byte();
            let colon_cursor = self.cursor;
            if colon_b == b':' {
                self.cursor += 1;
            } else {
                self.expected(colon_cursor, "\":\"");
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
                bun_core::fmt::escape_control_chars(key_text)
            ),
        );
    }

    fn parse_number(&mut self, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let full_run = self.run(cursor);
        let start = self.pos_at(cursor);

        if full_run[0] == b'-' {
            return self.parse_negative_number_at(start, loc);
        }

        let (value, used) = self.parse_number_text(full_run, start)?;
        if !self.rest_is_ws_cold(&full_run[used..]) {
            return Err(self.number_trailing_junk(start + used));
        }
        self.cursor += 1;
        Ok(Expr::init(E::Number::new(value), loc))
    }

    #[cold]
    fn parse_negative_number_at(&mut self, minus_pos: usize, loc: Loc) -> PResult<Expr> {
        self.token_start = minus_pos;
        let contents = self.contents;
        let Some(q) = crate::json::skip_ws_and_comments(contents, minus_pos + 1) else {
            while self.pos_at(self.cursor) < contents.len() {
                self.cursor += 1;
            }
            self.expected(self.cursor, "number");
            return Err(self.unexpected(self.cursor));
        };
        while self.pos_at(self.cursor) < q && self.pos_at(self.cursor + 1) <= q {
            self.cursor += 1;
        }
        if !matches!(contents[q], b'0'..=b'9' | b'.') {
            self.expected(self.cursor, "number");
            return Err(self.unexpected(self.cursor));
        }
        self.token_start = q;
        let run = &contents[q..self.pos_at(self.cursor + 1)];
        let (value, used) = self.parse_number_text(run, q)?;
        if !self.rest_is_ws_cold(&run[used..]) {
            return Err(self.number_trailing_junk(q + used));
        }
        self.cursor += 1;
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
            self.junk_byte_error(self.cursor, pos, c)
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
        let mut integer = bun_core::fmt::RadixInteger::default();
        let mut is_first = true;
        let mut is_invalid_legacy_octal = false;
        let mut last_underscore_end: usize = usize::MAX;
        let bits_per_digit = radix.trailing_zeros();
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
            integer.push_digit(bits_per_digit, digit);
            i += 1;
            is_first = false;
        }
        if is_first {
            return Err(self.syntax_err_at(pos));
        }
        if last_underscore_end != usize::MAX && i == last_underscore_end + 1 {
            return Err(self.syntax_err_at(pos));
        }
        let mut value = integer.to_f64();
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
        let cursor = self.cursor;
        let run = self.run(cursor);
        let start = self.pos_at(cursor);

        if run[0] >= 0x80 || run[0] == 0x0B || run[0] == 0x0C {
            let Some(p) = self.skip_unicode_ws() else {
                self.token_start = self.contents.len();
                return Err(self.unexpected(self.cursor));
            };
            if p != start {
                if p == self.pos_at(self.cursor) {
                    return self.parse_value();
                }
                return self.parse_scalar_tail(p);
            }
        }

        if run[0] == b'\\' {
            return self.parse_escaped_identifier(start, loc);
        }

        if is_identifier_start(run[0]) {
            return Err(self.unexpected(cursor));
        }
        if run[0] >= 0x80 {
            return Err(self.unexpected(cursor));
        }
        Err(self.junk_byte_error(cursor, start, run[0]))
    }

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
            b'-' => self.parse_negative_number_at(pos, loc_tail),
            b'0'..=b'9' | b'.' => {
                let (value, used) = self.parse_number_text(tail, pos)?;
                if !self.rest_is_ws_cold(&tail[used..]) {
                    return Err(self.number_trailing_junk(pos + used));
                }
                self.cursor += 1;
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
                Err(crate::Error::ParserError)
            }
            b'\\' => self.parse_escaped_identifier(pos, loc_tail),
            c => Err(self.junk_byte_error(self.cursor, pos, c)),
        }
    }

    #[cold]
    fn parse_escaped_identifier(&mut self, start: usize, loc: Loc) -> PResult<Expr> {
        let cursor = self.cursor;
        let run = &self.contents[start..self.pos_at(cursor + 1)];
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
            return Err(self.junk_byte_error(self.cursor, pos, self.contents[pos]));
        }
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

#[inline]
fn push_codepoint(buf: &mut Vec<u8>, cp: CodePoint) {
    if cp < 0 {
        return;
    }
    let mut tmp = [0u8; 4];
    let n = strings::encode_wtf8_rune(&mut tmp, cp as u32);
    buf.extend_from_slice(&tmp[..n]);
}

/// The length of `text` up to a backslash. It reads short text itself: `index_of_char` was slower.
#[inline(always)]
fn text_len(text: &[u8]) -> usize {
    const ONES: u64 = 0x0101_0101_0101_0101;
    // Below this many bytes the kernel reads no whole vector on some processors.
    const KERNEL_MIN: usize = 64;
    // A word read first makes one byte between two escapes slower than the loop this replaces.
    let mut len = 0;
    while len < 4 {
        match text.get(len) {
            Some(&byte) if byte != b'\\' => len += 1,
            _ => return len,
        }
    }
    while let Some(head) = text[len..].first_chunk::<8>() {
        if len > 4 && text.len() - len >= KERNEL_MIN {
            let rest = &text[len..];
            return len + strings::index_of_char_usize(rest, b'\\').unwrap_or(rest.len());
        }
        let word = u64::from_le_bytes(*head) ^ (ONES * 0x5C);
        // Sets the high bit of each backslash. Above the first one a borrow can set more.
        let backslash = word.wrapping_sub(ONES) & !word & (ONES * 0x80);
        if backslash != 0 {
            return len + (backslash.trailing_zeros() / 8) as usize;
        }
        len += 8;
    }
    while text.get(len).is_some_and(|&byte| byte != b'\\') {
        len += 1;
    }
    len
}

/// The length of the UTF-8 text at the start of `body`: it ends before a byte of no character.
#[inline]
fn utf8_len(body: &[u8]) -> usize {
    // The call to simdutf costs more than the check of a short body.
    if body.len() <= 64 {
        if body.is_ascii() {
            return body.len();
        }
        return match core::str::from_utf8(body) {
            Ok(_) => body.len(),
            Err(error) => error.valid_up_to(),
        };
    }
    let result = simdutf::validate::with_errors::utf8(body);
    if result.is_successful() {
        body.len()
    } else {
        result.count
    }
}

/// The value of the hex digits `digits`, if every byte is one.
#[inline]
fn hex_value(digits: Option<&[u8]>) -> Option<u32> {
    let mut value: u32 = 0;
    for &digit in digits? {
        value = value * 16 + u32::from(bun_core::fmt::hex_digit_value(digit)?);
    }
    Some(value)
}

/// Decodes the row of escapes at the backslash `body[pos]`. `Ok`: its end. `Err`: a bad escape.
#[inline(always)]
fn decode_escapes_at(body: &[u8], mut pos: usize, out: &mut Vec<u8>) -> Result<usize, usize> {
    loop {
        debug_assert_eq!(body.get(pos), Some(&b'\\'));
        let start = pos;
        // `decode_string_escapes` drops a backslash that ends the body.
        let Some(&escaped) = body.get(pos + 1) else {
            return Ok(body.len());
        };
        pos += 2;
        match escaped {
            b'b' => out.push(0x08),
            b'f' => out.push(0x0c),
            b'n' => out.push(0x0a),
            b'r' => out.push(0x0d),
            b't' => out.push(0x09),
            b'v' => out.push(0x0b),
            b'8' | b'9' | b'"' | b'\\' | b'/' => out.push(escaped),
            b'x' => {
                let value = hex_value(body.get(pos..pos + 2)).ok_or(start)?;
                pos += 2;
                push_codepoint(out, value as CodePoint);
            }
            b'u' => {
                let mut value = hex_value(body.get(pos..pos + 4)).ok_or(start)?;
                pos += 4;
                if strings::u16_is_lead(value as u16)
                    && body.get(pos..pos + 2) == Some(b"\\u".as_slice())
                    && let Some(trail) = hex_value(body.get(pos + 2..pos + 6))
                    && strings::u16_is_trail(trail as u16)
                {
                    value = strings::u16_get_supplementary(value as u16, trail as u16);
                    pos += 6;
                }
                push_codepoint(out, value as CodePoint);
            }
            _ => return Err(start),
        }
        if body.get(pos) != Some(&b'\\') {
            return Ok(pos);
        }
    }
}

/// Decodes `body` up to a byte that is not UTF-8 or a bad escape, and returns where it stops.
#[inline(always)]
fn decode_plain_text(body: &[u8], first: usize, out: &mut Vec<u8>) -> usize {
    out.reserve(body.len());
    let mut copied = 0;
    if body.first() == Some(&b'\\') {
        // Escapes are ASCII, and a string such as "\n" has no text to check.
        match decode_escapes_at(body, 0, out) {
            Ok(after) => copied = after,
            Err(bad) => return bad,
        }
        if copied == body.len() {
            return copied;
        }
    }
    let end = utf8_len(body);
    let mut pos = if copied == 0 {
        first.min(end)
    } else {
        copied + text_len(&body[copied..end])
    };
    loop {
        // `body[copied..pos]` is text, and `body[pos]` is a backslash if `pos` is not `end`.
        match &body[copied..pos] {
            [] => {}
            [byte] => out.push(*byte),
            text => out.extend_from_slice(text),
        }
        if pos == end {
            return end;
        }
        match decode_escapes_at(body, pos, out) {
            Ok(after) => copied = after,
            Err(bad) => return bad,
        }
        // Many strings end with an escape.
        if copied == end {
            return end;
        }
        pos = copied + text_len(&body[copied..end]);
    }
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

fn decode_string_escapes<'s, const ALLOW_RAW_CONTROL: bool, L: LexerLog<'s, Err = crate::Error>>(
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
    Ok(())
}

struct MiniLog<'a, 's> {
    log: &'a mut Log,
    source: &'s Source<'s>,
    prev_error_loc: Loc,
}

impl<'s> LexerLog<'s> for MiniLog<'_, 's> {
    type Err = crate::Error;
    fn log_mut(&mut self) -> &mut Log {
        self.log
    }
    fn source(&self) -> &'s Source<'s> {
        self.source
    }
    fn prev_error_loc_mut(&mut self) -> &mut Loc {
        &mut self.prev_error_loc
    }
    fn start(&self) -> usize {
        0
    }
    fn syntax_err() -> crate::Error {
        crate::Error::SyntaxError
    }
}

pub(crate) fn decode_auto_quoted(
    source: &Source,
    log: &mut Log,
    bump: &Bump,
    body: &[u8],
    opts: JSONOptions,
) -> crate::Result<E::String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The decoded bytes, or the error and what it logged.
    type Outcome = Result<Vec<u8>, String>;

    fn logged(err: crate::Error, log: &Log) -> String {
        let messages: Vec<String> = log
            .msgs
            .iter()
            .map(|m| String::from_utf8_lossy(&m.data.text).into_owned())
            .collect();
        format!("{err:?}: {messages:?}")
    }

    /// `decode_string_escapes` of `body`, after the text that `buf` has.
    fn decode_by_code_point(allow_raw_control: bool, body: &[u8], mut buf: Vec<u8>) -> Outcome {
        let source = Source::init_path_string("string.json", body);
        let mut log = Log::init();
        let mut l = MiniLog {
            log: &mut log,
            source: &source,
            prev_error_loc: Loc::EMPTY,
        };
        let result = if allow_raw_control {
            decode_string_escapes::<true, _>(&mut l, body, &mut buf)
        } else {
            decode_string_escapes::<false, _>(&mut l, body, &mut buf)
        };
        result.map(|()| buf).map_err(|err| logged(err, &log))
    }

    /// What the parser makes of the one string of the document `["body"]`.
    fn parsed(body: &[u8]) -> Outcome {
        let doc = [b"[\"".as_slice(), body, b"\"]"].concat();
        bun_ast::initialize_store_or_reset();
        let _scope = bun_ast::StoreResetGuard::new();
        let source = Source::init_path_string("doc.json", &doc);
        let mut log = Log::init();
        let parsed = crate::json::ParsedJson::parse_json(&source, &mut log)
            .map_err(|err| logged(err, &log))?;
        let Data::EArrayJSON(root) = parsed.root.data else {
            panic!("the document is an array");
        };
        match root.get().items() {
            [E::JsonValue::String(string)] => Ok(string.slice().to_vec()),
            items => panic!("{} items in {:?}", items.len(), bstr::BStr::new(&doc)),
        }
    }

    /// What main makes of a string: it decodes one that has a backslash or a control character.
    fn expected(body: &[u8]) -> Outcome {
        if body.iter().any(|b| *b == b'\\' || *b < 0x20) {
            decode_by_code_point(false, body, Vec::new())
        } else {
            Ok(body.to_vec())
        }
    }

    /// Whether `"body"` is one string token: each quote of the body is escaped.
    fn is_one_string(body: &[u8]) -> bool {
        let mut i = 0;
        while i < body.len() {
            match body[i] {
                b'"' => return false,
                b'\\' if i + 1 == body.len() => return false,
                b'\\' => i += 2,
                _ => i += 1,
            }
        }
        true
    }

    /// Every byte that takes its own path through a decoder, and its neighbours.
    const BYTES: &[u8] = &[
        // Printable ASCII, the escape letters, hex digits of each case, and `g`.
        b' ', b'a', b'Z', b'~', 0x7F, b'\\', b'"', b'\'', b'/', b'b', b'f', b'n', b'r', b't', b'v',
        b'u', b'x', b'0', b'7', b'8', b'9', b'A', b'D', b'F', b'c', b'd', b'g',
        // Control characters: the two that end a line, and three that do not.
        0x00, 0x09, 0x0A, 0x0D, 0x1F,
        // Continuation bytes, then lead bytes: overlong (C0, C1, E0, F0), surrogate (ED), invalid.
        0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0, 0xC1, 0xC2, 0xDF, 0xE0, 0xE1, 0xED, 0xEF, 0xF0,
        0xF1, 0xF4, 0xF5, 0xF7, 0xF8, 0xFF,
    ];

    /// Pieces that a body is built from, so that long and well-formed sequences occur often.
    const PIECES: &[&[u8]] = &[
        b"plain text",
        b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        b"\\n",
        b"\\t",
        b"\\\"",
        b"\\\\",
        b"\\/",
        b"\\b\\f\\r\\v",
        b"\\8\\9",
        b"\\0",
        b"\\'",
        b"\\x41",
        b"\\xff",
        b"\\x4",
        b"\\u0041",
        b"\\u00e9",
        b"\\u65e5",
        b"\\uD83D\\uDE00",
        b"\\uD83D",
        b"\\uDE00",
        b"\\uD83D\\u0041",
        b"\\uD83D\\uD83D\\uDE00",
        b"\\uD83D\\uDE0",
        b"\\uD83D\\n",
        b"\\u12",
        b"\\u12G4",
        b"\\",
        "é".as_bytes(),
        "日本語".as_bytes(),
        "😀".as_bytes(),
        "\u{7f}\u{80}\u{7ff}\u{800}\u{ffff}\u{10000}\u{10ffff}".as_bytes(),
        // A lead and a trail surrogate as WTF-8, alone and as a pair.
        &[0xED, 0xA0, 0xBD],
        &[0xED, 0xB8, 0x80],
        &[0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80],
        // Sequences cut short, overlong, or past U+10FFFF.
        &[0xC3],
        &[0xE6, 0x97],
        &[0xF0, 0x9F, 0x98],
        &[0xC0, 0x80],
        &[0xE0, 0x80, 0x80],
        &[0xF0, 0x80, 0x80, 0x80],
        &[0xF4, 0x90, 0x80, 0x80],
        &[0x80],
        &[0xFF],
        &[0x00],
        &[0x0A],
        &[0x1F],
    ];

    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }

        /// A body of up to ten parts: a byte of `BYTES`, a run of ASCII, or one of `PIECES`.
        fn body(&mut self, run: usize, body: &mut Vec<u8>) {
            body.clear();
            for _ in 0..self.below(10) {
                match self.below(8) {
                    0 => body.push(BYTES[self.below(BYTES.len())]),
                    1 => {
                        let len = self.below(run);
                        body.extend(core::iter::repeat_n(b'a' + (len % 26) as u8, len));
                    }
                    _ => body.extend_from_slice(PIECES[self.below(PIECES.len())]),
                }
            }
        }
    }

    /// Calls `check` with every body of one or two bytes, many of three, and random ones.
    fn for_each_body(mut check: impl FnMut(&[u8])) {
        check(b"");
        for a in 0..=255u8 {
            check(&[a]);
            for b in 0..=255u8 {
                check(&[a, b]);
            }
        }
        for &a in BYTES {
            for &b in BYTES {
                for &c in BYTES {
                    check(&[a, b, c]);
                }
            }
        }
        let mut rng = Rng(0x9E3779B97F4A7C15);
        let mut body = Vec::new();
        for _ in 0..200_000 {
            body.clear();
            for _ in 0..rng.below(14) {
                body.push(BYTES[rng.below(BYTES.len())]);
            }
            check(&body);
        }
        for _ in 0..300_000 {
            // The runs cross the widths that the search for a backslash reads in one step.
            rng.body(150, &mut body);
            check(&body);
        }
    }

    #[test]
    fn text_len_matches_a_byte_loop() {
        let check = |text: &[u8]| {
            let expected = text.iter().take_while(|b| **b != b'\\').count();
            assert_eq!(text_len(text), expected, "{:?}", bstr::BStr::new(text));
        };
        // Every byte value at each place that is read by a branch or in a word, alone or in a pair.
        for filler in [b'a', 0xE6] {
            let mut text = [filler; 30];
            for first in 0..28 {
                for value in 0..=255u8 {
                    text.fill(filler);
                    text[first] = value;
                    check(&text);
                    for second in first + 1..28 {
                        for other in [0x00, 0x1F, 0x5B, 0x5C, 0x5D, 0x7F, 0x80, 0xDC, 0xFF] {
                            text[second] = other;
                            check(&text);
                        }
                        text[second] = filler;
                    }
                }
            }
        }
        // A backslash at each place of a text of each length up to 200 bytes, and no backslash.
        let text = [b'a'; 200];
        for len in 0..=text.len() {
            check(&text[..len]);
            for at in 0..len {
                let mut text = text;
                text[at] = b'\\';
                check(&text[..len]);
            }
        }
    }

    #[test]
    fn utf8_len_is_the_same_for_a_short_and_a_long_body() {
        // A short body is checked without simdutf. 70 bytes of ASCII after it make it long.
        let mut long = Vec::new();
        for_each_body(|body| {
            long.clear();
            long.extend_from_slice(body);
            long.resize(body.len() + 70, b'a');
            let len = utf8_len(body);
            let expected = if len == body.len() { long.len() } else { len };
            assert_eq!(
                utf8_len(&long),
                expected,
                "body {:?}",
                bstr::BStr::new(body)
            );
        });
    }

    #[test]
    fn bulk_decoder_matches_the_code_point_decoder() {
        let (mut whole, mut part, mut rejected) = (0, 0, 0);
        for_each_body(|body| {
            let mut in_bulk = Vec::new();
            let plain = decode_plain_text(body, text_len(body), &mut in_bulk);
            // The bulk decoder takes a control character as text, so the other decoder does too.
            let actual = decode_by_code_point(true, &body[plain..], in_bulk);
            let expected = decode_by_code_point(true, body, Vec::new());
            assert_eq!(
                actual,
                expected,
                "body {:?}, in bulk up to {plain}",
                bstr::BStr::new(body)
            );
            match actual {
                Ok(_) if plain == body.len() => whole += 1,
                Ok(_) => part += 1,
                Err(_) => rejected += 1,
            }
        });
        assert!(
            whole > 50_000 && part > 50_000 && rejected > 50_000,
            "{whole} decoded in bulk, {part} in part, {rejected} rejected"
        );
    }

    #[test]
    fn parser_decodes_like_the_code_point_decoder() {
        let (mut decoded, mut rejected) = (0, 0);
        for_each_body(|body| {
            if !is_one_string(body) {
                return;
            }
            let (expected, actual) = (expected(body), parsed(body));
            assert!(
                expected == actual,
                "body {:?}\n by code point: {expected:?}\n parser: {actual:?}",
                bstr::BStr::new(body)
            );
            match expected {
                Ok(_) => decoded += 1,
                Err(_) => rejected += 1,
            }
        });
        assert!(
            decoded > 50_000 && rejected > 50_000,
            "{decoded} decoded, {rejected} rejected"
        );
    }

    #[test]
    fn parser_decodes_long_strings_like_the_code_point_decoder() {
        let mut rng = Rng(0xD1B54A32D192ED03);
        let (mut part, mut body) = (Vec::new(), Vec::new());
        let (mut decoded, mut rejected) = (0, 0);
        // Stage 1 reads 8192 bytes at a time, and the tape holds strings in buffers of 4096 bytes.
        for target in [4095, 4096, 4097, 8191, 8192, 8193, 20_000] {
            for _ in 0..200 {
                // One body in eight has parts that are not a string, at any place in it.
                let only_what_decodes = rng.below(8) != 0;
                body.clear();
                while body.len() < target {
                    rng.body(52, &mut part);
                    if is_one_string(&part) && (!only_what_decodes || expected(&part).is_ok()) {
                        body.extend_from_slice(&part);
                    }
                }
                let (expected, actual) = (expected(&body), parsed(&body));
                assert!(
                    expected == actual,
                    "body {:?}\n by code point: {:?}\n parser: {:?}",
                    bstr::BStr::new(&body),
                    expected.as_ref().map(Vec::len),
                    actual.as_ref().map(Vec::len),
                );
                match expected {
                    Ok(_) => decoded += 1,
                    Err(_) => rejected += 1,
                }
            }
        }
        assert!(
            decoded > 1_000 && rejected > 100,
            "{decoded} decoded, {rejected} rejected"
        );
    }

    #[test]
    fn decoded_text_of_known_bodies() {
        assert_eq!(parsed(b"a\\nb"), Ok(b"a\nb".to_vec()));
        assert_eq!(
            parsed(b"\\b\\f\\n\\r\\t\\v\\8\\9\\\"\\\\\\/"),
            Ok(b"\x08\x0c\n\r\t\x0b89\"\\/".to_vec())
        );
        assert_eq!(parsed(b"\\x41\\xe9\\u65e5"), Ok("Aé日".as_bytes().to_vec()));
        assert_eq!(parsed(b"\\uD83D\\uDE00"), Ok("😀".as_bytes().to_vec()));
        assert_eq!(parsed(b"\\uD83D"), Ok(vec![0xED, 0xA0, 0xBD]));
        // A byte that starts no sequence is its code point. A lead byte without its tail is U+FFFD.
        assert_eq!(
            parsed(b"\\n\x80\xE6\x97"),
            Ok("\n\u{80}\u{FFFD}\u{97}".as_bytes().to_vec())
        );
        assert!(
            parsed(b"a\nb")
                .unwrap_err()
                .contains("Unterminated string literal")
        );
        assert!(parsed(b"a\x01b").unwrap_err().contains("Syntax Error"));
        assert!(parsed(b"\\n\x01").unwrap_err().contains("Syntax Error"));
        assert!(parsed(b"\\q").unwrap_err().contains("Syntax Error"));
        assert!(parsed(b"\\u12G4").unwrap_err().contains("Syntax Error"));
    }
}
