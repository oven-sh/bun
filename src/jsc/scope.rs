//! Branded-scope layer over the raw JSC FFI ("rusty_jsc" prototype).
//!
//! Zero runtime cost: `Scope` is a `&JSGlobalObject` wrapper, `Local` is
//! `repr(transparent)` over `JSValue`, and every guarantee below is enforced
//! purely at compile time. The soundness contract for stack-held values is
//! identical to raw `JSValue` today — JSC's conservative scanner roots
//! anything live in stack memory or registers.
//!
//! Two guarantees the raw `JSValue` API cannot express:
//!
//! 1. **No heap escape without rooting.** A [`Local<'s>`] cannot be stored
//!    anywhere that outlives its scope. Persisting requires the explicit,
//!    owning [`Scope::persist`] → [`Strong`].
//! 2. **Re-entry into user JavaScript is an effect.** Every operation that
//!    can run user JS (coercions, property gets, calls) takes
//!    `&mut Scope<'s>`, so it cannot overlap a borrow handed out from
//!    `&Scope<'s>` (e.g. [`Local::array_buffer_bytes`]). The "R-2" comment
//!    convention becomes a borrow-checker error.
//!
//! Not enforced (same status quo as raw `JSValue`): copying a `Local` into a
//! within-scope heap container (`Vec<Local>`, `Box<Local>`, or an **async
//! block/future** — the easiest accidental heap move, since a suspended
//! future's captures live on the heap) leaves it invisible to the
//! conservative scanner. Accumulate through `MarkedArgumentBuffer` or
//! `Strong` instead — that rooting cost is paid only where rooting is
//! actually needed.
//!
//! [`Local::to_js_string`]'s `&'s JSString` intentionally survives across
//! `&mut Scope` re-entry, unlike [`Local::array_buffer_bytes`]: the
//! reference points at the GC cell itself (stack-rooted, non-moving) and a
//! string's contents cannot be detached, so there is no hazard to exclude.
//!
//! A `Local` cannot leave its scope:
//!
//! ```compile_fail
//! use bun_jsc::scope::{Local, Scope};
//! fn escape(global: &bun_jsc::JSGlobalObject) -> Local<'static> {
//!     Scope::with(global, |scope| scope.undefined())
//! }
//! ```
//!
//! Holding a view into the JS heap across a call that can re-enter user JS
//! (which could detach the buffer) is rejected:
//!
//! ```compile_fail,E0502
//! use bun_jsc::scope::{Local, Scope};
//! fn hazard<'s>(
//!     scope: &mut Scope<'s>,
//!     ab: Local<'s>,
//!     cb: Local<'s>,
//! ) -> bun_jsc::JsResult<u8> {
//!     let undef = scope.undefined();
//!     let bytes = ab.array_buffer_bytes(scope).unwrap();
//!     cb.call(scope, undef, &[])?; // user JS could detach `ab`
//!     Ok(bytes[0])
//! }
//! ```

use core::marker::PhantomData;
use core::ops::Deref;

use crate::js_value::PutKey;
use crate::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSString, JSType, JSValue, JsClass, JsError,
    JsResult, Strong,
};

/// Capability token for one JS entry frame. A newtype over
/// `&JSGlobalObject` — construction compiles to nothing in release builds.
///
/// A `&Scope<'s>` is only meaningful on the JS thread that owns `global`'s
/// VM (debug-asserted in [`Scope::with`]); there, stack-held `Local<'s>`
/// values are conservatively scanned. The brand lifetime is invariant and
/// issued fresh per [`Scope::with`], so locals from different scopes never
/// unify.
pub struct Scope<'s> {
    global: &'s JSGlobalObject,
    _brand: PhantomData<*mut &'s ()>,
}

