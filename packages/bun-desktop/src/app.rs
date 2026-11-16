//! Starts GPUI and executes what JavaScript asks for.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::sync::Once;

use anyhow::{Context as _, Result, anyhow, bail};
use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, HotKeyState};
use gpui::{
    ActivationPolicy, ActivityGuard, App, Application, Bounds, DisplayEvent, Pixels, PowerMode,
    QuitMode, SystemNotification, SystemNotificationAction, ThermalState, Window, WindowAppearance,
    px, size,
};
use image::codecs::{jpeg::JpegEncoder, png::PngEncoder};
use rustc_hash::FxHashMap;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::bridge::{self, blob, report};
#[cfg(not(target_os = "macos"))]
use crate::clipboard::{read_clipboard, write_clipboard};
use crate::native::{self, NativeWindow};
use crate::{canvas, dialog, frame, host, images, input, menu, surface, text, tray, window};

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Options {
    headless: bool,
    accessory: bool,
}

type Deferred = Box<dyn FnOnce() -> Result<()>>;

thread_local! {
    static AFTER_UPDATE: RefCell<Vec<Deferred>> = RefCell::default();
    static IS_EXITING: Cell<bool> = const { Cell::new(false) };
    static APPEARANCE: Cell<Option<WindowAppearance>> = const { Cell::new(None) };
    static ACTIVITIES: RefCell<FxHashMap<u64, ActivityGuard>> = RefCell::default();
    static HOTKEYS: RefCell<Option<native::GlobalHotKeyManager>> = const { RefCell::new(None) };
}

pub fn appearance_override() -> Option<WindowAppearance> {
    APPEARANCE.get()
}

pub fn after_update(f: impl FnOnce() -> Result<()> + 'static) {
    AFTER_UPDATE.with_borrow_mut(|deferred| deferred.push(Box::new(f)));
}

/// One of Objective-C's would abort the process where panics are caught.
pub fn catch_exception<R>(f: impl FnOnce() -> R) -> Result<R> {
    #[cfg(target_os = "macos")]
    return objc2::exception::catch(std::panic::AssertUnwindSafe(f))
        .map_err(|it| anyhow::anyhow!("{it:?}"));
    #[cfg(not(target_os = "macos"))]
    Ok(f())
}

fn run_deferred() -> Result<()> {
    AFTER_UPDATE
        .take()
        .into_iter()
        .try_for_each(|f| catch_exception(f)?)
}

fn app_event(name: &str, value: Value) {
    bridge::emit(json!({ "t": "app", "e": name, "v": value }));
}

fn start(options: Options) {
    let platform = native::platform(options.headless);
    let application =
        Application::with_platform(platform.clone()).with_quit_mode(QuitMode::Explicit);
    if options.accessory {
        platform.set_activation_policy(ActivationPolicy::Accessory);
    }
    application.on_open_urls(|urls| app_event("open-urls", json!(urls)));
    // The session is ending (Windows) or the display server is gone (Linux). JavaScript exits the process.
    platform.on_quit(Box::new(|| {
        if !IS_EXITING.get() {
            app_event("session-end", Value::Null);
            host::deliver_events(std::time::Duration::ZERO);
        }
        false
    }));
    host::start(platform, || {
        application.run_embedded(|cx| {
            native::launched();
            #[cfg(not(target_os = "macos"))]
            menu::init(cx);
            window::init(cx);
            observe_system(cx);
        })
    });
}

/// With `is_exiting`, the process is about to.
pub fn is_exiting() -> bool {
    IS_EXITING.get()
}

fn shut_down(is_exiting: bool) -> Result<()> {
    surface::clear();
    tray::destroy_all();
    HOTKEYS.take();
    ACTIVITIES.take();
    if host::is_started() {
        host::update(|cx| {
            window::ids()
                .into_iter()
                .try_for_each(|id| window::destroy(id, cx))
        })??;
    }
    if is_exiting {
        IS_EXITING.set(true);
        host::thread::will_stop();
        host::hand_over_clipboard();
    }
    bridge::clear();
    Ok(())
}

