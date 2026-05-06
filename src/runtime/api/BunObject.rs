//! `globalThis.Bun` — top-level host functions and lazy-property getters.

/// Build a public-path string for `to` relative to `dir`, prefixed by `origin`
/// (and `asset_prefix` when `origin` is absolute). Called by both the bundler
/// dev-server and `Bun.FileSystemRouter`'s `scriptSrc` getter.
pub fn get_public_path_with_asset_prefix<W: core::fmt::Write>(
    to: &[u8],
    dir: &[u8],
    origin: &bun_url::URL,
    asset_prefix: &[u8],
    writer: &mut W,
    platform: bun_paths::Platform,
) {
    use bun_paths::{resolve_path, Platform};
    use bun_str::strings;

    // PERF(port): bun_url::URL::join_write wants a `bun_io::Write`; route all
    // byte output through a Vec<u8> then forward to the caller's fmt::Write.
    // Spec writes raw bytes — POSIX paths are arbitrary byte sequences — so use
    // a lossy conversion rather than silently dropping the whole component.
    #[inline]
    fn write_bytes<W: core::fmt::Write>(w: &mut W, bytes: &[u8]) -> core::fmt::Result {
        match core::str::from_utf8(bytes) {
            Ok(s) => w.write_str(s),
            Err(_) => w.write_str(&String::from_utf8_lossy(bytes)),
        }
    }

    let relative_path: &[u8] = if strings::has_prefix(to, dir) {
        strings::without_trailing_slash(&to[dir.len()..])
    } else {
        // PORT NOTE: spec is `VirtualMachine.get().transpiler.fs.relativePlatform(dir, to, platform)`;
        // that wrapper is stateless and forwards to bun_paths — dispatch on runtime `platform`
        // here to keep this fn callable without const-generic plumbing through `transpiler.fs`.
        match platform {
            Platform::Posix => {
                resolve_path::relative_platform::<resolve_path::platform::Posix, false>(dir, to)
            }
            Platform::Windows => {
                resolve_path::relative_platform::<resolve_path::platform::Windows, false>(dir, to)
            }
            Platform::Loose => {
                resolve_path::relative_platform::<resolve_path::platform::Loose, false>(dir, to)
            }
            Platform::Nt => {
                resolve_path::relative_platform::<resolve_path::platform::Nt, false>(dir, to)
            }
        }
    };
    if origin.is_absolute() {
        if strings::has_prefix(relative_path, b"..") || strings::has_prefix(relative_path, b"./") {
            if write_bytes(writer, origin.origin).is_err() {
                return;
            }
            if write_bytes(writer, b"/abs:").is_err() {
                return;
            }
            if bun_paths::is_absolute(to) {
                let _ = write_bytes(writer, to);
            } else {
                // SAFETY: `transpiler.fs` is the process-lifetime resolver FileSystem
                // singleton, set during VM init and never freed.
                let fs = unsafe { &*(*VirtualMachine::get()).transpiler.fs };
                let _ = write_bytes(writer, fs.abs(&[to]));
            }
        } else {
            let mut buf: Vec<u8> = Vec::new();
            let _ = origin.join_write(&mut buf, asset_prefix, b"", relative_path, b"");
            let _ = write_bytes(writer, &buf);
        }
    } else {
        let _ = write_bytes(writer, strings::trim_left(relative_path, b"/"));
    }
}

// ─── un-gated host-fn bodies (B-2) ──────────────────────────────────────────
// `bun_jsc` + `#[bun_jsc::host_fn]` are real now. The self-contained `Bun.*`
// callbacks below compile against the un-gated bun_jsc surface and export the
// `BunObject_callback_<name>` symbols C++ links against (BunObject.cpp). The
// bulk of `bun_object` (export tables, lazy-property fan-out, JSZlib/JSZstd,
// env-map FFI, serve(), file()) stays in `_jsc_gated` until the sibling api/*
// modules they fan out to are themselves declared/un-gated.

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

#[bun_jsc::host_fn(export = "BunObject_callback_sleepSync")]
pub fn sleep_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if arguments.is_empty() {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "sleepSync expects 1 argument but received 0"
        )));
    }
    let arg = arguments[0];

    // The argument must be a number
    if !arg.is_number() {
        return Err(global_object.throw_invalid_argument_type(
            "sleepSync",
            "milliseconds",
            "number",
        ));
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    let milliseconds = arg.coerce::<i32>(global_object)?;
    if milliseconds < 0 {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "argument to sleepSync must not be negative, got {milliseconds}"
        )));
    }

    std::thread::sleep(core::time::Duration::from_millis(
        u64::try_from(milliseconds).unwrap(),
    ));
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "BunObject_callback_nanoseconds")]
pub fn nanoseconds(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: Zig's `std.time.Timer.read()` → `Instant::elapsed().as_nanos()`.
    // SAFETY: bun_vm() returns a live VirtualMachine pointer for a Bun-owned global.
    let ns = unsafe { (*global_this.bun_vm()).origin_timer.elapsed().as_nanos() as u64 };
    Ok(JSValue::js_number_from_uint64(ns))
}

#[bun_jsc::host_fn(export = "BunObject_callback_shrink")]
pub fn shrink(global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: `bun_jsc::VM` (the lib.rs stub) lacks `shrink_footprint`; the
    // real method lives on `bun_jsc::vm::VM`. Call the C++ symbol directly to
    // avoid touching the upstream crate.
    unsafe extern "C" {
        fn JSC__VM__shrinkFootprint(vm: *mut core::ffi::c_void);
    }
    // SAFETY: `vm_ptr()` returns the live JSC::VM*; FFI mutates it in place.
    unsafe { JSC__VM__shrinkFootprint(global_object.vm_ptr().cast()) };
    Ok(JSValue::UNDEFINED)
}

pub use Bun__gc as gc;
#[unsafe(no_mangle)]
pub extern "C" fn Bun__gc(vm: *mut VirtualMachine, sync: bool) -> usize {
    // SAFETY: caller is C++ passing a live VM.
    unsafe { (*vm).garbage_collect(sync) }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportError(global_object: *mut JSGlobalObject, err: JSValue) {
    // SAFETY: caller is C++ with a live global; VirtualMachine::get() is the singleton.
    let _ = unsafe { (*VirtualMachine::get()).uncaught_exception(&*global_object, err, false) };
}

// ─── un-gated host-fn bodies (B-2, round 3) ─────────────────────────────────
// `Bun.indexOfLine` / `Bun.allocUnsafe` are self-contained against the bun_jsc
// stub surface; the lazy-property getters below fan out to sibling api/*
// modules whose `create()` is already un-gated.

use bun_jsc::JSObject;
use bun_str::strings;

#[bun_jsc::host_fn(export = "BunObject_callback_indexOfLine")]
pub fn index_of_line(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.is_empty() {
        return Ok(JSValue::js_number_from_int32(-1));
    }

    let Some(buffer) = arguments[0].as_array_buffer(global_this) else {
        return Ok(JSValue::js_number_from_int32(-1));
    };

    let mut offset: usize = 0;
    if arguments.len() > 1 {
        offset = arguments[1].coerce_to_int64(global_this)?.max(0) as usize;
    }

    let bytes = buffer.byte_slice();
    let mut current_offset = offset;
    let end = bytes.len() as u32;

    while current_offset < end as usize {
        if let Some(i) = strings::index_of_newline_or_non_ascii(bytes, current_offset as u32) {
            let byte = bytes[i as usize];
            if byte > 0x7F {
                current_offset += (strings::wtf8_byte_sequence_length(byte) as usize).max(1);
                continue;
            }

            if byte == b'\n' {
                return Ok(JSValue::from(i));
            }

            current_offset = i as usize + 1;
        } else {
            break;
        }
    }

    Ok(JSValue::js_number_from_int32(-1))
}

// `Bun.allocUnsafe(size)` — wraps the C++ `JSC__JSValue__createUninitializedUint8Array`
// directly; the bun_jsc helper for these (`is_uint32_as_any_int` /
// `to_uint64_no_truncate` / `create_uninitialized_uint8_array`) lives in the
// still-gated `JSValue.rs`.
unsafe extern "C" {
    fn JSC__JSValue__isUInt32AsAnyInt(this: JSValue) -> bool;
    fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__JSValue__createUninitializedUint8Array(
        global: *const JSGlobalObject,
        len: usize,
    ) -> JSValue;
}

#[bun_jsc::host_fn(export = "BunObject_callback_allocUnsafe")]
pub fn alloc_unsafe(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    let size = arguments.ptr[0];
    // SAFETY: pure FFI predicate; C++ handles any tagged JSValue.
    if !unsafe { JSC__JSValue__isUInt32AsAnyInt(size) } {
        return Err(
            global_this.throw_invalid_arguments(format_args!("Expected a positive number"))
        );
    }
    // SAFETY: `size` is now known to encode a non-negative integer (per the
    // predicate above); `global_this` is a live borrow.
    Ok(unsafe {
        JSC__JSValue__createUninitializedUint8Array(
            global_this,
            JSC__JSValue__toUInt64NoTruncate(size) as usize,
        )
    })
}

/// phase-c stub: `Bun.color()` requires the `css` feature (bun_css crate),
/// which is intentionally off the `bun_bin` dep graph. With the feature
/// enabled this is replaced by `bun_css::CssColor::js_function_color`.
#[cfg(not(feature = "css"))]
pub fn color_unsupported(
    global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    Err(global_this.throw_invalid_arguments(format_args!(
        "Bun.color() is unavailable: built without the `css` feature"
    )))
}

// ─── lazy-property getters (un-gated targets only) ──────────────────────────
// Zig: `toJSLazyPropertyCallback(wrapped)` emits a `callconv(jsc.conv)` shim
// that calls `bun.jsc.toJSHostCall(global, @src(), wrapped, .{global, object})`
// and `@export`s it as `BunObject_lazyPropCb_<name>`. The getter bodies here
// are infallible (return `JSValue` directly), so the shim is a straight call.
//
// `lazy_prop!` expands one shim per (export-name, body) pair. Ident concat via
// `${concat()}` would need `#![feature(macro_metavar_expr_concat)]` at the
// crate root (out of scope for this file), so the export symbol is supplied
// verbatim instead.
macro_rules! lazy_prop {
    ($( $sym:ident => |$g:ident, $obj:ident| $body:expr ),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $sym(
                global: *mut JSGlobalObject,
                object: *mut JSObject,
            ) -> JSValue {
                // SAFETY: JSC always passes live `global` / `object` pointers
                // to lazy-property callbacks (BunObject.cpp).
                let $g: &JSGlobalObject = unsafe { &*global };
                #[allow(unused_variables)]
                let $obj: &JSObject = unsafe { &*object };
                bun_jsc::host_fn::to_js_host_call($g, (|| -> JsResult<JSValue> { Ok($body) })())
            }
        )*
    };
}

pub fn get_hash_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::hash_object::create(global_this)
}

pub fn get_jsonc_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: crate::api::jsonc_object::create (gated under private _jsc_gated)")
}

pub fn get_markdown_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: crate::api::markdown_object::create (gated under private _jsc_gated)")
}

pub fn enable_ansi_colors(_global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    use bun_core::Output;
    JSValue::js_boolean(Output::enable_ansi_colors_stdout() || Output::enable_ansi_colors_stderr())
}

pub fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: `transpiler.fs` is the process-lifetime resolver FileSystem
    // singleton (set during VM init, never freed); see get_public_path_* above.
    let fs = unsafe { &*(*VirtualMachine::get()).transpiler.fs };
    // PORT NOTE: Zig used `ZigString.init(..).toJS()`; that helper is gated in
    // bun_jsc, so route through the un-gated `BunString__createUTF8ForJS` FFI.
    bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, &fs.top_level_dir)
        .unwrap_or(JSValue::ZERO)
}

pub fn get_origin(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: VirtualMachine::get() returns the live singleton.
    let origin = unsafe { (*VirtualMachine::get()).origin.origin };
    bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, origin)
        .unwrap_or(JSValue::ZERO)
}

pub fn get_argv(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // PORT NOTE: Zig forwards to `node.process.getArgv`, which is itself a
    // shim over the C++ `Bun__Process__getArgv` (BunProcess.cpp). That Rust
    // module is still body-gated, so call the C symbol directly.
    unsafe extern "C" {
        fn Bun__Process__getArgv(global: *const JSGlobalObject) -> JSValue;
    }
    // SAFETY: `global_this` is a live borrow; C++ reads it without retaining.
    unsafe { Bun__Process__getArgv(global_this) }
}

lazy_prop! {
    BunObject_lazyPropCb_hash            => |g, _o| get_hash_object(g, _o),
    BunObject_lazyPropCb_JSONC           => |g, _o| get_jsonc_object(g, _o),
    BunObject_lazyPropCb_markdown        => |g, _o| get_markdown_object(g, _o),
    BunObject_lazyPropCb_enableANSIColors => |g, _o| enable_ansi_colors(g, _o),
    BunObject_lazyPropCb_cwd             => |g, _o| get_cwd(g, _o),
    BunObject_lazyPropCb_origin          => |g, _o| get_origin(g, _o),
    BunObject_lazyPropCb_argv            => |g, _o| get_argv(g, _o),
}

// ─── Bun.main getter/setter ─────────────────────────────────────────────────

