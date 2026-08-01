//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

use bun_ast::{E, Expr, ExprData, G, ToJSError};
use bun_collections::VecExt;
use bun_core::{StackCheck, String as BunString, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsError, bun_string_jsc};

/// Map a `bun_jsc::JsError` into the AST-layer `ToJSError`. Orphan rules forbid
/// `impl From<JsError> for ToJSError` here (both foreign), so callers use
/// `.map_err(js_err)?` instead of bare `?`.
#[inline]
fn js_err(e: JsError) -> ToJSError {
    match e {
        JsError::Thrown => ToJSError::JSError,
        JsError::OutOfMemory => ToJSError::OutOfMemory,
        JsError::Terminated => ToJSError::JSTerminated,
    }
}

pub fn expr_to_js(this: &Expr, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    data_to_js(&this.data, global)
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
        ExprData::EObjectJSON(e) => object_json_to_js(e, global, stack_check),
        ExprData::EArrayJSON(e) => array_json_to_js(e, global, stack_check),
        ExprData::EString(e) => string_to_js(e, global),
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

fn object_json_to_js(
    this: &E::ObjectJSON,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    if !stack_check.is_safe_to_recurse() {
        return Err(js_err(global.throw_stack_overflow()));
    }
    let obj = JSValue::create_empty_object(global, this.properties().len());
    let _guard = obj.protected();
    for prop in this.properties().iter() {
        let key = utf8_bytes_to_js(prop.key.slice(), global)?;
        let value = json_value_to_js(&prop.value, global, stack_check)?;
        JSValue::put_to_property_key(obj, global, key, value).map_err(js_err)?;
    }
    Ok(obj)
}

fn array_json_to_js(
    this: &E::ArrayJSON,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    if !stack_check.is_safe_to_recurse() {
        return Err(js_err(global.throw_stack_overflow()));
    }
    let array = JSValue::create_empty_array(global, this.items().len()).map_err(js_err)?;
    let _guard = array.protected();
    for (j, item) in this.items().iter().enumerate() {
        let value = json_value_to_js(item, global, stack_check)?;
        array.put_index(global, j as u32, value).map_err(js_err)?;
    }
    Ok(array)
}

fn json_value_to_js(
    value: &E::JsonValue,
    global: &JSGlobalObject,
    stack_check: StackCheck,
) -> Result<JSValue, ToJSError> {
    Ok(match value {
        E::JsonValue::Null => JSValue::NULL,
        E::JsonValue::Boolean(true) => JSValue::TRUE,
        E::JsonValue::Boolean(false) => JSValue::FALSE,
        E::JsonValue::Number(n) => number_to_js(*n),
        E::JsonValue::String(s) => utf8_bytes_to_js(s.slice(), global)?,
        E::JsonValue::Object(o) => object_json_to_js(o.get(), global, stack_check)?,
        E::JsonValue::Array(a) => array_json_to_js(a.get(), global, stack_check)?,
    })
}

fn utf8_bytes_to_js(bytes: &[u8], global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    if bytes.is_empty() {
        let empty = BunString::EMPTY;
        return bun_string_jsc::to_js(&empty, global).map_err(js_err);
    }
    if let Some(utf16) = strings::wtf8_to_utf16_alloc(bytes) {
        let (mut out, chars) = BunString::create_uninitialized_utf16(utf16.len());
        chars.copy_from_slice(&utf16);
        bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
    } else {
        let (mut out, chars) = BunString::create_uninitialized_latin1(bytes.len());
        chars.copy_from_slice(bytes);
        bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
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
                let emp = BunString::EMPTY;
                return bun_string_jsc::to_js(&emp, global).map_err(js_err);
            }

            if s.is_utf8() {
                utf8_bytes_to_js(s.slice8(), global)
            } else {
                let utf16 = s.slice16();
                let (mut out, chars) = BunString::create_uninitialized_utf16(utf16.len());
                chars.copy_from_slice(utf16);
                bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
            }
        }
    };
}
impl_string_to_js!(string_to_js, E::String);
impl_string_to_js!(value_string_to_js, bun_ast::E::EString);
