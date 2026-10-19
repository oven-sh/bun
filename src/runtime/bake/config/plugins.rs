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

/// `pagesFramework()`: the default framework of `.tsx` and `.jsx` pages, as the `framework` object
/// that a plugin would give, with its built-in modules as `code`. `bun bake build` builds it as it
/// builds the framework of a plugin.
pub(crate) fn pages_framework(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    use crate::bake::BuiltInModule;
    let vm = global.bun_vm().as_mut();
    let framework = crate::bake::Framework::bake_pages(&mut vm.transpiler.resolver);
    let strings = |list: &[bun_core::Utf8Bytes<'static>]| {
        JSValue::create_array_from_iter(global, list.iter(), |item| {
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, item)
        })
    };
    let routers = JSValue::create_array_from_iter(
        global,
        framework.file_system_router_types.iter(),
        |fsr| {
            let router = JSValue::create_empty_object(global, 9);
            let string = |bytes: &[u8]| bun_jsc::bun_string_jsc::create_utf8_for_js(global, bytes);
            router.put(global, b"root", string(&fsr.root)?);
            router.put(global, b"prefix", string(&fsr.prefix)?);
            if let Some(style) = fsr.style.name() {
                router.put(global, b"style", string(style)?);
            }
            router.put(global, b"serverEntryPoint", string(&fsr.entry_server)?);
            if let Some(client) = &fsr.entry_client {
                router.put(global, b"clientEntryPoint", string(client)?);
            }
            router.put(global, b"extensions", strings(&fsr.extensions)?);
            router.put(global, b"ignoreDirs", strings(&fsr.ignore_dirs)?);
            router.put(
                global,
                b"ignoreUnderscores",
                JSValue::from(fsr.ignore_underscores),
            );
            router.put(global, b"layouts", JSValue::from(fsr.allow_layouts));
            if fsr.client_pages {
                let client_pages = JSValue::create_empty_object(global, 1);
                client_pages.put(global, b"serverExports", strings(&fsr.server_exports)?);
                router.put(global, b"clientPages", client_pages);
            }
            Ok(router)
        },
    )?;
    let modules = JSValue::create_array_from_iter(
        global,
        framework
            .built_in_modules
            .keys()
            .iter()
            .zip(framework.built_in_modules.values()),
        |(name, module)| {
            let entry = JSValue::create_empty_object(global, 2);
            entry.put(
                global,
                b"import",
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, name)?,
            );
            let (key, value): (&[u8], &[u8]) = match module {
                BuiltInModule::Import(path) => (b"path", path),
                BuiltInModule::Code(code) => (b"code", code),
            };
            entry.put(
                global,
                key,
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, value)?,
            );
            Ok(entry)
        },
    )?;
    let result = JSValue::create_empty_object(global, 2);
    result.put(global, b"fileSystemRouterTypes", routers);
    result.put(global, b"builtInModules", modules);
    Ok(result)
}

/// `serveStaticEnv()`: the `env` of `[serve.static]` in bunfig.toml, as the `env` option of
/// `Bun.build()`: `"inline"`, `"disable"`, a prefix such as `"PUBLIC_*"`, or `undefined` when not set.
/// The dev server inlines the same variables into the browser code.
pub(crate) fn serve_static_env(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    use bun_options_types::schema::api::DotEnvBehavior;
    let o = &global
        .bun_vm()
        .as_mut()
        .transpiler
        .options
        .transform_options;
    let value: Vec<u8> = match o.serve_env_behavior {
        DotEnvBehavior::prefix => {
            let mut prefix = o.serve_env_prefix.as_deref().unwrap_or_default().to_vec();
            prefix.push(b'*');
            prefix
        }
        DotEnvBehavior::load_all => b"inline".to_vec(),
        DotEnvBehavior::disable => b"disable".to_vec(),
        _ => return Ok(JSValue::UNDEFINED),
    };
    bun_jsc::bun_string_jsc::create_utf8_for_js(global, &value)
}

/// `productionServerCode()`: the source of `src/runtime/bake/production/server.ts`, which `bun bake
/// build` bundles into `dist/server.js`.
pub(crate) fn production_server_code(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let code = bun_core::runtime_embed_file!(Src, "runtime/bake/production/server.ts");
    bun_jsc::bun_string_jsc::create_utf8_for_js(global, code.as_bytes())
}
