use core::ffi::c_int;
use core::fmt;

use bun_str::String;

use crate::{JSGlobalObject, JSPromise, JSValue};

#[repr(C)]
pub struct SystemError {
    pub errno: c_int,
    /// label for errno
    pub code: String,
    /// it is illegal to have an empty message
    pub message: String,
    pub path: String,
    pub syscall: String,
    pub hostname: String,
    /// MinInt = no file descriptor
    pub fd: c_int,
    pub dest: String,
}

// TODO(port): Zig `extern struct` field defaults allowed `.{ .message = m }` partial init
// (errno=0, code/path/syscall/hostname/dest=.empty, fd=c_int::MIN). Rust has no per-field
// defaults at construction; callers must build the whole struct. Consider a `fn new(message)`
// helper in Phase B if call sites need it.

/// `union(enum) { err: SystemError, result: Result }`
pub enum Maybe<R> {
    Err(SystemError),
    Result(R),
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn SystemError__toErrorInstance(this: *const SystemError, global: *mut JSGlobalObject) -> JSValue;
    fn SystemError__toErrorInstanceWithInfoObject(this: *const SystemError, global: *mut JSGlobalObject) -> JSValue;
}

impl SystemError {
    pub fn get_errno(&self) -> bun_sys::E {
        // The inverse in bun.sys.Error.toSystemError()
        // SAFETY: errno * -1 is a valid discriminant of bun_sys::E (mirrors Zig @enumFromInt).
        // TODO(port): verify bun_sys::E repr width matches this cast.
        unsafe { core::mem::transmute((self.errno * -1) as u16) }
    }

    pub fn deref(&self) {
        self.path.deref();
        self.code.deref();
        self.message.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }

    pub fn ref_(&mut self) {
        self.path.ref_();
        self.code.ref_();
        self.message.ref_();
        self.syscall.ref_();
        self.hostname.ref_();
        self.dest.ref_();
    }

    pub fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // Zig: defer this.deref();
        // SAFETY: self is a valid #[repr(C)] SystemError; global is a live JSGlobalObject.
        let result = unsafe { SystemError__toErrorInstance(self, global as *const _ as *mut _) };
        self.deref();
        result
    }

    /// Like `to_error_instance` but populates the error's stack trace with async
    /// frames from the given promise's await chain. Use when creating an error
    /// from native code at the top of the event loop (threadpool callback) to
    /// reject a promise — otherwise the error will have an empty stack.
    pub fn to_error_instance_with_async_stack(&self, global: &JSGlobalObject, promise: &JSPromise) -> JSValue {
        let value = self.to_error_instance(global);
        value.attach_async_stack_from_promise(global, promise);
        value
    }

    /// This constructs the ERR_SYSTEM_ERROR error object, which has an `info`
    /// property containing the details of the system error:
    ///
    /// SystemError [ERR_SYSTEM_ERROR]: A system error occurred: {syscall} returned {errno} ({message})
    /// {
    ///     name: "ERR_SYSTEM_ERROR",
    ///     info: {
    ///         errno: -{errno},
    ///         code: {code},        // string
    ///         message: {message},  // string
    ///         syscall: {syscall},  // string
    ///     },
    ///     errno: -{errno},
    ///     syscall: {syscall},
    /// }
    ///
    /// Before using this function, consider if the Node.js API it is
    /// implementing follows this convention. It is exclusively used
    /// to match the error code that `node:os` throws.
    pub fn to_error_instance_with_info_object(&self, global: &JSGlobalObject) -> JSValue {
        // Zig: defer this.deref();
        // SAFETY: self is a valid #[repr(C)] SystemError; global is a live JSGlobalObject.
        let result = unsafe { SystemError__toErrorInstanceWithInfoObject(self, global as *const _ as *mut _) };
        self.deref();
        result
    }
}

impl fmt::Display for SystemError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // TODO(port): bun.Output.prettyFmt is a comptime color-tag → ANSI transformer that
        // takes (fmt_str, comptime enable_colors) and returns a comptime-expanded format
        // string. Phase B needs a `bun_core::pretty_fmt!` macro. The runtime bool → comptime
        // dispatch (`switch (b) { inline else => |c| ... }`) is preserved as an if/else.
        if !self.path.is_empty() {
            // TODO: remove this hardcoding
            if bun_core::Output::enable_ansi_colors_stderr() {
                write!(
                    f,
                    // bun.Output.prettyFmt("<r><red>{f}<r><d>:<r> <b>{f}<r>: {f} <d>({f}())<r>", true)
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> <b>{}<r>: {} <d>({}())<r>", true),
                    self.code,
                    self.path,
                    self.message,
                    self.syscall,
                )
            } else {
                write!(
                    f,
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> <b>{}<r>: {} <d>({}())<r>", false),
                    self.code,
                    self.path,
                    self.message,
                    self.syscall,
                )
            }
        } else {
            // TODO: remove this hardcoding
            if bun_core::Output::enable_ansi_colors_stderr() {
                write!(
                    f,
                    // bun.Output.prettyFmt("<r><red>{f}<r><d>:<r> {f} <d>({f}())<r>", true)
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> {} <d>({}())<r>", true),
                    self.code,
                    self.message,
                    self.syscall,
                )
            } else {
                write!(
                    f,
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> {} <d>({}())<r>", false),
                    self.code,
                    self.message,
                    self.syscall,
                )
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/SystemError.zig (127 lines)
//   confidence: medium
//   todos:      4
//   notes:      #[repr(C)] FFI struct; deref/ref kept explicit (not Drop); pretty_fmt! macro needed in Phase B; field-default partial-init lost.
// ──────────────────────────────────────────────────────────────────────────
