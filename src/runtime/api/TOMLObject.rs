use bun_alloc::Arena;
use bun_interchange::toml::TOML;
use bun_js_parser::ASTMemoryAllocator;
use bun_js_printer as js_printer;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_logger as logger;
use bun_str::{String as BunString, ZigString};

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 1);
    object.put(
        global,
        ZigString::static_(b"parse"),
        JSFunction::create(
            global,
            b"parse",
            parse,
            1,
            Default::default(),
        ),
    );

    object
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
    let _ast_scope = ast_memory_allocator.enter(&arena);

    let mut log = logger::Log::init();
    let input_value = frame.argument(0);
    if input_value.is_empty_or_undefined_or_null() {
        return global.throw_invalid_arguments(format_args!("Expected a string to parse"));
    }

    let input_slice = input_value.to_slice(global)?;
    let source = &logger::Source::init_path_string(b"input.toml", input_slice.slice());
    let parse_result = match TOML::parse(source, &mut log, &arena, false) {
        Ok(v) => v,
        Err(e) if e == bun_core::err!("StackOverflow") => {
            return global.throw_stack_overflow();
        }
        Err(_) => {
            return global.throw_value(log.to_js(global, b"Failed to parse toml")?);
        }
    };

    // for now...
    let buffer_writer = js_printer::BufferWriter::init(&arena);
    let mut writer = js_printer::BufferPrinter::init(buffer_writer);
    // PORT NOTE: Zig passed `*js_printer.BufferPrinter` as a comptime type param; dropped per (comptime X: type, arg: X) rule
    if let Err(_) = js_printer::print_json(
        &mut writer,
        parse_result,
        source,
        js_printer::PrintJsonOptions {
            mangled_props: None,
        },
    ) {
        return global.throw_value(log.to_js(global, b"Failed to print toml")?);
    }

    let slice = writer.ctx.buffer.slice();
    let out = BunString::borrow_utf8(slice);

    out.to_js_by_parse_json(global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/TOMLObject.zig (79 lines)
//   confidence: medium
//   todos:      1
//   notes:      arena/ASTMemoryAllocator threading into bun_interchange/bun_js_printer needs Phase B API alignment; log.to_js extension-trait import
// ──────────────────────────────────────────────────────────────────────────
