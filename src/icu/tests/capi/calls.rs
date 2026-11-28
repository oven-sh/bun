//! Calls with a status, during which allocations can be refused.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::ffi::c_void;
use std::fmt::Debug;
use std::ptr::null_mut;

pub(crate) type Handle = *mut c_void;
pub(crate) type Status = i32;
pub(crate) type Result<T> = std::result::Result<T, Status>;

pub(crate) const MEMORY_ALLOCATION: Status = 7;
pub(crate) const BUFFER_OVERFLOW: Status = 15;
pub(crate) const NOT_TERMINATED: Status = -124;

macro_rules! declare {
    ($($name:ident($($parameter:ty),*) $(-> $result:ty)?;)+) => {
        unsafe extern "C" {$(
            #[link_name = concat!(stringify!($name), "_79")]
            fn $name($(_: $parameter),*) $(-> $result)?;
        )+}
    };
}
pub(crate) use declare;

thread_local! {
    /// How many allocations are granted, and how many are refused after them.
    static GRANTS: Cell<Option<(usize, usize)>> = const { Cell::new(None) };
    static IS_IN_CALL: Cell<bool> = const { Cell::new(false) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        match GRANTS.get().filter(|_| IS_IN_CALL.get()) {
            Some((0, refusals)) => {
                GRANTS.set((refusals > 1).then_some((0, refusals - 1)));
                return null_mut();
            }
            Some((grants, refusals)) => GRANTS.set(Some((grants - 1, refusals))),
            None => {}
        }
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

pub(crate) fn with_status<T>(function: impl FnOnce(*mut Status) -> T) -> (T, Status) {
    let mut status = 0;
    IS_IN_CALL.set(true);
    let result = function(&raw mut status);
    IS_IN_CALL.set(false);
    (result, status)
}

pub(crate) fn call<T>(function: impl FnOnce(*mut Status) -> T) -> Result<T> {
    let (result, status) = with_status(function);
    if status > 0 { Err(status) } else { Ok(result) }
}

/// Closes the handle when it is dropped.
pub(crate) struct Open(pub(crate) Handle, unsafe extern "C" fn(Handle));

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: `open` has paired them.
        unsafe { self.1(self.0) }
    }
}

pub(crate) fn open(
    close: unsafe extern "C" fn(Handle),
    function: impl FnOnce(*mut Status) -> Handle,
) -> Result<Open> {
    let (handle, status) = with_status(function);
    let handle = Open(handle, close);
    if status > 0 { Err(status) } else { Ok(handle) }
}

/// Calls `function` with no buffer, and with each capacity up to one that holds the NUL.
pub(crate) fn written<T: Copy + Default + PartialEq + Debug>(
    function: impl Fn(*mut T, i32, *mut Status) -> i32,
) -> Result<Vec<T>> {
    let (length, status) = with_status(|status| function(null_mut(), 0, status));
    if status > 0 && status != BUFFER_OVERFLOW {
        return Err(status);
    }
    let mut last = Vec::new();
    for capacity in [0, length / 2, length, length + 1] {
        let mut buffer = Vec::with_capacity(capacity as usize);
        let (result, status) =
            with_status(|status| function(buffer.as_mut_ptr(), capacity, status));
        match status {
            MEMORY_ALLOCATION => return Err(status),
            BUFFER_OVERFLOW => assert!(capacity < length),
            _ => {
                assert_eq!(
                    status,
                    if capacity == length {
                        NOT_TERMINATED
                    } else {
                        0
                    },
                    "{capacity} {length}"
                );
                // SAFETY: success means that the text is there, and the NUL if there is room.
                unsafe { buffer.set_len(capacity as usize) };
                assert!(buffer.starts_with(&last));
                last = buffer;
            }
        }
        assert_eq!(result, length);
    }
    assert_eq!(last.pop(), Some(T::default()));
    Ok(last)
}

pub(crate) fn text(function: impl Fn(*mut u16, i32, *mut Status) -> i32) -> Result<String> {
    Ok(String::from_utf16(&written(function)?).unwrap())
}

pub(crate) fn utf16(text: &str) -> (Vec<u16>, i32) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let length = units.len() as i32;
    (units, length)
}

/// Refuses `refusals` allocations after `grants` others. Returns whether `run` got that far.
pub(crate) fn refuses<T: PartialEq<E> + Debug, E: Debug>(
    grants: usize,
    refusals: usize,
    expected: &E,
    run: &impl Fn() -> Result<T>,
) -> bool {
    GRANTS.set(Some((grants, refusals)));
    let result = run();
    let was_refused = GRANTS.take().is_none_or(|it| it.1 < refusals);
    match result {
        Err(status) => assert!(was_refused && status == MEMORY_ALLOCATION, "{status}"),
        Ok(result) => assert_eq!(result, *expected, "{grants}"),
    }
    was_refused
}

#[unsafe(no_mangle)]
extern "C" fn Bun__abortForRemovedLocaleData() -> ! {
    std::process::abort()
}
