use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use bun_options_types::context::RESETS_BEFORE_EACH_TEST;

use super::jest::Jest;

unsafe extern "C" {
    safe fn ViUtils__putFunctions(global: &JSGlobalObject, vi: JSValue);
    safe fn ViUtils__unstubAllEnvs(global: &JSGlobalObject);
    safe fn ViUtils__unstubAllGlobals(global: &JSGlobalObject);
    safe fn ViUtils__stubWhatPreloadStubbed(global: &JSGlobalObject);
    safe fn ViUtils__forgetDynamicImports(global: &JSGlobalObject);
    safe fn JSMock__restoreAllMocks(global: &JSGlobalObject);
    safe fn JSMock__resetAllMocks(global: &JSGlobalObject);
    safe fn JSMock__clearAllMocks(global: &JSGlobalObject);
    safe fn JSMock__didFinishTestFile(global: &JSGlobalObject);
}

type Reset = extern "C" fn(&JSGlobalObject);

/// As `RESETS_BEFORE_EACH_TEST`.
const RESETS: [Reset; RESETS_BEFORE_EACH_TEST.len()] = [
    JSMock__restoreAllMocks,
    JSMock__resetAllMocks,
    JSMock__clearAllMocks,
    ViUtils__unstubAllEnvs,
    ViUtils__unstubAllGlobals,
];
const CLEAR_MOCKS: usize = 2;

/// What `vi.setConfig()` has set.
#[derive(Clone, Copy, Default)]
pub(crate) struct Config {
    /// In ms, 0 for none, for the tests and the hooks that are registered from now on.
    pub(crate) test_timeout: Option<u32>,
    pub(crate) hook_timeout: Option<u32>,
    /// 0 for no limit.
    pub(crate) max_concurrency: Option<u32>,
    resets: [Option<bool>; RESETS.len()],
}

/// No script is on the stack.
fn run(global: &JSGlobalObject, reset: Reset) {
    crate::dispatch::fold(bun_jsc::from_js_host_call_generic(global, || {
        reset(global)
    }));
}

/// Before the `beforeEach` hooks of a test, each time it is tried.
pub(crate) fn before_each_attempt(global: &JSGlobalObject, is_vitest: bool) {
    let Some(runner) = Jest::runner() else { return };
    let set = runner.vi_config.resets;
    let configured = runner.test_options.resets_before_each_test;
    for (index, &reset) in RESETS.iter().enumerate() {
        // vitest 5 clears the mocks unless it is told not to.
        if set[index].or(configured[index]).unwrap_or(is_vitest && index == CLEAR_MOCKS) {
            run(global, reset);
        }
    }
}

/// Not so in a hook that a preload has registered: what that undoes, it undoes for a test file.
#[unsafe(no_mangle)]
extern "C" fn ViUtils__isLoadingPreload(global: &JSGlobalObject) -> bool {
    global.bun_vm().is_in_preload
}

/// The next test file shares `global`.
pub(crate) fn on_test_file_end(global: &JSGlobalObject) {
    run(global, JSMock__didFinishTestFile);
    run(global, ViUtils__unstubAllEnvs);
    run(global, ViUtils__unstubAllGlobals);
    run(global, ViUtils__stubWhatPreloadStubbed);
    ViUtils__forgetDynamicImports(global);
    if let Some(runner) = Jest::runner() {
        runner.vi_config = runner.vi_config_of_preload;
    }
}

/// 0, which is "none", for what is not a positive finite number: so vitest treats a timeout.
fn number_option(
    global: &JSGlobalObject,
    config: JSValue,
    name: &'static str,
) -> JsResult<Option<u32>> {
    let Some(value) = config.get(global, name)? else {
        return Ok(None);
    };
    if !value.is_number() {
        return Err(global.throw_invalid_argument_type_value(
            format!("config.{name}"),
            "number",
            value,
        ));
    }
    let number = value.as_number();
    Ok(Some(if number > 0.0 && number < f64::from(u32::MAX) {
        (number as u32).max(1)
    } else {
        0
    }))
}

/// What a preload script sets holds for every test file, as that of a setup file of vitest does.
fn commit(global: &JSGlobalObject, config: Config) {
    if let Some(runner) = Jest::runner() {
        runner.vi_config = config;
        if global.bun_vm().is_in_preload {
            runner.vi_config_of_preload = config;
        }
    }
}

#[bun_jsc::host_fn]
fn set_config(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let config = frame.argument(0);
    if !config.is_object() {
        return Err(global.throw_invalid_argument_type_value("config", "object", config));
    }
    let test_timeout = number_option(global, config, "testTimeout")?;
    let hook_timeout = number_option(global, config, "hookTimeout")?;
    let max_concurrency = number_option(global, config, "maxConcurrency")?;
    let mut resets = [None; RESETS.len()];
    for (reset, name) in resets.iter_mut().zip(RESETS_BEFORE_EACH_TEST) {
        *reset = config.get(global, name)?.map(JSValue::to_boolean);
    }

    let mut merged = Jest::runner().map(|runner| runner.vi_config).unwrap_or_default();
    merged.test_timeout = test_timeout.or(merged.test_timeout);
    merged.hook_timeout = hook_timeout.or(merged.hook_timeout);
    merged.max_concurrency = max_concurrency.or(merged.max_concurrency);
    for (merged, reset) in merged.resets.iter_mut().zip(resets) {
        *merged = reset.or(*merged);
    }
    commit(global, merged);
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn reset_config(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    commit(global, Config::default());
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
