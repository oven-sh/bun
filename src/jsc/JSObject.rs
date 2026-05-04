use core::ffi::{c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::ManuallyDrop;

use bun_jsc::{self as jsc, host_fn, JSCell, JSGlobalObject, JSValue, JsError, JsResult, TopExceptionScope};
use bun_str::{String as BunString, ZigString};

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
    // From bun.cpp namespace; signature mirrors the Zig binding.
    fn JSC__JSObject__putRecord(
        this: *mut JSObject,
        global: *mut JSGlobalObject,
        key: *mut ZigString,
        values: *mut ZigString,
        values_len: usize,
    ) -> bool;
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
        // provided by a `#[derive(PojoFields)]` proc-macro that emits the field
        // name + `JSValue::from_any` accessor for each struct field.

        let obj = 'obj: {
            let val = if NULL_PROTOTYPE {
                JSValue::create_empty_object_with_null_prototype(global)
            } else {
                JSValue::create_empty_object(global, T::FIELD_COUNT)
            };
            if cfg!(debug_assertions) {
                debug_assert!(val.is_object());
            }
            // SAFETY: `val.is_object()` asserted above in debug; JSC guarantees
            // these constructors return a JSObject cell.
            break 'obj unsafe { val.unchecked_ptr_cast::<JSObject>() };
        };

        let cell = obj.to_js();
        for (name, value) in T::fields(pojo, global)? {
            cell.put(global, name, value);
        }

        Ok(obj)
    }

    pub fn get(&self, global: &JSGlobalObject, prop: impl AsRef<[u8]>) -> JsResult<Option<JSValue>> {
        self.to_js().get(global, prop)
    }

    #[inline]
    pub fn put(&self, global: &JSGlobalObject, key: impl AsRef<[u8]>, value: JSValue) -> JsResult<()> {
        self.to_js().put(global, key, value);
        Ok(())
    }

    #[inline]
    pub fn put_all_from_struct<T: PojoFields>(&self, global: &JSGlobalObject, properties: &T) -> JsResult<()> {
        // TODO(port): Zig used `std.meta.fieldNames(@TypeOf(properties))` +
        // `@field(properties, field)`. Relies on the same `PojoFields` derive.
        for (name, value) in T::fields(properties, global)? {
            self.put(global, name, value)?;
        }
        Ok(())
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it.
    /// This mimics the implementation in JavaScriptCore's C++.
    #[inline]
    pub fn ensure_still_alive(&self) {
        core::hint::black_box(self as *const Self);
    }

    pub fn create_structure(
        global: &JSGlobalObject,
        owner: JSValue,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue {
        jsc::mark_binding!();
        // SAFETY: thin FFI shim; `owner.as_cell()` is non-null per caller contract.
        unsafe {
            JSC__createStructure(
                global as *const _ as *mut _,
                owner.as_cell(),
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
        // is exactly what we pass here.
        unsafe {
            JSC__JSObject__create(
                global as *const _ as *mut _,
                length,
                creator as *mut Ctx as *mut c_void,
                initializer_call::<Ctx>,
            )
        }
    }

    pub fn get_index(this: JSValue, global_this: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        // we don't use fromJSHostCall, because it will assert that if there is an exception
        // then the JSValue is zero. the function this ends up calling can return undefined
        // with an exception:
        // https://github.com/oven-sh/WebKit/blob/397dafc9721b8f8046f9448abb6dbc14efe096d3/Source/JavaScriptCore/runtime/JSObjectInlines.h#L112
        let scope = TopExceptionScope::new(global_this);
        // SAFETY: thin FFI shim into JSC.
        let value = unsafe { JSC__JSObject__getIndex(this, global_this as *const _ as *mut _, i) };
        scope.return_if_exception()?;
        debug_assert!(!value.is_empty());
        Ok(value)
    }

    pub fn put_record(&mut self, global: &JSGlobalObject, key: &mut ZigString, values: &mut [ZigString]) -> JsResult<()> {
        // TODO(port): Zig called `bun.cpp.JSC__JSObject__putRecord` which goes
        // through `fromJSHostCall`. Exact JsResult plumbing TBD in Phase B.
        // SAFETY: pointers are valid for the duration of the call; C++ does not retain them.
        unsafe {
            JSC__JSObject__putRecord(
                self,
                global as *const _ as *mut _,
                key,
                values.as_mut_ptr(),
                values.len(),
            );
        }
        Ok(())
    }

    /// This will not call getters or be observable from JavaScript.
    pub fn get_code_property_vm_inquiry(&mut self, global: &JSGlobalObject) -> Option<JSValue> {
        // SAFETY: thin FFI shim into JSC; does not throw.
        let v = unsafe { Bun__JSObject__getCodePropertyVMInquiry(global as *const _ as *mut _, self) };
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
    let result = unsafe { Ctx::create(&mut *(this as *mut Ctx), &mut *obj, &*global) };
    if let Err(err) = result {
        // SAFETY: `global` is valid (see above).
        unsafe { host_fn::void_from_js_error(err, &*global) };
    }
}

/// Compile-time field enumeration for POJO marshalling.
///
/// Zig used `@typeInfo(T)` / `std.meta.fieldNames` to iterate struct fields.
/// Rust has no built-in reflection, so types opt in via
/// `#[derive(bun_jsc::PojoFields)]`.
// TODO(port): proc-macro — implement `#[derive(PojoFields)]` in bun_jsc.
pub trait PojoFields {
    const FIELD_COUNT: usize;
    /// Yield `(field_name, encoded_value)` for each struct field, encoding via
    /// `JSValue::from_any` (matching Zig's `try .fromAny(global, @TypeOf(property), property)`).
    fn fields(&self, global: &JSGlobalObject) -> JsResult<impl Iterator<Item = (&'static str, JSValue)>>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSObject.zig (172 lines)
//   confidence: medium
//   todos:      4
//   notes:      @typeInfo field reflection replaced by PojoFields trait stub (needs derive macro); putRecord exception plumbing needs verification
// ──────────────────────────────────────────────────────────────────────────