fn get_main(global_this: &JSGlobalObject) -> JSValue {
    use bun_jsc::StringJsc as _;
    use bun_str::String as BunString;

    // SAFETY: bun_vm() returns the live singleton VirtualMachine for a Bun-owned global.
    let vm = unsafe { &mut *global_this.bun_vm() };
    // If JS has set it to a custom value, use that one
    if let Some(overridden_main) = vm.overridden_main.get() {
        return overridden_main;
    }

    // Attempt to use the resolved filesystem path
    // This makes `eval('require.main === module')` work when the main module is a symlink.
    // This behavior differs slightly from Node. Node sets the `id` to `.` when the main module is a symlink.
    'use_resolved_path: {
        if vm.main_resolved_path.is_empty() {
            // If it's from eval, don't try to resolve it.
            if vm.main.ends_with(b"[eval]") {
                break 'use_resolved_path;
            }
            if vm.main.ends_with(b"[stdin]") {
                break 'use_resolved_path;
            }

            let Ok(fd) = bun_sys::openat_a(
                if cfg!(windows) {
                    bun_sys::Fd::INVALID
                } else {
                    bun_sys::Fd::cwd()
                },
                vm.main,
                // Open with the minimum permissions necessary for resolving the file path.
                if cfg!(target_os = "linux") {
                    bun_sys::O::PATH
                } else {
                    bun_sys::O::RDONLY
                },
                0,
            ) else {
                break 'use_resolved_path;
            };

            let _close = scopeguard::guard(fd, |fd| {
                use bun_sys::FdExt as _;
                fd.close();
            });
            #[cfg(windows)]
            {
                let mut wpath = bun_paths::WPathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path_w(fd, &mut wpath) else {
                    break 'use_resolved_path;
                };
                vm.main_resolved_path = BunString::clone_utf16(fdpath);
            }
            #[cfg(not(windows))]
            {
                let mut path = bun_paths::PathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path(fd, &mut path) else {
                    break 'use_resolved_path;
                };

                // Bun.main === otherId will be compared many times, so let's try to create an atom string if we can.
                if let Some(atom) = BunString::try_create_atom(fdpath) {
                    vm.main_resolved_path = atom;
                } else {
                    vm.main_resolved_path = BunString::clone_utf8(fdpath);
                }
            }
        }

        return vm
            .main_resolved_path
            .to_js(global_this)
            .unwrap_or(JSValue::ZERO);
    }

    bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, vm.main).unwrap_or(JSValue::ZERO)
}

fn set_main(global_this: &JSGlobalObject, new_value: JSValue) -> bool {
    // SAFETY: bun_vm() returns the live singleton VirtualMachine for a Bun-owned global.
    unsafe { (*global_this.bun_vm()).overridden_main.set(global_this, new_value) };
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn BunObject_getter_main(g: *mut JSGlobalObject) -> JSValue {
    // SAFETY: JSC always passes a live global to property getters.
    get_main(unsafe { &*g })
}

#[unsafe(no_mangle)]
pub extern "C" fn BunObject_setter_main(g: *mut JSGlobalObject, v: JSValue) -> bool {
    // SAFETY: JSC always passes a live global to property setters.
    set_main(unsafe { &*g }, v)
}

// ─── host-fn bodies (the `Bun.*` surface proper) ────────────────────────────
// Remaining `#[bun_jsc::host_fn]` entry points + lazy-getter shims that fan
// out to still-gated targets (`webcore::Blob::construct_bun_file`, server
// `init/listen`, JSZlib/JSZstd, env-map FFI, …). Preserved verbatim.
// TODO(b2-blocked): bun_gen codegen crate + sibling api/* mod declarations
// (FFIObject/Subprocess/webcore::Blob/jsc::api::*). bun_jsc itself is
// un-gated now — remaining blockers are the fan-out targets.

#[allow(dead_code, deprecated)]
mod _jsc_gated {
use core::ffi::{c_char, c_int, c_void};
use std::io::Write as _;

use bun_core::{Environment, Output};
use bun_jsc::{
    self as jsc, host_fn, ArrayBuffer, CallFrame, ConsoleObject, ErrorableString, JSFunction,
    JSGlobalObject, JSObject, JSPromise, JSValue, JsRef, JsResult, WebCore, ZigString,
};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::{self as path, PathBuffer, WPathBuffer, MAX_PATH_BYTES};
use bun_str::{self, strings, String as BunString};
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_aio::{self as Async, KeepAlive};
use bun_threading::work_pool::WorkPool;

use bun_shell_parser::braces as Braces;
use bun_zlib as zlib;
use crate::cli::open::Editor;
use bun_url::URL;

use crate::api::{
    self, FFIObject, HashObject, JSON5Object, JSONCObject, MarkdownObject, TOMLObject,
    UnsafeObject, YAMLObject,
};
use crate::node;
use crate::crypto as Crypto;
use crate::api::cron;
use crate::api::csrf_jsc;
use crate::valkey_jsc::js_valkey::SubscriptionCtx;
use crate::test_runner::jest::Jest;
use crate::api::JSBundler;
use bun_jsc::ZigStringJsc as _; // to_error_instance / to_type_error_instance
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::{StringJsc as _, bun_string_jsc};
use bun_str::zig_string::Slice as ZigStringSlice;
use crate::test_runner::expect::{JSGlobalObjectTestExt as _, JSValueTestExt as _};

// Local shim for `globalObject.throwNotEnoughArguments(name, expected, got)` —
// upstream `bun_jsc::JSGlobalObject` doesn't expose it yet, so several runtime
// modules each carry a tiny extension trait until it's promoted.
trait JSGlobalObjectBunObjExt {
    fn throw_not_enough_arguments(&self, name_: &str, expected: usize, got: usize) -> jsc::JsError;
}
impl JSGlobalObjectBunObjExt for JSGlobalObject {
    fn throw_not_enough_arguments(&self, name_: &str, expected: usize, got: usize) -> jsc::JsError {
        self.throw_invalid_arguments(format_args!(
            "Not enough arguments to '{name_}'. Expected {expected}, got {got}."
        ))
    }
}

/// `bun.String.toJSArray` — the un-gated `bun_jsc::bun_string_jsc` module lacks
/// `to_js_array`; declare the C++ symbol locally (matches src/jsc/bun_string_jsc.rs:111).
#[inline]
fn bun_string_to_js_array(global: &JSGlobalObject, array: &[BunString]) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn BunString__createArray(
            global: *mut JSGlobalObject,
            ptr: *const BunString,
            len: usize,
        ) -> JSValue;
    }
    // SAFETY: `array` ptr/len from a live slice; `global` borrowed for call duration.
    let v = unsafe { BunString__createArray(global as *const _ as *mut _, array.as_ptr(), array.len()) };
    if global.has_exception() { Err(jsc::JsError::Thrown) } else { Ok(v) }
}

// ── local shim: JSC-side `ZigString.toJS / toExternalValue / toAtomicValue` ──
// `bun_jsc::ZigString` is a `pub type` alias for `bun_str::ZigString`; the
// inherent JSC conversion methods live on the *separate* `bun_jsc::zig_string::
// ZigString` (same `#[repr(C)] (ptr,len)` layout). Forward through the raw C++
// symbols so callers in this file can stay on `bun_str::ZigString`.
unsafe extern "C" {
    fn ZigString__toValueGC(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toAtomicValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalU16(ptr: *const u16, len: usize, global: *const JSGlobalObject) -> JSValue;
}
trait ZigStringToJs {
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    fn to_atomic_value(&self, global: &JSGlobalObject) -> JSValue;
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue;
    fn with_encoding(self) -> Self;
}
impl ZigStringToJs for ZigString {
    #[inline]
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        if self.is_globally_allocated() {
            return self.to_external_value(global);
        }
        // SAFETY: `self` is `#[repr(C)] (ptr,len)`; `global` is live.
        unsafe { ZigString__toValueGC(self, global) }
    }
    #[inline]
    fn to_atomic_value(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: see `to_js`.
        unsafe { ZigString__toAtomicValue(self, global) }
    }
    #[inline]
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: see `to_js`.
        unsafe { ZigString__toExternalValue(self, global) }
    }
    /// `ZigString.withEncoding()` — auto-detect UTF-8 vs Latin-1 and tag the
    /// pointer accordingly. Mirrors src/jsc/ZigString.rs:842.
    #[inline]
    fn with_encoding(mut self) -> Self {
        if !self.is_16bit() && !strings::is_all_ascii(self.slice()) {
            self.mark_utf8();
        }
        self
    }
}

// PORT NOTE: `bun_gen::bun_object::BracesOptions` is codegen output from
// BunObject.bind.ts. The `bun_gen` crate is not yet wired, so define the
// generated shape locally per the `.bind.ts` schema:
//   `t.dictionary({ tokenize: t.boolean.default(false), parse: t.boolean.default(false) })`
mod r#gen {
    #[derive(Default, Clone, Copy)]
    pub struct BracesOptions {
        pub tokenize: bool,
        pub parse: bool,
    }
}

// ─── wrap_static_method adapters ───────────────────────────────────────────
// Zig's `host_fn.wrapStaticMethod(T, "name", auto_protect)` reflects on the
// target fn's parameter types and decodes each from the CallFrame. The Rust
// proc-macro replacement (`#[bun_jsc::host_fn(static)]`) is not yet emitted,
// so hand-roll the arg-extraction shims for the six call sites below.
mod static_adapters {
    use super::*;

    pub fn listener_connect(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let _opts = if args.len >= 1 { args.ptr[0] } else { JSValue::UNDEFINED };
        let _ = g;
        todo!("blocked_on: crate::socket::Listener::connect")
    }

    pub fn listener_listen(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let _opts = if args.len >= 1 { args.ptr[0] } else { JSValue::UNDEFINED };
        let _ = g;
        todo!("blocked_on: crate::socket::Listener::listen")
    }

    pub fn udp_socket(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let _opts = if args.len >= 1 { args.ptr[0] } else { JSValue::UNDEFINED };
        let _ = g;
        todo!("blocked_on: crate::socket::udp_socket::UDPSocket::udp_socket")
    }

    pub fn subprocess_spawn(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<2>();
        let a0 = if args.len >= 1 { args.ptr[0] } else { JSValue::UNDEFINED };
        let a1 = if args.len >= 2 { Some(args.ptr[1]) } else { None };
        crate::api::js_bun_spawn_bindings::spawn(g, a0, a1)
    }

    pub fn subprocess_spawn_sync(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<2>();
        let a0 = if args.len >= 1 { args.ptr[0] } else { JSValue::UNDEFINED };
        let a1 = if args.len >= 2 { Some(args.ptr[1]) } else { None };
        crate::api::js_bun_spawn_bindings::spawn_sync(g, a0, a1)
    }

    // Shims for export-table targets whose real bodies live behind private
    // `_jsc_gated` mods in sibling files.
    pub fn js_bundler_build(_g: &JSGlobalObject, _cf: &CallFrame) -> JsResult<JSValue> {
        todo!("blocked_on: crate::api::JSBundler::build_fn (gated under private _jsc_gated)")
    }
    pub fn parsed_shell_script_create(_g: &JSGlobalObject, _cf: &CallFrame) -> JsResult<JSValue> {
        todo!("blocked_on: crate::shell::ParsedShellScript::create_parsed_shell_script")
    }
    pub fn shell_interpreter_create(_g: &JSGlobalObject, _cf: &CallFrame) -> JsResult<JSValue> {
        todo!("blocked_on: crate::shell::Interpreter::create_shell_interpreter")
    }
    pub fn static_hasher_getter(_g: &JSGlobalObject, _o: &JSObject) -> JSValue {
        // `Crypto::{MD4..SHA512_256}::getter` require `StaticHasher` impls for
        // `bun_sha_hmac::*`, which in turn need `Default` (orphan-rule blocked).
        todo!("blocked_on: crate::crypto::StaticHasher impls for bun_sha_hmac::*")
    }

    pub fn sha(_g: &JSGlobalObject, _cf: &CallFrame) -> JsResult<JSValue> {
        // wrapStaticMethod(Crypto.SHA512_256, "hash_", true) decodes
        // (BlobOrStringOrBuffer, ?StringOrBuffer) with auto-protect; that
        // decode table lives in the unwritten `#[bun_jsc::host_fn(static)]`
        // proc-macro.
        todo!("blocked_on: bun_jsc::host_fn::wrap_static_method (BlobOrStringOrBuffer decode)")
    }
}

/// How to add a new function or property to the Bun global
///
/// - Add a callback or property to the below struct
/// - @export it in the appropriate place
/// - Update "@begin bunObjectTable" in BunObject.cpp
///     - Getters use a generated wrapper function `BunObject_getter_wrap_<name>`
/// - Update "BunObject+exports.h"
/// - Run `bun run build`
pub mod bun_object {
    use super::*;

    // TODO(port): proc-macro — Zig used `toJSCallback = jsc.toJSHostFn` and
    // `toJSLazyPropertyCallback` (comptime fn wrappers) plus comptime `@export`
    // to emit each callback under `BunObject_callback_<name>` /
    // `BunObject_lazyPropCb_<name>`. In Rust, the `#[bun_jsc::host_fn]`
    // attribute on the underlying fn emits the JSC-ABI shim; the export name
    // is set with `#[unsafe(no_mangle)]` on the shim. The two `macro_rules!`
    // below expand the static export tables; Phase B should verify the shim
    // ABI matches `LazyPropertyCallback` for the property variants.

