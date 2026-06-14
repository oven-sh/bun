//! EXP-053 — `Source::get_handle` / `Source::to_stream` bypass the
//! `UvHandle::as_handle_mut()` discipline via `.cast()`.
//!
//! Production shape (src/io/source.rs:260, 270):
//!
//!     // SAFETY: uv::Pipe / uv::uv_tty_t embed uv_handle_t as their first member.
//!     Source::Pipe(pipe) => core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast(),
//!     Source::Pipe(pipe) => core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast(),
//!
//! `bun_sys::windows::libuv::UvHandle::as_handle_mut()` exists precisely to
//! make the "first-member is `uv_handle_t`" invariant a compile-time
//! obligation: `unsafe trait UvHandle` is impl'd only for types that satisfy
//! the layout requirement, and `as_handle_mut()` is the (safe) downcast.
//!
//! The `.cast()` form short-circuits this discipline. If a future refactor
//! breaks the prefix invariant — adds a field before `uv_handle_t`, changes
//! the wrapper type, switches to a non-`#[repr(C)]` layout — the `.cast()`
//! call still compiles. The bug surfaces at runtime as a wrong-type read of
//! whatever happens to live at offset 0 of the new layout.
//!
//! This experiment models both worlds:
//!   * `GoodPipe`  — has the `uv_handle_t` prefix, impls `UvHandle`, safe.
//!   * `BrokenPipe` — does NOT have the prefix (extra field before), does NOT
//!     impl `UvHandle`. The `.cast()` form compiles and silently produces a
//!     wrong-type cast; the `as_handle_mut()` form refuses to compile.
//!
//! Run with `cargo check` to confirm:
//!   - `get_handle_via_cast(&mut BrokenPipe)` compiles (the bug).
//!   - `get_handle_via_trait(&mut BrokenPipe)` does NOT compile (the fix).
//! The `via_trait` call is included as a commented-out compile-fail witness;
//! uncommenting it should fail with `the trait UvHandle is not implemented`.

use core::ffi::c_void;

#[repr(C)]
#[derive(Default)]
pub struct uv_handle_t {
    pub data: *mut c_void,
    pub loop_ptr: *mut c_void,
    pub r#type: u32,
    pub _flags: u32,
}

// The trait used to enforce the prefix invariant at compile time. Only types
// that promise the `uv_handle_t` prefix may impl this. This is exactly what
// the production `unsafe trait UvHandle { fn as_handle_mut(&mut self) -> *mut uv_handle_t }`
// machinery provides.
/// SAFETY: implementor MUST have `uv_handle_t` as its first field with `#[repr(C)]`.
pub unsafe trait UvHandle {
    fn as_handle_mut(&mut self) -> *mut uv_handle_t {
        // SAFETY: trait contract — the first field is `uv_handle_t`.
        (self as *mut Self).cast::<uv_handle_t>()
    }
}

// --- Good pipe: prefix invariant holds. ---
#[repr(C)]
pub struct GoodPipe {
    pub handle: uv_handle_t, // <-- prefix at offset 0
    pub queue: [usize; 2],
    pub flags: u32,
}

// SAFETY: `handle` is the first field with `#[repr(C)]`.
unsafe impl UvHandle for GoodPipe {}

// --- Broken pipe: a refactor put a different field at offset 0. ---
//
// A plausible accidental refactor: someone adds a typed wrapper around the
// uv_handle_t and bumps it to position 1. The struct still has a `uv_handle_t`
// member, but no longer at offset 0. `.cast()` does not notice; only the
// trait does.
#[repr(C)]
pub struct BrokenPipe {
    pub generation: u64,      // <-- extra field at offset 0 (the drift)
    pub handle: uv_handle_t,  // <-- now at offset 8, not 0
    pub queue: [usize; 2],
}

// NOTE: deliberately NOT `unsafe impl UvHandle for BrokenPipe` — the prefix
// invariant no longer holds, so the trait must refuse it. (Implementor would
// have to take on that `unsafe impl` to opt in to the lie.)

// --- The two call shapes, mirrored from src/io/source.rs:260, 270 ---

/// The production `.cast()` form. Bypasses the discipline; compiles for ANY
/// `T` that the caller wishes to pretend has a `uv_handle_t` prefix.
fn get_handle_via_cast<T>(pipe: &mut T) -> *mut uv_handle_t {
    core::ptr::from_mut::<T>(pipe).cast()
}

/// The disciplined form. Only types that satisfy the prefix invariant compile.
fn get_handle_via_trait<T: UvHandle>(pipe: &mut T) -> *mut uv_handle_t {
    pipe.as_handle_mut()
}

fn main() {
    let mut good = GoodPipe {
        handle: uv_handle_t::default(),
        queue: [0; 2],
        flags: 0,
    };

    // Both forms accept the good type — this is the baseline.
    let h_cast = get_handle_via_cast(&mut good);
    let h_trait = get_handle_via_trait(&mut good);
    assert_eq!(h_cast as usize, h_trait as usize);

    let mut broken = BrokenPipe {
        generation: 0xdead_beef,
        handle: uv_handle_t::default(),
        queue: [0; 2],
    };

    // *** THE BUG: `.cast()` accepts the broken type silently. ***
    // The returned `*mut uv_handle_t` actually points at `generation`, not at
    // the embedded `uv_handle_t`. Any libuv call through this pointer will
    // observe `0xdead_beef` as the `uv_handle_t::data` field.
    let drift_ptr: *mut uv_handle_t = get_handle_via_cast(&mut broken);
    // Read-back exposes the drift — `data` is `0xdead_beef` from `generation`,
    // not the zeroed `uv_handle_t::data` we initialized.
    let observed_data_field = unsafe { (*drift_ptr).data } as usize;
    assert_eq!(observed_data_field, 0xdead_beef);

    // *** THE FIX: uncomment the next line and `cargo check` should fail
    //     with `the trait bound BrokenPipe: UvHandle is not satisfied`. ***
    //
    // let safe_ptr: *mut uv_handle_t = get_handle_via_trait(&mut broken);

    println!("via_cast accepted BrokenPipe with drift_ptr->data = 0x{:x}", observed_data_field);
}
