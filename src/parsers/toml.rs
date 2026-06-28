//! TOML v1.1.0 parser.
//!
//! Byte-level recursive descent over the source, producing a `bun_ast::Expr`
//! tree (the same output the JSON/JSON5/YAML parsers produce). Structured
//! after `json5.rs`: no separate token stream, errors are logged with byte
//! positions as they are discovered.
//!
//! JS value mapping:
//! - integers parse as `f64` but are validated as 64-bit integers first;
//!   values outside `Number.MAX_SAFE_INTEGER` are errors (TOML requires
//!   lossless handling or an error)
//! - date/time values (all four kinds) become strings of their source text
//! - strings are UTF-8; non-ASCII content is re-encoded to UTF-16 EStrings
//!   so both the JS conversion and the printer paths agree

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec;
use bun_ast::{self, E, Expr, Loc, Log, Source};
use bun_collections::HashMap;
use bun_core::{self, StackCheck};

/// Tracks how a table or array came to exist, which decides whether later
/// syntax may extend it. See "Table" and "Array of Tables" in the spec.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    /// `[a]` — explicitly defined by a table header.
    Header,
    /// Created on the way to a deeper header (`[a.b]` creates `a`).
    HeaderImplicit,
    /// Created by a dotted key (`a.b = 1` creates `a`); records the block so
    /// only dotted keys from the same block may extend it.
    Dotted,
    /// An element of an array of tables.
    ArrayElem,
    /// `{ ... }` — closed to all later extension.
    Inline,
    /// `[[a]]` — appendable only by another `[[a]]`.
    AotArray,
    /// `a = [ ... ]` — a value; never extendable.
    StaticArray,
}

#[derive(Copy, Clone)]
struct Meta {
    kind: Kind,
    block: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PErr {
    /// Already logged.
    Syntax,
    Oom,
    StackOverflow,
}

impl From<bun_alloc::AllocError> for PErr {
    fn from(_: bun_alloc::AllocError) -> Self {
        PErr::Oom
    }
}

type PResult<T> = Result<T, PErr>;

/// A decoded key segment: the key text (borrowed from the source or built in
/// the bump arena when escapes were involved) plus its source position.
#[derive(Copy, Clone)]
struct KeySeg<'a> {
    text: &'a [u8],
    pos: usize,
}

pub struct TOML;

impl TOML {
    pub fn parse<'a>(
        source: &'a Source,
        log: &mut Log,
        bump: &'a Bump,
        redact_logs: bool,
    ) -> Result<Expr, bun_core::Error> {
        let mut parser = Parser {
            src: source.contents.as_ref(),
            pos: 0,
            bump,
            source,
            log,
            stack_check: StackCheck::init(),
            meta: HashMap::default(),
            block: 0,
            redact: redact_logs,
        };
        match parser.parse_root() {
            Ok(root) => Ok(root),
            Err(PErr::Syntax) => Err(bun_core::err!("SyntaxError")),
            Err(PErr::Oom) => Err(bun_core::err!("OutOfMemory")),
            Err(PErr::StackOverflow) => Err(bun_core::err!("StackOverflow")),
        }
    }
}

struct Parser<'a, 'log> {
    src: &'a [u8],
    pos: usize,
    bump: &'a Bump,
    source: &'a Source,
    log: &'log mut Log,
    stack_check: StackCheck,
    /// Keyed by `E::Object::as_ptr()` / `E::Array::as_ptr()` addresses.
    meta: HashMap<usize, Meta>,
    /// Current definition block: bumped per table header and per inline table.
    block: u32,
    redact: bool,
}

const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

const BARE_CR: &[u8] = b"Bare carriage return is not allowed; use \\r\\n or \\n";
const UNDERSCORE_IN_NUMBER: &[u8] = b"Underscores in numbers must be surrounded by digits";

fn is_bare_key_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-' || c == b'_'
}

fn loc_of(pos: usize) -> Loc {
    Loc {
        start: i32::try_from(pos).expect("source length is bounded by i32::MAX"),
    }
}

/// Releases an arena vec's storage as an arena-owned slice.
fn vec_into_slice<'a, T>(v: ArenaVec<'a, T>) -> &'a [T] {
    let (ptr, len, _cap, _alloc) = v.into_raw_parts();
    // SAFETY: the storage is arena-owned for 'a and is never freed
    // individually; the first `len` elements were initialized by push.
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

impl<'a, 'log> Parser<'a, 'log> {
    // ── error helpers ──────────────────────────────────────────────────────

    fn err(&mut self, pos: usize, msg: &'static [u8]) -> PErr {
        self.err_fmt(pos, format_args!("{}", bstr::BStr::new(msg)))
    }

    fn err_fmt(&mut self, pos: usize, args: core::fmt::Arguments<'_>) -> PErr {
        self.log.add_error_fmt_opts(
            args,
            bun_ast::AddErrorOptions {
                source: Some(self.source),
                loc: loc_of(pos),
                len: 0,
                redact_sensitive_information: self.redact,
            },
        );
        PErr::Syntax
    }

    /// `{before} '{key}'{after}`; the key text is omitted when redacting.
    fn err_keyed(
        &mut self,
        pos: usize,
        before: &'static str,
        key: &[u8],
        after: &'static str,
    ) -> PErr {
        if self.redact {
            self.err_fmt(pos, format_args!("{}{}", before, after))
        } else {
            self.err_fmt(
                pos,
                format_args!("{} '{}'{}", before, bstr::BStr::new(key), after),
            )
        }
    }

    fn err_char(&mut self, pos: usize, what: &'static str) -> PErr {
        let c = self.src.get(pos).copied();
        match c {
            Some(c) if !self.redact && c.is_ascii_graphic() => {
                self.err_fmt(pos, format_args!("{} '{}'", what, c as char))
            }
            Some(c) if !self.redact => self.err_fmt(pos, format_args!("{} (0x{:02X})", what, c)),
            _ => self.err_fmt(pos, format_args!("{}", what)),
        }
    }

