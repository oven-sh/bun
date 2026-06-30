//! Stage 1 of the JSON parser: the structural index, produced on demand.
//!
//! The indexer emits the byte offset of every token-significant position:
//!
//!   - every `{` `}` `[` `]` `:` `,` outside of strings
//!   - **both** the opening and the closing quote of every string
//!   - the first byte of every other run of non-whitespace bytes outside
//!     strings (numbers, `true`/`false`/`null`, and any garbage)
//!
//! in document order, terminated by two sentinel entries equal to
//! `contents.len()`. Stage 2 ([`crate::json_stage2`]) is a recursive-descent
//! parser over that sequence; it never re-scans bytes the indexer already
//! classified. Because both quotes of a string are present, a string's bounds
//! are two consecutive indices and its body is never touched unless the
//! per-block "dirty" bitmap says it contains a backslash or a control
//! character.
//!
//! Indices are *streamed*, not materialized: [`StructuralIndex`] owns a small
//! sliding window (a few thousand entries — callers only ever look one index
//! ahead of and a few behind their cursor) that is refilled from the source as
//! stage 2 advances. The only allocation proportional to the document is the
//! per-64-byte-block dirty bitmap (`len / 512` bytes). The producer is one of:
//!
//!   - the Highway SIMD kernel (`highway_json_index_chunk` in
//!     `src/jsc/bindings/highway_json.cpp`, simdjson-style: nibble-LUT
//!     classification, odd-backslash-run escape resolution, prefix-XOR
//!     in-string mask), fed 8 KB of input per refill. It handles plain JSON
//!     only: the first `/` or `'` it sees outside a double-quoted string (a
//!     comment or a single-quoted string — both legal for this parser) makes
//!     it bail out, and indexing restarts from the top of the document with
//!   - the scalar indexer: a byte-at-a-time, comment- and single-quote-aware
//!     state machine that emits the identical structure and is resumable at
//!     any token boundary. It is also the only producer on targets without
//!     Highway (wasm), and the reference implementation the SIMD kernel is
//!     differentially tested against.
use bun_ast::Range;

// The byte classification shared with the Highway JSON kernel: both sides are
// generated from `scripts/build/jsonByteClass.ts`, so the two index producers
// cannot disagree on a byte's class. No byte >= 0x80 classifies: multi-byte
// UTF-8 between tokens (exotic whitespace, a BOM) must stay in one run.
pub mod byte_class {
    include!(concat!(env!("BUN_CODEGEN_DIR"), "/json_byte_class.rs"));
}
use byte_class::{CLASS_STRUCTURAL, CLASS_WHITESPACE, JSON_BYTE_CLASS};

// Document-global facts collected during indexing. They match the C++
// kernel's flag bits. Flags accumulate as the document is indexed, so by
// the time stage 2 looks at a token, the flags cover at least every byte of
// that token.
/// Some string contains a `\`.
pub const FLAG_HAS_BACKSLASH_IN_STRING: u32 = 1 << 0;
/// Some string contains a control character (< 0x20).
pub const FLAG_HAS_CTRL_IN_STRING: u32 = 1 << 1;
/// SIMD kernel only: a `/` or `'` outside a string was seen; the chunk's
/// output is unusable and indexing restarts with the scalar indexer. Never
/// visible in [`StructuralIndex::flags`].
pub const FLAG_ODDITY: u32 = 1 << 3;

/// Number of sentinel entries appended after the real indices.
pub const SENTINELS: usize = 2;

/// Input bytes indexed per SIMD refill (a multiple of 4096, see
/// `json_structural_index_chunk`). Also bounds the index window: documents
/// shorter than this get a proportionally smaller window.
const REFILL_INPUT: usize = 8 * 1024;

/// Window entries kept *behind* the requested index when the window slides.
/// Stage 2 looks back at most a handful of indices (an object key while its
/// value is being checked, the token before an error position).
pub(crate) const LOOKBEHIND: usize = 16;

/// Errors the indexer itself can detect. They surface after stage 2 finishes:
/// the indexer truncates the index stream at the error (stage 2 then sees a
/// premature end of document) and the driver reports the index error instead
/// of whatever stage 2 produced.
#[derive(Clone, Copy)]
pub enum IndexError {
    /// `/*` with no closing `*/` — reported at end of file like the old lexer.
    UnterminatedBlockComment,
    /// A `/` outside a string starting neither `//` nor `/*`.
    UnexpectedSlash { pos: usize },
    /// The document is larger than a `Loc` (`i32`) can address. Rejected up
    /// front: this must survive release builds (a panic on user input).
    DocumentTooLarge,
}

