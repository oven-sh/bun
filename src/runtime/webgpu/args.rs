//! WebIDL argument conversion: `[EnforceRange]` integers, floats, enums, dictionaries, sequences.

use core::ffi::c_void;

use bun_core::Utf8Bytes;
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsError, JsResult};

/// 2^53 - 1, the largest value `[EnforceRange] unsigned long long` accepts.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

fn enforce_range(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
    min: f64,
    max: f64,
) -> JsResult<f64> {
    let n = if v.is_int32() {
        f64::from(v.as_int32())
    } else {
        v.to_number(global)?
    };
    if !n.is_finite() {
        return Err(global.throw_type_error(format_args!("{what}: value is not a finite number")));
    }
    let n = n.trunc();
    if n < min || n > max {
        return Err(global.throw_type_error(format_args!(
            "{what}: value {n} is outside the range [{min}, {max}]"
        )));
    }
    Ok(n)
}

/// `[EnforceRange] unsigned long`.
pub(crate) fn to_u32(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<u32> {
    Ok(enforce_range(global, v, what, 0.0, f64::from(u32::MAX))? as u32)
}

/// `[Clamp] unsigned short`: NaN is 0, everything else rounds to the nearest value in range.
pub(crate) fn to_u16_clamped(global: &JSGlobalObject, v: JSValue) -> JsResult<u16> {
    let n = v.to_number(global)?;
    if n.is_nan() {
        return Ok(0);
    }
    Ok(n.clamp(0.0, f64::from(u16::MAX)).round_ties_even() as u16)
}

/// `[EnforceRange] long`.
pub(crate) fn to_i32(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<i32> {
    Ok(enforce_range(global, v, what, f64::from(i32::MIN), f64::from(i32::MAX))? as i32)
}

/// `[EnforceRange] unsigned long long`.
pub(crate) fn to_u64(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<u64> {
    Ok(enforce_range(global, v, what, 0.0, MAX_SAFE_INTEGER)? as u64)
}

/// `double` (restricted: NaN and the infinities are a TypeError).
pub(crate) fn to_f64(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<f64> {
    let n = v.to_number(global)?;
    if !n.is_finite() {
        return Err(global.throw_type_error(format_args!("{what}: value is not a finite number")));
    }
    Ok(n)
}

/// `float` (restricted).
pub(crate) fn to_f32(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<f32> {
    let n = to_f64(global, v, what)?;
    let f = n as f32;
    if !f.is_finite() {
        return Err(
            global.throw_type_error(format_args!("{what}: value {n} does not fit in a float"))
        );
    }
    Ok(f)
}

/// `USVString` / `DOMString`, as UTF-8.
pub(crate) fn to_utf8(global: &JSGlobalObject, v: JSValue) -> JsResult<Utf8Bytes<'static>> {
    v.to_utf8(global)
}

/// A `USVString` as the `String` wgpu's `&str` parameters need.
pub(crate) fn to_string(global: &JSGlobalObject, v: JSValue) -> JsResult<String> {
    Ok(usv_string(&v.to_utf8(global)?))
}

/// Lossy on purpose: WebIDL's `USVString` replaces unpaired surrogates with U+FFFD, as this does.
#[allow(clippy::disallowed_methods)]
pub(crate) fn usv_string(utf8: &[u8]) -> String {
    String::from_utf8_lossy(utf8).into_owned()
}

/// A WebIDL enum: ToString, then look the result up in `parse`.
pub(crate) fn to_enum<T>(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
    enum_name: &str,
    parse: fn(&[u8]) -> Option<T>,
) -> JsResult<T> {
    let s = v.to_utf8(global)?;
    match parse(&s) {
        Some(t) => Ok(t),
        None => Err(global.throw_type_error(format_args!(
            "{what}: '{}' is not a valid {enum_name}",
            bstr::BStr::new(&*s)
        ))),
    }
}

/// An interface type: `v` has to be a `T` wrapper.
pub(crate) fn to_class<T: JsClass + 'static>(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
    class_name: &str,
) -> JsResult<&'static T> {
    match v.as_class_ref::<T>() {
        Some(t) => Ok(t),
        None => Err(global.throw_type_error(format_args!("{what}: expected a {class_name}"))),
    }
}

/// Runs `f` on each element of a WebIDL `sequence<T>`: an array or any other iterable.
pub(crate) fn for_each<F>(global: &JSGlobalObject, v: JSValue, what: &str, mut f: F) -> JsResult<()>
where
    F: FnMut(JSValue) -> JsResult<()>,
{
    if !v.is_object() {
        return Err(global.throw_type_error(format_args!("{what}: expected a sequence")));
    }
    if v.is_array() {
        let mut iter = v.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            f(item)?;
        }
        return Ok(());
    }
    if !v.is_iterable(global)? {
        return Err(global.throw_type_error(format_args!("{what}: expected a sequence")));
    }

    struct Ctx<'f> {
        f: &'f mut dyn FnMut(JSValue) -> JsResult<()>,
        err: Option<JsError>,
    }
    extern "C" fn each(
        _vm: *mut bun_jsc::VM,
        _global: &JSGlobalObject,
        ctx: *mut c_void,
        next: JSValue,
    ) {
        // SAFETY: `ctx` is the `Ctx` on `for_each`'s stack below, alive for the whole iteration.
        let ctx = unsafe { &mut *ctx.cast::<Ctx<'_>>() };
        if ctx.err.is_none() {
            if let Err(e) = (ctx.f)(next) {
                ctx.err = Some(e);
            }
        }
    }
    let mut ctx = Ctx {
        f: &mut f,
        err: None,
    };
    let iterated = v.for_each(global, (&raw mut ctx).cast::<c_void>(), each);
    if let Some(e) = ctx.err {
        return Err(e);
    }
    iterated
}

/// A WebIDL dictionary: `undefined` and `null` are the empty one, an `undefined` member is missing.
pub(crate) struct Dict<'a> {
    pub global: &'a JSGlobalObject,
    obj: Option<JSValue>,
    /// The dictionary's IDL name, for error messages.
    pub name: &'static str,
}

