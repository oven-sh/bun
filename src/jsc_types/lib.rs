#![allow(dead_code)]

use core::fmt;
use core::marker::PhantomData;
use core::ptr::NonNull;

pub mod event_loop;

/// ABI-compatible encoded JSC value bits.
///
/// This is the inert storage shape for `bun_jsc::JSValue`. The JSC owner crate
/// keeps the methods that inspect cells, call functions, and interact with the
/// VM; this type crate only names the 64-bit payload that higher sidecars need
/// to store without depending on `bun_jsc`.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EncodedJSValue(pub usize, PhantomData<*const ()>);

impl EncodedJSValue {
    pub const ZERO: Self = Self(0, PhantomData);
    pub const UNDEFINED: Self = Self(0xa, PhantomData);
    pub const NULL: Self = Self(0x2, PhantomData);
    pub const TRUE: Self = Self(0x7, PhantomData);
    pub const FALSE: Self = Self(0x6, PhantomData);
    pub const PROPERTY_DOES_NOT_EXIST: Self = Self(0x4, PhantomData);

    #[inline(always)]
    pub const fn from_bits(bits: usize) -> Self {
        Self(bits, PhantomData)
    }

    #[inline(always)]
    pub const fn bits(self) -> usize {
        self.0
    }

    #[inline(always)]
    pub const fn raw(self) -> i64 {
        self.0 as i64
    }

    #[inline(always)]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[inline(always)]
    pub const fn is_undefined_or_null(self) -> bool {
        (self.0 | 0x8) == 0xa
    }

    #[inline(always)]
    pub const fn is_empty_or_undefined_or_null(self) -> bool {
        self.is_empty() || self.is_undefined_or_null()
    }
}

const _: () = assert!(
    core::mem::size_of::<EncodedJSValue>() == core::mem::size_of::<i64>(),
    "EncodedJSValue must be 64 bits"
);

// Opaque handle slot allocated by JSC's strong-reference table.
//
// The type crate owns only the pointer identity shape. Allocation, mutation,
// clearing, and destruction stay in `bun_jsc::strong`, which owns the JSC FFI
// calls and the drop semantics.
bun_opaque::opaque_ffi! {
    pub struct StrongRefSlot;
}

/// Non-null identity for a JSC strong-reference slot.
///
/// This is still only an inert handle shape. The crate that owns JSC effects
/// decides when the slot is allocated, read, written, cleared, and destroyed.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StrongRefHandle(NonNull<StrongRefSlot>);

impl StrongRefHandle {
    /// Wrap a slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// `slot` must be a live strong-reference slot produced by the JSC owner
    /// crate and must remain valid until that owner destroys it.
    #[inline(always)]
    pub unsafe fn from_non_null(slot: NonNull<StrongRefSlot>) -> Self {
        Self(slot)
    }

    /// Wrap a raw slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// `slot` must be non-null and satisfy [`Self::from_non_null`]'s
    /// provenance/lifetime contract.
    #[inline(always)]
    pub unsafe fn from_raw(slot: *mut StrongRefSlot) -> Option<Self> {
        NonNull::new(slot).map(|slot| unsafe { Self::from_non_null(slot) })
    }

    #[inline(always)]
    pub fn as_non_null(self) -> NonNull<StrongRefSlot> {
        self.0
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut StrongRefSlot {
        self.0.as_ptr()
    }
}

/// Nullable identity for a JSC strong-reference slot.
///
/// This is the shape behind `jsc.Strong.Optional`: it may be empty, or it may
/// carry a slot allocated and eventually destroyed by the JSC owner crate. It
/// deliberately has no `Drop`; destruction is an effect owned by `bun_jsc`.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OptionalStrongRefHandle(Option<StrongRefHandle>);

impl OptionalStrongRefHandle {
    #[inline(always)]
    pub const fn empty() -> Self {
        Self(None)
    }

    #[inline(always)]
    pub fn new(handle: StrongRefHandle) -> Self {
        Self(Some(handle))
    }

    /// Wrap an optional slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// Any non-null `slot` must satisfy [`StrongRefHandle::from_non_null`]'s
    /// provenance/lifetime contract.
    #[inline(always)]
    pub unsafe fn from_non_null(slot: Option<NonNull<StrongRefSlot>>) -> Self {
        Self(slot.map(|slot| unsafe { StrongRefHandle::from_non_null(slot) }))
    }

    #[inline(always)]
    pub fn get(self) -> Option<StrongRefHandle> {
        self.0
    }

    #[inline(always)]
    pub fn take(&mut self) -> Option<StrongRefHandle> {
        self.0.take()
    }

