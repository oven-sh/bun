//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

use bun_ast::{E, Expr, ExprData, G, ToJSError};
use bun_collections::VecExt;
use bun_core::{StackCheck, String as BunString, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsError, StringJsc as _};

/// Map a `bun_jsc::JsError` into the AST-layer `ToJSError`. Orphan rules forbid
/// `impl From<JsError> for ToJSError` here (both foreign), so callers use
/// `.map_err(js_err)?` instead of bare `?`.
#[inline]
fn js_err(e: JsError) -> ToJSError {
    match e {
        JsError::Thrown | JsError::Terminated => ToJSError::JSError,
        JsError::OutOfMemory => ToJSError::OutOfMemory,
    }
}

pub fn expr_to_js(this: &Expr, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    data_to_js(&this.data, global)
}

/// The inverse of [`js_err`], for host functions returning a data-format
/// parse (JSON/XML rows never produce the conversion variants).
pub fn to_js_error(e: ToJSError, global: &JSGlobalObject) -> JsError {
    match e {
        ToJSError::OutOfMemory => JsError::OutOfMemory,
        ToJSError::JSError => JsError::Thrown,
        _ => global.throw(format_args!("Cannot convert value to JS")),
    }
}

/// Extension trait providing `Expr.toJS` / `Expr::Data.toJS` as method syntax.
/// `Expr` lives in `bun_js_parser` (lower tier, no JSC dep), so an inherent
/// `impl Expr { fn to_js }` is forbidden by orphan rules. Mirrors the
/// `StringJsc` pattern in `bun_jsc` — callers `use bun_js_parser_jsc::ExprJsc`
/// (or the crate prelude) and write `expr.to_js(global)`.
pub trait ExprJsc {
    fn to_js(&self, global: &JSGlobalObject) -> Result<JSValue, ToJSError>;
}
impl ExprJsc for Expr {
    #[inline]
    fn to_js(&self, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
        expr_to_js(self, global)
    }
}
impl ExprJsc for ExprData {
    #[inline]
    fn to_js(&self, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
        data_to_js(self, global)
    }
}

pub fn data_to_js(this: &ExprData, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    data_to_js_with_check(this, global, StackCheck::init())
}

fn data_to_js_with_check(
    this: &ExprData,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    if !stack_check.is_safe_to_recurse() {
        return Err(js_err(global.throw_stack_overflow()));
    }
    match this {
        ExprData::EArray(e) => array_to_js(e, global, stack_check),
        ExprData::EObject(e) => object_to_js(e, global, stack_check),
        ExprData::EObjectJSON(e) => object_json_to_js(e, global),
        ExprData::EArrayJSON(e) => array_json_to_js(e, global),
        ExprData::EString(e) => {
            if let Some(kind) = e.toml_datetime {
                return toml_datetime_to_js(global, e.slice8(), kind).map_err(js_err);
            }
            string_to_js(e, global)
        }
        ExprData::ENull(_) => Ok(JSValue::NULL),
        ExprData::EUndefined(_) => Ok(JSValue::UNDEFINED),
        ExprData::EBoolean(boolean) | ExprData::EBranchBoolean(boolean) => Ok(if boolean.value {
            JSValue::TRUE
        } else {
            JSValue::FALSE
        }),
        ExprData::ENumber(e) => Ok(number_to_js(*e)),
        // ExprData::EBigInt(e) => e.to_js(ctx, exception),
        ExprData::EInlinedEnum(inlined) => {
            data_to_js_with_check(&inlined.value.data, global, stack_check)
        }

        ExprData::EIdentifier(_)
        | ExprData::EImportIdentifier(_)
        | ExprData::EPrivateIdentifier(_)
        | ExprData::ECommonjsExportIdentifier(_) => Err(ToJSError::CannotConvertIdentifierToJS),

        _ => Err(ToJSError::CannotConvertArgumentTypeToJS),
    }
}

fn array_to_js(
    this: &E::Array,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    let items = this.items.slice();
    let array = JSValue::create_empty_array(global, items.len()).map_err(js_err)?;
    let _guard = array.protected();
    for (j, expr) in items.iter().enumerate() {
        array
            .put_index(
                global,
                j as u32,
                data_to_js_with_check(&expr.data, global, stack_check)?,
            )
            .map_err(js_err)?;
    }

    Ok(array)
}

fn number_to_js(this: E::Number) -> JSValue {
    JSValue::js_number(this.value())
}

fn object_to_js(
    this: &E::Object,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    let obj = JSValue::create_empty_object(global, this.properties.len_u32() as usize);
    let _guard = obj.protected();
    let props: &[G::Property] = this.properties.slice();
    for prop in props {
        if prop.kind != G::PropertyKind::Normal
            || prop.class_static_block.is_some()
            || prop.key.is_none()
            || prop.value.is_none()
        {
            return Err(ToJSError::CannotConvertArgumentTypeToJS);
        }
        let key = data_to_js_with_check(
            &prop.key.as_ref().expect("infallible: prop has key").data,
            global,
            stack_check,
        )?;
        let value = data_to_js_with_check(
            &prop
                .value
                .as_ref()
                .expect("infallible: prop has value")
                .data,
            global,
            stack_check,
        )?;
        JSValue::put_to_property_key(obj, global, key, value).map_err(js_err)?;
    }

    Ok(obj)
}

