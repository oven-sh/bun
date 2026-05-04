use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr;

use bun_str::String;
use bun_url::URL as ZigURL;
// TODO(port): verify crate path for generated schema API (`bun.schema.api`)
use bun_schema::api;

use bun_jsc::{
    Exception, JSErrorCode, JSGlobalObject, JSRuntimeType, JSValue, VirtualMachine, ZigStackFrame,
    ZigStackTrace,
};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn ZigException__collectSourceLines(
        js_value: JSValue,
        global: *mut JSGlobalObject,
        exception: *mut ZigException,
    );

    fn ZigException__fromException(exception: *mut Exception) -> ZigException;
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
    pub fn collect_source_lines(&mut self, value: JSValue, global: &JSGlobalObject) {
        // SAFETY: `self` is a valid &mut; global borrow outlives the call.
        unsafe {
            ZigException__collectSourceLines(
                value,
                global as *const JSGlobalObject as *mut JSGlobalObject,
                self,
            );
        }
    }

    // PORT NOTE: kept as explicit `deinit` (not `Drop`) — this is a #[repr(C)] FFI
    // payload whose lifetime is gated by `Holder.loaded`; C++ constructs/populates it.
    pub fn deinit(&mut self) {
        self.syscall.deref();
        self.system_code.deref();
        self.path.deref();

        self.name.deref();
        self.message.deref();

        // SAFETY: source_lines_ptr[..source_lines_len] is valid per ZigStackTrace contract.
        let lines = unsafe {
            core::slice::from_raw_parts_mut(
                self.stack.source_lines_ptr,
                self.stack.source_lines_len as usize,
            )
        };
        for line in lines {
            line.deref();
        }

        // SAFETY: frames_ptr[..frames_len] is valid per ZigStackTrace contract.
        let frames = unsafe {
            core::slice::from_raw_parts_mut(self.stack.frames_ptr, self.stack.frames_len as usize)
        };
        for frame in frames {
            frame.deinit();
        }

        if let Some(source) = self.stack.referenced_source_provider {
            source.deref();
        }
    }

    pub fn from_exception(exception: &mut Exception) -> ZigException {
        // SAFETY: exception is a valid &mut.
        unsafe { ZigException__fromException(exception) }
    }

    pub fn add_to_error_list(
        &mut self,
        error_list: &mut Vec<api::JsException>,
        root_path: &[u8],
        origin: Option<&ZigURL>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let name_slice = self.name.to_utf8();
        let message_slice = self.message.to_utf8();

        let name = name_slice.slice();
        let message = message_slice.slice();
        // PORT NOTE: `defer name_slice.deinit()` / `defer message_slice.deinit()` deleted —
        // `Utf8Slice` drops at scope exit.

        let mut is_empty = true;
        let mut api_exception = api::JsException {
            runtime_type: self.runtime_type as u16,
            code: self.r#type as u16,
            // TODO(port): verify integer width of runtime_type/code in api::JsException
            ..Default::default()
        };

        if !name.is_empty() {
            // PORT NOTE: `error_list.allocator.dupe(u8, _name)` → Box<[u8]> (global mimalloc).
            api_exception.name = Box::<[u8]>::from(name);
            is_empty = false;
        }

        if !message.is_empty() {
            api_exception.message = Box::<[u8]>::from(message);
            is_empty = false;
        }

        if self.stack.frames_len > 0 {
            api_exception.stack = self.stack.to_api(root_path, origin)?;
            is_empty = false;
        }

        if !is_empty {
            error_list.push(api_exception);
        }

        Ok(())
    }
}

#[repr(C)]
pub struct Holder {
    pub source_line_numbers: [i32; Self::SOURCE_LINES_COUNT],
    pub source_lines: [String; Self::SOURCE_LINES_COUNT],
    pub frames: [ZigStackFrame; Self::FRAME_COUNT],
    pub loaded: bool,
    // PORT NOTE: Zig had `= undefined` (never read until `loaded` flips and
    // `zig_exception()` writes it). `ZigException` has enum fields, so `zeroed()`
    // is forbidden — use MaybeUninit and gate access on `loaded`.
    pub zig_exception: MaybeUninit<ZigException>,
    pub need_to_clear_parser_arena_on_deinit: bool,
}

