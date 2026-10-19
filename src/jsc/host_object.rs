//! Host-function table builders — collapse the open-coded ladder
//!
//! ```ignore
//! let obj = JSValue::create_empty_object(global, N);
//! obj.put(global, b"foo", JSFunction::create(global, "foo", __jsc_host_foo, 1, Default::default()));
//! obj.put(global, b"bar", JSFunction::create(global, "bar", __jsc_host_bar, 2, Default::default()));
//! obj
//! ```
//!
//! into a single declarative slice.
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

/// `{ name₀: fn₀, name₁: fn₁, … }` — fresh object pre-sized to `fns.len()` inline-capacity slots.
pub fn create_host_function_object(global: &JSGlobalObject, fns: &[HostFnEntry]) -> JSValue {
    let object = JSValue::create_empty_object(global, fns.len());
    for &(name, host_fn, arity) in fns {
        object.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, host_fn, arity, Default::default()),
        );
    }
    object
}
