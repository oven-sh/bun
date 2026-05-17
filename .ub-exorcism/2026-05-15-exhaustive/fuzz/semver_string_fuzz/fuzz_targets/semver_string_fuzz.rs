// Standalone fuzz mirror for EXP-008 / EXP-009.
//
// Validates: `bun_semver::String::slice(&self, buf: &[u8]) -> &[u8]` which, in
// the heap-string branch, does `unsafe { buf.get_unchecked(off..off+len) }`.
// Source: src/semver/lib.rs:586-616.
//
// Hazard:
//   - off + len arithmetic can wrap on u32→usize promotion
//   - off + len > buf.len() bypasses the debug_assert in release builds
//   - off itself can be >= buf.len() while len = 0
//
// Mirrored decoder (faithful to source structure):
//
//     fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
//         match self.bytes[MAX_INLINE_LEN - 1] & 128 {
//             0 => ... inline branch ...,
//             _ => {
//                 let (off, len) = (ptr.off as usize, ptr.len as usize);
//                 debug_assert!(off + len <= buf.len());
//                 unsafe { buf.get_unchecked(off..off+len) }
//             }
//         }
//     }
//
// Crash semantics:
//   - any (off, len) producing a panic, abort, or `cargo fuzz` crash record
//     is an OOB read witness.

#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;

const MAX_INLINE_LEN: usize = 8;
const MAX_ADDRESSABLE_SPACE_MASK: u64 = (1u64 << 63) - 1;

/// Mirror of `bun_semver::Pointer`.
#[derive(Copy, Clone, Debug)]
struct Pointer { off: u32, len: u32 }

impl Pointer {
    fn from_bits(bits: u64) -> Self {
        // Match the source: lower 32 bits = off, upper 31 bits (masked) = len
        let off = bits as u32;
        let len = (bits >> 32) as u32;
        Self { off, len }
    }
}

/// Mirror of `bun_semver::String` (the 8-byte tagged union).
#[derive(Copy, Clone, Debug)]
struct SemverString { bytes: [u8; 8] }

impl SemverString {
    fn ptr(self) -> Pointer {
        let bits = u64::from_ne_bytes(self.bytes);
        let masked = bits & MAX_ADDRESSABLE_SPACE_MASK;
        Pointer::from_bits(masked)
    }

    /// Safe mirror — what `slice` SHOULD do.
    fn slice_safe<'a>(&'a self, buf: &'a [u8]) -> Option<&'a [u8]> {
        match self.bytes[MAX_INLINE_LEN - 1] & 128 {
            0 => {
                // Inline branch: walk for a zero byte.
                if self.bytes[0] == 0 { return Some(b""); }
                let mut i = 0;
                while i < self.bytes.len() {
                    if self.bytes[i] == 0 { return Some(&self.bytes[0..i]); }
                    i += 1;
                }
                Some(&self.bytes)
            }
            _ => {
                let ptr_ = self.ptr();
                let (off, len) = (ptr_.off as usize, ptr_.len as usize);
                // The UB site: source does `buf.get_unchecked(off..off+len)`
                // after only a `debug_assert!`. We replace with checked indexing
                // and treat the OOB case as the witness condition.
                let end = off.checked_add(len)?;
                if end > buf.len() { return None; }
                buf.get(off..end)
            }
        }
    }

    /// Hazardous mirror — exact reproduction of the unsafe path under audit.
    /// Returns the input length as a stand-in for "would the unsafe read have
    /// touched OOB bytes?". We never actually invoke get_unchecked on OOB —
    /// that would be UB in the fuzzer itself.
    fn slice_unsafe_witness<'a>(&'a self, buf: &'a [u8]) -> SliceVerdict {
        match self.bytes[MAX_INLINE_LEN - 1] & 128 {
            0 => SliceVerdict::Inline,
            _ => {
                let ptr_ = self.ptr();
                let off = ptr_.off as usize;
                let len = ptr_.len as usize;
                // Faithful to source: usize promotion of two u32s, addition,
                // single bounds check elided.
                match off.checked_add(len) {
                    None => SliceVerdict::OobWrap,           // off + len overflows usize (32→64 bit OK; tracking semantics)
                    Some(end) if end > buf.len() => SliceVerdict::OobBeyondBuf { off, len, buf_len: buf.len() },
                    Some(_) => SliceVerdict::Inbounds,
                }
            }
        }
    }
}

#[derive(Debug)]
#[allow(dead_code)]
enum SliceVerdict {
    Inline,
    OobWrap,
    OobBeyondBuf { off: usize, len: usize, buf_len: usize },
    Inbounds,
}

#[derive(Arbitrary, Debug)]
struct FuzzInput {
    /// 8 bytes — the inline storage / tagged pointer
    sem_bytes: [u8; 8],
    /// Backing string-pool buffer. Capped at 64KB so the fuzzer can iterate.
    buf: Vec<u8>,
}

fuzz_target!(|input: FuzzInput| {
    let buf: Vec<u8> = input.buf.into_iter().take(65536).collect();
    let s = SemverString { bytes: input.sem_bytes };

    // 1. Run the safe path — must never panic, must never OOB read.
    let _ = s.slice_safe(&buf);

    // 2. Classify what the unsafe path WOULD have done. If it would have
    //    gone OOB, panic — that's the witness. Crucially, we do NOT actually
    //    perform the unsafe read; we only describe it.
    let verdict = s.slice_unsafe_witness(&buf);
    match verdict {
        SliceVerdict::OobWrap => {
            panic!("EXP-008/009 witness: off+len wraps usize, buf_len={}", buf.len())
        }
        SliceVerdict::OobBeyondBuf { off, len, buf_len } => {
            // This is the common case the fuzzer can find quickly: an attacker
            // forging the (off, len) pair beyond buf bounds. We crash to
            // record the seed.
            panic!(
                "EXP-008/009 witness: get_unchecked({}..{}) on buf of len {}",
                off, off.saturating_add(len), buf_len
            )
        }
        _ => {}
    }
});
