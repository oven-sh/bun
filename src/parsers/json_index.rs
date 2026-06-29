//! Stage 1 of the JSON parser: the structural index.
//!
//! One batched pass over the document produces the byte offset of every
//! token-significant position:
//!
//!   - every `{` `}` `[` `]` `:` `,` outside of strings
//!   - **both** the opening and the closing quote of every string
//!   - the first byte of every other run of non-whitespace bytes outside
//!     strings (numbers, `true`/`false`/`null`, and any garbage)
//!
//! in document order, terminated by two sentinel entries equal to
//! `contents.len()`. Stage 2 ([`crate::json`]) is a recursive-descent parser
//! over this index array; it never re-scans bytes the indexer already
//! classified. Because both quotes of a string are present, a string's bounds
//! are two consecutive indices and its body is never touched unless the
//! per-block "dirty" bitmap says it contains a backslash or a control
//! character.
//!
//! The hot path is a Highway SIMD kernel (`highway_json_index` in
//! `src/jsc/bindings/highway_json.cpp`, simdjson-style: nibble-LUT
//! classification, odd-backslash-run escape resolution, prefix-XOR in-string
//! mask). It handles plain JSON only: the first `/` or `'` it sees outside a
//! double-quoted string (a comment or a single-quoted string — both legal for
//! this parser) makes it bail out, and the document is re-indexed by
//! [`scalar_index`], a byte-at-a-time indexer that understands comments and
//! single quotes and emits the identical structure. The scalar indexer is also
//! the only path on targets without Highway (wasm).
use core::cell::RefCell;

use bun_ast::Range;

// Document-global facts collected by stage 1 (see `json_index.h` for the
// C++-side definition of the first four).
/// Some string contains a `\`.
pub const FLAG_HAS_BACKSLASH_IN_STRING: u32 = 1 << 0;
/// Some string contains a control character (< 0x20).
pub const FLAG_HAS_CTRL_IN_STRING: u32 = 1 << 1;
/// Some byte anywhere is >= 0x80.
pub const FLAG_HAS_NON_ASCII: u32 = 1 << 2;
/// SIMD only: a `/` or `'` outside a string was seen; the SIMD result is
/// unusable and the scalar indexer must run. Never set on a returned
/// [`StructuralIndex`].
pub const FLAG_ODDITY: u32 = 1 << 3;
/// Scalar indexer only: the document contained at least one single-quoted
/// string (stage 2 only needs this to know quickly that `'` is in play).
pub const FLAG_HAS_SINGLE_QUOTE: u32 = 1 << 4;

/// Number of sentinel entries appended after the real indices.
pub const SENTINELS: usize = 2;

/// Errors the indexer itself can detect. Everything else is stage 2's job.
pub enum IndexError {
    /// `/*` with no closing `*/` — reported at end of file like the old lexer.
    UnterminatedBlockComment,
    /// A `/` outside a string starting neither `//` nor `/*`.
    UnexpectedSlash { pos: usize },
}

/// The structural index over one document, plus the reusable scratch buffers
/// it lives in. Return it to the pool with [`StructuralIndex::release`] (a
/// plain `Drop` also works, it just frees the buffers instead of pooling them).
pub struct StructuralIndex {
    bufs: ScratchBufs,
    /// Real index count (excludes the two sentinels).
    n: usize,
    pub flags: u32,
    /// First comment in the document (scalar indexer only): for the
    /// "JSON does not support comments" error when comments are not allowed.
    pub first_comment: Option<Range>,
}

impl StructuralIndex {
    /// All indices in document order, including the two `contents.len()`
    /// sentinels. Every entry's value is `< contents.len()` except the
    /// sentinels, and entries are strictly increasing.
    #[inline(always)]
    pub fn indices(&self) -> &[u32] {
        &self.bufs.indices[..self.n + SENTINELS]
    }

