use bun_ast::{E, Expr, expr::Data as ExprData};
use bun_collections::VecExt;
use bun_core::{String as BunString, ZigString};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, StringJsc};
use bun_parsers::xml;

pub fn create(global: &JSGlobalObject) -> JSValue {
    jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.xml",
        true,
        true,
        |bump, log, source| {
            let root = match xml::XML::parse(source, log, bump) {
                Ok(r) => r,
                Err(xml::ExternalError::OutOfMemory) => return Err(JsError::OutOfMemory),
                Err(xml::ExternalError::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(xml::ExternalError::SyntaxError) => {
                    if !log.msgs.is_empty() {
                        let first_msg = &log.msgs[0];
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "XML Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("XML Parse error: Unable to parse XML string",),
                    )));
                }
            };

            // The XML AST never contains cycles (unlike YAML anchors/aliases),
            // so a simple recursive conversion is fine here.
            expr_to_js(root, global)
        },
    )
}

fn estring_to_js(str: &E::EString, global: &JSGlobalObject) -> JsResult<JSValue> {
    if str.is_utf16 {
        let zig = ZigString::init_utf16(str.slice16());
        let bun_s = BunString::init(zig);
        bun_s.to_js(global)
    } else {
        jsc::bun_string_jsc::create_utf8_for_js(global, str.slice8())
    }
}

fn expr_to_js(expr: Expr, global: &JSGlobalObject) -> JsResult<JSValue> {
    match expr.data {
        ExprData::ENull(_) => Ok(JSValue::NULL),
        ExprData::EBoolean(boolean) => Ok(JSValue::from(boolean.value)),
        ExprData::ENumber(number) => Ok(JSValue::js_number(number.value())),
        ExprData::EString(str) => estring_to_js(str.get(), global),
        ExprData::EArray(arr) => {
            JSValue::create_array_from_iter(global, arr.slice().iter(), |item| {
                expr_to_js(*item, global)
            })
        }
        ExprData::EObject(obj) => {
            let js_obj = JSValue::create_empty_object(global, obj.properties.len_u32() as usize);
            for prop in obj.properties.slice() {
                let key_expr = prop.key.expect("infallible: prop has key");
                let value = expr_to_js(prop.value.expect("infallible: prop has value"), global)?;
                let key_js = expr_to_js(key_expr, global)?;
                let key_str = bun_core::OwnedString::new(key_js.to_bun_string(global)?);
                js_obj.put_may_be_index(global, &key_str, value)?;
            }
            Ok(js_obj)
        }
        _ => Ok(JSValue::UNDEFINED),
    }
}

// ported from: src/runtime/api/XMLObject.zig