impl<'a> Dict<'a> {
    pub(crate) fn new(
        global: &'a JSGlobalObject,
        v: JSValue,
        name: &'static str,
    ) -> JsResult<Self> {
        if v.is_undefined_or_null() {
            return Ok(Self {
                global,
                obj: None,
                name,
            });
        }
        if !v.is_object() {
            return Err(global.throw_type_error(format_args!("{name}: expected an object")));
        }
        Ok(Self {
            global,
            obj: Some(v),
            name,
        })
    }

    pub(crate) fn get(&self, key: &'static str) -> JsResult<Option<JSValue>> {
        match self.obj {
            Some(obj) => obj.get(self.global, key),
            None => Ok(None),
        }
    }

    pub(crate) fn require(&self, key: &'static str) -> JsResult<JSValue> {
        match self.get(key)? {
            Some(v) => Ok(v),
            None => Err(self.global.throw_type_error(format_args!(
                "{}: required member '{key}' is missing",
                self.name
            ))),
        }
    }

    fn what(&self, key: &str) -> String {
        format!("{}.{key}", self.name)
    }

    pub(crate) fn u32(&self, key: &'static str) -> JsResult<Option<u32>> {
        match self.get(key)? {
            Some(v) => Ok(Some(to_u32(self.global, v, &self.what(key))?)),
            None => Ok(None),
        }
    }

    pub(crate) fn u32_or(&self, key: &'static str, default: u32) -> JsResult<u32> {
        Ok(self.u32(key)?.unwrap_or(default))
    }

    pub(crate) fn require_u32(&self, key: &'static str) -> JsResult<u32> {
        let v = self.require(key)?;
        to_u32(self.global, v, &self.what(key))
    }

    pub(crate) fn i32_or(&self, key: &'static str, default: i32) -> JsResult<i32> {
        match self.get(key)? {
            Some(v) => to_i32(self.global, v, &self.what(key)),
            None => Ok(default),
        }
    }

    pub(crate) fn u64(&self, key: &'static str) -> JsResult<Option<u64>> {
        match self.get(key)? {
            Some(v) => Ok(Some(to_u64(self.global, v, &self.what(key))?)),
            None => Ok(None),
        }
    }

    pub(crate) fn u64_or(&self, key: &'static str, default: u64) -> JsResult<u64> {
        Ok(self.u64(key)?.unwrap_or(default))
    }

    pub(crate) fn require_u64(&self, key: &'static str) -> JsResult<u64> {
        let v = self.require(key)?;
        to_u64(self.global, v, &self.what(key))
    }