    // Ident concat via `${concat()}` is unstable (`macro_metavar_expr_concat`),
    // so the full `BunObject_callback_<name>` / `BunObject_lazyPropCb_<name>`
    // export symbol is supplied verbatim by the caller (same pattern as
    // `lazy_prop!` above).
    macro_rules! export_callbacks {
        ($( $(#[$attr:meta])* $sym:ident => $target:expr ),* $(,)?) => {
            $(
                $(#[$attr])*
                #[unsafe(no_mangle)]
                pub extern "C" fn $sym(
                    g: *mut JSGlobalObject,
                    f: *mut CallFrame,
                ) -> JSValue {
                    // SAFETY: JSC always passes valid pointers here.
                    bun_jsc::to_js_host_fn($target)(g, f)
                }
            )*
        };
    }

    /// Adapter so `export_lazy_prop_callbacks!` accepts targets returning either
    /// a bare `JSValue` (most getters) or a `JsResult<JSValue>` (e.g.
    /// `get_embedded_files`, which can OOM allocating the result array).
    trait IntoLazyPropResult {
        fn into_lazy_prop_result(self) -> JsResult<JSValue>;
    }
    impl IntoLazyPropResult for JSValue {
        #[inline]
        fn into_lazy_prop_result(self) -> JsResult<JSValue> { Ok(self) }
    }
    impl IntoLazyPropResult for JsResult<JSValue> {
        #[inline]
        fn into_lazy_prop_result(self) -> JsResult<JSValue> { self }
    }

    macro_rules! export_lazy_prop_callbacks {
        ($( $sym:ident => $target:path ),* $(,)?) => {
            $(
                #[unsafe(no_mangle)]
                pub extern "C" fn $sym(
                    this: *mut JSGlobalObject,
                    object: *mut JSObject,
                ) -> JSValue {
                    // SAFETY: JSC always passes valid pointers here.
                    let (g, o) = unsafe { (&*this, &*object) };
                    bun_jsc::to_js_host_call(
                        g,
                        IntoLazyPropResult::into_lazy_prop_result($target(g, o)),
                    )
                }
            )*
        };
    }

    // --- Callbacks ---
    export_callbacks! {
        BunObject_callback_allocUnsafe => super::alloc_unsafe,
        BunObject_callback_build => super::static_adapters::js_bundler_build,
        // phase-c: bun_css feature-gated off the bun_bin path; Bun.color()
        // export only emitted when the `css` feature is enabled.
        #[cfg(feature = "css")]
        BunObject_callback_color => bun_css::CssColor::js_function_color,
        #[cfg(not(feature = "css"))]
        BunObject_callback_color => super::super::color_unsupported,
        BunObject_callback_connect => super::static_adapters::listener_connect,
        BunObject_callback_createParsedShellScript => super::static_adapters::parsed_shell_script_create,
        BunObject_callback_createShellInterpreter => super::static_adapters::shell_interpreter_create,
        BunObject_callback_deflateSync => JSZlib::deflate_sync,
        BunObject_callback_file => crate::webcore::blob::construct_bun_file,
        BunObject_callback_gunzipSync => JSZlib::gunzip_sync,
        BunObject_callback_gzipSync => JSZlib::gzip_sync,
        BunObject_callback_indexOfLine => super::index_of_line,
        BunObject_callback_inflateSync => JSZlib::inflate_sync,
        BunObject_callback_jest => Jest::call,
        BunObject_callback_listen => super::static_adapters::listener_listen,
        BunObject_callback_mmap => super::mmap_file,
        BunObject_callback_nanoseconds => super::nanoseconds,
        BunObject_callback_openInEditor => super::open_in_editor,
        BunObject_callback_registerMacro => super::register_macro,
        BunObject_callback_resolve => super::resolve,
        BunObject_callback_resolveSync => super::resolve_sync,
        BunObject_callback_serve => super::serve,
        BunObject_callback_sha => super::static_adapters::sha,
        BunObject_callback_shellEscape => super::shell_escape,
        BunObject_callback_shrink => super::shrink,
        BunObject_callback_stringWidth => super::string_width,
        BunObject_callback_sleepSync => super::sleep_sync,
        BunObject_callback_spawn => super::static_adapters::subprocess_spawn,
        BunObject_callback_spawnSync => super::static_adapters::subprocess_spawn_sync,
        BunObject_callback_udpSocket => super::static_adapters::udp_socket,
        BunObject_callback_which => super::which,
        BunObject_callback_write => crate::webcore::blob::write_file,
        BunObject_callback_zstdCompressSync => JSZstd::compress_sync,
        BunObject_callback_zstdDecompressSync => JSZstd::decompress_sync,
        BunObject_callback_zstdCompress => JSZstd::compress,
        BunObject_callback_zstdDecompress => JSZstd::decompress,
    }
    // --- Callbacks ---

    // --- Lazy property callbacks ---
    export_lazy_prop_callbacks! {
        BunObject_lazyPropCb_Archive => super::get_archive_constructor,
        BunObject_lazyPropCb_CryptoHasher => Crypto::CryptoHasher::getter,
        BunObject_lazyPropCb_CSRF => super::get_csrf_object,
        BunObject_lazyPropCb_FFI => crate::ffi::ffi_object_draft::getter,
        BunObject_lazyPropCb_FileSystemRouter => super::get_file_system_router,
        BunObject_lazyPropCb_Glob => super::get_glob_constructor,
        BunObject_lazyPropCb_Image => super::get_image_constructor,
        BunObject_lazyPropCb_MD4 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_MD5 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA1 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA224 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA256 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA384 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA512 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_SHA512_256 => super::static_adapters::static_hasher_getter,
        BunObject_lazyPropCb_JSONC => super::get_jsonc_object,
        BunObject_lazyPropCb_markdown => super::get_markdown_object,
        BunObject_lazyPropCb_TOML => super::get_toml_object,
        BunObject_lazyPropCb_JSON5 => super::get_json5_object,
        BunObject_lazyPropCb_YAML => super::get_yaml_object,
        BunObject_lazyPropCb_Transpiler => super::get_transpiler_constructor,
        BunObject_lazyPropCb_argv => super::get_argv,
        BunObject_lazyPropCb_cron => super::get_cron_object,
        BunObject_lazyPropCb_cwd => super::get_cwd,
        BunObject_lazyPropCb_embeddedFiles => super::get_embedded_files,
        BunObject_lazyPropCb_enableANSIColors => super::enable_ansi_colors,
        BunObject_lazyPropCb_hash => super::get_hash_object,
        BunObject_lazyPropCb_inspect => super::get_inspect,
        BunObject_lazyPropCb_origin => super::get_origin,
        BunObject_lazyPropCb_semver => super::get_semver,
        BunObject_lazyPropCb_unsafe => super::get_unsafe,
        BunObject_lazyPropCb_S3Client => super::get_s3_client_constructor,
        BunObject_lazyPropCb_s3 => super::get_s3_default_client,
        BunObject_lazyPropCb_ValkeyClient => super::get_valkey_client_constructor,
        BunObject_lazyPropCb_valkey => super::get_valkey_default_client,
        BunObject_lazyPropCb_Terminal => super::get_terminal_constructor,
    }
    // --- Lazy property callbacks ---

    // --- Getters ---
    pub use super::get_main as main;
    // --- Getters ---

    // --- Setters ---
    pub use super::set_main;
    // --- Setters ---

    // PORT NOTE: Zig's `lazyPropertyCallbackName`/`callbackName` were comptime
    // string concats used only at `comptime @export` sites. The export names
    // are now spelled out verbatim in the `export_*!` macro invocations above,
    // so the runtime variant just leaks the formatted name (no callers on the
    // hot path).
    pub fn lazy_property_callback_name(base_name: &str) -> &'static str {
        Box::leak(format!("BunObject_lazyPropCb_{base_name}").into_boxed_str())
    }

    pub fn callback_name(base_name: &str) -> &'static str {
        Box::leak(format!("BunObject_callback_{base_name}").into_boxed_str())
    }

    // type LazyPropertyCallback = extern "C" fn(*mut JSGlobalObject, *mut JSObject) -> JSValue
    // (the `callconv(jsc.conv)` ABI is emitted by `#[bun_jsc::host_fn]` / the macro above;
    // see PORTING.md §FFI — cannot write `extern jsc_conv!()` in Rust.)

    // --- LazyProperty initializers ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStdin(g: *mut JSGlobalObject) -> JSValue {
        // SAFETY: JSC always passes a valid global.
        unsafe { super::create_bun_stdin(&*g) }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStderr(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::create_bun_stderr(&*g) }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStdout(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::create_bun_stdout(&*g) }
    }
    // --- LazyProperty initializers ---

    // --- Getters ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject_getter_main(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::get_main(&*g) }
    }
    // --- Getters ---

    // --- Setters ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject_setter_main(g: *mut JSGlobalObject, v: JSValue) -> bool {
        unsafe { super::set_main(&*g, v) }
    }
    // --- Setters ---
}

pub fn get_cron_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: crate::api::cron::get_cron_object (gated under private _jsc_gated)")
}

#[bun_jsc::host_fn]
pub fn shell_escape(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    use bun_jsc::StringJsc as _;
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_this.throw("shell escape expected at least 1 argument"));
    }

    let jsval = arguments.ptr[0];
    let bunstr = jsval.to_bun_string(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }
    // bunstr derefs on Drop

    let mut outbuf: Vec<u8> = Vec::new();

    if bun_shell_parser::needs_escape_bunstr(bunstr) {
        let result = bun_shell_parser::escape_bun_str::<true>(bunstr, &mut outbuf)?;
        if !result {
            return Err(global_this.throw(format_args!(
                "String has invalid utf-16: {}",
                bstr::BStr::new(bunstr.byte_slice()),
            )));
        }
        let mut str = BunString::clone_utf8(&outbuf[..]);
        return str.transfer_to_js(global_this);
    }

    Ok(jsval)
}

pub fn braces(
    global: &JSGlobalObject,
    brace_str: BunString,
    opts: r#gen::BracesOptions,
) -> JsResult<JSValue> {
    let brace_slice = brace_str.to_utf8();

    // PERF(port): was arena bulk-free — profile in Phase B
    let mut arena = bun_alloc::Arena::new();
    let _ = &mut arena;

    let mut lexer_output = 'lexer_output: {
        if strings::is_all_ascii(brace_slice.slice()) {
            break 'lexer_output match Braces::Lexer::tokenize(brace_slice.slice()) {
                Ok(v) => v,
                Err(err) => return Err(global.throw_error(err.into(), "failed to tokenize braces")),
            };
        }

        match Braces::NewLexer::<{ Braces::StringEncoding::Wtf8 }>::tokenize(brace_slice.slice())
        {
            Ok(v) => break 'lexer_output v,
            Err(err) => return Err(global.throw_error(err.into(), "failed to tokenize braces")),
        }
    };

    let expansion_count = Braces::calculate_expanded_amount(&lexer_output.tokens[..]);

    if opts.tokenize {
        // TODO(port): std.json.fmt — need a JSON `Display` for the token list
        let _ = &lexer_output.tokens[..];
        todo!("blocked_on: std.json.fmt port (JSON Display for braces tokens)");
    }
    if opts.parse {
        let mut parser = Braces::Parser::init(&lexer_output.tokens[..], &arena);
        let ast_node = match parser.parse() {
            Ok(v) => v,
            Err(err) => return Err(global.throw_error(err.into(), "failed to parse braces")),
        };
        // TODO(port): std.json.fmt — bun_json crate not yet ported
        let str: Vec<u8> = {
            let _ = &ast_node;
            todo!("blocked_on: bun_json::fmt")
        };
        let bun_str = BunString::from_bytes(&str);
        return bun_str.to_js(global);
    }

    if expansion_count == 0 {
        return bun_string_to_js_array(global, &[brace_str]);
    }

    // Non-AST crate: result containers use plain Vec (arena is only for Braces::* internals).
    let expansion_count = expansion_count as usize;
    let mut expanded_strings: Vec<Vec<u8>> = Vec::with_capacity(expansion_count);
    for _ in 0..expansion_count {
        expanded_strings.push(Vec::new());
    }

    match Braces::expand(
        &arena,
        &mut lexer_output.tokens[..],
        &mut expanded_strings,
        lexer_output.contains_nested,
    ) {
        Ok(()) => {}
        Err(_) => {
            return Err(
                global.throw_pretty("Unexpected token while expanding braces", format_args!("")),
            )
        }
    }

    let mut out_strings: Vec<BunString> = Vec::with_capacity(expansion_count);
    for i in 0..expansion_count {
        out_strings.push(BunString::from_bytes(&expanded_strings[i][..]));
    }

    bun_string_to_js_array(global, &out_strings[..])
}