    /// Every table/array reachable during parsing was created by this parser
    /// and registered in `meta` at construction.
    fn meta_of(&self, ptr: usize) -> Meta {
        *self
            .meta
            .get(&ptr)
            .expect("table/array was registered at creation")
    }

    // ── byte cursor ────────────────────────────────────────────────────────

    #[inline]
    fn peek(&self) -> u8 {
        self.peek_at(self.pos)
    }

    #[inline]
    fn peek_at(&self, pos: usize) -> u8 {
        if pos < self.src.len() {
            self.src[pos]
        } else {
            0
        }
    }

    #[inline]
    fn at_eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    /// Skips spaces and tabs.
    fn skip_ws(&mut self) {
        while matches!(self.peek(), b' ' | b'\t') {
            self.pos += 1;
        }
    }

    /// Consumes a newline (LF or CRLF). Returns an error for a bare CR.
    fn expect_newline(&mut self) -> PResult<()> {
        match self.peek() {
            b'\n' => {
                self.pos += 1;
                Ok(())
            }
            b'\r' => {
                if self.peek_at(self.pos + 1) == b'\n' {
                    self.pos += 2;
                    Ok(())
                } else {
                    Err(self.err(self.pos, BARE_CR))
                }
            }
            _ => Err(self.err_char(self.pos, "Expected a newline but found")),
        }
    }

    /// Scans a `# comment` up to (not including) the line terminator,
    /// rejecting control characters.
    fn skip_comment(&mut self) -> PResult<()> {
        debug_assert_eq!(self.peek(), b'#');
        self.pos += 1;
        loop {
            match self.peek() {
                0 if self.at_eof() => return Ok(()),
                b'\n' => return Ok(()),
                b'\r' => {
                    if self.peek_at(self.pos + 1) == b'\n' {
                        return Ok(());
                    }
                    return Err(self.err(self.pos, BARE_CR));
                }
                b'\t' => self.pos += 1,
                c if c < 0x20 || c == 0x7F => {
                    return Err(
                        self.err_char(self.pos, "Control character is not allowed in a comment:")
                    );
                }
                _ => self.pos += 1,
            }
        }
    }

    /// After a key/value pair or table header: optional whitespace, optional
    /// comment, then a newline or EOF.
    fn expect_line_end(&mut self, after: &'static [u8]) -> PResult<()> {
        self.skip_ws();
        if self.peek() == b'#' {
            self.skip_comment()?;
        }
        if self.at_eof() {
            return Ok(());
        }
        match self.peek() {
            b'\n' | b'\r' => self.expect_newline(),
            _ => Err(self.err_fmt(
                self.pos,
                format_args!(
                    "Expected a newline or end of file after {}",
                    bstr::BStr::new(after)
                ),
            )),
        }
    }

    /// Skips whitespace, comments, and newlines between top-level expressions
    /// and inside arrays / multi-line inline tables.
    fn skip_trivia(&mut self) -> PResult<()> {
        loop {
            match self.peek() {
                b' ' | b'\t' => self.pos += 1,
                b'\n' | b'\r' => self.expect_newline()?,
                b'#' => self.skip_comment()?,
                _ => return Ok(()),
            }
        }
    }

    // ── document structure ─────────────────────────────────────────────────

    fn parse_root(&mut self) -> PResult<Expr> {
        // A TOML document must be valid UTF-8 as a whole.
        let validation = bun_simdutf_sys::simdutf::validate::with_errors::utf8(self.src);
        if !validation.is_successful() {
            return Err(self.err(validation.count, b"Invalid UTF-8 byte sequence"));
        }
        // Skip a leading byte-order mark.
        if self.src.starts_with(b"\xEF\xBB\xBF") {
            self.pos = 3;
        }

        let root = Expr::init(E::Object::default(), loc_of(self.pos));
        let root_ptr = root
            .data
            .e_object()
            .expect("infallible: just constructed")
            .as_ptr();

        let mut current: *mut E::Object = root_ptr;
        loop {
            self.skip_trivia()?;
            if self.at_eof() {
                return Ok(root);
            }
            if self.peek() == b'[' {
                current = self.parse_table_header(root_ptr)?;
                self.expect_line_end(b"a table header")?;
            } else {
                self.parse_keyval(current)?;
                self.expect_line_end(b"a key/value pair")?;
            }
        }
    }

    /// `[a.b]` or `[[a.b]]`. Returns the table that becomes current.
    fn parse_table_header(&mut self, root: *mut E::Object) -> PResult<*mut E::Object> {
        debug_assert_eq!(self.peek(), b'[');
        let header_pos = self.pos;
        self.pos += 1;
        let is_aot = self.peek() == b'[';
        if is_aot {
            self.pos += 1;
        }

        self.skip_ws();
        let path = self.parse_key_path()?;
        self.skip_ws();

        if self.peek() != b']' {
            return Err(self.err_char(self.pos, "Expected ']' to close a table header but found"));
        }
        self.pos += 1;
        if is_aot {
            if self.peek() != b']' {
                return Err(self.err_char(
                    self.pos,
                    "Expected ']]' to close an array-of-tables header but found",
                ));
            }
            self.pos += 1;
        }

        self.block += 1;
        self.navigate_header(root, &path, is_aot, header_pos)
    }

