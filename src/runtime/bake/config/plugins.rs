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

/// `restartsOnChange()`: whether a change starts the process again (`--check` runs in watch mode)
/// instead of reloading it in place.
pub(crate) fn restarts_on_change(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    Ok(JSValue::from(
        vm.hot_reload == crate::cli::command::HotReload::Watch,
    ))
}
