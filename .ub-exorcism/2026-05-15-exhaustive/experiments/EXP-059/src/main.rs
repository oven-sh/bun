// EXP-059: `bun_alloc::Mutex::lock()` `'_ → 'static` MutexGuard transmute —
// sound today (every `bun_alloc::Mutex` lives in `'static` BSS), latent API
// hazard because `Mutex::new()` is a public const constructor and admits stack
// construction.
//
// Mirrors `src/bun_alloc/lib.rs:550-565`:
//
//   pub fn lock(&self) -> MutexGuard<'static, ()> {
//       let g: MutexGuard<'_, ()> = self.inner.lock().unwrap();
//       unsafe { core::mem::transmute(g) }
//   }
//
// We stack-construct a `std::sync::Mutex`, lock it via a function whose return
// type is `MutexGuard<'static, ()>`, return from that function letting the
// `Mutex`'s backing storage go out of scope, then drop the now-dangling
// `'static` guard. Miri should report use of deallocated memory at the drop.

use std::sync::{Mutex, MutexGuard};

fn lock_static<'a>(m: &'a Mutex<()>) -> MutexGuard<'static, ()> {
    let g = m.lock().unwrap();
    // SAFETY (mirrored from bun_alloc::Mutex::lock): the production code asserts
    // every Mutex is in 'static BSS. This experiment violates that precondition
    // on purpose to characterise the latent hazard.
    unsafe { core::mem::transmute::<MutexGuard<'a, ()>, MutexGuard<'static, ()>>(g) }
}

fn obtain_dangling_guard() -> MutexGuard<'static, ()> {
    let m = Mutex::new(());
    let g = lock_static(&m);
    // `m` is dropped at end of this scope (Mutex::drop deallocates its sys
    // primitive); `g` survives with a 'static lifetime tagging a dangling
    // pointer to that primitive.
    g
}

fn main() {
    let g: MutexGuard<'static, ()> = obtain_dangling_guard();
    // Drop of `g` calls `pthread_mutex_unlock` on the deallocated backing
    // → Miri reports `attempting to use deallocated memory`.
    drop(g);
    eprintln!("dropped dangling 'static guard (Miri should have caught this)");
}
