use core::ffi::c_void;
use core::marker::PhantomData;

use crate::{JSGlobalObject, JSValue};

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WeakRefType {
    None = 0,
    FetchResponse = 1,
    PostgreSQLQueryClient = 2,
}

bun_opaque::sealed_handle! {
    /// Opaque FFI handle (C++ `Bun::WeakRef`).
    struct WeakImpl;
}

// SAFETY: only `Bun__WeakRef__new` makes one.
bun_opaque::owned_handle! {
    struct OwnedWeakImpl(WeakImpl) => unsafe Bun__WeakRef__delete;
}

// `WeakImpl` is an opaque `UnsafeCell`-backed ZST handle (`&WeakImpl` is
// ABI-identical to non-null `*const WeakImpl`; C++ slot mutation is interior).
// `new` is `safe fn`: `&JSGlobalObject` is the non-null handle proof, and `ctx`
// is an opaque round-trip pointer C++ only stores and forwards to the finalizer
// (never dereferenced as Rust data).
// `delete` consumes the allocation and so stays `unsafe fn`.
unsafe extern "C" {
    fn Bun__WeakRef__delete(this: *mut WeakImpl);
    safe fn Bun__WeakRef__new(
        global: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: *mut c_void,
    ) -> OwnedWeakImpl;
    safe fn Bun__WeakRef__get(this: &WeakImpl) -> JSValue;
    safe fn Bun__WeakRef__clear(this: &WeakImpl);
}

pub struct Weak<T> {
    r#ref: Option<OwnedWeakImpl>,
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
    /// A weak handle with no finalize callback. `get()` reads `None` from the
    /// moment GC reaps the referent, before any sweep runs cell destructors.
    pub fn create_passive(value: JSValue, global_this: &JSGlobalObject) -> Self {
        if value.is_empty() {
            return Self::default();
        }
        Self {
            r#ref: Some(Bun__WeakRef__new(
                global_this,
                value,
                WeakRefType::None,
                core::ptr::null_mut(),
            )),
            _ctx: PhantomData,
        }
    }

    pub fn create(
        value: JSValue,
        global_this: &JSGlobalObject,
        ref_type: WeakRefType,
        ctx: &mut T,
    ) -> Self {
        if !value.is_empty() {
            return Self {
                r#ref: Some(Bun__WeakRef__new(
                    global_this,
                    value,
                    ref_type,
                    core::ptr::from_mut(ctx).cast(),
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
        let result = Bun__WeakRef__get(self.r#ref.as_ref()?);
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    /// Clears the C++ slot; `self` keeps the (now empty) handle, so a shared ref suffices.
    pub fn clear(&self) {
        let Some(r#ref) = &self.r#ref else {
            return;
        };
        Bun__WeakRef__clear(r#ref);
    }
}