    #[inline(always)]
    pub fn set(&mut self, handle: StrongRefHandle) {
        self.0 = Some(handle);
    }
}

/// Nullable strong-slot identity specifically used to root a `JSPromise`.
///
/// The semantic name matters for higher crates that need to talk about promise
/// ownership without depending on `bun_jsc`. Like the lower optional handle, it
/// is inert: creation, reads, mutation, resolution, and destruction stay in the
/// JSC owner crate.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct JSPromiseStrongHandle(OptionalStrongRefHandle);

impl JSPromiseStrongHandle {
    #[inline(always)]
    pub const fn empty() -> Self {
        Self(OptionalStrongRefHandle::empty())
    }

    #[inline(always)]
    pub fn new(handle: StrongRefHandle) -> Self {
        Self(OptionalStrongRefHandle::new(handle))
    }

    /// Wrap an optional slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// Any non-null `slot` must satisfy [`StrongRefHandle::from_non_null`]'s
    /// provenance/lifetime contract and must hold a `JSPromise` value when used
    /// by the JSC owner crate's promise APIs.
    #[inline(always)]
    pub unsafe fn from_non_null(slot: Option<NonNull<StrongRefSlot>>) -> Self {
        Self(unsafe { OptionalStrongRefHandle::from_non_null(slot) })
    }

    #[inline(always)]
    pub fn get(self) -> Option<StrongRefHandle> {
        self.0.get()
    }

    #[inline(always)]
    pub fn take(&mut self) -> Option<StrongRefHandle> {
        self.0.take()
    }

    #[inline(always)]
    pub fn set(&mut self, handle: StrongRefHandle) {
        self.0.set(handle);
    }
}

/// Inert storage state for a JS wrapper reference.
///
/// `bun_jsc::JsRef` owns the effectful behavior: creating/destroying strong
/// slots, reading weak values, and touching the VM. This sidecar type only
/// names the storage states so higher `_types` crates can carry JS wrapper
/// identity without depending on the `bun_jsc` implementation crate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsRefState {
    Weak(EncodedJSValue),
    Strong(OptionalStrongRefHandle),
    Finalized,
}

impl JsRefState {
    #[inline(always)]
    pub const fn empty() -> Self {
        Self::Weak(EncodedJSValue::UNDEFINED)
    }

    #[inline(always)]
    pub fn weak(value: EncodedJSValue) -> Self {
        Self::Weak(value)
    }

    #[inline(always)]
    pub fn strong(handle: StrongRefHandle) -> Self {
        Self::Strong(OptionalStrongRefHandle::new(handle))
    }

    #[inline(always)]
    pub const fn finalized() -> Self {
        Self::Finalized
    }

    #[inline(always)]
    pub fn is_strong(&self) -> bool {
        matches!(self, Self::Strong(_))
    }

    #[inline(always)]
    pub fn is_weak(&self) -> bool {
        matches!(self, Self::Weak(_))
    }

    #[inline(always)]
    pub fn is_finalized(&self) -> bool {
        matches!(self, Self::Finalized)
    }

    #[inline(always)]
    pub fn take_strong_handle(&mut self) -> Option<StrongRefHandle> {
        match self {
            Self::Strong(handle) => handle.take(),
            Self::Weak(_) | Self::Finalized => None,
        }
    }
}

/// VM-lifetime handle to a JSC-owned global object.
///
/// This is only pointer identity. The concrete JSC crate supplies the typed
/// alias (`bun_jsc::GlobalRef = GlobalRef<JSGlobalObject>`) and keeps all
/// effectful operations on `JSGlobalObject` itself.
#[repr(transparent)]
pub struct GlobalRef<T = ()>(*const T);

impl<T> Copy for GlobalRef<T> {}

impl<T> Clone for GlobalRef<T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> GlobalRef<T> {
    #[inline(always)]
    pub fn new(global: &T) -> Self {
        Self(core::ptr::from_ref(global))
    }

    /// Raw FFI pointer.
    #[inline(always)]
    pub fn as_ptr(self) -> *mut T {
        self.0.cast_mut()
    }

    #[inline(always)]
    pub fn cast<U>(self) -> GlobalRef<U> {
        GlobalRef(self.0.cast::<U>())
    }
}

impl<T> core::ops::Deref for GlobalRef<T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: constructed only from a live `&T`; callers uphold that the
        // referenced JSC object outlives every stored handle.
        unsafe { &*self.0 }
    }
}

impl<T> From<&T> for GlobalRef<T> {
    #[inline(always)]
    fn from(global: &T) -> Self {
        Self::new(global)
    }
}