    fn navigate_header(
        &mut self,
        root: *mut E::Object,
        path: &[KeySeg<'a>],
        is_aot: bool,
        header_pos: usize,
    ) -> PResult<*mut E::Object> {
        let mut cur: *mut E::Object = root;
        for (i, seg) in path.iter().enumerate() {
            let last = i + 1 == path.len();
            // SAFETY: `cur` always points at an E::Object inside the AST store,
            // created earlier in this parse; the store lives in `self.bump`.
            let cur_obj: &mut E::Object = unsafe { &mut *cur };
            let existing = cur_obj.as_property(seg.text).map(|q| q.expr);
            match existing {
                None => {
                    if last && is_aot {
                        let array = self.new_array(seg.pos, Kind::AotArray);
                        let elem = self.append_aot_elem(array.1, seg.pos)?;
                        self.insert_key(cur, *seg, array.0)?;
                        cur = elem;
                    } else {
                        let kind = if last {
                            Kind::Header
                        } else {
                            Kind::HeaderImplicit
                        };
                        let (expr, ptr) = self.new_table(seg.pos, kind);
                        self.insert_key(cur, *seg, expr)?;
                        cur = ptr;
                    }
                }
                Some(found) => {
                    if let Some(obj) = found.data.e_object() {
                        let ptr = obj.as_ptr();
                        let meta = self.meta_of(ptr as usize);
                        if last {
                            if is_aot {
                                return Err(self.err_keyed(
                                    header_pos,
                                    "Cannot redefine table",
                                    seg.text,
                                    " as an array of tables",
                                ));
                            }
                            match meta.kind {
                                Kind::HeaderImplicit => {
                                    self.meta.insert(
                                        ptr as usize,
                                        Meta {
                                            kind: Kind::Header,
                                            block: self.block,
                                        },
                                    );
                                    cur = ptr;
                                }
                                Kind::Inline => {
                                    return Err(self.err_keyed(
                                        header_pos,
                                        "Cannot redefine inline table",
                                        seg.text,
                                        "",
                                    ));
                                }
                                _ => {
                                    return Err(self.err_keyed(
                                        header_pos,
                                        "Cannot redefine table",
                                        seg.text,
                                        "",
                                    ));
                                }
                            }
                        } else {
                            if meta.kind == Kind::Inline {
                                return Err(self.err_keyed(
                                    header_pos,
                                    "Cannot extend inline table",
                                    seg.text,
                                    "",
                                ));
                            }
                            cur = ptr;
                        }
                    } else if let Some(arr) = found.data.e_array() {
                        let ptr = arr.as_ptr();
                        let meta = self.meta_of(ptr as usize);
                        if meta.kind != Kind::AotArray {
                            return Err(self.err_keyed(
                                header_pos,
                                "Cannot extend array",
                                seg.text,
                                "",
                            ));
                        }
                        if last {
                            if !is_aot {
                                return Err(self.err_keyed(
                                    header_pos,
                                    "Cannot redefine array of tables",
                                    seg.text,
                                    " as a table",
                                ));
                            }
                            cur = self.append_aot_elem(ptr, seg.pos)?;
                        } else {
                            // Descend into the most recent element.
                            // SAFETY: AoT arrays only ever contain E::Object
                            // elements appended by `append_aot_elem`.
                            let items = unsafe { (*ptr).items.as_slice() };
                            let last_elem = items.last().expect("AoT arrays are never empty");
                            cur = last_elem
                                .data
                                .e_object()
                                .expect("AoT elements are tables")
                                .as_ptr();
                        }
                    } else {
                        return Err(self.err_keyed(
                            header_pos,
                            "Cannot redefine key",
                            seg.text,
                            " as a table",
                        ));
                    }
                }
            }
        }
        Ok(cur)
    }

    /// `key = value` (including dotted keys) inserted into `table`.
    fn parse_keyval(&mut self, table: *mut E::Object) -> PResult<()> {
        let path = self.parse_key_path()?;
        self.skip_ws();
        if self.peek() != b'=' {
            return Err(self.err_char(self.pos, "Expected '=' after a key but found"));
        }
        self.pos += 1;
        self.skip_ws();
        match self.peek() {
            b'\n' | b'\r' => {
                return Err(self.err(
                    self.pos,
                    b"Missing value after '='; values must be on the same line",
                ));
            }
            0 if self.at_eof() => {
                return Err(self.err(self.pos, b"Missing value after '='"));
            }
            _ => {}
        }
        let value = self.parse_value()?;
        self.assign_path(table, &path, value)
    }

    /// Walks the dotted path from `table`, creating dotted tables as needed,
    /// and inserts `value` at the final segment.
    fn assign_path(
        &mut self,
        table: *mut E::Object,
        path: &[KeySeg<'a>],
        value: Expr,
    ) -> PResult<()> {
        let mut cur = table;
        for seg in &path[..path.len() - 1] {
            // SAFETY: `cur` points at a live E::Object in the AST store.
            let cur_obj: &mut E::Object = unsafe { &mut *cur };
            match cur_obj.as_property(seg.text).map(|q| q.expr) {
                None => {
                    let (expr, ptr) = self.new_table(seg.pos, Kind::Dotted);
                    self.insert_key(cur, *seg, expr)?;
                    cur = ptr;
                }
                Some(found) => {
                    let Some(obj) = found.data.e_object() else {
                        return Err(self.err_keyed(seg.pos, "Cannot redefine key", seg.text, ""));
                    };
                    let ptr = obj.as_ptr();
                    let meta = self.meta_of(ptr as usize);
                    let extendable = meta.kind == Kind::Dotted && meta.block == self.block;
                    if !extendable {
                        return Err(self.err_keyed(
                            seg.pos,
                            "Cannot extend table",
                            seg.text,
                            " with a dotted key",
                        ));
                    }
                    cur = ptr;
                }
            }
        }
        let last = path[path.len() - 1];
        self.insert_key(cur, last, value)
    }

    // ── keys ───────────────────────────────────────────────────────────────

    /// One or more key segments separated by dots.
    fn parse_key_path(&mut self) -> PResult<ArenaVec<'a, KeySeg<'a>>> {
        let mut path: ArenaVec<'a, KeySeg<'a>> = ArenaVec::with_capacity_in(0, self.bump);
        loop {
            let seg = self.parse_key_segment()?;
            path.push(seg);
            self.skip_ws();
            if self.peek() == b'.' {
                self.pos += 1;
                self.skip_ws();
            } else {
                return Ok(path);
            }
        }
    }

    fn parse_key_segment(&mut self) -> PResult<KeySeg<'a>> {
        let pos = self.pos;
        match self.peek() {
            b'"' => {
                let text = self.parse_basic_string_single_line()?;
                Ok(KeySeg { text, pos })
            }
            b'\'' => {
                let text = self.parse_literal_string_single_line()?;
                Ok(KeySeg { text, pos })
            }
            c if is_bare_key_char(c) => {
                let start = self.pos;
                while is_bare_key_char(self.peek()) {
                    self.pos += 1;
                }
                Ok(KeySeg {
                    text: &self.src[start..self.pos],
                    pos,
                })
            }
            _ => Err(self.err_char(pos, "Expected a key but found")),
        }
    }

    // ── values ─────────────────────────────────────────────────────────────

    fn parse_value(&mut self) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(PErr::StackOverflow);
        }
        let pos = self.pos;
        let loc = loc_of(pos);
        match self.peek() {
            b'"' => {
                let (text, is_ascii) = self.parse_basic_string_value()?;
                Ok(self.string_expr(text, is_ascii, loc))
            }
            b'\'' => {
                let (text, is_ascii) = self.parse_literal_string_value()?;
                Ok(self.string_expr(text, is_ascii, loc))
            }
            b't' => {
                self.expect_keyword(b"true")?;
                Ok(Expr::init(E::Boolean { value: true }, loc))
            }
            b'f' => {
                self.expect_keyword(b"false")?;
                Ok(Expr::init(E::Boolean { value: false }, loc))
            }
            b'[' => self.parse_array(),
            b'{' => self.parse_inline_table(),
            b'i' | b'n' | b'+' | b'-' | b'0'..=b'9' => self.parse_number_or_datetime(),
            _ => Err(self.err_char(pos, "Expected a value but found")),
        }
    }

    fn string_expr(&self, text: &'a [u8], is_ascii: bool, loc: Loc) -> Expr {
        if is_ascii {
            Expr::init(E::String::init(text), loc)
        } else {
            Expr::init(E::String::init_re_encode_utf8(text, self.bump), loc)
        }
    }

    fn expect_keyword(&mut self, word: &'static [u8]) -> PResult<()> {
        let pos = self.pos;
        if self.src[self.pos..].starts_with(word) {
            let after = self.peek_at(self.pos + word.len());
            // A keyword must be followed by a value terminator, not more
            // bare characters: `truex` and `tru` are both errors.
            if !is_bare_key_char(after) {
                self.pos += word.len();
                return Ok(());
            }
        }
        Err(self.err_char(pos, "Expected a value but found"))
    }

    // ── arrays and inline tables ───────────────────────────────────────────

    fn parse_array(&mut self) -> PResult<Expr> {
        debug_assert_eq!(self.peek(), b'[');
        let pos = self.pos;
        self.pos += 1;

        let (array, ptr) = self.new_array(pos, Kind::StaticArray);

        loop {
            self.skip_trivia()?;
            if self.peek() == b']' {
                self.pos += 1;
                return Ok(array);
            }
            if self.at_eof() {
                return Err(self.err(self.pos, b"Unterminated array; expected ']'"));
            }
            let value = self.parse_value()?;
            // SAFETY: `ptr` points at the E::Array constructed above.
            unsafe { (*ptr).push(self.bump, value)? };
            self.skip_trivia()?;
            match self.peek() {
                b',' => {
                    self.pos += 1;
                }
                b']' => {
                    self.pos += 1;
                    return Ok(array);
                }
                _ => {
                    return Err(
                        self.err_char(self.pos, "Expected ',' or ']' in an array but found")
                    );
                }
            }
        }
    }

    fn parse_inline_table(&mut self) -> PResult<Expr> {
        debug_assert_eq!(self.peek(), b'{');
        let pos = self.pos;
        self.pos += 1;

        // An inline table is its own definition block so dotted keys inside it
        // cannot extend outer tables and vice versa.
        let outer_block = self.block;
        self.block += 1;

        let (table, ptr) = self.new_table(pos, Kind::Dotted);

        loop {
            self.skip_trivia()?;
            if self.peek() == b'}' {
                self.pos += 1;
                break;
            }
            if self.at_eof() {
                return Err(self.err(self.pos, b"Unterminated inline table; expected '}'"));
            }
            let path = self.parse_key_path()?;
            self.skip_ws();
            if self.peek() != b'=' {
                return Err(self.err_char(self.pos, "Expected '=' after a key but found"));
            }
            self.pos += 1;
            self.skip_trivia()?;
            let value = self.parse_value()?;
            self.assign_path(ptr, &path, value)?;
            self.skip_trivia()?;
            match self.peek() {
                b',' => {
                    self.pos += 1;
                    // A trailing comma before '}' is allowed; a second comma
                    // is not, which the `parse_key_path` above will reject.
                }
                b'}' => {
                    self.pos += 1;
                    break;
                }
                _ => {
                    return Err(
                        self.err_char(self.pos, "Expected ',' or '}' in an inline table but found")
                    );
                }
            }
        }

        // Inline tables are closed: nothing may extend them later.
        self.meta.insert(
            ptr as usize,
            Meta {
                kind: Kind::Inline,
                block: self.block,
            },
        );
        self.block = outer_block;
        Ok(table)
    }

    // ── table bookkeeping ──────────────────────────────────────────────────

    fn new_table(&mut self, pos: usize, kind: Kind) -> (Expr, *mut E::Object) {
        let expr = Expr::init(E::Object::default(), loc_of(pos));
        let ptr = expr
            .data
            .e_object()
            .expect("infallible: just constructed")
            .as_ptr();
        self.meta.insert(
            ptr as usize,
            Meta {
                kind,
                block: self.block,
            },
        );
        (expr, ptr)
    }

    fn new_array(&mut self, pos: usize, kind: Kind) -> (Expr, *mut E::Array) {
        let expr = Expr::init(E::Array::default(), loc_of(pos));
        let ptr = expr
            .data
            .e_array()
            .expect("infallible: just constructed")
            .as_ptr();
        self.meta.insert(
            ptr as usize,
            Meta {
                kind,
                block: self.block,
            },
        );
        (expr, ptr)
    }

    fn append_aot_elem(&mut self, array: *mut E::Array, pos: usize) -> PResult<*mut E::Object> {
        let (elem, ptr) = self.new_table(pos, Kind::ArrayElem);
        // SAFETY: `array` points at a live E::Array in the AST store.
        unsafe { (*array).push(self.bump, elem)? };
        Ok(ptr)
    }

    fn insert_key(&mut self, obj: *mut E::Object, seg: KeySeg<'a>, value: Expr) -> PResult<()> {
        // SAFETY: `obj` points at a live E::Object in the AST store.
        let obj: &mut E::Object = unsafe { &mut *obj };
        // The duplicate check must use the UTF-8 key bytes: `as_property`
        // compares correctly against both 8-bit and UTF-16 stored keys.
        if obj.as_property(seg.text).is_some() {
            return Err(self.err_keyed(seg.pos, "Cannot redefine key", seg.text, ""));
        }
        let key_loc = loc_of(seg.pos);
        let key_expr = if seg.text.is_ascii() {
            Expr::init(E::String::init(seg.text), key_loc)
        } else {
            Expr::init(E::String::init_re_encode_utf8(seg.text, self.bump), key_loc)
        };
        obj.append_property(key_expr, value);
        Ok(())
    }

    // ── numbers and date/times ─────────────────────────────────────────────

    fn parse_number_or_datetime(&mut self) -> PResult<Expr> {
        let pos = self.pos;
        let loc = loc_of(pos);

        // Date/times start with an unsigned digit run: `DDDD-` or `DD:`.
        if self.peek().is_ascii_digit() {
            let d1 = self.digit_run_len(self.pos);
            if d1 == 4 && self.peek_at(self.pos + 4) == b'-' {
                let expr = self.parse_datetime_from_date()?;
                self.expect_value_terminator()?;
                return Ok(expr);
            }
            if d1 == 2 && self.peek_at(self.pos + 2) == b':' {
                let start = self.pos;
                self.parse_time_digits()?;
                self.expect_value_terminator()?;
                let raw = &self.src[start..self.pos];
                return Ok(Expr::init(E::String::init(raw), loc));
            }
        }

        self.parse_number()
    }

    fn digit_run_len(&self, start: usize) -> usize {
        let mut i = start;
        while self.peek_at(i).is_ascii_digit() {
            i += 1;
        }
        i - start
    }

    /// Exactly `n` ASCII digits starting at `pos`; returns their value.
    fn read_digits(&mut self, n: usize, what: &'static [u8]) -> PResult<u32> {
        let mut value: u32 = 0;
        for _ in 0..n {
            let c = self.peek();
            if !c.is_ascii_digit() {
                return Err(self.err(self.pos, what));
            }
            value = value * 10 + u32::from(c - b'0');
            self.pos += 1;
        }
        Ok(value)
    }

    /// `YYYY-MM-DD` and everything that may follow it (time, offset).
    /// Returns the full source text of the literal as the value.
    fn parse_datetime_from_date(&mut self) -> PResult<Expr> {
        let start = self.pos;
        let loc = loc_of(start);

        let year = self.read_digits(4, b"Invalid date: expected a 4-digit year")?;
        if self.peek() != b'-' {
            return Err(self.err(self.pos, b"Invalid date: expected '-' after the year"));
        }
        self.pos += 1;
        let month = self.read_digits(2, b"Invalid date: expected a 2-digit month")?;
        if self.peek() != b'-' {
            return Err(self.err(self.pos, b"Invalid date: expected '-' after the month"));
        }
        self.pos += 1;
        let day_pos = self.pos;
        let day = self.read_digits(2, b"Invalid date: expected a 2-digit day")?;

        if month < 1 || month > 12 {
            return Err(self.err(start, b"Invalid date: month must be between 01 and 12"));
        }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let max_day: u32 = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            _ => {
                if leap {
                    29
                } else {
                    28
                }
            }
        };
        if day < 1 || day > max_day {
            return Err(self.err(day_pos, b"Invalid date: day is out of range for the month"));
        }

        // Optional time part: 'T'/'t', or a space when a time clearly follows.
        let has_time = match self.peek() {
            b'T' | b't' => {
                self.pos += 1;
                true
            }
            b' ' if self.peek_at(self.pos + 1).is_ascii_digit()
                && self.peek_at(self.pos + 2).is_ascii_digit()
                && self.peek_at(self.pos + 3) == b':' =>
            {
                self.pos += 1;
                true
            }
            _ => false,
        };

        if has_time {
            self.parse_time_digits()?;
            // Optional offset.
            match self.peek() {
                b'Z' | b'z' => {
                    self.pos += 1;
                }
                b'+' | b'-' => {
                    self.pos += 1;
                    let hour =
                        self.read_digits(2, b"Invalid date-time offset: expected 2-digit hours")?;
                    if self.peek() != b':' {
                        return Err(self.err(
                            self.pos,
                            b"Invalid date-time offset: expected ':' between hours and minutes",
                        ));
                    }
                    self.pos += 1;
                    let minute =
                        self.read_digits(2, b"Invalid date-time offset: expected 2-digit minutes")?;
                    if hour > 23 {
                        return Err(self.err(
                            start,
                            b"Invalid date-time offset: hours must be between 00 and 23",
                        ));
                    }
                    if minute > 59 {
                        return Err(self.err(
                            start,
                            b"Invalid date-time offset: minutes must be between 00 and 59",
                        ));
                    }
                }
                _ => {}
            }
        }

        Ok(Expr::init(E::String::init(&self.src[start..self.pos]), loc))
    }

    /// `HH:MM[:SS[.frac]]` — seconds are optional in TOML 1.1.
    fn parse_time_digits(&mut self) -> PResult<()> {
        let start = self.pos;
        let hour = self.read_digits(2, b"Invalid time: expected 2-digit hours")?;
        if self.peek() != b':' {
            return Err(self.err(self.pos, b"Invalid time: expected ':' after hours"));
        }
        self.pos += 1;
        let minute = self.read_digits(2, b"Invalid time: expected 2-digit minutes")?;
        if hour > 23 {
            return Err(self.err(start, b"Invalid time: hours must be between 00 and 23"));
        }
        if minute > 59 {
            return Err(self.err(start, b"Invalid time: minutes must be between 00 and 59"));
        }
        // Seconds are optional in TOML 1.1.
        if self.peek() == b':' {
            self.pos += 1;
            let sec_pos = self.pos;
            let second = self.read_digits(2, b"Invalid time: expected 2-digit seconds")?;
            // 60 covers leap seconds, per RFC 3339.
            if second > 60 {
                return Err(self.err(sec_pos, b"Invalid time: seconds must be between 00 and 60"));
            }
            if self.peek() == b'.' {
                self.pos += 1;
                if !self.peek().is_ascii_digit() {
                    return Err(self.err(
                        self.pos,
                        b"Invalid time: expected at least one digit of fractional seconds",
                    ));
                }
                while self.peek().is_ascii_digit() {
                    self.pos += 1;
                }
            }
        }
        Ok(())
    }

    /// Validates an `_` between digits (per `is_digit`) and consumes it.
    fn check_underscore(&mut self, is_digit: impl Fn(u8) -> bool) -> PResult<()> {
        if !is_digit(self.peek_at(self.pos.wrapping_sub(1)))
            || !is_digit(self.peek_at(self.pos + 1))
        {
            return Err(self.err(self.pos, UNDERSCORE_IN_NUMBER));
        }
        self.pos += 1;
        Ok(())
    }

    /// Scans `digit (digit | _)*` with underscore placement validation.
    fn scan_decimal_digits(&mut self) -> PResult<()> {
        loop {
            let c = self.peek();
            if c.is_ascii_digit() {
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(|c| c.is_ascii_digit())?;
            } else {
                return Ok(());
            }
        }
    }

    fn parse_number(&mut self) -> PResult<Expr> {
        let start = self.pos;
        let loc = loc_of(start);

        let negative = match self.peek() {
            b'-' => {
                self.pos += 1;
                true
            }
            b'+' => {
                self.pos += 1;
                false
            }
            _ => false,
        };

        // inf / nan, optionally signed.
        if self.src[self.pos..].starts_with(b"inf") {
            self.pos += 3;
            self.expect_value_terminator()?;
            let value = if negative {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            };
            return Ok(Expr::init(E::Number::new(value), loc));
        }
        if self.src[self.pos..].starts_with(b"nan") {
            self.pos += 3;
            self.expect_value_terminator()?;
            // The sign of NaN is not observable in TOML.
            return Ok(Expr::init(E::Number::new(f64::NAN), loc));
        }

        // Radix-prefixed integers (unsigned only).
        if self.peek() == b'0' && matches!(self.peek_at(self.pos + 1), b'x' | b'o' | b'b') {
            if negative || self.src[start] == b'+' {
                return Err(self.err(
                    start,
                    b"A sign is not allowed on hexadecimal, octal, or binary integers",
                ));
            }
            return self.parse_radix_integer(loc);
        }

        if !self.peek().is_ascii_digit() {
            return Err(self.err_char(self.pos, "Expected a number but found"));
        }

        // Integer part.
        let int_start = self.pos;
        let mut int_value: i64 = 0;
        let mut int_overflow = false;
        let mut digits = 0usize;
        loop {
            let c = self.peek();
            if c.is_ascii_digit() {
                digits += 1;
                int_value = match int_value
                    .checked_mul(10)
                    .and_then(|v| v.checked_add(i64::from(c - b'0')))
                {
                    Some(v) => v,
                    None => {
                        int_overflow = true;
                        0
                    }
                };
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(|c| c.is_ascii_digit())?;
            } else {
                break;
            }
        }
        if digits > 1 && self.src[int_start] == b'0' {
            return Err(self.err(int_start, b"Leading zeros are not allowed in numbers"));
        }

        let mut is_float = false;

        // Fractional part.
        if self.peek() == b'.' {
            is_float = true;
            self.pos += 1;
            if !self.peek().is_ascii_digit() {
                return Err(self.err(
                    self.pos,
                    b"A decimal point must be followed by at least one digit",
                ));
            }
            self.scan_decimal_digits()?;
        }

        // Exponent part.
        if matches!(self.peek(), b'e' | b'E') {
            is_float = true;
            self.pos += 1;
            if matches!(self.peek(), b'+' | b'-') {
                self.pos += 1;
            }
            if !self.peek().is_ascii_digit() {
                return Err(self.err(self.pos, b"An exponent must contain at least one digit"));
            }
            self.scan_decimal_digits()?;
        }

        self.expect_value_terminator()?;

        if is_float {
            // Strip underscores and parse the whole literal as f64.
            let raw = &self.src[start..self.pos];
            let value = if bun_core::strings::contains(raw, b"_") {
                let mut cleaned: ArenaVec<'a, u8> =
                    ArenaVec::with_capacity_in(raw.len(), self.bump);
                for &c in raw {
                    if c != b'_' {
                        cleaned.push(c);
                    }
                }
                bun_core::fmt::parse_double(cleaned.as_slice())
            } else {
                bun_core::fmt::parse_double(raw)
            };
            let value = match value {
                Ok(v) => v,
                Err(_) => return Err(self.err(start, b"Invalid number")),
            };
            return Ok(Expr::init(E::Number::new(value), loc));
        }

        if int_overflow {
            return Err(self.err(start, b"Integer is outside the 64-bit signed range"));
        }
        let signed = if negative { -int_value } else { int_value };
        if signed > MAX_SAFE_INTEGER || signed < -MAX_SAFE_INTEGER {
            return Err(self.err(
                start,
                b"Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
            ));
        }
        Ok(Expr::init(E::Number::new(signed as f64), loc))
    }

    fn parse_radix_integer(&mut self, loc: Loc) -> PResult<Expr> {
        let start = self.pos;
        debug_assert_eq!(self.peek(), b'0');
        let radix_char = self.peek_at(self.pos + 1);
        let radix: u64 = match radix_char {
            b'x' => 16,
            b'o' => 8,
            _ => 2,
        };
        self.pos += 2;

        let is_digit = |c: u8| -> bool {
            match radix {
                16 => c.is_ascii_hexdigit(),
                8 => (b'0'..=b'7').contains(&c),
                _ => c == b'0' || c == b'1',
            }
        };

        if !is_digit(self.peek()) {
            return Err(self.err(
                self.pos,
                b"Expected at least one digit after the radix prefix",
            ));
        }

        let mut value: u64 = 0;
        let mut overflow = false;
        loop {
            let c = self.peek();
            if is_digit(c) {
                let digit = u64::from(
                    bun_core::fmt::hex_digit_value_u32(u32::from(c)).expect("checked by is_digit"),
                );
                value = match value.checked_mul(radix).and_then(|v| v.checked_add(digit)) {
                    Some(v) => v,
                    None => {
                        overflow = true;
                        0
                    }
                };
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(&is_digit)?;
            } else if c.is_ascii_alphanumeric() {
                return Err(self.err_char(self.pos, "Invalid digit in number:"));
            } else {
                break;
            }
        }

        self.expect_value_terminator()?;

        if overflow || value > i64::MAX as u64 {
            return Err(self.err(start, b"Integer is outside the 64-bit signed range"));
        }
        if value as i64 > MAX_SAFE_INTEGER {
            return Err(self.err(
                start,
                b"Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
            ));
        }
        Ok(Expr::init(E::Number::new(value as f64), loc))
    }

    /// A number or keyword value must be followed by something that can
    /// legitimately come after a value.
    fn expect_value_terminator(&mut self) -> PResult<()> {
        match self.peek() {
            0 if self.at_eof() => Ok(()),
            b' ' | b'\t' | b'\n' | b'\r' | b',' | b']' | b'}' | b'#' => Ok(()),
            _ => Err(self.err_char(self.pos, "Unexpected character after a value:")),
        }
    }

    // ── strings ────────────────────────────────────────────────────────────

    /// Single-line basic string (used for keys): returns decoded bytes.
    fn parse_basic_string_single_line(&mut self) -> PResult<&'a [u8]> {
        let (text, _) = self.parse_basic_string(false)?;
        Ok(text)
    }

    fn parse_literal_string_single_line(&mut self) -> PResult<&'a [u8]> {
        let (text, _) = self.parse_literal_string(false)?;
        Ok(text)
    }

    /// Basic string in value position: `"..."` or `"""..."""`.
    fn parse_basic_string_value(&mut self) -> PResult<(&'a [u8], bool)> {
        if self.src[self.pos..].starts_with(b"\"\"\"") {
            self.parse_basic_string(true)
        } else {
            self.parse_basic_string(false)
        }
    }

    fn parse_literal_string_value(&mut self) -> PResult<(&'a [u8], bool)> {
        if self.src[self.pos..].starts_with(b"'''") {
            self.parse_literal_string(true)
        } else {
            self.parse_literal_string(false)
        }
    }

    /// Counts the quote run at the cursor. Runs of 3-5 close a multi-line
    /// string (the final 3 are the delimiter, up to 2 belong to the content);
    /// longer runs are an error.
    fn quote_run_close(&mut self, quote: u8) -> PResult<(usize, bool)> {
        let mut run = 0usize;
        while self.peek_at(self.pos + run) == quote {
            run += 1;
        }
        if run > 5 {
            return Err(self.err(
                self.pos,
                b"Too many quotes at the end of a multi-line string",
            ));
        }
        Ok((run, run >= 3))
    }

    /// Returns (decoded bytes, is_ascii).
    fn parse_basic_string(&mut self, multiline: bool) -> PResult<(&'a [u8], bool)> {
        let open_pos = self.pos;
        self.pos += if multiline { 3 } else { 1 };

        if multiline {
            // A newline immediately after the opening delimiter is trimmed.
            match self.peek() {
                b'\n' => self.pos += 1,
                b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                _ => {}
            }
        }

        let mut buf: ArenaVec<'a, u8> = ArenaVec::with_capacity_in(0, self.bump);
        let mut is_ascii = true;
        loop {
            if self.at_eof() {
                return Err(self.err(open_pos, b"Unterminated string"));
            }
            let c = self.peek();
            match c {
                b'"' => {
                    if !multiline {
                        self.pos += 1;
                        return Ok((vec_into_slice(buf), is_ascii));
                    }
                    let (run, closes) = self.quote_run_close(b'"')?;
                    if closes {
                        for _ in 0..run - 3 {
                            buf.push(b'"');
                        }
                        self.pos += run;
                        return Ok((vec_into_slice(buf), is_ascii));
                    }
                    for _ in 0..run {
                        buf.push(b'"');
                    }
                    self.pos += run;
                }
                b'\\' => {
                    // Line-ending backslash (multi-line only): trim all
                    // whitespace up to the next non-whitespace character.
                    if multiline {
                        let mut i = self.pos + 1;
                        while matches!(self.peek_at(i), b' ' | b'\t') {
                            i += 1;
                        }
                        let at_line_end = match self.peek_at(i) {
                            b'\n' => true,
                            b'\r' if self.peek_at(i + 1) == b'\n' => true,
                            _ => false,
                        };
                        if at_line_end {
                            self.pos = i;
                            loop {
                                match self.peek() {
                                    b' ' | b'\t' | b'\n' => self.pos += 1,
                                    b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                                    _ => break,
                                }
                            }
                            continue;
                        }
                    }
                    self.parse_escape(&mut buf, &mut is_ascii)?;
                }
                b'\n' => {
                    if !multiline {
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; newlines must be escaped in basic strings",
                        ));
                    }
                    buf.push(b'\n');
                    self.pos += 1;
                }
                b'\r' => {
                    if multiline && self.peek_at(self.pos + 1) == b'\n' {
                        // CRLF normalizes to LF in multi-line strings.
                        buf.push(b'\n');
                        self.pos += 2;
                    } else {
                        return Err(self.err(self.pos, BARE_CR));
                    }
                }
                b'\t' => {
                    buf.push(b'\t');
                    self.pos += 1;
                }
                c if c < 0x20 || c == 0x7F => {
                    return Err(
                        self.err_char(self.pos, "Control character must be escaped in a string:")
                    );
                }
                c => {
                    if c >= 0x80 {
                        is_ascii = false;
                    }
                    buf.push(c);
                    self.pos += 1;
                }
            }
        }
    }

    fn parse_escape(&mut self, buf: &mut ArenaVec<'a, u8>, is_ascii: &mut bool) -> PResult<()> {
        debug_assert_eq!(self.peek(), b'\\');
        let escape_pos = self.pos;
        self.pos += 1;
        let c = self.peek();
        self.pos += 1;
        match c {
            b'b' => buf.push(0x08),
            b't' => buf.push(b'\t'),
            b'n' => buf.push(b'\n'),
            b'f' => buf.push(0x0C),
            b'r' => buf.push(b'\r'),
            b'"' => buf.push(b'"'),
            b'\\' => buf.push(b'\\'),
            // TOML 1.1
            b'e' => buf.push(0x1B),
            b'x' => {
                let cp = self.read_hex_codepoint("hex escape", 2, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            b'u' => {
                let cp = self.read_hex_codepoint("Unicode escape", 4, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            b'U' => {
                let cp = self.read_hex_codepoint("Unicode escape", 8, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            0 if self.at_eof() => {
                return Err(self.err(escape_pos, b"Unterminated escape sequence"));
            }
            _ => {
                self.pos -= 1;
                return Err(self.err_char(self.pos, "Invalid escape sequence:"));
            }
        }
        Ok(())
    }

    fn read_hex_codepoint(
        &mut self,
        what: &'static str,
        digits: usize,
        escape_pos: usize,
    ) -> PResult<u32> {
        let mut value: u32 = 0;
        for _ in 0..digits {
            let Some(d) = bun_core::fmt::hex_digit_value_u32(u32::from(self.peek())) else {
                return Err(self.err_fmt(
                    escape_pos,
                    format_args!(
                        "A {} must be followed by exactly {} hex digits",
                        what, digits
                    ),
                ));
            };
            value = value * 16 + u32::from(d);
            self.pos += 1;
        }
        Ok(value)
    }

    fn append_scalar(
        &mut self,
        buf: &mut ArenaVec<'a, u8>,
        cp: u32,
        escape_pos: usize,
        is_ascii: &mut bool,
    ) -> PResult<()> {
        let Some(ch) = char::from_u32(cp) else {
            return Err(self.err(
                escape_pos,
                b"Escaped code point must be a Unicode scalar value",
            ));
        };
        if cp >= 0x80 {
            *is_ascii = false;
        }
        let mut utf8 = [0u8; 4];
        for &b in ch.encode_utf8(&mut utf8).as_bytes() {
            buf.push(b);
        }
        Ok(())
    }

    /// Returns (decoded bytes, is_ascii) for `'...'` / `'''...'''`.
    fn parse_literal_string(&mut self, multiline: bool) -> PResult<(&'a [u8], bool)> {
        let open_pos = self.pos;
        self.pos += if multiline { 3 } else { 1 };

        if multiline {
            match self.peek() {
                b'\n' => self.pos += 1,
                b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                _ => {}
            }
        }

        // Literal strings have no escapes, so the content can usually borrow
        // the source; CRLF normalization in multi-line strings copies.
        let start = self.pos;
        let mut buf: Option<ArenaVec<'a, u8>> = None;
        let mut is_ascii = true;
        loop {
            if self.at_eof() {
                return Err(self.err(open_pos, b"Unterminated string"));
            }
            let c = self.peek();
            match c {
                b'\'' => {
                    if !multiline {
                        let text = match buf {
                            Some(b) => vec_into_slice(b),
                            None => &self.src[start..self.pos],
                        };
                        self.pos += 1;
                        return Ok((text, is_ascii));
                    }
                    let (run, closes) = self.quote_run_close(b'\'')?;
                    if closes {
                        let extra = run - 3;
                        let text = match buf.take() {
                            Some(mut b) => {
                                for _ in 0..extra {
                                    b.push(b'\'');
                                }
                                vec_into_slice(b)
                            }
                            None => &self.src[start..self.pos + extra],
                        };
                        self.pos += run;
                        return Ok((text, is_ascii));
                    }
                    if let Some(b) = &mut buf {
                        for _ in 0..run {
                            b.push(b'\'');
                        }
                    }
                    self.pos += run;
                }
                b'\n' => {
                    if !multiline {
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; literal strings cannot contain newlines",
                        ));
                    }
                    if let Some(b) = &mut buf {
                        b.push(b'\n');
                    }
                    self.pos += 1;
                }
                b'\r' => {
                    if multiline && self.peek_at(self.pos + 1) == b'\n' {
                        // CRLF normalizes to LF: switch to a copy if borrowing.
                        if buf.is_none() {
                            let mut b: ArenaVec<'a, u8> =
                                ArenaVec::with_capacity_in(self.pos - start, self.bump);
                            for &byte in &self.src[start..self.pos] {
                                b.push(byte);
                            }
                            buf = Some(b);
                        }
                        if let Some(b) = &mut buf {
                            b.push(b'\n');
                        }
                        self.pos += 2;
                    } else {
                        return Err(self.err(self.pos, BARE_CR));
                    }
                }
                b'\t' => {
                    if let Some(b) = &mut buf {
                        b.push(b'\t');
                    }
                    self.pos += 1;
                }
                c if c < 0x20 || c == 0x7F => {
                    return Err(self.err_char(
                        self.pos,
                        "Control character is not allowed in a literal string:",
                    ));
                }
                c => {
                    if c >= 0x80 {
                        is_ascii = false;
                    }
                    if let Some(b) = &mut buf {
                        b.push(c);
                    }
                    self.pos += 1;
                }
            }
        }
    }
}