    pub(crate) fn f32_or(&self, key: &'static str, default: f32) -> JsResult<f32> {
        match self.get(key)? {
            Some(v) => to_f32(self.global, v, &self.what(key)),
            None => Ok(default),
        }
    }

    pub(crate) fn bool_or(&self, key: &'static str, default: bool) -> JsResult<bool> {
        Ok(self.get(key)?.map_or(default, JSValue::to_boolean))
    }

    pub(crate) fn string(&self, key: &'static str) -> JsResult<Option<String>> {
        match self.get(key)? {
            Some(v) => Ok(Some(to_string(self.global, v)?)),
            None => Ok(None),
        }
    }

    /// The `label` member every `GPUObjectDescriptorBase` has.
    pub(crate) fn label(&self) -> JsResult<bun_core::String> {
        match self.get("label")? {
            Some(v) => v.to_bun_string(self.global),
            None => Ok(bun_core::String::EMPTY),
        }
    }

    pub(crate) fn enum_<T>(
        &self,
        key: &'static str,
        enum_name: &str,
        parse: fn(&[u8]) -> Option<T>,
    ) -> JsResult<Option<T>> {
        match self.get(key)? {
            Some(v) => Ok(Some(to_enum(
                self.global,
                v,
                &self.what(key),
                enum_name,
                parse,
            )?)),
            None => Ok(None),
        }
    }

    pub(crate) fn enum_or<T>(
        &self,
        key: &'static str,
        enum_name: &str,
        parse: fn(&[u8]) -> Option<T>,
        default: T,
    ) -> JsResult<T> {
        Ok(self.enum_(key, enum_name, parse)?.unwrap_or(default))
    }

    pub(crate) fn require_enum<T>(
        &self,
        key: &'static str,
        enum_name: &str,
        parse: fn(&[u8]) -> Option<T>,
    ) -> JsResult<T> {
        let v = self.require(key)?;
        to_enum(self.global, v, &self.what(key), enum_name, parse)
    }

