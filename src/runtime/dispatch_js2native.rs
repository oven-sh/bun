//! `crate::dispatch::js2native` — flat re-export landing pad for the
//! `JS2Rust__*` thunks emitted into `generated_js2native.rs`.
//!
//! `src/codegen/generate-js2native.ts::rustTarget()` routes every `$rust(...)`
//! call site whose source file lives **outside** `src/runtime/` through
//! `crate::dispatch::js2native::<mangled>` instead of the file's own crate
//! path. `bun_runtime` is the highest-tier crate (already depends on every
//! `*_jsc` bridge crate plus `bun_jsc` itself), so the cross-crate fan-out
//! lands here without introducing a dep cycle. Each entry below is a `pub use`
//! of the real hand-ported function — there are no local bodies and no
//! fallback panics; a missing target stays a compile error in the owning
//! crate.
//!
//! Naming: the mangled identifier is `snake(<path-under-src>.join("_")) ++ "_"
//! ++ snake(symbol).replace("::", "_")` (see `generate-js2native.ts`).

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

pub use bun_sql_jsc::mysql::create_binding as sql_jsc_mysql_create_binding;
pub use bun_sql_jsc::postgres::create_binding as sql_jsc_postgres_create_binding;

// The real body already lives in this crate.
pub(crate) use crate::api::crash_handler_jsc::js_bindings::generate as crash_handler_crash_handler_js_bindings_generate;

pub use bun_install_jsc::hosted_git_info_jsc::js_from_url as install_hosted_git_info_testing_ap_is_js_from_url;
pub use bun_install_jsc::hosted_git_info_jsc::js_parse_url as install_hosted_git_info_testing_ap_is_js_parse_url;
pub use bun_install_jsc::install_binding::bun_install_js_bindings::generate as install_jsc_install_binding_bun_install_js_bindings_generate;
pub use bun_install_jsc::npm_jsc::architecture_is_match as install_npm_architecture_js_function_architecture_is_match;
pub use bun_install_jsc::npm_jsc::operating_system_is_match as install_npm_operating_system_js_function_operating_system_is_match;
pub use bun_install_jsc::npm_jsc::package_manifest_bindings_generate as install_npm_package_manifest_bindings_generate;

// The `*_jsc` bodies live in `bun_install_jsc::ini_jsc`
// (ini's only JSC consumer is `bun install`'s npmrc loader).
pub use bun_install_jsc::ini_jsc::ini_testing_load_npmrc_from_js as ini_ini_ini_testing_ap_is_load_npmrc_from_js;
pub use bun_install_jsc::ini_jsc::ini_testing_parse as ini_ini_ini_testing_ap_is_parse;

pub use bun_jsc::bindgen_test::get_bindgen_test_functions as jsc_bindgen_test_get_bindgen_test_functions;
pub use bun_jsc::counters::create_counters_object as jsc_counters_create_counters_object;
pub use bun_jsc::event_loop::get_active_tasks as jsc_event_loop_get_active_tasks;
pub use bun_jsc::virtual_machine_exports::Bun__setSyntheticAllocationLimitForTesting as jsc_virtual_machine_exports_bun__set_synthetic_allocation_limit_for_testing;

pub use bun_jsc::bun_string_jsc::js_escape_reg_exp as string_escape_reg_exp_js_escape_reg_exp;
pub use bun_jsc::bun_string_jsc::js_escape_reg_exp_for_package_name_matching as string_escape_reg_exp_js_escape_reg_exp_for_package_name_matching;
pub use bun_jsc::bun_string_jsc::unicode_testing_apis::to_utf16_alloc_sentinel as bun_core_string_immutable_unicode_testing_ap_is_to_utf16_alloc_sentinel;

pub use bun_patch_jsc::testing::patch_apply as patch_patch_testing_ap_is_apply;
pub use bun_patch_jsc::testing::patch_make_diff as patch_patch_testing_ap_is_make_diff;
pub use bun_patch_jsc::testing::patch_parse as patch_patch_testing_ap_is_parse;

pub use bun_sourcemap_jsc::internal_jsc::testing_find as sourcemap_internal_source_map_testing_ap_is_find;
pub use bun_sourcemap_jsc::internal_jsc::testing_from_vlq as sourcemap_internal_source_map_testing_ap_is_from_vlq;
pub use bun_sourcemap_jsc::internal_jsc::testing_to_vlq as sourcemap_internal_source_map_testing_ap_is_to_vlq;