impl<T> fmt::Debug for GlobalRef<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("GlobalRef").field(&self.0).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strong_ref_handle_preserves_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<StrongRefHandle>(),
            core::mem::size_of::<usize>()
        );
        assert_eq!(
            core::mem::size_of::<Option<StrongRefHandle>>(),
            core::mem::size_of::<usize>()
        );

        let slot = NonNull::<StrongRefSlot>::dangling();
        let handle = unsafe { StrongRefHandle::from_non_null(slot) };
        assert_eq!(handle.as_non_null(), slot);
        assert_eq!(
            unsafe { StrongRefHandle::from_raw(handle.as_ptr()) },
            Some(handle)
        );
        assert_eq!(unsafe { StrongRefHandle::from_raw(core::ptr::null_mut()) }, None);
    }

    #[test]
    fn optional_strong_ref_handle_preserves_nullable_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<OptionalStrongRefHandle>(),
            core::mem::size_of::<usize>()
        );

        let mut empty = OptionalStrongRefHandle::empty();
        assert_eq!(empty.get(), None);
        assert_eq!(empty.take(), None);

        let slot = NonNull::<StrongRefSlot>::dangling();
        let handle = unsafe { StrongRefHandle::from_non_null(slot) };
        let mut optional = OptionalStrongRefHandle::new(handle);
        assert_eq!(optional.get(), Some(handle));
        assert_eq!(optional.take(), Some(handle));
        assert_eq!(optional.get(), None);

        optional.set(handle);
        assert_eq!(optional.get(), Some(handle));
        assert_eq!(
            unsafe { OptionalStrongRefHandle::from_non_null(Some(slot)) },
            OptionalStrongRefHandle::new(handle)
        );
        assert_eq!(
            unsafe { OptionalStrongRefHandle::from_non_null(None) },
            OptionalStrongRefHandle::empty()
        );
    }

    #[test]
    fn js_promise_strong_handle_preserves_nullable_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<JSPromiseStrongHandle>(),
            core::mem::size_of::<usize>()
        );

        let slot = NonNull::<StrongRefSlot>::dangling();
        let handle = unsafe { StrongRefHandle::from_non_null(slot) };
        let mut promise = JSPromiseStrongHandle::new(handle);
        assert_eq!(promise.get(), Some(handle));
        assert_eq!(promise.take(), Some(handle));
        assert_eq!(promise.get(), None);

        promise.set(handle);
        assert_eq!(promise.get(), Some(handle));
        assert_eq!(
            unsafe { JSPromiseStrongHandle::from_non_null(Some(slot)) },
            JSPromiseStrongHandle::new(handle)
        );
        assert_eq!(
            unsafe { JSPromiseStrongHandle::from_non_null(None) },
            JSPromiseStrongHandle::empty()
        );
    }

    #[test]
    fn encoded_js_value_preserves_jsvalue_shape() {
        assert_eq!(
            core::mem::size_of::<EncodedJSValue>(),
            core::mem::size_of::<i64>()
        );

        let value = EncodedJSValue::from_bits(0xa);
        assert_eq!(value.bits(), EncodedJSValue::UNDEFINED.bits());
        assert!(value.is_empty_or_undefined_or_null());
        assert!(EncodedJSValue::NULL.is_undefined_or_null());
        assert!(!EncodedJSValue::TRUE.is_empty_or_undefined_or_null());
    }

    #[test]
    fn js_ref_state_carries_weak_or_strong_storage() {
        let weak = JsRefState::weak(EncodedJSValue::UNDEFINED);
        assert!(weak.is_weak());
        assert!(!weak.is_strong());
        assert!(!weak.is_finalized());

        let slot = NonNull::<StrongRefSlot>::dangling();
        let handle = unsafe { StrongRefHandle::from_non_null(slot) };
        let mut strong = JsRefState::strong(handle);
        assert!(strong.is_strong());
        assert_eq!(strong.take_strong_handle(), Some(handle));
        assert_eq!(strong.take_strong_handle(), None);

        assert!(JsRefState::finalized().is_finalized());
    }

    #[test]
    fn js_event_loop_handle_preserves_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<event_loop::JsEventLoopHandle>(),
            core::mem::size_of::<usize>()
        );

        let ptr = NonNull::<event_loop::JsEventLoop>::dangling().as_ptr().cast::<()>();
        let handle = unsafe { event_loop::JsEventLoopHandle::from_raw(ptr) };
        assert_eq!(handle.as_void_ptr(), ptr.cast::<core::ffi::c_void>());
    }
}
