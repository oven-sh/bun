//! The `AppKitApp` singleton and the per-thread state the window and view
//! wrappers share: whether AppKit is up, and the keep-alive that holds the
//! process open while windows are.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_appkit::menu::{Action, ActionSelector, Entry, Item, Menu, Modifiers};
use bun_appkit::{ActivationPolicy, App, AppSink};
use bun_io::KeepAlive;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::conv::{self, JsStr};
use super::slots::JsSlots;

use crate::generated_classes::js_AppKitApp as js;

struct State {
    keep_alive: RefCell<KeepAlive>,
    windows: Cell<usize>,
    /// `app.keepAlive`: hold the process even with no window open.
    keep_flag: Cell<bool>,
}

thread_local! {
    static STATE: State = State {
        keep_alive: RefCell::new(KeepAlive::init()),
        windows: Cell::new(0),
        keep_flag: Cell::new(false),
    };
}

fn sync_keep_alive(state: &State) {
    let wanted = state.windows.get() > 0 || state.keep_flag.get();
    let mut keep_alive = state.keep_alive.borrow_mut();
    if wanted {
        keep_alive.ref_(bun_io::js_vm_ctx());
    } else {
        keep_alive.unref(bun_io::js_vm_ctx());
    }
}

/// One open window's claim on the process keep-alive; released on drop.
pub(super) struct OpenWindow(());

impl OpenWindow {
    pub(super) fn new() -> OpenWindow {
        STATE.with(|state| {
            state.windows.set(state.windows.get() + 1);
            sync_keep_alive(state);
        });
        OpenWindow(())
    }
}

impl Drop for OpenWindow {
    fn drop(&mut self) {
        STATE.with(|state| {
            debug_assert!(state.windows.get() > 0);
            state.windows.set(state.windows.get() - 1);
            sync_keep_alive(state);
        });
    }
}

fn set_keep_flag(on: bool) {
    STATE.with(|state| {
        state.keep_flag.set(on);
        sync_keep_alive(state);
    });
}

/// The running application, or a JavaScript error if `app.start()` has not been called.
pub(super) fn started(global: &JSGlobalObject) -> JsResult<&'static App> {
    App::get().ok_or_else(|| global.throw(format_args!("app.start() has not been called")))
}

struct Events {
    slots: Rc<JsSlots>,
}

impl AppSink for Events {
    fn before_quit(&self) -> bool {
        self.slots.allows(js::on_before_quit_get_cached, &[])
    }

    fn reopened(&self, has_visible_windows: bool) {
        self.slots.call(
            js::on_reopen_get_cached,
            &[JSValue::js_boolean(has_visible_windows)],
        );
    }

    fn menu_item(&self, id: u32) {
        self.slots
            .call(js::on_menu_get_cached, &[JSValue::js_number(f64::from(id))]);
    }
}

/// `app` in `bun:appkit`: NSApplication lifecycle, Dock badge and menu bar.
#[bun_jsc::JsClass(no_constructor)]
pub struct AppKitApp {
    slots: Rc<JsSlots>,
}

impl AppKitApp {
    /// Creates the singleton and its JavaScript wrapper.
    pub(super) fn create(global: &JSGlobalObject) -> JSValue {
        let slots = Rc::new(JsSlots::empty(global));
        let app = AppKitApp {
            slots: Rc::clone(&slots),
        };
        let value = bun_jsc::JsClass::to_js(app, global);
        slots.bind(value, global);
        value
    }

