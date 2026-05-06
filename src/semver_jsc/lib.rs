#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

// ──────────────────────────────────────────────────────────────────────────
// B-2 local JSC stub surface
//
// `bun_jsc` was red during initial B-2 (its dep `bun_css` failed E0119), so the
// handful of JSC types/methods this crate touches are declared locally as
// `#[repr(transparent)]` newtypes with **real FFI bodies** ported straight from
// the Zig spec (`src/jsc/{JSValue,JSString,JSGlobalObject,JSFunction,CallFrame}.zig`).
// The extern symbols are the same `JSC__*` / `JSFunction__*` / `BunString__*` C
// entrypoints `bun_jsc` itself links against, so this module is link-compatible
// and can be mechanically swapped to `use bun_jsc::{..}` once that crate is
// green — the layouts (`usize`-transparent JSValue, opaque-ptr global/frame)
// are ABI-identical.
// ──────────────────────────────────────────────────────────────────────────
pub mod jsc_stub {
    use core::ffi::c_void;
    use core::marker::PhantomData;

    use bun_string::{String as BunString, ZigString, ZigStringSlice};

    // ──────────────────────────────────────────────────────────────────────
    // Opaque / transparent handles. `&JSGlobalObject` / `&CallFrame` are raw
    // FFI pointers (the address is what matters; the body is never read), so a
    // transparent `usize` is layout-safe. `JSValue` is the encoded 64-bit
    // `JSC::EncodedJSValue` word. `JSString` / `JSFunction` wrap a cell address
    // by value.
    // ──────────────────────────────────────────────────────────────────────
    #[repr(transparent)]
    pub struct JSGlobalObject(pub usize);
    #[repr(transparent)]
    #[derive(Clone, Copy, Debug, Default)]
    pub struct JSValue(pub usize);
    #[repr(transparent)]
    pub struct CallFrame(pub usize);
    #[repr(transparent)]
    #[derive(Clone, Copy)]
    pub struct JSFunction(pub usize);
    #[repr(transparent)]
    #[derive(Clone, Copy)]
    pub struct JSString(pub usize);
    /// `bun.JSError!T` → `JsResult<T>`. The error payload is the encoded
    /// JSValue::ZERO sentinel (mirrors Zig's `error.JSError` + `.zero` return).
    pub type JsResult<T> = core::result::Result<T, JSValue>;

    /// Mirrors `bun_jsc::CallFrame::Arguments<N>` — fixed-size copy of the
    /// first N call-frame argument slots plus the actual length.
    pub struct Arguments<const N: usize> {
        pub ptr: [JSValue; N],
        pub len: usize,
    }
    impl<const N: usize> Arguments<N> {
        #[inline]
        pub fn slice(&self) -> &[JSValue] {
            &self.ptr[..self.len.min(N)]
        }
        #[inline]
        fn init(i: usize, ptr: *const JSValue) -> Self {
            let mut args: [JSValue; N] = [JSValue(0); N];
            // SAFETY: caller guarantees `ptr[0..i]` is a valid contiguous JSValue
            // span inside the JSC register file and `i <= N`.
            args[0..i].copy_from_slice(unsafe { core::slice::from_raw_parts(ptr, i) });
            Self { ptr: args, len: i }
        }
    }

    /// Mirrors `bun_jsc::JSFunction::CreateJSFunctionOptions` (`.{}` in Zig).
    #[derive(Default)]
    pub struct CreateOptions {
        pub implementation_visibility: u8, // ImplementationVisibility::Public = 0
        pub intrinsic: u8,                 // Intrinsic::NONE = 0
        pub constructor: Option<JSHostFn>,
    }

    /// Raw C-ABI host-function pointer (`jsc.JSHostFn` / `callconv(jsc.conv)`).
    // TODO(port): jsc.conv ABI — `extern "sysv64"` on windows-x64.
    pub type JSHostFn =
        unsafe extern "C" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue;
    /// Safe Rust-signature host fn (Zig `JSHostFnZig`).
    pub type HostFn = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

