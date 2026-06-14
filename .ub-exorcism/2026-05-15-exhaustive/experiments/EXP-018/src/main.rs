//! Source-faithful compile witness for EXP-018.
//!
//! This intentionally uses Bun's real `bun_threading::Guarded` /
//! `GuardedLock` types instead of a mock. `cargo check` succeeding proves that
//! safe Rust can move a held `GuardedLock<'static, _, Mutex>` to another OS
//! thread. Running this binary in a debug Linux build panics in Bun's debug
//! owner check; on Windows release, the same safe shape reaches
//! `ReleaseSRWLockExclusive` from a non-owner thread, whose contract documents
//! undefined behavior.

static GUARDED: bun_threading::Guarded<u32> = bun_threading::Guarded::new(0);

fn assert_send<T: Send>() {}

fn main() {
    assert_send::<bun_threading::GuardedLock<'static, u32, bun_threading::Mutex>>();

    let guard = GUARDED.lock();

    // `std::thread::spawn` requires the closure and every captured value to be
    // `Send + 'static`. This line type-checks on current main, so `guard` can
    // be dropped on a different OS thread by entirely safe Rust code.
    let _join = std::thread::spawn(move || drop(guard));
}