#[bun_jsc::host_fn]
pub fn which(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let mut path_buf = bun_paths::path_buffer_pool::get();
    // SAFETY: bun_vm() returns the live per-thread singleton VM for a Bun-owned global.
    let vm = unsafe { &*global_this.bun_vm() };
    let mut arguments = ArgumentsSlice::init(vm, arguments_.slice());
    let Some(path_arg) = arguments.next_eat() else {
        return Err(global_this.throw("which: expected 1 argument, got 0"));
    };

    let mut path_str = ZigStringSlice::EMPTY;
    let mut bin_str = ZigStringSlice::EMPTY;
    let mut cwd_str = ZigStringSlice::EMPTY;
    // path_str / bin_str / cwd_str deinit on Drop

    if path_arg.is_empty_or_undefined_or_null() {
        return Ok(JSValue::NULL);
    }

    bin_str = path_arg.to_slice(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if bin_str.slice().len() >= MAX_PATH_BYTES {
        return Err(global_this.throw("bin path is too long"));
    }

    if bin_str.slice().is_empty() {
        return Ok(JSValue::NULL);
    }

    // SAFETY: `transpiler.env` / `.fs` are process-lifetime singletons set during VM init.
    path_str = ZigStringSlice::from_utf8_never_free(
        unsafe { &*vm.transpiler.env }.get(b"PATH").unwrap_or(b""),
    );
    cwd_str = ZigStringSlice::from_utf8_never_free(
        unsafe { &*vm.transpiler.fs }.top_level_dir,
    );

    if let Some(arg) = arguments.next_eat() {
        if !arg.is_empty_or_undefined_or_null() && arg.is_object() {
            if let Some(str_) = arg.get(global_this, "PATH")? {
                path_str = str_.to_slice(global_this)?;
            }

            if let Some(str_) = arg.get(global_this, "cwd")? {
                cwd_str = str_.to_slice(global_this)?;
            }
        }
    }

    if let Some(bin_path) =
        bun_which::which(&mut *path_buf, path_str.slice(), cwd_str.slice(), bin_str.slice())
    {
        return Ok(ZigString::init(bin_path).with_encoding().to_js(global_this));
    }

    Ok(JSValue::NULL)
}

#[bun_jsc::host_fn]
pub fn inspect_table(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut args_buf = callframe.arguments_undef::<5>();
    let all_arguments = args_buf.mut_();
    if all_arguments[0].is_undefined_or_null() || !all_arguments[0].is_object() {
        return BunString::empty().to_js(global_this);
    }

    // PORT NOTE: protect/unprotect over a copied [JSValue; 5]; the borrow of
    // `all_arguments` cannot escape into the scopeguard closure, so copy out.
    let prot: [JSValue; 5] = core::array::from_fn(|i| all_arguments[i]);
    for arg in prot.iter() {
        arg.protect();
    }
    let _unprotect = scopeguard::guard(prot, |prot| {
        for arg in prot.iter() {
            arg.unprotect();
        }
    });

    let arguments = &mut all_arguments[..];
    let value = arguments[0];

    if !arguments[1].is_array() {
        arguments[2] = arguments[1];
        arguments[1] = JSValue::UNDEFINED;
    }

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        flush: false,
        max_depth: 5,
        quote_strings: true,
        ordered_properties: false,
        single_line: true,
        ..Default::default()
    };
    if arguments[2].is_object() {
        format_options.from_js(global_this, &arguments[2..])?;
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let properties: JSValue = if arguments[1].js_type().is_array() {
        arguments[1]
    } else {
        JSValue::UNDEFINED
    };
    let mut table_printer =
        ConsoleObject::TablePrinter::init(global_this, ConsoleObject::MessageLevel::Log, value, properties)?;
    // TODO(port): `TablePrinter.value_formatter` is private upstream
    // (`bun_jsc::console_object`); depth/ordered/single_line are seeded by
    // `TablePrinter::init` itself. Revisit once a setter lands.
    let _ = (
        format_options.max_depth,
        format_options.ordered_properties,
        format_options.single_line,
    );

    let print_result = if format_options.enable_colors {
        table_printer.print_table::<true>(&mut array)
    } else {
        table_printer.print_table::<false>(&mut array)
    };
    if print_result.is_err() {
        if !global_this.has_exception() {
            return Err(global_this.throw_out_of_memory());
        }
        return Ok(JSValue::ZERO);
    }

    // writer.flush(): Vec<u8> writer is unbuffered; nothing to flush.

    bun_string_jsc::create_utf8_for_js(global_this, &array)
}

#[bun_jsc::host_fn]
pub fn inspect(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args_buf = callframe.arguments_old::<4>();
    let arguments = args_buf.slice();
    if arguments.is_empty() {
        return BunString::empty().to_js(global_this);
    }

    for arg in arguments {
        arg.protect();
    }
    let prot: Vec<JSValue> = arguments.to_vec();
    let _unprotect = scopeguard::guard(prot, |prot| {
        for arg in prot.iter() {
            arg.unprotect();
        }
    });

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        flush: false,
        max_depth: 8,
        quote_strings: true,
        ordered_properties: false,
        ..Default::default()
    };
    if arguments.len() > 1 {
        format_options.from_js(global_this, &arguments[1..])?;
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
        global_this,
        arguments.as_ptr(),
        1,
        &mut array,
        format_options,
    )?;
    if global_this.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    // writer.flush(): Vec<u8> is unbuffered.

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    let out = ZigString::init(&array).with_encoding();
    let ret = out.to_js(global_this);

    Ok(ret)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__inspect(global_this: *mut JSGlobalObject, value: JSValue) -> BunString {
    // SAFETY: caller is C++ passing a live global.
    let global_this = unsafe { &*global_this };
    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let mut formatter = ConsoleObject::Formatter::new(global_this);
    if write!(&mut array, "{}", value.to_fmt(&mut formatter)).is_err() {
        return BunString::empty();
    }
    BunString::clone_utf8(&array)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__inspect_singleline(
    global_this: *mut JSGlobalObject,
    value: JSValue,
) -> BunString {
    // SAFETY: caller is C++ passing a live global.
    let global_this = unsafe { &*global_this };
    let mut array: Vec<u8> = Vec::new();
    if ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
        global_this,
        core::slice::from_ref(&value).as_ptr(),
        1,
        &mut array,
        ConsoleObject::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            max_depth: u16::MAX,
            quote_strings: true,
            ordered_properties: false,
            single_line: true,
            ..Default::default()
        },
    )
    .is_err()
    {
        return BunString::empty();
    }
    if global_this.has_exception() {
        return BunString::empty();
    }
    BunString::clone_utf8(&array)
}

pub fn get_inspect(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    let fun = JSFunction::create(global_object, "inspect", __jsc_host_inspect, 2, Default::default());
    let mut str = bun_str::ZigString::init(b"nodejs.util.inspect.custom");
    fun.put(
        global_object,
        b"custom",
        JSValue::symbol_for(global_object, &mut str),
    );
    fun.put(
        global_object,
        b"table",
        JSFunction::create(global_object, "table", __jsc_host_inspect_table, 3, Default::default()),
    );
    fun
}

#[bun_jsc::host_fn]
pub fn register_macro(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.len() != 2 || !arguments[0].is_number() {
        return Err(global_object
            .throw_invalid_arguments("Internal error registering macros: invalid args"));
    }
    let id = arguments[0].to_int32();
    if id == -1 || id == 0 {
        return Err(global_object
            .throw_invalid_arguments("Internal error registering macros: invalid id"));
    }

    if !arguments[1].is_cell() || !arguments[1].is_callable() {
        // TODO: add "toTypeOf" helper
        return Err(global_object.throw("Macro must be a function"));
    }

    // SAFETY: VirtualMachine::get() returns the live per-thread singleton.
    let get_or_put_result = unsafe { &mut *VirtualMachine::get() }
        .macros
        .get_or_put(id)
        .expect("unreachable");
    if get_or_put_result.found_existing {
        // `value_ptr` is `&mut JSObjectRef` (`*mut OpaqueJSValue`); recover the
        // protected JSValue and unprotect it before overwriting.
        JSValue::c(*get_or_put_result.value_ptr).unprotect();
    }

    arguments[1].protect();
    *get_or_put_result.value_ptr = arguments[1].as_object_ref();

    Ok(JSValue::UNDEFINED)
}

pub fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: VirtualMachine::get() returns the live per-thread singleton; `fs` is
    // the process-lifetime resolver FileSystem singleton.
    ZigString::init(unsafe { (*(*VirtualMachine::get()).transpiler.fs).top_level_dir })
        .to_js(global_this)
}

pub fn get_origin(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: VirtualMachine::get() returns the live per-thread singleton.
    ZigString::init(unsafe { &*VirtualMachine::get() }.origin.origin).to_js(global_this)
}

pub fn enable_ansi_colors(_global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::from(Output::enable_ansi_colors_stdout() || Output::enable_ansi_colors_stderr())
}

// callconv(jsc.conv) — emitted by #[bun_jsc::host_call]; see PORTING.md §FFI.
pub fn get_main(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the live singleton VirtualMachine for a Bun-owned global.
    let vm = unsafe { &mut *global_this.bun_vm() };
    // If JS has set it to a custom value, use that one
    if let Some(overridden_main) = vm.overridden_main.get() {
        return overridden_main;
    }

    // Attempt to use the resolved filesystem path
    // This makes `eval('require.main === module')` work when the main module is a symlink.
    // This behavior differs slightly from Node. Node sets the `id` to `.` when the main module is a symlink.
    'use_resolved_path: {
        if vm.main_resolved_path.is_empty() {
            // If it's from eval, don't try to resolve it.
            if strings::ends_with(vm.main, b"[eval]") {
                break 'use_resolved_path;
            }
            if strings::ends_with(vm.main, b"[stdin]") {
                break 'use_resolved_path;
            }

            let Ok(fd) = sys::openat_a(
                if cfg!(windows) { Fd::INVALID } else { Fd::cwd() },
                vm.main,
                // Open with the minimum permissions necessary for resolving the file path.
                if cfg!(target_os = "linux") {
                    sys::O::PATH
                } else {
                    sys::O::RDONLY
                },
                0,
            ) else {
                break 'use_resolved_path;
            };

            let _close = scopeguard::guard(fd, |fd: Fd| fd.close());
            #[cfg(windows)]
            {
                let mut wpath = WPathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path_w(fd, &mut wpath) else {
                    break 'use_resolved_path;
                };
                vm.main_resolved_path = BunString::clone_utf16(fdpath);
            }
            #[cfg(not(windows))]
            {
                let mut path = PathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path(fd, &mut path) else {
                    break 'use_resolved_path;
                };

                // Bun.main === otherId will be compared many times, so let's try to create an atom string if we can.
                if let Some(atom) = BunString::try_create_atom(fdpath) {
                    vm.main_resolved_path = atom;
                } else {
                    vm.main_resolved_path = BunString::clone_utf8(fdpath);
                }
            }
        }

        return vm
            .main_resolved_path
            .to_js(global_this)
            .unwrap_or(JSValue::ZERO);
    }

    ZigString::init(vm.main).to_js(global_this)
}

pub fn set_main(global_this: &JSGlobalObject, new_value: JSValue) -> bool {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    unsafe { &mut *global_this.bun_vm() }
        .overridden_main
        .set(global_this, new_value);
    true
}

pub fn get_argv(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    node::process::get_argv(global_this)
}

#[bun_jsc::host_fn]
pub fn open_in_editor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // `RareData::editor_context` is a `high_tier::EditorContext` opaque stub in
    // `bun_jsc::rare_data`; the real `crate::cli::open::EditorContext` (with
    // `name`/`path`/`editor` fields and `detect_editor`) cannot be reached
    // through `RareData` until the cycle-break vtable lands. Parse args for
    // side-effect validation, then bail.
    let args = callframe.arguments_old::<4>();
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = unsafe { &*global_this.bun_vm() };
    let mut arguments = ArgumentsSlice::init(vm, args.slice());
    let mut path = ZigStringSlice::EMPTY;
    let mut _editor_choice: Option<Editor> = None;
    let mut line = ZigStringSlice::EMPTY;
    let mut column = ZigStringSlice::EMPTY;

    if let Some(file_path_) = arguments.next_eat() {
        path = file_path_.to_slice(global_this)?;
    }

    if let Some(opts) = arguments.next_eat() {
        if !opts.is_undefined_or_null() {
            if let Some(editor_val) = opts.get_truthy(global_this, "editor")? {
                let _sliced = editor_val.to_slice(global_this)?;
                // TODO(port): edit.name/detect_editor — blocked on
                // `bun_jsc::rare_data::EditorContext` being the real
                // `crate::cli::open::EditorContext`.
            }

            if let Some(line_) = opts.get_truthy(global_this, "line")? {
                line = line_.to_slice(global_this)?;
            }

            if let Some(column_) = opts.get_truthy(global_this, "column")? {
                column = column_.to_slice(global_this)?;
            }
        }
    }

    if path.slice().is_empty() {
        return Err(global_this.throw("No file path specified"));
    }

    let _ = (line, column);
    todo!("blocked_on: bun_jsc::rare_data::EditorContext (high_tier opaque stub)")
}

pub fn get_public_path(to: &[u8], origin: URL, writer: &mut (impl bun_io::Write + ?Sized)) {
    get_public_path_with_asset_prefix(
        to,
        // SAFETY: VirtualMachine::get() returns the live per-thread singleton; `fs` is
        // the process-lifetime resolver FileSystem singleton.
        unsafe { (*(*VirtualMachine::get()).transpiler.fs).top_level_dir },
        origin,
        b"",
        writer,
        path::Platform::Loose,
    )
}

pub fn get_public_path_with_asset_prefix(
    to: &[u8],
    dir: &[u8],
    origin: URL,
    asset_prefix: &[u8],
    writer: &mut (impl bun_io::Write + ?Sized),
    platform: path::Platform,
) {
    // TODO(port): `comptime platform` was a const-generic in Zig; demoted to runtime arg.
    // PERF(port): was comptime monomorphization — profile in Phase B
    let _ = platform;
    let relative_path = if strings::has_prefix(to, dir) {
        strings::without_trailing_slash(&to[dir.len()..])
    } else {
        // PORT NOTE: `FileSystem::relative_platform` is not yet on the
        // upstream `bun_bundler::bun_fs::FileSystem`; fall through to the
        // stateless `bun_paths::relative` (matches the un-gated impl above).
        bun_paths::resolve_path::relative(dir, to)
    };
    if origin.is_absolute() {
        if strings::has_prefix(relative_path, b"..") || strings::has_prefix(relative_path, b"./") {
            if writer.write_all(origin.origin).is_err() {
                return;
            }
            if writer.write_all(b"/abs:").is_err() {
                return;
            }
            if bun_paths::is_absolute(to) {
                let _ = writer.write_all(to);
            } else {
                // SAFETY: `transpiler.fs` is the process-lifetime resolver singleton.
                let fs = unsafe { &*(*VirtualMachine::get()).transpiler.fs };
                let _ = writer.write_all(fs.abs(&[to]));
            }
        } else {
            // PORT NOTE: `URL::join_write` is generic over `bun_url::bun_io::Write`
            // (a re-exported copy that doesn't unify with the caller's
            // `bun_io::Write` bound). Route through a local Vec, then forward.
            let mut buf: Vec<u8> = Vec::new();
            let _ = origin.join_write(&mut buf, asset_prefix, b"", relative_path, b"");
            let _ = writer.write_all(&buf);
        }
    } else {
        let _ = writer.write_all(strings::trim_left(relative_path, b"/"));
    }
}

#[bun_jsc::host_fn]
pub fn sleep_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("sleepSync", 1, 0));
    }
    let arg = arguments.slice()[0];

    // The argument must be a number
    if !arg.is_number() {
        return Err(global_object.throw_invalid_argument_type("sleepSync", "milliseconds", "number"));
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    let milliseconds = arg.coerce::<i32>(global_object)?;
    if milliseconds < 0 {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "argument to sleepSync must not be negative, got {milliseconds}"
        )));
    }

    // TODO(port): std.Thread.sleep — bun owns its own sleep; using thread::sleep
    // here matches Zig's blocking semantics (this is a sync API).
    std::thread::sleep(core::time::Duration::from_millis(
        u64::try_from(milliseconds).unwrap(),
    ));
    Ok(JSValue::UNDEFINED)
}

