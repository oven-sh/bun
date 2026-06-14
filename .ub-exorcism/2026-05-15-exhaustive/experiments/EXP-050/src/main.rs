//! EXP-050 — `bun_alloc::ZigString` tag-bit mark/untag (5 sites).
//!
//! Production shape (src/bun_alloc/lib.rs:925, 930, 935, 940, 946):
//!
//!     // mark variants:
//!     self._unsafe_ptr_do_not_use =
//!         ((self._unsafe_ptr_do_not_use as usize) | ZS_16BIT_BIT) as *const u8;
//!     // ...and ZS_UTF8_BIT / ZS_GLOBAL_BIT / ZS_STATIC_BIT (4 marks total)
//!
//!     // untag (line 946):
//!     fn untagged(&self) -> *const u8 {
//!         ((self._unsafe_ptr_do_not_use as usize) & ZS_PTR_MASK) as *const u8
//!     }
//!
//! Same shape as EXP-029 (`EnvStr`) but with OR/AND on the **high** bits
//! (16BIT/UTF8/GLOBAL/STATIC flags) instead of a low-48 mask. Every JS string
//! traversing the Bun↔JSC ABI passes through this code path, so the blast
//! radius is the highest in the strict-provenance cluster.
//!
//! Each of the 5 OR/AND steps performs `ptr as usize` followed by a later
//! `usize as *const u8`. Under `-Zmiri-strict-provenance` the deref of the
//! untagged pointer fails because the integer round-trip stripped provenance.

// Tag bits live in the high byte (mirrors ZS_16BIT_BIT / ZS_UTF8_BIT /
// ZS_GLOBAL_BIT / ZS_STATIC_BIT layout described in the inventory).
const ZS_16BIT_BIT: usize = 0x4000_0000_0000_0000;
const ZS_UTF8_BIT: usize = 0x8000_0000_0000_0000;
const ZS_GLOBAL_BIT: usize = 0x1000_0000_0000_0000;
const ZS_STATIC_BIT: usize = 0x2000_0000_0000_0000;
const ZS_PTR_MASK: usize = !(ZS_16BIT_BIT | ZS_UTF8_BIT | ZS_GLOBAL_BIT | ZS_STATIC_BIT);

#[repr(C)]
struct ZigString {
    /// Mirror of the production field name; the production code carries a
    /// `*const u8` that has been OR'd with the tag bits.
    _unsafe_ptr_do_not_use: *const u8,
    len: usize,
}

impl ZigString {
    fn from_utf8(bytes: &[u8]) -> Self {
        Self {
            _unsafe_ptr_do_not_use: bytes.as_ptr(),
            len: bytes.len(),
        }
    }

    /// Mirror of mark16Bit at lib.rs:925.
    fn mark_16bit(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_16BIT_BIT) as *const u8;
    }

    /// Mirror of markUtf8 at lib.rs:930.
    fn mark_utf8(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_UTF8_BIT) as *const u8;
    }

    /// Mirror of markGlobal at lib.rs:935.
    fn mark_global(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_GLOBAL_BIT) as *const u8;
    }

    /// Mirror of markStatic at lib.rs:940.
    fn mark_static(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_STATIC_BIT) as *const u8;
    }

    /// Mirror of untagged at lib.rs:946.
    fn untagged(&self) -> *const u8 {
        ((self._unsafe_ptr_do_not_use as usize) & ZS_PTR_MASK) as *const u8
    }
}

fn main() {
    let backing: &'static [u8] = b"hello-zigstring";

    let mut zs = ZigString::from_utf8(backing);
    // Walk the same OR sequence the JS bridge will perform on a real string:
    zs.mark_utf8();
    zs.mark_global();
    zs.mark_static();
    // (skip mark_16bit because a UTF-8 string would not also be 16-bit, but
    // include it for parity with the 5 sites — strict-provenance fails the
    // same way either way.)
    zs.mark_16bit();

    // The recovered pointer is the strict-provenance witness:
    let ptr = zs.untagged();
    let slice = unsafe { core::slice::from_raw_parts(ptr, zs.len) };
    println!("{:?}", slice);

    core::hint::black_box(slice);
}
