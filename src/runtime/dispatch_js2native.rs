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
pub use crate::api::crash_handler_jsc::js_bindings::generate as crash_handler_crash_handler_js_bindings_generate;

pub use bun_install_jsc::dependency_jsc::dependency_from_js as install_dependency_from_js;
pub use bun_install_jsc::dependency_jsc::tag_infer_from_js as install_dependency_version_tag_infer_from_js;
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
// `emit_handle_ipc_message` is implemented in this crate (`ipc_host.rs`)
// because it dereferences `Subprocess`, a runtime type.
pub use crate::ipc_host::emit_handle_ipc_message as jsc_ipc_emit_handle_ipc_message;

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

/// Lives here (not in `src/bun.rs`)
/// because the flag it reads — `cli::Arguments::Bun__Node__UseSystemCA` — is
/// owned by `bun_runtime`; placing the body in a lower crate would invert the
/// dependency edge.
pub(crate) fn bun_get_use_system_ca(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let v =
        crate::cli::Arguments::Bun__Node__UseSystemCA.load(core::sync::atomic::Ordering::Relaxed);
    Ok(JSValue::js_boolean(v))
}

// Test-only bindings for `bun_perf::hw_timer`. The bodies live here (like
// `bun_get_use_system_ca` above) because `bun_perf` is a low-tier crate with
// no `*_jsc` sibling and must not depend on `bun_jsc`.

/// `hwTimerInternals.resolveTscFrequency(hypervisor, hvMaxLeaf, hvTscKhz,
/// leaf15Eax, leaf15Ebx, leaf15Ecx)` — run the x64 TSC-frequency decision on
/// caller-supplied CPUID values so tests can cover hypervisor/bare-metal
/// combinations this machine doesn't exhibit.
pub(crate) fn perf_hw_timer_resolve_tsc_frequency(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let got = frame.arguments_count() as usize;
    if got < 6 {
        return Err(global.throw_not_enough_arguments("resolveTscFrequency", 6, got));
    }
    let uint = |i: usize| -> JsResult<u32> {
        let v = frame.argument(i).coerce_to_int64(global)?;
        Ok(v.clamp(0, i64::from(u32::MAX)) as u32)
    };
    let info = bun_perf::hw_timer::X64TscCpuidInfo {
        hypervisor: frame.argument(0).to_boolean(),
        hv_max_leaf: uint(1)?,
        hv_tsc_khz: uint(2)?,
        leaf_15_eax: uint(3)?,
        leaf_15_ebx: uint(4)?,
        leaf_15_ecx: uint(5)?,
    };
    Ok(JSValue::js_number_from_uint64(
        bun_perf::hw_timer::resolve_x64_tsc_frequency(info),
    ))
}

/// `hwTimerInternals.calibrationState()` — the frequency `bun_perf::hw_timer`
/// would calibrate with on this machine plus a counter/OS-clock sample pair,
/// so tests can measure the real counter rate and compare.
pub(crate) fn perf_hw_timer_calibration_state(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let snapshot = bun_perf::hw_timer::calibration_snapshot();
    let result = JSValue::create_empty_object(global, 3);
    result.put(
        global,
        b"frequencyHz",
        JSValue::js_number_from_uint64(snapshot.frequency_hz),
    );
    result.put(
        global,
        b"counter",
        JSValue::js_number_from_uint64(snapshot.counter),
    );
    result.put(
        global,
        b"osNs",
        JSValue::js_number_from_uint64(snapshot.os_ns),
    );
    Ok(result)
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
pub use crate::linear_fifo_testing::ordered_remove_probe as collections_linear_fifo_testing_ap_is_ordered_remove_probe;

// ported from: generated_js2native.rs
