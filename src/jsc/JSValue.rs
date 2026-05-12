//! ABI-compatible with `JSC::EncodedJSValue` — `#[repr(transparent)]` over the
//! encoded 64-bit JSC value. `PhantomData<*const ()>` makes the type
//! `!Send + !Sync` (PORTING.md §JSC types): JSValues are GC-cell pointers and
//! must never cross threads.
//!
//! In the future, this type will exclude `zero`, encoding it as `error.JSError`
//! instead.
//!
//! Ported from `src/jsc/JSValue.zig`.

use core::ffi::{c_char, c_void};
use core::marker::PhantomData;

use crate::array_buffer::MarkedArrayBuffer_deallocator;
use crate::{
    AnyPromise, ArrayBuffer, BuiltinName, JSArrayIterator, JSGlobalObject, JSInternalPromise,
    JSObject, JSPromise, JSString, JSType, JsClass, JsError, JsResult, ZigException,
    bun_string_jsc, ffi, host_fn,
};

/// ABI-compatible with `EncodedJSValue` (`#[repr(transparent)]` over the
/// encoded 64-bit word, `Copy`, `!Send`).
///
/// `PhantomData<*const ()>` enforces `!Send + !Sync` (negative impls are
/// nightly-only and not used here for portability of the auto-trait inference).
//
// TODO(port): inner type should be `i64` per spec; kept `usize` (same width on
// all supported 64-bit targets) to avoid a cascading bit-twiddle / pointer-cast
// rewrite across already-un-gated leaf modules that pattern-match on `.0`.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JSValue(pub usize, PhantomData<*const ()>);

/// Backing integer type for the encoded value (Zig: `enum(i64)`).
pub type BackingInt = i64;

const _: () = assert!(
    core::mem::size_of::<JSValue>() == core::mem::size_of::<i64>(),
    "JSValue must be 64 bits (EncodedJSValue ABI)"
);

// ──────────────────────────────────────────────────────────────────────────
// Tag constants (JSValue.zig:14-33).
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    /// Typically means an exception was thrown.
    pub const ZERO: JSValue = JSValue(0, PhantomData);
    pub const UNDEFINED: JSValue = JSValue(0xa, PhantomData);
    pub const NULL: JSValue = JSValue(0x2, PhantomData);
    pub const TRUE: JSValue = JSValue(0x7, PhantomData);
    pub const FALSE: JSValue = JSValue(0x6, PhantomData);

    /// `JSC::JSValue::ValueDeleted` (0x4) — sentinel returned by
    /// `getIfPropertyExistsImpl` / `fastGet` when the property does not exist.
    /// Deleted is a special encoding used in JSC hash-map internals for the
    /// null state; it is re-used here for "not present".
    pub const PROPERTY_DOES_NOT_EXIST: JSValue = JSValue(0x4, PhantomData);
    /// Zig spelling (`.property_does_not_exist_on_object`).
    pub const PROPERTY_DOES_NOT_EXIST_ON_OBJECT: JSValue = Self::PROPERTY_DOES_NOT_EXIST;

    pub const IS_POINTER: bool = false;

    /// Construct a JSValue from an opaque encoded bit-pattern (Zig: `@enumFromInt`).
    #[inline]
    pub const fn from_encoded(bits: usize) -> JSValue {
        JSValue(bits, PhantomData)
    }
    /// Read the raw encoded bit-pattern (Zig: `@intFromEnum`).
    #[inline]
    pub const fn encoded(self) -> usize {
        self.0
    }
    /// Signed view of the encoded bit-pattern (Zig backing type is `i64`).
    #[inline]
    pub const fn raw(self) -> i64 {
        self.0 as i64
    }
    #[inline]
    pub const fn from_raw(raw: i64) -> JSValue {
        JSValue(raw as usize, PhantomData)
    }

    /// Wrap a JSCell pointer as a JSValue (cell-tagged JSValues *are* the
    /// pointer — `NotCellMask` bits are zero). Mirrors `JSValue.fromCell`.
    #[inline]
    pub fn from_cell<T>(cell: *const T) -> JSValue {
        debug_assert!(!cell.is_null());
        JSValue(cell as usize, PhantomData)
    }

    /// `JSValue.fromPtrAddress` — encode an arbitrary native pointer as a JS
    /// number (round-trips via `as_promise_ptr`). Used to smuggle a `*mut T`
    /// context through `Promise.then` reaction arguments.
    #[inline]
    pub fn from_ptr_address(addr: usize) -> JSValue {
        // Matches Zig `fromPtrAddress` → `jsDoubleNumber` (always double-encoded;
        // never the int32 fast path), so `as_ptr_address` round-trips bit-exact.
        Self::js_double_number(addr as f64)
    }

    /// `JSValue.asPtrAddress` (JSValue.zig) — inverse of `from_ptr_address`:
    /// `@intFromFloat(this.asNumber())`.
    #[inline]
    pub fn as_ptr_address(self) -> usize {
        self.as_number() as usize
    }

    /// `JSValue.asPromisePtr` (JSValue.zig) — decode a `*mut T` smuggled
    /// through [`from_ptr_address`] as the trailing `.then` reaction argument.
    #[inline]
    pub fn as_promise_ptr<T>(self) -> *mut T {
        self.as_ptr_address() as *mut T
    }

    /// Attach `(resolve, reject)` reactions to this Promise, passing `ctx` as
    /// the trailing argument to each. Thin wrapper over `JSC__JSValue___then`.
    ///
    /// Port of `JSValue.then(ctx: ?*anyopaque, resolve, reject)` (JSValue.zig).
    /// The Zig version wraps in a `TopExceptionScope` and surfaces only
    /// termination; every current call site does `catch {}`, so this returns
    /// `()` and lets the caller's surrounding scope (or none) observe a
    /// termination on its next check.
    pub fn then<T>(
        self,
        global: &JSGlobalObject,
        ctx: *mut T,
        resolve: host_fn::JSHostFn,
        reject: host_fn::JSHostFn,
    ) {
        unsafe extern "C" {
            // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST
            // handle (`&` is ABI-identical to non-null `*mut`); remaining args
            // are by-value (`JSValue`, fn-ptrs).
            safe fn JSC__JSValue___then(
                this: JSValue,
                global: &JSGlobalObject,
                ctx: JSValue,
                resolve: host_fn::JSHostFn,
                reject: host_fn::JSHostFn,
            );
        }
        // Zig (JSValue.zig:1495): `TopExceptionScope` + `assertNoExceptionExceptTermination`.
        // Every current call site does `catch {}`, so swallow termination.
        crate::top_scope!(scope, global);
        JSC__JSValue___then(
            self,
            global,
            JSValue::from_ptr_address(ctx as usize),
            resolve,
            reject,
        );
        let _ = scope.assert_no_exception_except_termination();
    }

    /// Like [`then`] but the context is a `JSValue` (not a raw pointer encoded
    /// as a JS number). Port of `JSValue.then2` (JSValue.zig:1487). The Zig
    /// version wraps in a `TopExceptionScope` and surfaces only termination;
    /// every current call site does `catch {}`, so this returns `()`.
    pub fn then2(
        self,
        global: &JSGlobalObject,
        ctx: JSValue,
        resolve: host_fn::JSHostFn,
        reject: host_fn::JSHostFn,
    ) {
        unsafe extern "C" {
            // safe: see decl in `then` above.
            safe fn JSC__JSValue___then(
                this: JSValue,
                global: &JSGlobalObject,
                ctx: JSValue,
                resolve: host_fn::JSHostFn,
                reject: host_fn::JSHostFn,
            );
        }
        // Zig (JSValue.zig:1487): `TopExceptionScope` + `assertNoExceptionExceptTermination`.
        crate::top_scope!(scope, global);
        JSC__JSValue___then(self, global, ctx, resolve, reject);
        let _ = scope.assert_no_exception_except_termination();
    }

    /// Like [`then`], but the context is a `JSValue` instead of a raw pointer.
    /// Use this when the context should be GC-managed (e.g. a JSCell that gets
    /// collected with the Promise's reaction if the Promise is GC'd without
    /// settling). Port of `JSValue.thenWithValue` (JSValue.zig).
    ///
    /// The Zig version wraps in a `TopExceptionScope` and surfaces only
    /// termination; every current call site does `catch {}`, so this returns
    /// `()` and lets the caller's surrounding scope (or none) observe a
    /// termination on its next check.
    #[inline]
    pub fn then_with_value(
        self,
        global: &JSGlobalObject,
        ctx: JSValue,
        resolve: host_fn::JSHostFn,
        reject: host_fn::JSHostFn,
    ) {
        self.then2(global, ctx, resolve, reject)
    }

    /// `@enumFromInt(@bitCast(@intFromPtr(ptr)))`.
    #[inline]
    pub fn cast<T>(ptr: *const T) -> JSValue {
        JSValue(ptr as usize, PhantomData)
    }
}

// `pub fn format(...) !void { @compileError(...) }` — intentionally NOT
// implementing `Display`. Formatting a JSValue directly is not allowed; use
// `jsc::ConsoleObject::Formatter`.