impl<'s> Scope<'s> {
    /// Enter a scope. The higher-ranked closure lifetime is the brand: no
    /// `Local` created inside can escape through the return value.
    #[inline(always)]
    pub fn with<R>(global: &JSGlobalObject, f: impl for<'t> FnOnce(&mut Scope<'t>) -> R) -> R {
        // One VM per thread, set thread-locally at VM init: a scope opened on
        // a thread with no VM is a bug the conservative-scan contract can't
        // survive.
        debug_assert!(
            crate::virtual_machine::VirtualMachine::get_or_null().is_some(),
            "Scope::with on a thread with no VirtualMachine (not a JS thread)"
        );
        f(&mut Scope {
            global,
            _brand: PhantomData,
        })
    }

    /// Migration escape hatch: the unscoped global for pre-scope APIs.
    /// Anything done through it is outside this module's guarantees.
    #[inline(always)]
    pub fn unscoped_global(&self) -> &'s JSGlobalObject {
        self.global
    }

    /// Brand a raw `JSValue` obtained from unmigrated code. Free.
    #[inline(always)]
    pub fn local(&self, raw: JSValue) -> Local<'s> {
        debug_assert!(
            !raw.is_empty(),
            "JSValue::ZERO is not a value; propagate Err(JsError::Thrown) instead"
        );
        Local {
            raw,
            _brand: PhantomData,
        }
    }

    #[inline(always)]
    pub fn undefined(&self) -> Local<'s> {
        Local {
            raw: JSValue::UNDEFINED,
            _brand: PhantomData,
        }
    }

    #[inline(always)]
    pub fn null(&self) -> Local<'s> {
        self.local(JSValue::NULL)
    }

    #[inline(always)]
    pub fn boolean(&self, b: bool) -> Local<'s> {
        self.local(JSValue::js_boolean(b))
    }

    #[inline(always)]
    pub fn number(&self, n: f64) -> Local<'s> {
        self.local(JSValue::js_number(n))
    }

    #[inline(always)]
    pub fn number_from_int32(&self, n: i32) -> Local<'s> {
        self.local(JSValue::js_number_from_int32(n))
    }

    // ── Errors & exceptions. Throwing formats Rust-side data and
    // allocates the error object — it never runs user JS (stack capture is
    // native; `Error.prepareStackTrace` fires lazily on `.stack` access),
    // so these take `&self`. Variants that *inspect a user value* to build
    // the message (`*_value`) reach `determineSpecificType`, which reads
    // `.constructor` (a getter/Proxy trap) — those take `&mut self`. ──────

    /// See [`JSGlobalObject::throw`].
    #[inline(always)]
    pub fn throw(&self, args: core::fmt::Arguments<'_>) -> JsError {
        self.global.throw(args)
    }

    /// `ERR_INVALID_ARG_TYPE` from a format string.
    #[inline(always)]
    pub fn throw_invalid_arguments(&self, args: core::fmt::Arguments<'_>) -> JsError {
        self.global.throw_invalid_arguments(args)
    }

    /// "The `name.field` property must be of type `typename`."
    #[inline(always)]
    pub fn throw_invalid_argument_type(
        &self,
        name_: &'static str,
        field: &'static str,
        typename: &'static str,
    ) -> JsError {
        self.global
            .throw_invalid_argument_type(name_, field, typename)
    }

    #[inline(always)]
    pub fn throw_not_enough_arguments(
        &self,
        name_: &'static str,
        expected: usize,
        got: usize,
    ) -> JsError {
        self.global.throw_not_enough_arguments(name_, expected, got)
    }

    #[inline(always)]
    pub fn throw_range_error<V: bun_core::fmt::OutOfRangeValue>(
        &self,
        value: V,
        options: bun_core::fmt::OutOfRangeOptions<'_>,
    ) -> JsError {
        self.global.throw_range_error(value, options)
    }

    #[inline(always)]
    pub fn throw_out_of_memory(&self) -> JsError {
        self.global.throw_out_of_memory()
    }

    /// Throw `value` as-is.
    #[inline(always)]
    pub fn throw_value(&self, value: Local<'s>) -> JsError {
        self.global.throw_value(value.raw)
    }

    /// Error builder for a specific `ErrorCode`; finish with `.throw()` or
    /// `.to_js()`.
    #[inline(always)]
    pub fn err<'a>(
        &'a self,
        code: crate::ErrorCode,
        args: core::fmt::Arguments<'a>,
    ) -> crate::ErrorBuilder<'a, JSGlobalObject> {
        self.global.err(code, args)
    }

    /// "The X argument must be of type Y. Received {inspected value}" —
    /// inspecting the value reads `.constructor` (getter/Proxy trap), so
    /// this is `&mut`.
    #[inline(always)]
    pub fn throw_invalid_argument_type_value(
        &mut self,
        argname: impl AsRef<[u8]>,
        typename: impl AsRef<[u8]>,
        value: Local<'s>,
    ) -> JsError {
        self.global
            .throw_invalid_argument_type_value(argname, typename, value.raw)
    }

    #[inline(always)]
    pub fn has_exception(&self) -> bool {
        self.global.has_exception()
    }

    #[inline(always)]
    pub fn clear_exception(&self) {
        self.global.clear_exception()
    }

    /// The VM owning this scope's global.
    #[inline(always)]
    pub fn bun_vm(&self) -> &'static crate::virtual_machine::VirtualMachine {
        self.global.bun_vm()
    }

    // ── Creation: pure allocation, no user JS. ───────────────────────────

    /// JSString from a `bun_core::String` (clones/refs the underlying impl).
    #[inline(always)]
    pub fn string(&self, s: &bun_core::String) -> JsResult<Local<'s>> {
        Ok(self.local(crate::bun_string_jsc::to_js(s, self.global)?))
    }

    /// JSString from UTF-8 bytes.
    #[inline(always)]
    pub fn string_utf8(&self, utf8: &[u8]) -> JsResult<Local<'s>> {
        Ok(self.local(crate::bun_string_jsc::create_utf8_for_js(
            self.global,
            utf8,
        )?))
    }

    /// JSString that takes ownership of `s`'s backing store (zero-copy for
    /// WTF-backed strings).
    #[inline(always)]
    pub fn transfer_string(&self, mut s: bun_core::String) -> JsResult<Local<'s>> {
        Ok(self.local(crate::bun_string_jsc::transfer_to_js(&mut s, self.global)?))
    }

    /// `{}` with `capacity` inline slots.
    #[inline(always)]
    pub fn new_object(&self, capacity: usize) -> Local<'s> {
        self.local(JSValue::create_empty_object(self.global, capacity))
    }

    /// `[]` with `len` slots.
    #[inline(always)]
    pub fn new_array(&self, len: usize) -> JsResult<Local<'s>> {
        Ok(self.local(JSValue::create_empty_array(self.global, len)?))
    }

    /// Already-fulfilled promise. Skips the resolve algorithm entirely (no
    /// thenable `.then` lookup), so `&self` is sound — unlike
    /// `JSPromise::resolve`.
    #[inline(always)]
    pub fn resolved_promise(&self, value: Local<'s>) -> Local<'s> {
        self.local(JSPromise::resolved_promise_value(self.global, value.raw))
    }

    /// Already-rejected promise without the unhandled-rejection bookkeeping;
    /// see the raw API's name for the caveat.
    #[inline(always)]
    pub fn rejected_promise_dangerously_without_notifying_vm(&self, value: Local<'s>) -> Local<'s> {
        self.local(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                self.global,
                value.raw,
            ),
        )
    }

    /// The only way a value outlives its scope: an owning GC root.
    pub fn persist(&self, value: Local<'s>) -> Strong {
        Strong::create(value.raw, self.global)
    }

    /// Re-enter a `Strong` into this scope. The returned `Local` is valid for
    /// `'s` only while rooted — keep the `Strong` alive or on the stack.
    #[inline(always)]
    pub fn open(&self, strong: &Strong) -> Local<'s> {
        self.local(strong.get())
    }
}