    /// Number of real (non-sentinel) indices.
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.n
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Does the byte range `[from, to)` overlap a 64-byte block that contains
    /// a backslash or a control character inside a string? False positives at
    /// block granularity are fine (they just cause a scan); false negatives
    /// never happen.
    #[inline(always)]
    pub fn is_dirty(&self, from: usize, to: usize) -> bool {
        if to <= from {
            return false;
        }
        let dirty = &self.bufs.dirty;
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

    /// Return the scratch buffers to the thread-local pool.
    pub fn release(self) {
        scratch_put(self.bufs);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Scratch pool
// ──────────────────────────────────────────────────────────────────────────
//
// The index buffer for a document of N bytes needs capacity for N+66 u32
// entries in the worst case (every byte structural). The buffers are pooled
// per thread so steady-state parses (every package.json / manifest in an
// install) reuse warm memory; oversized buffers are shrunk on release so one
// huge document doesn't pin hundreds of MB.
//
// The SIMD kernel writes into the spare capacity and reports how much it
// initialized: zero-filling a buffer this large every parse would cost more
// than the rest of the parse for big documents.

struct ScratchBufs {
    indices: Vec<u32>,
    dirty: Vec<u64>,
    /// Per-chunk output of the resumable kernel (documents > `ONESHOT_MAX`);
    /// fixed capacity, always pooled.
    chunk_out: Vec<u32>,
}

const MAX_POOLED_BYTES: usize = 8 * 1024 * 1024;

thread_local! {
    static SCRATCH: RefCell<Option<ScratchBufs>> = const { RefCell::new(None) };
}

fn scratch_get() -> ScratchBufs {
    SCRATCH.with_borrow_mut(Option::take).unwrap_or(ScratchBufs {
        indices: Vec::new(),
        dirty: Vec::new(),
        chunk_out: Vec::new(),
    })
}

fn scratch_put(mut bufs: ScratchBufs) {
    if bufs.indices.capacity() * 4 > MAX_POOLED_BYTES {
        bufs.indices = Vec::new();
        bufs.dirty = Vec::new();
    } else {
        bufs.indices.clear();
        bufs.dirty.clear();
    }
    bufs.chunk_out.clear();
    SCRATCH.with_borrow_mut(|slot| {
        if slot.is_none() {
            *slot = Some(bufs);
        }
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Build
// ──────────────────────────────────────────────────────────────────────────

/// Documents up to this size are indexed with a single kernel call into a
/// worst-case-sized buffer (4 bytes per input byte). Bigger documents (large
/// registry manifests) go through the resumable kernel in `CHUNK_BYTES`
/// pieces so the only large allocation is the exactly-sized result.
const ONESHOT_MAX: usize = 1024 * 1024;
/// Multiple of 4096 (see `json_structural_index_chunk`).
const CHUNK_BYTES: usize = 1024 * 1024;

/// Build the structural index for `contents`.
pub fn build(contents: &[u8]) -> Result<StructuralIndex, IndexError> {
    debug_assert!(contents.len() < u32::MAX as usize);
    let mut bufs = scratch_get();

    // SIMD fast path: native targets, no comments / single quotes.
    if bun_core::env::IS_NATIVE && !contents.is_empty() {
        let (n, flags) = if contents.len() <= ONESHOT_MAX {
            build_simd_oneshot(contents, &mut bufs)
        } else {
            build_simd_chunked(contents, &mut bufs)
        };
        if flags & FLAG_ODDITY == 0 {
            return Ok(StructuralIndex { bufs, n, flags, first_comment: None });
        }
        // fall through to the scalar indexer
    }

    scalar_index(contents, bufs)
}

/// One kernel call over the whole document. On success `bufs.indices` holds
/// the indices + the two sentinels and `bufs.dirty` the whole bitmap.
fn build_simd_oneshot(contents: &[u8], bufs: &mut ScratchBufs) -> (usize, u32) {
    let need = contents.len() + 64 + SENTINELS;
    let dirty_words = (contents.len().div_ceil(64)).div_ceil(64);
    bufs.indices.clear();
    bufs.indices.reserve(need);
    bufs.dirty.clear();
    bufs.dirty.reserve(dirty_words);
    let (n, flags) = bun_highway::json_structural_index(
        contents,
        &mut bufs.indices.spare_capacity_mut()[..need],
        &mut bufs.dirty.spare_capacity_mut()[..dirty_words],
    );
    if flags & FLAG_ODDITY == 0 {
        // SAFETY: per `json_structural_index`'s contract (no ODDITY), the
        // kernel initialized `indices[..n + SENTINELS]` and
        // `dirty[..dirty_words]`, both within the reserved capacity.
        unsafe {
            bufs.indices.set_len(n + SENTINELS);
            bufs.dirty.set_len(dirty_words);
        }
    }
    (n, flags)
}

/// Resumable kernel over `CHUNK_BYTES` pieces: the per-call output buffer is
/// small and pooled, and the only allocation proportional to the document is
/// the exactly-sized index vector itself.
#[cold]
fn build_simd_chunked(contents: &[u8], bufs: &mut ScratchBufs) -> (usize, u32) {
    let len = contents.len();
    let total_dirty_words = (len.div_ceil(64)).div_ceil(64);
    bufs.indices.clear();
    // Real-world structural density tops out around ~25%; growing once more
    // for denser documents is fine.
    bufs.indices.reserve(len / 3 + 64 + SENTINELS);
    bufs.dirty.clear();
    bufs.dirty.reserve(total_dirty_words);
    bufs.chunk_out.clear();
    bufs.chunk_out.reserve(CHUNK_BYTES + 66);

    let mut state = [0u64; 3];
    let mut flags = 0u32;
    let mut off = 0usize;
    while off < len {
        let chunk_len = (len - off).min(CHUNK_BYTES);
        let chunk_words = (chunk_len.div_ceil(64)).div_ceil(64);
        // `off` is always a multiple of CHUNK_BYTES (itself a multiple of
        // 4096), so this chunk's dirty words start at `off / 4096`.
        let word_off = off / 4096;
        let (n, chunk_flags) = bun_highway::json_structural_index_chunk(
            &contents[off..off + chunk_len],
            off,
            &mut bufs.chunk_out.spare_capacity_mut()[..chunk_len + 66],
            &mut bufs.dirty.spare_capacity_mut()[word_off..word_off + chunk_words],
            &mut state,
        );
        flags |= chunk_flags;
        if chunk_flags & FLAG_ODDITY != 0 {
            return (0, flags);
        }
        // SAFETY: the kernel initialized `chunk_out[..n]` (no sentinels in
        // the chunked form) and this chunk's `dirty` words.
        unsafe { bufs.chunk_out.set_len(n) };
        bufs.indices.extend_from_slice(&bufs.chunk_out);
        bufs.chunk_out.clear();
        off += chunk_len;
    }
    // SAFETY: every chunk initialized its `dirty` words; together they cover
    // `[0, total_dirty_words)`.
    unsafe { bufs.dirty.set_len(total_dirty_words) };
    let n = bufs.indices.len();
    bufs.indices.push(len as u32);
    bufs.indices.push(len as u32);
    (n, flags)
}

// ──────────────────────────────────────────────────────────────────────────
// Scalar indexer
// ──────────────────────────────────────────────────────────────────────────

/// Comment- and single-quote-aware scalar indexer. Produces the same index
/// structure as the SIMD kernel, plus comment awareness:
///
///   - comment bytes produce no indices at all
///   - the first comment's range is recorded
///   - single-quoted strings are indexed exactly like double-quoted ones
///     (stage 2 sees the `'` byte at the index)
///
/// This is the only indexer on wasm and the fallback whenever the SIMD kernel
/// reports an oddity. It is also the *reference implementation*: the unit
/// tests differentially check the SIMD kernel against it on comment-free
/// inputs.
fn scalar_index(contents: &[u8], mut bufs: ScratchBufs) -> Result<StructuralIndex, IndexError> {
    bufs.indices.clear();
    bufs.indices.reserve(contents.len() / 4 + 16);
    let dirty_words = (contents.len().div_ceil(64)).div_ceil(64) + 1;
    bufs.dirty.clear();
    bufs.dirty.resize(dirty_words, 0);
    // (The scalar path is the cold path; a zero-filled dirty bitmap of
    // len/512 bytes is noise here.)

    let mut flags: u32 = 0;
    let mut first_comment: Option<Range> = None;
    let s = contents;
    let n = s.len();
    let mut i = 0;
    let mut prev_scalar = false;
    // A backslash outside of a string "escapes" the next byte exactly like
    // the SIMD kernel's global odd-backslash-run parity does: the only thing
    // that changes is whether a following `"` opens a string. (Such input is
    // never valid JSON — both indexers feed stage 2 a junk token — but the
    // two indexers must agree bit-for-bit so they can be tested against each
    // other.)
    let mut pending_escape = false;

    macro_rules! mark_dirty {
        ($pos:expr) => {{
            let block = $pos >> 6;
            bufs.dirty[block >> 6] |= 1u64 << (block & 63);
        }};
    }

    while i < n {
        let c = s[i];
        let was_escaped = pending_escape;
        pending_escape = false;
        match c {
            // An escaped quote outside a string does not open one; the byte
            // is an ordinary scalar-run byte (falls to the `_` arm below).
            b'"' | b'\'' if !was_escaped => {
                if c == b'\'' {
                    flags |= FLAG_HAS_SINGLE_QUOTE;
                }
                bufs.indices.push(i as u32);
                prev_scalar = false;
                let quote = c;
                i += 1;
                while i < n {
                    let b = s[i];
                    if b == quote {
                        bufs.indices.push(i as u32);
                        i += 1;
                        break;
                    }
                    if b == b'\\' {
                        flags |= FLAG_HAS_BACKSLASH_IN_STRING;
                        mark_dirty!(i);
                        // Classify the escaped byte too, mirroring the SIMD
                        // kernel's positional masks.
                        if let Some(&e) = s.get(i + 1) {
                            if e < 0x20 {
                                flags |= FLAG_HAS_CTRL_IN_STRING;
                                mark_dirty!(i + 1);
                            } else if e >= 0x80 {
                                flags |= FLAG_HAS_NON_ASCII;
                            }
                        }
                        i += 2;
                        continue;
                    }
                    if b < 0x20 {
                        flags |= FLAG_HAS_CTRL_IN_STRING;
                        mark_dirty!(i);
                    } else if b >= 0x80 {
                        flags |= FLAG_HAS_NON_ASCII;
                    }
                    i += 1;
                }
                // Unterminated string: no closing index; stage 2 reports it.
            }
            b'{' | b'}' | b'[' | b']' | b':' | b',' => {
                bufs.indices.push(i as u32);
                prev_scalar = false;
                i += 1;
            }
            b' ' | b'\t' | b'\n' | b'\r' => {
                prev_scalar = false;
                i += 1;
            }
            b'/' => {
                prev_scalar = false;
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
                                return Err(IndexError::UnterminatedBlockComment);
                            }
                            if s[i] == b'*' && s.get(i + 1) == Some(&b'/') {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                    }
                    _ => return Err(IndexError::UnexpectedSlash { pos: i }),
                }
                if first_comment.is_none() {
                    first_comment = Some(Range {
                        loc: bun_ast::usize2loc(start),
                        len: (i - start) as i32,
                    });
                }
            }
            _ => {
                if c == b'\\' && !was_escaped {
                    pending_escape = true;
                }
                if c >= 0x80 {
                    flags |= FLAG_HAS_NON_ASCII;
                }
                if !prev_scalar {
                    bufs.indices.push(i as u32);
                }
                prev_scalar = true;
                i += 1;
            }
        }
    }

    let count = bufs.indices.len();
    bufs.indices.push(n as u32);
    bufs.indices.push(n as u32);
    Ok(StructuralIndex { bufs, n: count, flags, first_comment })
}

/// U+2028 / U+2029 (3-byte UTF-8: E2 80 A8/A9) terminate `//` comments, like
/// the old lexer.
#[inline]
fn is_ls_ps(s: &[u8], i: usize) -> bool {
    s[i] == 0xE2 && s.get(i + 1) == Some(&0x80) && matches!(s.get(i + 2), Some(0xA8) | Some(0xA9))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scalar indexer is also the reference model for the SIMD kernel:
    /// on documents without comments or single quotes (where the SIMD path is
    /// taken) both must produce the same indices and flags.
    fn build_both(contents: &[u8]) -> Option<(Vec<u32>, u32, Vec<u32>, u32)> {
        let simd = build(contents).ok()?;
        let (si, sf) = (simd.indices()[..simd.len()].to_vec(), simd.flags);
        simd.release();
        let scalar = scalar_index(contents, scratch_get()).ok()?;
        let (ci, cf) = (scalar.indices()[..scalar.len()].to_vec(), scalar.flags);
        scalar.release();
        Some((si, sf, ci, cf))
    }

    #[test]
    fn chunked_and_scalar_indexers_agree_on_large_documents() {
        // > ONESHOT_MAX exercises the resumable kernel across many chunks.
        let mut doc = String::with_capacity(3 * 1024 * 1024);
        doc.push('{');
        let mut i = 0;
        while doc.len() < 5 * ONESHOT_MAX / 2 {
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
        assert!(doc.len() > ONESHOT_MAX);
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
        let alphabet: &[u8] = b"{}[]:,\"\\ \t\n\r0123456789aetfn.-+\x01\x1f\x80\xc3\xa9";
        for _ in 0..20_000 {
            let len = (rng() % 200) as usize;
            let mut buf = Vec::with_capacity(len);
            for _ in 0..len {
                buf.push(alphabet[(rng() as usize) % alphabet.len()]);
            }
            // Skip docs the SIMD path rejects (none: the alphabet has no '/'
            // or '\'' so the SIMD path is always taken).
            let Some((si, sf, ci, cf)) = build_both(&buf) else { continue };
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

    fn idx(s: &str) -> (Vec<u32>, u32) {
        let r = build(s.as_bytes()).map_err(|_| ()).expect("index error");
        let v = r.indices()[..r.len()].to_vec();
        let f = r.flags;
        r.release();
        (v, f)
    }

    #[test]
    fn basic() {
        let (v, _) = idx(r#"{"a": 1}"#);
        assert_eq!(v, vec![0, 1, 3, 4, 6, 7]);
    }

    #[test]
    fn comments_and_single_quotes() {
        let (v, _) = idx("// x\n{'a': [1,2] /* y */ }");
        assert_eq!(v, vec![5, 6, 8, 9, 11, 12, 13, 14, 15, 25]);
        let (_, f) = idx("{'a': 1}");
        assert!(f & FLAG_HAS_SINGLE_QUOTE != 0);
    }

    #[test]
    fn strings_with_escapes_are_dirty() {
        let r = build(br#"{"a": "b\nc", "d": "e"}"#).map_err(|_| ()).unwrap();
        assert!(r.flags & FLAG_HAS_BACKSLASH_IN_STRING != 0);
        assert!(r.is_dirty(7, 12));
        r.release();
    }
}
