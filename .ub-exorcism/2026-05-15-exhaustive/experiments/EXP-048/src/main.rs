//! EXP-048 — `bun_ptr::TaggedPtr::get` / `TaggedPtr::to` centralised
//! int-to-pointer round-trip; the strict-provenance fix point.
//!
//! Production shape (src/ptr/tagged_pointer.rs:53-56, 60-64):
//!
//!     pub struct TaggedPtr(u64);
//!     impl TaggedPtr {
//!         pub fn get<Type>(&self) -> *mut Type {
//!             self.ptr_bits() as usize as *mut Type   // <-- int-to-ptr cast
//!         }
//!         pub fn to(&self) -> *mut c_void {
//!             self.0 as usize as *mut c_void          // <-- int-to-ptr cast
//!         }
//!     }
//!
//! Every TaggedPointer consumer in the workspace (Sink.rs:1232,
//! ServerWebSocket.rs:144, …) funnels through these two methods, so fixing
//! provenance here closes F-A-1, F-P-1..3, F-P-5..12 in one move — the S2
//! structural fix point (clustering EXP-048 / EXP-049 / EXP-050).
//!
//! Under `-Zmiri-strict-provenance`, the `usize as *mut Type` cast at `get()`
//! is rejected before the deref is ever attempted.

struct TaggedPtr(u64);

impl TaggedPtr {
    /// Mirror of `TaggedPtr::pack` — packs the pointer's address bits into the
    /// low 48 bits and lets the caller OR a tag into the high bits later.
    fn pack<T>(p: *mut T) -> Self {
        Self((p as usize as u64) & 0xffff_ffff_ffff_ffff)
    }

    /// Mirror of `TaggedPtr::get<Type>` — the integer round-trip is the bug.
    fn get<T>(&self) -> *mut T {
        (self.0 & 0xffff_ffff_ffff_ffff) as usize as *mut T
    }
}

fn main() {
    let b: Box<u32> = Box::new(42);
    let p = Box::into_raw(b);

    let tp = TaggedPtr::pack(p);
    // strict-provenance: the cast inside get() is the failing operation.
    let recovered: *mut u32 = tp.get();
    let v = unsafe { *recovered };
    println!("{}", v);

    // Reclaim through the original (provenance-bearing) raw pointer to avoid
    // a second strict-provenance fail dominating the witness; the bug we are
    // documenting is the get() cast.
    let _ = unsafe { Box::from_raw(p) };
}
