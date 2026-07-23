//! Stage 2 of the JSON parser: recursive descent over the structural index built by
//! [`crate::json_index`] (stage 1) into the immutable JSON AST (`E::JsonTape` rows).
use bun_alloc::Arena as Bump;
use bun_ast::LexerLog;
use bun_ast::expr::Data;
use bun_ast::{E, Expr, Loc, Log, Range, Source, usize2loc};
use bun_core::StackCheck;
use bun_core::strings;
use bun_core::strings::CodePoint;

use crate::json::JSONOptions;
use crate::json_index::{self as jidx, StructuralIndex};

type PResult<T = ()> = crate::Result<T>;

type DupMap = bun_collections::HashMap<u64, (), bun_collections::IdentityContext<u64>>;

pub(crate) struct Parser<'a, 's, 'i> {
    contents: &'s [u8],
    source: &'s Source,
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
        source: &'s Source,
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
            let _ = self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)));
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
        decode_string_escapes(self, body, buf)
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
                        while i < rest.len() && !matches!(rest[i], b'\n' | b'\r') {
                            i += 1;
                        }
                    }
                    Some(b'*') => {
                        let Some(close) = rest[i + 2..].windows(2).position(|w| w == b"*/") else {
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
                bstr::BStr::new(key_text)
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

fn decode_string_escapes<'s, L: LexerLog<'s, Err = crate::Error>>(
    l: &mut L,
    body: &[u8],
    buf: &mut Vec<u8>,
) -> PResult {
    let iterator = strings::CodepointIterator::init(body);
    let mut iter = strings::Cursor::default();
    while iterator.next(&mut iter) {
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
    Ok(())
}
