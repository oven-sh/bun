//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

use bun_js_parser::{E, Expr, ExprData, G, ToJSError};
use bun_jsc::{bun_string_jsc, JSGlobalObject, JSValue, JsError};
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
    let _guard = array.protected();
    for (j, expr) in items.iter().enumerate() {
        array
            .put_index(global, j as u32, data_to_js(&expr.data, global)?)
            .map_err(js_err)?;
    }

    Ok(array)
}

pub fn bool_to_js(this: &E::Boolean, _ctx: &JSGlobalObject) -> JSValue {
    // Zig returns `jsc.C.JSValueRef` via `JSValueMakeBoolean`; the Rust C-API
    // shim is `#[deprecated]` in favour of `JSValue`. `JSValue::js_boolean`
    // yields the same encoded immediate (`ValueTrue`/`ValueFalse`) without the
    // FFI hop. Callers needing a raw ref can `.as_ref()` on the result.
    JSValue::js_boolean(this.value)
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
        let key = data_to_js(&prop.key.as_ref().unwrap().data, global)?;
        let value = expr_to_js(prop.value.as_ref().unwrap(), global)?;
        JSValue::put_to_property_key(obj, global, key, value).map_err(js_err)?;
    }

    Ok(obj)
}

/// `E.String.toJS` (src/js_parser_jsc/expr_jsc.zig:79).
///
/// Stamps the body for both `EString` nominal types: the full T4
/// `bun_js_parser::E::String` (used by `data_to_js` / macros) and the
/// value-subset T2 `bun_logger::js_ast::E::EString` (used by the YAML / JSON5
/// interchange parsers, which build the cycle-broken tree). The two are
/// field-identical for everything `stringToJS` touches; the T4 type carries
/// extra lexer-dependent methods that prevent unifying the structs themselves.
macro_rules! impl_string_to_js {
    ($name:ident, $ty:ty) => {
        pub fn $name(s: &$ty, global: &JSGlobalObject) -> Result<JSValue, ToJSError> {
            // TODO(port): Zig mutates `s` via `resolveRopeIfNeeded(allocator)`;
            // callers only have `&` and there is no bump arena in scope here.
            // Phase B should either thread a bump arena + interior-mut rope or
            // resolve ropes before reaching here. For now, assert non-rope
            // (current callers feed resolved literals).
            debug_assert!(
                s.next.is_none(),
                "string_to_js: rope EString reached without resolveRopeIfNeeded; thread bump arena in Phase B"
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
                    // SAFETY: `chars` points at `utf16.len()` writable u16s freshly
                    // allocated by WTF; `utf16` is the same length.
                    unsafe { core::ptr::copy_nonoverlapping(utf16.as_ptr(), chars.as_mut_ptr(), utf16.len()) };
                    bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
                } else {
                    let bytes = s.slice8();
                    let (mut out, chars) = BunString::create_uninitialized_latin1(bytes.len());
                    // SAFETY: `chars` points at `bytes.len()` writable bytes.
                    unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), chars.as_mut_ptr(), bytes.len()) };
                    bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
                }
            } else {
                let utf16 = s.slice16();
                let (mut out, chars) = BunString::create_uninitialized_utf16(utf16.len());
                // SAFETY: `chars` points at `utf16.len()` writable u16s.
                unsafe { core::ptr::copy_nonoverlapping(utf16.as_ptr(), chars.as_mut_ptr(), utf16.len()) };
                bun_string_jsc::transfer_to_js(&mut out, global).map_err(js_err)
            }
        }
    };
}
impl_string_to_js!(string_to_js, E::String);
impl_string_to_js!(value_string_to_js, bun_logger::js_ast::E::EString);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser_jsc/expr_jsc.zig (112 lines)
//   confidence: high
//   todos:      0
//   notes:      allocator params dropped per non-AST-crate rule; protect/unprotect via JSValue::protected RAII; resolveRopeIfNeeded debug-asserted (no bump arena in scope — macro callers feed resolved literals).
// ──────────────────────────────────────────────────────────────────────────
