use core::ffi::{c_int, c_void};
use core::ptr;

use crate::exception_list;
use bun_core::String;
use bun_url::URL as ZigURL;

use crate::module_loader::ModuleLoader;
use crate::virtual_machine::VirtualMachine;
use crate::{JSErrorCode, JSGlobalObject, JSRuntimeType, JSValue, ZigStackFrame, ZigStackTrace};

// SAFETY (safe fn): `JSValue` is a by-value scalar; `JSGlobalObject` is an
// opaque `UnsafeCell`-backed handle (`&` is ABI-identical to non-null `*mut`);
// `ZigException` is a `#[repr(C)]` out-param the C++ side fills in-place.
unsafe extern "C" {
    pub(crate) safe fn ZigException__collectSourceLines(
        js_value: JSValue,
        global: &JSGlobalObject,
        exception: &mut ZigException,
    );
}

/// Represents a JavaScript exception with additional information
#[repr(C)]
pub struct ZigException {
    pub r#type: JSErrorCode,
    pub runtime_type: JSRuntimeType,

    /// SystemError only
    pub errno: c_int,
    /// SystemError only
    pub syscall: String,
    /// SystemError only
    pub system_code: String,
    /// SystemError only
    pub path: String,

    pub name: String,
    pub message: String,
    pub stack: ZigStackTrace,

    pub exception: *mut c_void,

    pub remapped: bool,

    pub fd: i32,

    pub browser_url: String,
}

impl ZigException {
    pub(crate) fn collect_source_lines(&mut self, value: JSValue, global: &JSGlobalObject) {
        ZigException__collectSourceLines(value, global, self);
    }

    pub(crate) fn add_to_error_list(
        &mut self,
        error_list: &mut Vec<exception_list::JsException>,
        root_path: &[u8],
        origin: Option<&ZigURL>,
    ) {
        let name = self.name.to_utf8();
        let message = self.message.to_utf8();

        if name.slice().is_empty() && message.slice().is_empty() && self.stack.frames_len == 0 {
            return;
        }

        error_list.push(exception_list::JsException {
            name: Box::from(name.slice()),
            message: Box::from(message.slice()),
            runtime_type: self.runtime_type,
            code: self.r#type,
            stack: self.stack.snapshot(root_path, origin),
        });
    }
}

/// Backing storage for a `ZigException`'s stack; C++ fills `source_lines` /
/// `frames` through the pointers in `zig_exception.stack`.
pub struct Holder {
    pub(crate) source_line_numbers: [i32; Self::SOURCE_LINES_COUNT],
    source_lines: [String; Self::SOURCE_LINES_COUNT],
    frames: [ZigStackFrame; Self::FRAME_COUNT],
    pub(crate) zig_exception: Option<ZigException>,
    pub(crate) need_to_clear_parser_arena_on_deinit: bool,
}

impl Holder {
    const FRAME_COUNT: usize = 32;
    pub(crate) const SOURCE_LINES_COUNT: usize = 6;

    pub(crate) fn zero() -> Self {
        Self {
            frames: core::array::from_fn(|_| ZigStackFrame::ZERO),
            source_line_numbers: [-1; Self::SOURCE_LINES_COUNT],
            source_lines: core::array::from_fn(|_| String::EMPTY),
            zig_exception: None,
            need_to_clear_parser_arena_on_deinit: false,
        }
    }

    pub fn init() -> Self {
        Self::zero()
    }

    /// `Drop` releases the strings; this resets the parser arena used while
    /// collecting source lines, which needs `vm`.
    pub(crate) fn deinit(&mut self, vm: &mut VirtualMachine) {
        if core::mem::take(&mut self.need_to_clear_parser_arena_on_deinit) {
            ModuleLoader::reset_arena(vm);
        }
    }

    pub fn zig_exception(&mut self) -> &mut ZigException {
        self.zig_exception.get_or_insert_with(|| ZigException {
            r#type: JSErrorCode(255),
            runtime_type: JSRuntimeType::NOTHING,
            name: String::EMPTY,
            message: String::EMPTY,
            exception: ptr::null_mut(),
            stack: ZigStackTrace {
                source_lines_ptr: self.source_lines.as_mut_ptr(),
                source_lines_numbers: self.source_line_numbers.as_mut_ptr(),
                source_lines_len: Self::SOURCE_LINES_COUNT as u8,
                source_lines_to_collect: Self::SOURCE_LINES_COUNT as u8,
                frames_ptr: self.frames.as_mut_ptr(),
                frames_len: 0,
                frames_cap: Self::FRAME_COUNT as u8,
                referenced_source_provider: None,
            },
            errno: 0,
            syscall: String::EMPTY,
            system_code: String::EMPTY,
            path: String::EMPTY,
            remapped: false,
            fd: -1,
            browser_url: String::EMPTY,
        })
    }
}
