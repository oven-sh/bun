use bun_core::String as BunString;
use bun_js_printer as js_printer;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, LogJsc, StringJsc};
use bun_parsers::toml::TOML;

pub fn create(global: &JSGlobalObject) -> JSValue {
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

            // for now...
            let buffer_writer = js_printer::BufferWriter::init();
            let mut writer = js_printer::BufferPrinter::init(buffer_writer);
            // PORT NOTE: Zig passed `*js_printer.BufferPrinter` as a comptime type param; dropped per (comptime X: type, arg: X) rule
            if let Err(_) = js_printer::print_json(
                &mut writer,
                parse_result.into(),
                source,
                js_printer::PrintJsonOptions {
                    indent: Default::default(),
                    mangled_props: None,
                    ..Default::default()
                },
            ) {
                return Err(global.throw_value(log.to_js(global, "Failed to print toml")?));
            }

            let slice = writer.ctx.buffer.slice();
            let mut out = BunString::borrow_utf8(slice);

            out.to_js_by_parse_json(global)
        },
    )
}

// ported from: src/runtime/api/TOMLObject.zig