    // ──────────────────────────────────────────────────────────────────────
    // extern "C" — the same symbols `bun_jsc` links against (see
    // src/jsc/{JSValue,JSGlobalObject,JSString,JSFunction,VM,bun_string_jsc}.rs).
    // ──────────────────────────────────────────────────────────────────────
    unsafe extern "C" {
        // JSGlobalObject
        fn JSGlobalObject__throwOutOfMemoryError(this: *const JSGlobalObject);
        fn JSGlobalObject__hasException(this: *const JSGlobalObject) -> bool;
        fn JSC__JSGlobalObject__vm(this: *const JSGlobalObject) -> *mut c_void; // *mut VM
        // VM
        fn JSC__VM__throwError(vm: *mut c_void, global: *const JSGlobalObject, value: JSValue);
        // ZigString
        fn ZigString__toErrorInstance(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
        // JSValue
        fn JSC__JSValue__createEmptyObject(global: *const JSGlobalObject, len: usize) -> JSValue;
        fn JSC__JSValue__put(this: JSValue, global: *const JSGlobalObject, key: *const ZigString, value: JSValue);
        fn JSC__JSValue__toStringOrNull(this: JSValue, global: *const JSGlobalObject) -> *mut c_void; // *mut JSString
        // JSString
        fn JSC__JSString__toZigString(this: *mut c_void, global: *const JSGlobalObject, out: *mut ZigString);
        // JSFunction
        fn JSFunction__createFromZig(
            global: *const JSGlobalObject,
            fn_name: BunString,
            implementation: JSHostFn,
            arg_count: u32,
            implementation_visibility: u8,
            intrinsic: u8,
            constructor: Option<JSHostFn>,
        ) -> JSValue;
        // bun.String
        fn BunString__createUTF8ForJS(global: *const JSGlobalObject, ptr: *const u8, len: usize) -> JSValue;
    }

    // ──────────────────────────────────────────────────────────────────────
    // JSGlobalObject (src/jsc/JSGlobalObject.zig)
    // ──────────────────────────────────────────────────────────────────────
    impl JSGlobalObject {
        #[inline]
        fn has_exception(&self) -> bool {
            // SAFETY: FFI — &self is a valid JSGlobalObject*.
            unsafe { JSGlobalObject__hasException(self) }
        }

        /// `throwValue` (JSGlobalObject.zig) — set `value` as the pending
        /// exception on the VM unless one is already pending.
        #[cold]
        fn throw_value<T>(&self, value: JSValue) -> JsResult<T> {
            if self.has_exception() {
                return Err(JSValue(0));
            }
            // SAFETY: FFI — &self is a valid JSGlobalObject*; `vm` is the live
            // VM pointer for this global; `value` is a valid encoded JSValue.
            unsafe {
                let vm = JSC__JSGlobalObject__vm(self);
                JSC__VM__throwError(vm, self, value);
            }
            Err(JSValue(0))
        }

        /// `throw` (JSGlobalObject.zig:418) — format an error message, wrap it
        /// in a JS `Error` instance, and throw it.
        #[cold]
        pub fn throw<T>(&self, args: core::fmt::Arguments<'_>) -> JsResult<T> {
            // createErrorInstance: format → ZigString (UTF-8 marked) →
            // ZigString__toErrorInstance.
            // PERF(port): was stack-fallback writer in Zig — profile in Phase B.
            let buf;
            let zs = match args.as_str() {
                Some(s) => ZigString::init_utf8(s.as_bytes()),
                None => {
                    buf = alloc::format!("{}", args);
                    ZigString::init_utf8(buf.as_bytes())
                }
            };
            // SAFETY: FFI — `zs` borrowed for the call; &self is a valid global.
            let instance = unsafe { ZigString__toErrorInstance(&zs, self) };
            if instance.0 == 0 {
                debug_assert!(self.has_exception());
                return Err(JSValue(0));
            }
            self.throw_value(instance)
        }

        /// `throwOutOfMemory` (JSGlobalObject.zig).
        #[cold]
        pub fn throw_out_of_memory<T>(&self) -> JsResult<T> {
            // SAFETY: FFI — &self is a valid JSGlobalObject*.
            unsafe { JSGlobalObject__throwOutOfMemoryError(self) };
            Err(JSValue(0))
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // JSValue (src/jsc/JSValue.zig)
    // ──────────────────────────────────────────────────────────────────────
    impl JSValue {
        pub const FALSE: JSValue = JSValue(0x6);
        pub const TRUE: JSValue = JSValue(0x7);
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;

        /// `JSValue.createEmptyObject` (JSValue.zig).
        pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
            // SAFETY: FFI — `global` is a live JSGlobalObject for the call.
            unsafe { JSC__JSValue__createEmptyObject(global, len) }
        }

        /// `JSValue.put` (JSValue.zig:366) — `key: ZigString` arm dispatches to
        /// `putZigString` → `JSC__JSValue__put`.
        pub fn put(self, global: &JSGlobalObject, key: ZigString, value: JSValue) {
            // SAFETY: FFI — `global` is live; `&key` borrowed for the call.
            unsafe { JSC__JSValue__put(self, global, &key, value) }
        }

        /// `JSValue.jsNumber(i32)` (JSValue.zig) — int32 fast path: encode as
        /// `NumberTag | (i as u32)`.
        #[inline]
        pub fn js_number(n: i32) -> JSValue {
            JSValue(Self::NUMBER_TAG | (n as u32 as usize))
        }

        /// `JSValue.jsBoolean` (JSValue.zig).
        #[inline]
        pub fn js_boolean(b: bool) -> JSValue {
            if b { Self::TRUE } else { Self::FALSE }
        }

        /// `JSValue.toJSString` (JSValue.zig) → `JSC__JSValue__toStringOrNull`.
        pub fn to_js_string(self, global: &JSGlobalObject) -> JsResult<JSString> {
            // SAFETY: FFI — `global` is live; may set an exception.
            let p = unsafe { JSC__JSValue__toStringOrNull(self, global) };
            if p.is_null() || global.has_exception() {
                Err(JSValue(0))
            } else {
                Ok(JSString(p as usize))
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // JSString (src/jsc/JSString.zig)
    // ──────────────────────────────────────────────────────────────────────
    impl JSString {
        /// `JSString.toSlice` (JSString.zig:40-47) — view → UTF-8 slice (may
        /// allocate when the backing string is UTF-16/non-ASCII Latin-1).
        pub fn to_slice(&self, global: &JSGlobalObject) -> ZigStringSlice {
            let mut str = ZigString::init(b"");
            // SAFETY: FFI — `self.0` is a valid JSString cell address (obtained
            // from `to_js_string`); `global` is live; `str` is a valid out-param.
            unsafe { JSC__JSString__toZigString(self.0 as *mut c_void, global, &mut str) };
            str.to_slice()
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // JSFunction (src/jsc/JSFunction.zig)
    // ──────────────────────────────────────────────────────────────────────
    impl JSFunction {
        /// `JSFunction.create` (JSFunction.zig) — Zig accepted `implementation`
        /// as either `JSHostFnZig` (safe) or `JSHostFn` (raw) via comptime
        /// `@TypeOf` dispatch, calling `jsc.toJSHostFn` for the safe form. Rust
        /// cannot dispatch on fn-pointer type at comptime, so callers wrap with
        /// [`to_js_host_fn!`] and pass the raw [`JSHostFn`] directly.
        pub fn create(
            global: &JSGlobalObject,
            name: &'static str,
            implementation: JSHostFn,
            function_length: u32,
            opts: CreateOptions,
        ) -> JSValue {
            // SAFETY: FFI — `global` is live; `BunString::static_` borrows the
            // 'static name; `implementation` is a valid C-ABI fn pointer.
            unsafe {
                JSFunction__createFromZig(
                    global,
                    BunString::static_(name),
                    implementation,
                    function_length,
                    opts.implementation_visibility,
                    opts.intrinsic,
                    opts.constructor,
                )
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // CallFrame (src/jsc/CallFrame.zig)
    // ──────────────────────────────────────────────────────────────────────
    // JSC::CallFrameSlot constants (JavaScriptCore/interpreter/CallFrame.h).
    const OFFSET_CODE_BLOCK: usize = 2;
    const OFFSET_CALLEE: usize = OFFSET_CODE_BLOCK + 1;
    const OFFSET_ARGUMENT_COUNT_INCLUDING_THIS: usize = OFFSET_CALLEE + 1;
    const OFFSET_THIS_ARGUMENT: usize = OFFSET_ARGUMENT_COUNT_INCLUDING_THIS + 1;
    const OFFSET_FIRST_ARGUMENT: usize = OFFSET_THIS_ARGUMENT + 1;

    impl CallFrame {
        #[inline]
        fn as_unsafe_js_value_array(&self) -> *const JSValue {
            // SAFETY: CallFrame is an opaque handle whose address IS the base
            // of the JSC register array; mirrors Zig `@ptrCast(@alignCast(self))`.
            (self as *const CallFrame).cast::<JSValue>()
        }

        fn argument_count_including_this(&self) -> u32 {
            // SAFETY: the slot at OFFSET_ARGUMENT_COUNT_INCLUDING_THIS is a
            // valid Register; its low 32 bits hold the i32 payload (always ≥1).
            // `Register.encodedValue.asBits.payload` is the first i32 of the
            // 64-bit slot — equivalently the truncation of the encoded word.
            unsafe {
                let slot = *self
                    .as_unsafe_js_value_array()
                    .add(OFFSET_ARGUMENT_COUNT_INCLUDING_THIS);
                u32::try_from(slot.0 as u32 as i32).unwrap()
            }
        }

        fn arguments(&self) -> &[JSValue] {
            // SAFETY: OFFSET_FIRST_ARGUMENT..+argumentsCount() are valid JSValue
            // slots in the JSC register file per the CallFrame layout.
            unsafe {
                core::slice::from_raw_parts(
                    self.as_unsafe_js_value_array().add(OFFSET_FIRST_ARGUMENT),
                    (self.argument_count_including_this() - 1) as usize,
                )
            }
        }

        /// `CallFrame.arguments_old` (CallFrame.zig) — fixed-size copy of up to
        /// `MAX` argument slots.
        pub fn arguments_old<const MAX: usize>(&self) -> Arguments<MAX> {
            let slice = self.arguments();
            debug_assert!(MAX <= 15);
            // PERF(port): was `switch { inline 1...15 => |count| ... }` comptime monomorphization — profile in Phase B
            let count = slice.len().min(MAX);
            if count == 0 {
                Arguments { ptr: [JSValue(0); MAX], len: 0 }
            } else {
                Arguments::<MAX>::init(count, slice.as_ptr())
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // bun.String JSC bridge (src/jsc/bun_string_jsc.rs / string.zig).
    // ──────────────────────────────────────────────────────────────────────
    pub mod bun_string_jsc {
        use super::{BunString__createUTF8ForJS, JSGlobalObject, JSValue, JsResult};

        /// `bun.String.createUTF8ForJS` (string.zig) — create a JS string value
        /// directly from UTF-8 bytes.
        pub fn create_utf8_for_js(global: &JSGlobalObject, utf8: &[u8]) -> JsResult<JSValue> {
            // SAFETY: FFI — `global` is live; ptr/len from a live &[u8].
            let v = unsafe { BunString__createUTF8ForJS(global, utf8.as_ptr(), utf8.len()) };
            // fromJSHostCall: zero ⇒ exception was thrown.
            if v.0 == 0 { Err(JSValue(0)) } else { Ok(v) }
        }
    }

    /// `jsc.toJSHostFn(comptime f)` (host_fn.zig) — wrap a safe Rust-signature
    /// host fn into the raw C ABI. Monomorphized over the fn item, mirroring
    /// Zig's comptime wrapper struct. The wrapper unwraps `JsResult` to
    /// `JSValue::ZERO` on error (the JSC convention for "exception pending").
    #[macro_export]
    macro_rules! to_js_host_fn {
        ($f:path) => {{
            unsafe extern "C" fn __wrap(
                global: *mut $crate::jsc_stub::JSGlobalObject,
                frame: *mut $crate::jsc_stub::CallFrame,
            ) -> $crate::jsc_stub::JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                match $f(unsafe { &*global }, unsafe { &*frame }) {
                    Ok(v) => v,
                    Err(_) => $crate::jsc_stub::JSValue(0),
                }
            }
            __wrap as $crate::jsc_stub::JSHostFn
        }};
    }

    extern crate alloc;
}
pub use jsc_stub::JsResult;

#[path = "SemverString_jsc.rs"]
pub mod SemverString_jsc;
#[path = "SemverObject.rs"]
pub mod SemverObject;

pub use SemverString_jsc::SemverStringJsc;