/// A JS value branded by its scope. `Copy`, `!Send`, `repr(transparent)`
/// over `JSValue` — zero representation cost. Cannot be stored anywhere that
/// outlives its scope; see the module docs.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Local<'s> {
    raw: JSValue,
    _brand: PhantomData<*mut &'s ()>,
}

impl<'s> Local<'s> {
    /// Escape hatch to unmigrated APIs taking raw `JSValue`. The raw copy
    /// re-opens the hazards this type exists to prevent; the per-file count
    /// is pinned by `test/internal/scope-escapes.test.ts` alongside
    /// [`Scope::unscoped_global`].
    #[inline(always)]
    pub fn unscoped(self) -> JSValue {
        self.raw
    }

    // ── Effect-free reads: cannot run JS, cannot throw. ──────────────────

    #[inline(always)]
    pub fn is_string(self) -> bool {
        self.raw.is_string()
    }

    #[inline(always)]
    pub fn is_number(self) -> bool {
        self.raw.is_number()
    }

    #[inline(always)]
    pub fn is_callable(self) -> bool {
        self.raw.is_callable()
    }

    #[inline(always)]
    pub fn is_object(self) -> bool {
        self.raw.is_object()
    }

    #[inline(always)]
    pub fn is_cell(self) -> bool {
        self.raw.is_cell()
    }

