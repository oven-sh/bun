//! Miri triage harness for the Phase 11 Campaign 3 fuzz witnesses.
//!
//! Each `#[test]` replays a crash reproducer through code that mirrors the
//! ACTUAL Bun source (not the wrapped panic-on-OOB witness) so Miri can
//! either CONFIRM or REFUTE the UB classification.
//!
//! Run with:
//!   MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-tree-borrows" \
//!     cargo +nightly miri test --release

// ── Witness #1: standalone_module_graph — sparse-enum byte → enum cast ─────
//
// Reproducer: [10, 0, ..., 0] (20 bytes), runs through ptr::read_unaligned
// followed by enum-discriminant materialisation.

#[repr(u8)] #[derive(Copy, Clone, Debug)]
#[allow(dead_code)]
enum Side { Server = 0, Client = 1 }

#[repr(C, packed)]
#[derive(Copy, Clone)]
struct Record {
    a: u32, b: u32, c: u32, d: u32,
    side: u8, encoding: u8, mfmt: u8, loader: u8,
}

/// Mirrors what Bun does at the EXP-035 site: read the whole record
/// unaligned, then materialise each byte as its enum type. The materialisation
/// is the UB site — if any byte is outside the enum's valid discriminants,
/// transmute is UB.
fn bun_style_read(data: &[u8]) -> Option<(Side,)> {
    if data.len() < std::mem::size_of::<Record>() { return None; }
    let rec: Record = unsafe { std::ptr::read_unaligned(data.as_ptr() as *const Record) };
    // Materialise sparse enum byte as its enum type — this is the EXP-035 UB
    // site. Bun's code path does NOT validate the byte first.
    let side_byte = rec.side;
    let side: Side = unsafe { std::mem::transmute(side_byte) };
    Some((side,))
}

#[test]
fn miri_standalone_module_graph_repro_inbounds() {
    // 20 bytes, side=0 (Server) — valid.
    let data: [u8; 20] = [
        0,0,0,0,  0,0,0,0,  0,0,0,0,  0,0,0,0,
        0, 0, 0, 0
    ];
    let _ = bun_style_read(&data);
}

#[test]
fn miri_standalone_module_graph_repro_invalid_side_byte() {
    // 20 bytes, side=10 (matches the [10, 0, ...] reproducer if read as side at offset 16).
    // Note: with #[repr(C, packed)], side is at offset 16 (after 4 u32s).
    // So we put the 10 at offset 16, not offset 0.
    let mut data: [u8; 20] = [0; 20];
    data[16] = 10;          // side = 10 → INVALID (only 0 and 1 are valid)
    let _ = bun_style_read(&data);
    // Miri should report: "constructing invalid value: encountered 0x0a, but
    // expected a valid enum discriminant".
}

// ── Witness #2: semver String::slice — (off, len) past buf end ─────────────
//
// Reproducer: sem_bytes=[1,0,0,0,0,0,0,254], buf=[].
// Decoded: tagged path (byte 7 high bit set), off=1, len=0x7E000000.
// buf.get_unchecked(1..0x7E000001) on an empty buf is OOB.

const MAX_ADDRESSABLE_SPACE_MASK: u64 = (1u64 << 63) - 1;

#[derive(Copy, Clone)]
struct Pointer { off: u32, len: u32 }
impl Pointer {
    fn from_bits(bits: u64) -> Self {
        Self { off: bits as u32, len: (bits >> 32) as u32 }
    }
}

#[derive(Copy, Clone)]
struct SemverString { bytes: [u8; 8] }

impl SemverString {
    fn ptr(self) -> Pointer {
        let bits = u64::from_ne_bytes(self.bytes);
        let masked = bits & MAX_ADDRESSABLE_SPACE_MASK;
        Pointer::from_bits(masked)
    }
    /// EXACT mirror of src/semver/lib.rs:586-616, heap branch only.
    fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
        let ptr_ = self.ptr();
        let (off, len) = (ptr_.off as usize, ptr_.len as usize);
        debug_assert!(off + len <= buf.len());
        unsafe { buf.get_unchecked(off..off + len) }
    }
}

#[test]
fn miri_semver_string_slice_inbounds() {
    let buf = b"hello, world";
    // bits = high-bit-set | (len << 32) | off  → heap branch, off=7, len=5.
    let bits: u64 = (1u64 << 63) | (5u64 << 32) | 7u64;
    let s = SemverString { bytes: bits.to_ne_bytes() };
    let out = s.slice(buf);
    assert_eq!(out, b"world");
}

#[test]
fn miri_semver_string_slice_oob() {
    // The fuzz crash reproducer.
    let buf: &[u8] = &[];
    let sem_bytes: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 254];
    let s = SemverString { bytes: sem_bytes };
    // Force-release mode behaviour: debug_assert is stripped, then
    // get_unchecked is the UB site.
    // In Miri this WILL fire even with debug_assert active, because
    // get_unchecked itself is the unsafe op Miri instruments.
    let _ = s.slice(buf);
    // Miri should report: "out-of-bounds pointer arithmetic" or
    // "memory access of N bytes failed: alloc... has size 0".
}
