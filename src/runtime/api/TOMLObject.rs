use bun_alloc::Arena;
use bun_interchange::toml::TOML;
use bun_js_parser::ASTMemoryAllocator;
use bun_js_printer as js_printer;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsError, JsResult, LogJsc, StringJsc};
use bun_logger as logger;
use bun_str::String as BunString;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 1);
    object.put(
        global,
        b"parse",
        JSFunction::create(
            global,
            b"parse",
            __jsc_host_parse,
            1,
            Default::default(),
        ),
    );

    object
}

// Local shim: `JSGlobalObject::throw_stack_overflow` lives in the still-gated
// `src/jsc/JSGlobalObject.rs`. Re-declare the FFI symbol and wrap it here so
// the StackOverflow branch can throw without depending on the gated module.
unsafe extern "C" {
    safe fn JSGlobalObject__throwStackOverflow(this: &JSGlobalObject);
}
trait JSGlobalObjectStackOverflowExt {
    fn throw_stack_overflow(&self) -> JsError;
}
impl JSGlobalObjectStackOverflowExt for JSGlobalObject {
    #[inline]
    fn throw_stack_overflow(&self) -> JsError {
        JSGlobalObject__throwStackOverflow(self);
        JsError::Thrown
    }
}

#[bun_jsc::host_fn]
pub fn parse(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator bulk-free feeding TOML parser + js_printer — profile in Phase B
    let arena = Arena::new();

    // TODO(port): ASTMemoryAllocator is the typed Expr/Stmt slab; verify enter()/scope RAII shape in Phase B
    let ast_memory_allocator = arena.alloc(ASTMemoryAllocator::default());
    let _ast_scope = ast_memory_allocator.enter();

    let mut log = logger::Log::init();
    let input_value = frame.argument(0);
    if input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected a string to parse")));
    }

    let input_slice = input_value.to_slice(global)?;
    let source = &logger::Source::init_path_string(b"input.toml", input_slice.slice());
    let parse_result = match TOML::parse(source, &mut log, &arena, false) {
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
}

// ported from: src/runtime/api/TOMLObject.zig
