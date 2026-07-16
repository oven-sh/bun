use bun_core::String as BunString;
use bun_js_printer as js_printer;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, LogJsc, StringJsc};
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
                Err(bun_parsers::Error::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(_) => {
                    return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
                }
            };

            if log.has_errors() {
                return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
            }

            // for now...
            let buffer_writer = js_printer::BufferWriter::init();
            let mut writer = js_printer::BufferPrinter::init(buffer_writer);
            if let Err(err) = js_printer::print_json(
                &mut writer,
                parse_result,
                source,
                js_printer::PrintJsonOptions {
                    indent: Default::default(),
                    mangled_props: None,
                    ..Default::default()
                },
            ) {
                // The printer never writes to `log`; throwing `log.to_js(...)`
                // here produced a literal `throw undefined` in JS.
                return Err(match err {
                    js_printer::Error::StackOverflow => global.throw_stack_overflow(),
                    js_printer::Error::Alloc(_) => global.throw_out_of_memory(),
                    _ => global.throw(format_args!("Failed to print toml: {}", err)),
                });
            }

            let slice = writer.ctx.buffer.slice();
            let mut out = BunString::borrow_utf8(slice);

            out.to_js_by_parse_json(global)
        },
    )
}
