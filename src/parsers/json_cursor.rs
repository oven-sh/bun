//! On-demand JSON cursor over stage-1 structural indices.
//!
//! Stage 1 (`highway_json_index`) emits a flat `u32[]` of byte offsets for
//! every structural character and scalar start. A `JsonCursor` is a position
//! in that array; navigation walks indices, skipping unrequested values by
//! depth-counting `{`/`}` (or `[`/`]`) — no allocation, no `Expr`, no parse
//! of skipped subtrees. Values are decoded only when a leaf accessor
//! (`as_str`, `as_f64`, …) is called.
//!
//! Use this when the consumer reads a small fraction of a large document
//! (npm packuments, package.json `name`/`version` probes). For consumers
//! that need the full tree (bundler, printer), use `json_simd::SimdJSON`.

use bun_alloc::Arena as Bump;
use bun_ast::{self as js_ast, Expr};
use bun_highway as hwy;

/// Owns the stage-1 output; hand out cursors via [`JsonDoc::root`].
pub struct JsonDoc<'a> {
    src: &'a [u8],
    indices: Vec<u32>,
    /// `skip[i]` = index of the structural after the value starting at `i`
    /// (i.e. one past the matching `}`/`]` for containers, `i+1` for leaves).
    /// O(1) `after()` — built in one O(n) pass with a depth stack.
    skip: Vec<u32>,
    n: usize,
}

impl<'a> JsonDoc<'a> {
    pub fn parse(
        source: &'a js_ast::Source,
        log: &mut js_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        let src = &source.contents;
        let len = src.len();
        if len > i32::MAX as usize {
            log.add_error(
                Some(source),
                js_ast::Loc::default(),
                b"JSON input too large",
            );
            return Err(bun_core::err!("ParserError"));
        }
        let cap = len + 64 + 4;
        let mut indices = Vec::<u32>::with_capacity(cap);
        // SAFETY: capacity reserved; u32 is POD; stage-1 writes `[..count]`
        // and we write 3 sentinels; nothing else is read.
        unsafe { indices.set_len(cap) };
        let (rc, count, _flags) = hwy::json_index(src, &mut indices);
        if rc != hwy::JsonIndexError::Ok {
            let msg: &'static [u8] = match rc {
                hwy::JsonIndexError::UnclosedString => b"Unterminated string literal",
                hwy::JsonIndexError::UnescapedCtrlInString => {
                    b"Unescaped control character in string literal"
                }
                hwy::JsonIndexError::Empty => b"Unexpected end of file",
                _ => b"JSON parse error",
            };
            log.add_error(Some(source), js_ast::Loc::default(), msg);
            return Err(bun_core::err!("ParserError"));
        }
        let n = count as usize;
        indices[n] = len as u32;
        indices[n + 1] = len as u32;
        indices[n + 2] = len as u32;
        let skip = build_skip(src, &indices[..n], n);
        Ok(Self {
            src,
            indices,
            skip,
            n,
        })
    }

    #[inline]
    pub fn root(&self) -> JsonCursor<'_> {
        JsonCursor {
            src: self.src,
            idx: &self.indices,
            skip: &self.skip,
            pos: 0,
            end: self.n,
        }
    }
}

/// One linear pass: stack of open `{`/`[` positions; on the matching close,
/// pop and record `skip[open] = close+1`. Only container slots are written —
/// `after()` reads `skip[i]` only when `byte(i)` is `{`/`[`, so leaf slots
/// stay uninitialised.
fn build_skip(src: &[u8], idx: &[u32], n: usize) -> Vec<u32> {
    let mut skip = Vec::<u32>::with_capacity(n + 1);
    // SAFETY: u32 is POD; only indices `i` where `byte(i)∈{'{','['}` are ever
    // read by `after()`, and every such `i` is written below (matched → in the
    // pop, unmatched → in the drain).
    #[allow(clippy::uninit_vec)]
    unsafe {
        skip.set_len(n + 1)
    };
    let mut stack: Vec<u32> = Vec::with_capacity(64);
    for (i, &off) in idx.iter().enumerate() {
        // `idx[..n]` are real structurals (sentinels excluded), so `off < len`.
        match src[off as usize] {
            b'{' | b'[' => stack.push(i as u32),
            b'}' | b']' => {
                if let Some(open) = stack.pop() {
                    skip[open as usize] = i as u32 + 1;
                }
            }
            _ => {}
        }
    }
    for &open in &stack {
        skip[open as usize] = n as u32;
    }
    skip
}