// ──────────────────────────────────────────────────────────────────────────
// Tag predicates (inline mirrors of JSValue.zig).
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    #[inline]
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
    #[inline]
    pub fn is_undefined(self) -> bool {
        self.0 == Self::UNDEFINED.0
    }
    #[inline]
    pub fn is_null(self) -> bool {
        self.0 == Self::NULL.0
    }
    #[inline]
    pub fn is_undefined_or_null(self) -> bool {
        // Zig: `return @intFromEnum(this) | 0x8 == 0xa;`
        (self.0 | 0x8) == 0xa
    }
    #[inline]
    pub fn is_empty_or_undefined_or_null(self) -> bool {
        self.is_empty() || self.is_undefined_or_null()
    }
    #[inline]
    pub fn is_boolean(self) -> bool {
        self.0 == Self::TRUE.0 || self.0 == Self::FALSE.0
    }
    #[inline]
    pub fn is_cell(self) -> bool {
        // NotCellMask = NumberTag | OtherTag (0xfffe_0000_0000_0000 | 0x2).
        const NOT_CELL_MASK: usize = 0xfffe_0000_0000_0002;
        !self.is_empty() && (self.0 & NOT_CELL_MASK) == 0
    }
    #[inline]
    pub fn is_int32(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) == NUMBER_TAG
    }
    #[inline]
    pub fn is_number(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) != 0
    }
    #[inline]
    pub fn is_double(self) -> bool {
        self.is_number() && !self.is_int32()
    }
    #[inline]
    pub fn is_any_int(self) -> bool {
        JSC__JSValue__isAnyInt(self)
    }
    /// ECMA-262 20.1.2.3 `Number.isInteger` (JSValue.zig:124).
    #[inline]
    pub fn is_integer(self) -> bool {
        if self.is_int32() {
            return true;
        }
        if self.is_double() {
            let num = self.as_double();
            if num.is_finite() && num.trunc() == num {
                return true;
            }
        }
        false
    }
    #[inline]
    pub fn is_string(self) -> bool {
        self.is_cell() && self.js_type().is_string_like()
    }
    /// `JSValue.isStringLiteral` (JSValue.zig) — primitive string only
    /// (`JSType::String`); excludes `StringObject` / `DerivedStringObject`.
    #[inline]
    pub fn is_string_literal(self) -> bool {
        self.is_cell() && self.js_type().is_string()
    }
    /// `JSValue.isPrimitive` — true for non-cell or string/symbol/bigint cells.
    #[inline]
    pub fn is_primitive(self) -> bool {
        JSC__JSValue__isPrimitive(self)
    }
    #[inline]
    pub fn is_object(self) -> bool {
        self.is_cell() && self.js_type().is_object()
    }
    #[inline]
    pub fn is_array(self) -> bool {
        self.is_cell() && self.js_type().is_array()
    }
    #[inline]
    pub fn is_date(self) -> bool {
        self.is_cell() && self.js_type() == JSType::JSDate
    }
    #[inline]
    pub fn is_symbol(self) -> bool {
        JSC__JSValue__isSymbol(self)
    }
    #[inline]
    pub fn is_big_int(self) -> bool {
        JSC__JSValue__isBigInt(self)
    }
    /// `JSValue.isBigInt32()` (JSValue.zig:1073) — true iff this value uses
    /// JSC's packed BigInt32 immediate representation (vs heap `JSBigInt`).
    #[inline]
    pub fn is_big_int32(self) -> bool {
        unsafe extern "C" {
            safe fn JSC__JSValue__isBigInt32(this: JSValue) -> bool;
        }
        JSC__JSValue__isBigInt32(self)
    }
    /// `JSValue.isHeapBigInt()` (JSValue.zig:1070) — true iff this is a
    /// heap-allocated `JSBigInt` cell. Distinct from [`is_big_int`], which
    /// also returns `true` for the packed `BigInt32` immediate.
    #[inline]
    pub fn is_heap_big_int(self) -> bool {
        unsafe extern "C" {
            safe fn JSC__JSValue__isHeapBigInt(this: JSValue) -> bool;
        }
        JSC__JSValue__isHeapBigInt(self)
    }
    /// `JSValue.isBigIntInInt64Range` (JSValue.zig:40) — `self` must already be
    /// known to be a BigInt; checks `min <= self <= max` without truncation.
    #[inline]
    pub fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool {
        unsafe extern "C" {
            safe fn JSC__isBigIntInInt64Range(this: JSValue, min: i64, max: i64) -> bool;
        }
        JSC__isBigIntInInt64Range(self, min, max)
    }
    /// `JSValue.isBigIntInUInt64Range` (JSValue.zig:36).
    #[inline]
    pub fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool {
        unsafe extern "C" {
            safe fn JSC__isBigIntInUInt64Range(this: JSValue, min: u64, max: u64) -> bool;
        }
        JSC__isBigIntInUInt64Range(self, min, max)
    }
    /// `JSValue.isCallable()` (JSValue.zig:1159).
    #[inline]
    pub fn is_callable(self) -> bool {
        JSC__JSValue__isCallable(self)
    }
    /// `JSValue.isFunction()` (JSValue.zig:1094) — JSType-byte check, NOT
    /// `isCallable()`. Callable proxies return `false` here but `true` from
    /// `is_callable()`.
    #[inline]
    pub fn is_function(self) -> bool {
        self.is_cell() && self.js_type().is_function()
    }
    /// `JSValue.isAnyError()` — Error, Exception, or has `[Symbol.error]`.
    #[inline]
    pub fn is_any_error(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        JSC__JSValue__isAnyError(self)
    }
    /// `JSValue.isError()` (JSValue.zig:999) — true iff this is an
    /// `ErrorInstance` cell (does NOT match `Exception`).
    #[inline]
    pub fn is_error(self) -> bool {
        self.is_cell() && self.js_type() == JSType::ErrorInstance
    }
    /// `JSValue.isJSXElement(globalObject)` (JSValue.zig:56). Checks via the
    /// global's `Symbol.for("react.element")` / `Symbol.for("react.transitional.element")`
    /// for `$$typeof`; may invoke a user getter and throw.
    pub fn is_jsx_element(self, global: &JSGlobalObject) -> JsResult<bool> {
        unsafe extern "C" {
            safe fn JSC__JSValue__isJSXElement(this: JSValue, global: &JSGlobalObject) -> bool;
        }
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__isJSXElement(self, global))
    }
    /// `JSValue.isAggregateError(globalObject)` (JSValue.zig:2194).
    #[inline]
    pub fn is_aggregate_error(self, global: &JSGlobalObject) -> bool {
        unsafe extern "C" {
            safe fn JSC__JSValue__isAggregateError(this: JSValue, global: &JSGlobalObject) -> bool;
        }
        JSC__JSValue__isAggregateError(self, global)
    }
    /// `JSValue.getErrorsProperty(globalObject)` (JSValue.zig:552). Returns the
    /// own `errors` data property via `JSObject::getDirect` — no prototype
    /// walk, no getters invoked, nothrow. Used for `AggregateError.errors`.
    #[inline]
    pub fn get_errors_property(self, global: &JSGlobalObject) -> JSValue {
        unsafe extern "C" {
            safe fn JSC__JSValue__getErrorsProperty(
                this: JSValue,
                global: &JSGlobalObject,
            ) -> JSValue;
        }
        JSC__JSValue__getErrorsProperty(self, global)
    }
    /// `JSValue.isTerminationException()` (JSValue.zig:1182) — true if this
    /// value is the VM's termination-exception sentinel.
    #[inline]
    pub fn is_termination_exception(self) -> bool {
        JSC__JSValue__isTerminationException(self)
    }
    /// `JSValue.isException(vm)` (JSValue.zig:1169) — true if this value is a
    /// `JSC::Exception` cell.
    #[inline]
    pub fn is_exception(self, vm: *mut crate::VM) -> bool {
        // `VM` is an `opaque_ffi!` ZST handle; `opaque_ref` is the centralised
        // zero-byte deref proof, so no `unsafe` is needed at this call site.
        JSC__JSValue__isException(self, crate::VM::opaque_ref(vm))
    }
    /// `JSValue.asException(vm)` (JSValue.zig:1174) — cast to `*mut Exception`
    /// if `is_exception`, else null. The returned pointer borrows the GC cell;
    /// callers must keep `self` alive (the only callsite —
    /// `runErrorHandler` — holds it on the stack).
    #[inline]
    pub fn as_exception(self, vm: *mut crate::VM) -> Option<*mut crate::Exception> {
        if self.is_exception(vm) {
            // SAFETY: `is_exception` proved the cell is a `JSC::Exception`;
            // the encoded value is the cell pointer (Zig `uncheckedPtrCast`).
            Some(self.0 as *mut crate::Exception)
        } else {
            None
        }
    }
    #[inline]
    pub fn is_falsey(self) -> bool {
        !self.to_boolean()
    }
    #[inline]
    pub fn is_truthy(self) -> bool {
        self.to_boolean()
    }

    /// `jsType()` — only valid when `is_cell()`. Reads the JSCell type byte.
    ///
    /// Source-inlined body of `JSC__JSValue__jsType` (bindings.cpp:2755) so the
    /// 2-insn fast path survives no-LTO targets (e.g. aarch64-musl, where
    /// cross-language LTO is disabled — config.ts:631). With the FFI shim the
    /// call cannot inline into Rust callers and shows up as a separate symbol;
    /// the real body is just `movzbl 0x5(%rdi),%eax` after the cell check.
    #[inline]
    pub fn js_type(self) -> JSType {
        if self.is_cell() {
            // `JSCell::m_type` lives at byte offset 5 of every cell header
            // (StructureID:u32, indexingTypeAndMisc:u8, type:u8, …) — see
            // JSType.rs module doc and `JSCell::typeInfoTypeOffset()`.
            // SAFETY: `is_cell()` proved `self.0` is a non-null GC-heap cell
            // pointer; the header byte at +5 is always initialized. `JSType`
            // is `#[repr(transparent)] u8`, so any byte is a valid value.
            unsafe { JSType(*(self.0 as *const u8).add(5)) }
        } else {
            // C++ returns 0 (`CellType`) for non-cells.
            JSType::Cell
        }
    }

    /// `jsTypeLoose()` (JSValue.zig:291) — `js_type` but maps non-cell numbers
    /// to `NumberObject` so callers can switch on `JSType` without a separate
    /// `is_number()` arm.
    #[inline]
    pub fn js_type_loose(self) -> JSType {
        if self.is_number() {
            JSType::NumberObject
        } else {
            self.js_type()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Constructors.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    #[inline]
    pub fn js_boolean(b: bool) -> JSValue {
        if b { Self::TRUE } else { Self::FALSE }
    }
    #[inline]
    pub fn js_number_from_int32(i: i32) -> JSValue {
        // NumberTag | i (low 32 bits).
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        JSValue(NUMBER_TAG | (i as u32 as usize), PhantomData)
    }
    pub fn js_number_from_uint64(i: u64) -> JSValue {
        if i <= i32::MAX as u64 {
            Self::js_number_from_int32(i as i32)
        } else {
            Self::js_number(i as f64)
        }
    }
    /// `JSValue.jsNumberFromInt64` (JSValue.zig:814) — int32 fast-path,
    /// otherwise lossy double.
    pub fn js_number_from_int64(i: i64) -> JSValue {
        if i <= i32::MAX as i64 && i >= i32::MIN as i64 {
            Self::js_number_from_int32(i as i32)
        } else {
            Self::js_number(i as f64)
        }
    }
    pub fn js_number(n: f64) -> JSValue {
        JSC__JSValue__jsNumberFromDouble(n)
    }
    /// `JSValue::jsDoubleNumber` (JSCJSValueInlines.h) — boxes an `f64`
    /// *always* as a double-encoded immediate (no int32 fast path). Required
    /// when the consumer round-trips through `f64::to_bits` / `as_number` and
    /// must see the original bit pattern (e.g. [`from_ptr_address`]).
    #[inline]
    pub fn js_double_number(n: f64) -> JSValue {
        const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << 49;
        JSValue::from_raw((n.to_bits() as i64).wrapping_add(DOUBLE_ENCODE_OFFSET))
    }
    pub fn js_empty_string(global: &JSGlobalObject) -> JSValue {
        JSC__JSValue__jsEmptyString(global)
    }
    pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
        JSC__JSValue__createEmptyObject(global, len)
    }
    pub fn create_empty_object_with_null_prototype(global: &JSGlobalObject) -> JSValue {
        JSC__JSValue__createEmptyObjectWithNullPrototype(global)
    }
    /// `JSValue.createObject2` (JSValue.zig:536) — `{ [key1]: value1, [key2]: value2 }`.
    pub fn create_object2(
        global: &JSGlobalObject,
        key1: &bun_core::ZigString,
        key2: &bun_core::ZigString,
        value1: JSValue,
        value2: JSValue,
    ) -> JsResult<JSValue> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__createObject2(global, key1, key2, value1, value2)
        })
    }
    #[track_caller]
    pub fn create_empty_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        // Zig: `fromJSHostCall` (== `call_zero_is_throw`).
        crate::call_zero_is_throw(global, || JSC__JSValue__createEmptyArray(global, len))
    }
    /// Replaces the hand-stamped `create_empty_array` + `enumerate` +
    /// `put_index` loop. `iter` must be `ExactSizeIterator` so the array is
    /// pre-sized; `f` maps each item to a `JsResult<JSValue>` (early-returns on
    /// throw, leaving the partially-filled array unreferenced for GC). Index is
    /// truncated to `u32` — `JSArray` indices are 32-bit and
    /// `create_empty_array` would already have thrown for `len > u32::MAX`,
    /// so the cast is a no-op for every reachable caller.
    #[track_caller]
    pub fn create_array_from_iter<I, T, F>(
        global: &JSGlobalObject,
        iter: I,
        mut f: F,
    ) -> JsResult<JSValue>
    where
        I: ExactSizeIterator<Item = T>,
        F: FnMut(T) -> JsResult<JSValue>,
    {
        let array = Self::create_empty_array(global, iter.len())?;
        for (i, item) in iter.enumerate() {
            array.put_index(global, i as u32, f(item)?)?;
        }
        Ok(array)
    }
    /// [`create_array_from_iter`](Self::create_array_from_iter) specialised
    /// for an already-materialised `&[JSValue]` (no per-element map).
    #[track_caller]
    pub fn create_array_from_slice(global: &JSGlobalObject, items: &[JSValue]) -> JsResult<JSValue> {
        Self::create_array_from_iter(global, items.iter().copied(), Ok)
    }
    /// `JSValue.createBufferFromLength` (JSValue.zig:557) — allocates a Node.js
    /// `Buffer` (the `JSBufferSubclassStructure` Uint8Array subclass) of `len`
    /// zeroed bytes via `JSBuffer__bufferFromLength`. May throw OOM.
    pub fn create_buffer_from_length(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        crate::mark_binding!();
        host_fn::from_js_host_call(global, || JSBuffer__bufferFromLength(global, len as i64))
    }
    pub fn create_buffer(global: &JSGlobalObject, slice: &mut [u8]) -> JSValue {
        // JSValue.zig:createBuffer — wraps `JSBuffer__bufferFromPointerAndLengthAndDeinit`
        // with `MarkedArrayBuffer_deallocator` (or null for empty slices).
        // SAFETY: `global` is live; slice ptr/len describe a valid range whose
        // ownership is transferred to JSC (freed via the deallocator).
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global,
                slice.as_mut_ptr(),
                slice.len(),
                core::ptr::null_mut(),
                if slice.is_empty() {
                    None
                } else {
                    Some(MarkedArrayBuffer_deallocator)
                },
            )
        }
    }
    /// Take ownership of a mimalloc-backed `Box<[u8]>` and wrap it in a Node
    /// `Buffer` without copying. Ownership transfers to JSC; freed via
    /// `MarkedArrayBuffer_deallocator` on GC. Prefer this over `Box::leak` +
    /// [`JSValue::create_buffer`] so the FFI hand-off is explicit at call sites.
    pub fn create_buffer_from_box(global: &JSGlobalObject, bytes: Box<[u8]>) -> JSValue {
        let len = bytes.len();
        // `into_raw` (not `leak`) — this is an FFI ownership transfer, paired
        // with `mi_free` in `MarkedArrayBuffer_deallocator`. An empty
        // `Box<[u8]>` has no backing allocation, so the `None` arm leaks
        // nothing.
        let ptr = bun_core::heap::into_raw(bytes).cast::<u8>();
        // SAFETY: `global` is live; `ptr`/`len` describe the just-released
        // mimalloc allocation whose ownership is transferred to JSC.
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global,
                ptr,
                len,
                core::ptr::null_mut(),
                if len == 0 {
                    None
                } else {
                    Some(MarkedArrayBuffer_deallocator)
                },
            )
        }
    }
    /// `JSValue.createBufferWithCtx` (JSValue.zig) — wrap a foreign-owned byte
    /// range in a Node `Buffer`, transferring ownership to JS. `free(ctx, ptr)`
    /// runs when the Buffer's backing store is collected.
    pub fn create_buffer_with_ctx(
        global: &JSGlobalObject,
        bytes: core::ptr::NonNull<[u8]>,
        ctx: *mut c_void,
        free: unsafe extern "C" fn(*mut c_void, *mut c_void),
    ) -> JSValue {
        let len = bytes.len();
        // SAFETY: `global` is live; `bytes` describes a valid range whose
        // ownership transfers to JSC and is released via `free` on collection.
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global,
                bytes.as_ptr().cast::<u8>(),
                len,
                ctx,
                Some(free),
            )
        }
    }
    pub fn from_date_string(global: &JSGlobalObject, s: &core::ffi::CStr) -> JSValue {
        // SAFETY: `global` is live; `s` is a valid NUL-terminated C string.
        unsafe { JSC__JSValue__dateInstanceFromNullTerminatedString(global, s.as_ptr()) }
    }
    pub fn from_date_number(global: &JSGlobalObject, value: f64) -> JSValue {
        JSC__JSValue__dateInstanceFromNumber(global, value)
    }
    pub fn from_int64_no_truncate(global: &JSGlobalObject, i: i64) -> JSValue {
        JSC__JSValue__fromInt64NoTruncate(global, i)
    }
    pub fn from_uint64_no_truncate(global: &JSGlobalObject, i: u64) -> JSValue {
        JSC__JSValue__fromUInt64NoTruncate(global, i)
    }
    /// `JSValue.fromTimevalNoTruncate` (JSValue.zig:1227) — encode a `struct timeval`
    /// as a BigInt (`sec * 1_000_000 + nsec`) without precision loss. May allocate
    /// a heap BigInt, so wrapped in `from_js_host_call` for exception checking.
    pub fn from_timeval_no_truncate(
        global: &JSGlobalObject,
        nsec: i64,
        sec: i64,
    ) -> JsResult<JSValue> {
        host_fn::from_js_host_call(global, || {
            JSC__JSValue__fromTimevalNoTruncate(global, nsec, sec)
        })
    }
    /// `JSValue.bigIntSum` (JSValue.zig:1232) — `a + b` where both are BigInt.
    /// Infallible per the Zig signature (no `JSError!`).
    pub fn big_int_sum(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JSValue {
        JSC__JSValue__bigIntSum(global, a, b)
    }
    /// `JSValue.fromEntries` (JSValue.zig:757) — build a plain object from
    /// parallel `keys`/`values` `ZigString` arrays. When `clone` is true the
    /// C++ side copies the string bytes (caller may free `keys`/`values`).
    pub fn from_entries(
        global: &JSGlobalObject,
        keys: &mut [bun_core::ZigString],
        values: &mut [bun_core::ZigString],
        clone: bool,
    ) -> JSValue {
        debug_assert_eq!(keys.len(), values.len());
        // SAFETY: `global` is live; `keys`/`values` are valid for `keys.len()`
        // elements; the C++ binding only reads (and optionally clones) them.
        unsafe {
            JSC__JSValue__fromEntries(
                global,
                keys.as_mut_ptr(),
                values.as_mut_ptr(),
                keys.len(),
                clone,
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Conversions.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    #[inline]
    pub fn to_boolean(self) -> bool {
        // JSValue.zig:2103 — `this != .zero and JSC__JSValue__toBoolean(this)`.
        !self.is_empty() && JSC__JSValue__toBoolean(self)
    }
    #[inline]
    pub fn as_boolean(self) -> bool {
        debug_assert!(self.is_boolean());
        self.0 == Self::TRUE.0
    }
    #[inline]
    pub fn as_int32(self) -> i32 {
        debug_assert!(self.is_int32());
        (self.0 & 0xffff_ffff) as u32 as i32
    }
    #[inline]
    pub fn as_double(self) -> f64 {
        debug_assert!(self.is_double());
        // FFI.zig: JSVALUE_TO_DOUBLE — subtract DoubleEncodeOffset, bitcast to f64.
        f64::from_bits((self.0 as i64).wrapping_sub(ffi::DOUBLE_ENCODE_OFFSET) as u64)
    }
    /// Asserts this is a number, undefined, null, or a boolean.
    pub fn as_number(self) -> f64 {
        if self.is_int32() {
            self.as_int32() as f64
        } else if self.is_number() {
            self.as_double()
        } else if self.is_undefined_or_null() {
            0.0
        } else if self.is_boolean() {
            if self.as_boolean() { 1.0 } else { 0.0 }
        } else {
            f64::NAN
        }
    }
    #[inline]
    pub fn get_number(self) -> Option<f64> {
        if self.is_number() {
            Some(self.as_number())
        } else {
            None
        }
    }
    pub fn to_int32(self) -> i32 {
        if self.is_int32() {
            return (self.0 & 0xffff_ffff) as u32 as i32;
        }
        if let Some(num) = self.get_number() {
            // JSValue.zig:2129 — coerceJSValueDoubleTruncatingT(i32, num):
            // NaN → 0, ±Inf/out-of-range → saturate to i32 MIN/MAX, else truncate.
            if num.is_nan() {
                return 0;
            }
            return num as i32; // Rust `as` saturates on overflow, matching coerceJSValueDoubleTruncatingT
        }
        JSC__JSValue__toInt32(self)
    }
    pub fn to_int64(self) -> i64 {
        if self.is_int32() {
            return self.as_int32() as i64;
        }
        if let Some(num) = self.get_number() {
            // JSValue.zig:916 — coerceDoubleTruncatingIntoInt64.
            if num.is_nan() {
                return 0;
            }
            return num as i64; // saturating truncation
        }
        JSC__JSValue__toInt64(self)
    }
    /// `JSValue.asInt52()` (JSValue.zig:2116) — saturating-truncate
    /// `as_number()` into i52 range, returned widened to i64. NaN → 0;
    /// out-of-range / ±Inf saturate to i52 MIN/MAX.
    #[inline]
    pub fn as_int52(self) -> i64 {
        debug_assert!(self.is_number());
        const I52_MIN: i64 = -(1 << 51);
        const I52_MAX: i64 = (1 << 51) - 1;
        let num = self.as_number();
        if num.is_nan() {
            return 0;
        }
        if num <= I52_MIN as f64 {
            return I52_MIN;
        }
        if num >= I52_MAX as f64 {
            return I52_MAX;
        }
        num as i64
    }
    /// `JSValue.toU32()` (JSValue.zig:2160) — clamp `toInt64()` into
    /// `[0, u32::MAX]`. Negative → 0, overflow → `u32::MAX`. Distinct from
    /// JS `ToUint32` (which wraps modulo 2³²); this is a Bun-side saturating
    /// helper used by matchers/bindings that want a non-negative count.
    #[inline]
    pub fn to_u32(self) -> u32 {
        self.to_int64().clamp(0, u32::MAX as i64) as u32
    }
    /// `JSValue.isUInt32AsAnyInt()` (JSValue.zig) — true iff this value is a
    /// non-negative integer (Int32 fast-path or integral double in u32 range).
    #[inline]
    pub fn is_uint32_as_any_int(self) -> bool {
        unsafe extern "C" {
            safe fn JSC__JSValue__isUInt32AsAnyInt(this: JSValue) -> bool;
        }
        JSC__JSValue__isUInt32AsAnyInt(self)
    }
    /// `JSValue.toUInt64NoTruncate()` (JSValue.zig) — read a non-negative
    /// integer (Int32/double/BigInt) as `u64` without going through ToNumber.
    #[inline]
    pub fn to_uint64_no_truncate(self) -> u64 {
        unsafe extern "C" {
            safe fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
        }
        JSC__JSValue__toUInt64NoTruncate(self)
    }
    /// `JSValue.createUninitializedUint8Array(global, len)` — allocate a new
    /// `Uint8Array` of `len` bytes without zeroing. Backing memory is
    /// uninitialized; caller must write every byte before exposing it to JS.
    /// May throw (OOM) — Zig spec wraps via `fromJSHostCall`.
    #[inline]
    pub fn create_uninitialized_uint8_array(
        global: &JSGlobalObject,
        len: usize,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            safe fn JSC__JSValue__createUninitializedUint8Array(
                global: &JSGlobalObject,
                len: usize,
            ) -> JSValue;
        }
        host_fn::from_js_host_call(global, || {
            JSC__JSValue__createUninitializedUint8Array(global, len)
        })
    }
    pub fn coerce_to_i32(self, global: &JSGlobalObject) -> JsResult<i32> {
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__coerceToInt32(self, global))
    }
    /// `JSValue.coerceToInt64` (JSValue.zig:47) — full ToNumber → Int64 path
    /// (may throw via `valueOf`/`toString`).
    pub fn coerce_to_int64(self, global: &JSGlobalObject) -> JsResult<i64> {
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__coerceToInt64(self, global))
    }
    /// Generic coercion (`coerce(comptime T)` in Zig). Per-type helpers are
    /// `coerce_to_i32` / `coerce_f64` etc.; this fronts the i32 path.
    pub fn coerce<T: CoerceTo>(self, global: &JSGlobalObject) -> JsResult<T> {
        T::coerce_from(self, global)
    }
    #[track_caller]
    pub fn to_js_string<'a>(self, global: &'a JSGlobalObject) -> JsResult<&'a JSString> {
        // `[[ZIG_EXPORT(null_is_throw)]]` — null ⟺ threw.
        // S008: `JSString` is an `opaque_ffi!` ZST, so the non-null pointer
        // returned on the `Ok` path is safely reborrowed via `opaque_ref`
        // (zero-byte deref; see `bun_opaque::opaque_deref`).
        crate::call_null_is_throw(global, || JSC__JSValue__toStringOrNull(self, global))
            .map(|p| JSString::opaque_ref(p.as_ptr()))
    }
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<bun_core::String> {
        bun_string_jsc::from_js(self, global)
    }
    pub fn to_zig_string(
        self,
        out: &mut bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__toZigString(self, out, global))
    }
    pub fn to_slice(self, global: &JSGlobalObject) -> JsResult<bun_core::ZigStringSlice> {
        // Spec (JSValue.zig `toSlice`): `bun.String.fromJS` → `defer str.deref()`
        // → `toUTF8`. `to_bun_string` returns a +1 ref; `bun_core::String` is
        // `Copy` (no `Drop`), so wrap in `OwnedString` for the scope-exit
        // `deref()`. `to_utf8()` takes its own ref (or owned alloc) so the
        // slice survives the drop.
        let s = bun_core::OwnedString::new(self.to_bun_string(global)?);
        Ok(s.to_utf8())
    }
    /// Call `toString()` on the JSValue and clone the result.
    /// On exception or out of memory, this returns a `JsError`.
    ///
    /// Remember that `Symbol` throws an exception when you call `toString()`.
    ///
    /// Spec (JSValue.zig `toSliceClone` → `toSliceCloneWithAllocator`): the
    /// returned slice is *always* heap-owned and independent of the backing
    /// `JSString` cell, so it outlives GC. Allocator param dropped per
    /// PORTING.md (default_allocator only).
    pub fn to_slice_clone(self, global: &JSGlobalObject) -> JsResult<bun_core::ZigStringSlice> {
        self.to_js_string(global)?.to_slice_clone(global)
    }
    /// Call `toString()` on the JSValue and clone the result.
    ///
    /// Spec (JSValue.zig `toSliceOrNull`): `bun.String.fromJS` →
    /// `defer str.deref()` → `toUTF8` with the default allocator.
    /// `bun_core::String` is `Copy` and has NO `Drop`; the RAII spelling of
    /// Zig's `defer str.deref()` is `OwnedString`. `to_utf8()` refs the
    /// underlying WTFStringImpl (or heap-clones) so the slice survives the
    /// `OwnedString` drop.
    pub fn to_slice_or_null(self, global: &JSGlobalObject) -> JsResult<bun_core::ZigStringSlice> {
        let s = bun_core::OwnedString::new(self.to_bun_string(global)?);
        Ok(s.to_utf8())
    }
    pub fn to_zig_exception(self, global: &JSGlobalObject, exception: &mut ZigException) {
        JSC__JSValue__toZigException(self, global, exception)
    }
    pub fn to_error(self) -> Option<JSValue> {
        let v = JSC__JSValue__toError_(self);
        if v.is_empty() { None } else { Some(v) }
    }
    /// Map a JS string value to an enum via the type's `phf` map (Zig `toEnum`).
    pub fn to_enum<E: FromJsEnum>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<E> {
        E::from_js_value(self, global, property_name)
    }
    pub fn as_string(self) -> *mut JSString {
        debug_assert!(self.is_string());
        JSC__JSValue__asString(self)
    }
    /// `jsTypeString()` — calls `JSC::jsTypeStringForValue`, returning the
    /// JS `typeof` result as a `JSString*` cell (e.g. `"object"`, `"number"`).
    /// Never throws; lifetime tied to `global` (cell is GC-rooted by the VM's
    /// SmallStrings table).
    pub fn js_type_string<'a>(self, global: &'a JSGlobalObject) -> &'a JSString {
        // FFI returns a non-null SmallStrings cell (opaque ZST handle).
        JSString::opaque_ref(JSC__jsTypeStringForValue(global, self))
    }
    pub fn as_array_buffer(self, global: &JSGlobalObject) -> Option<ArrayBuffer> {
        let mut out = ArrayBuffer::default();
        if JSC__JSValue__asArrayBuffer(self, global, &mut out) {
            out.value = self;
            Some(out)
        } else {
            None
        }
    }
    /// Generic downcast (`as(comptime T)` in Zig). Dispatches via [`JsClass::from_js`].
    #[inline]
    pub fn as_<T: JsClass>(self) -> Option<*mut T> {
        if !self.is_cell() {
            return None;
        }
        T::from_js(self)
    }
    /// `JSValue.asDirect(T)` (JSValue.zig:431) — unchecked-prototype downcast.
    /// Caller must have already verified `is_cell()`; dispatches via
    /// [`JsClass::from_js_direct`] (skips the prototype-chain walk that `as_`
    /// performs, so subclasses are *not* matched).
    #[inline]
    pub fn as_direct<T: JsClass>(self) -> Option<*mut T> {
        debug_assert!(self.is_cell());
        T::from_js_direct(self)
    }
    /// Safe shared-borrow downcast — `as_<T>()` followed by `&*ptr`.
    ///
    /// Returns `Some(&T)` when `self` wraps a live `T` cell. The borrow is
    /// sound because JSC's conservative stack scanner keeps the cell alive
    /// while `self` (the encoded `JSValue`) is on the stack, and the
    /// `#[JsClass]` payload is pinned at a stable address inside the GC cell
    /// for its lifetime — so a `&T` derived from `from_js`'s pointer is valid
    /// for as long as the caller holds `self`.
    ///
    /// The `'static` lifetime is a pragmatic over-approximation (there is no
    /// stack-root guard type to tie it to); callers MUST NOT stash the
    /// reference past the point where `self` is last used. This mirrors the
    /// raw-pointer contract of [`as_`](Self::as_) but lets read-only callers
    /// drop their `unsafe { &*p }` boilerplate.
    ///
    /// There is intentionally **no** `as_class_mut`: re-entry into JS (via a
    /// getter, `toString`, etc.) can produce a second `JSValue` for the same
    /// cell and thus a second `&mut T`, which is instant UB. Callers needing
    /// mutation must keep using [`as_`](Self::as_) and scope the `&mut`
    /// themselves.
    #[inline]
    pub fn as_class_ref<T: JsClass>(self) -> Option<&'static T> {
        // SAFETY: `T::from_js` returns either `None` or a non-null, properly
        // aligned pointer to the `T` payload owned by the live JSC cell that
        // `self` encodes. The cell is kept alive by JSC's conservative stack
        // scan for as long as `self` is reachable on the stack, so the shared
        // borrow is valid for the caller's frame. We never hand out `&mut`,
        // so aliasing with other `as_class_ref` borrows is fine.
        self.as_::<T>().map(|p| unsafe { &*p })
    }
    /// `JSValue.asPromise()` — downcast to `JSPromise` (matches `JSInternalPromise` too).
    /// Returns a raw pointer (mirrors Zig `?*JSPromise`); conjuring a
    /// `&'static mut` here would permit aliased `&mut` UB across two calls on
    /// the same value (PORTING.md §Forbidden).
    pub fn as_promise(self) -> Option<*mut JSPromise> {
        if !self.is_cell() {
            return None;
        }
        let p = JSC__JSValue__asPromise(self);
        if p.is_null() { None } else { Some(p) }
    }
    /// `JSValue.asInternalPromise()` — downcast to `JSInternalPromise`.
    /// Returns a raw pointer (mirrors Zig `?*JSInternalPromise`); see
    /// [`as_promise`] for the aliasing rationale.
    pub fn as_internal_promise(self) -> Option<*mut JSInternalPromise> {
        if !self.is_cell() {
            return None;
        }
        let p = JSC__JSValue__asInternalPromise(self);
        if p.is_null() { None } else { Some(p) }
    }
    pub fn as_any_promise(self) -> Option<AnyPromise> {
        if !self.is_cell() {
            return None;
        }
        // JSValue.zig:657 — check internal FIRST (JSInternalPromise extends JSPromise,
        // so `asPromise` would also match it and misclassify).
        let p = JSC__JSValue__asInternalPromise(self);
        if !p.is_null() {
            return Some(AnyPromise::Internal(p));
        }
        let p = JSC__JSValue__asPromise(self);
        if !p.is_null() {
            return Some(AnyPromise::Normal(p));
        }
        None
    }
    /// `JSValue.attachAsyncStackFromPromise(global, promise)` — append the
    /// promise's await-chain frames to this error's stack.
    ///
    /// `this` is the error value (must be a `JSError` or `Exception` cell);
    /// no-op otherwise — see `bindings.cpp:Bun__attachAsyncStackFromPromise`.
    pub fn attach_async_stack_from_promise(self, global: &JSGlobalObject, promise: &JSPromise) {
        Bun__attachAsyncStackFromPromise(global, self, promise)
    }
    pub fn get_unix_timestamp(self) -> f64 {
        JSC__JSValue__getUnixTimestamp(self)
    }
    /// Returns `(ptr, len)` of the cell's `ClassInfo` name (static C string).
    pub fn get_class_info_name(self) -> Option<&'static [u8]> {
        if !self.is_cell() {
            return None;
        }
        let mut ptr: *const u8 = core::ptr::null();
        let mut len: usize = 0;
        if JSC__JSValue__getClassInfoName(self, &mut ptr, &mut len) {
            // SAFETY: C++ guarantees `ptr[..len]` is a static `ClassInfo::className`.
            Some(unsafe { bun_core::ffi::slice(ptr, len) })
        } else {
            None
        }
    }
    /// `JSValue.getZigString` — read a JS string into a `ZigString` view.
    /// Convenience wrapper over [`JSValue::to_zig_string`] that returns the
    /// out-param by value.
    pub fn get_zig_string(self, global: &JSGlobalObject) -> JsResult<bun_core::ZigString> {
        let mut out = bun_core::ZigString::EMPTY;
        self.to_zig_string(&mut out, global)?;
        Ok(out)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Property access.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    /// `JSValue.fastGet(global, BuiltinName)` (JSValue.zig:1414) — property
    /// lookup using a preallocated `JSC::Identifier` (avoids allocating a key
    /// string). `self` must be known to be an object.
    pub fn fast_get(
        self,
        global: &JSGlobalObject,
        builtin_name: BuiltinName,
    ) -> JsResult<Option<JSValue>> {
        debug_assert!(self.is_object());
        let v = host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__fastGet(self, global, builtin_name as u8)
        })?;
        // JSValue.zig:1424 — `.property_does_not_exist_on_object` (0x4) and
        // `.js_undefined` map to None; `.zero` ⇒ exception (handled above).
        if v.0 == JSValue::PROPERTY_DOES_NOT_EXIST.0 || v.is_undefined() {
            Ok(None)
        } else {
            Ok(Some(v))
        }
    }

    /// Spec JSValue.zig `implementsToString` — safe to use on any JSValue.
    /// Returns true iff the value is an object whose `toString` property is a callable cell.
    pub fn implements_to_string(self, global: &JSGlobalObject) -> JsResult<bool> {
        if !self.is_object() {
            return Ok(false);
        }
        let function = match self.fast_get(global, BuiltinName::toString)? {
            Some(f) => f,
            None => return Ok(false),
        };
        Ok(function.is_cell() && function.is_callable())
    }

    pub fn get(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        let property = property.as_ref();
        // Spec (JSValue.zig:1536-1540) only routes to `fastGet` when the key is
        // *comptime-known*. A runtime byte-slice match here is wrong because
        // C++ `builtinNameMap` maps e.g. `asyncIterator` → `Symbol.asyncIterator`
        // (and `inspectCustom` → `Symbol.for("nodejs.util.inspect.custom")`), so
        // a dynamic `b"asyncIterator"` would fetch the *symbol* property instead
        // of the *string* property. Always go through the by-name FFI; callers
        // that statically know they want a builtin should call `fast_get` directly.
        // `[[ZIG_EXPORT(zero_is_throw)]]` — zero ⟺ threw. SAFETY: bytes valid for the call.
        let v = unsafe {
            crate::cpp::JSC__JSValue__getIfPropertyExistsImpl(
                self,
                global,
                property.as_ptr(),
                property.len(),
            )
        }?;
        // JSValue.zig:1545 — `.property_does_not_exist_on_object` (encoded 0x4 = ValueDeleted)
        // and `.js_undefined` map to None. `.zero` ⇒ exception (handled above).
        if v.0 == JSValue::PROPERTY_DOES_NOT_EXIST.0 || v.is_undefined() {
            Ok(None)
        } else {
            Ok(Some(v))
        }
    }
    pub fn get_if_property_exists(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        self.get(global, property)
    }
    pub fn get_truthy(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        // JSValue.zig:1625 truthyPropertyValue: filters undef/null AND empty strings.
        Ok(self
            .get(global, property)?
            .filter(|v| !v.is_empty_or_undefined_or_null() && !(v.is_string() && !v.to_boolean())))
    }
    /// JSValue.zig:1866 `getBooleanLoose` — missing/undefined → `None`; otherwise
    /// truthy-coerce the property value (never throws on the coercion itself).
    pub fn get_boolean_loose(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<bool>> {
        Ok(self.get(global, property)?.map(|v| v.to_boolean()))
    }
    pub fn get_stringish(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<bun_core::String>> {
        let property = property.as_ref();
        // JSValue.zig:1682 `getStringish` — `get(prop)`, filter null/false → None,
        // reject symbols, otherwise coerce via `toBunString` and filter "" → None.
        let Some(prop) = self.get(global, property)? else {
            return Ok(None);
        };
        if prop.is_null() || prop == JSValue::FALSE {
            return Ok(None);
        }
        if prop.is_symbol() {
            // JSValue.zig:1693 — `throwInvalidPropertyTypeValue(property, "string", prop)`
            // (Node-style ERR_INVALID_ARG_TYPE TypeError including received value's type).
            // PORT NOTE: routed via `throw_invalid_arguments` until
            // `JSGlobalObject::throw_invalid_property_type_value` is ported.
            return Err(global.throw_invalid_arguments(format_args!(
                "The \"{}\" property must be of type string. Received a symbol",
                alloc::string::String::from_utf8_lossy(property),
            )));
        }
        let s = prop.to_bun_string(global)?;
        if s.is_empty() { Ok(None) } else { Ok(Some(s)) }
    }
    /// JSValue.zig `getOptional(ZigString.Slice, ...)` — own/prototype lookup,
    /// `null`/`undefined` → `None`, non-string → `ERR_INVALID_ARG_TYPE`,
    /// otherwise return the UTF-8 slice (spec: `coerceOptional` checks
    /// `prop.isString()` before `toSlice`).
    pub fn get_optional_slice(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<bun_core::ZigStringSlice>> {
        let property = property.as_ref();
        match self.get(global, property)? {
            Some(v) if !v.is_undefined_or_null() => {
                if !v.is_string() {
                    return Err(global.throw_invalid_argument_type_value(property, b"string", v));
                }
                Ok(Some(v.to_slice(global)?))
            }
            _ => Ok(None),
        }
    }
    /// JSValue.zig:1824 `getFunction` — `getOptional(JSValue)` (filters
    /// undefined/null), then non-callable throws "{prop} must be a function".
    pub fn get_function(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        let property = property.as_ref();
        let Some(v) = self.get(global, property)? else {
            return Ok(None);
        };
        if v.is_undefined_or_null() {
            return Ok(None);
        }
        if !v.is_cell() || !v.is_callable() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be a function",
                alloc::string::String::from_utf8_lossy(property),
            )));
        }
        Ok(Some(v))
    }
    /// JSValue.zig:1873 `getBooleanStrict` — missing/undefined → `None`;
    /// boolean → `Some(b)`; anything else throws `ERR_INVALID_ARG_TYPE`.
    pub fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<bool>> {
        let property = property.as_ref();
        let Some(prop) = self.get(global, property)? else {
            return Ok(None);
        };
        if prop.is_undefined() {
            return Ok(None);
        }
        if prop.is_boolean() {
            return Ok(Some(prop == JSValue::TRUE));
        }
        Err(global.throw_invalid_property_type(property, "boolean", prop))
    }
    /// JSValue.zig:1703 `toEnumFromMap` — validates `is_string`, looks up via
    /// the supplied phf map, throws "must be one of …" on miss. The Zig
    /// `one_of` list is a comptime concat over `enumFieldNames`; Rust callers
    /// pass a `'static` literal.
    pub fn to_enum_from_map<E: Copy>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
        map: &'static phf::Map<&'static [u8], E>,
        one_of: &'static str,
    ) -> JsResult<E> {
        if !self.is_string() {
            return Err(
                global.throw_invalid_arguments(format_args!("{} must be a string", property_name))
            );
        }
        match crate::comptime_string_map_jsc::from_js(map, global, self)? {
            Some(v) => Ok(v),
            None => Err(global.throw_invalid_arguments(format_args!(
                "{} must be one of {}",
                property_name, one_of
            ))),
        }
    }
    /// JSValue.zig:1748 `getOptionalEnum` — `get(prop)`, filter
    /// undefined/null → `None`, otherwise `toEnum` (dispatches via
    /// `FromJsEnum`).
    pub fn get_optional_enum<E: FromJsEnum>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Option<E>> {
        match self.get(global, property_name)? {
            Some(v) if !v.is_empty_or_undefined_or_null() => {
                Ok(Some(v.to_enum::<E>(global, property_name)?))
            }
            _ => Ok(None),
        }
    }
    /// JSValue.zig:1748 `getOptionalEnum` — `get(prop)`, filter
    /// undefined/null → `None`, otherwise `toEnum` (via `to_enum_from_map`).
    pub fn get_optional_enum_from_map<E: Copy>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
        map: &'static phf::Map<&'static [u8], E>,
        one_of: &'static str,
    ) -> JsResult<Option<E>> {
        match self.get(global, property_name)? {
            Some(v) if !v.is_empty_or_undefined_or_null() => Ok(Some(v.to_enum_from_map(
                global,
                property_name,
                map,
                one_of,
            )?)),
            _ => Ok(None),
        }
    }
    pub fn get_array(
        self,
        global: &JSGlobalObject,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        let property = property.as_ref();
        // JSValue.zig:1784 `getArray` → `coerceToArray`: `get(prop)`, require
        // `jsTypeLoose().isArray()` (numbers map to NumberObject — never an
        // array — so the cell guard is sufficient), then filter empty arrays.
        let Some(prop) = self.get(global, property)? else {
            return Ok(None);
        };
        if prop.is_undefined_or_null() {
            return Ok(None);
        }
        if !prop.is_cell() || !prop.js_type().is_array() {
            // JSValue.zig:1785-1787 — `property_name ++ " must be an array"` via throwInvalidArguments.
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be an array",
                alloc::string::String::from_utf8_lossy(property),
            )));
        }
        if prop.get_length(global)? == 0 {
            return Ok(None);
        }
        Ok(Some(prop))
    }
    pub fn get_own_by_value(
        self,
        global: &JSGlobalObject,
        property_value: JSValue,
    ) -> Option<JSValue> {
        let v = JSC__JSValue__getOwnByValue(self, global, property_value);
        if v.is_empty() { None } else { Some(v) }
    }
    /// `Object.hasOwnProperty(key)` (Zig: `JSValue.hasOwnPropertyValue`,
    /// JSValue.zig:793). `self` **must** be an object — the C++ side
    /// `uncheckedDowncast`s. `key.toPropertyKey()` and Proxy `ownKeys` traps
    /// can throw, so this is routed through `from_js_host_call_generic`.
    #[track_caller]
    pub fn has_own_property_value(self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__hasOwnPropertyValue(self, global, key)
        })
    }
    /// `Function.prototype.bind` (Zig: `JSValue.bind`, JSValue.zig:2448 →
    /// `Bun__JSValue__bind`, bindings.cpp:6305). Creates a bound-function
    /// object whose `name`/`length` are fixed up to the supplied values; `args`
    /// are prepended to the eventual call's argument list. C++ is annotated
    /// `[[ZIG_EXPORT(zero_is_throw)]]`, so `0` ↔ pending exception.
    #[track_caller]
    pub fn bind(
        self,
        global: &JSGlobalObject,
        bind_this: JSValue,
        name: &bun_core::String,
        length: f64,
        args: &[JSValue],
    ) -> JsResult<JSValue> {
        // SAFETY: `global`/`name` outlive the FFI call; `args` is a contiguous
        // slice of `JSValue` (`repr(transparent)` over `EncodedJSValue`).
        host_fn::from_js_host_call(global, || unsafe {
            Bun__JSValue__bind(
                self,
                global,
                bind_this,
                name,
                length,
                args.as_ptr(),
                args.len(),
            )
        })
    }
    pub fn get_object(self) -> Option<*mut JSObject> {
        if !self.is_object() {
            return None;
        }
        // Cell-tagged JSValues *are* the cell pointer (NotCellMask bits are zero).
        Some(self.0 as *mut JSObject)
    }
    pub fn get_index(self, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        JSObject::get_index(self, global, i)
    }
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        let len = host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__getLengthIfPropertyExistsInternal(self, global)
        })?;
        if len == f64::MAX {
            return Ok(0);
        }
        // JSValue.zig:2181 — clamps to `std.math.maxInt(i52)` (2^51 − 1), not MAX_SAFE_INTEGER.
        const I52_MAX: i64 = (1i64 << 51) - 1;
        Ok(len.clamp(0.0, I52_MAX as f64) as u64)
    }
    /// `JSValue.put` (JSValue.zig:366) — `key: anytype` dispatches on type at
    /// comptime to `putZigString`/`putBunString`. Rust ports the dispatch via
    /// the [`PutKey`] trait so callers may pass `&[u8]`, `ZigString`,
    /// `&ZigString`, `bun.String`, or `&bun.String` exactly as in Zig.
    pub fn put<K: PutKey>(self, global: &JSGlobalObject, key: K, value: JSValue) {
        key.put(self, global, value)
    }
    /// [`put`] only when `val` is `Some`; the property is *omitted* (not set to
    /// `undefined`) when `None`. Collapses the open-coded
    /// `if let Some(v) = field { obj.put(g, key, v.into()) }` used when
    /// serializing optional struct fields to a JS object (S3 list-objects,
    /// SQL error options, etc.).
    #[inline]
    pub fn put_optional<K: PutKey, V: Into<JSValue>>(
        self,
        global: &JSGlobalObject,
        key: K,
        val: Option<V>,
    ) {
        if let Some(v) = val {
            self.put(global, key, v.into());
        }
    }
    /// [`put_optional`] specialized for `Option<impl AsRef<[u8]>>` → JS string
    /// via [`bun_string_jsc::create_utf8_for_js`]. The 7-line
    /// `if let Some(s) = field { obj.put(g, key, create_utf8_for_js(g, s)?) }`
    /// pattern collapses to a single fallible call.
    #[inline]
    pub fn put_optional_utf8<K: PutKey, S: AsRef<[u8]>>(
        self,
        global: &JSGlobalObject,
        key: K,
        val: Option<S>,
    ) -> JsResult<()> {
        if let Some(s) = val {
            self.put(
                global,
                key,
                bun_string_jsc::create_utf8_for_js(global, s.as_ref())?,
            );
        }
        Ok(())
    }
    /// `JSValue.deleteProperty` (JSValue.zig:334) — delete an own property by name.
    pub fn delete_property(self, global: &JSGlobalObject, key: impl AsRef<[u8]>) -> bool {
        let zs = bun_core::ZigString::init(key.as_ref());
        JSC__JSValue__deleteProperty(self, global, &zs)
    }
    /// `JSValue.putBunString` (JSValue.zig:353).
    pub fn put_bun_string(self, global: &JSGlobalObject, key: &bun_core::String, value: JSValue) {
        JSC__JSValue__putBunString(self, global, key, value)
    }
    /// `JSValue.putMayBeIndex` (JSValue.zig:389) — same as [`put`] but accepts
    /// both non-numeric and numeric keys. Prefer [`put`] when the key is
    /// guaranteed non-numeric.
    pub fn put_may_be_index(
        self,
        global: &JSGlobalObject,
        key: &bun_core::String,
        value: JSValue,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__putMayBeIndex(self, global, key, value)
        })
    }
    pub fn put_to_property_key(
        target: JSValue,
        global: &JSGlobalObject,
        key: JSValue,
        value: JSValue,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__putToPropertyKey(target, global, key, value)
        })
    }
    #[track_caller]
    pub fn put_index(self, global: &JSGlobalObject, i: u32, out: JSValue) -> JsResult<()> {
        // Zig: `fromJSHostCallGeneric` (== `call_check_slow`).
        crate::call_check_slow(global, || JSC__JSValue__putIndex(self, global, i, out))
    }
    /// `JSValue.putBunStringOneOrArray` (JSValue.zig) — put `key`/`value` into
    /// `self`. If `key` is already present on the object, create an array for
    /// the values (used by FrameworkRouter catch-all params).
    pub fn put_bun_string_one_or_array(
        self,
        global: &JSGlobalObject,
        key: &bun_core::String,
        value: JSValue,
    ) -> JsResult<JSValue> {
        host_fn::from_js_host_call(global, || {
            JSC__JSValue__upsertBunStringArray(self, global, key, value)
        })
    }

    /// `JSValue.push` (JSValue.zig:404) — append to an array-typed JS value.
    #[track_caller]
    pub fn push(self, global: &JSGlobalObject, out: JSValue) -> JsResult<()> {
        // Zig: `fromJSHostCallGeneric` (== `call_check_slow`).
        crate::call_check_slow(global, || JSC__JSValue__push(self, global, out))
    }

    /// `JSValue.getOptionalInt` (JSValue.zig:1896) — typed integer property
    /// fetch with `validateIntegerRange` clamping. Returns `None` if the
    /// property is absent.
    pub fn get_optional_int<T: bun_core::Integer>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Option<T>> {
        let Some(value) = self.get(global, property_name)? else {
            return Ok(None);
        };
        let min: i128 = T::MIN_I128.max(i128::from(crate::MIN_SAFE_INTEGER));
        let max: i128 = T::MAX_I128.min(i128::from(crate::MAX_SAFE_INTEGER));
        Ok(Some(global.validate_integer_range::<T>(
            value,
            T::ZERO,
            crate::IntegerRange {
                min,
                max,
                field_name: property_name.as_bytes(),
                always_allow_zero: false,
            },
        )?))
    }

    pub fn array_iterator<'a>(self, global: &'a JSGlobalObject) -> JsResult<JSArrayIterator<'a>> {
        JSArrayIterator::init(self, global)
    }

    /// `JSValue.jsonStringify` (JSValue.zig:1278).
    pub fn json_stringify(
        self,
        global: &JSGlobalObject,
        indent: u32,
        out: &mut bun_core::String,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__jsonStringify(self, global, indent, out)
        })
    }

    /// `JSValue.jsonStringifyFast` (JSValue.zig:1287) — `JSON.stringify(this)`
    /// with no indent / no replacer (fast path used by SQL value binders).
    pub fn json_stringify_fast(
        self,
        global: &JSGlobalObject,
        out: &mut bun_core::String,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__jsonStringifyFast(self, global, out)
        })
    }

    /// `JSC__JSValue__parseJSON` (bindings.cpp / headers.h:279) — parse `self`
    /// (a JS string value) as JSON. The C++ symbol takes an *EncodedJSValue*,
    /// not a `*const ZigString`.
    pub fn parse_json(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        host_fn::from_js_host_call(global, || JSC__JSValue__parseJSON(self, global))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GC interaction / call.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    /// Prevents the GC from collecting this value while it's on the stack.
    /// Mirrors `std.mem.doNotOptimizeAway`.
    #[inline]
    pub fn ensure_still_alive(self) {
        if !self.is_cell() {
            return;
        }
        core::hint::black_box(self);
    }

    /// If this value is callable and an `AsyncContextFrame` is currently active,
    /// returns a wrapper that restores that frame when invoked; otherwise
    /// returns `self` unchanged. Mirrors Zig `JSValue.withAsyncContextIfNeeded`.
    #[inline]
    pub fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue {
        unsafe extern "C" {
            safe fn AsyncContextFrame__withAsyncContextIfNeeded(
                global: &JSGlobalObject,
                callback: JSValue,
            ) -> JSValue;
        }
        // No `is_callable()` precondition: `Timer::sleep` passes a Promise here
        // (Zig spec JSValue.zig:2267 has no assert; the C++ shim returns
        // non-callables unchanged).
        AsyncContextFrame__withAsyncContextIfNeeded(global, self)
    }

    /// Protects a JSValue from garbage collection (refcounted). The is_cell
    /// check happens on the C++ side (bindings.cpp).
    #[inline]
    pub fn protect(self) {
        Bun__JSValue__protect(self)
    }
    /// Inverse of `protect`.
    #[inline]
    pub fn unprotect(self) {
        Bun__JSValue__unprotect(self)
    }
    /// RAII form of [`protect`]/[`unprotect`]: protects now, unprotects when
    /// the returned guard drops. Use instead of a manual `defer unprotect()`.
    #[inline]
    pub fn protected(self) -> Protected {
        self.protect();
        Protected(self)
    }

    /// `JSValue.callWithGlobalThis(global, args)` (JSValue.zig:237) — `call`
    /// with `global` as the receiver.
    #[inline]
    #[track_caller]
    pub fn call_with_global_this(
        self,
        global: &JSGlobalObject,
        args: &[JSValue],
    ) -> JsResult<JSValue> {
        self.call(global, global.to_js_value(), args)
    }

    /// `JSValue.call(global, thisValue, args)` (JSValue.zig:249).
    /// Calls `function` with `this_value` as the receiver. Returns
    /// `Err(JsError::Thrown)` if a JS exception was raised.
    #[track_caller]
    pub fn call(
        self,
        global: &JSGlobalObject,
        this_value: JSValue,
        args: &[JSValue],
    ) -> JsResult<JSValue> {
        // PORT NOTE: debug-only event-loop bookkeeping (JSValue.zig:251-258) is
        // omitted while VirtualMachine.rs is gated; restore when it un-gates.
        host_fn::from_js_host_call(global, || {
            // SAFETY: `global` is live; `args` is a contiguous slice of valid
            // JSValues for the duration of the call.
            unsafe { Bun__JSValue__call(global, self, this_value, args.len(), args.as_ptr()) }
        })
    }
}

