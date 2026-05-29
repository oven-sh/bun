use core::ffi::c_void;
use core::marker::PhantomData;
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
    pub(crate) struct WeakImpl;
}

impl WeakImpl {
    pub(crate) fn init(
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

    pub(crate) fn get(this: NonNull<WeakImpl>) -> JSValue {
        Bun__WeakRef__get(WeakImpl::opaque_ref(this.as_ptr()))
    }

    pub(crate) fn clear(this: NonNull<WeakImpl>) {
        Bun__WeakRef__clear(WeakImpl::opaque_ref(this.as_ptr()))
    }

    pub(crate) unsafe fn destroy(this: NonNull<WeakImpl>) {
        // SAFETY: `this` is a live WeakImpl handle; consumed here.
        unsafe { Bun__WeakRef__delete(this.as_ptr()) }
    }
}

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
