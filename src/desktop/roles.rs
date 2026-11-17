//! What the `role` of a menu item stands for.

use bun_ui::protocol::{MenuRole, WindowCommand};

use crate::generated_bindgen::window::DesktopWindow;
use crate::prelude::*;
use crate::window::Window;
use crate::{app, paths};

#[derive(Clone, Copy)]
enum Action {
    Nothing,
    /// A method of `webContents`.
    Page(&'static str),
    /// In, out, or neither.
    Zoom(i8),
    Window(fn(&Window) -> JsResult<()>),
    App(fn() -> JsResult<()>),
    /// For the first responder.
    Selector(&'static str),
    /// `-` is a separator.
    Submenu(fn() -> &'static [&'static str]),
}

pub(crate) struct Role {
    pub(crate) name: &'static str,
    /// `%` is the name of the app.
    label: &'static str,
    pub(crate) accelerator: Option<&'static str>,
    pub(crate) native: MenuRole,
    action: Action,
}

const fn by_platform<T: Copy>(mac: T, other: T) -> T {
    if IS_MAC { mac } else { other }
}

macro_rules! roles {
    ($($name:literal, $label:expr, $accelerator:expr, $native:ident, $action:expr;)*) => {
        static ROLES: &[Role] = {
            use Action::*;
            &[$(Role {
                name: $name,
                label: $label,
                accelerator: $accelerator,
                native: MenuRole::$native,
                action: $action,
            }),*]
        };
    };
}

roles! {
    "undo", "Undo", Some("CommandOrControl+Z"), Undo, Page("undo");
    "redo", "Redo", Some("Shift+CommandOrControl+Z"), Redo, Page("redo");
    "cut", "Cut", Some("CommandOrControl+X"), Cut, Page("cut");
    "copy", "Copy", Some("CommandOrControl+C"), Copy, Page("copy");
    "paste", "Paste", Some("CommandOrControl+V"), Paste, Page("paste");
    "pasteandmatchstyle", "Paste and Match Style",
        Some(by_platform("Cmd+Option+Shift+V", "Shift+CommandOrControl+V")), None, Page("pasteAndMatchStyle");
    "delete", "Delete", None, None, Page("delete");
    "selectall", "Select All", Some("CommandOrControl+A"), SelectAll, Page("selectAll");
    "reload", "Reload", Some("CmdOrCtrl+R"), None, Page("reload");
    "forcereload", "Force Reload", Some("Shift+CmdOrCtrl+R"), None, Page("reloadIgnoringCache");
    "toggledevtools", "Toggle Developer Tools", Some(by_platform("Alt+Command+I", "Ctrl+Shift+I")), None,
        Page("toggleDevTools");
    "togglespellchecker", "Check Spelling While Typing", None, None, Selector("toggleContinuousSpellChecking:");
    "resetzoom", "Actual Size", Some("CommandOrControl+0"), None, Zoom(0);
    "zoomin", "Zoom In", Some("CommandOrControl+="), None, Zoom(1);
    "zoomout", "Zoom Out", Some("CommandOrControl+-"), None, Zoom(-1);
    "close", by_platform("Close Window", "Close"), Some("CommandOrControl+W"), Close, Window(|it| it.request_close());
    "minimize", "Minimize", Some("CommandOrControl+M"), Minimize, Window(|it| it.tell(WindowCommand::Minimize));
    "zoom", "Zoom", None, None, Window(|it| it.zoom_frame(!it.fills_work_area()?));
    "togglefullscreen", "Toggle Full Screen", Some(by_platform("Control+Command+F", "F11")), None,
        Window(|it| it.tell(WindowCommand::Fullscreen(!it.fills_screen()?)));
    "quit", by_platform("Quit %", "Quit"), Some("CommandOrControl+Q"), None, App(app::quit);
    "about", "About %", None, None, App(|| app::show_about_panel().map(drop));
    "hide", "Hide %", Some("Command+H"), None, App(app::hide);
    "hideothers", "Hide Others", Some("Command+Alt+H"), None, App(|| tell_system(SystemCommand::HideOthers));
    "unhide", "Show All", None, None, App(|| tell_system(SystemCommand::Unhide));
    "front", "Bring All to Front", None, None, App(|| app::activate(true));
    "clearrecentdocuments", "Clear Menu", None, None, App(app::clear_recent_documents);
    "recentdocuments", "Open Recent", None, None, Nothing;
    "services", "Services", None, Services, Nothing;
    "sharemenu", "Share", None, None, Nothing;
    "window", "Window", None, Window, Nothing;
    "help", "Help", None, Help, Nothing;
    "startspeaking", "Start Speaking", None, None, Selector("startSpeaking:");
    "stopspeaking", "Stop Speaking", None, None, Selector("stopSpeaking:");
    "showsubstitutions", "Show Substitutions", None, None, Selector("orderFrontSubstitutionsPanel:");
    "togglesmartquotes", "Smart Quotes", None, None, Selector("toggleAutomaticQuoteSubstitution:");
    "togglesmartdashes", "Smart Dashes", None, None, Selector("toggleAutomaticDashSubstitution:");
    "toggletextreplacement", "Text Replacement", None, None, Selector("toggleAutomaticTextReplacement:");
    "toggletabbar", "Show Tab Bar", None, None, Selector("toggleTabBar:");
    "selectnexttab", "Show Next Tab", None, None, Selector("selectNextTab:");
    "selectprevioustab", "Show Previous Tab", None, None, Selector("selectPreviousTab:");
    "showalltabs", "Show All Tabs", None, None, Selector("toggleTabOverview:");
    "mergeallwindows", "Merge All Windows", None, None, Selector("mergeAllWindows:");
    "movetabtonewwindow", "Move Tab to New Window", None, None, Selector("moveTabToNewWindow:");
    "appmenu", "%", None, None,
        Submenu(|| &["about", "-", "services", "-", "hide", "hideOthers", "unhide", "-", "quit"]);
    "filemenu", "File", None, None, Submenu(|| by_platform(&["close"], &["quit"]));
    "editmenu", "Edit", None, None, Submenu(|| match app::is_electron() {
        true if IS_MAC => &["undo", "redo", "-", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"],
        true => &["undo", "redo", "-", "cut", "copy", "paste", "delete", "-", "selectAll"],
        false => &["undo", "redo", "-", "cut", "copy", "paste", "-", "selectAll"],
    });
    "viewmenu", "View", None, None, Submenu(|| {
        let all = &[
            "reload", "forceReload", "toggleDevTools", "-", "resetZoom", "zoomIn", "zoomOut", "-", "togglefullscreen",
        ];
        if app::is_electron() { all } else { &all[4..] }
    });
    "windowmenu", "Window", None, Window,
        Submenu(|| by_platform(&["minimize", "zoom", "-", "front"], &["minimize", "zoom", "close"]));
}

/// Where the user is, in a window that shows `webContents`.
fn contents_in(window: &Window) -> JsResult<Option<JSValue>> {
    Ok(Some(crate::contents::to_edit(window.to_js())?).filter(|it| it.is_object()))
}

pub(crate) fn tell_page(window: &Window, method: &str) -> JsResult<()> {
    match window.downcast::<DesktopWindow>() {
        Some(window) => window.edit(method),
        None => contents_in(window)?.map_or(Ok(()), |it| invoke(it, method, &[]).map(drop)),
    }
}

fn zoom(window: &Window, step: i8) -> JsResult<()> {
    if let Some(window) = window.downcast::<DesktopWindow>() {
        let factor = (window.get_zoom_factor() * 1.1_f64.powi(step.into())).clamp(0.3, 5.);
        return window.change_zoom(if step == 0 { 1. } else { factor });
    }
    let Some(contents) = contents_in(window)? else {
        return Ok(());
    };
    let level = invoke(contents, "getZoomLevel", &[])?.to_number(global())? + f64::from(step) / 2.;
    invoke(
        contents,
        "setZoomLevel",
        &[js(if step == 0 { 0. } else { level })?],
    )
    .map(drop)
}

impl Role {
    pub(crate) fn named(name: &str) -> Option<&'static Role> {
        ROLES.iter().find(|it| it.name.eq_ignore_ascii_case(name))
    }

    pub(crate) fn label(&self) -> JsResult<String> {
        Ok(match self.label.strip_suffix('%') {
            Some(start) => format!("{start}{}", paths::app_name()?),
            None => self.label.into(),
        })
    }

    pub(crate) fn submenu(&self) -> Option<&'static [&'static str]> {
        match self.action {
            Action::Submenu(roles) => Some(roles()),
            _ => None,
        }
    }

    pub(crate) fn is_available(&self) -> bool {
        IS_MAC || !matches!(self.action, Action::Selector(_))
    }

    /// A page is not asked about the ways out of it.
    pub(crate) fn is_reserved(&self) -> bool {
        matches!(
            self.name,
            "quit" | "close" | "hide" | "hideothers" | "minimize"
        )
    }

    pub(crate) fn perform(&self, window: Option<&Window>) -> JsResult<()> {
        match (self.action, window) {
            (Action::App(action), _) => action(),
            (Action::Selector(it), _) => tell_system(SystemCommand::SendAction(it.into())),
            (Action::Page(method), Some(window)) => tell_page(window, method),
            (Action::Zoom(step), Some(window)) => zoom(window, step),
            (Action::Window(action), Some(window)) => action(window),
            _ => Ok(()),
        }
    }
}
