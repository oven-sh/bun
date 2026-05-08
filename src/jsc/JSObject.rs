use core::ffi::{c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::ManuallyDrop;

use crate::{JSCell, JSGlobalObject, JSValue, JsError, JsResult};
use bun_string::{String as BunString, ZigString};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    static JSC__JSObject__maxInlineCapacity: c_uint;

    fn JSC__JSObject__getIndex(this: JSValue, global_this: *mut JSGlobalObject, i: u32) -> JSValue;
    fn Bun__JSObject__getCodePropertyVMInquiry(global: *mut JSGlobalObject, obj: *mut JSObject) -> JSValue;
    fn JSC__createStructure(
        global: *mut JSGlobalObject,
        owner: *mut JSCell,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue;
    fn JSC__JSObject__create(
        global_object: *mut JSGlobalObject,
        length: usize,
        ctx: *mut c_void,
        initializer: InitializeCallback,
    ) -> JSValue;
    // From bun.cpp namespace; Zig calls via `bun.cpp.*` host-call wrapper.
    // TODO(port): verify C++ return type / fromJSHostCall wrapping — raw symbol
    // signature unconfirmed; declared `void` here to avoid guessing.
    fn JSC__JSObject__putRecord(
        this: *mut JSObject,
        global: *mut JSGlobalObject,
        key: *mut ZigString,
        values: *mut ZigString,
        values_len: usize,
    );
}

/// Opaque JSC `JSObject` cell handle. Always borrowed (`&JSObject` / `&mut JSObject`).
#[repr(C)]
pub struct JSObject {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl JSObject {
    #[inline]
    pub fn max_inline_capacity() -> c_uint {
        // SAFETY: const exported by C++; read-only.
        unsafe { JSC__JSObject__maxInlineCapacity }
    }

    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    /// Marshall a struct instance into a JSObject, copying its properties.
    ///
    /// Each field will be encoded with `jsc::to_js`. Fields whose types have a
    /// `to_js` method will have it called to encode.
    ///
    /// This method is equivalent to `Object.create(...)` + setting properties,
    /// and is only intended for creating POJOs.
    pub fn create<T: PojoFields>(pojo: &T, global: &JSGlobalObject) -> JsResult<&'static mut JSObject> {
        Self::create_from_struct_with_prototype::<T, false>(pojo, global)
    }

    /// Marshall a struct into a JSObject, copying its properties. Its
    /// `__proto__` will be `null`.
    ///
    /// Each field will be encoded with `jsc::to_js`. Fields whose types have a
    /// `to_js` method will have it called to encode.
    ///
    /// This is roughly equivalent to creating an object with
    /// `Object.create(null)` and adding properties to it.
    pub fn create_null_proto<T: PojoFields>(pojo: &T, global: &JSGlobalObject) -> JsResult<&'static mut JSObject> {
        Self::create_from_struct_with_prototype::<T, true>(pojo, global)
    }

    /// Marshall a struct instance into a JSObject. `pojo` is borrowed.
    ///
    /// Each field will be encoded with `jsc::to_js`. Fields whose types have a
    /// `to_js` method will have it called to encode.
    ///
    /// This method is equivalent to `Object.create(...)` + setting properties,
    /// and is only intended for creating POJOs.
    ///
    /// The object's prototype with either be `null` or `ObjectPrototype`
    /// depending on whether `null_prototype` is set. Prefer using the object
    /// prototype (`null_prototype = false`) unless you have a good reason not
    /// to.
    fn create_from_struct_with_prototype<T: PojoFields, const NULL_PROTOTYPE: bool>(
        pojo: &T,
        global: &JSGlobalObject,
    ) -> JsResult<&'static mut JSObject> {
        // TODO(port): Zig used `@typeInfo(T).@"struct"` to enumerate fields at
        // comptime. Rust has no field reflection; `PojoFields` is expected to be
        // provided by a `#[derive(PojoFields)]` proc-macro that emits an inline
        // `put(b"name", JSValue::from_any(global, &self.name)?)?;` per field.

        let val = if NULL_PROTOTYPE {
            JSValue::create_empty_object_with_null_prototype(global)
        } else {
            JSValue::create_empty_object(global, T::FIELD_COUNT)
        };
        debug_assert!(val.is_object());
        // SAFETY: `val.is_object()` asserted above in debug; JSC guarantees
        // these constructors return a JSObject cell. A cell-tagged JSValue's
        // payload IS the cell pointer (NotCellMask bits are zero).
        let obj = unsafe { &mut *(val.0 as *mut JSObject) };

        let cell = obj.to_js();
        // PORT NOTE: Zig used `inline for` — each `fromAny` result is `put()` immediately
        // before the next field is encoded. The callback shape preserves that ordering and
        // keeps every intermediate JSValue on the stack (never collected into a Vec).
        pojo.put_fields(global, |name, value| {
            cell.put(global, name, value);
            Ok(())
        })?;

        Ok(obj)
    }

    pub fn get(&self, global: &JSGlobalObject, prop: impl AsRef<[u8]>) -> JsResult<Option<JSValue>> {
        self.to_js().get(global, prop.as_ref())
    }

    #[inline]
    pub fn put(&self, global: &JSGlobalObject, key: impl AsRef<[u8]>, value: JSValue) -> JsResult<()> {
        self.to_js().put(global, key.as_ref(), value);
        Ok(())
    }

    #[inline]
    pub fn put_all_from_struct<T: JSValueFields>(&self, global: &JSGlobalObject, properties: &T) -> JsResult<()> {
        // TODO(port): Zig used `std.meta.fieldNames(@TypeOf(properties))` +
        // `@field(properties, field)`. Relies on the `JSValueFields` derive.
        // PORT NOTE: Zig's `put` signature forces each field to already be a JSValue —
        // there is NO `fromAny` encoding here (unlike `create`). Hence a separate trait
        // from `PojoFields` that yields raw JSValues without conversion.
        properties.put_fields(|name, value| self.put(global, name, value))
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it.
    /// This mimics the implementation in JavaScriptCore's C++.
    #[inline]
    pub fn ensure_still_alive(&self) {
        core::hint::black_box(std::ptr::from_ref::<Self>(self));
    }

    pub fn create_structure(
        global: &JSGlobalObject,
        owner: JSValue,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue {
        crate::mark_binding!();
        debug_assert!(owner.is_cell());
        // JSObject.zig:118 — passes `owner.asCell()`. A cell-tagged JSValue's
        // payload IS the JSCell* (NotCellMask bits are zero), so the raw usize
        // is the pointer. SAFETY: caller guarantees `owner.is_cell()`.
        let owner_cell = owner.0 as *mut JSCell;
        // SAFETY: thin FFI shim; `owner_cell` is non-null per caller contract.
        // `global.as_ptr()` yields the raw FFI handle — JSGlobalObject is an
        // opaque JSC cell with interior mutability on the C++ side; Rust holds
        // no `&`-derived view of any field C++ mutates.
        unsafe {
            JSC__createStructure(
                global.as_ptr(),
                owner_cell,
                length,
                names,
            )
        }
    }

    pub fn create_with_initializer<Ctx: ObjectInitializer>(
        creator: &mut Ctx,
        global: &JSGlobalObject,
        length: usize,
    ) -> JSValue {
        // SAFETY: `initializer_call::<Ctx>` casts `ctx` back to `*mut Ctx`, which
        // is exactly what we pass here. `global.as_ptr()` is the centralized
        // opaque-handle → `*mut` conversion (JSC mutates VM/heap state through
        // it; interior mutability is the intended contract per JSObject.zig).
        unsafe {
            JSC__JSObject__create(
                global.as_ptr(),
                length,
                std::ptr::from_mut::<Ctx>(creator).cast::<c_void>(),
                initializer_call::<Ctx>,
            )
        }
    }

    pub fn get_index(this: JSValue, global_this: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        // we don't use fromJSHostCall, because it will assert that if there is an exception
        // then the JSValue is zero. the function this ends up calling can return undefined
        // with an exception:
        // https://github.com/oven-sh/WebKit/blob/397dafc9721b8f8046f9448abb6dbc14efe096d3/Source/JavaScriptCore/runtime/JSObjectInlines.h#L112
        // TODO(b2-blocked): TopExceptionScope::init is in-place (Pin); skipped in stub path.
        // SAFETY: thin FFI shim into JSC. `global_this.as_ptr()` yields the raw
        // opaque handle; C++ may set a pending exception (interior mut) but
        // Rust never materializes a `&`-view of that state.
        let value = unsafe { JSC__JSObject__getIndex(this, global_this.as_ptr(), i) };
        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }
        debug_assert!(!value.is_empty());
        Ok(value)
    }

    pub fn put_record(&mut self, global: &JSGlobalObject, key: &mut ZigString, values: &mut [ZigString]) -> JsResult<()> {
        // Zig calls `bun.cpp.JSC__JSObject__putRecord`, whose generated wrapper
        // (build/debug/codegen/cpp.zig) does `Bun__RETURN_IF_EXCEPTION(global)`
        // after the raw call and yields `error.JSError` if a JS exception is
        // pending (a setter / defineOwnProperty inside putRecord can throw).
        // Mirror that here so callers don't observe a silent success.
        // TODO(port): replace with the host-call wrapper once `fromJSHostCall`
        // is ported; raw C++ return type still unverified (see extern decl above).
        // SAFETY: pointers are valid for the duration of the call; C++ does not
        // retain them. `global.as_ptr()` is the centralized opaque-handle FFI
        // conversion (interior mutability — C++ may throw through it).
        unsafe {
            JSC__JSObject__putRecord(
                self,
                global.as_ptr(),
                key,
                values.as_mut_ptr(),
                values.len(),
            );
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }

    /// This will not call getters or be observable from JavaScript.
    pub fn get_code_property_vm_inquiry(&mut self, global: &JSGlobalObject) -> Option<JSValue> {
        // SAFETY: thin FFI shim into JSC; does not throw. `global.as_ptr()`
        // yields the raw opaque handle (VMInquiry is read-only on the JS side,
        // but the C++ signature is non-const; centralized via `as_ptr()`).
        let v = unsafe { Bun__JSObject__getCodePropertyVMInquiry(global.as_ptr(), self) };
        if v.is_empty() {
            return None;
        }
        Some(v)
    }
}

#[repr(C)]
pub struct ExternColumnIdentifier {
    pub tag: u8,
    pub value: ExternColumnIdentifierValue,
}

#[repr(C)]
pub union ExternColumnIdentifierValue {
    pub index: u32,
    pub name: ManuallyDrop<BunString>,
}

impl Default for ExternColumnIdentifier {
    fn default() -> Self {
        Self { tag: 0, value: ExternColumnIdentifierValue { index: 0 } }
    }
}

impl ExternColumnIdentifier {
    pub fn string(&mut self) -> Option<&mut BunString> {
        match self.tag {
            // SAFETY: tag == 2 means `value.name` is the active union field.
            2 => Some(unsafe { &mut *self.value.name }),
            _ => None,
        }
    }
}

impl Drop for ExternColumnIdentifier {
    fn drop(&mut self) {
        if let Some(str) = self.string() {
            str.deref();
        }
    }
}

pub type InitializeCallback = extern "C" fn(ctx: *mut c_void, obj: *mut JSObject, global: *mut JSGlobalObject);

/// Zig's `Initializer(comptime Ctx, comptime func)` returned a type with a
/// single `extern "C" fn call`. In Rust the contract is a trait: implement
/// `create` on your context type and pass it to `JSObject::create_with_initializer`.
pub trait ObjectInitializer {
    fn create(&mut self, obj: &mut JSObject, global: &JSGlobalObject) -> JsResult<()>;
}

extern "C" fn initializer_call<Ctx: ObjectInitializer>(
    this: *mut c_void,
    obj: *mut JSObject,
    global: *mut JSGlobalObject,
) {
    // SAFETY: `this` was produced from `&mut Ctx` in `create_with_initializer`;
    // `obj` and `global` are live JSC pointers for the duration of the callback.
    let result = unsafe { Ctx::create(&mut *this.cast::<Ctx>(), &mut *obj, &*global) };
    if let Err(err) = result {
        // Mirrors `host_fn::void_from_js_error` (host_fn.zig) — OOM throws,
        // anything else asserts an exception is already pending.
        // SAFETY: `global` is valid (see above).
        let global = unsafe { &*global };
        match err {
            JsError::OutOfMemory => {
                global.throw_out_of_memory_value();
            }
            _ => {
                debug_assert!(
                    global.has_exception(),
                    "ObjectInitializer: JsError without pending exception"
                );
            }
        }
    }
}

/// Compile-time field enumeration for POJO marshalling.
///
/// Zig used `@typeInfo(T)` to iterate struct fields and called
/// `JSValue.fromAny(global, @TypeOf(property), property)` per field.
/// Rust has no built-in reflection, so types opt in via
/// `#[derive(bun_jsc::PojoFields)]`.
///
/// The derive must emit a sequence of
/// `put(b"name", JSValue::from_any(global, &self.name)?)?;` calls — one per
/// field, in declaration order — so each encoded JSValue lives only on the
/// stack between `from_any` and `put` (matching Zig's `inline for`; never
/// collected into a `Vec<JSValue>`, which would sit on the Rust heap and be
/// invisible to JSC's conservative stack scan).
// TODO(port): proc-macro — implement `#[derive(PojoFields)]` in bun_jsc.
pub trait PojoFields {
    const FIELD_COUNT: usize;
    /// Invoke `put(field_name, encoded_value)` once per struct field, encoding
    /// via `JSValue::from_any`. Encoding and `put` must be interleaved per
    /// field (no buffering).
    fn put_fields(
        &self,
        global: &JSGlobalObject,
        put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>,
    ) -> JsResult<()>;
}

/// Compile-time field enumeration for structs whose fields are **already**
/// `JSValue` (Zig's `putAllFromStruct` — `@field(properties, field)` is passed
/// straight to `put()` with no `fromAny` encoding).
///
/// Separate from [`PojoFields`] because that trait encodes; this one does not.
// TODO(port): proc-macro — implement `#[derive(JSValueFields)]` in bun_jsc.
pub trait JSValueFields {
    /// Invoke `put(field_name, self.<field>)` once per struct field. Fields are
    /// `JSValue` and forwarded as-is.
    fn put_fields(&self, put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>) -> JsResult<()>;
}

// ported from: src/jsc/JSObject.zig
