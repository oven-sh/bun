//! EXP-044 — Mirror of `bundle_v2.rs` `unsafe { &mut *self.bv2 }` JS-loop
//! trampoline reborrow of `&mut BundleV2`.
//!
//! Production shape (src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376, and
//! the helper cluster src/runtime/api/JSBundler.rs:1387-1405):
//!
//!     struct PluginCtx { bv2: *mut BundleV2<'static>, ... }
//!     impl PluginCtx {
//!         fn bv2_mut<'a>(&'a self) -> &'a mut BundleV2<'a> {
//!             unsafe { &mut *self.bv2 }
//!         }
//!     }
//!
//! The JS-loop trampoline derives `&mut BundleV2` once per
//! `JSBundlerPlugin__matchOnLoad` callback. If a plugin's `onLoad` callback
//! synchronously triggers another `bv2_mut` reborrow (e.g. plugin internally
//! re-imports during the same JS event-loop turn), two simultaneously-live
//! `&mut BundleV2` from the same parent raw pointer exist — same UB shape
//! class as EXP-010 B-2, but on the BundleV2 parent type rather than its
//! linker subgraph.
//!
//! Reproducer: a `PluginCtx` carrying a `*mut BundleV2` field; a method on
//! `&self` that does `unsafe { &mut *self.parent_ptr }` and mutates through
//! it; a callback that calls the same `bv2_mut` while the prior `&mut`
//! is still live.

#[derive(Default)]
struct BundleV2 {
    state: usize,
}

#[derive(Copy, Clone)]
struct PluginCtx {
    bv2: *mut BundleV2,
}

impl PluginCtx {
    /// Mirror of `bv2_mut`/`bv2_plugin` helpers at JSBundler.rs:1387-1405.
    /// The returned `&'a mut BundleV2` lifetime is caller-chosen.
    fn bv2_mut<'a>(&'a self) -> &'a mut BundleV2 {
        unsafe { &mut *self.bv2 }
    }

    /// Mirror of the trampoline body that calls into a plugin and (in the
    /// hazardous path) reborrows again while the first `&mut` is live.
    fn on_load(&self, callback: impl FnOnce(&Self)) {
        let outer: &mut BundleV2 = self.bv2_mut();
        outer.state = outer.state.wrapping_add(1);
        // Inside the callback, the plugin may synchronously trigger another
        // JSBundlerPlugin__matchOnLoad — same self.bv2 — while `outer` is
        // still live in this stack frame.
        callback(self);
        // Touch `outer` after the callback to keep its borrow alive across
        // the inner reborrow.
        outer.state = outer.state.wrapping_add(1);
        core::hint::black_box(outer.state);
    }
}

fn main() {
    let mut bv2 = BundleV2::default();
    let ctx = PluginCtx {
        bv2: &mut bv2 as *mut BundleV2,
    };
    ctx.on_load(|ctx_inner| {
        // Inner trampoline: same parent pointer, second simultaneously-live
        // `&mut BundleV2`.
        let inner = ctx_inner.bv2_mut();
        inner.state = inner.state.wrapping_add(10);
        core::hint::black_box(inner.state);
    });
    core::hint::black_box(bv2.state);
}