pub use Bun__gc as gc;
#[unsafe(no_mangle)]
pub extern "C" fn Bun__gc(vm: *mut VirtualMachine, sync: bool) -> usize {
    // SAFETY: caller is C++ passing a live VM.
    unsafe { (*vm).garbage_collect(sync) }
}

#[bun_jsc::host_fn]
pub fn shrink(global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: `bun_jsc::VM` (the lib.rs opaque stub) lacks `shrink_footprint`;
    // the real impl lives in the gated `bun_jsc::vm` module. Call the C++ symbol
    // directly (matches src/jsc/VM.rs:125). Signature matches the other extern
    // decl in this file to satisfy `clashing_extern_declarations`.
    unsafe extern "C" {
        fn JSC__VM__shrinkFootprint(vm: *mut core::ffi::c_void);
    }
    // SAFETY: `global_object.vm()` returns a live JSC VM; FFI has no extra preconditions.
    unsafe { JSC__VM__shrinkFootprint((global_object.vm() as *const jsc::VM as *mut jsc::VM).cast()) };
    Ok(JSValue::UNDEFINED)
}

fn do_resolve(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = unsafe { &*global_this.bun_vm() };
    let mut args = ArgumentsSlice::init(vm, arguments);
    let Some(specifier) = args.protect_eat_next() else {
        return Err(global_this
            .throw_invalid_arguments("Expected a specifier and a from path"));
    };

    if specifier.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments("specifier must be a string"));
    }

    let Some(from) = args.protect_eat_next() else {
        return Err(global_this.throw_invalid_arguments("Expected a from path"));
    };

    if from.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments("from must be a string"));
    }

    let mut is_esm = true;
    if let Some(next) = args.next_eat() {
        if next.is_boolean() {
            is_esm = next.to_boolean();
        } else {
            return Err(global_this.throw_invalid_arguments("esm must be a boolean"));
        }
    }

    let specifier_str = specifier.to_bun_string(global_this)?;
    let from_str = from.to_bun_string(global_this)?;
    do_resolve_with_args::<false>(global_this, specifier_str, from_str, is_esm, false)
}

fn do_resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: BunString,
    from: BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JsResult<JSValue> {
    let mut errorable: ErrorableString = ErrorableString::ok(BunString::empty());
    let mut query_string = BunString::empty();
    // query_string derefs on Drop

    let specifier_decoded = if strings::has_prefix(specifier.byte_slice(), b"file://") {
        jsc::URL::path_from_file_url(specifier)
    } else {
        specifier.dupe_ref()
    };
    // specifier_decoded derefs on Drop

    VirtualMachine::resolve_maybe_needs_trailing_slash::<IS_FILE_PATH>(
        &mut errorable,
        ctx,
        specifier_decoded,
        from,
        Some(&mut query_string),
        is_esm,
        is_user_require_resolve,
    )?;

    if !errorable.success {
        // SAFETY: !success → `err` arm of the #[repr(C)] union is active.
        return Err(ctx.throw_value(unsafe { errorable.result.err }.value));
    }
    // errorable.result.value derefs on Drop (TODO(port): confirm ErrorableString Drop semantics)

    if !query_string.is_empty() {
        // PERF(port): was stack-fallback
        let mut arraylist: Vec<u8> = Vec::with_capacity(1024);
        // SAFETY: success → `value` arm of the #[repr(C)] union is active.
        let value = unsafe { errorable.result.value };
        // Vec<u8> writes are infallible.
        let _ = write!(&mut arraylist, "{}{}", value, query_string);

        return Ok(ZigString::init_utf8(&arraylist).to_js(ctx));
    }

    // SAFETY: success → `value` arm of the #[repr(C)] union is active.
    unsafe { errorable.result.value }.to_js(ctx)
}

#[bun_jsc::host_fn]
pub fn resolve_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    do_resolve(global_object, callframe.arguments())
}

#[bun_jsc::host_fn]
pub fn resolve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    let value = match do_resolve(global_object, arguments.slice()) {
        Ok(v) => v,
        Err(e) => {
            let err = global_object.take_error(e);
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_object,
                    err,
                ),
            );
        }
    };
    Ok(JSPromise::resolved_promise_value(global_object, value))
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolve(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global.
    let global = unsafe { &*global };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    let value = match do_resolve_with_args::<true>(global, specifier_str, source_str, is_esm, false)
    {
        Ok(v) => v,
        Err(_) => {
            let err = global.try_take_exception().unwrap();
            return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global, err,
            );
        }
    };

    JSPromise::resolved_promise_value(global, value)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSync(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global.
    let global = unsafe { &*global };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, format_args!("The argument 'id' must be a non-empty string. Received ''"))
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>(global, specifier_str, source_str, is_esm, is_user_require_resolve),
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithPaths(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
    paths_ptr: *const BunString,
    paths_len: usize,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global; paths_ptr is valid for paths_len.
    let global = unsafe { &*global };
    let paths: &[BunString] = if paths_len == 0 {
        &[]
    } else {
        unsafe { core::slice::from_raw_parts(paths_ptr, paths_len) }
    };

    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, format_args!("The argument 'id' must be a non-empty string. Received ''"))
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let bun_vm = unsafe { &mut *global.bun_vm() };
    debug_assert!(bun_vm.transpiler.resolver.custom_dir_paths.is_none());
    // SAFETY: `paths` borrows C++-owned BunStrings valid for the duration of
    // this synchronous resolve call; lifetime is erased for the resolver slot.
    bun_vm.transpiler.resolver.custom_dir_paths =
        Some(unsafe { core::mem::transmute::<&[BunString], &'static [BunString]>(paths) });
    let _reset = scopeguard::guard((), |_| {
        // SAFETY: same VM pointer; called before returning to C++.
        unsafe { (*global.bun_vm()).transpiler.resolver.custom_dir_paths = None };
    });

    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>(global, specifier_str, source_str, is_esm, is_user_require_resolve),
    )
}

bun_output::declare_scope!(importMetaResolve, visible);

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithStrings(
    global: *mut JSGlobalObject,
    specifier: *mut BunString,
    source: *mut BunString,
    is_esm: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing live pointers.
    let global = unsafe { &*global };
    let specifier = unsafe { &*specifier };
    let source = unsafe { &*source };
    bun_output::scoped_log!(importMetaResolve, "source: {}, specifier: {}", source, specifier);
    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>(global, *specifier, *source, is_esm, false),
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithSource(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: *mut BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing live pointers.
    let global = unsafe { &*global };
    let source = unsafe { &*source };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, format_args!("The argument 'id' must be a non-empty string. Received ''"))
            .throw();
        return JSValue::ZERO;
    }
    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>(global, specifier_str, *source, is_esm, is_user_require_resolve),
    )
}

#[bun_jsc::host_fn]
pub fn index_of_line(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.is_empty() {
        return Ok(JSValue::js_number_from_int32(-1));
    }

    let Some(buffer) = arguments[0].as_array_buffer(global_this) else {
        return Ok(JSValue::js_number_from_int32(-1));
    };

    let mut offset: usize = 0;
    if arguments.len() > 1 {
        let offset_value = arguments[1].coerce_to_int64(global_this)?;
        offset = offset_value.max(0) as usize;
    }

    let bytes = buffer.byte_slice();
    let mut current_offset = offset;
    let end = bytes.len() as u32;

    while current_offset < end as usize {
        if let Some(i) = strings::index_of_newline_or_non_ascii(bytes, current_offset as u32) {
            let byte = bytes[i as usize];
            if byte > 0x7F {
                current_offset += (strings::wtf8_byte_sequence_length(byte) as usize).max(1);
                continue;
            }

            if byte == b'\n' {
                return Ok(JSValue::js_number(i as f64));
            }

            current_offset = i as usize + 1;
        } else {
            break;
        }
    }

    Ok(JSValue::js_number_from_int32(-1))
}

pub use crate::crypto as crypto_mod;
// TODO(port): `pub const Crypto = @import("../crypto/crypto.zig");` re-exports
// the crypto module under this file's namespace; in Rust the canonical path is
// `crate::crypto`.

#[bun_jsc::host_fn]
pub fn nanoseconds(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let ns = unsafe { (*global_this.bun_vm()).origin_timer.elapsed().as_nanos() as u64 };
    Ok(JSValue::js_number_from_uint64(ns))
}

#[bun_jsc::host_fn]
pub fn serve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<2>();
    let arguments = arguments.slice();
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = unsafe { &mut *global_object.bun_vm() };
    let mut config: crate::server::ServerConfig = 'brk: {
        let mut args = ArgumentsSlice::init(vm, arguments);

        let config = crate::server::ServerConfig::from_js(
            global_object,
            &mut args,
            crate::server::server_config::_gated_from_js::FromJSOptions {
                allow_bake_config: bun_core::FeatureFlags::bake(),
                is_fetch_required: true,
                has_user_routes: false,
            },
        )?;

        if global_object.has_exception() {
            drop(config);
            return Ok(JSValue::ZERO);
        }

        break 'brk config;
    };

    // SAFETY: same VM pointer; re-borrow after `args` is dropped.
    let vm = unsafe { &mut *global_object.bun_vm() };

    if config.allow_hot {
        if let Some(hot) = vm.hot_map() {
            if config.id.is_empty() {
                config.id = config.compute_id().into();
            }

            if let Some(_entry) = hot.get_entry(&config.id) {
                // TODO(port): Zig used `@field(@TypeOf(entry.tag()), @typeName(Type))`
                // to dispatch on the TaggedPtrUnion tag. The un-gated `HotMapEntry`
                // is currently an erased `(tag: u8, ptr: *mut ())` placeholder
                // (see rare_data.rs); typed `tag()/as_<T>()` are gated until the
                // high-tier `TaggedPtrUnion` payload list lands.
                let _ = &mut config;
                todo!("blocked_on: jsc::rare_data::HotMapEntry typed tag()/as_<T>() (TaggedPtrUnion)");
            }
        }
    }

    macro_rules! serve_with {
        ($ServerType:ty) => {{
            let server = <$ServerType>::init(&mut config, global_object)?;
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            // TODO(port): the rest of this body needs:
            //   - `<$ServerType>::js::route_list_set_cached` (codegen `.classes.ts` output)
            //   - typed `HotMap::insert<T>` (gated TaggedPtrUnion)
            //   - `bun_jsc::api::AnyServer` for `Debugger.http_server_agent`
            // none of which are available at this tier yet.
            let _ = (server, vm);
            todo!("blocked_on: server::js::route_list_set_cached + bun_jsc::api::AnyServer")
        }};
    }

    // PORT NOTE: Zig used nested `switch (bool) { inline else => |c| ... }` to
    // monomorphize over (has_ssl_config, development). Expanded here.
    let has_ssl_config = config.ssl_config.is_some();
    let development = config.is_development();
    match (development, has_ssl_config) {
        (true, true) => serve_with!(crate::api::DebugHTTPSServer),
        (true, false) => serve_with!(crate::api::DebugHTTPServer),
        (false, true) => serve_with!(crate::api::HTTPSServer),
        (false, false) => serve_with!(crate::api::HTTPServer),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML16(
    global_object: *mut JSGlobalObject,
    input_value: JSValue,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid global and a valid [ptr, len) UTF-16 slice.
    let global_object = unsafe { &*global_object };
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    use bun_str::immutable::escape_html::{escape_html_for_utf16_input, Escaped};
    let escaped = match escape_html_for_utf16_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        Escaped::Static(val) => ZigString::init(val).to_js(global_object),
        Escaped::Original => input_value,
        Escaped::Allocated(escaped_html) => {
            // SAFETY: ownership of `escaped_html`'s buffer transfers to JSC via
            // the external-string finalizer; do not drop it here.
            let (ptr, len) = (escaped_html.as_ptr(), escaped_html.len());
            core::mem::forget(escaped_html);
            unsafe { ZigString__toExternalU16(ptr, len, global_object) }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML8(
    global_object: *mut JSGlobalObject,
    input_value: JSValue,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid global and a valid [ptr, len) byte slice.
    let global_object = unsafe { &*global_object };
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    // PERF(port): was stack-fallback (256 bytes) — profile in Phase B

    use bun_str::immutable::escape_html::{escape_html_for_latin1_input, Escaped};
    let escaped = match escape_html_for_latin1_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        Escaped::Static(val) => ZigString::init(val).to_js(global_object),
        Escaped::Original => input_value,
        Escaped::Allocated(escaped_html) => {
            if cfg!(debug_assertions) {
                // the output should always be longer than the input
                debug_assert!(escaped_html.len() > input_slice.len());

                // assert we do not allocate a new string unnecessarily
                debug_assert!(input_slice != &escaped_html[..]);
            }

            if input_slice.len() <= 32 {
                let zig_str = ZigString::init(&escaped_html);
                let out = zig_str.to_atomic_value(global_object);
                return out;
            }

            // SAFETY: ownership of `escaped_html` transfers to JSC's
            // external-string finalizer (mimalloc-backed); do not drop here.
            let leaked: &'static [u8] = Box::leak(escaped_html);
            ZigString::init(leaked).to_external_value(global_object)
        }
    }
}

#[bun_jsc::host_fn]
pub fn alloc_unsafe(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    let size = arguments.ptr[0];
    // SAFETY: pure FFI predicate; C++ handles any tagged JSValue.
    if !unsafe { super::JSC__JSValue__isUInt32AsAnyInt(size) } {
        return Err(global_this.throw_invalid_arguments("Expected a positive number"));
    }
    // SAFETY: `size` encodes a non-negative integer (checked above); `global_this` is live.
    Ok(unsafe {
        super::JSC__JSValue__createUninitializedUint8Array(
            global_this,
            super::JSC__JSValue__toUInt64NoTruncate(size) as usize,
        )
    })
}

#[bun_jsc::host_fn]
pub fn mmap_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        return global_this.throw_todo("mmapFile is not supported on Windows");
    }

    #[cfg(not(windows))]
    {
        let arguments_ = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
        let vm = unsafe { &*global_this.bun_vm() };
        let mut args = ArgumentsSlice::init(vm, arguments_.slice());

        let mut buf = PathBuffer::uninit();
        let path = 'brk: {
            if let Some(path) = args.next_eat() {
                if path.is_string() {
                    let path_str = path.to_slice(global_this)?;
                    if path_str.slice().len() > MAX_PATH_BYTES {
                        return Err(global_this
                            .throw_invalid_arguments("Path too long"));
                    }
                    let paths = &[path_str.slice()];
                    break 'brk bun_paths::resolve_path::join_abs_string_buf::<
                        bun_paths::resolve_path::platform::Auto,
                    >(
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
                        &mut buf,
                        paths,
                    );
                }
            }
            return Err(global_this.throw_invalid_arguments("Expected a path"));
        };

        let path_len = path.len();
        buf[path_len] = 0;

        // SAFETY: buf[path_len] == 0 written above
        let buf_z = unsafe { bun_str::ZStr::from_raw(buf.as_ptr(), path_len) };

        // PORT NOTE: Zig used `std.c.MAP{ .TYPE = .SHARED }` (a packed bitfield
        // struct). Rust libc exposes raw `MAP_*` ints; build the flag word
        // directly.
        let mut flags: libc::c_int = libc::MAP_SHARED;

        // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
        let mut offset: usize = 0;
        let mut map_size: Option<usize> = None;

        if let Some(opts) = args.next_eat() {
            flags = if opts.get_boolean_loose(global_this, "shared")?.unwrap_or(true) {
                libc::MAP_SHARED
            } else {
                libc::MAP_PRIVATE
            };

            // TODO(port): @hasField(std.c.MAP, "SYNC") — gated by target_os in Rust.
            #[cfg(target_os = "linux")]
            if opts.get_boolean_loose(global_this, "sync")?.unwrap_or(false) {
                flags = libc::MAP_SHARED_VALIDATE | libc::MAP_SYNC;
            }

            if let Some(value) = opts.get(global_this, "size")? {
                let size_value = value.coerce_to_int64(global_this)?;
                if size_value < 0 {
                    return Err(global_this.throw_invalid_arguments(
                        "size must be a non-negative integer",
                    ));
                }
                map_size = Some(usize::try_from(size_value).unwrap());
            }

            if let Some(value) = opts.get(global_this, "offset")? {
                let offset_value = value.coerce_to_int64(global_this)?;
                if offset_value < 0 {
                    return Err(global_this.throw_invalid_arguments(
                        "offset must be a non-negative integer",
                    ));
                }
                offset = usize::try_from(offset_value).unwrap();
                // std.mem.alignBackwardAnyAlign(usize, offset, pageSize())
                let page = bun_sys::page_size();
                offset -= offset % page;
            }
        }

        // TODO(port): `bun.sys.mmapFile` — `bun_sys::mmap_file` lives in
        // `src/sys/lib_draft_b1.rs` and is not yet re-exported from `bun_sys`.
        let _ = (buf_z, flags, map_size, offset);
        let map: &'static mut [u8] =
            todo!("blocked_on: bun_sys::mmap_file (lib_draft_b1.rs not re-exported)");

        extern "C" fn munmap_dealloc(ptr: *mut c_void, size: *mut c_void) {
            // SAFETY: ptr is the original mmap base, size is its length stuffed into a pointer.
            let _ = sys::munmap(ptr as *mut u8, size as usize);
        }

        jsc::array_buffer::make_typed_array_with_bytes_no_copy(
            global_this,
            jsc::TypedArrayType::TypeUint8,
            map.as_ptr() as *mut c_void,
            map.len(),
            Some(munmap_dealloc),
            map.len() as *mut c_void,
        )
    }
}

