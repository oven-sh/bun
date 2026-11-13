use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use bun_options_types::context::RESETS_BEFORE_EACH_TEST;

use super::jest::{Jest, TestRunner};
use super::scope_functions::FunctionKind;
use crate::generated_bindgen::vi_utils as generated;

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
    safe fn JSMock__willRunTest(global: &JSGlobalObject);
}

type Reset = extern "C" fn(&JSGlobalObject);

/// Same order as `RESETS_BEFORE_EACH_TEST`.
const RESETS: [Reset; RESETS_BEFORE_EACH_TEST.len()] = [
    JSMock__restoreAllMocks,
    JSMock__resetAllMocks,
    JSMock__clearAllMocks,
    ViUtils__unstubAllEnvs,
    ViUtils__unstubAllGlobals,
];
const CLEAR_MOCKS: usize = 2;

/// What a test or a hook gets when it registers without a timeout of its own: in ms, 0 for none, `None` for `--timeout`.
/// `setDefaultTimeout()` and `vi.setConfig()` both write it, so the later call wins.
#[derive(Clone, Copy, Default)]
pub(crate) struct Timeouts {
    test: Option<u32>,
    hook: Option<u32>,
    /// What `setDefaultTimeout()` last set, which `vi.resetConfig()` goes back to.
    set_default: Option<u32>,
}

impl Timeouts {
    fn of_set_default(set_default: Option<u32>) -> Self {
        Self { test: set_default, hook: set_default, set_default }
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Config {
    timeouts: Timeouts,
    /// 0 for no limit.
    pub(crate) max_concurrency: Option<u32>,
    resets: [Option<bool>; RESETS.len()],
}

impl Config {
    pub(crate) fn timeout(&self, kind: FunctionKind) -> Option<u32> {
        match kind {
            FunctionKind::TestOrDescribe => self.timeouts.test,
            FunctionKind::Hook | FunctionKind::VitestHook => self.timeouts.hook,
        }
    }
}

/// `setDefaultTimeout()` and `jest.setTimeout()`. A preload's call lasts until the first test file is done:
/// https://github.com/oven-sh/bun/issues/43787
pub(crate) fn set_default_timeout(runner: &mut TestRunner<'_>, timeout_ms: u32) {
    runner.vi_config.timeouts = Timeouts::of_set_default(Some(timeout_ms));
    runner.timeouts_of_each_repeat = runner.vi_config.timeouts;
}

/// Reports a thrown error as uncaught, so only call this with no JS on the stack.
fn run(global: &JSGlobalObject, reset: Reset) {
    crate::dispatch::fold(bun_jsc::from_js_host_call_generic(global, || {
        reset(global)
    }));
}

pub(crate) fn before_each_attempt(global: &JSGlobalObject, is_vitest: bool) {
    JSMock__willRunTest(global);
    let Some(runner) = Jest::runner() else { return };
    let set = runner.vi_config.resets;
    let configured = runner.test_options.resets_before_each_test;
    for (index, &reset) in RESETS.iter().enumerate() {
        // Vitest 5 clears mocks by default.
        if set[index].or(configured[index]).unwrap_or(is_vitest && index == CLEAR_MOCKS) {
            run(global, reset);
        }
    }
}

/// False inside a hook that a preload registered, because that hook runs on behalf of a test file.
#[unsafe(no_mangle)]
extern "C" fn ViUtils__isLoadingPreload(global: &JSGlobalObject) -> bool {
    global.bun_vm().is_in_preload
}

/// Runs after each load of a test file, so once per `--rerun-each` repeat.
/// If `next_load_shares_global` is false, `global` is thrown away and the preloads run again, so there's nothing to undo.
pub(crate) fn on_test_file_end(global: &JSGlobalObject, next_load_shares_global: bool) {
    if let Some(runner) = Jest::runner() {
        if !next_load_shares_global {
            runner.vi_config_of_preload = Config::default();
        }
        runner.vi_config = Config { timeouts: runner.timeouts_of_each_repeat, ..runner.vi_config_of_preload };
    }
    if !next_load_shares_global {
        return;
    }
    run(global, JSMock__didFinishTestFile);
    run(global, ViUtils__unstubAllEnvs);
    run(global, ViUtils__unstubAllGlobals);
    run(global, ViUtils__stubWhatPreloadStubbed);
    ViUtils__forgetDynamicImports(global);
}

/// Runs after the last load of a test file.
pub(crate) fn restore_default_timeouts(runner: &mut TestRunner<'_>) {
    runner.timeouts_of_each_repeat = runner.vi_config_of_preload.timeouts;
    runner.vi_config.timeouts = runner.timeouts_of_each_repeat;
}

/// Like Vitest's timeouts, anything that isn't a positive finite number becomes 0, which means none.
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

/// Config set by a preload applies to every test file, like config set by a Vitest setup file.
fn apply(global: &JSGlobalObject, change: impl Fn(&mut Config)) {
    if let Some(runner) = Jest::runner() {
        change(&mut runner.vi_config);
        if global.bun_vm().is_in_preload {
            change(&mut runner.vi_config_of_preload);
            runner.timeouts_of_each_repeat = runner.vi_config.timeouts;
        }
    }
}

#[optimize(size)]
pub(crate) fn set_config(cx: &mut JsScope<'_>, config: JsLocal<'_>) -> JsResult<()> {
    let (global, config) = (cx.global(), config.to_js());
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

    apply(global, |merged| {
        merged.timeouts.test = test_timeout.or(merged.timeouts.test);
        merged.timeouts.hook = hook_timeout.or(merged.timeouts.hook);
        merged.max_concurrency = max_concurrency.or(merged.max_concurrency);
        for (merged, reset) in merged.resets.iter_mut().zip(resets) {
            *merged = reset.or(*merged);
        }
    });
    Ok(())
}

pub(crate) fn reset_config(cx: &mut JsScope<'_>) {
    apply(cx.global(), |config| {
        *config = Config { timeouts: Timeouts::of_set_default(config.timeouts.set_default), ..Config::default() };
    });
}

const FNS: &[(&str, u32, JSHostFn)] = &[
    ("setConfig", 1, generated::Bun__ViUtils__setConfig),
    ("resetConfig", 0, generated::Bun__ViUtils__resetConfig),
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
