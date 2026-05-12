use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WeakRefType {
    None = 0,
    FetchResponse = 1,
    PostgreSQLQueryClient = 2,
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle (C++ `Bun::WeakRef`).
    pub struct WeakImpl;
}

impl WeakImpl {
    pub fn init(
        global_this: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: Option<NonNull<c_void>>,
    ) -> NonNull<WeakImpl> {
        NonNull::new(Bun__WeakRef__new(
            global_this,
            value,
            ref_type,
            ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr()),
        ))
        .expect("Bun__WeakRef__new returned null")
    }

    /// Read the weakly-held `JSValue` (or `JSValue::ZERO` if collected).
    ///
    /// Safe: every `NonNull<WeakImpl>` in this crate originates from
    /// [`WeakImpl::init`] and is held by a [`Weak<T>`] that drops it via
    /// [`WeakImpl::destroy`] before releasing the slot — so any
    /// `NonNull<WeakImpl>` reachable here is a live C++ `JSC::Weak` handle.
    /// Same contract as [`crate::strong::Impl::get`].
    pub fn get(this: NonNull<WeakImpl>) -> JSValue {
        Bun__WeakRef__get(WeakImpl::opaque_ref(this.as_ptr()))
    }

    /// Clear the weakly-held value without freeing the handle.
    ///
    /// Safe for the same reason as [`WeakImpl::get`] — the handle is live by
    /// construction; `clear` is idempotent and does not invalidate `this`.
    pub fn clear(this: NonNull<WeakImpl>) {
        Bun__WeakRef__clear(WeakImpl::opaque_ref(this.as_ptr()))
    }

    pub unsafe fn destroy(this: NonNull<WeakImpl>) {
        // SAFETY: `this` is a live WeakImpl handle; consumed here.
        unsafe { Bun__WeakRef__delete(this.as_ptr()) }
    }
}

// TODO(port): move to jsc_sys
//
// `WeakImpl` is an opaque `UnsafeCell`-backed ZST handle (`&WeakImpl` is
// ABI-identical to non-null `*const WeakImpl`; C++ slot mutation is interior).
// `new` is `safe fn`: `&JSGlobalObject` is the non-null handle proof, and `ctx`
// is an opaque round-trip pointer C++ only stores and forwards to the finalizer
// (never dereferenced as Rust data) — same contract as `JSC__VM__holdAPILock`.
// `delete` consumes the allocation and so stays `unsafe fn`.
unsafe extern "C" {
    fn Bun__WeakRef__delete(this: *mut WeakImpl);
    safe fn Bun__WeakRef__new(
        global: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: *mut c_void,
    ) -> *mut WeakImpl;
    safe fn Bun__WeakRef__get(this: &WeakImpl) -> JSValue;
    safe fn Bun__WeakRef__clear(this: &WeakImpl);
}

pub struct Weak<T> {
    r#ref: Option<NonNull<WeakImpl>>,
    global_this: Option<crate::GlobalRef>,
    _ctx: PhantomData<*mut T>,
}

impl<T> Default for Weak<T> {
    fn default() -> Self {
        Self {
            r#ref: None,
            global_this: None,
            _ctx: PhantomData,
        }
    }
}

impl<T> Weak<T> {
    pub fn init() -> Self {
        Self::default()
    }

    pub fn call(&mut self, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else {
            return JSValue::ZERO;
        };
        // PORT NOTE: Zig source (Weak.zig:50) calls `function.call(global, args)`
        // which predates the `thisValue` param on JSValue.call; pass `.undefined`.
        function
            .call(&self.global_this.unwrap(), JSValue::UNDEFINED, args)
            .unwrap_or(JSValue::ZERO)
    }

    pub fn create(
        value: JSValue,
        global_this: &JSGlobalObject,
        ref_type: WeakRefType,
        ctx: &mut T,
    ) -> Self {
        if !value.is_empty() {
            return Self {
                r#ref: Some(WeakImpl::init(
                    global_this,
                    value,
                    ref_type,
                    Some(NonNull::from(ctx).cast::<c_void>()),
                )),
                global_this: Some(global_this.into()),
                _ctx: PhantomData,
            };
        }

        Self {
            r#ref: None,
            global_this: Some(global_this.into()),
            _ctx: PhantomData,
        }
    }

    pub fn get(&self) -> Option<JSValue> {
        let r#ref = self.r#ref?;
        let result = WeakImpl::get(r#ref);
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(r#ref) = self.r#ref else {
            return JSValue::ZERO;
        };
        let result = WeakImpl::get(r#ref);
        if result.is_empty() {
            return JSValue::ZERO;
        }

        WeakImpl::clear(r#ref);
        result
    }

    pub fn has(&self) -> bool {
        let Some(r#ref) = self.r#ref else {
            return false;
        };
        !WeakImpl::get(r#ref).is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    pub fn clear(&mut self) {
        let Some(r#ref) = self.r#ref else {
            return;
        };
        WeakImpl::clear(r#ref);
    }
}

impl<T> Drop for Weak<T> {
    fn drop(&mut self) {
        let Some(r#ref) = self.r#ref else {
            return;
        };
        self.r#ref = None;
        // SAFETY: `r#ref` was live; we just took ownership and are deleting it.
        unsafe { WeakImpl::destroy(r#ref) };
    }
}

// ported from: src/jsc/Weak.zig
