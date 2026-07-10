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

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`WeakImpl`] handle.
pub(crate) mod sys {
    bun_opaque::opaque_ffi! {
        /// `Bun::WeakRef`. `&Self` is ABI-identical to a non-null
        /// `Bun::WeakRef*`, and carries no `noalias`/`readonly` — C++ mutates
        /// the `JSC::Weak` slot through it.
        pub(crate) struct WeakImpl;
    }
}

// C++ `new Bun::WeakRef` hands back the allocation. One `WeakImpl` handle owns
// exactly that one allocation; `Drop` gives it back.
bun_opaque::foreign_owned!(sys::WeakImpl, Bun__WeakRef__delete);

/// Owned handle to a C++ `Bun::WeakRef`.
///
/// Every method takes `&self`: C++ mutates the `JSC::Weak` slot through the
/// same pointer, so there is no `&mut self` to have.
#[repr(transparent)]
pub(crate) struct WeakImpl(bun_opaque::ForeignRef<sys::WeakImpl>);

// `JSGlobalObject`/`sys::WeakImpl` are ZST handles: `&T` is ABI-identical to a
// non-null `*const T`, and C++ writing the slot through it is interior mutation.
// Shims trafficking only in such refs + scalars are `safe fn`.
unsafe extern "C" {
    // safe: C++ clears the slot and `delete`s the object. Destruction is not
    // exclusive access of any Rust-visible bytes, so the receiver is `&`.
    safe fn Bun__WeakRef__delete(this: &sys::WeakImpl);
    // NOT `safe fn`: C++ stores `ctx` in the `JSC::Weak` and hands it to
    // `Bun__<T>_finalize`, which dereferences it. Safe Rust can forge a
    // `*mut c_void`, so the call itself carries the validity obligation.
    fn Bun__WeakRef__new(
        global: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: *mut c_void,
    ) -> *mut sys::WeakImpl;
    safe fn Bun__WeakRef__get(this: &sys::WeakImpl) -> JSValue;
    safe fn Bun__WeakRef__clear(this: &sys::WeakImpl);
}

/// Ownership plumbing.
impl WeakImpl {
    /// Adopt the allocation C++ just handed back.
    ///
    /// # Safety
    /// `ptr` must be a live `Bun::WeakRef` that no other handle will delete.
    #[inline]
    unsafe fn adopt(ptr: NonNull<sys::WeakImpl>) -> Self {
        // SAFETY: caller transfers the allocation.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable allocation; `None` on null.
    #[inline]
    fn adopt_ptr(ptr: *mut sys::WeakImpl) -> Option<Self> {
        // SAFETY: `Bun__WeakRef__new` returns a fresh allocation or null.
        NonNull::new(ptr).map(|p| unsafe { Self::adopt(p) })
    }

    #[inline]
    fn raw(&self) -> &sys::WeakImpl {
        &self.0
    }
}

impl WeakImpl {
    fn new(
        global_this: &JSGlobalObject,
        value: JSValue,
        ref_type: WeakRefType,
        ctx: Option<NonNull<c_void>>,
    ) -> Self {
        // SAFETY: C++ only stores `ctx` and forwards it to the type's finalizer;
        // the owner it points at outlives this handle.
        let ptr = unsafe {
            Bun__WeakRef__new(
                global_this,
                value,
                ref_type,
                ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr()),
            )
        };
        Self::adopt_ptr(ptr).expect("Bun__WeakRef__new returned null")
    }

    /// Read the weakly-held `JSValue` (or `JSValue::ZERO` if collected).
    fn get(&self) -> JSValue {
        Bun__WeakRef__get(self.raw())
    }

    /// Clear the weakly-held value without freeing the handle; idempotent.
    fn clear(&self) {
        Bun__WeakRef__clear(self.raw())
    }
}

pub struct Weak<T> {
    r#ref: Option<WeakImpl>,
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
                r#ref: Some(WeakImpl::new(
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
        let result = self.r#ref.as_ref()?.get();
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(r#ref) = self.r#ref.as_ref() else {
            return JSValue::ZERO;
        };
        let result = r#ref.get();
        if result.is_empty() {
            return JSValue::ZERO;
        }

        r#ref.clear();
        result
    }

    pub fn has(&self) -> bool {
        let Some(r#ref) = self.r#ref.as_ref() else {
            return false;
        };
        !r#ref.get().is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }

        Some(result)
    }

    pub fn clear(&mut self) {
        let Some(r#ref) = self.r#ref.as_ref() else {
            return;
        };
        r#ref.clear();
    }
}
