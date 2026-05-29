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

pub(crate) fn array_to_js(
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

pub(crate) fn number_to_js(this: E::Number) -> JSValue {
    JSValue::js_number(this.value)
}

pub(crate) fn object_to_js(
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

macro_rules! impl_string_to_js {
    ($name:ident, $ty:ty) => {
        pub fn $name(s: &$ty, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
            debug_assert!(
                s.next.is_none(),
                "string_to_js: rope EString reached without resolveRopeIfNeeded; thread a bump arena"
            );
            if !s.is_present() {
                let emp = BunString::EMPTY;
                return bun_string_jsc::to_js(&emp, global).map_err(js_err);
            }

            if s.is_utf8() {
                // `to_utf16_alloc` returns `Ok(None)` for pure-ASCII (keep 8-bit form).
                let utf16 = strings::to_utf16_alloc(s.slice8(), false, false)
                    .map_err(|_| ToJSError::OutOfMemory)?;
                if let Some(utf16) = utf16 {
                    let (mut out, chars) = BunString::create_uninitialized_utf16(utf16.len());
                    chars.copy_from_slice(&utf16);
                    bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
                } else {
                    let bytes = s.slice8();
                    let (mut out, chars) = BunString::create_uninitialized_latin1(bytes.len());
                    chars.copy_from_slice(bytes);
                    bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
                }
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

// ported from: src/js_parser_jsc/expr_jsc.zig