/// RAII guard returned by [`JSValue::protected`]. Calls [`JSValue::unprotect`]
/// on drop. JSC's `gcProtect` is refcounted, so this composes with nested
/// protect/unprotect pairs.
#[must_use = "dropping immediately unprotects; bind to a local"]
pub struct Protected(JSValue);
impl Protected {
    /// Wrap an **already-protected** value so it is unprotected on drop.
    /// Unlike [`JSValue::protected`], this does *not* bump the protect
    /// refcount — use when adopting a `protect()` taken elsewhere (the
    /// Rust spelling of Zig's bare `defer value.unprotect()`).
    #[inline]
    pub fn adopt(value: JSValue) -> Self {
        Self(value)
    }
    #[inline]
    pub fn value(&self) -> JSValue {
        self.0
    }
}
impl Drop for Protected {
    #[inline]
    fn drop(&mut self) {
        self.0.unprotect();
    }
}

// `JSValue.Hash` (Zig: `std.hash_map` Context adapter) is just
// `core::hash::Hash` in Rust — hash the raw encoded bit-pattern. Callers that
// want wyhash supply it as the map's `BuildHasher`, not via a Zig-style
// context struct.
impl core::hash::Hash for JSValue {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state)
    }
}

// ── `JSValue::from(T)` blanket constructors (Zig: anytype dispatch) ───────
impl From<bool> for JSValue {
    #[inline]
    fn from(b: bool) -> Self {
        Self::js_boolean(b)
    }
}
impl From<i32> for JSValue {
    #[inline]
    fn from(i: i32) -> Self {
        Self::js_number_from_int32(i)
    }
}
impl From<u32> for JSValue {
    #[inline]
    fn from(i: u32) -> Self {
        if i <= i32::MAX as u32 {
            Self::js_number_from_int32(i as i32)
        } else {
            Self::js_number(i as f64)
        }
    }
}
impl From<f64> for JSValue {
    #[inline]
    fn from(n: f64) -> Self {
        Self::js_number(n)
    }
}
impl From<u64> for JSValue {
    #[inline]
    fn from(i: u64) -> Self {
        Self::js_number_from_uint64(i)
    }
}
impl From<usize> for JSValue {
    #[inline]
    fn from(i: usize) -> Self {
        Self::js_number_from_uint64(i as u64)
    }
}

