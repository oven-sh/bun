//! webgpu.h, as Dawn implements it. No handle is `Send`: an instance and everything made from it stay on one thread.

use core::ffi::{CStr, c_void};
use core::marker::PhantomData;
use core::ptr::{self, NonNull};

mod generated;
mod host;

pub use generated::*;
pub use host::{
    DeviceEvents, DeviceOptions, Host, OwnedAdapter, OwnedDevice, OwnedInstance, Serial, Wake,
    WorkerTask,
};

pub type Ref<T> = bun_core::ExternalShared<T>;

#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Bool(u32);

impl From<bool> for Bool {
    fn from(value: bool) -> Self {
        Self(value.into())
    }
}

impl From<Bool> for bool {
    fn from(value: Bool) -> Self {
        value.0 != 0
    }
}

impl From<Option<bool>> for OptionalBool {
    fn from(value: Option<bool>) -> Self {
        match value {
            Some(true) => Self::True,
            Some(false) => Self::False,
            None => Self::Undefined,
        }
    }
}

/// UTF-8.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct StringView<'a> {
    data: *const u8,
    length: usize,
    _bytes: PhantomData<&'a [u8]>,
}

impl<'a> StringView<'a> {
    /// No string, which is not the empty one.
    pub const NULL: Self = Self {
        data: ptr::null(),
        length: STRLEN,
        _bytes: PhantomData,
    };

    pub fn as_bytes(self) -> &'a [u8] {
        if self.data.is_null() {
            return &[];
        }
        if self.length == STRLEN {
            // SAFETY: this length says that the string ends with a NUL.
            return unsafe { CStr::from_ptr(self.data.cast()) }.to_bytes();
        }
        // SAFETY: made from a slice, or by Dawn for as long as `'a`.
        unsafe { core::slice::from_raw_parts(self.data, self.length) }
    }
}

impl<'a> From<&'a [u8]> for StringView<'a> {
    fn from(bytes: &'a [u8]) -> Self {
        Self {
            data: bytes.as_ptr(),
            length: bytes.len(),
            _bytes: PhantomData,
        }
    }
}

/// A count and the pointer after it.
#[repr(C)]
pub struct Slice<'a, T> {
    count: usize,
    items: *const T,
    _items: PhantomData<&'a [T]>,
}

impl<T> Clone for Slice<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Slice<'_, T> {}

impl<'a, T> Slice<'a, T> {
    pub const EMPTY: Self = Self {
        count: 0,
        items: ptr::null(),
        _items: PhantomData,
    };

    pub fn as_slice(self) -> &'a [T] {
        if self.count == 0 {
            return &[];
        }
        // SAFETY: made from a slice, or by Dawn for as long as `'a`.
        unsafe { core::slice::from_raw_parts(self.items, self.count) }
    }
}

impl<'a, T> From<&'a [T]> for Slice<'a, T> {
    fn from(items: &'a [T]) -> Self {
        Self {
            count: items.len(),
            items: items.as_ptr(),
            _items: PhantomData,
        }
    }
}

/// SAFETY: `Self` is `#[repr(C)]`, starts with a `ChainedStruct`, and is the structure that `S_TYPE` stands for.
pub unsafe trait Chained {
    const S_TYPE: SType;
}

/// The first member of a `T`.
#[repr(C)]
pub struct ChainedStruct<'a, T> {
    next: Chain<'a>,
    s_type: SType,
    _outer: PhantomData<fn() -> T>,
}

impl<T> Clone for ChainedStruct<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for ChainedStruct<'_, T> {}

impl<T: Chained> Default for ChainedStruct<'_, T> {
    fn default() -> Self {
        Self {
            next: Chain::END,
            s_type: T::S_TYPE,
            _outer: PhantomData,
        }
    }
}

/// `nextInChain`.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Chain<'a>(
    Option<NonNull<ChainedStruct<'a, c_void>>>,
    PhantomData<&'a ()>,
);

impl<'a> Chain<'a> {
    pub const END: Self = Self(None, PhantomData);

    pub fn find<T: Chained + 'a>(self) -> Option<&'a T> {
        let mut link = self.0;
        while let Some(pointer) = link {
            // SAFETY: a link points at a structure that starts with this and is borrowed for `'a`.
            let header = unsafe { pointer.as_ref() };
            if header.s_type == T::S_TYPE {
                // SAFETY: the contract of `Chained`. The pointer was made from the whole structure.
                return Some(unsafe { pointer.cast().as_ref() });
            }
            link = header.next.0;
        }
        None
    }
}

impl<'a, T: Chained> From<&'a T> for Chain<'a> {
    fn from(extension: &'a T) -> Self {
        Self(Some(NonNull::from(extension).cast()), PhantomData)
    }
}

/// The limits of `GPUSupportedLimits`, which are two structures here. By default none is set.
#[derive(Default)]
pub struct AllLimits {
    pub core: Limits,
    pub compatibility: CompatibilityModeLimits,
}

impl AllLimits {
    fn chain(&mut self) {
        let compatibility = NonNull::from(&mut self.compatibility);
        self.core.next_in_chain = Chain(Some(compatibility.cast()), PhantomData);
    }

    fn read(get_limits: impl FnOnce(&mut Limits) -> Status) -> Self {
        let mut limits = Self::default();
        limits.chain();
        let status = get_limits(&mut limits.core);
        debug_assert!(status == Status::Success);
        limits.core.next_in_chain = Chain::END;
        limits
    }
}

impl Adapter {
    pub fn all_limits(&self) -> AllLimits {
        AllLimits::read(|limits| self.get_limits(limits))
    }
}

impl Device {
    pub fn all_limits(&self) -> AllLimits {
        AllLimits::read(|limits| self.get_limits(limits))
    }
}
