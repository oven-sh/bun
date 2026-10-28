//! Symbols that the rest of Bun provides to this crate and `bun_sema_standalone` does not stand in for, for this crate's
//! `cargo test` binary. Never compiled into the real build.

use core::ffi::{c_char, c_int, c_void};
use std::time::Duration;

macro_rules! not_called_by_tests {
    ($($name:ident)*) => {
        $(
            #[unsafe(no_mangle)]
            extern "C" fn $name() -> ! {
                panic!(concat!(stringify!($name), " has no stand-in in native_test_shims.rs"));
            }
        )*
    };
}

not_called_by_tests! {
    __bun_resolver_parse_dependency
    __bun_resolver_init_package_manager
    __bun_macro_context_init
    __bun_macro_context_deinit
    __bun_macro_context_call
    __bun_macro_collect_vm_garbage
    __bun_jsc_wtf_string_hash
    __bun_jsc_host_builtins
    __bun_jsc_generate_internal_module_bytecode_from_source
    __bun_jsc_generate_internal_module_bytecode
    __bun_jsc_generate_cached_bytecode
    __bun_jsc_encoder_string_table_take
    __bun_jsc_encoder_string_table_slot
    __bun_jsc_encoder_string_table_new
    __bun_jsc_enable_hot_module_reloading_for_bundler
    __bun_jsc_bytecode_link_encoder_new
    __bun_jsc_bytecode_link_encoder_finish
    __bun_jsc_bytecode_link_encoder_destroy
    __bun_jsc_bytecode_link_encoder_add_module
    __bun_jsc_bytecode_link_encoder_add_internal_module_from_source
    __bun_jsc_bytecode_link_encoder_add_internal_module
    __bun_dispatch__TranspilerCacheImpl__Jsc__get
    __bun_dispatch__JsEventLoop__Jsc__tick
    __bun_dispatch__JsEventLoop__Jsc__js_poster
    __bun_dispatch__JsEventLoop__Jsc__auto_tick
    __bun_dispatch__DevServerHandle__Bake__track_resolution_failure
    __bun_dispatch__DevServerHandle__Bake__register_barrel_with_deferrals
    __bun_dispatch__DevServerHandle__Bake__register_barrel_export
    __bun_dispatch__DevServerHandle__Bake__put_or_overwrite_asset
    __bun_dispatch__DevServerHandle__Bake__log_for_resolution_failures
    __bun_dispatch__DevServerHandle__Bake__is_file_cached
    __bun_dispatch__DevServerHandle__Bake__handle_parse_task_failure
    __bun_dispatch__DevServerHandle__Bake__finalize_bundle
    __bun_dispatch__DevServerHandle__Bake__current_bundle_start_data
    __bun_dispatch__DevServerHandle__Bake__barrel_needed_exports
    __bun_dispatch__DevServerHandle__Bake__asset_hash
    URL__getFileURLString
    JSC__jsToNumber
    JSBundlerPlugin__hasOnBeforeParsePlugins
    JSBundlerPlugin__freezeFilters
    JSBundlerPlugin__callOnBeforeParsePlugins
    JSBundlerPlugin__anyMatches
    Bun__JSC__operationMathPow
}

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_init() -> c_int {
    0
}

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_emit(_event_name: *const c_char, _duration_ns: i64) -> c_int {
    0
}

const SIZE_OF_LOOP: usize = 64 * 1024;

#[unsafe(no_mangle)]
extern "C" fn uws_get_loop() -> *mut c_void {
    thread_local! {
        static LOOP: *mut c_void = Box::leak(vec![0u64; SIZE_OF_LOOP / 8].into_boxed_slice()).as_mut_ptr().cast();
    }
    LOOP.with(|event_loop| *event_loop)
}

#[unsafe(no_mangle)]
extern "C" fn us_wakeup_loop(_event_loop: *mut c_void) {}

#[unsafe(no_mangle)]
extern "C" fn us_loop_run_bun_tick(
    _event_loop: *mut c_void,
    _timeout: *const c_void,
    _now_ns: u64,
) {
    std::thread::sleep(Duration::from_millis(1));
}