pub fn get_transpiler_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::js_transpiler::JSTranspiler>(global_this)
}

pub fn get_file_system_router(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: bun_jsc::JsClass for crate::api::filesystem_router::FileSystemRouter")
}

pub fn get_hash_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    HashObject::create(global_this)
}

pub fn get_jsonc_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: crate::api::jsonc_object::create (gated in _jsc_gated)")
}
pub fn get_markdown_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: crate::api::markdown_object::create (gated in _jsc_gated)")
}
pub fn get_toml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    TOMLObject::create(global_this)
}

pub fn get_json5_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSON5Object::create(global_this)
}

pub fn get_yaml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    YAMLObject::create(global_this)
}

pub fn get_archive_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::archive::Archive>(global_this)
}

pub fn get_glob_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: bun_jsc::JsClass for crate::api::glob::Glob")
}

pub fn get_image_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    // `crate::image` (mod.rs) keeps the `Image` body in a private `image_body` mod.
    todo!("blocked_on: crate::image::Image (image_body mod is private)")
}

pub fn get_s3_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: bun_jsc::JsClass for crate::webcore::s3_client::S3Client")
}

pub fn get_s3_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let _ = unsafe { (*global_this.bun_vm()).rare_data() };
    // RareData::s3_default_client(&mut self, &JSGlobalObject) lives in the
    // `#[cfg(any())] _accessor_body` block of `bun_jsc::rare_data`.
    todo!("blocked_on: bun_jsc::rare_data::RareData::s3_default_client (gated _accessor_body)")
}

pub fn get_tls_default_ciphers(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // PORT NOTE: Zig's `RareData.tlsDefaultCiphers()` already returns a
    // `jsc.JSValue`; the un-gated `bun_jsc::rare_data::RareData::
    // tls_default_ciphers()` currently returns `Option<&ZStr>`.
    let _ = global_this;
    todo!("blocked_on: bun_jsc::rare_data::RareData::tls_default_ciphers() -> JSValue")
}

pub fn set_tls_default_ciphers(
    global_this: &JSGlobalObject,
    _: &JSObject,
    ciphers: JSValue,
) -> JSValue {
    // PORT NOTE: Zig signature is `fn(..., ciphers: jsc.JSValue)`; the
    // un-gated `bun_jsc::rare_data::RareData::set_tls_default_ciphers()`
    // currently takes `&[u8]`.
    let _ = (global_this, ciphers);
    todo!("blocked_on: bun_jsc::rare_data::RareData::set_tls_default_ciphers(JSValue)")
}

pub fn get_valkey_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // `JSValkeyClient::create_no_js_no_pubsub` / `to_js` / `SubscriptionCtx::init`
    // live in the still-gated `valkey_jsc::js_valkey_body` (`.classes.ts`-driven).
    let _ = global_this;
    todo!("blocked_on: crate::valkey_jsc::JSValkeyClient::create_no_js_no_pubsub + SubscriptionCtx::init")
}

pub fn get_valkey_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: bun_jsc::JsClass for crate::valkey_jsc::JSValkeyClient")
}

pub fn get_terminal_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::bun_terminal_body::js::get_constructor(global_this)
}

pub fn get_embedded_files(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = unsafe { &*global_this.bun_vm() };
    let Some(_graph) = vm.standalone_module_graph else {
        return JSValue::create_empty_array(global_this, 0);
    };

    // `VirtualMachine.standalone_module_graph` is currently `Option<NonNull<c_void>>`
    // (erased to break a crate cycle), and `bun_standalone_graph::File::blob()` /
    // `WebCore::Blob::{new, dupe_with_content_type, name, to_js}` live behind the
    // gated `bun_webcore` surface. Body deferred until both are typed.
    todo!("blocked_on: bun_jsc::VirtualMachine.standalone_module_graph typed + bun_standalone_graph::File::blob + bun_jsc::WebCore::Blob::new")
}

pub fn get_semver(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let _ = global_this;
    todo!("blocked_on: bun_semver_jsc::SemverObject (crate not in bun_runtime deps)")
}

pub fn get_unsafe(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    UnsafeObject::create(global_this)
}

