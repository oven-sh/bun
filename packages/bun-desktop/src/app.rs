//! Executes what JavaScript asks for.

use std::cell::{Cell, RefCell};

use crate::abi::Rect;
use crate::bridge::{self, blob};
use crate::error::{Context as _, Result};
use crate::json::{Deserialize as _, Value, json};
use crate::platform::{self, Display};
use crate::{canvas, frame, host, images, input, surface, text, window};

thread_local! {
    static AFTER_COMMAND: RefCell<Vec<Box<dyn FnOnce()>>> = RefCell::default();
    static IS_EXITING: Cell<bool> = const { Cell::new(false) };
    static SYSTEM_IS_DARK: Cell<Option<bool>> = const { Cell::new(None) };
    static IS_DARK: Cell<Option<bool>> = const { Cell::new(None) };
}

pub fn after_command(f: impl FnOnce() + 'static) {
    AFTER_COMMAND.with_borrow_mut(|deferred| deferred.push(Box::new(f)));
}

/// open-urls, suspend, resume, thermal-state-change, display-added, -removed and -metrics-changed, and so on.
#[cfg(not(target_os = "macos"))]
pub fn event(name: &str, value: Value) {
    bridge::emit(json!({ "t": "app", "e": name, "v": value }));
}

/// The display server is gone. JavaScript exits the process.
#[cfg(not(target_os = "macos"))]
pub fn session_ended() {
    if !IS_EXITING.get() {
        event("session-end", Value::Null);
    }
}

/// The process is about to.
pub fn is_exiting() -> bool {
    IS_EXITING.get()
}

fn shut_down(is_exiting: bool) -> Result<()> {
    surface::clear();
    window::ids().into_iter().try_for_each(window::destroy)?;
    AFTER_COMMAND.take();
    if is_exiting {
        IS_EXITING.set(true);
        host::thread::will_stop();
    }
    if let Ok(platform) = host::platform() {
        platform.shut_down(is_exiting);
    }
    bridge::clear();
    Ok(())
}

/// A command with a `reply` id answers through `bridge::reply`, unless it returns an error.
pub fn execute(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    crate::diagnostics::log!("<- {name} {:.200}", arguments.to_string());
    run(name, arguments, reply)
        .inspect_err(|error| crate::diagnostics::log!("{name} failed: {error:#}"))
}

fn run(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    match name.split_once('.') {
        Some(("surface", name)) => return surface::command(name, arguments),
        Some(("canvas", name)) => return canvas::command(name, arguments, reply),
        Some(("font", name)) => return text::command(name, arguments, reply),
        Some(("image", name)) => return images::command(name, arguments, reply),
        Some(("webview", name)) => return crate::webview::command(name, arguments),
        #[cfg(target_os = "macos")]
        Some(("defaults" | "keychain", _)) => {
            return platform::macos::command(name, arguments, reply);
        }
        _ => {}
    }
    match name {
        "prewarm" => {}
        "start" => {
            if host::platform().is_err() {
                host::start(platform::start(
                    arguments["headless"] == true,
                    arguments["accessory"] == true,
                )?);
            }
            // A launch cover does not wait.
            #[cfg(target_os = "macos")]
            if host::thread::is_answering() && !is_headless() {
                platform::macos::finish_launching();
            }
        }
        "shutdown" => shut_down(arguments == true)?,
        "image" => return convert_image(arguments),
        "window.input" => {
            let state = window::state(arguments["id"].as_u64().unwrap_or(0) as u32)?;
            input::synthesize(&state, &arguments["value"])?;
        }
        _ => {
            let result = command(name, arguments, reply);
            AFTER_COMMAND.take().into_iter().for_each(|f| f());
            return result;
        }
    }
    Ok(Value::Null)
}

pub fn is_headless() -> bool {
    host::platform().is_ok_and(|platform| platform.name() == "headless")
}

pub fn is_dark() -> bool {
    IS_DARK.get().or(SYSTEM_IS_DARK.get()).unwrap_or_else(|| {
        let is_dark = host::platform().is_ok_and(|platform| platform.is_dark());
        SYSTEM_IS_DARK.set(Some(is_dark));
        is_dark
    })
}

pub fn forget_appearance() {
    SYSTEM_IS_DARK.set(None);
}

pub fn displays() -> Vec<Display> {
    host::platform()
        .map(|platform| platform.displays())
        .unwrap_or_default()
}