/// A command with a `reply` id answers through `bridge::reply`, unless it returns an error.
pub fn execute(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    log::info!("<- {name} {:.200}", arguments.to_string());
    run(name, arguments, reply).inspect_err(|error| log::warn!("{name} failed: {error:#}"))
}

fn run(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    match name.split_once('.') {
        Some(("surface", name)) => return surface::command(name, arguments),
        Some(("canvas", name)) => return canvas::command(name, arguments, reply),
        Some(("font", name)) => return text::command(name, arguments, reply),
        Some(("image", name)) => return images::command(name, arguments, reply),
        Some(("webview", name)) => return crate::webview::command(name, arguments),
        #[cfg(target_os = "macos")]
        Some(("defaults", _)) => return native::user_defaults(name, arguments),
        _ => {}
    }
    match name {
        "prewarm" => native::prewarm(),
        "start" if host::is_started() => {}
        "start" => start(Options::deserialize(arguments)?),
        "shutdown" => shut_down(arguments == true)?,
        "image" => return convert_image(arguments),
        "window.input" => {
            let state = window::state(arguments["id"].as_u64().unwrap_or(0) as u32)?;
            input::synthesize(&state, &arguments["value"])?;
        }
        _ => {
            let result =
                host::update(|cx| catch_exception(|| command(name, arguments, reply, cx))?)?;
            return run_deferred().and(result);
        }
    }
    Ok(Value::Null)
}

pub fn is_headless(cx: &App) -> bool {
    #[cfg(target_os = "macos")]
    if !native::is_launched() {
        return true;
    }
    cx.compositor_name() == "headless"
}

fn thermal_state(cx: &App) -> &'static str {
    match cx.thermal_state() {
        ThermalState::Nominal => "nominal",
        ThermalState::Fair => "fair",
        ThermalState::Serious => "serious",
        ThermalState::Critical => "critical",
    }
}

fn observe_system(cx: &mut App) {
    cx.on_system_sleep(|_| app_event("suspend", Value::Null))
        .detach();
    cx.on_system_wake(|_| app_event("resume", Value::Null))
        .detach();
    cx.on_thermal_state_change(|cx| app_event("thermal-state-change", thermal_state(cx).into()))
        .detach();
    cx.observe_displays(|event, _| {
        let (name, id) = match event {
            DisplayEvent::Added(id) => ("display-added", id),
            DisplayEvent::Removed(id) => ("display-removed", id),
            DisplayEvent::Changed { id, .. } => ("display-metrics-changed", id),
            _ => return,
        };
        app_event(name, u64::from(id).into());
    })
    .detach();
}

fn observe_notifications(cx: &mut App) {
    cx.on_system_notification_response(|response, _| {
        bridge::emit(json!({
            "t": "notification",
            "tag": response.tag,
            "action": response.action_id,
        }));
    });
}

pub fn rectangle(bounds: Bounds<Pixels>) -> Value {
    json!({
        "x": f32::from(bounds.origin.x),
        "y": f32::from(bounds.origin.y),
        "width": f32::from(bounds.size.width),
        "height": f32::from(bounds.size.height),
    })
}

