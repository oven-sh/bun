//! Handles: opaque objects to which C holds a pointer.

use super::{MayAlias, Mut, Owned, Ref};
use crate::capi::*;
use crate::common;
use crate::common::memory;
use crate::common::utypes::*;
use bun_core::heap;
use std::marker::PhantomData;
use std::mem::ManuallyDrop;
use std::ptr::null_mut;

/// An object that lives in a `Box` from an `open` to a `close`, or in a `static`.
///
/// # Safety
/// A type with `MAGIC` is `#[repr(C)]` and begins with that number.
pub(crate) unsafe trait Handle: Sized + Unpin {
    /// ICU4C: capi_helper.h, IcuCApiHelper::validate
    const MAGIC: Option<i32> = None;
}

/// # Safety
/// `handle` is null or came from `LocalHandle::new`, and is not used again.
unsafe fn close_box<H>(handle: *mut H) {
    if !handle.is_null() {
        // SAFETY: `LocalHandle::new` has leaked the `Box`.
        unsafe { heap::destroy(handle) };
    }
}

/// Null, or an owned handle that is closed on drop.
#[must_use]
pub(crate) struct LocalHandle<H: Handle>(*mut H);

impl<H: Handle> LocalHandle<H> {
    pub(crate) fn new(object: Box<H>) -> Self {
        Self(heap::into_raw(object))
    }

    pub(crate) fn boxed(object: H) -> Result<Self, UErrorCode> {
        memory::try_box(object).map(Self::new)
    }

    pub(crate) fn null() -> Self {
        Self(null_mut())
    }

    pub(crate) fn into_raw(self) -> *mut H {
        ManuallyDrop::new(self).0
    }
}

impl<H: Handle> Drop for LocalHandle<H> {
    fn drop(&mut self) {
        // SAFETY: `self` owns the handle.
        unsafe { close_box(self.0) }
    }
}

/// The result of the closure of `ErrorCode::open`: an object to be boxed, or a `LocalHandle`.
pub(crate) trait IntoHandle<H: Handle>: Sized {
    /// Takes a reference, so that a large object is on the stack only once.
    fn into_handle(made: &mut Result<Self, UErrorCode>) -> Result<LocalHandle<H>, UErrorCode>;
}

impl<H: Handle> IntoHandle<H> for H {
    fn into_handle(made: &mut Result<Self, UErrorCode>) -> Result<LocalHandle<H>, UErrorCode> {
        memory::try_box_result(made).map(LocalHandle::new)
    }
}

impl<H: Handle> IntoHandle<H> for LocalHandle<H> {
    fn into_handle(made: &mut Result<Self, UErrorCode>) -> Result<LocalHandle<H>, UErrorCode> {
        std::mem::replace(made, Ok(LocalHandle::null()))
    }
}

/// # Safety
/// `handle` is null or points to an `i32`.
unsafe fn check<H>(handle: *const H, magic: Option<i32>) -> Result<(), UErrorCode> {
    if handle.is_null() {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    // SAFETY: `handle` is not null.
    if magic.is_some_and(|magic| unsafe { handle.cast::<i32>().read() } != magic) {
        return Err(U_INVALID_FORMAT_ERROR);
    }
    Ok(())
}

impl<'c, H: Handle> Ref<'c, H> {
    pub(crate) fn get(self) -> Result<&'c H, UErrorCode> {
        // SAFETY: `Ref` guarantees null or a handle that is not modified during `'c`.
        unsafe { check(self.ptr, H::MAGIC).map(|()| &*self.ptr) }
    }
}

impl<H> Mut<'_, H> {
    pub(crate) fn cast_const(&self) -> Ref<'_, H> {
        Ref {
            ptr: self.ptr,
            call: PhantomData,
        }
    }
}

impl<'c, H: Handle> Mut<'c, H> {
    pub(crate) fn get_mut(self) -> Result<&'c mut H, UErrorCode> {
        // SAFETY: `Mut` guarantees null or a handle without aliases, and is consumed.
        unsafe { check(self.ptr, H::MAGIC).map(|()| &mut *self.ptr) }
    }
}

impl<H> Owned<'_, H> {
    pub(crate) fn cast_const(&self) -> Ref<'_, H> {
        Ref {
            ptr: self.ptr,
            call: PhantomData,
        }
    }
}

impl<H: Handle> Owned<'_, H> {
    /// Does nothing for a handle with the wrong magic number.
    pub(crate) fn close(self) {
        if H::MAGIC.is_none() || self.cast_const().get().is_ok() {
            // SAFETY: `Owned` guarantees null or a handle that is not used again.
            unsafe { close_box(self.ptr) }
        }
    }

    pub(crate) fn adopt(self) -> Option<Box<H>> {
        const { assert!(H::MAGIC.is_none()) };
        // SAFETY: `LocalHandle::new` has leaked the `Box`, and `Owned` guarantees that the handle is not used again.
        (!self.ptr.is_null()).then(|| unsafe { heap::take(self.ptr) })
    }
}

impl<'c, H> MayAlias<Mut<'c, H>, H> {
    /// Returns `None` if `self` is `object`.
    pub(crate) fn if_distinct(self, object: &Mut<'_, H>) -> Option<Mut<'c, H>> {
        (!std::ptr::eq(self.0.ptr, object.ptr)).then_some(self.0)
    }
}

macro_rules! handles {
    ($($handle:ty $(= $magic:path)?,)+) => {$(
        // SAFETY: the types with a magic number begin with it.
        unsafe impl Handle for $handle {
            $(const MAGIC: Option<i32> = Some($magic);)?
        }
        const _: () = assert_send_sync::<$handle>();
    )+};
}

/// Several threads may use a `const` handle at the same time.
const fn assert_send_sync<T: Send + Sync>() {}

handles! {
    common::uresbund::UResourceBundle,
    ubrk::UBreakIterator,
    ucal::UCalendar,
    ucol::UCollator,
    udat::UDateFormat,
    udateintervalformat::UDateIntervalFormat,
    udatpg::UDateTimePatternGenerator,
    uenum::UEnumeration,
    ufieldpositer::UFieldPositionIterator,
    uformattedvalue::UConstrainedFieldPosition = uformattedvalue::UCFPOS_MAGIC,
    uformattedvalue::UFormattedValue = uformattedvalue::UFMTVAL_MAGIC,
    uidna::UIDNA,
    uldnames::ULocaleDisplayNames,
    ulistformatter::UListFormatter,
    unorm2::UNormalizer2,
    unum::UNumberFormat,
    unumberformatter::UNumberFormatter = unumberformatter::MAGIC,
    unumberrangeformatter::UNumberRangeFormatter = unumberrangeformatter::MAGIC,
    unumsys::UNumberingSystem,
    upluralrules::UPluralRules,
    ureldatefmt::URelativeDateTimeFormatter,
    uset::USet,
}
