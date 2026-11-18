//! What the modules export.

use bun_jsc::virtual_machine::VirtualMachine;

use crate::clipboard::Clipboard;
use crate::generated_bindgen::{
    contents, electron as only_electron, ipc as channels, menu, session, system, touch_bar,
    window as windows,
};
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::{
    app, cover, dialog, files, ipc, paths, power, process, screen, theme, utility, window,
};

pub(crate) const CHROME: &str = "156.0.0.0";
pub(crate) const ELECTRON: &str = "45.0.0";

state!(fn electron_clipboard() -> StrongCell);

macro_rules! put {
    ($object:expr, { $($name:literal: $file:ident::$class:ident),* $(,)? }) => {
        $($object.put(global(), $name.as_bytes(), $file::$class::CLASS.constructor(heap()));)*
    };
}

fn listen() {
    bun_ui::listen(bun_ui::Listeners {
        started: app::started,
        system: app::handle,
        window: window::handle,
    });
}

fn common() -> JsResult<JSValue> {
    let all = object!({
        "app": app::object(),
        "dialog": dialog::object(),
        "nativeImage": bun_ui::image::module(heap()),
        "nativeTheme": theme::object(),
        "powerMonitor": power::monitor(),
        "screen": screen::object(),
    });
    put!(all, {
        "Menu": menu::js_DesktopMenu,
        "MenuItem": menu::js_DesktopMenuItem,
        "Notification": system::js_DesktopNotification,
        "Tray": system::js_DesktopTray,
        "globalShortcut": system::js_DesktopGlobalShortcut,
        "powerSaveBlocker": system::js_DesktopPowerSaveBlocker,
        "shell": system::js_DesktopShell,
        "systemPreferences": system::js_DesktopSystemPreferences,
    });
    Ok(all)
}

/// A script may import the modules without showing anything, where there is no library to load.
fn prewarm() -> JsResult<()> {
    if paths::resources().is_some() {
        catch(bun_ui::renderer(global())).map(drop)
    } else {
        Ok(())
    }
}

pub(crate) fn desktop(_: Cx<'_, '_>) -> JsResult<JSValue> {
    listen();
    prewarm()?;
    cover::begin()?;
    let all = common()?;
    all.put(global(), b"clipboard", bun_ui::clipboard::module(heap()));
    all.put(global(), b"useColorScheme", crate::theme::hook()?);
    put!(all, {
        "BaseWindow": windows::js_DesktopWindow,
        "Window": windows::js_DesktopWindow,
        "net": system::js_DesktopNet,
        "safeStorage": system::js_DesktopSafeStorage,
    });
    Ok(all)
}

pub(crate) fn dom(_: Cx<'_, '_>) -> JsResult<JSValue> {
    prewarm()?;
    let page = crate::page_host::first_page()?;
    Ok(object!({ "window": get(page, "window")?, "document": get(page, "document")? }))
}

pub(crate) fn clipboard_of_electron() -> JSValue {
    if !electron_clipboard().is_some() {
        electron_clipboard().set(keep(Clipboard::create()));
    }
    electron_clipboard().get().unwrap_or(JSValue::UNDEFINED)
}

fn pretend_to_be_electron() -> JsResult<()> {
    let versions = get(process::object(), "versions")?;
    versions.put(global(), b"chrome", js(CHROME)?);
    versions.put(global(), b"electron", js(ELECTRON)?);
    Ok(())
}

/// Unless the app listens as well.
fn handle_by_default(event: &'static str, handle: fn(JSValue) -> JsResult<()>) -> JsResult<()> {
    let listener = procedure(move |arguments| {
        let listeners = invoke(process::object(), "listenerCount", &[js(event)?])?;
        if listeners.as_number() > 1. {
            Ok(())
        } else {
            handle(argument(arguments, 0))
        }
    })?;
    invoke(process::object(), "on", &[js(event)?, listener]).map(drop)
}

fn warn_about_rejections() -> JsResult<()> {
    handle_by_default("unhandledRejection", |reason| {
        let (message, kind) = (
            js(process::inspect(reason)?)?,
            js("UnhandledPromiseRejectionWarning")?,
        );
        global().emit_warning(message, kind, JSValue::UNDEFINED, JSValue::UNDEFINED)
    })
}

fn outlive_exceptions() -> JsResult<()> {
    handle_by_default("uncaughtException", |thrown| {
        let text = match catch(process::inspect(thrown))? {
            Ok(description) => format!("Uncaught Exception:\n{description}"),
            Err(_) => "Uncaught Exception".to_owned(),
        };
        later::soon(move |_| {
            let arguments = [
                js("A JavaScript error occurred in the main process")?,
                js(&*text)?,
            ];
            if catch(invoke(dialog::object(), "showErrorBox", &arguments))?.is_err() {
                dialog::print_error(&text);
            }
            Ok(())
        });
        Ok(())
    })
}

