use core::ffi::{c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::ManuallyDrop;

use crate::{JSCell, JSGlobalObject, JSValue, JsError, JsResult};
use bun_core::{String as BunString, ZigString};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // safe: read-only `const unsigned` exported by C++ (link-time constant).
    safe static JSC__JSObject__maxInlineCapacity: c_uint;

    safe fn JSC__JSObject__getIndex(this: JSValue, global_this: &JSGlobalObject, i: u32)
    -> JSValue;
    safe fn Bun__JSObject__getCodePropertyVMInquiry(
        global: &JSGlobalObject,
        obj: &JSObject,
    ) -> JSValue;
    fn JSC__createStructure(
        global: *mut JSGlobalObject,
        owner: *mut JSCell,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue;
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `ctx` is an opaque round-trip pointer
    // C++ only forwards to `initializer` (never dereferenced as Rust data).
    safe fn JSC__JSObject__create(
        global_object: &JSGlobalObject,
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

bun_opaque::opaque_ffi! {
    /// Opaque JSC `JSObject` cell handle. Always borrowed (`&JSObject` / `&mut JSObject`).
    pub struct JSObject;
}

impl JSObject {
    #[inline]
    pub fn max_inline_capacity() -> c_uint {
        JSC__JSObject__maxInlineCapacity
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
    pub fn create<T: PojoFields>(
        pojo: &T,
        global: &JSGlobalObject,
    ) -> JsResult<&'static mut JSObject> {
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
    pub fn create_null_proto<T: PojoFields>(
        pojo: &T,
        global: &JSGlobalObject,
    ) -> JsResult<&'static mut JSObject> {
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
        // `val.is_object()` asserted above in debug; JSC guarantees these
        // constructors return a JSObject cell. A cell-tagged JSValue's payload
        // IS the cell pointer (NotCellMask bits are zero). `JSObject` is an
        // `opaque_ffi!` ZST handle; `opaque_mut` is the centralised
        // non-null-ZST deref proof (zero-byte `&mut` cannot alias).
        let obj = JSObject::opaque_mut(val.0 as *mut JSObject);

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

    pub fn get(
        &self,
        global: &JSGlobalObject,
        prop: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        self.to_js().get(global, prop.as_ref())
    }

    #[inline]
    pub fn put(
        &self,
        global: &JSGlobalObject,
        key: impl AsRef<[u8]>,
        value: JSValue,
    ) -> JsResult<()> {
        self.to_js().put(global, key.as_ref(), value);
        Ok(())
    }

    #[inline]
    pub fn put_all_from_struct<T: JSValueFields>(
        &self,
        global: &JSGlobalObject,
        properties: &T,
    ) -> JsResult<()> {
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
        unsafe { JSC__createStructure(global.as_ptr(), owner_cell, length, names) }
    }

    pub fn create_with_initializer<Ctx: ObjectInitializer>(
        creator: &mut Ctx,
        global: &JSGlobalObject,
        length: usize,
    ) -> JSValue {
        // `ctx` is the `&mut Ctx` round-tripped through `*mut c_void`;
        // `initializer_call::<Ctx>` casts it back. C++ only forwards it.
        JSC__JSObject__create(
            global,
            length,
            std::ptr::from_mut::<Ctx>(creator).cast::<c_void>(),
            initializer_call::<Ctx>,
        )
    }

    #[track_caller]
    pub fn get_index(this: JSValue, global_this: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        // we don't use `call_zero_is_throw`, because it would assert that if there is an
        // exception then the JSValue is zero. the function this ends up calling can return
        // undefined with an exception:
        // https://github.com/oven-sh/WebKit/blob/397dafc9721b8f8046f9448abb6dbc14efe096d3/Source/JavaScriptCore/runtime/JSObjectInlines.h#L112
        crate::top_scope!(scope, global_this);
        let value = JSC__JSObject__getIndex(this, global_this, i);
        scope.return_if_exception()?;
        debug_assert!(!value.is_empty());
        Ok(value)
    }

    #[track_caller]
    pub fn put_record(
        &mut self,
        global: &JSGlobalObject,
        key: &mut ZigString,
        values: &mut [ZigString],
    ) -> JsResult<()> {
        // Zig calls `bun.cpp.JSC__JSObject__putRecord` (`[[ZIG_EXPORT(check_slow)]]`).
        // SAFETY: pointers are valid for the duration of the call; C++ does not
        // retain them.
        unsafe {
            crate::cpp::JSC__JSObject__putRecord(
                self,
                global,
                key,
                values.as_mut_ptr(),
                values.len(),
            )
        }
    }

    /// This will not call getters or be observable from JavaScript.
    pub fn get_code_property_vm_inquiry(&mut self, global: &JSGlobalObject) -> Option<JSValue> {
        let v = Bun__JSObject__getCodePropertyVMInquiry(global, self);
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
        Self {
            tag: 0,
            value: ExternColumnIdentifierValue { index: 0 },
        }
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

pub type InitializeCallback =
    extern "C" fn(ctx: *mut c_void, obj: *mut JSObject, global: &JSGlobalObject);

/// Zig's `Initializer(comptime Ctx, comptime func)` returned a type with a
/// single `extern "C" fn call`. In Rust the contract is a trait: implement
/// `create` on your context type and pass it to `JSObject::create_with_initializer`.
pub trait ObjectInitializer {
    fn create(&mut self, obj: &mut JSObject, global: &JSGlobalObject) -> JsResult<()>;
}

extern "C" fn initializer_call<Ctx: ObjectInitializer>(
    this: *mut c_void,
    obj: *mut JSObject,
    global: &JSGlobalObject,
) {
    // SAFETY: `this` was produced from `&mut Ctx` in `create_with_initializer`;
    // `obj` is a live JSC pointer for the duration of the callback. `global` is
    // taken by reference at the C ABI (`&T` ≡ non-null `*const T`).
    let result = unsafe { Ctx::create(&mut *this.cast::<Ctx>(), &mut *obj, global) };
    if let Err(err) = result {
        // Mirrors `host_fn::void_from_js_error` (host_fn.zig) — OOM throws,
        // anything else asserts an exception is already pending.
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