#[allow(improper_ctypes)] // reached through JsonValue → ObjectJSON.tape; C++ never touches it
unsafe extern "C" {
    fn Bun__JSONRows__toJS(
        global: *const JSGlobalObject,
        root: *const E::JsonValue,
        props: *const E::PropertyJSON,
        items: *const E::JsonValue,
        encoding: u8,
    ) -> JSValue;
}

/// For `JSONRowsToJS.cpp`: a UTF-8 tape string that strict UTF-8 decoding
/// rejected, i.e. WTF-8 carrying a lone surrogate from a JSON `\uD800`-style
/// escape. Decoded the way every other WTF-8 string in the runtime is.
#[unsafe(no_mangle)]
extern "C" fn Bun__JSONRows__wtf8ToJS(
    global: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    // SAFETY: the C++ caller passes a live tape string.
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
    match utf8_bytes_to_js(bytes, global) {
        Ok(value) => value,
        // Only the string's to_js can fail here (JSError): the
        // exception is pending and the caller RETURN_IF_EXCEPTIONs on empty.
        Err(_) => JSValue::ZERO,
    }
}

/// The whole document under `root` in one call into C++ (keys and short
/// values go through the VM's JSON atom-string cache, as for `JSON.parse`).
fn json_rows_to_js(
    root: E::JsonValue,
    tape: &E::JsonTape,
    global: &JSGlobalObject,
) -> Result<JSValue, ToJSError> {
    let (props, items) = tape.raw_rows();
    let encoding = tape.encoding as u8;
    // SAFETY: `root`, `props` and `items` all belong to `tape`, which is complete
    // and outlives the call; the C++ side only reads them.
    bun_jsc::from_js_host_call(global, || unsafe {
        Bun__JSONRows__toJS(global, &raw const root, props, items, encoding)
    })
    .map_err(js_err)
}

fn object_json_to_js(this: &E::ObjectJSON, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let root = E::JsonValue::Object(bun_ast::StoreRef::from_raw(
        core::ptr::from_ref(this).cast_mut(),
    ));
    json_rows_to_js(root, this.tape(), global)
}

fn array_json_to_js(this: &E::ArrayJSON, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let root = E::JsonValue::Array(bun_ast::StoreRef::from_raw(
        core::ptr::from_ref(this).cast_mut(),
    ));
    json_rows_to_js(root, this.tape(), global)
}

/// A TOML date/time literal as the Temporal object of its kind. `text` must
/// be ASCII that `Temporal.*.from` accepts verbatim.
pub fn toml_datetime_to_js(
    global: &JSGlobalObject,
    text: &[u8],
    kind: E::TomlDateTimeKind,
) -> bun_jsc::JsResult<JSValue> {
    debug_assert!(text.is_ascii());
    // SAFETY: `text` is a live slice for the duration of the call.
    unsafe {
        bun_jsc::cpp::Bun__Temporal__fromDateTimeLiteral(
            global,
            text.as_ptr(),
            text.len(),
            kind as u8,
        )
    }
}

fn utf8_bytes_to_js(bytes: &[u8], global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    if bytes.is_empty() {
        return Ok(JSValue::js_empty_string(global));
    }
    if let Some(utf16) = strings::wtf8_to_utf16_alloc(bytes) {
        let (out, chars) = BunString::create_uninitialized_utf16(utf16.len());
        chars.copy_from_slice(&utf16);
        out.into_js(global).map_err(js_err)
    } else {
        let (out, chars) = BunString::create_uninitialized_latin1(bytes.len());
        chars.copy_from_slice(bytes);
        out.into_js(global).map_err(js_err)
    }
}

/// `E.String` → JS string conversion.
/// Stamps the body for both `EString` nominal types: the full T4
/// `bun_ast::E::String` (used by `data_to_js` / macros) and the
/// value-subset T2 `bun_ast::E::EString` (used by the YAML / JSON5
/// interchange parsers, which build the cycle-broken tree). The two are
/// field-identical for everything `stringToJS` touches; the T4 type carries
/// extra lexer-dependent methods that prevent unifying the structs themselves.
macro_rules! impl_string_to_js {
    ($name:ident, $ty:ty) => {
        pub fn $name(s: &$ty, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
            // Callers here only have `&s` and no bump arena, so flatten the
            // rope into a temporary heap buffer and serialize from that
            // instead. Ropes are only ever built from UTF-8 parts
            // (`resolve_rope_if_needed` is a no-op for UTF-16).
            if s.next.is_some() && s.is_utf8() {
                let mut bytes: Vec<u8> = Vec::with_capacity(s.rope_len as usize);
                bytes.extend_from_slice(s.slice8());
                let mut next = s.next;
                while let Some(part) = next {
                    let part = part.get();
                    bytes.extend_from_slice(&part.data);
                    next = part.next;
                }
                return utf8_bytes_to_js(&bytes, global);
            }

            if !s.is_present() {
                return Ok(JSValue::js_empty_string(global));
            }

            if s.is_utf8() {
                utf8_bytes_to_js(s.slice8(), global)
            } else {
                let utf16 = s.slice16();
                let (out, chars) = BunString::create_uninitialized_utf16(utf16.len());
                chars.copy_from_slice(utf16);
                out.into_js(global).map_err(js_err)
            }
        }
    };
}
impl_string_to_js!(string_to_js, E::String);
impl_string_to_js!(value_string_to_js, bun_ast::E::EString);
