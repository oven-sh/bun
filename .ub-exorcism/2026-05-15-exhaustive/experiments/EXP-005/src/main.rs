// EXP-005: yarn.rs &mut [Dependency] over uninitialized Vec capacity (PUB-INSTALL-3)
// Mirror of src/install/yarn.rs:918-925 in Bun.
//
// Bun's Dependency ID types in the lockfile are niche-bearing (NonZeroU32 indices
// into the string pool, etc.) so reading uninit through them trips Miri's
// validity check for niches.

use std::num::NonZeroU32;

#[allow(dead_code)]
struct Dependency {
    name_id: NonZeroU32,
    version_id: NonZeroU32,
}

fn build_uninit_slice(cap: usize) -> (*mut Dependency, usize) {
    let mut v: Vec<Dependency> = Vec::with_capacity(cap);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v); // leak so the slice outlives the Vec; ignore-leaks in MIRIFLAGS
    (ptr, cap)
}

fn main() {
    let (ptr, cap) = build_uninit_slice(4);
    let s: &mut [Dependency] = unsafe { std::slice::from_raw_parts_mut(ptr, cap) };
    // Read the niche-bearing field; this is UB: the bytes are uninit.
    let _id = s[0].name_id.get();
}