fn string(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn number(value: &Value) -> f32 {
    value.as_f64().unwrap_or(0.) as f32
}

fn pair(value: &Value) -> Option<(f32, f32)> {
    Some((
        value.get(0)?.as_f64()? as f32,
        value.get(1)?.as_f64()? as f32,
    ))
}

/// Returns whether windows are dark now.
pub fn set_theme_source(source: &str, cx: &mut App) -> bool {
    let appearance = match source {
        "dark" => Some(WindowAppearance::Dark),
        "light" => Some(WindowAppearance::Light),
        _ => None,
    };
    APPEARANCE.set(appearance);
    cx.set_window_appearance(appearance);
    cx.refresh_windows();
    window::is_dark(cx.window_appearance())
}

fn command(name: &str, arguments: &Value, reply: Option<u64>, cx: &mut App) -> Result<Value> {
    if let Some(name) = name.strip_prefix("cover.") {
        return crate::cover::command(name, arguments, reply, cx);
    }
    let reply = || reply.context("the command needs a reply id");
    if let Some(name) = name.strip_prefix("window.") {
        return window_command(name, arguments, cx);
    }
    match name {
        "info" => {
            return Ok(json!({
                "compositor": cx.compositor_name(),
                "dark": window::is_dark(cx.window_appearance()),
                "thermalState": thermal_state(cx),
                "lowPower": cx.power_mode() == PowerMode::LowPower,
                "reduceMotion": cx.reduce_motion(),
            }));
        }
        "identity" => cx.set_app_identity(string(&arguments["id"]), string(&arguments["name"])),
        "activate" => cx.activate(arguments == true),
        "hide" => cx.hide(),
        "hideOthers" => cx.hide_other_apps(),
        "unhide" => cx.unhide_other_apps(),
        "activationPolicy" => cx.set_activation_policy(match string(arguments) {
            "regular" => ActivationPolicy::Regular,
            _ => ActivationPolicy::Accessory,
        }),
        "badge" => native::set_badge(string(&arguments["text"]), string(&arguments["appId"]))?,
        "recentDocument" => cx.add_recent_document(Path::new(string(arguments))),
        "themeSource" => {
            crate::cover::HAS_SET_THEME.set(false);
            return Ok(set_theme_source(string(arguments), cx).into());
        }
        #[cfg(target_os = "macos")]
        "applicationMenu" => menu::set_application_menu(arguments)?,
        #[cfg(target_os = "macos")]
        "dockMenu" => menu::set_dock_menu(arguments)?,
        #[cfg(not(target_os = "macos"))]
        "dockMenu" => menu::set_dock_menu(arguments, cx),
        #[cfg(target_os = "macos")]
        "popUpMenu" => {
            let handle = arguments["window"]
                .as_u64()
                .and_then(|id| window::handle(id as u32));
            let native = handle
                .context("the window is not open")?
                .update(cx, |_, window, _| NativeWindow::of(window))?;
            menu::pop_up(reply()?, native, arguments)?
        }
        #[cfg(target_os = "macos")]
        "popUpTrayMenu" => menu::pop_up_under(
            reply()?,
            tray::status_item(&arguments["tray"])?,
            &arguments["items"],
        )?,
        #[cfg(target_os = "macos")]
        "closePopUpMenu" => menu::close_popup(),
        #[cfg(target_os = "macos")]
        "spelling.check" | "spelling.guess" | "spelling.learn" => {
            let (command, text, reply) = (name.to_owned(), string(arguments).to_owned(), reply()?);
            after_update(move || {
                native::spelling(&command, &text, reply);
                Ok(())
            });
        }
        "tray" => return tray::command(arguments),
        "pickFiles" => dialog::pick_files(reply()?, arguments, cx)?,
        #[cfg(target_os = "macos")]
        "closeMessageBox" => after_update({
            let id = arguments.clone();
            move || {
                dialog::close_message_box(&id);
                Ok(())
            }
        }),
        "messageBox" => dialog::message_box(reply()?, arguments, cx)?,
        "openUrl" => cx.open_url(string(arguments)),
        "openPath" => cx.open_with_system(Path::new(string(arguments))),
        "revealPath" => cx.reveal_path(Path::new(string(arguments))),
        "trash" => {
            let path = PathBuf::from(string(arguments));
            bridge::in_background(reply()?, move || {
                #[cfg_attr(not(target_os = "macos"), expect(unused_mut))]
                let mut context = trash::TrashContext::default();
                #[cfg(target_os = "macos")]
                trash::macos::TrashContextExtMacos::set_delete_method(
                    &mut context,
                    trash::macos::DeleteMethod::NsFileManager,
                );
                context.delete(path).map_err(|error| anyhow!("{error}"))?;
                Ok(Value::Null)
            });
        }
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        "chromiumPassword" => {
            let arguments = arguments.clone();
            bridge::in_background(reply()?, move || {
                Ok(native::chromium_password(
                    string(&arguments["application"]),
                    string(&arguments["fresh"]),
                )?
                .into())
            });
        }
        #[cfg(target_os = "windows")]
        "protectData" => {
            let data = native::protect_data(
                blob(&arguments["blob"])?.to_vec(),
                arguments["protects"] == true,
            )?;
            return Ok(bridge::put_blob(data).into());
        }
        "registerUrlScheme" => {
            let (reply, task) = (reply()?, cx.register_url_scheme(string(arguments)));
            cx.foreground_executor()
                .spawn(async move { bridge::reply(reply, task.await.map(|()| Value::Null)) })
                .detach();
        }
        "notify" => {
            observe_notifications(cx);
            cx.show_system_notification(SystemNotification {
                tag: string(&arguments["tag"]).to_owned().into(),
                title: string(&arguments["title"]).to_owned().into(),
                body: string(&arguments["body"]).to_owned().into(),
                actions: (arguments["actions"].as_array().into_iter().flatten())
                    .enumerate()
                    .map(|(index, label)| SystemNotificationAction {
                        id: index.to_string().into(),
                        label: string(label).to_owned().into(),
                    })
                    .collect(),
            })
        }
        "dismissNotification" => cx.dismiss_system_notification(string(arguments)).detach(),
        #[cfg(target_os = "macos")]
        "readClipboard" => return Ok(native::read_clipboard(arguments == "text")),
        #[cfg(target_os = "macos")]
        "writeClipboard" => native::write_clipboard(arguments)?,
        #[cfg(not(target_os = "macos"))]
        "readClipboard" => return Ok(read_clipboard(arguments == "selection", cx)),
        #[cfg(not(target_os = "macos"))]
        "writeClipboard" => write_clipboard(arguments, cx)?,
        #[cfg(target_os = "macos")]
        "systemSettings" => return Ok(native::system_settings()),
        "displays" => return Ok(displays(cx)),
        "cursor" => return Ok(cursor_position(cx)),
        "idleSeconds" => return Ok(native::idle_seconds()?.into()),
        "onBattery" => return Ok(native::on_battery().into()),
        "preventSleep" => {
            let id = arguments["id"].as_u64().unwrap_or(0);
            let task = cx.prevent_idle_sleep(string(&arguments["reason"]));
            ACTIVITIES.with_borrow_mut(|guards| guards.insert(id, ActivityGuard::new(|| {})));
            cx.foreground_executor()
                .spawn(async move {
                    report(task.await.map(|guard| {
                        ACTIVITIES.with_borrow_mut(|guards| {
                            // Absent if it was released while the platform was asked.
                            if let Some(slot) = guards.get_mut(&id) {
                                *slot = guard;
                            }
                        })
                    }));
                })
                .detach();
        }
        "allowSleep" => {
            let id = arguments.as_u64().unwrap_or(0);
            ACTIVITIES.with_borrow_mut(|guards| guards.remove(&id));
        }
        "hotkey" => {
            return hotkey(
                string(&arguments["accelerator"]),
                arguments["on"] == true,
                cx,
            );
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        "opensAtLogin" => return Ok(native::opens_at_login(string(arguments))?.into()),
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        "setOpensAtLogin" => native::set_opens_at_login(
            string(&arguments["name"]),
            string(&arguments["command"]),
            arguments["on"] == true,
        )?,
        #[cfg(target_os = "macos")]
        "isTrustedAccessibilityClient" => {
            return Ok(native::is_trusted_accessibility_client(arguments == true).into());
        }
        #[cfg(target_os = "macos")]
        "applicationFor" => return Ok(json!(native::application_for(string(arguments)))),
        #[cfg(target_os = "macos")]
        "fileIcon" => {
            let icon = native::file_icon(string(&arguments[0]), number(&arguments[1]).into());
            return Ok(json!(icon.map(bridge::put_blob)));
        }
        #[cfg(target_os = "macos")]
        "observe" => native::observe(string(&arguments[0]), string(&arguments[1])),
        #[cfg(target_os = "macos")]
        "bounce" => return Ok(native::bounce(arguments)?.into()),
        #[cfg(target_os = "macos")]
        "isHidden" => return Ok(native::is_hidden().into()),
        #[cfg(target_os = "macos")]
        "sendAction" => {
            let action = string(arguments).to_owned();
            host::run_when_idle(move || bridge::report(native::send_action(&action)));
        }
        #[cfg(target_os = "macos")]
        "cancelQuit" => native::cancel_quit(),
        #[cfg(target_os = "macos")]
        "protocolHandler" => return Ok(json!(native::protocol_handler(string(arguments)))),
        #[cfg(target_os = "windows")]
        "protocolCommand" => return Ok(json!(native::protocol_command(string(arguments)))),
        #[cfg(target_os = "windows")]
        "setProtocolCommand" => native::set_protocol_command(
            string(&arguments["scheme"]),
            arguments["command"].as_str(),
        )?,
        _ => bail!("unknown command {name}"),
    }
    Ok(Value::Null)
}

fn hotkey(accelerator: &str, on: bool, cx: &App) -> Result<Value> {
    if !matches!(cx.compositor_name(), "" | "X11") {
        bail!("global shortcuts need X11");
    }
    static LISTEN: Once = Once::new();
    LISTEN.call_once(|| {
        GlobalHotKeyEvent::set_event_handler(Some(|event: GlobalHotKeyEvent| {
            if event.state() == HotKeyState::Pressed {
                bridge::emit(json!({ "t": "hotkey", "id": event.id() }));
            }
        }));
    });
    let hotkey: HotKey = accelerator.parse()?;
    HOTKEYS.with_borrow_mut(|manager| {
        let manager = match manager {
            Some(manager) => manager,
            None => manager.insert(native::GlobalHotKeyManager::new()?),
        };
        match on {
            true => manager.register(hotkey)?,
            false => manager.unregister(hotkey)?,
        }
        Ok(hotkey.id().into())
    })
}

fn convert_image(arguments: &Value) -> Result<Value> {
    let mut image = images::decode_still(&blob(&arguments["blob"])?)?;
    let side = |value: &Value| value.as_u64().unwrap_or(0).min(16384) as u32;
    if let Some([x, y, width, height]) = arguments["crop"].as_array().map(Vec::as_slice) {
        image = image.crop_imm(side(x), side(y), side(width), side(height));
    }
    if let Some([width, height]) = arguments["resize"].as_array().map(Vec::as_slice) {
        let filter = image::imageops::FilterType::Lanczos3;
        image = image.resize_exact(side(width).max(1), side(height).max(1), filter);
    }
    let mut encoded = Vec::new();
    match string(&arguments["format"]) {
        "png" => image.write_with_encoder(PngEncoder::new(&mut encoded))?,
        "rgba" => encoded = image.into_rgba8().into_raw(),
        "jpeg" => {
            let quality = number(&arguments["quality"]).clamp(1., 100.) as u8;
            let encoder = JpegEncoder::new_with_quality(&mut encoded, quality);
            image.to_rgb8().write_with_encoder(encoder)?
        }
        _ => return Ok(json!({ "width": image.width(), "height": image.height() })),
    }
    Ok(bridge::put_blob(encoded).into())
}

/// GPUI knows scale factors per window.
fn any_scale_factor(display: Option<gpui::DisplayId>, cx: &mut App) -> f32 {
    #[cfg(target_os = "macos")]
    if let Some(scale) = display.and_then(|id| native::scale_factor_of(id.into())) {
        return scale;
    }
    let scales = window::ids().into_iter().filter_map(|id| {
        window::update(id, cx, |window, cx| {
            (
                window.display(cx).map(|display| display.id()),
                window.scale_factor(),
            )
        })
        .ok()?
    });
    let scales: Vec<_> = scales.collect();
    let on_display = scales
        .iter()
        .find(|(id, _)| display.is_some() && *id == display);
    on_display
        .or(scales.first())
        .map_or(1., |(_, scale)| *scale)
}

fn displays(cx: &mut App) -> Value {
    let primary = cx.primary_display().map(|display| display.id());
    let displays = cx.displays().into_iter().map(|display| {
        json!({
            "id": u64::from(display.id()),
            "primary": Some(display.id()) == primary,
            "bounds": rectangle(display.bounds()),
            "workArea": rectangle(display.visible_bounds()),
            "scaleFactor": any_scale_factor(Some(display.id()), cx),
            "displayFrequency": display
                .refresh_interval()
                .map_or(0., |interval| (1. / interval.as_secs_f64()).round()),
        })
    });
    Value::Array(displays.collect())
}

fn cursor_position(cx: &mut App) -> Value {
    let scale = any_scale_factor(None, cx);
    let in_active_window = |cx: &mut App| {
        let position = cx.active_window()?.update(cx, |_, window, _| {
            window.bounds().origin + window.mouse_position()
        });
        position.ok().map(|at| (at.x.into(), at.y.into()))
    };
    let (x, y) = native::cursor_position(scale)
        .or_else(|| in_active_window(cx))
        .unwrap_or_default();
    json!({ "x": x, "y": y })
}

fn set_visible(id: u32, visible: bool, focus: bool, cx: &mut App) -> Result<()> {
    let native = window::update(id, cx, |window, _| NativeWindow::of(window))?;
    if let Some(native) = native.filter(|native| native.can_hide()) {
        after_update(move || {
            #[cfg(target_os = "macos")]
            match visible {
                true => window::draw_before_showing(id),
                false => window::was_hidden(id),
            }
            native.set_visible(visible, focus)?;
            window::request_frame(id);
            Ok(())
        });
    } else if !visible {
        window::close_platform_window(id, cx)?;
    } else if window::handle(id).is_none() {
        let state = window::state(id)?;
        let mut options = state.options.borrow_mut();
        (options.show, options.focus) = (true, focus);
        drop(options);
        window::open(id, cx)?;
    }
    if visible && focus && !cfg!(target_os = "macos") {
        after_update(move || {
            host::update(|cx| window::update(id, cx, |window, _| window.activate_window()))?
                .map(drop)
        });
    }
    Ok(())
}

fn window_command(name: &str, arguments: &Value, cx: &mut App) -> Result<Value> {
    if name == "create" {
        window::create(window::Options::deserialize(arguments)?, cx)?;
        return Ok(Value::Null);
    }
    let id = arguments["id"].as_u64().unwrap_or(0) as u32;
    let value = &arguments["value"];
    let state = window::state(id)?;
    let on = value == true;
    match name {
        "destroy" => return window::destroy(id, cx).map(|()| Value::Null),
        "show" => return set_visible(id, true, on, cx).map(|()| Value::Null),
        "hide" => return set_visible(id, false, false, cx).map(|()| Value::Null),
        "title" => state.options.borrow_mut().title = string(value).to_owned(),
        "backgroundColor" => {
            state.options.borrow_mut().background_color = value.as_u64().map(|color| color as u32)
        }
        "overlay" => {
            let overlay = Option::deserialize(value)?;
            match state.cover.get() {
                Some(_) => crate::cover::NEXT_OVERLAY.set(Some(overlay)),
                None => state.options.borrow_mut().overlay = overlay,
            }
            let insets = window::update(id, cx, |window, cx| {
                window.refresh();
                frame::overlay_insets(window, cx)
            });
            return Ok(json!(insets?));
        }
        "background" => state.options.borrow_mut().background = string(value).to_owned(),
        "limits" => {
            let mut options = state.options.borrow_mut();
            (options.min_width, options.min_height) = pair(&value["min"]).unwrap_or_default();
            options.resizable = value["resizable"] == true;
        }
        "position" | "size" if window::handle(id).is_none() => {
            let (a, b) = pair(value).context("expected two numbers")?;
            let mut options = state.options.borrow_mut();
            match name {
                "position" => (options.x, options.y) = (Some(a), Some(b)),
                _ => {
                    (options.width, options.height) = (a, b);
                    state.resize(a, b);
                }
            }
        }
        "geometry" if window::handle(id).is_none() => {
            let options = state.options.borrow();
            return Ok(json!({
                "x": options.x.unwrap_or(0.),
                "y": options.y.unwrap_or(0.),
                "width": options.width,
                "height": options.height,
                "maximized": options.maximized,
                "fullscreen": options.fullscreen,
                "scale": 1,
            }));
        }
        _ => {}
    }
    let result = window::update(id, cx, |window, cx| {
        platform_window_command(
            name,
            value,
            #[cfg(target_os = "macos")]
            &state,
            window,
            cx,
        )
    })?;
    result.unwrap_or(Ok(Value::Null))
}

fn platform_window_command(
    name: &str,
    value: &Value,
    #[cfg(target_os = "macos")] state: &window::WindowState,
    window: &mut Window,
    cx: &mut App,
) -> Result<Value> {
    let on = value == true;
    let native = NativeWindow::of(window);
    match name {
        "geometry" => return Ok(window::geometry(window)),
        "mouse" => {
            let position = window.mouse_position();
            return Ok(json!([f32::from(position.x), f32::from(position.y)]));
        }
        "isMinimized" => return Ok(native.is_minimized().into()),
        "isFocused" => return Ok(window.is_window_active().into()),
        #[cfg(target_os = "macos")]
        "lookUp" => {
            let (text, at) = (string(value).to_owned(), window.mouse_position());
            host::run_when_idle(move || native.look_up(&text, at.x.into(), at.y.into()));
        }
        #[cfg(target_os = "macos")]
        "windowNumber" => return Ok(native.window_number().into()),
        "handle" => return Ok(native.handle().to_string().into()),
        "title" => window.set_window_title(string(value)),
        "background" => {
            window.set_background_appearance(window::background_appearance(string(value)));
            #[cfg(target_os = "macos")]
            native.set_background(&state.options.borrow())?;
        }
        #[cfg(target_os = "macos")]
        "backgroundColor" => native.set_background(&state.options.borrow())?,
        #[cfg(target_os = "macos")]
        "size" | "bounds" | "style" | "parent" | "sheet" | "moveTop" | "focus"
            if !is_headless(cx) =>
        {
            let parent = value.as_u64().and_then(|id| window::handle(id as u32));
            let parent =
                parent.and_then(|it| it.update(cx, |_, window, _| NativeWindow::of(window)).ok());
            let (name, value) = (name.to_owned(), value.clone());
            let id = state.options.borrow().id;
            after_update(move || {
                if name == "sheet" {
                    window::draw_before_showing(id);
                }
                native.command(&name, &value, parent)
            });
        }
        "size" => {
            let (width, height) = pair(value).context("expected two numbers")?;
            window.resize(size(px(width), px(height)));
            if is_headless(cx) {
                window.bounds_changed(cx);
            }
        }
        "position" => {
            let (x, y) = pair(value).context("expected two numbers")?;
            after_update(move || native.set_position(x, y));
        }
        "limits" => {
            let (min, max) = (pair(&value["min"]).unwrap_or_default(), pair(&value["max"]));
            let resizable = value["resizable"] == true;
            after_update(move || native.set_size_limits(min, max, resizable));
        }
        "focus" => window.activate_window(),
        "minimize" => window.minimize_window(),
        "restore" => {
            after_update(move || native.restore());
            #[cfg(not(target_os = "macos"))]
            window.activate_window();
        }
        #[cfg(target_os = "macos")]
        "maximize" if window.is_maximized() != on && !is_headless(cx) => {
            after_update(move || native.zoom())
        }
        "maximize" if window.is_maximized() != on => window.zoom_window(),
        "fullscreen" if window.is_fullscreen() != on => window.toggle_fullscreen(),
        "simpleFullscreen" if window.is_simple_fullscreen() != on => {
            window.toggle_simple_fullscreen()
        }
        "alwaysOnTop" => after_update(move || native.set_always_on_top(on)),
        "skipTaskbar" => after_update(move || native.set_skip_taskbar(on)),
        "allWorkspaces" => after_update(move || native.set_visible_on_all_workspaces(on)),
        "contentProtection" => after_update(move || native.set_content_protection(on)),
        "opacity" => {
            let opacity = number(value).clamp(0., 1.);
            after_update(move || native.set_opacity(opacity));
        }
        "ignoreMouseEvents" => {
            window.set_input_region(on.then_some(&[]));
            after_update(move || native.set_ignore_mouse_events(on));
        }
        "attention" => window.request_attention(),
        "beep" => window.play_system_bell(),
        "edited" => window.set_window_edited(on),
        "representedFilename" => window.set_document_path(
            value
                .as_str()
                .filter(|path| !path.is_empty())
                .map(Path::new),
        ),
        #[cfg(target_os = "macos")]
        "trafficLightPosition" => {
            let (x, y) = pair(value).context("expected two numbers")?;
            window.set_traffic_light_position(gpui::point(px(x), px(y)));
        }
        "characterPalette" => window.show_character_palette(),
        _ => {}
    }
    window.refresh();
    Ok(Value::Null)
}
