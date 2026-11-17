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
mod preload;
mod process;
mod realm;
mod roles;
mod safe_storage;
mod screen;
mod secrets;
mod session;
mod shell;
mod shortcuts;
mod single_instance;
mod task;
mod text;
mod theme;
mod tray;
mod unsupported;
#[cfg_attr(not(unix), path = "no_updater.rs")]
mod updater;
mod utility;
mod view;
mod webview;
mod window;
mod xdg;

const IS_MAC: bool = cfg!(target_os = "macos");

mod prelude {
    pub(crate) use core::cell::{Cell, RefCell};

    pub(crate) use bun_jsc::bindgen::{
        Callable, ClassStructure, JsHeap, JsInterface, JsList, JsLocal,
    };
    pub(crate) use bun_jsc::strong::StrongCell;
    pub(crate) use bun_jsc::{JSObject, JSValue, JsClass as _, JsResult};
    pub(crate) use bun_ui::Rect;
    pub(crate) use bun_ui::image::NativeImage;
    pub(crate) use bun_ui::protocol::{Command, Maybe, Point, Size, SystemCommand, Text};
    pub(crate) use bun_ui::value::{IntoJs, finite};
    pub(crate) use bun_ui::{later, state};

    pub(crate) use crate::IS_MAC;
    pub(crate) use crate::js::*;
    pub(crate) use crate::text::string;
}