/// The streaming structural index over one document. See the module docs.
pub struct StructuralIndex<'c> {
    contents: &'c [u8],
    /// The window: indices `[base, base + win.len())` of the document's index
    /// sequence (absolute byte offsets, strictly increasing). Capacity is
    /// fixed at construction; refills write into the spare capacity.
    win: Vec<u32>,
    base: usize,
    /// One bit per 64-byte input block: "a backslash or a control character
    /// inside a string lives here". Sized exactly (`len / 512` bytes).
    dirty: Vec<u64>,
    /// Flags accumulated over everything indexed so far.
    pub flags: u32,
    /// First comment seen (scalar indexer only): for the "JSON does not
    /// support comments" error in modes that reject them.
    pub first_comment: Option<Range>,
    /// Set when the indexer hit an error; the index stream was truncated at
    /// that point (sentinels appended). Reported by the driver in preference
    /// to stage 2's outcome.
    pub index_error: Option<IndexError>,
    /// All input has been indexed and the sentinels appended.
    done: bool,

    // ── SIMD producer state ──
    /// Next input byte to hand to the kernel.
    src_off: usize,
    /// Escape / in-string / scalar-run carry between kernel calls.
    kernel_state: [u64; 3],

    // ── scalar producer state (also the post-oddity fallback) ──
    use_scalar: bool,
    s_i: usize,
    s_prev_scalar: bool,
    s_pending_escape: bool,
    /// On the SIMD→scalar restart, the number of already-delivered indices
    /// the scalar pass must re-derive and swallow before it appends new ones.
    s_skip: usize,
}

impl<'c> StructuralIndex<'c> {
    pub fn new(contents: &'c [u8]) -> Self {
        Self::with_producer(contents, !bun_core::env::IS_NATIVE)
    }

    fn with_producer(contents: &'c [u8], use_scalar: bool) -> Self {
        if contents.len() > i32::MAX as usize {
            let mut idx = Self::empty(contents, use_scalar);
            idx.index_error = Some(IndexError::DocumentTooLarge);
            idx.done = true;
            return idx;
        }
        // Worst case for one refill: every input byte is an index, plus the
        // kernel's vector-width overshoot, the sentinels, and the look-behind
        // band that survives a slide.
        let win_cap = contents.len().min(REFILL_INPUT) + 66 + SENTINELS + LOOKBEHIND;
        let dirty_words = (contents.len().div_ceil(64)).div_ceil(64) + 1;
        let mut idx = Self::empty(contents, use_scalar);
        idx.win = Vec::with_capacity(win_cap);
        idx.dirty = vec![0; dirty_words];
        idx
    }

    /// A zeroed index over `contents`, allocating nothing.
    fn empty(contents: &'c [u8], use_scalar: bool) -> Self {
        StructuralIndex {
            contents,
            win: Vec::new(),
            base: 0,
            dirty: Vec::new(),
            flags: 0,
            first_comment: None,
            index_error: None,
            done: false,
            src_off: 0,
            kernel_state: [0; 3],
            use_scalar,
            s_i: 0,
            s_prev_scalar: false,
            s_pending_escape: false,
            s_skip: 0,
        }
    }

    /// Byte position of index `logical` (0-based over the whole document's
    /// index sequence), producing more of the index as needed. Positions at
    /// or past the end of the index sequence are the sentinel
    /// `contents.len()`. `logical` may lag the furthest position ever
    /// requested by at most [`LOOKBEHIND`].
    #[inline(always)]
    pub fn at(&mut self, logical: usize) -> usize {
        if logical - self.base >= self.win.len() {
            self.fill_to(logical);
        }
        self.win[logical - self.base] as usize
    }

    #[cold]
    fn fill_to(&mut self, logical: usize) {
        while logical - self.base >= self.win.len() {
            if self.done {
                // Past the sentinels: stage 2 never asks for more than one
                // index past the second sentinel.
                debug_assert!(false, "index requested past the sentinels");
                let last = *self.win.last().expect("sentinels present");
                self.win.push(last);
                continue;
            }
            // Slide: keep `LOOKBEHIND` entries before the requested index so
            // the whole refill capacity is available.
            let keep_from = logical.saturating_sub(LOOKBEHIND).max(self.base) - self.base;
            if keep_from > 0 {
                self.win.copy_within(keep_from.., 0);
                self.win.truncate(self.win.len() - keep_from);
                self.base += keep_from;
            }
            self.refill_once();
        }
    }

