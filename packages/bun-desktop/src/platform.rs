//! What the library needs of a window system. Everything is on the UI thread and in logical pixels, from the top left.
//!
//! A backend reports what happens by calling `window::{frame_is_due, bounds_changed, activation_changed,
//! visibility_changed, close_requested, was_closed, appearance_changed}`, `input::{raw_key, key, handle}`, the methods
//! of `input::TextInput`, `accessibility::{set_active, perform}`, `app::event` and `bridge::{emit, reply}`. They may be
//! called from inside of any method here.

mod headless;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
mod x11;
#[cfg(target_os = "windows")]
compile_error!("there is no backend for Windows yet");

use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use crate::abi::Rect;
use crate::accessibility;
use crate::error::Result;
use crate::json::Value;
#[cfg(any(test, not(target_os = "macos")))]
use crate::paint::raster::IntRect;
use crate::window::Options;

#[cfg(not(target_os = "macos"))]
pub use x11::keysym_to_char;

pub fn start(is_headless: bool, is_accessory: bool) -> Result<Box<dyn Platform>> {
    if is_headless {
        return Ok(Box::new(headless::Headless));
    }
    #[cfg(target_os = "macos")]
    return macos::start(is_accessory);
    #[cfg(not(target_os = "macos"))]
    x11::start(is_accessory)
}

pub trait Platform {
    /// "headless", "X11", and "" where there is only one.
    fn name(&self) -> &'static str;
    /// It is not shown, whatever the options say.
    fn open_window(&self, options: &Options, icon: Option<&Icon>) -> Result<Rc<dyn Window>>;
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
    /// What `app::command` does not know. With `reply`, the answer goes to `bridge::reply` unless this fails.
    fn command(&self, name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value>;
    /// To wait for. `dispatch` is called when one is readable.
    #[cfg(not(target_os = "macos"))]
    fn descriptors(&self) -> Vec<i32>;
    /// Sends what is buffered, and returns when `dispatch` has to be called at the latest.
    #[cfg(not(target_os = "macos"))]
    fn before_waiting(&self) -> Option<std::time::Instant>;
    /// Handles what has happened, without blocking.
    #[cfg(not(target_os = "macos"))]
    fn dispatch(&self, readable: &[i32]);
    /// Removes what would be left behind: tray icons, hot keys, inhibitors. The clipboard is handed over if `is_exiting`.
    fn shut_down(&self, is_exiting: bool);
}

pub trait Window {
    fn geometry(&self) -> Geometry;
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
    fn set_cursor(&self, cursor: Cursor);
    /// Whether a field has the focus, or where its caret is, has changed. See `input::TextInput`.
    fn text_input_changed(&self);
    fn start_move(&self);
    fn start_resize(&self, edge: Edge);
    fn show_window_menu(&self, at: Point);
    fn title_was_double_clicked(&self);
    fn set_accessibility_tree(&self, tree: &accessibility::Update);
    /// The `window.*` commands that `app::window_command` does not answer. Unknown ones do nothing. `other` is the
    /// window whose id is `value`.
    fn command(&self, name: &str, value: &Value, other: Option<&dyn Window>) -> Result<Value>;
    /// `NSView*` or the XID.
    fn handle(&self) -> u64;
}

#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq)]
pub struct Geometry {
    /// Of the frame, on the screen.
    pub x: f32,
    pub y: f32,
    /// How far below `y` the content begins.
    pub top: f32,
    /// Of the content.
    pub width: f32,
    pub height: f32,
    pub scale: f32,
    pub is_maximized: bool,
    pub is_fullscreen: bool,
    /// Nobody else draws a title bar or lets the user resize it.
    pub is_client_decorated: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Display {
    pub id: u64,
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale: f32,
    /// 0 if unknown.
    pub frequency: f32,
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

#[repr(u8)]
#[derive(Clone, Copy, Default, PartialEq, Eq, Hash, Debug)]
pub enum Cursor {
    #[default]
    Arrow,
    IBeam,
    VerticalIBeam,
    Crosshair,
    OpenHand,
    ClosedHand,
    PointingHand,
    ResizeLeft,
    ResizeRight,
    ResizeLeftRight,
    ResizeUp,
    ResizeDown,
    ResizeUpDown,
    ResizeUpLeftDownRight,
    ResizeUpRightDownLeft,
    ResizeColumn,
    ResizeRow,
    NotAllowed,
    DragLink,
    DragCopy,
    ContextMenu,
    Hidden,
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
    #[cfg_attr(target_os = "macos", expect(dead_code, reason = "Objective-C does"))]
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
        phase: Phase,
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
pub struct Painted {
    /// In this order, each shows what was `moved_by` pixels above it. Done in the pixels unless `platform_moves`.
    pub moved: Vec<IntRect>,
    pub moved_by: i32,
    pub areas: Vec<IntRect>,
}

#[cfg(not(target_os = "macos"))]
pub type Painter = Box<dyn FnOnce(Pixels) -> Painted + Send>;
