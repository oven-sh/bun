#[cfg_attr(
    any(target_os = "macos", target_os = "windows"),
    path = "tray/tray_icon.rs"
)]
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows")),
    path = "tray/status_notifier.rs"
)]
mod platform;

use std::cell::RefCell;

use anyhow::{Context as _, Result};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::bridge;

thread_local! {
    static TRAYS: RefCell<FxHashMap<u32, platform::Tray>> = RefCell::default();
}

fn emit(id: u32, event: &str, x: f64, y: f64) {
    bridge::emit(json!({ "t": "tray", "id": id, "e": event, "x": x, "y": y }));
}

fn icon(value: &Value) -> Result<image::RgbaImage> {
    let bytes = value
        .as_u64()
        .and_then(|blob| bridge::take_blob(blob as u32))
        .context("the tray icon is missing")?;
    let decoded = image::load_from_memory(&bytes).context("could not decode the tray icon")?;
    Ok(decoded.into_rgba8())
}

pub fn destroy_all() {
    TRAYS.take();
}

#[cfg(target_os = "macos")]
pub fn status_item(id: &Value) -> Result<objc2::rc::Retained<objc2_app_kit::NSStatusItem>> {
    let item = TRAYS.with_borrow(|trays| trays.get(&(id.as_u64()? as u32))?.status_item());
    item.context("the tray icon was destroyed")
}

pub fn command(arguments: &Value) -> Result<Value> {
    let id = arguments["id"].as_u64().unwrap_or(0) as u32;
    let (operation, value) = (arguments["op"].as_str().unwrap_or(""), &arguments["value"]);
    let template = arguments["template"] == true;
    TRAYS.with_borrow_mut(|trays| {
        if operation == "create" {
            let name = arguments["name"].as_str().unwrap_or("");
            let tray = platform::Tray::new(id, name, icon(value)?, template)?;
            #[cfg(target_os = "macos")]
            tray.set_icon_size(&arguments["size"]);
            trays.insert(id, tray);
            return Ok(Value::Null);
        }
        if operation == "destroy" {
            trays.remove(&id);
            return Ok(Value::Null);
        }
        let tray = trays.get_mut(&id).context("the tray icon was destroyed")?;
        match operation {
            "image" => {
                tray.set_icon(icon(value)?, template)?;
                #[cfg(target_os = "macos")]
                tray.set_icon_size(&arguments["size"]);
            }
            "tooltip" => tray.set_tooltip(value.as_str().unwrap_or(""))?,
            "title" => tray.set_title(value.as_str().unwrap_or(""))?,
            "menu" => tray.set_menu(value)?,
            _ => return Ok(json!(tray.bounds())),
        }
        Ok(Value::Null)
    })
}
