use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::JSValue;

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
    fn init(
        value: JSValue,
        ref_type: WeakRefType,
        ctx: Option<NonNull<c_void>>,
    ) -> NonNull<WeakImpl> {
        NonNull::new(Bun__WeakRef__new(
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
    fn get(this: NonNull<WeakImpl>) -> JSValue {
        Bun__WeakRef__get(WeakImpl::opaque_ref(this.as_ptr()))
    }

    /// Clear the weakly-held value without freeing the handle.
    ///
    /// Safe for the same reason as [`WeakImpl::get`] — the handle is live by
    /// construction; `clear` is idempotent and does not invalidate `this`.
    fn clear(this: NonNull<WeakImpl>) {
        Bun__WeakRef__clear(WeakImpl::opaque_ref(this.as_ptr()))
    }

    unsafe fn destroy(this: NonNull<WeakImpl>) {
        // SAFETY: `this` is a live WeakImpl handle; consumed here.
        unsafe { Bun__WeakRef__delete(this.as_ptr()) }
    }
}

// `WeakImpl` is an opaque `UnsafeCell`-backed ZST handle (`&WeakImpl` is
// ABI-identical to non-null `*const WeakImpl`; C++ slot mutation is interior).
// `new` is `safe fn`: it registers against `value`'s own cell (the
// `is_object()` guard in the constructors below admits only live object
// values), and `ctx` is an opaque round-trip pointer C++ only stores and
// forwards to the finalizer. `delete` consumes the allocation and so stays
// `unsafe fn`.
unsafe extern "C" {
    fn Bun__WeakRef__delete(this: *mut WeakImpl);
    safe fn Bun__WeakRef__new(
        value: JSValue,
        ref_type: WeakRefType,
        ctx: *mut c_void,
    ) -> *mut WeakImpl;
    safe fn Bun__WeakRef__get(this: &WeakImpl) -> JSValue;
    safe fn Bun__WeakRef__clear(this: &WeakImpl);
}

pub struct Weak<T> {
    r#ref: Option<NonNull<WeakImpl>>,
    _ctx: PhantomData<*mut T>,
}

impl<T> Default for Weak<T> {
    fn default() -> Self {
        Self {
            r#ref: None,
            _ctx: PhantomData,
        }
    }
}

impl<T> Weak<T> {
    /// A weak handle with no finalize callback, registered against `value`'s
    /// own cell. `get()` reads `None` from the moment GC reaps the referent,
    /// before any sweep runs cell destructors; non-object values produce an
    /// empty handle.
    pub fn create_passive(value: JSValue) -> Self {
        if !value.is_object() {
            return Self::default();
        }
        Self {
            r#ref: Some(WeakImpl::init(value, WeakRefType::None, None)),
            _ctx: PhantomData,
        }
    }

    pub fn create(value: JSValue, ref_type: WeakRefType, ctx: &mut T) -> Self {
        if value.is_object() {
            return Self {
                r#ref: Some(WeakImpl::init(
                    value,
                    ref_type,
                    Some(NonNull::from(ctx).cast::<c_void>()),
                )),
                _ctx: PhantomData,
            };
        }

        Self {
            r#ref: None,
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

    /// True when a handle was registered, whether or not the referent is
    /// still alive. Distinguishes a reaped handle (`is_registered()` with
    /// `get() == None`) from a default/empty one.
    pub fn is_registered(&self) -> bool {
        self.r#ref.is_some()
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
