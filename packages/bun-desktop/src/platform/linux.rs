//! Linux and FreeBSD.

mod atspi;
mod cursors;
mod dbus;
mod desktop;
mod formats;
mod ibus;
mod keysyms;
mod shortcuts;
mod socket;
mod tray;
mod typing;
mod wayland;
mod x11;

use std::cell::Cell;

pub use self::keysyms::keysym_to_char;
use super::{Display, Platform, WindowButton};
use crate::bridge;
use crate::error::Result;
use crate::protocol::SystemEvent;

pub fn start(_is_accessory: bool) -> Result<Box<dyn Platform>> {
    let is_x11 = |variable| std::env::var(variable).as_deref() == Ok("x11");
    let wants_x11 = is_x11("BUN_DESKTOP_BACKEND")
        || is_x11("XDG_SESSION_TYPE")
        || std::env::args_os().any(|it| it == "--ozone-platform=x11");
    if wants_x11 || std::env::var_os("WAYLAND_DISPLAY").is_none_or(|it| it.is_empty()) {
        return x11::start();
    }
    wayland::start().or_else(|error| {
        crate::diagnostics::log!("Wayland is not used: {error:#}");
        x11::start().map_err(|_| error)
    })
}

fn tell_settings() {
    thread_local! {
        static TOLD: Cell<[bool; 2]> = Cell::default();
    }
    let Ok(platform) = crate::host::platform() else {
        return;
    };
    let settings = platform.settings();
    let now = [settings.more_contrast, platform.state().reduces_motion];
    if TOLD.replace(now) != now {
        bridge::emit_system(SystemEvent::Settings(settings));
    }
}

/// For a layout like `close:minimize,maximize`.
fn buttons(layout: &str) -> [Vec<WindowButton>; 2] {
    let (left, right) = layout.split_once(':').unwrap_or((layout, ""));
    let button = |name: &str| match name.trim() {
        "minimize" => Some(WindowButton::Minimize),
        "maximize" => Some(WindowButton::Maximize),
        "close" => Some(WindowButton::Close),
        _ => None,
    };
    [left, right].map(|side| side.split(',').filter_map(button).collect())
}

fn displays_changed(before: &[Display], now: &[Display]) {
    let metrics = |it: &Display| (it.bounds, it.work_area, it.scale, it.frequency);
    for display in now {
        match before.iter().find(|it| it.id == display.id) {
            None => bridge::emit_system(SystemEvent::DisplayAdded(display.id)),
            Some(old) if metrics(old) != metrics(display) => {
                bridge::emit_system(SystemEvent::DisplayChanged(display.id))
            }
            Some(_) => {}
        }
    }
    for display in before
        .iter()
        .filter(|old| now.iter().all(|it| it.id != old.id))
    {
        bridge::emit_system(SystemEvent::DisplayRemoved(display.id));
    }
}