#[bun_jsc::host_fn]
pub fn string_width(global_object: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    // The real impl lives in `bun_jsc::bun_string_jsc::js_get_string_width`
    // (src/jsc/bun_string_jsc.rs:157) but that module is currently inside the
    // `#[cfg(any())] _gated` block of bun_jsc.
    let _ = (global_object, call_frame);
    todo!("blocked_on: bun_jsc::bun_string_jsc::js_get_string_width (gated)")
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
pub fn get_csrf_object(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    CSRFObject::create(global_object)
}

pub struct CSRFObject;

impl CSRFObject {
    pub fn create(global_this: &JSGlobalObject) -> JSValue {
        let object = JSValue::create_empty_object(global_this, 2);

        // PORT NOTE: `JSFunction::create` takes the raw C-ABI host fn pointer,
        // so wrap the safe Rust-style `JsResult` fns via `to_js_host_fn`-style
        // shims here.
        unsafe extern "C" fn csrf_generate_shim(
            g: *mut JSGlobalObject,
            f: *mut CallFrame,
        ) -> JSValue {
            bun_jsc::to_js_host_fn(csrf_jsc::csrf__generate)(g, f)
        }
        unsafe extern "C" fn csrf_verify_shim(
            g: *mut JSGlobalObject,
            f: *mut CallFrame,
        ) -> JSValue {
            bun_jsc::to_js_host_fn(csrf_jsc::csrf__verify)(g, f)
        }

        object.put(
            global_this,
            b"generate",
            JSFunction::create(global_this, "generate", csrf_generate_shim, 1, Default::default()),
        );

        object.put(
            global_this,
            b"verify",
            JSFunction::create(global_this, "verify", csrf_verify_shim, 1, Default::default()),
        );

        object
    }
}

// This is aliased to Bun.env
pub mod environment_variables {
    use super::*;

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvCount(
        global_object: *mut JSGlobalObject,
        ptr: *mut *mut &[u8],
    ) -> usize {
        // SAFETY: caller is C++ with live global; ptr is a valid out-param.
        let bun_vm = unsafe { &mut *(*global_object).bun_vm() };
        // TODO(port): map.map.keys().ptr — exposes raw pointer to the env-map
        // key slice array. The Rust StringMap needs a `.keys_ptr()` accessor
        // returning `*mut &[u8]` for FFI compat.
        let _ = (bun_vm, ptr);
        todo!("blocked_on: bun_dotenv::Map::keys_ptr / unmanaged_entries_len")
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvKey(
        ptr: *mut &[u8],
        i: usize,
        data_ptr: *mut *const u8,
    ) -> usize {
        // SAFETY: ptr was returned from Bun__getEnvCount; i < count.
        let item = unsafe { *ptr.add(i) };
        unsafe { *data_ptr = item.as_ptr() };
        item.len()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValue(
        global_object: *mut JSGlobalObject,
        name: *mut ZigString,
        value: *mut ZigString,
    ) -> bool {
        // SAFETY: caller is C++ with live global; name/value are valid pointers.
        let global_object = unsafe { &*global_object };
        if let Some(val) = get_env_value(global_object, unsafe { *name }) {
            unsafe { *value = val };
            return true;
        }

        false
    }

    /// BunString variant of Bun__getEnvValue. The returned value borrows from
    /// the env map; caller must copy before the map can mutate.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValueBunString(
        global_object: *mut JSGlobalObject,
        name: *mut BunString,
        value: *mut BunString,
    ) -> bool {
        // SAFETY: caller is C++ with live pointers.
        let global_object = unsafe { &*global_object };
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = unsafe { &*global_object.bun_vm() };
        let name_slice = unsafe { (*name).to_utf8() };
        // SAFETY: `transpiler.env` is the process-lifetime dotenv loader.
        let Some(val) = (unsafe { &*vm.transpiler.env }).get(name_slice.slice()) else {
            return false;
        };
        unsafe { *value = BunString::borrow_utf8(val) };
        true
    }

    /// Sync a process.env write back to the Zig-side env map so that Zig
    /// consumers (e.g. fetch's proxy resolution via env.getHttpProxyFor)
    /// observe the updated value. Used by custom setters for proxy-related
    /// env vars (HTTP_PROXY, HTTPS_PROXY, NO_PROXY and lowercase variants).
    ///
    /// Values are ref-counted in RareData.proxy_env_storage so that
    /// worker_threads share the parent's strings (refcount bumped at spawn)
    /// rather than cloning. A worker only allocates its own value if it
    /// writes to that var. Parent deref'ing on overwrite won't free the
    /// bytes while a worker still holds a ref.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setEnvValue(
        global_object: *mut JSGlobalObject,
        name: *mut BunString,
        value: *mut BunString,
    ) {
        // SAFETY: caller is C++ with live pointers.
        let global_object = unsafe { &*global_object };
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = unsafe { &mut *global_object.bun_vm() };
        let name_slice = unsafe { (*name).to_utf8() };

        // `VirtualMachine.proxy_env_storage` is currently a `()` placeholder
        // (see src/jsc/VirtualMachine.rs:207); the typed `ProxyEnvStorage`
        // (rare_data.rs) hasn't been threaded through yet.
        let _ = (vm, name_slice, value);
        todo!("blocked_on: bun_jsc::VirtualMachine.proxy_env_storage typed as rare_data::ProxyEnvStorage")
    }

    pub fn get_env_names(global_object: &JSGlobalObject, names: &mut [ZigString]) -> usize {
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = unsafe { &*global_object.bun_vm() };
        let _ = (vm, names);
        todo!("blocked_on: bun_dotenv::Map indexed keys()")
    }

    pub fn get_env_value(global_object: &JSGlobalObject, name: ZigString) -> Option<ZigString> {
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = unsafe { &*global_object.bun_vm() };
        let sliced = name.to_slice();
        // SAFETY: `transpiler.env` is the process-lifetime dotenv loader.
        let value = unsafe { &*vm.transpiler.env }.get(sliced.slice())?;
        Some(ZigString::init_utf8(value))
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportError(global_object: *mut JSGlobalObject, err: JSValue) {
    // SAFETY: caller is C++ with a live global.
    // SAFETY: VirtualMachine::get() returns the thread-local VM raw pointer.
    let vm = unsafe { &mut *jsc::virtual_machine::VirtualMachine::get() };
    let _ = vm.uncaught_exception(unsafe { &*global_object }, err, false);
}

#[allow(non_snake_case)]
pub mod JSZlib {
    use super::*;
    use bun_libdeflate_sys::libdeflate as bun_libdeflate;
    use bun_jsc::{ComptimeStringMapExt as _, ZigStringJsc as _};

    /// Local shim: libdeflate's `Status` has no `Into<&str>` upstream.
    #[inline]
    fn libdeflate_status_str(s: bun_libdeflate::Status) -> &'static str {
        match s {
            bun_libdeflate::Status::Success => "success",
            bun_libdeflate::Status::BadData => "bad data",
            bun_libdeflate::Status::ShortOutput => "short output",
            bun_libdeflate::Status::InsufficientSpace => "insufficient space",
        }
    }

    /// Local shim for Zig's `list.allocatedSlice()` — exposes the full
    /// `[0..capacity)` window as `&mut [u8]` for libdeflate to write into.
    /// SAFETY: caller must `set_len()` to the bytes actually written before
    /// reading; the uninitialized tail is treated as scratch space.
    #[inline]
    unsafe fn allocated_slice(list: &mut Vec<u8>) -> &mut [u8] {
        // SAFETY: ptr is valid for `capacity` bytes; libdeflate writes raw
        // bytes and the caller fixes up `len` afterwards.
        unsafe { core::slice::from_raw_parts_mut(list.as_mut_ptr(), list.capacity()) }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn reader_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx was created from Box<ZlibReaderArrayList>::into_raw.
        // PORT NOTE: Zig held an owned `ArrayListUnmanaged` in `.list`; the
        // Rust port stores a borrowed `&mut Vec<u8>` in `.list_ptr` instead,
        // so freeing the boxed reader (and zlib state via Drop) is sufficient.
        let reader: *mut zlib::ZlibReaderArrayList = ctx as *mut zlib::ZlibReaderArrayList;
        unsafe {
            drop(core::mem::take((*reader).list_ptr));
            drop(Box::from_raw(reader));
        }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn global_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx is a mimalloc-allocated pointer.
        unsafe { bun_alloc::basic::free_without_size(ctx) };
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn compressor_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx was created from Box<ZlibCompressorArrayList>::into_raw.
        // See `reader_deallocator` for the `.list` → `.list_ptr` port note.
        let compressor: *mut zlib::ZlibCompressorArrayList = ctx as *mut zlib::ZlibCompressorArrayList;
        unsafe {
            drop(core::mem::take((*compressor).list_ptr));
            drop(Box::from_raw(compressor));
        }
    }

    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    #[strum(serialize_all = "lowercase")]
    pub enum Library {
        Zlib,
        Libdeflate,
    }

    // bun.ComptimeEnumMap(Library)
    pub static LIBRARY_MAP: phf::Map<&'static [u8], Library> = phf::phf_map! {
        b"zlib" => Library::Zlib,
        b"libdeflate" => Library::Libdeflate,
    };

    // This has to be `inline` due to the callframe.
    #[inline]
    fn get_options(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(node::StringOrBuffer, Option<JSValue>)> {
        let arguments_ = callframe.arguments_old::<2>();
        let arguments = arguments_.slice();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return Err(global_this
                .throw_invalid_arguments("Expected options to be an object"));
        } else {
            None
        };

        if let Some(buffer) = node::StringOrBuffer::from_js(global_this, buffer_value)? {
            return Ok((buffer, options_val));
        }

        Err(global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer"))
    }

    #[bun_jsc::host_fn]
    pub fn gzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, true)
    }

    #[bun_jsc::host_fn]
    pub fn inflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn deflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn gunzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, true)
    }

    pub fn gunzip_or_inflate_sync(
        global_this: &JSGlobalObject,
        buffer: node::StringOrBuffer,
        options_val_: Option<JSValue>,
        is_gzip: bool,
    ) -> JsResult<JSValue> {
        let mut opts = zlib::Options {
            gzip: is_gzip,
            window_bits: if is_gzip { 31 } else { -15 },
            ..Default::default()
        };

        let mut library = Library::Zlib;
        if let Some(options_val) = options_val_ {
            if let Some(window) = options_val.get(global_this, "windowBits")? {
                opts.window_bits = window.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(level) = options_val.get(global_this, "level")? {
                opts.level = level.coerce::<i32>(global_this)?;
            }

            if let Some(mem_level) = options_val.get(global_this, "memLevel")? {
                opts.mem_level = mem_level.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(strategy) = options_val.get(global_this, "strategy")? {
                opts.strategy = strategy.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(library_value) = options_val.get_truthy(global_this, "library")? {
                if !library_value.is_string() {
                    return Err(global_this
                        .throw_invalid_arguments("Expected library to be a string"));
                }

                library = match LIBRARY_MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return Err(global_this.throw_invalid_arguments(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                        ))
                    }
                };
            }
        }

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let compressed = buffer.slice();

        let mut list: Vec<u8> = 'brk: {
            if is_gzip && compressed.len() > 64 {
                //   0   1   2   3   4   5   6   7
                //  +---+---+---+---+---+---+---+---+
                //  |     CRC32     |     ISIZE     |
                //  +---+---+---+---+---+---+---+---+
                let estimated_size: u32 = u32::from_ne_bytes(
                    compressed[compressed.len() - 4..][..4].try_into().unwrap(),
                );
                // If it's > 256 MB, let's rely on dynamic allocation to minimize the risk of OOM.
                if estimated_size > 0 && estimated_size < 256 * 1024 * 1024 {
                    break 'brk Vec::with_capacity((estimated_size as usize).max(64));
                }
            }

            break 'brk Vec::with_capacity(if compressed.len() > 512 {
                compressed.len()
            } else {
                32
            });
        };

        match library {
            Library::Zlib => {
                let mut reader = match zlib::ZlibReaderArrayList::init_with_options(
                    compressed,
                    &mut list,
                    zlib::Options {
                        window_bits: opts.window_bits,
                        level: opts.level,
                        ..Default::default()
                    },
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        // `list` is still mutably borrowed by the match
                        // scrutinee's temporary; it drops on `return` anyway.
                        if err == zlib::ZlibError::InvalidArgument {
                            return Err(global_this
                                .throw("Zlib error: Invalid argument"));
                        }
                        return Err(global_this.throw_error(err.into(), "Zlib error"));
                    }
                };

                if let Err(_) = reader.read_all(true) {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return Err(global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this)));
                }
                // PORT NOTE: Zig moved `list` into the reader and freed via
                // `reader_deallocator`. In Rust the reader *borrows* `list_ptr`,
                // so drop the reader to release the borrow, then leak the owned
                // `list` directly into the ArrayBuffer (freed by
                // `global_deallocator`).
                drop(reader);
                list.shrink_to_fit();
                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                // SAFETY: ptr/len leaked from `list` just above; freed via
                // `global_deallocator` once the ArrayBuffer is finalized.
                let array_buffer = ArrayBuffer::from_bytes(
                    unsafe { core::slice::from_raw_parts_mut(ptr, len) },
                    jsc::JSType::Uint8Array,
                );
                array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    Some(global_deallocator),
                )
            }
            Library::Libdeflate => {
                let decompressor_ptr = bun_libdeflate::Decompressor::alloc();
                if decompressor_ptr.is_null() {
                    drop(list);
                    return Err(global_this.throw_out_of_memory());
                }
                // SAFETY: non-null per check above; freed via the scopeguard below.
                let decompressor = unsafe { &mut *decompressor_ptr };
                let _decompressor_guard = scopeguard::guard(decompressor_ptr, |p| unsafe {
                    bun_libdeflate::Decompressor::destroy(p)
                });
                loop {
                    // Zig passes list.allocatedSlice() (= [0..capacity]) every iteration;
                    // libdeflate restarts decompression from scratch on each call.
                    let result = decompressor.decompress(
                        compressed,
                        // SAFETY: see `allocated_slice` doc — set_len follows.
                        unsafe { allocated_slice(&mut list) },
                        if is_gzip {
                            bun_libdeflate::Encoding::Gzip
                        } else {
                            bun_libdeflate::Encoding::Deflate
                        },
                    );

                    // SAFETY: result.written ≤ list.capacity()
                    unsafe { list.set_len(result.written) };

                    if result.status == bun_libdeflate::Status::InsufficientSpace {
                        if list.capacity() > 1024 * 1024 * 1024 {
                            drop(list);
                            return Err(global_this.throw_out_of_memory());
                        }

                        let new_cap = list.capacity() * 2;
                        list.reserve(new_cap.saturating_sub(list.len()));
                        continue;
                    }

                    if result.status == bun_libdeflate::Status::Success {
                        // SAFETY: result.written ≤ list.capacity() and bytes [0..written] were
                        // initialized by libdeflate above.
                        unsafe { list.set_len(result.written) };
                        break;
                    }

                    drop(list);
                    return Err(global_this.throw(format_args!(
                        "libdeflate returned an error: {}",
                        libdeflate_status_str(result.status),
                    )));
                }

                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                let array_buffer = ArrayBuffer::from_bytes(
                    // SAFETY: ptr/len leaked from Vec just above.
                    unsafe { core::slice::from_raw_parts_mut(ptr, len) },
                    jsc::JSType::Uint8Array,
                );
                array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    Some(global_deallocator),
                )
            }
        }
    }

    pub fn gzip_or_deflate_sync(
        global_this: &JSGlobalObject,
        buffer: node::StringOrBuffer,
        options_val_: Option<JSValue>,
        is_gzip: bool,
    ) -> JsResult<JSValue> {
        let mut level: Option<i32> = None;
        let mut library = Library::Zlib;
        let mut window_bits: i32 = 0;

        if let Some(options_val) = options_val_ {
            if let Some(window) = options_val.get(global_this, "windowBits")? {
                window_bits = window.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(library_value) = options_val.get_truthy(global_this, "library")? {
                if !library_value.is_string() {
                    return Err(global_this
                        .throw_invalid_arguments("Expected library to be a string"));
                }

                library = match LIBRARY_MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return Err(global_this.throw_invalid_arguments(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                        ))
                    }
                };
            }

            if let Some(level_value) = options_val.get(global_this, "level")? {
                level = Some(level_value.coerce::<i32>(global_this)?);
                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let compressed = buffer.slice();
        let _ = window_bits; // unused in Zig too

        match library {
            Library::Zlib => {
                let mut list: Vec<u8> = Vec::with_capacity(if compressed.len() > 512 {
                    compressed.len()
                } else {
                    32
                });

                let mut reader = match zlib::ZlibCompressorArrayList::init(
                    compressed,
                    &mut list,
                    zlib::Options {
                        window_bits: 15,
                        gzip: is_gzip,
                        level: level.unwrap_or(6),
                        ..Default::default()
                    },
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        // `list` is still mutably borrowed by the match
                        // scrutinee's temporary; it drops on `return` anyway.
                        if err == zlib::ZlibError::InvalidArgument {
                            return Err(global_this
                                .throw("Zlib error: Invalid argument"));
                        }
                        return Err(global_this.throw_error(err.into(), "Zlib error"));
                    }
                };

                if let Err(_) = reader.read_all() {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return Err(global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this)));
                }
                // PORT NOTE: see gunzip path — reader borrows `list`, so drop
                // it before leaking `list` into the ArrayBuffer.
                drop(reader);
                list.shrink_to_fit();
                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                // SAFETY: ptr/len leaked from `list`; freed via `global_deallocator`.
                let array_buffer = ArrayBuffer::from_bytes(
                    unsafe { core::slice::from_raw_parts_mut(ptr, len) },
                    jsc::JSType::Uint8Array,
                );
                array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    Some(global_deallocator),
                )
            }
            Library::Libdeflate => {
                let compressor_ptr = bun_libdeflate::Compressor::alloc(level.unwrap_or(6));
                if compressor_ptr.is_null() {
                    return Err(global_this.throw_out_of_memory());
                }
                // SAFETY: non-null per check above; freed via the scopeguard below.
                let compressor = unsafe { &mut *compressor_ptr };
                let _compressor_guard = scopeguard::guard(compressor_ptr, |p| unsafe {
                    bun_libdeflate::Compressor::destroy(p)
                });
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };

                let mut list: Vec<u8> = Vec::with_capacity(
                    // This allocation size is unfortunate, but it's not clear how to avoid it with libdeflate.
                    compressor.max_bytes_needed(compressed, encoding),
                );

                loop {
                    // list.len() == 0 here (no retry path), so spare == [0..capacity] == allocatedSlice().
                    let result = compressor.compress(
                        compressed,
                        // SAFETY: see `allocated_slice` doc — set_len follows.
                        unsafe { allocated_slice(&mut list) },
                        encoding,
                    );

                    // SAFETY: result.written ≤ list.capacity() and bytes [0..written] were
                    // initialized by libdeflate above.
                    unsafe { list.set_len(result.written) };

                    if result.status == bun_libdeflate::Status::Success {
                        // SAFETY: same invariant as above; redundant set_len mirrors Zig.
                        unsafe { list.set_len(result.written) };
                        break;
                    }

                    drop(list);
                    return Err(global_this.throw(format_args!(
                        "libdeflate error: {}",
                        libdeflate_status_str(result.status),
                    )));
                }

                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                let array_buffer = ArrayBuffer::from_bytes(
                    // SAFETY: ptr/len leaked from the Vec just above; memory remains valid
                    // until global_deallocator frees it via the ArrayBuffer finalizer.
                    unsafe { core::slice::from_raw_parts_mut(ptr, len) },
                    jsc::JSType::Uint8Array,
                );
                array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    Some(global_deallocator),
                )
            }
        }
    }
}

#[allow(non_snake_case)]
pub mod JSZstd {
    use super::*;
    use bun_jsc::virtual_machine::VirtualMachine;