pub fn rectangle(rect: Rect) -> Value {
    json!({ "x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height })
}

fn string(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn number(value: &Value) -> f32 {
    value.as_f64().unwrap_or(0.) as f32
}

/// Returns whether windows are dark now.
pub fn set_theme_source(source: &str) -> bool {
    IS_DARK.set(matches!(source, "dark" | "light").then_some(source == "dark"));
    if let Ok(platform) = host::platform() {
        platform.set_dark(IS_DARK.get());
    }
    forget_appearance();
    window::ids().into_iter().for_each(window::refresh);
    is_dark()
}

fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    let platform = host::platform()?;
    if let Some(name) = name.strip_prefix("cover.") {
        return crate::cover::command(name, arguments, reply);
    }
    if let Some(name) = name.strip_prefix("window.") {
        return window_command(name, arguments);
    }
    match name {
        "info" => {
            let mut info = platform.command(name, arguments, reply)?;
            info["compositor"] = platform.name().into();
            info["dark"] = is_dark().into();
            Ok(info)
        }
        "themeSource" => {
            crate::cover::HAS_SET_THEME.set(false);
            Ok(set_theme_source(string(arguments)).into())
        }
        "displays" => {
            let describe = |(index, display): (usize, Display)| {
                json!({
                    "id": display.id,
                    "primary": index == 0,
                    "bounds": rectangle(display.bounds),
                    "workArea": rectangle(display.work_area),
                    "scaleFactor": display.scale,
                    "displayFrequency": display.frequency.round(),
                })
            };
            Ok(Value::Array(
                displays().into_iter().enumerate().map(describe).collect(),
            ))
        }
        _ => platform.command(name, arguments, reply),
    }
}

fn convert_image(arguments: &Value) -> Result<Value> {
    let mut image = images::decode_still(&blob(&arguments["blob"])?)?;
    let side = |value: &Value| value.as_u64().unwrap_or(0).min(16384) as u32;
    if let Some([x, y, width, height]) = arguments["crop"].as_array().map(Vec::as_slice) {
        image = image.cropped([x, y, width, height].map(side));
    }
    if let Some([width, height]) = arguments["resize"].as_array().map(Vec::as_slice) {
        image = image
            .resized(side(width).max(1), side(height).max(1))
            .context("the image is empty")?;
    }
    let encoded = match string(&arguments["format"]) {
        "png" => image.to_png(),
        "rgba" => Some(image.data),
        "jpeg" => image.to_jpeg(number(&arguments["quality"]).clamp(1., 100.) as u8),
        _ => return Ok(json!({ "width": image.width, "height": image.height })),
    };
    Ok(bridge::put_blob(encoded.context("the image is empty")?).into())
}

fn window_command(name: &str, arguments: &Value) -> Result<Value> {
    if name == "create" {
        window::create(window::Options::deserialize(arguments)?)?;
        return Ok(Value::Null);
    }
    let id = arguments["id"].as_u64().unwrap_or(0) as u32;
    let value = &arguments["value"];
    let (state, window) = (
        window::state(id)?,
        window::platform_window(id).context("the window is not open")?,
    );
    match name {
        "destroy" => return window::destroy(id).map(|()| Value::Null),
        "show" | "hide" => {
            window::set_visible(id, name == "show", value == true);
            return Ok(Value::Null);
        }
        "geometry" => return Ok(window::describe(&window.geometry())),
        "mouse" => {
            return Ok(json!([
                window.mouse_position().x,
                window.mouse_position().y
            ]));
        }
        "isFocused" => return Ok(window.is_active().into()),
        "handle" => return Ok(window.handle().to_string().into()),
        "isMinimized" | "windowNumber" => return window.command(name, value, None),
        "overlay" => {
            let overlay = Option::deserialize(value)?;
            match state.cover.get() {
                Some(_) => crate::cover::NEXT_OVERLAY.set(Some(overlay)),
                None => state.options.borrow_mut().overlay = overlay,
            }
            window::refresh(id);
            return Ok(json!(frame::overlay_insets(&state.options.borrow())));
        }
        "title" => state.options.borrow_mut().title = string(value).to_owned(),
        "backgroundColor" => {
            state.options.borrow_mut().background_color = value.as_u64().map(|color| color as u32)
        }
        "background" => state.options.borrow_mut().background = string(value).to_owned(),
        "limits" => {
            let mut options = state.options.borrow_mut();
            (options.min_width, options.min_height) =
                (number(&value["min"][0]), number(&value["min"][1]));
            options.resizable = value["resizable"] == true;
        }
        "sheet" => window::draw_before_showing(id),
        _ => {}
    }
    let other = value
        .as_u64()
        .filter(|_| matches!(name, "parent" | "sheet"));
    let other = other.and_then(|id| window::platform_window(id as u32));
    let result = window.command(name, value, other.as_deref());
    window::refresh(id);
    result
}
