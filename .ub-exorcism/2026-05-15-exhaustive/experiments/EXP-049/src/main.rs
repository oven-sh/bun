//! EXP-049 — `bun_core::String::SmolStr::slice` reconstructs a pointer from a
//! raw byte buffer via `usize::from_le_bytes(..) as *const u8`.
//!
//! Production shape (src/bun_core/string/immutable.rs:1076):
//!
//!     let mut ptr_bytes = [0u8; 8];
//!     ptr_bytes.copy_from_slice(&remainder_buf[..8]);
//!     let ptr = usize::from_le_bytes(ptr_bytes) as *const u8;
//!     unsafe { core::slice::from_raw_parts(ptr, len) }
//!
//! Unlike the other strict-provenance fails in this cluster, SmolStr does not
//! even keep the pointer as a `usize` — it round-trips the pointer through a
//! `[u8; 8]` byte buffer. Strict-provenance has no path to make this sound:
//! bytes carry no provenance metadata. The fix has to be structural — carry
//! the pointer typed in the SmolStr layout, not byte-encoded.
//!
//! This reproducer mirrors that init/read pair and triggers the strict
//! provenance failure at the deref of the reconstructed pointer.

fn main() {
    // Backing allocation we will encode-then-recover.
    let buf: Box<[u8; 32]> = Box::new([0u8; 32]);
    // Stash original raw pointer for cleanup via the provenance-bearing
    // pointer — the bug under test is the *reconstructed* one.
    let raw = Box::into_raw(buf);

    // SmolStr init writes the pointer's address bits into a byte buffer:
    let original_addr: usize = raw as *const u8 as usize;
    let mut remainder_buf = [0u8; 16];
    remainder_buf[..8].copy_from_slice(&original_addr.to_le_bytes());

    // SmolStr::slice reads it back as raw bytes → usize → *const u8:
    let mut ptr_bytes = [0u8; 8];
    ptr_bytes.copy_from_slice(&remainder_buf[..8]);
    let recovered_addr = usize::from_le_bytes(ptr_bytes);
    let ptr = recovered_addr as *const u8; // <-- strict-provenance fail site

    // Deref through the byte-reconstructed pointer (mirror of the
    // `slice::from_raw_parts(ptr, len)` access).
    let v = unsafe { *ptr };
    println!("{}", v);

    // Reclaim through the original Box pointer; the strict-provenance witness
    // we want is at the byte-reconstructed deref above.
    let _ = unsafe { Box::from_raw(raw) };
}
