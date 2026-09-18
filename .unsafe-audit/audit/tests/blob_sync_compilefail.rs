// =========================================================================
// trybuild compile-fail fixture
// Bug:      pass-3 jsc-ub-3 — Blob: Sync overbroad over Cell<*const _>
//           (src/jsc/webcore_types.rs:96)
// Catches:  Blob holds `global_this: Cell<*const JSGlobalObject>`. Cell<T>
//           is !Sync. The unconditional `unsafe impl Sync for Blob {}`
//           lets the type cross thread boundaries and be observed `&Blob`
//           on a non-JS thread, where the Cell's interior-mutability is
//           racy — exactly the R-2 "shared this" pattern the surrounding
//           comment says is upheld.
// Today:    COMPILES — `unsafe impl Sync for Blob {}` is unconditional.
//           Any function that takes `&Blob` can be Sync-required even
//           though sharing `&Blob` across threads can observe a Cell
//           mid-mutation.
// After fix: FAILS TO COMPILE. Two recommended fixes (either suffices):
//             1. Drop `unsafe impl Sync for Blob {}`. The Cell field
//                already makes it !Sync; that is the correct default.
//             2. Replace `Cell<*const JSGlobalObject>` with an atomic-or-
//                lock equivalent and keep Sync.
//           The Send impl stays (Blob is moved across threads via
//           heap-allocated work tasks).
//
// To wire in: add to `tests/compile_fail.rs` in `bun_jsc`.
// =========================================================================

#![allow(dead_code)]

use bun_jsc::webcore_types::Blob;

fn requires_sync<T: Sync + ?Sized>(_: &T) {}

fn main() {
    let b: Blob = Blob::default();
    // Today: compiles. After fix: E0277 — `Cell<*const JSGlobalObject>`
    // cannot be shared between threads safely; the `unsafe impl Sync for
    // Blob` is gone, so Blob no longer claims Sync over an interior-
    // mutable raw-pointer field.
    requires_sync(&b);
}