    /// Produce at least one more index entry (or the sentinels, or switch
    /// producers). The window has at least `REFILL_INPUT + 66 + SENTINELS`
    /// spare capacity when called.
    fn refill_once(&mut self) {
        let len = self.contents.len();
        // `IS_NATIVE` is a constant: on targets without the Highway kernel
        // this whole branch (and the FFI symbol) is compiled out.
        if bun_core::env::IS_NATIVE && !self.use_scalar {
            if self.src_off >= len {
                return self.finish();
            }
            let chunk_len = (len - self.src_off).min(REFILL_INPUT);
            let word_off = self.src_off / 4096;
            let nwords = (chunk_len.div_ceil(64)).div_ceil(64);
            let filled = self.win.len();
            let (n, chunk_flags) = bun_highway::json_structural_index_chunk(
                &self.contents[self.src_off..self.src_off + chunk_len],
                self.src_off,
                &mut self.win.spare_capacity_mut()[..chunk_len + 66],
                &mut self.dirty[word_off..word_off + nwords],
                &mut self.kernel_state,
            );
            if chunk_flags & FLAG_ODDITY != 0 {
                // A comment or a single-quoted string: restart from the top
                // of the document with the scalar indexer, re-deriving (and
                // swallowing) the indices already handed out. Everything
                // already delivered is identical between the two producers
                // (differentially tested), so the consumer never notices.
                self.use_scalar = true;
                self.s_skip = self.base + self.win.len();
                self.dirty.fill(0);
                return;
            }
            self.flags |= chunk_flags;
            // SAFETY: the kernel initialized `n` entries of the spare
            // capacity it was given.
            unsafe { self.win.set_len(filled + n) };
            self.src_off += chunk_len;
            return;
        }
        self.scalar_refill();
    }

    /// Append the sentinels.
    fn finish(&mut self) {
        let len = self.contents.len() as u32;
        self.win.push(len);
        self.win.push(len);
        self.done = true;
    }

