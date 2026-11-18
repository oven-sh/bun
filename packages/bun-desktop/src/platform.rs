//! What the library needs of a window system. Everything is on the UI thread and in logical pixels, from the top left.
//!
//! A backend reports what happens by calling `window::{frame_is_due, bounds_changed, activation_changed,
//! visibility_changed, close_requested, was_closed, appearance_changed}`, `input::{raw_key, key, handle}`, the methods
//! of `input::TextInput`, `accessibility` and `bridge::{emit, reply}`. They may be
//! called from inside of any method here.

mod headless;
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
compile_error!("there is no backend for Windows yet");

use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use crate::abi::Rect;
use crate::accessibility;
use crate::error::Result;
use crate::gfx::Pixmap;
#[cfg(any(test, not(target_os = "macos")))]
use crate::paint::raster::IntRect;
use crate::protocol::{
    Application, BackdropPart, Clipboard, ClipboardPart, Dragged, SystemCommand, SystemRequest,
    SystemSettings, SystemState, WindowCommand,
};
pub use crate::protocol::{Cursor, Display, Geometry, Point};
#[cfg(not(target_os = "macos"))]
use crate::protocol::{Maybe, PreferenceCommand, PreferenceValue, Text};
use crate::window::Options;

#[cfg(not(target_os = "macos"))]
pub use linux::keysym_to_char;

pub fn start(is_headless: bool, is_accessory: bool) -> Result<Box<dyn Platform>> {
    if is_headless {
        return Ok(Box::new(headless::Headless));
    }
    #[cfg(target_os = "macos")]
    return macos::start(is_accessory);
    #[cfg(not(target_os = "macos"))]
    linux::start(is_accessory)
}

#[cfg(target_os = "macos")]
pub use macos::{answer, change_preference, preference, run_as_root};

#[cfg(not(target_os = "macos"))]
pub fn preference(_key: &Text) -> Maybe<PreferenceValue> {
    Maybe::No
}

#[cfg(not(target_os = "macos"))]
pub fn change_preference(_: &PreferenceCommand) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn answer(_: &crate::protocol::Question) -> Maybe<u32> {
    Maybe::No
}

#[cfg(not(target_os = "macos"))]
pub fn run_as_root(
    _: &Text,
    _: &crate::protocol::List<crate::protocol::List<Text>>,
) -> Result<Text> {
    crate::error::bail!("there is nobody to ask")
}

pub trait Platform {
    fn has_display(&self) -> bool {
        true
    }
    /// It is not shown, whatever the options say.
    fn open_window(&self, options: &Options, icon: Option<&Icon>) -> Result<Rc<dyn Window>>;
    /// Whether windows are where the app wants them.
    fn places_windows(&self) -> bool {
        true
    }
    /// The primary one is first.
    fn displays(&self) -> Vec<Display>;
    /// What the system's settings say.
    fn is_dark(&self) -> bool;
    /// For title bars and whatever else the system draws. `None` follows the system.
    fn set_dark(&self, is_dark: Option<bool>);
    /// On the left and on the right of a title bar that `frame` draws.
    fn button_layout(&self) -> Option<[Vec<WindowButton>; 2]> {
        None
    }
    fn command(&self, command: SystemCommand) -> Result<()>;
    /// The answer goes to `bridge::reply` unless this fails.
    fn request(&self, id: u32, request: SystemRequest) -> Result<()>;
    /// But for the display and the appearance.
    fn state(&self) -> SystemState;
    fn cursor_position(&self) -> Result<Point>;
    fn idle_seconds(&self) -> Result<f64>;
    fn is_on_battery(&self) -> bool;
    fn read_clipboard(&self, part: ClipboardPart) -> Clipboard;
    fn settings(&self) -> SystemSettings {
        SystemSettings::default()
    }
    fn is_hidden(&self) -> bool {
        false
    }
    fn opens_at_login(&self) -> bool {
        false
    }
    fn is_trusted_for_accessibility(&self, _prompts: bool) -> bool {
        true
    }
    fn bounce(&self, _is_critical: bool) -> i32 {
        -1
    }
    fn tray_bounds(&self, _tray: u32) -> Rect {
        Rect::default()
    }
    fn application_for(&self, _url: &str) -> Option<Application> {
        None
    }
    fn file_icon(&self, _path: &str, _side: u32) -> Vec<u8> {
        Vec::new()
    }
    fn named_image(&self, _name: &str) -> Vec<u8> {
        Vec::new()
    }
    /// To wait for. `dispatch` is called when one is readable.
    #[cfg(not(target_os = "macos"))]
    fn descriptors(&self) -> Vec<i32>;
    /// Sends what is buffered, and returns when `dispatch` has to be called at the latest.
    #[cfg(not(target_os = "macos"))]
    fn before_waiting(&self) -> Option<std::time::Instant>;
    /// Handles what has happened, without blocking.
    #[cfg(not(target_os = "macos"))]
    fn dispatch(&self, readable: &[i32]);
    fn has_screen_reader(&self) -> bool;
    fn accessibility_changed(&self, events: &[accessibility::Event]);
    /// Removes what would be left behind: tray icons, hot keys, inhibitors. The clipboard is handed over if `is_exiting`.
    fn shut_down(&self, is_exiting: bool);
}

