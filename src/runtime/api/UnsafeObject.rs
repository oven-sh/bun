use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSType, JSValue, JsResult};
use bun_jsc::virtual_machine::GCLevel;
use bun_jsc::zig_string::ZigString;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 3);
    // Zig used a comptime anonymous struct + std.meta.fieldNames to iterate (name, fn) pairs.
    // In Rust the elements share a type, so a const array + plain `for` is the direct mapping.
    // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw `JSHostFn` ABI,
    // which is what `JSFunction::create` expects.
    const FIELDS: &[(&str, JSHostFn)] = &[
        ("gcAggressionLevel", __jsc_host_gc_aggression_level),
        ("arrayBufferToString", __jsc_host_array_buffer_to_string),
        ("mimallocDump", __jsc_host_dump_mimalloc),
    ];
    for &(name, func) in FIELDS {
        object.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, func, 1, Default::default()),
        );
    }
    object
}

#[bun_jsc::host_fn]
pub fn gc_aggression_level(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global;
    // we hold no other Rust borrow of the VM across these accesses.
    let vm = global.bun_vm().as_mut();
    let ret = JSValue::js_number(vm.aggressive_garbage_collection as i32 as f64);
    let value = frame.arguments_old::<1>().ptr[0];

    if !value.is_empty_or_undefined_or_null() {
        match value.coerce::<i32>(global)? {
            1 => vm.aggressive_garbage_collection = GCLevel::Mild,
            2 => vm.aggressive_garbage_collection = GCLevel::Aggressive,
            0 => vm.aggressive_garbage_collection = GCLevel::None,
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
    let args_buf = frame.arguments_old::<2>();
    let args = args_buf.slice();
    if args.len() < 1 || !args[0].is_cell() || !args[0].js_type().is_typed_array_or_array_buffer() {
        return Err(global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    }

    let array_buffer = jsc::ArrayBuffer::from_typed_array(global, args[0]);
    match array_buffer.typed_array_type {
        JSType::Uint16Array | JSType::Int16Array => {
            // SAFETY: array_buffer.ptr points to a valid buffer of array_buffer.len u16
            // elements (the typed-array view); ZigString stores it tagged as UTF-16.
            let utf16 = unsafe {
                core::slice::from_raw_parts(array_buffer.ptr.cast::<u16>(), array_buffer.len)
            };
            let zig_str = ZigString::init_utf16(utf16);
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
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global.
    let _vm = global.bun_vm();
    // TODO(port): blocked_on: bun_alloc::Arena::dump_stats — `VirtualMachine.arena` is now
    // `Option<NonNull<bumpalo::Bump>>` and bumpalo has no `dump_stats()`; the original
    // mimalloc-arena stat dump needs a dedicated shim once the arena type lands.
    if bun_alloc::heap_breakdown::ENABLED {
        // SAFETY: FFI call with no arguments; safe to invoke when heap_breakdown is enabled.
        unsafe { dump_zone_malloc_stats() };
    }
    Ok(JSValue::UNDEFINED)
}

// ported from: src/runtime/api/UnsafeObject.zig