fn extend_process() -> JsResult<()> {
    let (process, executable) = (process::object(), process::executable());
    process.put(global(), b"type", js("browser")?);
    match paths::resources() {
        Some(resources) => {
            invoke(
                get(process, "argv")?,
                "splice",
                &[0.into(), 2.into(), js(executable)?],
            )?;
            process.put(global(), b"resourcesPath", js(resources)?);
        }
        None => {
            let resources = files::join(&[files::parent(&executable).unwrap_or("/"), "resources"]);
            process.put(global(), b"resourcesPath", js(resources)?);
            process.put(global(), b"defaultApp", JSValue::TRUE);
        }
    }
    add_methods_to_process()
}

pub(crate) fn add_methods_to_process() -> JsResult<()> {
    let process = process::object();
    let methods = only_electron::js_DesktopProcess::CLASS.constructor(heap());
    let mut names = methods.keys(global())?.array_iterator(global())?;
    while let Some(name) = names.next()? {
        let name = text_of(name)?;
        process.put(global(), name.as_bytes(), get(methods, &name)?);
    }
    Ok(())
}

fn of_utility_process() -> JsResult<JSValue> {
    let all = object!({ "parentPort": get(process::object(), "parentPort")? });
    put!(all, {
        "net": session::js_ElectronNet,
        "systemPreferences": system::js_DesktopSystemPreferences,
    });
    Ok(all)
}

pub(crate) fn of_page_process() -> JsResult<()> {
    pretend_to_be_electron()?;
    warn_about_rejections()?;
    process::object().put(global(), b"type", js("renderer")?);
    add_methods_to_process()
}

pub(crate) fn electron(cx: Cx<'_, '_>) -> JsResult<JSValue> {
    if !core::ptr::eq(cx.global(), global()) {
        let message = format_args!("A page gets Electron's modules from its preload script");
        return Err(cx.global().throw(message));
    }
    pretend_to_be_electron()?;
    let all = if !VirtualMachine::get().is_main_thread.get() {
        object!({})
    } else {
        listen();
        warn_about_rejections()?;
        match utility::enter()? {
            true => of_utility_process()?,
            false => of_main_process()?,
        }
    };
    for name in [
        "electron",
        "electron/main",
        "electron/common",
        "electron/renderer",
        "electron/utility",
    ] {
        realm::provide_module(name, all, Ok)?;
    }
    for name in ["original-fs", "node:original-fs"] {
        realm::provide_module(name, JSValue::UNDEFINED, |_| {
            realm::require(global(), Module::Fs)
        })?;
    }
    Ok(all)
}

fn of_main_process() -> JsResult<JSValue> {
    if paths::resources().is_some()
        && process::variable("ELECTRON_RUN_AS_NODE")?.is_some_and(|it| !it.is_empty())
    {
        process::run_as_bun()?;
    }
    cover::begin()?;
    extend_process()?;
    app::become_electron()?;
    outlive_exceptions()?;
    let all = common()?;
    all.put(global(), b"clipboard", clipboard_of_electron());
    all.put(global(), b"protocol", crate::session::protocol::module()?);
    all.put(global(), b"ipcMain", ipc::main()?);
    put!(all, {
        "BaseWindow": windows::js_DesktopBaseWindow,
        "BrowserView": windows::js_DesktopBrowserView,
        "BrowserWindow": windows::js_DesktopBrowserWindow,
        "ClipboardItem": only_electron::js_ElectronClipboardItem,
        "ImageView": windows::js_DesktopImageView,
        "MessageChannelMain": channels::js_ElectronMessageChannelMain,
        "ShareMenu": menu::js_ElectronShareMenu,
        "TouchBar": touch_bar::js_ElectronTouchBar,
        "View": windows::js_DesktopView,
        "WebContentsView": windows::js_DesktopWebContentsView,
        "autoUpdater": only_electron::js_ElectronAutoUpdater,
        "contentTracing": only_electron::js_ElectronContentTracing,
        "crashReporter": only_electron::js_ElectronCrashReporter,
        "desktopCapturer": only_electron::js_ElectronDesktopCapturer,
        "inAppPurchase": only_electron::js_ElectronInAppPurchase,
        "net": session::js_ElectronNet,
        "netLog": session::js_ElectronNetLog,
        "session": session::js_ElectronSessions,
        "pushNotifications": only_electron::js_ElectronPushNotifications,
        "safeStorage": only_electron::js_ElectronSafeStorage,
        "utilityProcess": channels::js_ElectronUtilityProcesses,
        "webContents": contents::js_ElectronWebContentsModule,
        "webFrameMain": contents::js_ElectronWebFrameMainModule,
    });
    Ok(all)
}