    #[inline(always)]
    pub fn is_boolean(self) -> bool {
        self.raw.is_boolean()
    }

    #[inline(always)]
    pub fn is_int32(self) -> bool {
        self.raw.is_int32()
    }

    #[inline(always)]
    pub fn is_any_int(self) -> bool {
        self.raw.is_any_int()
    }

    #[inline(always)]
    pub fn is_undefined(self) -> bool {
        self.raw.is_undefined()
    }

    #[inline(always)]
    pub fn is_null(self) -> bool {
        self.raw.is_null()
    }

    #[inline(always)]
    pub fn is_undefined_or_null(self) -> bool {
        self.raw.is_undefined_or_null()
    }

    /// Like [`Self::is_undefined_or_null`] but also true for the empty
    /// value. A `Local` is never empty when the [`Scope::local`]
    /// debug-assert holds; this exists so migrated guards keep their exact
    /// release-build semantics.
    #[inline(always)]
    pub fn is_empty_or_undefined_or_null(self) -> bool {
        self.raw.is_empty_or_undefined_or_null()
    }

    /// True for Int32 and for doubles that hold an exact `u32`.
    #[inline(always)]
    pub fn is_uint32_as_any_int(self) -> bool {
        self.raw.is_uint32_as_any_int()
    }

    #[inline(always)]
    pub fn is_symbol(self) -> bool {
        self.raw.is_symbol()
    }

    #[inline(always)]
    pub fn is_big_int(self) -> bool {
        self.raw.is_big_int()
    }

    /// JSType-byte check (a callable Proxy is *not* a function here; see
    /// [`Self::is_callable`]).
    #[inline(always)]
    pub fn is_function(self) -> bool {
        self.raw.is_function()
    }

    /// JSType-byte check; does not look through Proxies (`Array.isArray`
    /// semantics need the raw `is_array_slow` path).
    #[inline(always)]
    pub fn is_array(self) -> bool {
        self.raw.is_array()
    }

    #[inline(always)]
    pub fn is_date(self) -> bool {
        self.raw.is_date()
    }

    /// Date's time value; caller must have checked [`Self::is_date`].
    #[inline(always)]
    pub fn get_unix_timestamp(self) -> f64 {
        self.raw.get_unix_timestamp()
    }

    #[inline(always)]
    pub fn js_type(self) -> JSType {
        self.raw.js_type()
    }

    /// [`Self::js_type`], but non-cell numbers map to `NumberObject` so a
    /// single `match` covers both.
    #[inline(always)]
    pub fn js_type_loose(self) -> JSType {
        self.raw.js_type_loose()
    }

    /// Keep-alive fence: prevents the optimizer from ending this value's
    /// stack lifetime before this point.
    #[inline(always)]
    pub fn ensure_still_alive(self) {
        self.raw.ensure_still_alive()
    }

    /// Non-coercing read; caller must have checked [`Self::is_boolean`].
    #[inline(always)]
    pub fn as_boolean(self) -> bool {
        self.raw.as_boolean()
    }

    /// Non-coercing read; caller must have checked [`Self::is_int32`].
    #[inline(always)]
    pub fn as_int32(self) -> i32 {
        self.raw.as_int32()
    }

    /// Non-coercing read; caller must have checked [`Self::is_number`].
    #[inline(always)]
    pub fn as_number(self) -> f64 {
        self.raw.as_number()
    }

    /// ECMA `ToBoolean` — never runs user code.
    #[inline(always)]
    pub fn to_boolean(self) -> bool {
        self.raw.to_boolean()
    }

    /// Downcast to a `.classes.ts` payload. Pure FFI type check. The borrow
    /// is bounded by the scope: the payload is freed by the wrapper's GC
    /// finalizer, so the raw API's `&'static` would be a use-after-free
    /// waiting to be stashed — `'s` keeps it inside the frame that roots the
    /// wrapper.
    ///
    /// ```compile_fail
    /// use bun_jsc::{JSGlobalObject, JSValue, JsClass, Scope};
    /// fn steal<T: JsClass + 'static>(global: &JSGlobalObject, v: JSValue) -> &'static T {
    ///     Scope::with(global, |scope| scope.local(v).as_class_ref::<T>().unwrap())
    /// }
    /// ```
    #[inline(always)]
    pub fn as_class_ref<T: JsClass + 'static>(self) -> Option<&'s T> {
        self.raw.as_class_ref::<T>()
    }

