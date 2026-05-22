//! Host-function table builders — collapse the open-coded ladder
//!
//!     let obj = JSValue::create_empty_object(global, N);
//!     obj.put(global, b"foo", JSFunction::create(global, "foo", __jsc_host_foo, 1, Default::default()));
//!     obj.put(global, b"bar", JSFunction::create(global, "bar", __jsc_host_bar, 2, Default::default()));
//!     obj
//!
//! into a single declarative slice. Zig had no shared helper for this (each
//! `*.zig` hand-unrolled it, or used a per-file `inline for` over a comptime
//! tuple — `UnsafeObject.zig`, `HashObject.zig`). This is a NEW abstraction,
//! not a parity loss.
//!
//! Also fixes the capacity-hint drift bug class: `UnsafeObject.rs` passed
//! `len = 3` for 4 entries because the hand-counted N wasn't bumped when
//! `memoryFootprint` was added.

use crate::{JSFunction, JSGlobalObject, JSHostFn, JSValue};

/// One row of a host-function table: `(js_visible_name, raw C-ABI shim, arity)`.
///
/// The shim is the `__jsc_host_*` fn emitted by `#[bun_jsc::host_fn]` (already
/// a [`JSHostFn`]); `arity` is the JS `function.length` reported to userland.
pub type HostFnEntry = (&'static str, JSHostFn, u32);

/// `{ name₀: fn₀, name₁: fn₁, … }` — fresh object pre-sized to `fns.len()`
/// inline-capacity slots, then [`JSValue::put_host_functions`].
///
/// Use when the *whole* object is a fn table (TOML/YAML/JSONC/semver/…). When
/// the receiver is something else — a callable, a null-prototype binding bag
/// with non-fn props mixed in — build it yourself and call
/// [`JSValue::put_host_functions`] directly.
pub fn create_host_function_object(global: &JSGlobalObject, fns: &[HostFnEntry]) -> JSValue {
    JSValue::create_empty_object(global, fns.len()).put_host_functions(global, fns)
}

impl JSValue {
    /// Install each `(name, shim, arity)` as a `JSFunction` property on `self`
    /// and return `self` for chaining. The JS-visible `function.name` is the
    /// table key; options are `Default` (public visibility, no intrinsic, no
    /// constructor) — matching every hand-rolled ladder this replaces.
    pub fn put_host_functions(self, global: &JSGlobalObject, fns: &[HostFnEntry]) -> JSValue {
        for &(name, host_fn, arity) in fns {
            self.put(
                global,
                name.as_bytes(),
                JSFunction::create(global, name, host_fn, arity, Default::default()),
            );
        }
        self
    }
}