/// A position in the structural-index array. Cheap to copy.
#[derive(Clone, Copy)]
pub struct JsonCursor<'a> {
    src: &'a [u8],
    idx: &'a [u32],
    skip: &'a [u32],
    /// Index into `idx` of this value's first structural.
    pos: usize,
    /// One past the last structural that may belong to this value.
    end: usize,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum JsonKind {
    Object,
    Array,
    String,
    Number,
    True,
    False,
    Null,
    Invalid,
}

impl<'a> JsonCursor<'a> {
    #[inline]
    fn byte(&self, p: usize) -> u8 {
        self.src.get(self.idx[p] as usize).copied().unwrap_or(0)
    }

    #[inline]
    pub fn loc(&self) -> js_ast::Loc {
        js_ast::usize2loc(self.idx[self.pos] as usize)
    }

    pub fn kind(&self) -> JsonKind {
        match self.byte(self.pos) {
            b'{' => JsonKind::Object,
            b'[' => JsonKind::Array,
            b'"' => JsonKind::String,
            b'-' | b'0'..=b'9' => JsonKind::Number,
            b't' => JsonKind::True,
            b'f' => JsonKind::False,
            b'n' => JsonKind::Null,
            _ => JsonKind::Invalid,
        }
    }

    /// Index of the structural after this value. O(1) via the skip table.
    #[inline]
    fn after(&self) -> usize {
        match self.byte(self.pos) {
            b'{' | b'[' => self.skip[self.pos] as usize,
            _ => self.pos + 1,
        }
    }