    #[unsafe(no_mangle)]
    pub extern "C" fn deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx is a mimalloc-allocated pointer.
        unsafe { bun_alloc::basic::free_without_size(ctx) };
    }

    #[inline]
    fn get_options(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(node::StringOrBuffer, Option<JSValue>)> {
        let arguments = callframe.arguments();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return Err(global_this
                .throw_invalid_arguments("Expected options to be an object"));
        } else {
            None
        };

        if let Some(buffer) = node::StringOrBuffer::from_js(global_this, buffer_value)? {
            return Ok((buffer, options_val));
        }

        Err(global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer"))
    }

    fn get_level(global_this: &JSGlobalObject, options_val: Option<JSValue>) -> JsResult<i32> {
        if let Some(option_obj) = options_val {
            if let Some(level_val) = option_obj.get(global_this, "level")? {
                let value = level_val.coerce::<i32>(global_this)?;
                if global_this.has_exception() {
                    return Err(jsc::JsError::Thrown);
                }

                if value < 1 || value > 22 {
                    return Err(global_this.throw_invalid_arguments(
                        "Compression level must be between 1 and 22",
                    ));
                }

                return Ok(value);
            }
        }

        Ok(3)
    }

    #[inline]
    fn get_options_async(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(node::StringOrBuffer, Option<JSValue>, i32)> {
        let arguments = callframe.arguments();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return Err(global_this
                .throw_invalid_arguments("Expected options to be an object"));
        } else {
            None
        };

        let level = get_level(global_this, options_val)?;

        let allow_string_object = true;
        if let Some(buffer) = node::StringOrBuffer::from_js_maybe_async(
            global_this,
            buffer_value,
            true,
            allow_string_object,
        )? {
            return Ok((buffer, options_val, level));
        }

        Err(global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer"))
    }

    #[bun_jsc::host_fn]
    pub fn compress_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        let input = buffer.slice();

        // Calculate max compressed size
        let max_size = bun_zstd::compress_bound(input.len());
        let mut output = vec![0u8; max_size];
        // TODO(port): allocator.alloc(u8, n) — Zig left this uninitialized.
        // PERF(port): use Box::new_uninit_slice — profile in Phase B.

        // Perform compression with context
        let compressed_size = match bun_zstd::compress(&mut output, input, Some(level)) {
            bun_zstd::Result::Success(size) => size,
            bun_zstd::Result::Err(err) => {
                drop(output);
                return Err(global_this
                    .err(jsc::ErrCode::ZSTD, format_args!("{}", bstr::BStr::new(err)))
                    .throw());
            }
        };

        // Resize to actual compressed size
        if compressed_size < output.len() {
            output.truncate(compressed_size);
            output.shrink_to_fit();
        }

        Ok(JSValue::create_buffer(global_this, output.leak()))
    }

    #[bun_jsc::host_fn]
    pub fn decompress_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _) = get_options(global_this, callframe)?;

        let input = buffer.slice();

        let output = match bun_zstd::decompress_alloc(input) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this
                    .err(
                        jsc::ErrCode::ZSTD,
                        format_args!("Decompression failed: {}", err),
                    )
                    .throw());
            }
        };

        Ok(JSValue::create_buffer(global_this, output.leak()))
    }

    // --- Async versions ---

    pub struct ZstdJob {
        pub buffer: node::StringOrBuffer,
        pub is_compress: bool,
        pub level: i32,
        pub task: jsc::WorkPoolTask,
        pub promise: jsc::JSPromiseStrong,
        pub vm: &'static VirtualMachine,
        pub output: Vec<u8>,
        pub error_message: Option<&'static [u8]>,
        pub any_task: jsc::AnyTask::AnyTask,
        pub poll: KeepAlive,
    }

    impl ZstdJob {
        // bun.TrivialNew(@This())
        pub fn new(init: ZstdJob) -> *mut ZstdJob {
            Box::into_raw(Box::new(init))
        }

        /// SAFETY: `task` must point to the `task` field of a live `ZstdJob`
        /// scheduled via `WorkPool::schedule` from `ZstdJob::create`.
        pub unsafe fn run_task(task: *mut jsc::WorkPoolTask) {
            // SAFETY: task points to ZstdJob.task; recover parent via offset_of.
            let job_ptr: *mut ZstdJob = unsafe {
                (task as *mut u8)
                    .sub(core::mem::offset_of!(ZstdJob, task))
                    .cast::<ZstdJob>()
            };
            let _enqueue = scopeguard::guard(job_ptr, |job_ptr| {
                // SAFETY: job_ptr is the unique live ZstdJob; vm.event_loop is a
                // self-pointer into the VM and the loop outlives the job
                // (vm is &'static).
                unsafe {
                    let job = &mut *job_ptr;
                    (*job.vm.event_loop).enqueue_task_concurrent(
                        jsc::ConcurrentTask::create(job.any_task.task()),
                    );
                }
            });
            // SAFETY: caller contract — job_ptr is the unique live ZstdJob.
            let job = unsafe { &mut *job_ptr };

            let input = job.buffer.slice();

            if job.is_compress {
                // Compression path
                // Calculate max compressed size
                let max_size = bun_zstd::compress_bound(input.len());
                // TODO(port): allocator.alloc(u8, n) — Zig left this uninitialized
                // and surfaced OOM as an error. Rust's global allocator aborts on
                // OOM, so the explicit "Out of memory" path is unreachable here.
                // Phase B: route through a fallible bun_alloc helper.
                job.output = vec![0u8; max_size];

                // Perform compression
                job.output = match bun_zstd::compress(&mut job.output, input, Some(job.level)) {
                    bun_zstd::Result::Success(size) => 'blk: {
                        // Resize to actual compressed size
                        if size < job.output.len() {
                            let mut out = core::mem::take(&mut job.output);
                            out.truncate(size);
                            out.shrink_to_fit();
                            break 'blk out;
                        }
                        break 'blk core::mem::take(&mut job.output);
                    }
                    bun_zstd::Result::Err(err) => {
                        job.output = Vec::new();
                        job.error_message = Some(err);
                        return;
                    }
                };
            } else {
                // Decompression path
                job.output = match bun_zstd::decompress_alloc(input) {
                    Ok(v) => v,
                    Err(_) => {
                        job.error_message = Some(b"Decompression failed");
                        return;
                    }
                };
            }
        }

        pub fn run_from_js(this: *mut ZstdJob) -> Result<(), jsc::JsTerminated> {
            // SAFETY: `this` was created via ZstdJob::new (Box::into_raw) and is exclusively
            // owned here; destroy() reclaims the Box at scope exit on every path.
            let _deinit = scopeguard::guard(this, |p| unsafe { ZstdJob::destroy(p) });
            // SAFETY: `this` is non-null and valid for the duration of this call (see above).
            let this = unsafe { &mut *this };

            if this.vm.is_shutting_down() {
                return Ok(());
            }

            // SAFETY: vm.global is the live thread-local global; non-null while
            // the VM is alive (checked via is_shutting_down above).
            let global_this: &JSGlobalObject = unsafe { &*this.vm.global };
            let promise = this.promise.swap();

            if let Some(err_msg) = this.error_message {
                promise.reject_with_async_stack(
                    global_this,
                    Ok(global_this
                        .err(jsc::ErrCode::ZSTD, format_args!("{}", bstr::BStr::new(err_msg)))
                        .to_js()),
                )?;
                return Ok(());
            }

            let output_slice = core::mem::take(&mut this.output);
            let buffer_value = JSValue::create_buffer(global_this, output_slice.leak());
            promise.resolve(global_this, buffer_value)?;
            Ok(())
        }

        /// Tear down and free a heap-allocated job.
        ///
        /// SAFETY: `this` must have been produced by `ZstdJob::new` (i.e. `Box::into_raw`)
        /// and must not be used after this call. Invoked exactly once from `run_from_js`.
        pub unsafe fn destroy(this: *mut ZstdJob) {
            // SAFETY: caller contract — `this` is the unique raw Box pointer.
            let mut boxed = unsafe { Box::from_raw(this) };
            boxed.poll.unref(bun_aio::posix_event_loop::get_vm_ctx(
                bun_aio::AllocatorType::Js,
            ));
            boxed.buffer.deinit_and_unprotect();
            boxed.promise = Default::default();
            boxed.output = Vec::new();
            // `boxed` drops here, freeing the allocation.
        }

        pub fn create(
            vm: &'static VirtualMachine,
            global_this: &JSGlobalObject,
            buffer: node::StringOrBuffer,
            is_compress: bool,
            level: i32,
        ) -> *mut ZstdJob {
            let job = ZstdJob::new(ZstdJob {
                buffer,
                is_compress,
                level,
                task: jsc::WorkPoolTask {
                    node: Default::default(),
                    callback: ZstdJob::run_task,
                },
                promise: Default::default(),
                vm,
                output: Vec::new(),
                error_message: None,
                any_task: Default::default(), // overwritten below
                poll: KeepAlive::default(),
            });

            // SAFETY: job is freshly allocated and exclusively owned here.
            let job_ref = unsafe { &mut *job };
            job_ref.promise = jsc::JSPromiseStrong::init(global_this);
            // PORT NOTE: Zig `jsc.AnyTask.New(ZstdJob, runFromJS).init(job)` monomorphizes
            // a wrapper at comptime; Rust's `AnyTask::New<T>` cannot bind a callback
            // const-generically yet, so build the AnyTask inline with an erased shim.
            job_ref.any_task = jsc::AnyTask::AnyTask {
                ctx: core::ptr::NonNull::new(job.cast::<c_void>()),
                callback: |p: *mut c_void| {
                    ZstdJob::run_from_js(p.cast::<ZstdJob>())
                        .map_err(|_| core::ptr::null_mut::<()>())
                },
            };
            job_ref.poll.ref_(bun_aio::posix_event_loop::get_vm_ctx(
                bun_aio::AllocatorType::Js,
            ));
            WorkPool::schedule(&mut job_ref.task);

            job
        }
    }

    #[bun_jsc::host_fn]
    pub fn compress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, level) = get_options_async(global_this, callframe)?;

        // SAFETY: bun_vm() returns the thread-local VM raw ptr; non-null on JS thread.
        let vm: &'static VirtualMachine = unsafe { &*global_this.bun_vm() };
        let job = ZstdJob::create(vm, global_this, buffer, true, level);
        // SAFETY: job is live until run_from_js consumes it.
        Ok(unsafe { (*job).promise.value() })
    }

    #[bun_jsc::host_fn]
    pub fn decompress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, _) = get_options_async(global_this, callframe)?;

        // SAFETY: bun_vm() returns the thread-local VM raw ptr; non-null on JS thread.
        let vm: &'static VirtualMachine = unsafe { &*global_this.bun_vm() };
        let job = ZstdJob::create(vm, global_this, buffer, false, 0); // level is ignored for decompression
        // SAFETY: job is live until run_from_js consumes it.
        Ok(unsafe { (*job).promise.value() })
    }
}

// const InternalTestingAPIs = struct {
//     pub fn BunInternalFunction__syntaxHighlighter(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
//         const args = callframe.arguments_old(1);
//         if (args.len < 1) {
//             globalThis.throwNotEnoughArguments("code", 1, 0);
//         }
//
//         const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
//         defer code.deinit();
//         var buffer = MutableString.initEmpty(bun.default_allocator);
//         defer buffer.deinit();
//         var writer = buffer.bufferedWriter();
//         const formatter = bun.fmt.fmtJavaScript(code.slice(), .{
//             .enable_colors = true,
//             .check_for_unhighlighted_write = false,
//         });
//         writer.writer().print("{f}", .{formatter}) catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };
//
//         writer.flush() catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };
//
//         return bun.String.createUTF8ForJS(globalThis, buffer.list.items);
//     }
// };

// PORT NOTE: Zig `comptime { _ = ...; BunObject.exportAll(); }` block dropped —
// Rust links what's pub via the `#[unsafe(no_mangle)]` exports above.
// Referenced: Crypto::JSPasswordObject::JSPasswordObject__create,
// bun_jsc::btjs::dump_btjs_trace.

// LazyProperty initializers for stdin/stderr/stdout
pub fn create_bun_stdin(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the thread-local VM raw ptr; non-null on JS thread.
    let _rare_data = unsafe { &mut *global_this.bun_vm() }.rare_data();
    // RareData::stdin() lives in the `#[cfg(any())] _accessor_body` block.
    todo!("blocked_on: bun_jsc::rare_data::RareData::stdin + bun_jsc::WebCore::Blob::{{new,init_with_store}}")
}

pub fn create_bun_stderr(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the thread-local VM raw ptr; non-null on JS thread.
    let _rare_data = unsafe { &mut *global_this.bun_vm() }.rare_data();
    // RareData::stderr() lives in the `#[cfg(any())] _accessor_body` block.
    todo!("blocked_on: bun_jsc::rare_data::RareData::stderr + bun_jsc::WebCore::Blob::{{new,init_with_store}}")
}

pub fn create_bun_stdout(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the thread-local VM raw ptr; non-null on JS thread.
    let _rare_data = unsafe { &mut *global_this.bun_vm() }.rare_data();
    // RareData::stdout() lives in the `#[cfg(any())] _accessor_body` block.
    todo!("blocked_on: bun_jsc::rare_data::RareData::stdout + bun_jsc::WebCore::Blob::{{new,init_with_store}}")
}

} // mod _jsc_gated

// Re-export so `crate::api::bun_object::get_public_path` is reachable from
// `filesystem_router` and `jsc_hooks` (the bun_io::Write variant lives inside
// the gated mod alongside its `_with_asset_prefix` sibling).
pub use _jsc_gated::get_public_path;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/BunObject.zig (2172 lines)
//   confidence: medium
//   todos:      17
//   notes:      Heavy comptime @export table replaced with macro_rules! shims (needs proc-macro in Phase B); ZlibReaderArrayList ownership/list_ptr self-ref needs Rust-side reshape; ZstdJob fallible alloc placeholder.
// ──────────────────────────────────────────────────────────────────────────
