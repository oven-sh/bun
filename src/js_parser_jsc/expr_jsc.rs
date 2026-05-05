//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

use bun_js_parser::{E, Expr, ExprData, G, ToJSError};
use bun_jsc::{JSGlobalObject, JSValue, JsError};
use bun_string::{strings, String as BunString};

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

pub fn data_to_js(this: &ExprData, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    match this {
        ExprData::EArray(e) => array_to_js(e, global),
        ExprData::EObject(e) => object_to_js(e, global),
        ExprData::EString(e) => string_to_js(e, global),
        ExprData::ENull(_) => Ok(JSValue::NULL),
        ExprData::EUndefined(_) => Ok(JSValue::UNDEFINED),
        ExprData::EBoolean(boolean) | ExprData::EBranchBoolean(boolean) => Ok(if boolean.value {
            JSValue::TRUE
        } else {
            JSValue::FALSE
        }),
        ExprData::ENumber(e) => Ok(number_to_js(e)),
        // ExprData::EBigInt(e) => e.to_js(ctx, exception),
        ExprData::EInlinedEnum(inlined) => data_to_js(&inlined.value.data, global),

        ExprData::EIdentifier(_)
        | ExprData::EImportIdentifier(_)
        | ExprData::EPrivateIdentifier(_)
        | ExprData::ECommonjsExportIdentifier(_) => {
            Err(ToJSError::CannotConvertIdentifierToJS)
        }

        _ => Err(ToJSError::CannotConvertArgumentTypeToJS),
    }
}

pub fn array_to_js(this: &E::Array, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let items = this.items.slice();
    let array = JSValue::create_empty_array(global, items.len()).map_err(js_err)?;
    array.protect();
    let _guard = scopeguard::guard((), |_| array.unprotect());
    for (j, expr) in items.iter().enumerate() {
        array
            .put_index(global, j as u32, data_to_js(&expr.data, global)?)
            .map_err(js_err)?;
    }

    Ok(array)
}

// TODO(b2-blocked): bun_js_parser::E::Boolean
// TODO(b2-blocked): bun_jsc::c::JSValueRef
#[cfg(any())]
pub fn bool_to_js(this: &E::Boolean, ctx: &JSGlobalObject) -> bun_jsc::c::JSValueRef {
    // TODO(port): legacy C-API path; appears unused by data_to_js
    bun_jsc::c::JSValueMakeBoolean(ctx, this.value)
}

pub fn number_to_js(this: &E::Number) -> JSValue {
    JSValue::js_number(this.value)
}

pub fn big_int_to_js(_: &E::BigInt) -> JSValue {
    // TODO:
    JSValue::js_number(0.0)
}

pub fn object_to_js(this: &E::Object, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let obj = JSValue::create_empty_object(global, this.properties.len as usize);
    obj.protect();
    let _guard = scopeguard::guard((), |_| obj.unprotect());
    let props: &[G::Property] = this.properties.slice();
    for prop in props {
        if prop.kind != G::PropertyKind::Normal
            || prop.class_static_block.is_some()
            || prop.key.is_none()
            || prop.value.is_none()
        {
            return Err(ToJSError::CannotConvertArgumentTypeToJS);
        }
        let key = data_to_js(&prop.key.as_ref().unwrap().data, global)?;
        let value = expr_to_js(prop.value.as_ref().unwrap(), global)?;
        JSValue::put_to_property_key(obj, global, key, value).map_err(js_err)?;
    }

    Ok(obj)
}

pub fn string_to_js(s: &E::String, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    // TODO(b2-blocked): bun_string::String::transfer_to_js
    // TODO(b2-blocked): bun_string::String::to_js
    // TODO(b2-blocked): bun_js_parser::E::String::is_present
    // TODO(port): Zig mutates `s` via `resolveRopeIfNeeded`; `data_to_js` only has
    // `&ExprData` so cannot hand out `&mut`. Phase B should either thread a bump
    // arena + interior-mut rope or resolve ropes before reaching here.
    #[cfg(any())]
    {
        s.resolve_rope_if_needed();
        if !s.is_present() {
            let mut emp = BunString::empty();
            return Ok(emp.to_js(global));
        }

        if s.is_utf8() {
            if let Some(utf16) = strings::to_utf16_alloc(s.slice8(), false, false)? {
                let (mut out, chars) = BunString::create_uninitialized_utf16(utf16.len());
                // SAFETY: `chars` points at `utf16.len()` writable u16s freshly
                // allocated by WTF; `utf16` is the same length.
                unsafe { core::ptr::copy_nonoverlapping(utf16.as_ptr(), chars, utf16.len()) };
                return Ok(out.transfer_to_js(global));
            } else {
                let (mut out, chars) = BunString::create_uninitialized_latin1(s.slice8().len());
                // SAFETY: `chars` points at `s.slice8().len()` writable bytes.
                unsafe {
                    core::ptr::copy_nonoverlapping(s.slice8().as_ptr(), chars, s.slice8().len())
                };
                return Ok(out.transfer_to_js(global));
            }
        } else {
            let (mut out, chars) = BunString::create_uninitialized_utf16(s.slice16().len());
            // SAFETY: `chars` points at `s.slice16().len()` writable u16s.
            unsafe {
                core::ptr::copy_nonoverlapping(s.slice16().as_ptr(), chars, s.slice16().len())
            };
            return Ok(out.transfer_to_js(global));
        }
    }
    let _ = (s, global);
    todo!("string_to_js: blocked on bun_string::String::transfer_to_js")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser_jsc/expr_jsc.zig (112 lines)
//   confidence: medium
//   todos:      2
//   notes:      ToJSError variant names guessed (Zig used string-literal error tags); allocator params dropped per non-AST-crate rule; protect/unprotect via scopeguard; ExprData variant shapes & E::String mutability need Phase B verification.
// ──────────────────────────────────────────────────────────────────────────