    // ── Operations that can re-enter user JavaScript. ────────────────────
    // `&mut Scope` is the effect: it conflicts with any outstanding borrow
    // derived from `&Scope` (heap views), which is exactly the R-2 hazard.

    /// ECMA `ToNumber`; may run `valueOf`/`toString` on user objects.
    #[inline(always)]
    pub fn to_number(self, scope: &mut Scope<'s>) -> JsResult<f64> {
        self.raw.to_number(scope.global)
    }

    /// Non-coercing numeric read (NaN → 0, out-of-range saturates). Never
    /// runs user JS and never throws — the C++ layer asserts (debug) or
    /// reads garbage (release) on non-numeric cells, so check
    /// [`Self::is_number`] first, or use [`Self::coerce`] for real ECMA
    /// ToInt32 semantics.
    #[inline(always)]
    pub fn to_int32(self, _scope: &Scope<'s>) -> i32 {
        debug_assert!(self.raw.is_number());
        self.raw.to_int32()
    }

    /// See [`Self::to_int32`] (numbers and BigInts only).
    #[inline(always)]
    pub fn to_int64(self, _scope: &Scope<'s>) -> i64 {
        debug_assert!(self.raw.is_number() || self.raw.is_big_int());
        self.raw.to_int64()
    }

    /// See [`Self::to_int32`] — saturating `[0, u32::MAX]` clamp.
    #[inline(always)]
    pub fn to_u32(self, _scope: &Scope<'s>) -> u32 {
        debug_assert!(self.raw.is_number());
        self.raw.to_u32()
    }

    /// Non-coercing `u64` read of an Int32/double/BigInt (no ToNumber).
    #[inline(always)]
    pub fn to_uint64_no_truncate(self) -> u64 {
        self.raw.to_uint64_no_truncate()
    }

    /// ECMA coercion via [`crate::js_value::CoerceTo`]; may run
    /// `valueOf`/`toString` on user objects.
    #[inline(always)]
    pub fn coerce<T: crate::js_value::CoerceTo>(self, scope: &mut Scope<'s>) -> JsResult<T> {
        self.raw.coerce(scope.global)
    }

    /// Node `validatePort` semantics; may coerce via ToNumber.
    #[inline(always)]
    pub fn to_port_number(self, scope: &mut Scope<'s>) -> JsResult<u16> {
        self.raw.to_port_number(scope.global)
    }

