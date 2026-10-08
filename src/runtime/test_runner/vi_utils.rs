use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};

use super::jest::Jest;

unsafe extern "C" {
    safe fn ViUtils__putFunctions(global: &JSGlobalObject, vi: JSValue);
    safe fn ViUtils__unstubAllEnvs(global: &JSGlobalObject);
    safe fn ViUtils__unstubAllGlobals(global: &JSGlobalObject);
    safe fn ViUtils__forgetDynamicImports(global: &JSGlobalObject);
}

/// The next test file shares `global`. No script is on the stack.
pub(crate) fn on_test_file_end(global: &JSGlobalObject) {
    for unstub in [ViUtils__unstubAllEnvs, ViUtils__unstubAllGlobals] {
        crate::dispatch::fold(bun_jsc::from_js_host_call_generic(global, || {
            unstub(global)
        }));
    }
    ViUtils__forgetDynamicImports(global);
}

#[bun_jsc::host_fn]
fn set_config(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let config = frame.argument(0);
    if !config.is_object() {
        return Err(global.throw_invalid_argument_type_value("config", "object", config));
    }
    let Some(test_timeout) = config.get(global, "testTimeout")? else {
        return Ok(JSValue::UNDEFINED);
    };
    if !test_timeout.is_number() {
        return Err(global.throw_invalid_argument_type_value(
            "config.testTimeout",
            "number",
            test_timeout,
        ));
    }
    let ms = test_timeout.as_number();
    if let Some(runner) = Jest::runner() {
        // 0 is "no timeout", as vitest treats anything that is not a positive finite number.
        runner.default_timeout_override = if ms > 0.0 && ms < f64::from(u32::MAX) {
            (ms as u32).max(1)
        } else {
            0
        };
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn reset_config(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if let Some(runner) = Jest::runner() {
        runner.default_timeout_override = u32::MAX;
    }
    Ok(JSValue::UNDEFINED)
}

const FNS: &[(&str, u32, JSHostFn)] = &[
    ("setConfig", 1, __jsc_host_set_config),
    ("resetConfig", 0, __jsc_host_reset_config),
];

pub(crate) fn put_fns(global: &JSGlobalObject, _jest: JSValue, vi: JSValue) {
    ViUtils__putFunctions(global, vi);
    for &(name, arity, func) in FNS {
        vi.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, func, arity, Default::default()),
        );
    }
}
