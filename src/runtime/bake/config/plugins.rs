//! `bun bake`: the plugins of `bake.config.ts`. `internal/bake.ts` checks them, then hands them over
//! here before it starts the server.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// `setConfigPlugins(plugins, names)`: `plugins` is an array of Bun plugin objects and `names` is
/// an array of their names.
pub(crate) fn set_config_plugins(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [plugins, names] = frame.arguments_as_array::<2>();
    let mut list: Vec<Box<[u8]>> = Vec::new();
    let mut iter = names.array_iterator(global)?;
    while let Some(name) = iter.next()? {
        list.push(Box::from(&*name.to_utf8(global)?));
    }
    let vm = global.bun_vm().as_mut();
    // With none, the server sets up no plugins, unless bunfig.toml has some.
    if list.is_empty() {
        vm.bake_config_plugins.deinit();
    } else {
        vm.bake_config_plugins.set(global, plugins);
    }
    vm.bake_config_plugin_names = list.into_boxed_slice();
    Ok(JSValue::UNDEFINED)
}

/// Set in the environment by the first start of `bun bake --check`, so that the process that a
/// change starts again (`execve` keeps the environment) knows it is a restart.
const RESTART_ENV_VAR: &core::ffi::CStr = c"BUN_INTERNAL_BAKE_RESTART";

/// `takeRestartMark()`: whether this process is a restart of `bun bake --check` after a change.
/// Call it once, at the start: it marks the environment for the next restart. On Windows, a manager
/// process starts each restart with its own environment, so this is always false there.
pub(crate) fn take_restart_mark(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if global.bun_vm().hot_reload != crate::cli::command::HotReload::Watch {
        return Ok(JSValue::FALSE);
    }
    #[cfg(not(windows))]
    {
        // SAFETY: a NUL-terminated name; only the JS thread reads or writes it.
        let restarted = !unsafe { libc::getenv(RESTART_ENV_VAR.as_ptr()) }.is_null();
        if !restarted {
            // SAFETY: both strings are NUL-terminated; setenv copies them into libc env storage.
            unsafe { libc::setenv(RESTART_ENV_VAR.as_ptr(), c"1".as_ptr(), 1) };
        }
        Ok(JSValue::from(restarted))
    }
    #[cfg(windows)]
    {
        let _ = RESTART_ENV_VAR;
        Ok(JSValue::FALSE)
    }
}
