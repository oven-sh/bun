//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

use bun_js_parser::{E, Expr, ToJSError};
// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_jsc::JSValue
#[cfg(any())]
use bun_jsc::{JSGlobalObject, JSValue};
#[cfg(any())]
use bun_string::{strings, String as BunString};

// ──────────────────────────────────────────────────────────────────────────
// Every fn in this module materializes a `JSValue` and therefore needs the
// `bun_jsc` crate, which does not yet compile (B-2 of `bun_jsc` pending).
// The full Phase-A bodies are preserved below behind `#[cfg(any())]` gates so
// they remain addressable for the next B-2 pass; each gate names the first
// blocking symbol.
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_jsc::JSValue
// TODO(b2-blocked): bun_js_parser::ExprData
#[cfg(any())]
pub fn expr_to_js(this: &Expr, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    data_to_js(&this.data, global)
}

// TODO(b2-blocked): bun_js_parser::ExprData
// TODO(b2-blocked): bun_jsc::JSValue
#[cfg(any())]
pub fn data_to_js(this: &ExprData, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    match this {
        ExprData::EArray(e) => array_to_js(e, global),
        ExprData::EObject(e) => object_to_js(e, global),
        ExprData::EString(e) => string_to_js(e, global),
        ExprData::ENull => Ok(JSValue::NULL),
        ExprData::EUndefined => Ok(JSValue::UNDEFINED),
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

// TODO(b2-blocked): bun_js_parser::E::Array
// TODO(b2-blocked): bun_jsc::JSValue::create_empty_array
#[cfg(any())]
pub fn array_to_js(this: &E::Array, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let items = this.items.slice();
    let array = JSValue::create_empty_array(global, items.len())?;
    array.protect();
    let _guard = scopeguard::guard((), |_| array.unprotect());
    for (j, expr) in items.iter().enumerate() {
        array.put_index(global, j as u32, data_to_js(&expr.data, global)?)?;
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

// TODO(b2-blocked): bun_js_parser::E::Number
// TODO(b2-blocked): bun_jsc::JSValue::js_number
#[cfg(any())]
pub fn number_to_js(this: &E::Number) -> JSValue {
    JSValue::js_number(this.value)
}

// TODO(b2-blocked): bun_js_parser::E::BigInt
#[cfg(any())]
pub fn big_int_to_js(_: &E::BigInt) -> JSValue {
    // TODO:
    JSValue::js_number(0)
}

// TODO(b2-blocked): bun_js_parser::E::Object
// TODO(b2-blocked): bun_js_parser::G::Property
// TODO(b2-blocked): bun_jsc::JSValue::create_empty_object
#[cfg(any())]
pub fn object_to_js(this: &E::Object, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    let obj = JSValue::create_empty_object(global, this.properties.len());
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
        obj.put_to_property_key(global, key, value)?;
    }

    Ok(obj)
}

// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_string::String::transfer_to_js
// TODO(b2-blocked): bun_string::strings::to_utf16_alloc
// TODO(b2-blocked): bun_js_parser::E::String::resolve_rope_if_needed
#[cfg(any())]
pub fn string_to_js(s: &mut E::String, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
    // TODO(port): narrow error set
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
            Ok(out.transfer_to_js(global))
        } else {
            let (mut out, chars) = BunString::create_uninitialized_latin1(s.slice8().len());
            // SAFETY: `chars` points at `s.slice8().len()` writable bytes.
            unsafe { core::ptr::copy_nonoverlapping(s.slice8().as_ptr(), chars, s.slice8().len()) };
            Ok(out.transfer_to_js(global))
        }
    } else {
        let (mut out, chars) = BunString::create_uninitialized_utf16(s.slice16().len());
        // SAFETY: `chars` points at `s.slice16().len()` writable u16s.
        unsafe { core::ptr::copy_nonoverlapping(s.slice16().as_ptr(), chars, s.slice16().len()) };
        Ok(out.transfer_to_js(global))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser_jsc/expr_jsc.zig (112 lines)
//   confidence: medium
//   todos:      2
//   notes:      ToJSError variant names guessed (Zig used string-literal error tags); allocator params dropped per non-AST-crate rule; protect/unprotect via scopeguard; ExprData variant shapes & E::String mutability need Phase B verification.
// ──────────────────────────────────────────────────────────────────────────
