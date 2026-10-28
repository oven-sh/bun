use alloc::borrow::Cow;
use core::ffi::c_uint;

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue};
#[cfg(debug_assertions)]
use bun_core::ZStr;

bun_opaque::opaque_ffi! {
    /// Call Frame for JavaScript -> Native function calls. The bindings
    /// generator decodes its arguments in C++: see `docs/project/bindgen.mdx`.
    pub struct CallFrame;
}

impl CallFrame {
    pub fn get_caller_src_loc(&self, global_this: &JSGlobalObject) -> CallerSrcLoc {
        let mut str = bun_core::String::default();
        let mut line: c_uint = 0;
        let mut column: c_uint = 0;
        Bun__CallFrame__getCallerSrcLoc(self, global_this, &mut str, &mut line, &mut column);
        CallerSrcLoc { str, line, column }
    }

    #[cfg(debug_assertions)]
    pub(crate) fn describe_frame(&self) -> &ZStr {
        // SAFETY: FFI returns a NUL-terminated C string with lifetime tied to the frame.
        unsafe {
            let p = Bun__CallFrame__describeFrame(self);
            let len = bun_core::ffi::cstr(p).to_bytes().len();
            ZStr::from_raw(p.cast::<u8>(), len)
        }
    }
}

pub struct CallerSrcLoc {
    pub str: bun_core::String,
    pub line: c_uint,
    pub column: c_uint,
}

impl JSGlobalObject {
    /// [`CallFrame::get_caller_src_loc`] for the frame of the host function that is running.
    pub fn get_caller_src_loc(&self) -> CallerSrcLoc {
        let mut str = bun_core::String::default();
        let mut line: c_uint = 0;
        let mut column: c_uint = 0;
        JSC__JSGlobalObject__getCallerSrcLoc(self, &mut str, &mut line, &mut column);
        CallerSrcLoc { str, line, column }
    }
}

/// This is an advanced iterator struct which is used by various APIs. In
/// Node.fs, `will_be_async` is set to true which allows string/path APIs to
/// know if they have to do threadsafe clones.
pub struct ArgumentsSlice<'a> {
    /// Backing storage for `remaining()`; `Cow` so an owning caller can pass `Owned`.
    remaining_buf: Cow<'a, [JSValue]>,
    /// Cursor into `remaining_buf`; advances on `eat()`.
    remaining_start: usize,
    pub vm: &'a VirtualMachine,
    pub will_be_async: bool,
    /// An errno a converter met under `will_be_async`; the binding rejects its promise with it.
    pub deferred_error: Option<Box<bun_sys::SystemError>>,
}

impl<'a> ArgumentsSlice<'a> {
    /// View of arguments not yet consumed by `eat()`.
    #[inline]
    pub(crate) fn remaining(&self) -> &[JSValue] {
        &self.remaining_buf[self.remaining_start..]
    }

    pub fn init(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        ArgumentsSlice {
            remaining_buf: Cow::Borrowed(slice),
            remaining_start: 0,
            vm,
            will_be_async: false,
            deferred_error: None,
        }
    }

    pub fn eat(&mut self) {
        if self.remaining().is_empty() {
            return;
        }
        self.remaining_start += 1;
    }

    /// Peek the next argument without eating it
    pub fn next(&mut self) -> Option<JSValue> {
        self.remaining().first().copied()
    }

    pub fn next_eat(&mut self) -> Option<JSValue> {
        let v = self.remaining().first().copied()?;
        self.eat();
        Some(v)
    }
}

// `CallFrame`/`VM`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles;
// `&T` is ABI-identical to non-null `*const T`. Out-params are exclusive `&mut`
// to plain `#[repr(C)]` PODs. `describeFrame` returns a raw C string that the
// caller must NUL-scan, so it stays `unsafe fn`.
unsafe extern "C" {
    safe fn Bun__CallFrame__getCallerSrcLoc(
        cf: &CallFrame,
        global: &JSGlobalObject,
        out_str: &mut bun_core::String,
        out_line: &mut c_uint,
        out_column: &mut c_uint,
    );
    safe fn JSC__JSGlobalObject__getCallerSrcLoc(
        global: &JSGlobalObject,
        out_str: &mut bun_core::String,
        out_line: &mut c_uint,
        out_column: &mut c_uint,
    );
    #[cfg(debug_assertions)]
    fn Bun__CallFrame__describeFrame(cf: *const CallFrame) -> *const core::ffi::c_char;
}
