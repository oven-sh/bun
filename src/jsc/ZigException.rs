use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr;

use crate::schema_api as api;
use bun_core::String;
use bun_url::URL as ZigURL;

use crate::module_loader::ModuleLoader;
use crate::virtual_machine::VirtualMachine;
use crate::{
    Exception, JSErrorCode, JSGlobalObject, JSRuntimeType, JSValue, ZigStackFrame, ZigStackTrace,
};

// SAFETY (safe fn): `JSValue` is a by-value scalar; `JSGlobalObject` is an
// opaque `UnsafeCell`-backed handle (`&` is ABI-identical to non-null `*mut`);
// `ZigException` is a `#[repr(C)]` out-param the C++ side fills in-place.
unsafe extern "C" {
    pub safe fn ZigException__collectSourceLines(
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
    pub fn collect_source_lines(&mut self, value: JSValue, global: &JSGlobalObject) {
        ZigException__collectSourceLines(value, global, self);
    }

    // PORT NOTE: kept as explicit `deinit` (not `Drop`) — this is a #[repr(C)] FFI
    // payload whose lifetime is gated by `Holder.loaded`; C++ constructs/populates it.
    pub fn deinit(&mut self) {
        self.syscall.deref();
        self.system_code.deref();
        self.path.deref();

        self.name.deref();
        self.message.deref();

        for line in self.stack.source_lines_mut() {
            line.deref();
        }

        for frame in self.stack.frames_mutable() {
            frame.deinit();
        }

        if let Some(source) = self.stack.referenced_source_provider {
            // Pointer was set by JSC (C++) and is valid until this deref releases it.
            // `SourceProvider` is an opaque ZST handle.
            crate::SourceProvider::opaque_mut(source.as_ptr()).deref();
        }
    }

    // PORT NOTE: `ZigException__fromException` is declared in headers.h but
    // has no C++ body (bindings.cpp dropped it; the only producer is
    // `JSC__JSValue__toZigException` which writes through an out-param). The
    // Zig `fromException` re-export is dead code; do not port it.

    pub fn add_to_error_list(
        &mut self,
        error_list: &mut Vec<api::JsException>,
        root_path: &[u8],
        origin: Option<&ZigURL>,
    ) -> Result<(), bun_core::Error> {
        let name_slice = self.name.to_utf8();
        let message_slice = self.message.to_utf8();

        let name = name_slice.slice();
        let message = message_slice.slice();
        // PORT NOTE: `defer name_slice.deinit()` / `defer message_slice.deinit()` —
        // `ZigStringSlice` drops at scope exit.

        let mut is_empty = true;
        let mut api_exception = api::JsException {
            // PORT NOTE: `@intFromEnum` — JSRuntimeType/JSErrorCode are
            // transparent newtypes over u16/u8 (non-exhaustive Zig enums).
            runtime_type: self.runtime_type.0,
            code: u16::from(self.r#type.0),
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
    // `zig_exception()` writes it). Use MaybeUninit and gate access on `loaded`.
    pub zig_exception: MaybeUninit<ZigException>,
    pub need_to_clear_parser_arena_on_deinit: bool,
}

impl Holder {
    const FRAME_COUNT: usize = 32;
    pub const SOURCE_LINES_COUNT: usize = 6;

    // PORT NOTE: Zig had `pub const Zero: Holder`; Rust const requires every
    // initializer to be const-evaluable. Using a fn instead.
    pub fn zero() -> Self {
        Self {
            // PORT NOTE: `[ZigStackFrame::ZERO; N]` would require `Copy`;
            // mirror the Zig `@memset` via from_fn.
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

    // PORT NOTE: not just `Drop` — takes `vm` parameter for `reset_arena`. Zig
    // callers all `defer holder.deinit(vm)`; Rust callers should still call this
    // explicitly at the tail (it does the arena reset which `Drop` cannot), but
    // the string-ref release half is also covered by `Drop` below so an early
    // `?`/return between population and the tail call won't leak WTF string refs.
    pub fn deinit(&mut self, vm: &mut VirtualMachine) {
        if self.loaded {
            // SAFETY: `loaded == true` ⇔ `zig_exception()` has written this slot.
            unsafe { self.zig_exception.assume_init_mut() }.deinit();
            // Make idempotent so the subsequent `Drop` is a no-op.
            self.loaded = false;
        }
        if self.need_to_clear_parser_arena_on_deinit {
            // PORT NOTE: reshaped for borrowck — Zig `vm.module_loader.resetArena(vm)`
            // would borrow `vm` twice; the Rust port made `reset_arena` an
            // associated fn on `ModuleLoader` taking only `&mut VirtualMachine`.
            ModuleLoader::reset_arena(vm);
        }
    }

    pub fn zig_exception(&mut self) -> &mut ZigException {
        if !self.loaded {
            self.zig_exception.write(ZigException {
                // Zig: `@as(JSErrorCode, @enumFromInt(255))` — non-exhaustive
                // enum(u8) → transparent newtype, so just construct directly.
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
            });
            self.loaded = true;
        }

        // SAFETY: either the branch above just wrote it, or `loaded` was already
        // true from a prior call that wrote it.
        unsafe { self.zig_exception.assume_init_mut() }
    }
}

impl Drop for Holder {
    // PORT NOTE: restores the string-ref-release half of Zig's
    // `defer holder.deinit(vm)`. The explicit `deinit(&mut self, vm)` clears
    // `loaded` after running, so this is a no-op on the happy path; it only
    // fires when an early-return/`?`/panic skips the tail `deinit` call.
    fn drop(&mut self) {
        if self.loaded {
            // SAFETY: `loaded == true` ⇔ `zig_exception()` has written this slot.
            unsafe { self.zig_exception.assume_init_mut() }.deinit();
            self.loaded = false;
        }
    }
}

// ported from: src/jsc/ZigException.zig