impl JSValue {
    /// `JSValue.asEncoded` (JSValue.zig:967) — view the encoded word as the
    /// `EncodedJSValue` C union (used by the FFI fast-paths in `bun:ffi`).
    #[inline]
    pub fn as_encoded(self) -> ffi::EncodedJSValue {
        ffi::EncodedJSValue { as_js_value: self }
    }

    /// `JSValue.fromAny(global, T, value)` (JSValue.zig:2351) — generic
    /// value→JSValue conversion. Zig reflected over `@TypeOf(value)`; in Rust
    /// the dispatch is via [`FromAny`], implemented for each supported leaf
    /// type. Slice / struct reflection is handled by per-element impls instead
    /// of comptime recursion.
    #[inline]
    pub fn from_any<T: FromAny>(global: &JSGlobalObject, value: T) -> JsResult<JSValue> {
        value.into_js_value(global)
    }
}

/// Dispatch trait for [`JSValue::from_any`]. Zig used a comptime
/// `@TypeOf`/`@typeInfo` switch (JSValue.zig:2351); in Rust each supported
/// leaf type implements this trait directly.
pub trait FromAny {
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}

/// Primitive numeric / boolean / `JSValue` arms of the Zig `fromAny` switch
/// all reduce to the existing `From<T> for JSValue` impls — `global` is unused
/// for these leaves (Zig: `jsNumberWithType`, `jsBoolean`, identity).
macro_rules! from_any_via_from {
    ($($t:ty),* $(,)?) => {$(
        impl FromAny for $t {
            #[inline]
            fn into_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
                Ok(JSValue::from(self))
            }
        }
    )*};
}
from_any_via_from!(bool, i32, u32, f64, u64, usize, JSValue);