impl Holder {
    const FRAME_COUNT: usize = 32;
    pub const SOURCE_LINES_COUNT: usize = 6;

    // TODO(port): Zig had `pub const Zero: Holder`; Rust const requires
    // `String::EMPTY` / `ZigStackFrame::ZERO` to be `const`. Using a fn for now.
    pub fn zero() -> Self {
        Self {
            // PORT NOTE: `[ZigStackFrame::ZERO; N]` would require `Copy`;
            // mirror the Zig `@memset` via from_fn (no `zeroed()` — type has enum/tagged fields).
            frames: core::array::from_fn(|_| ZigStackFrame::ZERO),
            source_line_numbers: [-1; Self::SOURCE_LINES_COUNT],
            source_lines: core::array::from_fn(|_| String::EMPTY),
            zig_exception: MaybeUninit::uninit(),
            loaded: false,
            need_to_clear_parser_arena_on_deinit: false,
        }
    }

    pub fn init() -> Self {
        Self::zero()
    }

    // PORT NOTE: not `Drop` — takes `vm` parameter.
    pub fn deinit(&mut self, vm: &mut VirtualMachine) {
        if self.loaded {
            // SAFETY: `loaded == true` ⇔ `zig_exception()` has written this slot.
            unsafe { self.zig_exception.assume_init_mut() }.deinit();
        }
        if self.need_to_clear_parser_arena_on_deinit {
            vm.module_loader.reset_arena(vm);
            // TODO(port): reshaped for borrowck — `vm.module_loader.reset_arena(vm)`
            // borrows `vm` twice; Phase B may need `VirtualMachine::reset_module_loader_arena`.
        }
    }

    pub fn zig_exception(&mut self) -> &mut ZigException {
        if !self.loaded {
            self.zig_exception.write(ZigException {
                // SAFETY: JSErrorCode is #[repr(u8)]; 255 is the "unknown" sentinel.
                // TODO(port): verify JSErrorCode repr width
                r#type: unsafe { core::mem::transmute::<u8, JSErrorCode>(255) },
                runtime_type: JSRuntimeType::Nothing,
                name: String::EMPTY,
                message: String::EMPTY,
                exception: ptr::null_mut(),
                stack: ZigStackTrace {
                    source_lines_ptr: self.source_lines.as_mut_ptr(),
                    source_lines_numbers: self.source_line_numbers.as_mut_ptr(),
                    source_lines_len: u8::try_from(Self::SOURCE_LINES_COUNT).unwrap(),
                    source_lines_to_collect: u8::try_from(Self::SOURCE_LINES_COUNT).unwrap(),
                    frames_ptr: self.frames.as_mut_ptr(),
                    frames_len: 0,
                    frames_cap: u8::try_from(Self::FRAME_COUNT).unwrap(),
                    // TODO(port): ZigStackTrace may have additional fields (e.g.
                    // referenced_source_provider) — fill with defaults in Phase B.
                    ..Default::default()
                },
                errno: 0,
                syscall: String::EMPTY,
                system_code: String::EMPTY,
                path: String::EMPTY,
                remapped: false,
                fd: -1,
                browser_url: String::EMPTY,
            });
            self.loaded = true;
        }

        // SAFETY: either the branch above just wrote it, or `loaded` was already
        // true from a prior call that wrote it.
        unsafe { self.zig_exception.assume_init_mut() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigException.zig (183 lines)
//   confidence: medium
//   todos:      8
//   notes:      #[repr(C)] FFI payload; deinit kept explicit (not Drop) due to `loaded` gate + vm param; Holder::Zero const → fn zero(); Holder.zig_exception is MaybeUninit (Zig `= undefined`, gated by `loaded`); api::JsException field types need verification.
// ──────────────────────────────────────────────────────────────────────────