pub use bun_sys_jsc::error_jsc::TestingAPIs::sigaction_layout as sys_sys_testing_ap_is_sigaction_layout;
pub use bun_sys_jsc::error_jsc::TestingAPIs::sys_error_name_from_libuv as sys_error_testing_ap_is_sys_error_name_from_libuv;
pub use bun_sys_jsc::error_jsc::TestingAPIs::translate_nt_status_to_e as sys_sys_testing_ap_is_translate_nt_status_to_e;
pub use bun_sys_jsc::error_jsc::TestingAPIs::translate_uv_error_to_e as sys_sys_testing_ap_is_translate_uv_error_to_e;

pub use bun_http_jsc::headers_jsc::h2_live_counts as http_h2_client_testing_ap_is_live_counts;
pub use bun_http_jsc::headers_jsc::h3_quic_live_counts as http_h3_client_testing_ap_is_quic_live_counts;

/// This thread's resolved `--use-system-ca` decision (see `VirtualMachine::use_system_ca`);
/// `undefined` when nothing decided it, in which case tls.ts falls back to NODE_USE_SYSTEM_CA the
/// way the process default store does:
/// https://github.com/nodejs/node/blob/v26.3.0/src/node_options.cc#L2207
pub(crate) fn bun_get_use_system_ca(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(
        match bun_jsc::virtual_machine::VirtualMachine::get().use_system_ca {
            Some(v) => JSValue::js_boolean(v),
            None => JSValue::UNDEFINED,
        },
    )
}

/// Process-wide `--use-openssl-ca`, under which the default store holds neither the bundled nor
/// the system roots; `getCACertificates('default')` leaves them out to match, as node's does:
/// https://github.com/nodejs/node/blob/v26.3.0/lib/tls.js#L157
pub(crate) fn bun_get_use_openssl_ca(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_boolean(crate::cli::Arguments::use_openssl_ca()))
}

/// `[elapsedSinceLoopStartMs, idleMs]` for THIS thread's loop — the two numbers
/// performance.eventLoopUtilization() is defined in terms of (node derives
/// active as now - loopStart - idle) — or `null` before the loop has begun.
pub(crate) fn bun_get_loop_elu(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let vm = bun_jsc::virtual_machine::VirtualMachine::get();
    // SAFETY: the VM owns this loop (installed by `ensure_waker` before any JS ran; `usockets_loop`
    // panics rather than return null) and this runs on its thread. Raw *mut, no &Loop — a
    // &mut PosixLoop is live above us via tick_with_timeout for the whole tick.
    // Idle before elapsed, so the derived active (elapsed - idle) never dips negative.
    let raw_idle_ns = unsafe { bun_uws::us_loop_idle_ns((*vm.event_loop).usockets_loop()) };
    let idle_ms = vm.loop_idle_ms(raw_idle_ns);
    let Some(elapsed_ms) = vm.loop_elapsed_ms() else {
        return Ok(JSValue::NULL);
    };
    let arr = JSValue::create_empty_array(global, 2)?;
    arr.put_index(global, 0, JSValue::js_number(elapsed_ms))?;
    arr.put_index(global, 1, JSValue::js_number(idle_ms))?;
    Ok(arr)
}

mod css {
    pub use bun_css_jsc::css_internals::{
        _test, attr_test, minify_error_test_with_options, minify_test, minify_test_with_options,
        prefix_test, prefix_test_with_options, test_with_options,
    };
}
pub use css::_test as css_jsc_css_internals__test;
pub use css::attr_test as css_jsc_css_internals_attr_test;
pub use css::minify_error_test_with_options as css_jsc_css_internals_minify_error_test_with_options;
pub use css::minify_test as css_jsc_css_internals_minify_test;
pub use css::minify_test_with_options as css_jsc_css_internals_minify_test_with_options;
pub use css::prefix_test as css_jsc_css_internals_prefix_test;
pub use css::prefix_test_with_options as css_jsc_css_internals_prefix_test_with_options;
pub use css::test_with_options as css_jsc_css_internals_test_with_options;

// `LinearFifo` has no JSC consumer of its own; this `bun:internal-for-testing`
// probe lives in `bun_runtime` (which depends on both `bun_collections` and
// `bun_jsc`) rather than inventing a JSC edge into the collections crate.
pub(crate) use crate::linear_fifo_testing::ordered_remove_probe as collections_linear_fifo_testing_ap_is_ordered_remove_probe;

// ported from: generated_js2native.rs
