use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue};

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WeakRefType {
    None = 0,
    FetchResponse = 1,
    PostgreSQLQueryClient = 2,
}

/// Opaque FFI handle (C++ `Bun::WeakRef`).
#[repr(C)]
pub struct WeakImpl {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl WeakImpl {
    pub fn init(
        global_this: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: Option<NonNull<c_void>>,
    ) -> NonNull<WeakImpl> {
        // SAFETY: Bun__WeakRef__new never returns null.
        unsafe {
            NonNull::new_unchecked(Bun__WeakRef__new(
                global_this,
                value,
                ref_type,
                ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr()),
            ))
        }
    }

    pub unsafe fn get(this: NonNull<WeakImpl>) -> JSValue {
        // SAFETY: `this` is a live WeakImpl handle owned by the caller.
        unsafe { Bun__WeakRef__get(this.as_ptr()) }
    }

    pub unsafe fn clear(this: NonNull<WeakImpl>) {
        // SAFETY: `this` is a live WeakImpl handle owned by the caller.
        unsafe { Bun__WeakRef__clear(this.as_ptr()) }
    }

    pub unsafe fn deinit(this: NonNull<WeakImpl>) {
        // SAFETY: `this` is a live WeakImpl handle; consumed here.
        unsafe { Bun__WeakRef__delete(this.as_ptr()) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__WeakRef__delete(this: *mut WeakImpl);
    fn Bun__WeakRef__new(
        global: *const JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: *mut c_void,
    ) -> *mut WeakImpl;
    fn Bun__WeakRef__get(this: *mut WeakImpl) -> JSValue;
    fn Bun__WeakRef__clear(this: *mut WeakImpl);
}

pub struct Weak<'a, T> {
    r#ref: Option<NonNull<WeakImpl>>,
    global_this: Option<&'a JSGlobalObject>,
    _ctx: PhantomData<*mut T>,
}

impl<'a, T> Default for Weak<'a, T> {
    fn default() -> Self {
        Self {
            r#ref: None,
            global_this: None,
            _ctx: PhantomData,
        }
    }
}

impl<'a, T> Weak<'a, T> {
    pub fn init() -> Self {
        Self::default()
    }

    pub fn call(&mut self, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else {
            return JSValue::ZERO;
        };
        function.call(self.global_this.unwrap(), args)
    }

    pub fn create(
        value: JSValue,
        global_this: &'a JSGlobalObject,
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
                global_this: Some(global_this),
                _ctx: PhantomData,
            };
        }

        Self {
            r#ref: None,
            global_this: Some(global_this),
            _ctx: PhantomData,
        }
    }

    pub fn get(&self) -> Option<JSValue> {
        let r#ref = self.r#ref?;
        // SAFETY: `r#ref` is live while `self` holds it.
        let result = unsafe { WeakImpl::get(r#ref) };
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(r#ref) = self.r#ref else {
            return JSValue::ZERO;
        };
        // SAFETY: `r#ref` is live while `self` holds it.
        let result = unsafe { WeakImpl::get(r#ref) };
        if result.is_empty() {
            return JSValue::ZERO;
        }

        // SAFETY: `r#ref` is live while `self` holds it.
        unsafe { WeakImpl::clear(r#ref) };
        result
    }

    pub fn has(&self) -> bool {
        let Some(r#ref) = self.r#ref else {
            return false;
        };
        // SAFETY: `r#ref` is live while `self` holds it.
        !unsafe { WeakImpl::get(r#ref) }.is_empty()
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
        // SAFETY: `r#ref` is live while `self` holds it.
        unsafe { WeakImpl::clear(r#ref) };
    }
}

impl<'a, T> Drop for Weak<'a, T> {
    fn drop(&mut self) {
        let Some(r#ref) = self.r#ref else {
            return;
        };
        self.r#ref = None;
        // SAFETY: `r#ref` was live; we just took ownership and are deleting it.
        unsafe { WeakImpl::deinit(r#ref) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Weak.zig (115 lines)
//   confidence: medium
//   todos:      1
//   notes:      r#ref keyword-escaped; jsc.markBinding(@src()) calls dropped (debug instrumentation); Weak gains <'a> per LIFETIMES.tsv JSC_BORROW
// ──────────────────────────────────────────────────────────────────────────
