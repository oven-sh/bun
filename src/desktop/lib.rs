//! The modules `bun:desktop` and `bun:desktop/electron`, in the process of the app.

#[macro_use]
mod js;
#[macro_use]
mod value;

mod accelerator;
mod app;
mod bridge;
mod browser_window;
#[cfg(unix)]
mod bundle;
mod cipher;
mod clipboard;
mod command_line;
mod contents;
mod cover;
#[cfg_attr(
    not(any(target_os = "linux", target_os = "macos", windows)),
    path = "no_crash_reporter.rs"
)]
mod crash_reporter;
mod devtools;
mod dialog;
mod drawn_menus;
mod files;
mod generated_bindgen;
mod ipc;
mod menu;
mod menu_order;
mod modules;
mod notification;
mod os_crypt;
mod page_host;
mod page_window;
mod paths;
mod ports;
mod power;
mod preferences;
mod process;
mod realm;
#[cfg_attr(unix, path = "xdg.rs")]
#[cfg_attr(windows, path = "registry.rs")]
mod registration;
mod renderer;
mod roles;
mod safe_storage;
mod screen;
mod secrets;
mod session;
mod shell;
mod shortcuts;
mod single_instance;
mod task;
mod taskbar;
mod text;
mod theme;
mod touch_bar;
mod tracing;
mod tray;
mod unsupported;
#[cfg_attr(windows, path = "squirrel.rs")]
mod updater;
mod utility;
mod view;
mod webview;
#[cfg(windows)]
mod win32;
mod window;

const IS_MAC: bool = cfg!(target_os = "macos");
const IS_WINDOWS: bool = cfg!(windows);
const HAS_SPELL_CHECKER: bool = IS_MAC || IS_WINDOWS;

mod prelude {
    pub(crate) use core::cell::{Cell, RefCell};

    pub(crate) use bun_jsc::bindgen::{
        Callable, ClassStructure, JsHeap, JsInterface, JsList, JsLocal,
    };
    pub(crate) use bun_jsc::strong::StrongCell;
    pub(crate) use bun_jsc::{JSObject, JSValue, JsClass as _, JsResult};
    pub(crate) use bun_ui::Rect;
    pub(crate) use bun_ui::image::NativeImage;
    pub(crate) use bun_ui::protocol::{
        Command, Maybe, Point, ShellCommand, Size, SystemCommand, Text,
    };
    pub(crate) use bun_ui::value::{IntoJs, finite};
    pub(crate) use bun_ui::{later, state};

    pub(crate) use crate::js::*;
    pub(crate) use crate::text::string;
    pub(crate) use crate::{HAS_SPELL_CHECKER, IS_MAC, IS_WINDOWS};
}