    /// Brings AppKit up with `policy` (default `"regular"`) and routes its events to this
    /// object's slots. A second call is a no-op.
    pub fn start(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arg = frame.argument(0);
        let policy = if arg.is_undefined_or_null() {
            ActivationPolicy::Regular
        } else {
            conv::activation_policy(global, arg)?
        };
        if App::get().is_none() {
            let loop_ = global.bun_vm().uws_loop_mut();
            let app = conv::check(global, App::start(loop_, policy))?;
            app.set_sink(Box::new(Events {
                slots: Rc::clone(&self.slots),
            }));
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn quit(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if let Some(app) = App::get() {
            app.request_quit();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn activate(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        started(global)?.activate();
        Ok(JSValue::UNDEFINED)
    }

    pub fn hide(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if let Some(app) = App::get() {
            app.hide();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn set(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let value = frame.argument(1);
        match key.as_str() {
            "keepAlive" => {
                set_keep_flag(conv::boolean(global, value, format_args!("app.keepAlive"))?)
            }
            "activationPolicy" => {
                let policy = conv::activation_policy(global, value)?;
                conv::check(global, started(global)?.set_activation_policy(policy))?;
            }
            "name" => {
                let name = conv::optional_string(global, value, format_args!("app.name"))?
                    .map(|name| name.to_utf8());
                started(global)?.set_name(name.as_deref());
            }
            "badge" => {
                let app = started(global)?;
                let text = if value.is_number() {
                    Some(JsStr::coerce(global, value)?)
                } else {
                    conv::optional_string(global, value, format_args!("app.badge"))?
                };
                app.set_badge(&text.map(|t| t.to_utf8()).unwrap_or_default());
            }
            "menu" => {
                let app = started(global)?;
                if value.is_undefined_or_null() {
                    app.set_menu(None);
                } else {
                    let menus = menus_from_js(global, value)?;
                    app.set_menu(Some(&menus));
                }
            }
            other => {
                return Err(
                    global.throw_invalid_arguments(format_args!("app has no property \"{other}\""))
                );
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_is_dark(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(App::get().is_some_and(App::is_dark)))
    }

    pub fn get_has_display(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(
            App::get().is_some_and(App::has_display),
        ))
    }

    pub fn get_live_views(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(bun_appkit::view::live_count() as f64))
    }

    /// Event slots start empty; JavaScript assigns them and the cached
    /// value is what gets read back.
    pub fn get_on_before_quit(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_reopen(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_menu(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

impl Drop for AppKitApp {
    fn drop(&mut self) {
        self.slots.finalize();
    }
}

/// The already-normalised menu description from `bun:appkit` (see the
/// module's `normalizeMenus`).
fn menus_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<Menu>> {
    if !value.is_array() {
        return Err(global.throw_invalid_arguments(format_args!(
            "app.menu must be an array of {{ title, items }} or null"
        )));
    }
    let mut menus = Vec::new();
    let mut iter = value.array_iterator(global)?;
    let mut i = 0usize;
    while let Some(menu) = iter.next()? {
        if !menu.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "app.menu[{i}] must be {{ title, items }}"
            )));
        }
        let title = match menu.get(global, "title")? {
            Some(t) => JsStr::new(global, t, format_args!("app.menu[{i}].title"))?
                .to_utf8()
                .into_string(),
            None => String::new(),
        };
        let items = match menu.get(global, "items")? {
            Some(items) => menu_items_from_js(global, items, 0)?,
            None => Vec::new(),
        };
        menus.push(Menu { title, items });
        i += 1;
    }
    Ok(menus)
}

/// Submenus this deep are refused rather than recursed into without bound.
const MAX_MENU_DEPTH: usize = 16;

fn menu_items_from_js(
    global: &JSGlobalObject,
    value: JSValue,
    depth: usize,
) -> JsResult<Vec<Item>> {
    if depth > MAX_MENU_DEPTH {
        return Err(
            global.throw_invalid_arguments(format_args!("app.menu: submenus nest too deeply"))
        );
    }
    if !value.is_array() {
        return Err(global.throw_invalid_arguments(format_args!("app.menu items must be an array")));
    }
    let mut items = Vec::new();
    let mut iter = value.array_iterator(global)?;
    while let Some(item) = iter.next()? {
        if !item.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "app.menu items must be objects or \"separator\""
            )));
        }
        if item
            .get(global, "separator")?
            .is_some_and(JSValue::to_boolean)
        {
            items.push(Item::Separator);
            continue;
        }
        let title = match item.get(global, "title")? {
            Some(t) => JsStr::new(global, t, format_args!("menu item title"))?
                .to_utf8()
                .into_string(),
            None => String::new(),
        };
        let flag = |name: &'static str| -> JsResult<Option<bool>> {
            Ok(item.get(global, name)?.map(JSValue::to_boolean))
        };
        if let Some(sub) = item
            .get(global, "submenu")?
            .filter(|s| !s.is_undefined_or_null())
        {
            items.push(Item::Submenu {
                title,
                items: menu_items_from_js(global, sub, depth + 1)?,
                enabled: flag("enabled")?.unwrap_or(true),
            });
            continue;
        }
        let action = if let Some(id) = item.get(global, "id")?.filter(|v| v.is_number()) {
            let id = id.as_number();
            if !(id.fract() == 0.0 && id >= 1.0 && id <= f64::from(u32::MAX)) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "app.menu item \"{title}\" has an invalid id"
                )));
            }
            Action::Callback(id as u32)
        } else if let Some(sel) = item.get(global, "action")?.filter(|v| v.is_string()) {
            let name = JsStr::new(global, sel, format_args!("menu item action"))?.to_utf8();
            Action::Selector(conv::check(global, ActionSelector::parse(&name))?)
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "app.menu item \"{title}\" needs onClick, action or submenu"
            )));
        };
        let key = match item.get(global, "key")? {
            Some(k) if k.is_string() => JsStr::new(global, k, format_args!("menu item key"))?
                .to_utf8()
                .into_string(),
            _ => String::new(),
        };
        items.push(Item::Entry(Entry {
            title,
            action,
            key,
            modifiers: Modifiers {
                shift: flag("shift")?.unwrap_or(false),
                option: flag("option")?.unwrap_or(false),
                control: flag("control")?.unwrap_or(false),
                command: flag("command")?,
            },
            enabled: flag("enabled")?.unwrap_or(true),
            checked: flag("checked")?.unwrap_or(false),
        }));
    }
    Ok(items)
}