    /// Does the byte range `[from, to)` overlap a 64-byte block that contains
    /// a backslash or a control character inside a string? False positives at
    /// block granularity are fine (they just cause a scan); false negatives
    /// never happen for ranges the indexer has already covered.
    #[inline(always)]
    pub fn is_dirty(&self, from: usize, to: usize) -> bool {
        if to <= from {
            return false;
        }
        let dirty = &self.dirty;
        let first = from >> 6;
        let last = (to - 1) >> 6;
        let (fw, fb) = (first >> 6, first & 63);
        let (lw, lb) = (last >> 6, last & 63);
        if fw == lw {
            // Bits [fb, lb] of word fw.
            let mask = (u64::MAX << fb) & (u64::MAX >> (63 - lb));
            return dirty[fw] & mask != 0;
        }
        if dirty[fw] & (u64::MAX << fb) != 0 || dirty[lw] & (u64::MAX >> (63 - lb)) != 0 {
            return true;
        }
        dirty[fw + 1..lw].iter().any(|&w| w != 0)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Scalar producer
    // ──────────────────────────────────────────────────────────────────────

    /// Comment- and single-quote-aware scalar indexer: produces the same
    /// index structure as the SIMD kernel, plus
    ///
    ///   - comment bytes produce no indices at all (the first comment's range
    ///     is recorded for modes that reject comments)
    ///   - single-quoted strings are indexed exactly like double-quoted ones
    ///     (stage 2 sees the `'` byte at the index)
    ///
    /// Resumable: it stops emitting at a token boundary whenever the window
    /// is full and continues from `s_i` on the next call. It is the only
    /// producer on wasm, the fallback whenever the SIMD kernel reports an
    /// oddity, and the reference implementation the kernel is differentially
    /// tested against.
    fn scalar_refill(&mut self) {
        let s = self.contents;
        let n = s.len();
        // Stop emitting when fewer than 4 slots remain before the space
        // reserved for the sentinels (an iteration emits at most 2 entries).
        let emit_cap = self.win.capacity() - SENTINELS - 2;
        let mut i = self.s_i;

        macro_rules! emit {
            ($pos:expr) => {{
                if self.s_skip > 0 {
                    self.s_skip -= 1;
                } else {
                    self.win.push($pos as u32);
                }
            }};
        }
        macro_rules! mark_dirty {
            ($pos:expr) => {{
                let block = $pos >> 6;
                self.dirty[block >> 6] |= 1u64 << (block & 63);
            }};
        }

        while i < n {
            if self.win.len() >= emit_cap {
                self.s_i = i;
                return;
            }
            let c = s[i];
            let was_escaped = self.s_pending_escape;
            self.s_pending_escape = false;
            match c {
                // An escaped quote outside a string does not open one; the
                // byte is an ordinary scalar-run byte (the `_` arm below).
                b'"' | b'\'' if !was_escaped => {
                    emit!(i);
                    self.s_prev_scalar = false;
                    let quote = c;
                    i += 1;
                    while i < n {
                        let b = s[i];
                        if b == quote {
                            emit!(i);
                            i += 1;
                            break;
                        }
                        if b == b'\\' {
                            self.flags |= FLAG_HAS_BACKSLASH_IN_STRING;
                            mark_dirty!(i);
                            // Classify the escaped byte too, mirroring the
                            // SIMD kernel's positional masks.
                            if let Some(&e) = s.get(i + 1) {
                                if e < 0x20 {
                                    self.flags |= FLAG_HAS_CTRL_IN_STRING;
                                    mark_dirty!(i + 1);
                                }
                            }
                            i += 2;
                            continue;
                        }
                        if b < 0x20 {
                            self.flags |= FLAG_HAS_CTRL_IN_STRING;
                            mark_dirty!(i);
                        }
                        i += 1;
                    }
                    // Unterminated string: no closing index; stage 2 reports it.
                }
                b'/' => {
                    self.s_prev_scalar = false;
                    let start = i;
                    match s.get(i + 1) {
                        Some(b'/') => {
                            i += 2;
                            while i < n {
                                let b = s[i];
                                if b == b'\n' || b == b'\r' || is_ls_ps(s, i) {
                                    break;
                                }
                                i += 1;
                            }
                        }
                        Some(b'*') => {
                            i += 2;
                            loop {
                                if i >= n {
                                    return self.fail(IndexError::UnterminatedBlockComment);
                                }
                                if s[i] == b'*' && s.get(i + 1) == Some(&b'/') {
                                    i += 2;
                                    break;
                                }
                                i += 1;
                            }
                        }
                        _ => return self.fail(IndexError::UnexpectedSlash { pos: i }),
                    }
                    if self.first_comment.is_none() {
                        self.first_comment = Some(Range {
                            loc: bun_ast::usize2loc(start),
                            len: (i - start) as i32,
                        });
                    }
                }
                _ => {
                    // Classified by the generated table — the exact
                    // classification the kernel's nibble LUTs compute. The
                    // streams of the two producers must be identical: the
                    // post-oddity restart swallows a *count* of
                    // already-delivered indices, and this is the reference
                    // implementation the kernel is differentially tested
                    // against.
                    let cls = JSON_BYTE_CLASS[c as usize];
                    if cls & CLASS_STRUCTURAL != 0 {
                        emit!(i);
                        self.s_prev_scalar = false;
                    } else if cls & CLASS_WHITESPACE != 0 {
                        self.s_prev_scalar = false;
                    } else {
                        // A scalar-run byte. A backslash outside of a string
                        // "escapes" the next byte exactly like the kernel's
                        // global odd-backslash-run parity does: the only
                        // effect is whether a following `"` opens a string.
                        if c == b'\\' && !was_escaped {
                            self.s_pending_escape = true;
                        }
                        if !self.s_prev_scalar {
                            emit!(i);
                        }
                        self.s_prev_scalar = true;
                    }
                    i += 1;
                }
            }
        }
        self.s_i = i;
        self.finish();
    }

    /// Record an index error and truncate the index stream here.
    #[cold]
    fn fail(&mut self, e: IndexError) {
        self.index_error = Some(e);
        self.finish();
    }
}

/// U+2028 / U+2029 (3-byte UTF-8: E2 80 A8/A9) terminate `//` comments, like
/// the old lexer.
#[inline]
pub(crate) fn is_ls_ps(s: &[u8], i: usize) -> bool {
    s[i] == 0xE2 && s.get(i + 1) == Some(&0x80) && matches!(s.get(i + 2), Some(0xA8) | Some(0xA9))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive a [`StructuralIndex`] to completion and return every real index
    /// plus the final flags. Exercises the sliding window exactly as stage 2
    /// does (monotonically increasing positions).
    fn collect(idx: &mut StructuralIndex) -> (Vec<u32>, u32) {
        let len = idx.contents.len();
        let mut out = Vec::new();
        let mut i = 0;
        loop {
            let p = idx.at(i);
            // Confirm the look-behind contract while we're here.
            if i > 0 {
                assert!(idx.at(i - 1) <= p);
            }
            if p == len && idx.at(i + 1) == len {
                break;
            }
            out.push(p as u32);
            i += 1;
        }
        (out, idx.flags)
    }

    fn idx(s: &str) -> (Vec<u32>, u32) {
        let mut x = StructuralIndex::new(s.as_bytes());
        let r = collect(&mut x);
        assert!(x.index_error.is_none());
        r
    }

    /// The scalar indexer is also the reference model for the SIMD kernel: on
    /// documents without comments or single quotes (where the SIMD producer
    /// is used) both must produce the same indices and flags.
    fn build_both(contents: &[u8]) -> Option<(Vec<u32>, u32, Vec<u32>, u32)> {
        let mut simd = StructuralIndex::new(contents);
        let (si, sf) = collect(&mut simd);
        if simd.index_error.is_some() {
            return None;
        }
        let mut scalar = StructuralIndex::with_producer(contents, true);
        let (ci, cf) = collect(&mut scalar);
        if scalar.index_error.is_some() {
            return None;
        }
        Some((si, sf, ci, cf))
    }

    #[test]
    fn streaming_and_scalar_indexers_agree_on_large_documents() {
        // Many refills (and, on native targets, many kernel chunks).
        let mut doc = String::with_capacity(3 * 1024 * 1024);
        doc.push('{');
        let mut i = 0;
        while doc.len() < 320 * REFILL_INPUT {
            if i > 0 {
                doc.push(',');
            }
            doc.push_str(&format!(
                "\"key{i}\":[\"value with a tail {i}\", {i}, true, null, {{\"nested\": \"x{i}\", \"esc\": \"a\\n{i}\"}}]"
            ));
            i += 1;
        }
        doc.push('}');
        let (si, sf, ci, cf) = build_both(doc.as_bytes()).unwrap();
        assert_eq!(si.len(), ci.len(), "index count");
        assert_eq!(si, ci);
        assert_eq!(sf, cf);
    }

    #[test]
    fn simd_and_scalar_indexers_agree() {
        // Deterministic pseudo-random JSON-ish documents over a hostile
        // alphabet (quotes, escapes, structurals, non-ASCII), all lengths
        // around the 64-byte block size.
        let mut state = 0x9E3779B97F4A7C15u64;
        let mut rng = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        // Non-ASCII bytes (including every byte of a UTF-8 BOM) must never
        // classify as structural; both producers must agree on that.
        let alphabet: &[u8] =
            b"{}[]:,\"\\ \t\n\r0123456789aetfn.-+\x01\x1f\x80\xc3\xa9\xbb\xbc\xbd\xcc\xdb\xdd\xef\xbf";
        for _ in 0..20_000 {
            let len = (rng() % 200) as usize;
            let mut buf = Vec::with_capacity(len);
            for _ in 0..len {
                buf.push(alphabet[(rng() as usize) % alphabet.len()]);
            }
            // The alphabet has no '/' or '\'' so the SIMD producer never
            // bails on these.
            let Some((si, sf, ci, cf)) = build_both(&buf) else {
                continue;
            };
            assert_eq!(si, ci, "index mismatch for {:?}", bstr::BStr::new(&buf));
            assert_eq!(sf, cf, "flag mismatch for {:?}", bstr::BStr::new(&buf));
        }
        // Real-shaped documents: long strings, escapes at block boundaries.
        for pad in 40..=96usize {
            let doc = format!(
                "{{\"{}\": \"x\", \"k\": [1, -2.5e7, true, \"{}\\n\"]}}",
                "a".repeat(pad),
                "é".repeat(pad / 2),
            );
            let (si, sf, ci, cf) = build_both(doc.as_bytes()).unwrap();
            assert_eq!((si, sf), (ci, cf), "mismatch for {doc:?}");
        }
    }

    #[test]
    fn simd_fallback_to_scalar_mid_document_is_seamless() {
        // The oddity (a comment) appears far into the document, long after
        // indices from the SIMD producer have been consumed; the scalar
        // restart must hand out the continuation seamlessly.
        for oddity in ["// trailing comment\n", "'single'"] {
            // With and without a UTF-8 BOM: the two producers must index a
            // multi-byte codepoint identically (one scalar run), or the
            // restart's swallow-count misaligns and stage 2 sees a corrupt
            // stream.
            for prefix in ["", "\u{FEFF}"] {
                let mut doc = String::from(prefix);
                doc.push('[');
                while doc.len() < 5 * REFILL_INPUT {
                    doc.push_str("\"padding padding padding\", 12345, true, ");
                }
                let tail = format!("{oddity} \"end\"]");
                let strict = format!("{}\"x\"]", &doc);
                doc.push_str(&tail);
                let mut streamed = StructuralIndex::new(doc.as_bytes());
                let (si, sf) = collect(&mut streamed);
                let mut scalar = StructuralIndex::with_producer(doc.as_bytes(), true);
                let (ci, cf) = collect(&mut scalar);
                assert_eq!(si, ci, "prefix {prefix:?} oddity {oddity:?}");
                assert_eq!(sf, cf);
                // And a document with no oddity at all stays on the SIMD path.
                let mut clean = StructuralIndex::new(strict.as_bytes());
                collect(&mut clean);
                assert!(!clean.use_scalar || !bun_core::env::IS_NATIVE);
            }
        }
    }

    #[test]
    fn structural_positions_and_string_pairs() {
        let (v, _) = idx(r#"{"a": [1, true, "b\"c"], "d": null}"#);
        let s = r#"{"a": [1, true, "b\"c"], "d": null}"#;
        // Every structural char outside strings is present.
        for (i, ch) in s.bytes().enumerate() {
            if matches!(ch, b'{' | b'}' | b'[' | b']' | b':' | b',')
                && !(17..=21).contains(&i)
                && !(1..=3).contains(&i)
            {
                assert!(v.contains(&(i as u32)), "missing structural at {i}");
            }
        }
        // String open/close pairs are consecutive entries.
        let pos = v.iter().position(|&p| p == 16).unwrap();
        assert_eq!(v[pos + 1], 21, "open/close quotes adjacent in the index");
    }

    #[test]
    fn comments_produce_no_indices_and_are_recorded() {
        let src = "// hello\n{\"a\" /* x */ : 1}";
        let mut x = StructuralIndex::new(src.as_bytes());
        let (v, _) = collect(&mut x);
        assert!(x.index_error.is_none());
        let first = x.first_comment.expect("comment recorded");
        assert_eq!(first.loc.start, 0);
        assert_eq!(first.len, 8);
        // Indices: { " " : 1 } and nothing inside the comments.
        let expected: Vec<u32> = vec![9, 10, 12, 22, 24, 25];
        assert_eq!(v, expected);
    }

    #[test]
    fn unterminated_block_comment_is_an_index_error() {
        let mut x = StructuralIndex::new(b"{} /* never closed");
        let _ = collect(&mut x);
        assert!(matches!(
            x.index_error,
            Some(IndexError::UnterminatedBlockComment)
        ));
        let mut x = StructuralIndex::new(b"{\"a\": 1 ~/ 2}");
        let _ = collect(&mut x);
        assert!(matches!(
            x.index_error,
            Some(IndexError::UnexpectedSlash { pos: 9 })
        ));
    }

    #[test]
    fn dirty_bitmap_marks_only_blocks_with_specials() {
        let pad = "x".repeat(70);
        let src = format!(r#"{{"a": "b\nc", "p": "{pad}"}}"#);
        let mut x = StructuralIndex::new(src.as_bytes());
        let _ = collect(&mut x);
        // The escape lives in block 0.
        assert!(x.is_dirty(7, 12));
        // The long clean string spans blocks 0..2; only block 0 is dirty.
        let p_start = src.find(&pad).unwrap();
        assert!(!x.is_dirty(p_start.next_multiple_of(64), src.len()));
        assert_eq!(
            x.flags & FLAG_HAS_BACKSLASH_IN_STRING,
            FLAG_HAS_BACKSLASH_IN_STRING
        );
    }

    #[test]
    fn empty_and_whitespace_documents() {
        let (v, _) = idx("");
        assert!(v.is_empty());
        let (v, _) = idx("   \n\t  ");
        assert!(v.is_empty());
    }
}
