use core::ptr::NonNull;

use smallvec::SmallVec;

use crate::error::Status;
use crate::{Error, Result};

/// Declares functions of ICU under the names that the linked release gives them.
macro_rules! icu_functions {
    ($($(#[$attribute:meta])* $visibility:vis fn $name:ident($($argument:ident: $type:ty),* $(,)?) $(-> $result:ty)?;)*) => {
        unsafe extern "C" {
            $(
                $(#[$attribute])*
                #[link_name = icu_symbol!($name)]
                $visibility fn $name($($argument: $type),*) $(-> $result)?;
            )*
        }
    };
}

/// Declares the owner of an object of ICU, which any thread can use and close, one at a time.
macro_rules! icu_handle {
    ($(#[$attribute:meta])* $visibility:vis struct $name:ident($object:ty), $close:path) => {
        $(#[$attribute])*
        $visibility struct $name(core::ptr::NonNull<$object>);

        // SAFETY: an object of ICU does not belong to the thread that opened it.
        unsafe impl Send for $name {}

        impl Drop for $name {
            fn drop(&mut self) {
                // SAFETY: this is the only owner of an open object.
                unsafe { $close(self.0.as_ptr()) }
            }
        }
    };
}

/// Text that ICU wrote: UTF-16 code units, or the ASCII of an identifier without its terminator.
pub type Buffer<T> = SmallVec<[T; 32]>;

#[inline]
pub(crate) fn call<T>(function: impl FnOnce(&mut Status) -> T) -> Result<T> {
    let mut status = Status::new();
    let value = function(&mut status);
    status.result().map(|()| value)
}

/// For a function that returns a new object. ICU returns none when it reports a failure.
pub(crate) fn open<T>(function: impl FnOnce(&mut Status) -> *mut T) -> Result<NonNull<T>> {
    NonNull::new(call(function)?).ok_or(Error::MEMORY_ALLOCATION)
}

/// For a function that can return a new object along with a failure, which `own` then closes.
pub(crate) fn adopt<T, O>(
    function: impl FnOnce(&mut Status) -> *mut T,
    own: impl FnOnce(NonNull<T>) -> O,
) -> Result<O> {
    let mut status = Status::new();
    let object = NonNull::new(function(&mut status)).map(own);
    status.result()?;
    object.ok_or(Error::MEMORY_ALLOCATION)
}

/// For a function that returns a pointer and a length.
///
/// # Safety
/// Unless `units` is null, it has `length` units that nothing changes or frees during `'a`.
#[inline]
pub(crate) unsafe fn borrowed<'a, T>(units: *const T, length: i32) -> &'a [T] {
    match usize::try_from(length) {
        // SAFETY: the caller's.
        Ok(length) if !units.is_null() => unsafe { core::slice::from_raw_parts(units, length) },
        _ => &[],
    }
}

/// Below 2^30, so that ICU can add two lengths or double one.
#[inline]
pub(crate) fn length<T>(units: &[T]) -> Result<i32> {
    match i32::try_from(units.len()) {
        Ok(length) if length < 1 << 30 => Ok(length),
        _ => Err(Error::MEMORY_ALLOCATION),
    }
}

/// For a function that writes to a pointer and a capacity, and returns the length of the whole result even if it did not fit.
pub(crate) fn fill<A>(
    buffer: &mut SmallVec<A>,
    mut function: impl FnMut(*mut A::Item, i32, &mut Status) -> i32,
) -> Result<()>
where
    A: smallvec::Array<Item: Copy>,
{
    buffer.clear();
    for _ in 0..2 {
        let capacity = i32::try_from(buffer.capacity()).unwrap_or(i32::MAX);
        let mut status = Status::new();
        let needed = function(buffer.as_mut_ptr(), capacity, &mut status);
        match (status.result(), usize::try_from(needed)) {
            (Ok(()), Ok(written)) if needed <= capacity => {
                // SAFETY: a call that succeeds has written as many units as it returns, and they are inside the capacity.
                unsafe { buffer.set_len(written) };
                return Ok(());
            }
            (Err(Error::BUFFER_OVERFLOW), Ok(needed)) => buffer
                .try_reserve_exact(needed)
                .map_err(|_| Error::MEMORY_ALLOCATION)?,
            (Err(error), _) => return Err(error),
            (Ok(()), _) => break,
        }
    }
    Err(Error::BUFFER_OVERFLOW)
}

pub(crate) fn filled<T: Copy>(
    function: impl FnMut(*mut T, i32, &mut Status) -> i32,
) -> Result<Buffer<T>>
where
    [T; 32]: smallvec::Array<Item = T>,
{
    let mut buffer = Buffer::new();
    fill(&mut buffer, function)?;
    Ok(buffer)
}