    /// String coercion; may run a String subclass's `toString`.
    #[inline(always)]
    pub fn to_js_string(self, scope: &mut Scope<'s>) -> JsResult<&'s JSString> {
        self.raw.to_js_string(scope.global)
    }

    /// String coercion; may run a String subclass's `toString`.
    #[inline(always)]
    pub fn to_bun_string(self, scope: &mut Scope<'s>) -> JsResult<bun_core::String> {
        self.raw.to_bun_string(scope.global)
    }

    /// String coercion; may run a String subclass's `toString`.
    #[inline(always)]
    pub fn get_zig_string(self, scope: &mut Scope<'s>) -> JsResult<bun_core::ZigString> {
        self.raw.get_zig_string(scope.global)
    }

    /// String coercion into a UTF-8 slice; may run a String subclass's
    /// `toString`.
    #[inline(always)]
    pub fn to_slice(self, scope: &mut Scope<'s>) -> JsResult<bun_core::ZigStringSlice> {
        self.raw.to_slice(scope.global)
    }

    /// Property get; may run getters and Proxy traps.
    #[inline(always)]
    pub fn get(
        self,
        scope: &mut Scope<'s>,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<Local<'s>>> {
        Ok(self
            .raw
            .get(scope.global, property)?
            .map(|v| scope.local(v)))
    }

    /// [`Self::get`] filtered to truthy values; may run getters and Proxy traps.
    #[inline(always)]
    pub fn get_truthy(
        self,
        scope: &mut Scope<'s>,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<Local<'s>>> {
        Ok(self
            .raw
            .get_truthy(scope.global, property)?
            .map(|v| scope.local(v)))
    }

    /// [`Self::get`] + `ToBoolean` (missing/undefined → `None`); may run
    /// getters and Proxy traps.
    #[inline(always)]
    pub fn get_boolean_loose(
        self,
        scope: &mut Scope<'s>,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<bool>> {
        self.raw.get_boolean_loose(scope.global, property)
    }

    /// Direct property definition (`putDirect`): never runs setters or
    /// Proxy traps, so it takes `&Scope`. The target must be an object —
    /// the C++ layer dereferences it unchecked.
    #[inline(always)]
    pub fn put<K: PutKey>(self, scope: &Scope<'s>, key: K, value: Local<'s>) {
        debug_assert!(self.raw.is_object(), "put target must be an object");
        self.raw.put(scope.global, key, value.raw);
    }

    /// Call this value as a function.
    #[inline(always)]
    pub fn call(
        self,
        scope: &mut Scope<'s>,
        this_value: Local<'s>,
        args: &[Local<'s>],
    ) -> JsResult<Local<'s>> {
        // SAFETY: `Local` is `repr(transparent)` over `JSValue`.
        let raw_args: &[JSValue] =
            unsafe { core::slice::from_raw_parts(args.as_ptr().cast::<JSValue>(), args.len()) };
        let v = self.raw.call(scope.global, this_value.raw, raw_args)?;
        Ok(scope.local(v))
    }

    // ── Borrowed views into the JS heap. ─────────────────────────────────

    /// Bytes of an `ArrayBuffer` / typed-array view. The returned guard
    /// keeps a `JSValue` copy on the caller's stack (so the cell stays
    /// conservatively rooted) and borrows the scope shared, so nothing that
    /// can run user JS — and detach or resize the buffer — can be called
    /// while it lives. Same cost as `as_array_buffer` + `byte_slice` today.
    ///
    /// Resizable buffers are safe under the same discipline: growing never
    /// moves the data pointer (address space is pre-reserved), and shrinking
    /// requires user JS, which the shared borrow excludes. The descriptor is
    /// a snapshot, so bypassing the exclusion through an unscoped escape
    /// hatch leaves a stale pointer/length pair — don't.
    #[inline(always)]
    pub fn array_buffer_bytes<'a>(self, scope: &'a Scope<'s>) -> Option<ArrayBufferBytes<'a, 's>> {
        let ab = self.raw.as_array_buffer(scope.global)?;
        Some(ArrayBufferBytes {
            ab,
            _no_reentry: PhantomData,
        })
    }
}

/// Guard for [`Local::array_buffer_bytes`]. Holds the `ArrayBuffer`
/// descriptor (including its `JSValue`, keeping the cell stack-rooted) and a
/// shared borrow of the scope (excluding user-JS re-entry).
pub struct ArrayBufferBytes<'a, 's> {
    ab: ArrayBuffer,
    _no_reentry: PhantomData<&'a Scope<'s>>,
}

impl Deref for ArrayBufferBytes<'_, '_> {
    type Target = [u8];

    #[inline(always)]
    fn deref(&self) -> &[u8] {
        self.ab.byte_slice()
    }
}

impl CallFrame {
    /// `this` (or `new.target` in constructors), branded.
    #[inline(always)]
    pub fn scoped_this<'s>(&self, scope: &Scope<'s>) -> Local<'s> {
        scope.local(self.this())
    }

    /// Argument `i`, `undefined` when absent.
    #[inline(always)]
    pub fn scoped_argument<'s>(&self, scope: &Scope<'s>, i: usize) -> Local<'s> {
        scope.local(self.argument(i))
    }

    /// First `MAX` arguments, `undefined`-filled (the [`Self::arguments_undef`]
    /// contract), branded.
    #[inline(always)]
    pub fn scoped_arguments<'s, const MAX: usize>(
        &self,
        scope: &Scope<'s>,
    ) -> LocalArguments<'s, MAX> {
        let args = self.arguments_undef::<MAX>();
        LocalArguments {
            ptr: args.ptr.map(|v| scope.local(v)),
            len: args.len,
        }
    }
}

/// Branded mirror of [`crate::call_frame::Arguments`]: `ptr` is
/// `undefined`-filled past `len`.
pub struct LocalArguments<'s, const MAX: usize> {
    pub ptr: [Local<'s>; MAX],
    pub len: usize,
}

impl<'s, const MAX: usize> LocalArguments<'s, MAX> {
    /// `None` for arguments the caller did not pass (unlike indexing `ptr`,
    /// which yields the `undefined` filler).
    #[inline(always)]
    pub fn get(&self, i: usize) -> Option<Local<'s>> {
        (i < self.len).then(|| self.ptr[i])
    }
}