// Zig: `bun.trait.isNumber(Type)` arm — small integers go through
// `jsNumberWithType` (widened to int32 here; values fit losslessly).
impl FromAny for u8 {
    #[inline]
    fn into_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(self as i32))
    }
}
impl FromAny for u16 {
    #[inline]
    fn into_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(self as i32))
    }
}
impl FromAny for &[u16] {
    /// Zig: `[]const u16` → `createEmptyArray` + `putIndex(.jsNumber(item))`
    /// (JSValue.zig:2390 — the inline numeric-slice arm).
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, self.len())?;
        for (i, &item) in self.iter().enumerate() {
            array.put_index(global, i as u32, JSValue::js_number_from_int32(item as i32))?;
        }
        Ok(array)
    }
}

impl FromAny for () {
    #[inline]
    fn into_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}
impl FromAny for &[u8] {
    /// Zig: `bun.String.createUTF8ForJS(globalObject, value)`.
    #[inline]
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, self)
    }
}
impl FromAny for &str {
    #[inline]
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, self.as_bytes())
    }
}
impl FromAny for Box<[bun_core::String]> {
    /// Zig: `[]const bun.String` arm (JSValue.zig:2378) — `bun.String.toJSArray`
    /// then `defer { for (value) |out| out.deref(); free(value); }`. The boxed
    /// slice is consumed: every element's WTF refcount is dropped and the
    /// backing allocation freed via `Box` drop. `bun_core::String` is `Copy`
    /// with no `Drop`, so the explicit `deref()` loop is required.
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let result = bun_string_jsc::to_js_array(global, &self);
        for out in self.iter() {
            out.deref();
        }
        result
    }
}
impl<T: FromAny> FromAny for Option<T> {
    /// Zig: `if (@typeInfo(T) == .optional) ...` — `null` → `undefined`.
    #[inline]
    fn into_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Some(v) => v.into_js_value(global),
            None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// Dispatch trait for [`JSValue::put`]'s `key: anytype` parameter
/// (JSValue.zig:366). Zig used `@typeInfo` to route `ZigString`/`bun.String`/
/// `[]const u8` to the matching FFI; Rust expresses that as a trait per
/// PORTING.md §Comptime reflection.
pub trait PutKey {
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue);
}
impl PutKey for &bun_core::ZigString {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        JSC__JSValue__put(target, global, self, value)
    }
}
impl PutKey for bun_core::ZigString {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        (&self).put(target, global, value)
    }
}
impl PutKey for &bun_core::String {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        JSC__JSValue__putBunString(target, global, self, value)
    }
}
impl PutKey for bun_core::String {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        (&self).put(target, global, value)
    }
}
impl PutKey for &[u8] {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        let zs = bun_core::ZigString::init(self);
        (&zs).put(target, global, value)
    }
}
impl<const N: usize> PutKey for &[u8; N] {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        self.as_slice().put(target, global, value)
    }
}
impl PutKey for &str {
    #[inline]
    fn put(self, target: JSValue, global: &JSGlobalObject, value: JSValue) {
        self.as_bytes().put(target, global, value)
    }
}