    pub(crate) fn require_class<T: JsClass + 'static>(
        &self,
        key: &'static str,
        class_name: &str,
    ) -> JsResult<&'static T> {
        let v = self.require(key)?;
        to_class(self.global, v, &self.what(key), class_name)
    }

    /// A nested dictionary member. Missing reads as `None`; `null` is the empty dictionary.
    pub(crate) fn dict(&self, key: &'static str, name: &'static str) -> JsResult<Option<Dict<'a>>> {
        match self.get(key)? {
            Some(v) => Ok(Some(Dict::new(self.global, v, name)?)),
            None => Ok(None),
        }
    }

    pub(crate) fn require_dict(&self, key: &'static str, name: &'static str) -> JsResult<Dict<'a>> {
        let v = self.require(key)?;
        Dict::new(self.global, v, name)
    }

    /// A `sequence<T>` member. Missing runs `f` zero times.
    pub(crate) fn each<F>(&self, key: &'static str, f: F) -> JsResult<()>
    where
        F: FnMut(JSValue) -> JsResult<()>,
    {
        match self.get(key)? {
            Some(v) => for_each(self.global, v, &self.what(key), f),
            None => Ok(()),
        }
    }

    pub(crate) fn require_each<F>(&self, key: &'static str, f: F) -> JsResult<()>
    where
        F: FnMut(JSValue) -> JsResult<()>,
    {
        let v = self.require(key)?;
        for_each(self.global, v, &self.what(key), f)
    }
}

/// `GPUExtent3D`: `sequence<GPUIntegerCoordinate>` (1 to 3 entries) or `GPUExtent3DDict`.
pub(crate) fn to_extent3d(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
) -> JsResult<bun_webgpu::wgt::Extent3d> {
    use bun_webgpu::wgt::Extent3d;
    if v.is_array() || (v.is_object() && v.is_iterable(global)?) {
        let mut parts = [1u32; 3];
        let mut n = 0usize;
        for_each(global, v, what, |item| {
            if n < 3 {
                parts[n] = to_u32(global, item, what)?;
            }
            n += 1;
            Ok(())
        })?;
        if n == 0 || n > 3 {
            return Err(
                global.throw_type_error(format_args!("{what}: expected 1 to 3 values, got {n}"))
            );
        }
        return Ok(Extent3d {
            width: parts[0],
            height: parts[1],
            depth_or_array_layers: parts[2],
        });
    }
    let d = Dict::new(global, v, "GPUExtent3DDict")?;
    Ok(Extent3d {
        width: d.require_u32("width")?,
        height: d.u32_or("height", 1)?,
        depth_or_array_layers: d.u32_or("depthOrArrayLayers", 1)?,
    })
}

/// `GPUOrigin3D`: `sequence<GPUIntegerCoordinate>` (0 to 3 entries) or `GPUOrigin3DDict`.
pub(crate) fn to_origin3d(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
) -> JsResult<bun_webgpu::wgt::Origin3d> {
    use bun_webgpu::wgt::Origin3d;
    if v.is_array() || (v.is_object() && v.is_iterable(global)?) {
        let mut parts = [0u32; 3];
        let mut n = 0usize;
        for_each(global, v, what, |item| {
            if n < 3 {
                parts[n] = to_u32(global, item, what)?;
            }
            n += 1;
            Ok(())
        })?;
        if n > 3 {
            return Err(
                global.throw_type_error(format_args!("{what}: expected at most 3 values, got {n}"))
            );
        }
        return Ok(Origin3d {
            x: parts[0],
            y: parts[1],
            z: parts[2],
        });
    }
    let d = Dict::new(global, v, "GPUOrigin3DDict")?;
    Ok(Origin3d {
        x: d.u32_or("x", 0)?,
        y: d.u32_or("y", 0)?,
        z: d.u32_or("z", 0)?,
    })
}

/// `GPUColor`: `sequence<double>` (exactly 4) or `GPUColorDict`.
pub(crate) fn to_color(
    global: &JSGlobalObject,
    v: JSValue,
    what: &str,
) -> JsResult<bun_webgpu::wgt::Color> {
    use bun_webgpu::wgt::Color;
    if v.is_array() || (v.is_object() && v.is_iterable(global)?) {
        let mut parts = [0f64; 4];
        let mut n = 0usize;
        for_each(global, v, what, |item| {
            if n < 4 {
                parts[n] = to_f64(global, item, what)?;
            }
            n += 1;
            Ok(())
        })?;
        if n != 4 {
            return Err(global.throw_type_error(format_args!("{what}: expected 4 values, got {n}")));
        }
        return Ok(Color {
            r: parts[0],
            g: parts[1],
            b: parts[2],
            a: parts[3],
        });
    }
    let d = Dict::new(global, v, "GPUColorDict")?;
    let channel = |key: &'static str| -> JsResult<f64> {
        let value = d.require(key)?;
        to_f64(global, value, what)
    };
    Ok(Color {
        r: channel("r")?,
        g: channel("g")?,
        b: channel("b")?,
        a: channel("a")?,
    })
}

/// The bytes of an `AllowSharedBufferSource`, and its element size (the unit of `writeBuffer` offsets).
pub(crate) struct BufferSource {
    pub ptr: *const u8,
    pub len: usize,
    pub element_size: usize,
}

impl BufferSource {
    pub(crate) fn from_js(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<Self> {
        let Some(ab) = v.as_array_buffer(global) else {
            return Err(global.throw_type_error(format_args!(
                "{what}: expected an ArrayBuffer, a typed array or a DataView"
            )));
        };
        let bytes = ab.byte_slice();
        let element_size = match ab.typed_array_type {
            bun_jsc::JSType::ArrayBuffer | bun_jsc::JSType::DataView => 1,
            other => typed_array_element_size(other),
        };
        Ok(Self {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
            element_size,
        })
    }

    /// Safety: no JS may run between `from_js` and the last use of the slice (it could detach the buffer).
    pub(crate) unsafe fn bytes(&self) -> &[u8] {
        if self.len == 0 {
            return &[];
        }
        // SAFETY: `ptr..ptr+len` is the live backing store `from_js` read; see fn contract.
        unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
    }
}

fn typed_array_element_size(ty: bun_jsc::JSType) -> usize {
    use bun_jsc::JSType;
    match ty {
        JSType::Int16Array | JSType::Uint16Array | JSType::Float16Array => 2,
        JSType::Int32Array | JSType::Uint32Array | JSType::Float32Array => 4,
        JSType::Float64Array | JSType::BigInt64Array | JSType::BigUint64Array => 8,
        _ => 1,
    }
}
