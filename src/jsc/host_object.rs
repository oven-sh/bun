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

pub type HostFnEntry = (&'static str, JSHostFn, u32);

pub fn create_host_function_object(global: &JSGlobalObject, fns: &[HostFnEntry]) -> JSValue {
    JSValue::create_empty_object(global, fns.len()).put_host_functions(global, fns)
}

impl JSValue {
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