/// Dispatch trait for `JSValue::coerce::<T>()`. Zig used a comptime type switch.
pub trait CoerceTo: Sized {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<Self>;
}
impl CoerceTo for i32 {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<i32> {
        // JSValue.zig:163-170 `coerce(i32)` — fast-path numbers via
        // `coerceJSValueDoubleTruncatingT(i32, num)` (NaN→0, out-of-range
        // saturates to i32 MIN/MAX) BEFORE falling through to the C++
        // `coerceToInt32` (ECMAScript ToInt32 modular wrap) for non-numbers.
        if v.is_int32() {
            return Ok(v.as_int32());
        }
        if let Some(num) = v.get_number() {
            // Rust `f64 as i32` saturates on overflow and yields 0 for NaN —
            // matches `coerceJSValueDoubleTruncatingT` exactly.
            return Ok(if num.is_nan() { 0 } else { num as i32 });
        }
        v.coerce_to_i32(global)
    }
}

/// Dispatch trait for `JSValue::to_enum::<E>()`. Zig used `comptime Enum: type`
/// + a `phf` `Map` decl; the Rust port supplies the map per-enum via this trait.
pub trait FromJsEnum: Sized {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self>;
}

pub type PropertyIteratorFn = unsafe extern "C" fn(
    global_object: *mut JSGlobalObject,
    ctx_ptr: *mut c_void,
    key: *mut bun_core::ZigString,
    value: JSValue,
    is_symbol: bool,
    is_private_symbol: bool,
);

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — JSC bindings (src/jsc/bindings/bindings.cpp). The .a/.o files
// are linked already; we declare and call. NEVER re-implement in Rust.
//
// `safe fn`: every parameter is either a value type (`JSValue` is a tagged
// `i64`; primitives) or a Rust reference (`&JSGlobalObject` etc., ABI-identical
// to a non-null pointer). The C++ side has no preconditions beyond pointer
// validity, which the reference types already guarantee, so the calls carry no
// `unsafe` obligations. Functions that take a raw `(ptr, len)` pair or transfer
// ownership of a raw allocation stay `unsafe` and are wrapped at the call site.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    safe fn JSC__JSValue__isAnyInt(this: JSValue) -> bool;
    safe fn JSC__JSValue__jsType(this: JSValue) -> JSType;
    safe fn JSC__JSValue__jsNumberFromDouble(n: f64) -> JSValue;
    safe fn JSC__JSValue__jsEmptyString(global: &JSGlobalObject) -> JSValue;
    safe fn JSC__JSValue__createEmptyObject(global: &JSGlobalObject, len: usize) -> JSValue;
    safe fn JSC__JSValue__createEmptyObjectWithNullPrototype(global: &JSGlobalObject) -> JSValue;
    safe fn JSC__JSValue__createObject2(
        global: &JSGlobalObject,
        key1: &bun_core::ZigString,
        key2: &bun_core::ZigString,
        value1: JSValue,
        value2: JSValue,
    ) -> JSValue;
    safe fn JSC__JSValue__createEmptyArray(global: &JSGlobalObject, len: usize) -> JSValue;
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
        ctx: *mut c_void,
        deallocator: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
    ) -> JSValue;
    safe fn JSBuffer__bufferFromLength(global: &JSGlobalObject, len: i64) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNullTerminatedString(
        global: *const JSGlobalObject,
        s: *const c_char,
    ) -> JSValue;
    safe fn JSC__JSValue__dateInstanceFromNumber(global: &JSGlobalObject, n: f64) -> JSValue;
    safe fn JSC__JSValue__fromInt64NoTruncate(global: &JSGlobalObject, i: i64) -> JSValue;
    safe fn JSC__JSValue__fromUInt64NoTruncate(global: &JSGlobalObject, i: u64) -> JSValue;
    safe fn JSC__JSValue__fromTimevalNoTruncate(
        global: &JSGlobalObject,
        nsec: i64,
        sec: i64,
    ) -> JSValue;
    safe fn JSC__JSValue__bigIntSum(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JSValue;
    fn JSC__JSValue__fromEntries(
        global: *const JSGlobalObject,
        keys: *mut bun_core::ZigString,
        values: *mut bun_core::ZigString,
        strings_count: usize,
        clone: bool,
    ) -> JSValue;
    safe fn JSC__JSValue__toBoolean(this: JSValue) -> bool;
    safe fn JSC__JSValue__toInt32(this: JSValue) -> i32;
    safe fn JSC__JSValue__toInt64(this: JSValue) -> i64;
    safe fn JSC__JSValue__isSymbol(this: JSValue) -> bool;
    safe fn JSC__JSValue__isBigInt(this: JSValue) -> bool;
    safe fn JSC__JSValue__isCallable(this: JSValue) -> bool;
    safe fn JSC__JSValue__coerceToInt32(this: JSValue, global: &JSGlobalObject) -> i32;
    safe fn JSC__JSValue__coerceToInt64(this: JSValue, global: &JSGlobalObject) -> i64;
    safe fn JSC__JSValue__fastGet(this: JSValue, global: &JSGlobalObject, builtin: u8) -> JSValue;
    safe fn JSC__JSValue__jsonStringify(
        this: JSValue,
        global: &JSGlobalObject,
        indent: u32,
        out: &mut bun_core::String,
    );
    safe fn JSC__JSValue__jsonStringifyFast(
        this: JSValue,
        global: &JSGlobalObject,
        out: &mut bun_core::String,
    );
    safe fn JSC__JSValue__toError_(this: JSValue) -> JSValue;
    safe fn JSC__JSValue__toZigException(
        this: JSValue,
        global: &JSGlobalObject,
        exception: &mut ZigException,
    );
    safe fn JSC__JSValue__getUnixTimestamp(this: JSValue) -> f64;
    safe fn JSC__JSValue__isPrimitive(this: JSValue) -> bool;
    safe fn JSC__JSValue__getOwnByValue(
        this: JSValue,
        global: &JSGlobalObject,
        key: JSValue,
    ) -> JSValue;
    safe fn JSC__JSValue__hasOwnPropertyValue(
        this: JSValue,
        global: &JSGlobalObject,
        key: JSValue,
    ) -> bool;
    fn Bun__JSValue__bind(
        function: JSValue,
        global: *const JSGlobalObject,
        bind_this: JSValue,
        name: *const bun_core::String,
        length: f64,
        args: *const JSValue,
        args_len: usize,
    ) -> JSValue;
    safe fn JSC__JSValue__put(
        this: JSValue,
        global: &JSGlobalObject,
        key: &bun_core::ZigString,
        value: JSValue,
    );
    safe fn JSC__JSValue__deleteProperty(
        this: JSValue,
        global: &JSGlobalObject,
        key: &bun_core::ZigString,
    ) -> bool;
    safe fn JSC__JSValue__putBunString(
        this: JSValue,
        global: &JSGlobalObject,
        key: &bun_core::String,
        value: JSValue,
    );
    safe fn JSC__JSValue__putMayBeIndex(
        this: JSValue,
        global: &JSGlobalObject,
        key: &bun_core::String,
        value: JSValue,
    );
    safe fn JSC__JSValue__putIndex(this: JSValue, global: &JSGlobalObject, i: u32, value: JSValue);
    safe fn JSC__JSValue__upsertBunStringArray(
        this: JSValue,
        global: &JSGlobalObject,
        key: &bun_core::String,
        value: JSValue,
    ) -> JSValue;
    safe fn JSC__JSValue__push(this: JSValue, global: &JSGlobalObject, value: JSValue);
    safe fn JSC__JSValue__putToPropertyKey(
        target: JSValue,
        global: &JSGlobalObject,
        key: JSValue,
        value: JSValue,
    );
    safe fn JSC__JSValue__toStringOrNull(this: JSValue, global: &JSGlobalObject) -> *mut JSString;
    safe fn JSC__JSValue__asString(this: JSValue) -> *mut JSString;
    safe fn JSC__jsTypeStringForValue(global: &JSGlobalObject, value: JSValue) -> *mut JSString;
    safe fn JSC__JSValue__asArrayBuffer(
        this: JSValue,
        global: &JSGlobalObject,
        out: &mut ArrayBuffer,
    ) -> bool;
    safe fn JSC__JSValue__asPromise(this: JSValue) -> *mut JSPromise;
    safe fn JSC__JSValue__asInternalPromise(this: JSValue) -> *mut JSInternalPromise;
    safe fn Bun__attachAsyncStackFromPromise(
        global: &JSGlobalObject,
        err: JSValue,
        promise: &JSPromise,
    );
    safe fn JSC__JSValue__isAnyError(this: JSValue) -> bool;
    // safe: `JSValue` is a by-value scalar; `&mut *const u8` / `&mut usize` are
    // ABI-identical to non-null `*mut` out-params the C++ side fills on success.
    safe fn JSC__JSValue__getClassInfoName(
        this: JSValue,
        out: &mut *const u8,
        len: &mut usize,
    ) -> bool;
    safe fn JSC__JSValue__getLengthIfPropertyExistsInternal(
        this: JSValue,
        global: &JSGlobalObject,
    ) -> f64;
    safe fn JSC__JSValue__parseJSON(this: JSValue, global: &JSGlobalObject) -> JSValue;
    safe fn JSC__JSValue__toZigString(
        this: JSValue,
        out: &mut bun_core::ZigString,
        global: &JSGlobalObject,
    );
    fn JSC__JSValue__getIfPropertyExistsImpl(
        target: JSValue,
        global: *const JSGlobalObject,
        ptr: *const u8,
        len: usize,
    ) -> JSValue;
    safe fn JSC__JSValue__isTerminationException(this: JSValue) -> bool;
    safe fn JSC__JSValue__isException(this: JSValue, vm: &crate::VM) -> bool;
    fn Bun__JSValue__call(
        global: *const JSGlobalObject,
        function: JSValue,
        this_value: JSValue,
        args_len: usize,
        args_ptr: *const JSValue,
    ) -> JSValue;
    safe fn Bun__JSValue__protect(this: JSValue);
    safe fn Bun__JSValue__unprotect(this: JSValue);
}

// ──────────────────────────────────────────────────────────────────────────
// Additional ports (JSValue.zig — second tranche).
// ──────────────────────────────────────────────────────────────────────────

/// `JSValue.ProxyInternalField` (JSValue.zig:2320).
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyField {
    Target = 0,
    Handler = 1,
}
/// Zig spelling.
pub type ProxyInternalField = ProxyField;

/// `JSValue.SerializedFlags` (JSValue.zig:2303).
#[derive(Debug, Default, Clone, Copy)]
pub struct SerializedFlags {
    pub for_cross_process_transfer: bool,
    pub for_storage: bool,
}

/// `JSValue.SerializedScriptValue` (JSValue.zig:2287) — owned view over a
/// `WebCore::SerializedScriptValue` byte buffer. Call `deinit` to free.
pub struct SerializedScriptValue {
    bytes: *const u8,
    size: usize,
    handle: *mut c_void,
}
impl SerializedScriptValue {
    /// Borrow the serialized bytes. Valid only while `self` is alive (the
    /// backing buffer is freed on drop); the lifetime is tied to `&self`.
    #[inline]
    pub fn data(&self) -> &[u8] {
        // SAFETY: C++ guarantees `bytes[..size]` is valid for the lifetime of
        // `handle` (until `Bun__SerializedScriptSlice__free`); the returned
        // borrow is tied to `&self` so it cannot outlive `Drop`.
        unsafe { bun_core::ffi::slice(self.bytes, self.size) }
    }
}
impl Drop for SerializedScriptValue {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `handle` is the non-null opaque returned by `Bun__serializeJSValue`.
        unsafe { Bun__SerializedScriptSlice__free(self.handle) }
    }
}
#[repr(C)]
struct SerializedScriptValueExternal {
    bytes: *const u8,
    size: usize,
    handle: *mut c_void,
}

/// Callback signature for [`JSValue::for_each`] / [`JSValue::for_each_with_context`]
/// (Zig: `*const fn (vm, globalObject, ctx, nextValue) callconv(.c) void`).
pub type ForEachCallback =
    extern "C" fn(vm: *mut crate::VM, global: &JSGlobalObject, ctx: *mut c_void, next: JSValue);

