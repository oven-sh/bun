//! `Bun.JSONC` — `parse()`.

use bun_js_parser_jsc::ExprJsc;
use bun_jsc::bindgen::JsHeap;
use bun_jsc::{JSValue, JsError, JsResult};
use bun_parsers::json;

pub(crate) fn parse(heap: &JsHeap<'_>, input: &[u8]) -> JsResult<JSValue> {
    // SAFETY: parsing runs no JavaScript. Nor does making the result: its keys are primitives, and its properties are
    // defined and not set. What throws returns without reading `input` again.
    let global = unsafe { heap.global() };
    // The parser is also the package manager's and the bundler's, so no code is this feature's alone and nothing stands in for this function where --trim removed the feature: it would run into what was removed with the others.
    if bun_removable_features::is_removed(bun_removable_features::Feature::Jsonc) {
        return Err(crate::removed_feature::throw_for_removed_feature(
            global,
            bun_removable_features::Feature::Jsonc,
        ));
    }
    super::with_text_format_source(global, input, b"input.jsonc", |_, log, source| {
        // parse_jsonc maps empty input to {}; the public API rejects it like JSON.parse.
        if source.contents.is_empty() {
            return Err(
                global.throw_value(global.create_syntax_error_instance(format_args!(
                    "JSONC Parse error: Unexpected end of input"
                ))),
            );
        }
        let parsed =
            match json::ParsedJson::parse_jsonc(source, log) {
                Ok(v) => v,
                Err(bun_parsers::Error::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(bun_parsers::Error::Alloc(_)) => {
                    return Err(JsError::OutOfMemory);
                }
                Err(_) => {
                    // Skip duplicate-key warnings so the message names the fatal error.
                    let first_msg = log
                        .msgs
                        .iter()
                        .find(|m| m.kind == bun_ast::Kind::Err)
                        .or_else(|| log.msgs.first());
                    if let Some(first_msg) = first_msg {
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "JSONC Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("JSONC Parse error: Unable to parse JSONC string"),
                    )));
                }
            };

        parsed
            .root
            .to_js(global)
            .map_err(|e| bun_js_parser_jsc::to_js_error(e, global))
    })
}