    #[inline]
    fn child(&self, pos: usize) -> JsonCursor<'a> {
        JsonCursor {
            src: self.src,
            idx: self.idx,
            skip: self.skip,
            pos,
            end: self.end,
        }
    }

    /// First child of an object: cursor at the key string. `None` if not an
    /// object or empty.
    fn first_field(&self) -> Option<usize> {
        if self.byte(self.pos) != b'{' {
            return None;
        }
        let p = self.pos + 1;
        if self.byte(p) == b'}' {
            return None;
        }
        Some(p)
    }

    /// Compare the string at `idx[p]` (an opening `"`) against `key` without
    /// scanning for the closing quote: match iff `src[open+1..open+1+len]==key`
    /// and the next byte is `"`. Correct for keys with no escapes; an escaped
    /// key falls through to the slow `string_body` compare.
    #[inline]
    fn key_eq(&self, p: usize, key: &[u8]) -> bool {
        let open = self.idx[p] as usize;
        let body = open + 1;
        if let Some(slice) = self.src.get(body..body + key.len()) {
            if slice == key && self.src.get(body + key.len()) == Some(&b'"') {
                return true;
            }
        }
        // Escape-aware fallback (rare).
        matches!(self.string_body(p), Some((s, _)) if s == key)
    }

    /// Raw key slice for the string at `idx[p]`: `src[open+1 .. close)`.
    /// Scalar scan — keys are short and escape-free in practice, so the FFI
    /// round-trip of `string_body` isn't worth it here.
    #[inline]
    fn raw_key(&self, p: usize) -> Option<&'a [u8]> {
        if self.byte(p) != b'"' {
            return None;
        }
        let start = self.idx[p] as usize + 1;
        // The next structural is `:` (or `,`/`}` for malformed input); the
        // closing `"` precedes it.
        let limit = self
            .idx
            .get(p + 1)
            .map(|&i| i as usize)
            .unwrap_or(self.src.len())
            .min(self.src.len());
        let mut i = start;
        while i < limit {
            match self.src[i] {
                b'"' => return Some(&self.src[start..i]),
                b'\\' => return self.string_body(p).map(|(s, _)| s),
                _ => i += 1,
            }
        }
        None
    }

    /// Body of the string at `idx[p]`, plus whether it contains an escape.
    /// Returns a borrowed slice into `src` (caller must decode if escaped).
    fn string_body(&self, p: usize) -> Option<(&'a [u8], bool)> {
        if self.byte(p) != b'"' {
            return None;
        }
        let start = self.idx[p] as usize + 1;
        let mut cur = start;
        let mut has_escape = false;
        loop {
            let s = &self.src[cur..];
            // SAFETY: `s` is a valid in-bounds subslice; the kernel reads at
            // most `s.len()` bytes (length-bounded SIMD with scalar tail).
            let (k, off) = unsafe { hwy::json_string_scan(s.as_ptr(), s.len()) };
            cur += off as usize;
            match k {
                1 => return Some((&self.src[start..cur], has_escape)),
                2 => {
                    has_escape = true;
                    // Skip the escape pair; `\uXXXX` is 6 bytes, others 2.
                    let esc = self.src.get(cur + 1).copied().unwrap_or(0);
                    cur += if esc == b'u' { 6 } else { 2 };
                }
                _ => return None,
            }
        }
    }

    // ── navigation ───────────────────────────────────────────────────────

    /// Object field lookup. Walks keys in order; values whose key doesn't
    /// match are skipped via [`Self::after`] without being parsed.
    pub fn get(&self, key: &[u8]) -> Option<JsonCursor<'a>> {
        let mut p = self.first_field()?;
        loop {
            // p: key string; p+1: `:`; p+2: value.
            let val_pos = p + 2;
            if val_pos >= self.end {
                return None;
            }
            let val = self.child(val_pos);
            if self.key_eq(p, key) {
                return Some(val);
            }
            let next = val.after();
            match self.byte(next) {
                b',' => p = next + 1,
                _ => return None, // `}` or malformed
            }
        }
    }

    /// Iterate `(key, value)` pairs of an object. Keys are raw source slices
    /// (escapes not decoded — packument keys never have them).
    pub fn iter_object(&self) -> ObjectIter<'a> {
        ObjectIter {
            c: *self,
            p: self.first_field(),
        }
    }

    pub fn iter_array(&self) -> ArrayIter<'a> {
        let p = if self.byte(self.pos) == b'[' && self.byte(self.pos + 1) != b']' {
            Some(self.pos + 1)
        } else {
            None
        };
        ArrayIter { c: *self, p }
    }

    // ── leaf accessors ───────────────────────────────────────────────────

    /// Borrowed string body. `None` if not a string or contains escapes (use
    /// [`Self::as_str_decoded`] for those).
    pub fn as_str(&self) -> Option<&'a [u8]> {
        match self.string_body(self.pos) {
            Some((s, false)) => Some(s),
            _ => None,
        }
    }

    /// String body with escapes decoded into `bump`.
    pub fn as_str_decoded(&self, bump: &'a Bump) -> Option<&'a [u8]> {
        let (raw, has_escape) = self.string_body(self.pos)?;
        if !has_escape {
            return Some(raw);
        }
        Some(decode_escapes(raw, bump))
    }

    pub fn as_f64(&self) -> Option<f64> {
        if !matches!(self.kind(), JsonKind::Number) {
            return None;
        }
        let start = self.idx[self.pos] as usize;
        let stop = self
            .idx
            .get(self.pos + 1)
            .map(|&i| i as usize)
            .unwrap_or(self.src.len())
            .min(self.src.len());
        let mut end = start;
        while end < stop
            && matches!(
                self.src[end],
                b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'
            )
        {
            end += 1;
        }
        core::str::from_utf8(&self.src[start..end])
            .ok()?
            .parse::<f64>()
            .ok()
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self.kind() {
            JsonKind::True => Some(true),
            JsonKind::False => Some(false),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self.kind(), JsonKind::Null)
    }

    #[inline]
    pub fn is_object(&self) -> bool {
        matches!(self.kind(), JsonKind::Object)
    }

    #[inline]
    pub fn is_array(&self) -> bool {
        matches!(self.kind(), JsonKind::Array)
    }

    /// Count of an object's keys (or array's elements). O(k) — walks one
    /// level via `iter_object`/`iter_array`; use sparingly.
    pub fn len(&self) -> usize {
        match self.kind() {
            JsonKind::Object => self.iter_object().count(),
            JsonKind::Array => self.iter_array().count(),
            _ => 0,
        }
    }

    /// Build a full `Expr` subtree for this value. Use when a downstream
    /// consumer needs the AST shape.
    pub fn materialize(
        &self,
        log: &mut js_ast::Log,
        bump: &'a Bump,
    ) -> Result<Expr, bun_core::Error> {
        // Slice the source to just this value and feed it to the full SIMD
        // parser. Re-indexing the slice is cheap relative to building the
        // tree, and keeps `materialize` independent of the cursor's index
        // bookkeeping.
        let start = self.idx[self.pos] as usize;
        let after = self.after();
        let stop = if after < self.idx.len() {
            self.idx[after] as usize
        } else {
            self.src.len()
        }
        .min(self.src.len());
        let sub = js_ast::Source::init_path_string(b"", &self.src[start..stop]);
        crate::json_simd::SimdJSON::parse(&sub, log, bump)
    }
}