/// Callback signature for [`JSValue::for_each_property`] /
/// [`JSValue::for_each_property_non_indexed`]
/// (Zig: `*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.c) void`).
pub type ForEachPropertyCallback = extern "C" fn(
    global: &JSGlobalObject,
    ctx: *mut c_void,
    key: *mut bun_core::ZigString,
    value: JSValue,
    is_symbol: bool,
    is_private_symbol: bool,
);

/// `JSValue.StringFormatter` (JSValue.zig:2019) — `Display` adapter that
/// coerces the value via `toBunString` at format time.
pub struct StringFormatter<'a> {
    value: JSValue,
    global: &'a JSGlobalObject,
}
impl core::fmt::Display for StringFormatter<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self.value.to_bun_string(self.global) {
            Ok(s) => {
                let r = core::fmt::Display::fmt(&s, f);
                s.deref();
                r
            }
            Err(_) => Err(core::fmt::Error),
        }
    }
}

impl JSValue {
    // ── C-API bridging (JSValue.zig:2230-2247, deprecated in spec). ───────
    /// `JSValue.c(JSValueRef)` — wrap a C-API `JSValueRef` as a `JSValue`.
    #[inline]
    pub fn c(ptr: crate::C::JSValueRef) -> JSValue {
        JSValue(ptr as usize, PhantomData)
    }
    /// `JSValue.asRef()` — view as C-API `JSValueRef`.
    #[inline]
    pub fn as_ref(self) -> crate::C::JSValueRef {
        self.0 as crate::C::JSValueRef
    }
    /// `JSValue.asObjectRef()` — view as C-API `JSObjectRef` (caller asserts
    /// `is_object()`).
    #[inline]
    pub fn as_object_ref(self) -> crate::C::JSObjectRef {
        self.0 as crate::C::JSObjectRef
    }

    // ── Equality / identity (JSValue.zig:1358-1361, 1948). ────────────────
    #[inline]
    pub fn eql_value(self, other: JSValue) -> bool {
        JSC__JSValue__eqlValue(self, other)
    }
    /// `JSValue.isSameValue` (Object.is semantics).
    ///
    /// Differs from IsStrictlyEqual by treating all NaN values as equivalent
    /// and by differentiating +0 from -0. Can throw (rope-string resolution).
    pub fn is_same_value(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // Identity fast-path (JSValue.zig:1949): same encoded bits ⇒ same value.
        if self == other {
            return Ok(true);
        }
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__isSameValue(self, other, global)
        })
    }

    // ── Numeric coercion (JSValue.zig:119, 153, 2156). ────────────────────
    /// `JSValue.toNumber` — full ECMA `ToNumber` (`+value`); may throw.
    pub fn to_number(self, global: &JSGlobalObject) -> JsResult<f64> {
        host_fn::from_js_host_call_generic(global, || Bun__JSValue__toNumber(self, global))
    }

    /// `JSValue.toPortNumber` (JSValue.zig:211) — Node `validatePort` semantics:
    /// numeric, non-NaN, integer-truncated `0..=65535`, else `ERR_SOCKET_BAD_PORT`.
    pub fn to_port_number(self, global: &JSGlobalObject) -> JsResult<u16> {
        if self.is_number() {
            let double = self.to_number(global)?;
            if double.is_nan() {
                return Err(crate::ErrorCode::SOCKET_BAD_PORT
                    .throw(global, format_args!("Invalid port number")));
            }
            let port = self.to_int64();
            if (0..=65535).contains(&port) {
                return Ok(port.max(0) as u16);
            }
            return Err(crate::ErrorCode::SOCKET_BAD_PORT
                .throw(global, format_args!("Port number out of range: {port}")));
        }
        Err(crate::ErrorCode::SOCKET_BAD_PORT.throw(global, format_args!("Invalid port number")))
    }

    /// `JSValue.coerce(f64)` (JSValue.zig:153) — fast-path doubles, else `ToNumber`.
    pub fn coerce_f64(self, global: &JSGlobalObject) -> JsResult<f64> {
        if self.is_double() {
            return Ok(self.as_double());
        }
        self.to_number(global)
    }
    /// `JSValue.toU16` (JSValue.zig:2156) — truncating, clamped-at-zero.
    #[inline]
    pub fn to_u16(self) -> u16 {
        (self.to_int32().max(0) as u32) as u16
    }

    // ── Object / cell views (JSValue.zig:1164, 1331, 1354). ───────────────
    /// Statically cast to a `JSCell*`; `None` for non-cells.
    #[inline]
    pub fn to_cell(self) -> Option<*mut crate::JSCell> {
        if self.is_cell() {
            Some(self.0 as *mut crate::JSCell)
        } else {
            None
        }
    }
    /// `JSValue.toObject` — ECMA `ToObject`; throws on null/undefined.
    pub fn to_object(self, global: &JSGlobalObject) -> JsResult<*mut JSObject> {
        let p = JSC__JSValue__toObject(self, global);
        if p.is_null() {
            Err(JsError::Thrown)
        } else {
            Ok(p)
        }
    }
    /// `JSValue.unwrapBoxedPrimitive` (JSValue.zig:1343) — unwraps Number,
    /// Boolean, String, and BigInt objects to their primitive forms.
    pub fn unwrap_boxed_primitive(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        host_fn::from_js_host_call(global, || JSC__JSValue__unwrapBoxedPrimitive(global, self))
    }
    /// `JSValue.getPrototype`.
    pub fn get_prototype(self, global: &JSGlobalObject) -> JSValue {
        JSC__JSValue__getPrototype(self, global)
    }

    // ── Reflection / naming (JSValue.zig:1128, 1136, 1515). ───────────────
    /// `JSValue.getName` — function/class display name.
    pub fn get_name(self, global: &JSGlobalObject) -> JsResult<bun_core::String> {
        let mut ret = bun_core::String::default();
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__getName(self, global, &mut ret)
        })?;
        Ok(ret)
    }
    /// `JSValue.getClassName` — writes the class name into `ret`.
    pub fn get_class_name(
        self,
        global: &JSGlobalObject,
        ret: &mut bun_core::ZigString,
    ) -> JsResult<()> {
        if !self.is_cell() {
            *ret = bun_core::ZigString::init(b"[not a class]");
            return Ok(());
        }
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__getClassName(self, global, ret))
    }
    /// `JSValue.getDescription` — symbol description (empty if none).
    pub fn get_description(self, global: &JSGlobalObject) -> bun_core::ZigString {
        let mut zs = bun_core::ZigString::EMPTY;
        JSC__JSValue__getSymbolDescription(self, global, &mut zs);
        zs
    }
    /// `JSValue.symbolFor(global, key)` — `Symbol.for(key)`.
    pub fn symbol_for(global: &JSGlobalObject, key: &mut bun_core::ZigString) -> JSValue {
        JSC__JSValue__symbolFor(global, key)
    }

    // ── Property access (JSValue.zig:328, 1578). ──────────────────────────
    /// `JSValue.putZigString` — `JSC__JSValue__put` keyed by an existing
    /// `ZigString` (avoids the temporary in [`JSValue::put`]).
    pub fn put_zig_string(
        self,
        global: &JSGlobalObject,
        key: &bun_core::ZigString,
        value: JSValue,
    ) {
        JSC__JSValue__put(self, global, key, value)
    }
    /// `JSValue.getOwn` — own-property lookup (no prototype walk).
    pub fn get_own(
        self,
        global: &JSGlobalObject,
        property_name: &bun_core::String,
    ) -> JsResult<Option<JSValue>> {
        // Zig (JSValue.zig:1578): manual `TopExceptionScope` + `returnIfException`.
        crate::top_scope!(scope, global);
        let v = JSC__JSValue__getOwn(self, global, property_name);
        scope.return_if_exception()?;
        if v.is_empty() { Ok(None) } else { Ok(Some(v)) }
    }
    /// `JSValue.getOwnTruthy` — own-property lookup, filtered to non-undefined.
    pub fn get_own_truthy(
        self,
        global: &JSGlobalObject,
        property_name: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        let name = bun_core::String::borrow_utf8(property_name.as_ref());
        match self.get_own(global, &name)? {
            Some(prop) if !prop.is_undefined() => Ok(Some(prop)),
            _ => Ok(None),
        }
    }
    /// `JSValue.getOwnObject` — own-property lookup; throws "{prop} must be an
    /// object" when the own-truthy value is not an object (JSValue.zig:1812).
    pub fn get_own_object(
        self,
        global: &JSGlobalObject,
        property_name: impl AsRef<[u8]>,
    ) -> JsResult<Option<*mut JSObject>> {
        let property_name = property_name.as_ref();
        match self.get_own_truthy(global, property_name)? {
            Some(v) => match v.get_object() {
                Some(obj) => Ok(Some(obj)),
                None => Err(global.throw_invalid_arguments(format_args!(
                    "{} must be an object",
                    alloc::string::String::from_utf8_lossy(property_name),
                ))),
            },
            None => Ok(None),
        }
    }
    /// `JSValue.getOwnArray` — own-property lookup (no prototype walk) routed
    /// through `coerceToArray` (JSValue.zig:1784): non-array truthy → throw
    /// "{prop} must be an array"; empty array → `None`.
    pub fn get_own_array(
        self,
        global: &JSGlobalObject,
        property_name: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        let property_name = property_name.as_ref();
        let Some(v) = self.get_own_truthy(global, property_name)? else {
            return Ok(None);
        };
        if !(v.is_cell() && v.js_type().is_array()) {
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be an array",
                alloc::string::String::from_utf8_lossy(property_name),
            )));
        }
        if v.get_length(global)? == 0 {
            return Ok(None);
        }
        Ok(Some(v))
    }
    /// `JSValue.isClass` — true if the callable is a class constructor.
    pub fn is_class(self, global: &JSGlobalObject) -> bool {
        unsafe extern "C" {
            safe fn JSC__JSValue__isClass(this: JSValue, global: &JSGlobalObject) -> bool;
        }
        JSC__JSValue__isClass(self, global)
    }

    // ── Iteration (JSValue.zig:2199-2223). ────────────────────────────────
    /// `JSValue.isIterable`.
    pub fn is_iterable(self, global: &JSGlobalObject) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__isIterable(self, global))
    }
    /// `JSValue.forEach` — invoke `callback` for each iterable element.
    pub fn for_each(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachCallback,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__forEach(self, global, ctx, callback)
        })
    }
    /// `JSValue.forEachWithContext` — typed-ctx wrapper (Zig erased the ctx
    /// type via `@ptrCast`; callers here pass `*mut c_void` directly).
    #[inline]
    pub fn for_each_with_context(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachCallback,
    ) -> JsResult<()> {
        self.for_each(global, ctx, callback)
    }
    /// `JSValue.forEachProperty` (JSValue.zig:96) — enumerate own props,
    /// invoking `callback` per (key, value, is_symbol, is_private_symbol).
    ///
    /// Mirrors the Zig codegen wrapper shape (cpp.zig `check_slow`): seat the
    /// exception scope and call the FFI directly so the deep `print_as`
    /// recursion does not pay an extra closure frame per object level.
    #[inline(always)]
    pub fn for_each_property(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachPropertyCallback,
    ) -> JsResult<()> {
        unsafe extern "C" {
            // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle
            // (`&` is ABI-identical to non-null `*const`); `ctx` is an opaque
            // round-trip pointer C++ only forwards to `callback` (same contract
            // as `JSC__JSValue__forEach` above).
            safe fn JSC__JSValue__forEachProperty(
                this: JSValue,
                global: &JSGlobalObject,
                ctx: *mut c_void,
                callback: ForEachPropertyCallback,
            );
        }
        crate::top_scope!(scope, global);
        JSC__JSValue__forEachProperty(self, global, ctx, callback);
        scope.return_if_exception()
    }
    /// `JSValue.forEachPropertyNonIndexed` (JSValue.zig:87) — like
    /// [`for_each_property`](Self::for_each_property) but skips array-index
    /// keys.
    pub fn for_each_property_non_indexed(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachPropertyCallback,
    ) -> JsResult<()> {
        unsafe extern "C" {
            // safe: same contract as `JSC__JSValue__forEachProperty` above.
            safe fn JSC__JSValue__forEachPropertyNonIndexed(
                this: JSValue,
                global: &JSGlobalObject,
                ctx: *mut c_void,
                callback: ForEachPropertyCallback,
            );
        }
        crate::top_scope!(scope, global);
        JSC__JSValue__forEachPropertyNonIndexed(self, global, ctx, callback);
        scope.return_if_exception()
    }
    /// `JSValue.forEachPropertyOrdered` (JSValue.zig:105) — like
    /// [`for_each_property`](Self::for_each_property) but visits keys in
    /// stable enumeration order (used by `console.log` with
    /// `ordered_properties`).
    #[inline(always)]
    pub fn for_each_property_ordered(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachPropertyCallback,
    ) -> JsResult<()> {
        unsafe extern "C" {
            // safe: same contract as `JSC__JSValue__forEachProperty` above.
            safe fn JSC__JSValue__forEachPropertyOrdered(
                this: JSValue,
                global: &JSGlobalObject,
                ctx: *mut c_void,
                callback: ForEachPropertyCallback,
            );
        }
        let mut scope_storage = core::mem::MaybeUninit::uninit();
        let scope = crate::TopExceptionScope::init(&mut scope_storage, global);
        JSC__JSValue__forEachPropertyOrdered(self, global, ctx, callback);
        let result = scope.return_if_exception();
        // SAFETY: `scope` was init'd above and is destroyed exactly once.
        unsafe { crate::TopExceptionScope::destroy(scope) };
        result
    }
    /// `JSValue.isBuffer` (JSValue.zig:492) — `instanceof Buffer` check via
    /// the C++ `JSBuffer__isBuffer` shim. Accepts any JSValue; the C++ side
    /// handles non-cells (returns false), so no precondition is asserted.
    pub fn is_buffer(self, global: &JSGlobalObject) -> bool {
        unsafe extern "C" {
            safe fn JSBuffer__isBuffer(global: &JSGlobalObject, value: JSValue) -> bool;
        }
        JSBuffer__isBuffer(global, self)
    }
    /// `JSValue.getDirectIndex` (JSValue.zig:65) — read the `i`th indexed
    /// own-property slot directly (no prototype walk, no getters). Returns
    /// the empty value for holes.
    pub fn get_direct_index(self, global: &JSGlobalObject, i: u32) -> JSValue {
        unsafe extern "C" {
            safe fn JSC__JSValue__getDirectIndex(
                this: JSValue,
                global: &JSGlobalObject,
                i: u32,
            ) -> JSValue;
        }
        JSC__JSValue__getDirectIndex(self, global, i)
    }
    /// `JSValue.getNameProperty` (JSValue.zig:1119) — write the value's
    /// `.name` (function/class name) into `ret`. No-op for empty/`undefined`/`null`.
    pub fn get_name_property(
        self,
        global: &JSGlobalObject,
        ret: &mut bun_core::ZigString,
    ) -> JsResult<()> {
        if self.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        unsafe extern "C" {
            safe fn JSC__JSValue__getNameProperty(
                this: JSValue,
                global: &JSGlobalObject,
                ret: &mut bun_core::ZigString,
            );
        }
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__getNameProperty(self, global, ret)
        })
    }

    // ── Proxy internals (JSValue.zig:2326). ───────────────────────────────
    /// Asserts `self` is a `Proxy`.
    pub fn get_proxy_internal_field(self, field: ProxyField) -> JSValue {
        debug_assert!(self.is_cell() && self.js_type() == JSType::ProxyObject);
        Bun__ProxyObject__getInternalField(self, field as u32)
    }

    // ── Formatting (JSValue.zig:2030). ────────────────────────────────────
    #[inline]
    pub fn fmt_string(self, global: &JSGlobalObject) -> StringFormatter<'_> {
        StringFormatter {
            value: self,
            global,
        }
    }

    /// `JSValue.toFmt(formatter)` (JSValue.zig:2037) — reset `formatter` for a
    /// fresh top-level format of `self` and return a `Display` adapter.
    ///
    /// The Zig spec also called `formatter.deinit()` when `map_node != null`
    /// (releasing the visited-pool node mid-flight); the Rust `Formatter` runs
    /// that logic in `Drop`, so reusing a formatter that already owns a
    /// `map_node` is handled at end-of-scope instead. All current callers pass
    /// a freshly-constructed formatter (`map_node == None`).
    pub fn to_fmt<'a, 'b>(
        self,
        formatter: &'a mut crate::console_object::Formatter<'b>,
    ) -> crate::console_object::formatter::ZigFormatter<'a, 'b> {
        formatter.remaining_values = bun_ptr::RawSlice::EMPTY;
        formatter.stack_check.update();
        crate::console_object::formatter::ZigFormatter::new(formatter, self)
    }

    // ── Next-tick scheduling (JSValue.zig:275). ───────────────────────────
    /// `JSValue.callNextTick(global, .{arg})` for the 1-arg case.
    pub fn call_next_tick_1(
        function: JSValue,
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            Bun__Process__queueNextTick1(global, function, arg)
        })
    }

    // ── Structured clone (JSValue.zig:2279, 2309). ────────────────────────
    /// `JSValue.deserialize(bytes, global)`.
    pub fn deserialize(bytes: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `global` is live; `bytes` valid for the call.
        host_fn::from_js_host_call(global, || unsafe {
            Bun__JSValue__deserialize(global, bytes.as_ptr(), bytes.len())
        })
    }
    /// `JSValue.serialize(global, flags)` — structured-clone to bytes.
    pub fn serialize(
        self,
        global: &JSGlobalObject,
        flags: SerializedFlags,
    ) -> JsResult<SerializedScriptValue> {
        let mut bits: u8 = 0;
        if flags.for_cross_process_transfer {
            bits |= 1 << 0;
        }
        if flags.for_storage {
            bits |= 1 << 1;
        }
        let ext = host_fn::from_js_host_call_generic(global, || {
            Bun__serializeJSValue(global, self, bits)
        })?;
        if ext.bytes.is_null() || ext.handle.is_null() {
            return Err(JsError::Thrown);
        }
        Ok(SerializedScriptValue {
            bytes: ext.bytes,
            size: ext.size,
            handle: ext.handle,
        })
    }
}