pub trait Window {
    fn geometry(&self) -> Geometry;
    /// With what was asked for, if the answer is still to come.
    fn geometry_soon(&self) -> Geometry {
        self.geometry()
    }
    fn is_active(&self) -> bool;
    /// The window system has it on the screen, or is about to.
    fn is_visible(&self) -> bool;
    fn refresh_interval(&self) -> Option<Duration>;
    /// In the window.
    fn mouse_position(&self) -> Point;
    fn set_visible(&self, is_visible: bool, takes_focus: bool);
    /// No event follows.
    fn close(&self);
    /// One call of `window::frame_is_due`: at once after a pause, and otherwise at the pace of the display.
    fn request_frame(&self);
    /// 60 in a second are enough.
    fn request_leisurely_frame(&self) {
        self.request_frame();
    }
    /// Between frames. `Some(false)` if it is worth asking again in a moment, `None` to wait for the next frame.
    fn can_present(&self) -> Option<bool>;
    /// Shows what `paint` puts into a buffer. It may be called later, on another thread.
    #[cfg(not(target_os = "macos"))]
    fn present(&self, paint: Painter);
    /// The `CALayer` of the view.
    #[cfg(target_os = "macos")]
    fn layer(&self) -> *mut std::ffi::c_void;
    /// From where to where it shows, and from where to where a change makes the system blur again.
    #[cfg(target_os = "macos")]
    fn fit_backdrop(&self, _shows: [f64; 2]) -> [f64; 2] {
        [0.; 2]
    }
    fn set_cursor(&self, cursor: Cursor);
    fn begin_drag(&self, _dragged: &Dragged, _image: Option<&Pixmap>) {}
    /// Whether a field has the focus, or where its caret is, has changed. See `input::TextInput`.
    fn text_input_changed(&self);
    fn start_move(&self);
    fn start_resize(&self, edge: Edge);
    fn show_window_menu(&self, at: Point);
    fn title_was_double_clicked(&self);
    /// What it cannot do, it ignores.
    fn command(&self, command: &WindowCommand) -> Result<()>;
    fn is_minimized(&self) -> bool;
    fn number(&self) -> u64 {
        self.handle()
    }
    /// What native addons have put there.
    fn describe_backdrop(&self) -> Vec<BackdropPart> {
        Vec::new()
    }
    fn imitate_backdrop(&self, _parts: &[BackdropPart]) {}
    /// The next background replaces what addons have set until now, and not what they set later.
    fn claim_background(&self) {}
    #[cfg(not(target_os = "macos"))]
    fn name_for_portals(&self) -> String {
        String::new()
    }
    /// `NSView*`, the XID or the id of the `wl_surface`.
    fn handle(&self) -> u64;
}

/// RGBA, not premultiplied.
#[cfg_attr(
    target_os = "macos",
    expect(dead_code, reason = "windows have the icon of the app")
)]
pub struct Icon {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Edge {
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
    TopLeft,
}

#[derive(Clone, Copy, PartialEq)]
pub enum WindowButton {
    Minimize,
    Maximize,
    Close,
}

/// Shift 1, control 2, alt 4, meta 8, AltGr 16, Caps Lock 32.
pub type Modifiers = u8;

/// For `input::raw_key`, before the input method sees it. Then either the input method calls `TextInput`, or the
/// backend calls `input::key` and, unless that returns true, `TextInput::insert` with what it types.
#[derive(Clone, Copy)]
pub struct RawKey {
    pub down: bool,
    pub is_repeat: bool,
    /// The evdev code or the `kVK_` code.
    pub scan_code: u32,
    /// The keysym. On macOS the character, and `u32::MAX` for a dead key.
    pub symbol: u32,
    /// Before this key.
    pub modifiers: Modifiers,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq)]
pub enum Phase {
    Started,
    Moved,
    Ended,
    #[expect(dead_code, reason = "Objective-C does")]
    Cancelled,
}

/// Buttons are numbered as in the DOM: left 0, middle 1, right 2, back 3, forward 4.
pub enum Input {
    MouseDown {
        at: Point,
        button: u8,
        clicks: u32,
        modifiers: Modifiers,
    },
    MouseUp {
        at: Point,
        button: u8,
        clicks: u32,
        modifiers: Modifiers,
    },
    MouseMove {
        at: Point,
        is_pressed: bool,
        modifiers: Modifiers,
    },
    MouseLeave {
        at: Point,
        modifiers: Modifiers,
    },
    /// How far the content moves, in pixels if `is_precise` and otherwise in lines.
    Scroll {
        at: Point,
        delta: Point,
        is_precise: bool,
        phase: Phase,
        modifiers: Modifiers,
    },
    Pinch {
        at: Point,
        delta: f32,
        modifiers: Modifiers,
    },
    DragEnter {
        at: Point,
        paths: Vec<PathBuf>,
    },
    DragOver {
        at: Point,
    },
    Drop {
        at: Point,
    },
    DragLeave,
}

/// Premultiplied BGRA.
#[cfg(any(test, not(target_os = "macos")))]
pub struct Pixels<'a> {
    /// What has the same id was not changed since it was painted.
    pub id: u64,
    pub data: &'a mut [[u8; 4]],
    pub width: usize,
    /// The window shows this much.
    pub shown: (i32, i32),
    /// The backend keeps what it shows, and only reads `Painted::areas` from `data`.
    pub platform_moves: bool,
}

/// What differs from the last time.
#[cfg(any(test, not(target_os = "macos")))]
#[derive(Default)]
#[cfg_attr(target_os = "macos", expect(dead_code, reason = "X11 does it"))]
pub struct Painted {
    /// In this order, each shows what was `moved_by` pixels above it. Done in the pixels unless `platform_moves`.
    pub moved: Vec<IntRect>,
    pub moved_by: i32,
    pub areas: Vec<IntRect>,
}

#[cfg(not(target_os = "macos"))]
pub type Painter = Box<dyn FnOnce(Pixels) -> Painted + Send>;