pub struct ObjectIter<'a> {
    c: JsonCursor<'a>,
    p: Option<usize>,
}

impl<'a> Iterator for ObjectIter<'a> {
    type Item = (&'a [u8], JsonCursor<'a>);
    fn next(&mut self) -> Option<Self::Item> {
        let p = self.p?;
        let val_pos = p + 2;
        if val_pos >= self.c.end {
            self.p = None;
            return None;
        }
        let key = self.c.raw_key(p)?;
        let val = self.c.child(val_pos);
        let next = val.after();
        self.p = match self.c.byte(next) {
            b',' => Some(next + 1),
            _ => None,
        };
        Some((key, val))
    }
}

pub struct ArrayIter<'a> {
    c: JsonCursor<'a>,
    p: Option<usize>,
}

impl<'a> Iterator for ArrayIter<'a> {
    type Item = JsonCursor<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        let p = self.p?;
        let val = self.c.child(p);
        let next = val.after();
        self.p = match self.c.byte(next) {
            b',' => Some(next + 1),
            _ => None,
        };
        Some(val)
    }
}

// ── helpers ────────────────────────────────────────────────────────────────

pub fn decode_escapes_into<'a>(raw: &[u8], bump: &'a Bump) -> &'a [u8] {
    decode_escapes(raw, bump)
}

fn decode_escapes<'a>(raw: &[u8], bump: &'a Bump) -> &'a [u8] {
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if b != b'\\' {
            out.push(b);
            i += 1;
            continue;
        }
        let e = raw.get(i + 1).copied().unwrap_or(0);
        match e {
            b'"' | b'\\' | b'/' => {
                out.push(e);
                i += 2;
            }
            b'b' => {
                out.push(0x08);
                i += 2;
            }
            b'f' => {
                out.push(0x0c);
                i += 2;
            }
            b'n' => {
                out.push(0x0a);
                i += 2;
            }
            b'r' => {
                out.push(0x0d);
                i += 2;
            }
            b't' => {
                out.push(0x09);
                i += 2;
            }
            b'u' => {
                let hex = &raw.get(i + 2..i + 6).unwrap_or(&[]);
                let cp = hex4(hex).unwrap_or(0xFFFD);
                let mut cp = cp as u32;
                i += 6;
                if (0xD800..0xDC00).contains(&cp)
                    && raw.get(i..i + 2) == Some(b"\\u")
                    && let Some(lo) = hex4(&raw[i + 2..i + 6])
                    && (0xDC00..0xE000).contains(&(lo as u32))
                {
                    cp = 0x10000 + (((cp - 0xD800) << 10) | (lo as u32 - 0xDC00));
                    i += 6;
                }
                push_utf8(&mut out, cp);
            }
            _ => {
                out.push(b);
                i += 1;
            }
        }
    }
    bump.alloc_slice_copy(&out)
}

fn hex4(h: &[u8]) -> Option<u16> {
    if h.len() < 4 {
        return None;
    }
    let mut v = 0u32;
    for &b in &h[..4] {
        let d = match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            b'A'..=b'F' => b - b'A' + 10,
            _ => return None,
        };
        v = (v << 4) | u32::from(d);
    }
    Some(v as u16)
}

fn push_utf8(out: &mut Vec<u8>, cp: u32) {
    let mut buf = [0u8; 4];
    let s = char::from_u32(cp)
        .unwrap_or('\u{FFFD}')
        .encode_utf8(&mut buf);
    out.extend_from_slice(s.as_bytes());
}
