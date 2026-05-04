use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, ZigString};
use bun_str::ZigString as _; // TODO(port): ZigString lives in bun_str per crate map; bun_jsc re-exports it

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 3);
    // Zig used a comptime anonymous struct + std.meta.fieldNames to iterate (name, fn) pairs.
    // In Rust the elements share a type, so a const array + plain `for` is the direct mapping.
    const FIELDS: &[(&str, jsc::HostFnZig)] = &[
        ("gcAggressionLevel", gc_aggression_level),
        ("arrayBufferToString", array_buffer_to_string),
        ("mimallocDump", dump_mimalloc),
    ];
    for (name, func) in FIELDS {
        object.put(
            global,
            ZigString::static_str(name),
            JSFunction::create(global, name, *func, 1, Default::default()),
        );
    }
    object
}

#[bun_jsc::host_fn]
pub fn gc_aggression_level(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let ret = JSValue::js_number(global.bun_vm().aggressive_garbage_collection as i32);
    let value = frame.arguments_old(1).ptr[0];

    if !value.is_empty_or_undefined_or_null() {
        match value.coerce::<i32>(global)? {
            1 => global.bun_vm().aggressive_garbage_collection = GCAggressionLevel::Mild,
            2 => global.bun_vm().aggressive_garbage_collection = GCAggressionLevel::Aggressive,
            0 => global.bun_vm().aggressive_garbage_collection = GCAggressionLevel::None,
            _ => {}
        }
    }
    Ok(ret)
}

#[bun_jsc::host_fn]
pub fn array_buffer_to_string(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let args = frame.arguments_old(2).slice();
    if args.len() < 1 || !args[0].is_cell() || !args[0].js_type().is_typed_array_or_array_buffer() {
        return global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer"));
    }

    let array_buffer = jsc::ArrayBuffer::from_typed_array(global, args[0]);
    match array_buffer.typed_array_type {
        jsc::TypedArrayType::Uint16Array | jsc::TypedArrayType::Int16Array => {
            let mut zig_str = ZigString::init(b"");
            // SAFETY: array_buffer.ptr points to a valid buffer of array_buffer.len u16 elements;
            // ZigString stores it as *const u8 and the UTF-16 marker reinterprets it as u16.
            zig_str._unsafe_ptr_do_not_use = array_buffer.ptr.cast::<u8>();
            zig_str.len = array_buffer.len;
            zig_str.mark_utf16();
            Ok(zig_str.to_js(global))
        }
        _ => {
            Ok(ZigString::init(array_buffer.slice()).to_js(global))
        }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn dump_zone_malloc_stats();
}

#[bun_jsc::host_fn]
fn dump_mimalloc(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    global.bun_vm().arena.dump_stats();
    if bun_alloc::heap_breakdown::ENABLED {
        // SAFETY: FFI call with no arguments; safe to invoke when heap_breakdown is enabled.
        unsafe { dump_zone_malloc_stats() };
    }
    Ok(JSValue::UNDEFINED)
}

// TODO(port): GCAggressionLevel enum lives on VirtualMachine (src/jsc/VirtualMachine.zig);
// import path will be fixed in Phase B once bun_jsc::VirtualMachine is ported.
use bun_jsc::vm::GCAggressionLevel;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/UnsafeObject.zig (76 lines)
//   confidence: medium
//   todos:      2
//   notes:      host_fn macro must expose raw fn ptr type (HostFnZig) for JSFunction::create; GCAggressionLevel import path is a guess
// ──────────────────────────────────────────────────────────────────────────
