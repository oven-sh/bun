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
#[cfg(not(windows))]
const RESTART_ENV_VAR: &bun_core::ZStr = bun_core::zstr!("BUN_INTERNAL_BAKE_RESTART");

static RESTARTED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

/// `bun bake --check`, before the type check: records whether this process is a restart after a
/// change, and marks the environment for the next restart. On Windows, a manager process starts
/// every run with the same environment, so no run is seen as a restart there.
pub(crate) fn mark_restart() {
    #[cfg(not(windows))]
    {
        if bun_core::getenv_z(RESTART_ENV_VAR).is_some() {
            RESTARTED.store(true, core::sync::atomic::Ordering::Relaxed);
        } else {
            // SAFETY: both strings are NUL-terminated; setenv copies them into libc env storage.
            unsafe { libc::setenv(RESTART_ENV_VAR.as_ptr().cast(), c"1".as_ptr(), 1) };
        }
    }
}

/// `isRestart()`: whether this process is `bun bake --check` started again after a change.
pub(crate) fn is_restart(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::from(
        RESTARTED.load(core::sync::atomic::Ordering::Relaxed),
    ))
}

/// `restartProcess()`: starts `bun bake` again with the same arguments, after a change to
/// `bake.config.ts`. The server loads plugins once, so only a new process gets the new ones.
/// When the restart fails, `reload_process` prints why and this exits 1: the kill signal handlers
/// have run and the signal dispositions are reset, so the server cannot go on.
pub(crate) fn restart_process(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    global.bun_vm().as_mut().restart_process(true);
    // Not `process.exit()`: during a restart it tries the restart again, and panics when it fails.
    bun_core::Output::flush();
    bun_core::Global::exit(1);
}

/// `isRestarting()`: whether a restart is running the kill signal listeners. The process is then
/// about to start again, so a listener must not end it.
pub(crate) fn is_restarting(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::from(
        bun_jsc::posix_signal_handle::is_emitting_watch_kill_signal(),
    ))
}

/// `setPages(framework?)`: the next `Bun.serve()` adds the routers of `framework` (the `framework`
/// object of a plugin), or of the default React framework when it is undefined.
pub(crate) fn set_pages(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [framework] = frame.arguments_as_array::<1>();
    let vm = global.bun_vm().as_mut();
    if framework.is_undefined_or_null() {
        vm.bake_framework.deinit();
    } else {
        vm.bake_framework.set(global, framework);
    }
    vm.bake_pages = true;
    Ok(JSValue::UNDEFINED)
}

/// `checkFramework(framework)`: throws the error that `Bun.serve()` would throw for this `framework`
/// object of a plugin, so that `bun bake` reports it as an error of `bake.config.ts`.
pub(crate) fn check_framework(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [framework] = frame.arguments_as_array::<1>();
    let mut bundler_options = crate::bake::SplitBundlerOptions::default();
    let result = crate::bake::Framework::from_js(framework, global, &mut bundler_options);
    bundler_options.destroy_plugin();
    result?;
    Ok(JSValue::UNDEFINED)
}
