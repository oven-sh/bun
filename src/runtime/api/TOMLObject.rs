use bun_ast::{E, Expr, expr::Data as ExprData};
use bun_collections::VecExt;
use bun_core::{String as BunString, ZigString};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, LogJsc, StringJsc};
use bun_parsers::toml::TOML;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.toml",
        false,
        true,
        |arena, log, source| {
            let parse_result = match TOML::parse(source, log, arena, false) {
                Ok(v) => v,
                Err(e) if e == bun_core::err!("StackOverflow") => {
                    return Err(global.throw_stack_overflow());
                }
                Err(_) => {
                    return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
                }
            };

            // `TOML::parse` may have returned `Ok` with a partial AST after
            // logging recoverable errors (e.g. `[1 2]` via `expect` — #31252).
            // Surface those before converting to JS.
            if log.has_errors() {
                return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
            }

            // Walk the AST directly instead of round-tripping through
            // `print_json` + `JSON.parse` — JSON rejects `Infinity`/`NaN` /
            // overflowed float literals, so the printed form of a TOML float
            // like `1e999` or `inf` couldn't re-parse.
            expr_to_js(parse_result, global)
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
        ExprData::ENumber(number) => Ok(JSValue::js_number(number.value)),
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

// ported from: src/runtime/api/TOMLObject.zig
