// =========================================================================
// trybuild compile-fail fixture
// Bug:      pass-3 PUB-N-B — RacyCell<T> unconditional Sync
//           (src/bun_core/util.rs:2282)
// Catches:  laundering of !Sync (or "Sync but interior-mutable") payloads
//           that the type's own safety doc explicitly forbids:
//             "Do not wrap *payloads* whose !Sync is load-bearing
//              (Cell<U>, Rc<U>, RefCell<U>)"
//           Today the type system permits it; only the documentation
//           prohibits it.
// Today:    COMPILES — `unsafe impl<T: ?Sized> Sync for RacyCell<T> {}` is
//           unconditional, so RacyCell<Cell<u32>>: Sync compiles. The doc
//           comment says do not do this, but nothing enforces it.
// After fix: FAILS TO COMPILE. The audit-recommended bound:
//
//               unsafe impl<T: ?Sized + Sync> Sync for RacyCell<T> {}
//
//           (Mirroring std's nightly SyncUnsafeCell.) Sites that *need* the
//           old laxity get a per-site `unsafe impl Sync for MyState {}` —
//           which is reviewable.
//
// To wire in: add to `tests/compile_fail.rs` in `bun_core`.
// =========================================================================

#![allow(dead_code)]

use std::cell::Cell;

use bun_core::util::RacyCell;

fn requires_sync<T: Sync + ?Sized>(_: &T) {}

fn main() {
    // Cell<u32>: !Sync. The bug lets RacyCell<Cell<u32>>: Sync compile.
    // After fix: E0277 here.
    let r: RacyCell<Cell<u32>> = RacyCell::new(Cell::new(0));
    requires_sync(&r);
}
