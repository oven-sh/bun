//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (HandleSet is VM-owned).
}

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong {
            handle: Impl::init(global, value),
        }
    }

    pub fn get(&self) -> JSValue {
        let result = Impl::get(self.handle);
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        Impl::set(self.handle, global, new_value);
    }

    /// Swap a new value for the strong reference.
    pub fn swap(&mut self, global: &JSGlobalObject, new_value: JSValue) -> JSValue {
        let result = Impl::get(self.handle);
        self.set(global, new_value);
        result
    }

    /// Adopt an `Impl` handle allocated externally (e.g. by C++ bindgen glue),
    /// taking ownership. The handle will be destroyed on `Drop`.
    ///
    /// # Safety
    /// `handle` must have been produced by `Bun__StrongRef__new` (or equivalent)
    /// and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: NonNull<Impl>) -> Strong {
        Strong { handle }
    }
}

impl Drop for Strong {
    /// Release the strong reference.
    fn drop(&mut self) {
        // SAFETY: `self.handle` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(self.handle) };
        // Zig: `if (Environment.isDebug) strong.* = undefined;` — Rust drop
        // already invalidates the binding; no poison needed.
    }
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
// `#[repr(transparent)]` matches the Zig layout (`?*Impl` — single nullable
// pointer) so it stays FFI-safe when embedded in `extern "C"` structs.
#[repr(transparent)]
pub struct Optional {
    handle: Option<NonNull<Impl>>,
}

impl Default for Optional {
    fn default() -> Self {
        Self { handle: None }
    }
}

impl Optional {
    pub const fn empty() -> Optional {
        Optional { handle: None }
    }

    /// Adopt an `Impl` handle allocated externally (e.g. by C++ bindgen glue),
    /// taking ownership if non-null. The handle will be destroyed on `Drop`.
    ///
    /// # Safety
    /// If `Some`, `handle` must have been produced by `Bun__StrongRef__new`
    /// (or equivalent) and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: Option<NonNull<Impl>>) -> Optional {
        Optional { handle }
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional {
                handle: Some(Impl::init(global, value)),
            }
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = self.handle else { return };
        Impl::clear(r);
    }

    pub fn call(&mut self, global: &JSGlobalObject, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else {
            return JSValue::ZERO;
        };
        // PORT NOTE: Zig source (Strong.zig:71) calls `function.call(global, args)`
        // which predates the `thisValue` param on JSValue.call; pass `.undefined`.
        function
            .call(global, JSValue::UNDEFINED, args)
            .unwrap_or(JSValue::ZERO)
    }

    pub fn get(&self) -> Option<JSValue> {
        let imp = self.handle?;
        let result = Impl::get(imp);
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(imp) = self.handle else {
            return JSValue::ZERO;
        };
        let result = Impl::get(imp);
        if result.is_empty() {
            return JSValue::ZERO;
        }
        Impl::clear(imp);
        result
    }

    pub fn has(&self) -> bool {
        let Some(r) = self.handle else { return false };
        !Impl::get(r).is_empty()
    }

    /// Debug-only raw handle pointer for corruption probes (#53265). Null when
    /// `None`. Do NOT dereference — only compare against the small-integer
    /// floor in `Impl::destroy`.
    #[doc(hidden)]
    #[inline]
    pub fn handle_ptr(&self) -> *const () {
        self.handle.map_or(core::ptr::null(), |p| p.as_ptr().cast())
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    /// Explicit teardown for call sites ported from Zig that wrote
    /// `strong.deinit()` (Strong.zig:96). Idempotent; equivalent to dropping
    /// in place and leaving `self` empty so `Drop` is a no-op.
    pub fn deinit(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(r) };
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = self.handle else {
            if value.is_empty() {
                return;
            }
            self.handle = Some(Impl::init(global, value));
            return;
        };
        Impl::set(r, global, value);
    }
}

impl Drop for Optional {
    /// Frees memory for the underlying Strong reference.
    fn drop(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(r) };
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle. Backed by a `JSC::JSValue`-sized HandleSlot; see Strong.cpp.
    pub struct Impl;
}

impl Impl {
    pub fn init(global: &JSGlobalObject, value: JSValue) -> NonNull<Impl> {
        crate::mark_binding!();
        NonNull::new(Bun__StrongRef__new(global, value)).expect("Bun__StrongRef__new returned null")
    }

    pub fn get(this: NonNull<Impl>) -> JSValue {
        // `this` is actually a pointer to a `JSC::JSValue`; see Strong.cpp.
        // SAFETY: HandleSlot storage is a live, aligned JSC::JSValue (encoded i64) for the
        // lifetime of the Impl handle. JSValue stub is `#[repr(transparent)] usize` (same
        // size); reading it directly is the encode() operation.
        // TODO(b2): once DecodedJSValue.rs un-gates, switch back to `(*js_value).encode()`.
        unsafe { *this.as_ptr().cast::<JSValue>() }
    }

    pub fn set(this: NonNull<Impl>, global: &JSGlobalObject, value: JSValue) {
        crate::mark_binding!();
        Bun__StrongRef__set(Impl::opaque_ref(this.as_ptr()), global, value);
    }

    pub fn clear(this: NonNull<Impl>) {
        crate::mark_binding!();
        Bun__StrongRef__clear(Impl::opaque_ref(this.as_ptr()));
    }

    /// SAFETY: `this` must be a valid handle from `init`; consumed here (do not reuse).
    pub unsafe fn destroy(this: NonNull<Impl>) {
        crate::mark_binding!();
        // Defensive: a corrupted slot pointer here segfaults inside JSC's
        // HandleBlock::handleSet (the backing block is recovered by masking
        // the slot to the block base, then `+0x10` is read), which loses the
        // Rust caller frame. With panic=abort the crash-handler hook captures
        // a Rust backtrace, so a `panic!` at this layer surfaces the *exact*
        // call site that holds the corrupted Strong. The 0x10000 floor is
        // Windows' default null-page guard; legitimate `Impl*` are bmalloc'd
        // far above it.
        if cfg!(debug_assertions) || cfg!(windows) {
            // Always-on on Windows while #53265 fs-promises-writeFile segfault
            // is being root-caused; release-stripped elsewhere. Remove the
            // `|| cfg!(windows)` once the corrupting writer is found.
            assert!(
                (this.as_ptr() as usize) >= 0x10000,
                "Strong<Impl>* corrupted ({:p}); owning struct was overwritten",
                this.as_ptr(),
            );
        }
        unsafe { Bun__StrongRef__delete(this.as_ptr()) };
    }
}

// TODO(port): move to jsc_sys
//
// `Impl` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles, so
// `&Impl`/`&JSGlobalObject` are ABI-identical to non-null `*const T` and C++
// mutating through them (HandleSet slot write) is interior mutation invisible
// to Rust. `delete` consumes the C++ allocation and so stays `unsafe fn`.
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    safe fn Bun__StrongRef__new(global: &JSGlobalObject, value: JSValue) -> *mut Impl;
    safe fn Bun__StrongRef__set(this: &Impl, global: &JSGlobalObject, value: JSValue);
    safe fn Bun__StrongRef__clear(this: &Impl);
}

pub use crate::deprecated_strong as deprecated;

// ported from: src/jsc/Strong.zig
