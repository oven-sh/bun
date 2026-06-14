//! EXP-038: Negative-pattern witness for the stale EXP-037 Windows watcher
//! candidate. It mirrors the unsafe shape that current Bun *avoids*:
//! materializing `FILE_NOTIFY_INFORMATION.Action` directly as
//! `src/watcher/WindowsWatcher.rs::Action` (declared
//! `#[repr(u32)]` at line 55 with five variants matching `w::FILE_ACTION_*`
//! constants `1..=5`) via transmute/read_unaligned.
//!
//! `FILE_NOTIFY_INFORMATION.Action` is a `u32` written by the Windows kernel
//! into the buffer filled by `ReadDirectoryChangesW`. A buggy filter driver
//! or a future Windows edition that adds a new action value yields an
//! out-of-range `u32` which, when materialized as the `Action` enum,
//! triggers validity UB.
//!
//! Current source uses a checked match at `WindowsWatcher.rs:196-211` and skips
//! unknown action codes, so this is a regression guard rather than evidence of
//! current Bun UB.
//!
//! Expected Miri signal: `constructing invalid value: encountered 0xdeadbeef,
//! but expected a valid enum tag`.

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Action {
    Added = 1,
    Removed = 2,
    Modified = 3,
    RenamedOld = 4,
    RenamedNew = 5,
}

fn read_action_from_kernel_buffer(bytes: &[u8; 4]) -> Action {
    // Mirrors the shape of materializing `FILE_NOTIFY_INFORMATION.Action`
    // as the `Action` enum directly off the IO buffer.
    unsafe { core::mem::transmute::<[u8; 4], Action>(*bytes) }
}

fn main() {
    // Crafted kernel buffer with an unlisted action value (0xdeadbeef).
    // Real-world triggers: filter driver injection, future Win32 action
    // constant, IO buffer corruption.
    let kernel_bytes: [u8; 4] = 0xdeadbeef_u32.to_ne_bytes();

    let action = read_action_from_kernel_buffer(&kernel_bytes);
    // Force a use so the materialization isn't elided.
    println!("action = {:?}", action);
}