unsafe extern "C" {
    safe fn JSC__JSValue__eqlValue(this: JSValue, other: JSValue) -> bool;
    safe fn JSC__JSValue__isSameValue(
        this: JSValue,
        other: JSValue,
        global: &JSGlobalObject,
    ) -> bool;
    safe fn Bun__JSValue__toNumber(this: JSValue, global: &JSGlobalObject) -> f64;
    safe fn JSC__JSValue__toObject(this: JSValue, global: &JSGlobalObject) -> *mut JSObject;
    safe fn JSC__JSValue__unwrapBoxedPrimitive(global: &JSGlobalObject, this: JSValue) -> JSValue;
    safe fn JSC__JSValue__getPrototype(this: JSValue, global: &JSGlobalObject) -> JSValue;
    safe fn JSC__JSValue__getName(
        this: JSValue,
        global: &JSGlobalObject,
        out: &mut bun_core::String,
    );
    safe fn JSC__JSValue__getClassName(
        this: JSValue,
        global: &JSGlobalObject,
        out: &mut bun_core::ZigString,
    );
    safe fn JSC__JSValue__getSymbolDescription(
        this: JSValue,
        global: &JSGlobalObject,
        out: &mut bun_core::ZigString,
    );
    safe fn JSC__JSValue__symbolFor(
        global: &JSGlobalObject,
        key: &mut bun_core::ZigString,
    ) -> JSValue;
    safe fn JSC__JSValue__getOwn(
        this: JSValue,
        global: &JSGlobalObject,
        name: &bun_core::String,
    ) -> JSValue;
    safe fn JSC__JSValue__isIterable(this: JSValue, global: &JSGlobalObject) -> bool;
    safe fn JSC__JSValue__forEach(
        this: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachCallback,
    );
    safe fn Bun__ProxyObject__getInternalField(this: JSValue, field: u32) -> JSValue;
    safe fn Bun__Process__queueNextTick1(global: &JSGlobalObject, func: JSValue, arg: JSValue);
    fn Bun__JSValue__deserialize(
        global: *const JSGlobalObject,
        data: *const u8,
        len: usize,
    ) -> JSValue;
    safe fn Bun__serializeJSValue(
        global: &JSGlobalObject,
        value: JSValue,
        flags: u8,
    ) -> SerializedScriptValueExternal;
    fn Bun__SerializedScriptSlice__free(handle: *mut c_void);
}

// ──────────────────────────────────────────────────────────────────────────
// Jest / test-runner support (JSValue.zig — `jestDeepEquals` family,
// `asBigIntCompare`, `keys`/`values`, `isInstanceOf`, `isConstructor`,
// `isObjectEmpty`, `getIfPropertyExistsFromPath`, `stringIncludes`,
// `toMatch`). Third tranche, ported for `bun_runtime::test_runner::expect`.
// ──────────────────────────────────────────────────────────────────────────

/// `JSValue.ComparisonResult` (JSValue.zig:923) — result of
/// [`JSValue::as_big_int_compare`].
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComparisonResult {
    Equal = 0,
    Undefined = 1,
    GreaterThan = 2,
    LessThan = 3,
    InvalidComparison = 4,
}

impl JSValue {
    // ── Jest deep-equality (JSValue.zig:1957-1975). ───────────────────────
    /// `JSValue.jestDeepEquals` — Jest's recursive `expect(a).toEqual(b)`
    /// semantics (asymmetric matchers, undefined-equals-missing, etc.).
    pub fn jest_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__jestDeepEquals(self, other, global)
        })
    }
    /// `JSValue.jestStrictDeepEquals` — `expect(a).toStrictEqual(b)`.
    pub fn jest_strict_deep_equals(
        self,
        other: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__jestStrictDeepEquals(self, other, global)
        })
    }
    /// `JSValue.jestDeepMatch` — `expect(a).toMatchObject(b)` /
    /// snapshot-property-matcher subset comparison.
    pub fn jest_deep_match(
        self,
        subset: JSValue,
        global: &JSGlobalObject,
        replace_props_with_asymmetric_matchers: bool,
    ) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__jestDeepMatch(
                self,
                subset,
                global,
                replace_props_with_asymmetric_matchers,
            )
        })
    }

    // ── BigInt ordering (JSValue.zig:931). ────────────────────────────────
    /// `JSValue.asBigIntCompare` — compare a BigInt against another BigInt or
    /// Number. Returns [`ComparisonResult::InvalidComparison`] if `self` is
    /// not a BigInt or `other` is neither BigInt nor Number.
    pub fn as_big_int_compare(self, global: &JSGlobalObject, other: JSValue) -> ComparisonResult {
        if !self.is_big_int() || (!other.is_big_int() && !other.is_number()) {
            return ComparisonResult::InvalidComparison;
        }
        JSC__JSValue__asBigIntCompare(self, global, other)
    }

    // ── Object.keys / Object.values (JSValue.zig:767-786). ────────────────
    /// `JSValue.keys` — `Object.keys(self)`.
    pub fn keys(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        host_fn::from_js_host_call(global, || JSC__JSValue__keys(global, self))
    }
    /// `JSValue.values` — `Object.values(self)`. `self` must not be
    /// empty/undefined/null (caller-checked).
    pub fn values(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        debug_assert!(!self.is_empty_or_undefined_or_null());
        host_fn::from_js_host_call(global, || JSC__JSValue__values(global, self))
    }

    // ── instanceof / constructor (JSValue.zig:229, 1113). ─────────────────
    /// `JSValue.isInstanceOf` — `self instanceof constructor`.
    pub fn is_instance_of(self, global: &JSGlobalObject, constructor: JSValue) -> JsResult<bool> {
        if !self.is_cell() {
            return Ok(false);
        }
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__isInstanceOf(self, global, constructor)
        })
    }
    /// `JSValue.isConstructor`.
    #[inline]
    pub fn is_constructor(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        JSC__JSValue__isConstructor(self)
    }

    // ── Jest "is empty object" (JSValue.zig:1097). ────────────────────────
    /// `JSValue.isObjectEmpty` — Jest-extended `toBeEmptyObject` semantics:
    /// Map/Set/RegExp/Date are *not* empty objects; otherwise an object with
    /// zero own-enumerable keys.
    pub fn is_object_empty(self, global: &JSGlobalObject) -> JsResult<bool> {
        let ty = self.js_type();
        // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
        if ty.is_map() || ty.is_set() || ty == JSType::RegExpObject || self.is_date() {
            return Ok(false);
        }
        Ok(ty.is_object() && self.keys(global)?.get_length(global)? == 0)
    }

    // ── Length introspection (JSValue.zig:2189). ──────────────────────────
    /// `JSValue.getLengthIfPropertyExistsInternal` — returns `f64::MAX` when
    /// no `length`-ish property exists. Do not call directly; prefer
    /// [`JSValue::get_length`].
    pub fn get_length_if_property_exists_internal(self, global: &JSGlobalObject) -> JsResult<f64> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__getLengthIfPropertyExistsInternal(self, global)
        })
    }

    // ── Path lookup (JSValue.zig:1457). ───────────────────────────────────
    /// `JSValue.getIfPropertyExistsFromPath` — Jest `toHaveProperty` path
    /// resolution (accepts `"a.b[0].c"` string or array path).
    pub fn get_if_property_exists_from_path(
        self,
        global: &JSGlobalObject,
        path: JSValue,
    ) -> JsResult<JSValue> {
        // Zig (JSValue.zig:1458): manual `TopExceptionScope` + `returnIfException`.
        crate::top_scope!(scope, global);
        let result = JSC__JSValue__getIfPropertyExistsFromPath(self, global, path);
        scope.return_if_exception()?;
        Ok(result)
    }

    // ── String / RegExp matching (JSValue.zig:1202, 2225). ────────────────
    /// `JSValue.stringIncludes` — `self.includes(other)` for JS strings.
    pub fn string_includes(self, global: &JSGlobalObject, other: JSValue) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || {
            JSC__JSValue__stringIncludes(self, global, other)
        })
    }
    /// `JSValue.toMatch` — `self` is a RegExp, `other` is a string;
    /// returns `self.test(other)`.
    pub fn to_match(self, global: &JSGlobalObject, other: JSValue) -> JsResult<bool> {
        host_fn::from_js_host_call_generic(global, || JSC__JSValue__toMatch(self, global, other))
    }
}

unsafe extern "C" {
    safe fn JSC__JSValue__jestDeepEquals(
        this: JSValue,
        other: JSValue,
        global: &JSGlobalObject,
    ) -> bool;
    safe fn JSC__JSValue__jestStrictDeepEquals(
        this: JSValue,
        other: JSValue,
        global: &JSGlobalObject,
    ) -> bool;
    safe fn JSC__JSValue__jestDeepMatch(
        this: JSValue,
        subset: JSValue,
        global: &JSGlobalObject,
        replace_props: bool,
    ) -> bool;
    safe fn JSC__JSValue__asBigIntCompare(
        this: JSValue,
        global: &JSGlobalObject,
        other: JSValue,
    ) -> ComparisonResult;
    safe fn JSC__JSValue__keys(global: &JSGlobalObject, value: JSValue) -> JSValue;
    safe fn JSC__JSValue__values(global: &JSGlobalObject, value: JSValue) -> JSValue;
    safe fn JSC__JSValue__isInstanceOf(
        this: JSValue,
        global: &JSGlobalObject,
        constructor: JSValue,
    ) -> bool;
    safe fn JSC__JSValue__isConstructor(this: JSValue) -> bool;
    safe fn JSC__JSValue__getIfPropertyExistsFromPath(
        this: JSValue,
        global: &JSGlobalObject,
        path: JSValue,
    ) -> JSValue;
    safe fn JSC__JSValue__stringIncludes(
        this: JSValue,
        global: &JSGlobalObject,
        other: JSValue,
    ) -> bool;
    safe fn JSC__JSValue__toMatch(this: JSValue, global: &JSGlobalObject, other: JSValue) -> bool;
}
