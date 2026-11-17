//! What Bun and the UI library ask and tell each other about windows and the system. The library compiles this file
//! too, and its `build.rs` makes `protocol.h` of it.
//!
//! Both sides have the same allocator, so what is passed by value moves. Lengths are logical pixels from the top left,
//! and colors are `0xRRGGBBAA`.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

use core::mem::ManuallyDrop;
use core::ops::Deref;

use super::abi::{FontSetting, Rect, Region};

/// A `Vec`. All zeros is an empty one.
#[repr(C)]
pub struct List<T> {
    start: *mut T,
    length: usize,
    capacity: usize,
}

// SAFETY: it owns the elements.
unsafe impl<T: Send> Send for List<T> {}
// SAFETY: as above.
unsafe impl<T: Sync> Sync for List<T> {}

impl<T> List<T> {
    pub const fn new() -> Self {
        List {
            start: core::ptr::null_mut(),
            length: 0,
            capacity: 0,
        }
    }

    fn take(&mut self) -> Vec<T> {
        let capacity = core::mem::take(&mut self.capacity);
        if capacity == 0 {
            return Vec::new();
        }
        // SAFETY: the parts of a `Vec`, which nothing else has now that the capacity is 0.
        unsafe { Vec::from_raw_parts(self.start, core::mem::take(&mut self.length), capacity) }
    }

    pub fn into_vec(mut self) -> Vec<T> {
        self.take()
    }
}

impl<T> Drop for List<T> {
    fn drop(&mut self) {
        drop(self.take());
    }
}

impl<T> Deref for List<T> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        if self.length == 0 {
            return &[];
        }
        // SAFETY: the parts of a `Vec`.
        unsafe { core::slice::from_raw_parts(self.start, self.length) }
    }
}

impl<T> From<Vec<T>> for List<T> {
    fn from(all: Vec<T>) -> Self {
        let mut all = ManuallyDrop::new(all);
        List {
            start: all.as_mut_ptr(),
            length: all.len(),
            capacity: all.capacity(),
        }
    }
}

impl<T: Clone> From<&[T]> for List<T> {
    fn from(all: &[T]) -> Self {
        all.to_vec().into()
    }
}

impl<T> FromIterator<T> for List<T> {
    fn from_iter<I: IntoIterator<Item = T>>(all: I) -> Self {
        Vec::from_iter(all).into()
    }
}

impl<T> IntoIterator for List<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.into_vec().into_iter()
    }
}

impl<T> Default for List<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Clone> Clone for List<T> {
    fn clone(&self) -> Self {
        Self::from(&**self)
    }
}

impl<T: PartialEq> PartialEq for List<T> {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T> core::fmt::Debug for List<T> {
    fn fmt(&self, to: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(to, "[{}]", self.length)
    }
}

/// A `String`.
#[repr(transparent)]
#[derive(Clone, Default, PartialEq)]
pub struct Text(List<u8>);

impl Text {
    pub const fn new() -> Text {
        Text(List::new())
    }

    pub fn lossy(bytes: &[u8]) -> Text {
        bytes
            .utf8_chunks()
            .fold(String::with_capacity(bytes.len()), |mut all, chunk| {
                all.push_str(chunk.valid());
                all.extend((!chunk.invalid().is_empty()).then_some(char::REPLACEMENT_CHARACTER));
                all
            })
            .into()
    }

    pub fn into_string(self) -> String {
        // SAFETY: it was made of a `String`.
        unsafe { String::from_utf8_unchecked(self.0.into_vec()) }
    }

    pub fn unless_empty(&self) -> Option<&str> {
        (!self.0.is_empty()).then_some(self)
    }
}

impl Deref for Text {
    type Target = str;

    fn deref(&self) -> &str {
        // SAFETY: as above.
        unsafe { core::str::from_utf8_unchecked(&self.0) }
    }
}

impl AsRef<[u8]> for Text {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl From<String> for Text {
    fn from(text: String) -> Text {
        Text(text.into_bytes().into())
    }
}

impl From<&str> for Text {
    fn from(text: &str) -> Text {
        Text(text.as_bytes().into())
    }
}

impl core::fmt::Debug for Text {
    fn fmt(&self, to: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        (**self).fmt(to)
    }
}

/// An `Option`.
#[repr(C, u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Maybe<T> {
    #[default]
    No,
    Yes(T),
}

impl<T> Maybe<T> {
    pub fn get(self) -> Option<T> {
        match self {
            Maybe::No => None,
            Maybe::Yes(value) => Some(value),
        }
    }

    pub fn as_ref(&self) -> Option<&T> {
        match self {
            Maybe::No => None,
            Maybe::Yes(value) => Some(value),
        }
    }
}

impl<T> From<Option<T>> for Maybe<T> {
    fn from(value: Option<T>) -> Self {
        value.map_or(Maybe::No, Maybe::Yes)
    }
}

/// A `Result`.
#[repr(C, u8)]
#[derive(Debug)]
#[must_use]
pub enum Outcome<T> {
    Failed(Text),
    Done(T),
}

impl<T> Outcome<T> {
    pub fn get(self) -> Result<T, Text> {
        match self {
            Outcome::Failed(reason) => Err(reason),
            Outcome::Done(value) => Ok(value),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

pub const SHIFT: u8 = 1;
pub const CONTROL: u8 = 2;
pub const ALT: u8 = 4;
pub const META: u8 = 8;
pub const ALT_GRAPH: u8 = 16;
pub const CAPS_LOCK: u8 = 32;

/// A keyboard shortcut. `key` is a character, or a name in lower case such as `enter` or `f1`.
#[repr(C)]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Chord {
    pub key: Text,
    pub modifiers: u8,
}

// ───────────────────────────── windows ─────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
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
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Display {
    pub id: u64,
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale: f32,
    /// 0 if unknown.
    pub frequency: f32,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WindowKind {
    #[default]
    Normal,
    Dialog,
    Floating,
    Popup,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Material {
    #[default]
    UnderWindow,
    Titlebar,
    Selection,
    Menu,
    Popover,
    Sidebar,
    Header,
    Sheet,
    Window,
    Hud,
    FullscreenUi,
    Tooltip,
    Content,
    UnderPage,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EffectState {
    #[default]
    FollowsWindow,
    Active,
    Inactive,
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Background {
    #[default]
    Opaque,
    Transparent,
    Blurred {
        material: Material,
        state: EffectState,
    },
}

/// The buttons that are drawn over the content of a window without a title bar.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Overlay {
    pub height: f32,
    pub color: Maybe<u32>,
    pub symbol_color: Maybe<u32>,
}

#[repr(C)]
#[derive(Clone, Debug, Default)]
pub struct WindowOptions {
    pub id: u32,
    pub title: Text,
    pub x: Maybe<f32>,
    pub y: Maybe<f32>,
    pub width: f32,
    pub height: f32,
    pub min_width: f32,
    pub min_height: f32,
    pub show: bool,
    pub focus: bool,
    pub frame: bool,
    pub hidden_title_bar: bool,
    pub traffic_light_position: Maybe<Point>,
    pub background: Background,
    pub background_color: Maybe<u32>,
    pub resizable: bool,
    pub movable: bool,
    pub accept_first_mouse: bool,
    pub minimizable: bool,
    pub kind: WindowKind,
    pub maximized: bool,
    pub fullscreen: bool,
    pub app_id: Text,
    pub overlay: Maybe<Overlay>,
    /// Windows that have the same one open as tabs.
    pub tabbing_identifier: Text,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Limits {
    pub min: Size,
    pub max: Maybe<Size>,
    pub is_resizable: bool,
}

/// What only AppKit has.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct WindowStyle {
    pub shadow: Maybe<bool>,
    pub movable: Maybe<bool>,
    pub focusable: Maybe<bool>,
    pub closable: Maybe<bool>,
    pub minimizable: Maybe<bool>,
    pub zoomable: Maybe<bool>,
    pub buttons: Maybe<bool>,
    pub rounded_corners: Maybe<bool>,
    pub full_screenable: Maybe<bool>,
    pub visible_on_full_screen: Maybe<bool>,
    pub hidden_in_mission_control: Maybe<bool>,
    pub level: Maybe<i32>,
    pub is_in_window_menu: Maybe<bool>,
}

#[repr(C, u8)]
#[derive(Clone, Debug)]
pub enum WindowCommand {
    Destroy,
    Show {
        takes_focus: bool,
    },
    Hide,
    /// Of this window.
    ShowAsSheet(u32),
    Parent(Maybe<u32>),
    Focus,
    MoveTop,
    Minimize,
    Restore,
    Maximize(bool),
    Fullscreen(bool),
    SimpleFullscreen(bool),
    Position(Point),
    Size(Size),
    Bounds {
        bounds: Rect,
        animates: bool,
    },
    Limits(Limits),
    Title(Text),
    Background(Background),
    BackgroundColor(Maybe<u32>),
    TrafficLights(Point),
    Style(WindowStyle),
    Opacity(f32),
    AlwaysOnTop(bool),
    SkipTaskbar(bool),
    AllWorkspaces(bool),
    ContentProtection(bool),
    IgnoreMouseEvents(bool),
    Edited(bool),
    RepresentedFilename(Text),
    Attention(bool),
    Blur,
    /// A number as screen capture knows it.
    MoveAbove(u64),
    /// Of the content, without `extra`. 0 for any.
    AspectRatio {
        ratio: f32,
        extra: Size,
    },
    InvalidateShadow,
    /// An action of `NSWindow`.
    TabAction(Text),
    AddTab(u32),
    Preview {
        path: Text,
        name: Text,
    },
    ClosePreview,
    Beep,
    CharacterPalette,
    LookUp(Text),
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WindowEvent {
    Bounds(Geometry),
    Focus,
    Blur,
    Visibility(bool),
    CloseRequested,
    Closed,
    Fullscreen(bool),
    Minimized(bool),
    Resizing(bool),
    Moving,
    Swipe(Direction),
    NewTab,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum SyntheticKey {
    /// The `key` of a `KeyboardEvent`.
    Named(Text),
    /// The `key` of a [`Chord`].
    Labelled(Text),
}

/// `at` is in the content of the window.
#[repr(C, u8)]
#[derive(Debug)]
pub enum Synthetic {
    Mouse {
        action: MouseAction,
        at: Point,
        button: u8,
        clicks: u32,
    },
    Wheel {
        at: Point,
        delta: Point,
    },
    Key {
        is_down: bool,
        is_repeat: bool,
        key: SyntheticKey,
        code: Maybe<Text>,
        text: Maybe<Text>,
    },
    Text(Text),
    Drop {
        at: Point,
        paths: List<Text>,
    },
}

// ───────────────────────────── surfaces ─────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
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

/// The focused field. Offsets are in UTF-16 code units.
#[repr(C)]
#[derive(Debug, Default)]
pub struct InputField {
    pub text: List<u16>,
    pub selection: [u32; 2],
    pub composing: Maybe<[u32; 2]>,
    pub caret: Rect,
}

#[repr(C)]
#[derive(Debug)]
pub struct Dragged {
    /// A recording, which is released, or 0.
    pub image: u32,
    /// Where that is, relative to the pointer.
    pub area: Rect,
    /// For other applications, and what they may do with it.
    pub text: Text,
    pub html: Text,
    pub url: Text,
    pub copies: bool,
    pub links: bool,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum SurfaceCommand {
    Create {
        size: Size,
        scale: f32,
        is_focusable: bool,
    },
    Destroy,
    /// On top, unless there is an index.
    Attach {
        window: u32,
        index: Maybe<u32>,
    },
    Detach,
    /// In the content of the window, or all of that.
    Bounds(Maybe<Rect>),
    Place {
        bounds: Rect,
        is_visible: bool,
        radius: f32,
    },
    Visible(bool),
    Passthrough(bool),
    Background(u32),
    /// What the document has behind it.
    Canvas(u32),
    Focus,
    /// One [`Input::Frame`] before it is next drawn.
    RequestFrame,
    Cursor(Cursor),
    /// The mouse goes on reporting, and the cursor says what a drop would do.
    BeginDrag(Dragged),
    Field(Maybe<InputField>),
    /// In place of a [`SurfaceCommand::Field`].
    PasswordField,
    /// Of a web view.
    Show(u32),
    Regions {
        view: u32,
        regions: List<Region>,
    },
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct SurfaceMetrics {
    /// On the screen.
    pub bounds: Rect,
    pub scale: f32,
}

/// RGBA, not premultiplied.
#[repr(C)]
#[derive(Debug, Default)]
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub pixels: List<u8>,
}

/// In the surface and on the screen.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Located {
    pub x: f32,
    pub y: f32,
    pub screen_x: f32,
    pub screen_y: f32,
    pub modifiers: u8,
    /// The library scrolls.
    pub is_handled: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseAction {
    Move,
    Down,
    Up,
    Leave,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DragPhase {
    Enter,
    Over,
    Leave,
    Drop,
}

/// Buttons are numbered as in the DOM.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mouse {
    pub at: Located,
    pub action: MouseAction,
    pub button: u8,
    pub buttons: u8,
    pub clicks: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wheel {
    pub at: Located,
    pub delta: [f64; 2],
    pub is_precise: bool,
}

#[repr(C)]
#[derive(Clone, Debug)]
pub struct Key {
    pub key: Text,
    pub code: Text,
    pub location: u8,
    pub modifiers: u8,
    pub is_down: bool,
    pub is_repeat: bool,
    pub is_composing: bool,
}

#[repr(C, u8)]
#[derive(Clone, Debug)]
pub enum Input {
    /// In milliseconds.
    Frame {
        time: f64,
        interval: f64,
    },
    Resize {
        size: Size,
        scale: f32,
    },
    Mouse(Mouse),
    Wheel(Wheel),
    Pinch {
        at: Located,
        delta: f32,
    },
    /// The library has scrolled `node` that far in all. It is out of date if the scroller has another `generation`.
    Scroll {
        node: u32,
        generation: u32,
        total: [f64; 2],
        has_ended: bool,
    },
    Key(Key),
    /// It replaces `range`, or else the selection. `is_typed`: the key that went down last produced it.
    Text {
        text: Text,
        is_typed: bool,
        range: Maybe<[u32; 2]>,
    },
    Compose {
        text: Text,
        selection: [u32; 2],
        range: Maybe<[u32; 2]>,
    },
    EndComposition,
    Focus,
    Blur,
    Drag {
        phase: DragPhase,
        at: Located,
        paths: List<Text>,
    },
    /// A button went down in another surface.
    Outside,
    /// For a tree, which need not be a surface.
    Perform {
        node: u32,
        action: super::abi::accessibility::Action,
        numbers: [u32; 4],
        text: Text,
        takes_focus: bool,
    },
}

// ───────────────────────────── fonts, web views and the launch cover ─────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FontFaceStyle {
    #[default]
    Auto,
    Normal,
    Slanted,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum FontSource {
    Bytes(List<u8>),
    Local(Text),
}

#[repr(C)]
#[derive(Debug, Default)]
pub struct FontFace {
    pub scope: u32,
    pub family: Text,
    pub weight: Maybe<[f32; 2]>,
    pub stretch: Maybe<[f32; 2]>,
    pub style: FontFaceStyle,
    pub slope: Maybe<[f32; 2]>,
    /// Among faces that match as well, the highest wins.
    pub order: u32,
    pub unicode_range: Maybe<List<[u32; 2]>>,
    pub size_adjust: Maybe<f32>,
    pub ascent_override: Maybe<f32>,
    pub descent_override: Maybe<f32>,
    pub line_gap_override: Maybe<f32>,
    pub features: List<FontSetting>,
    pub variations: List<FontSetting>,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum FramePixels {
    Encoded(List<u8>),
    /// `[x, y, width, height]` of what has changed.
    Raw {
        size: [u32; 2],
        area: [u32; 4],
        is_in_channel: bool,
    },
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum WebViewCommand {
    Close,
    Frame {
        scale: f32,
        pixels: FramePixels,
    },
    Mirror {
        surface: u32,
        scale: f32,
        area: Maybe<Rect>,
    },
}

#[repr(C)]
#[derive(Debug)]
pub struct HelperSources {
    pub wire: Text,
    pub main: Text,
    pub frame: Text,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CoverField {
    pub rect: Rect,
    pub color: Maybe<u32>,
    pub letter_spacing: f32,
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug)]
pub enum CoverPicture {
    Kept,
    /// `backdrop` is for where the window is see-through.
    Painted {
        part: Maybe<Rect>,
        backdrop: Maybe<u32>,
        field: Maybe<CoverField>,
    },
}

#[repr(C)]
#[derive(Debug)]
pub struct Cover {
    pub window: u32,
    pub description: Text,
    pub picture: Text,
    pub content: CoverPicture,
    pub theme: Theme,
    /// Of the environment. It is not shown if they have other values.
    pub variables: List<Text>,
    pub bounds: Rect,
    pub is_maximized: bool,
    pub traffic_light_position: Maybe<Point>,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SurfacePoint {
    pub surface: u32,
    pub at: Point,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Uncovered {
    pub clicked: Maybe<SurfacePoint>,
    pub focused: Maybe<u32>,
}

/// What is behind the contents of a window. It blurs unless it has a color.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct BackdropPart {
    pub frame: [f64; 4],
    pub color: Maybe<[f64; 4]>,
}

// ───────────────────────────── the system ─────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThermalState {
    #[default]
    Nominal,
    Fair,
    Serious,
    Critical,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemState {
    pub has_display: bool,
    pub is_dark: bool,
    pub thermal_state: ThermalState,
    pub saves_power: bool,
    pub reduces_motion: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemSettings {
    pub accent: Maybe<u32>,
    /// Behind selected text, in the light and in the dark appearance.
    pub highlight: Maybe<[u32; 2]>,
    pub overlay_scrollbars: Maybe<bool>,
    pub more_contrast: bool,
    pub reduced_transparency: bool,
    pub inverted_colors: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipboardPart {
    Everything,
    Text,
    /// What is selected, on X11.
    Selection,
}

#[repr(C)]
#[derive(Clone, Debug, Default)]
pub struct Clipboard {
    pub text: Maybe<Text>,
    pub html: Maybe<Text>,
    pub files: List<Text>,
    pub image: Maybe<List<u8>>,
}

/// An encoded image, and the size to show it at.
#[repr(C)]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Icon {
    pub bytes: List<u8>,
    pub size: Size,
    pub is_template: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuItemKind {
    #[default]
    Normal,
    Separator,
    Submenu,
    Checkbox,
    Radio,
    Header,
}

/// What the system has a hand in.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuRole {
    #[default]
    None,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Close,
    Minimize,
    Services,
    Window,
    Help,
}

#[repr(C)]
#[derive(Clone, Debug, Default)]
pub struct MenuItem {
    pub id: u32,
    pub kind: MenuItemKind,
    pub role: MenuRole,
    pub is_enabled: bool,
    pub is_checked: bool,
    pub label: Text,
    pub sublabel: Text,
    pub tool_tip: Text,
    pub accelerator: Maybe<Chord>,
    pub icon: Maybe<Icon>,
    pub submenu: Maybe<List<MenuItem>>,
    /// The system makes the submenu.
    pub shared: Maybe<Shared>,
}

#[repr(C)]
#[derive(Clone, Debug, Default)]
pub struct Shared {
    pub texts: List<Text>,
    pub files: List<Text>,
    pub urls: List<Text>,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Media {
    Microphone,
    Camera,
    Screen,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum Question {
    CanAuthenticate,
    /// An `AVAuthorizationStatus`.
    Access(Media),
    /// A property of `NSColor`, as `0xRRGGBBAA`.
    Color(Text),
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityStep {
    WillContinue,
    Continue,
    Failed,
    WasContinued,
    WillSave,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum TrayCommand {
    Create { name: Text, icon: Icon },
    Destroy,
    Icon(Icon),
    ToolTip(Text),
    Title(Text),
    Menu(Maybe<List<MenuItem>>),
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayEvent {
    Click,
    RightClick,
    MiddleClick,
    DoubleClick,
    MouseEnter,
    MouseLeave,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationCenter {
    Local,
    Distributed,
    Workspace,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum SystemCommand {
    Identity {
        id: Text,
        name: Text,
    },
    Activate {
        steals_focus: bool,
    },
    Hide,
    HideOthers,
    Unhide,
    ShowInDock(bool),
    Badge {
        text: Text,
        app_id: Text,
    },
    /// Below 0 for none.
    Progress {
        done: f32,
        app_id: Text,
    },
    DockIcon(Icon),
    BeginActivity {
        kind: Text,
        info: PreferenceValue,
        url: Text,
    },
    UpdateActivity(PreferenceValue),
    ResignActivity,
    InvalidateActivity,
    UnregisterForPush,
    SecureInput(bool),
    Post {
        center: NotificationCenter,
        name: Text,
        object: Text,
        info: PreferenceValue,
        is_urgent: bool,
    },
    CancelBounce(i32),
    CancelQuit,
    AddRecentDocument(Text),
    OpenUrl(Text),
    OpenPath(Text),
    RevealPath(Text),
    OpenAtLogin(bool),
    Notify {
        tag: Text,
        title: Text,
        body: Text,
        actions: List<Text>,
    },
    DismissNotification(Text),
    Observe {
        center: NotificationCenter,
        name: Text,
    },
    SendAction(Text),
    WriteClipboard {
        contents: Clipboard,
        is_selection: bool,
    },
    PreventSleep {
        id: u32,
        reason: Text,
    },
    AllowSleep(u32),
    RegisterHotKey {
        id: u32,
        chord: Chord,
    },
    UnregisterHotKey(u32),
    ApplicationMenu(List<MenuItem>),
    DockMenu(List<MenuItem>),
    ClosePopUpMenu,
    CloseMessageBox(u32),
    Tray {
        id: u32,
        command: TrayCommand,
    },
}

#[repr(C)]
#[derive(Clone, Debug)]
pub struct FileFilter {
    pub name: Text,
    pub extensions: List<Text>,
}

#[repr(C)]
#[derive(Debug)]
pub struct PrintJob {
    pub window: Maybe<u32>,
    pub title: Text,
    pub pdf: List<u8>,
    /// Empty for the default one.
    pub printer: Text,
    pub copies: u32,
    pub is_silent: bool,
}

#[repr(C)]
#[derive(Clone, Debug)]
pub struct FilePicker {
    pub window: Maybe<u32>,
    pub title: Text,
    pub message: Text,
    pub button_label: Text,
    pub directory: Text,
    pub file_name: Text,
    pub filters: List<FileFilter>,
    pub saves: bool,
    pub takes_files: bool,
    pub takes_directories: bool,
    pub takes_many: bool,
    pub creates_directories: bool,
    pub shows_hidden_files: bool,
    pub keeps_aliases: bool,
    pub enters_packages: bool,
}

#[repr(C)]
#[derive(Debug)]
pub struct MessageBox {
    pub id: u32,
    pub window: Maybe<u32>,
    pub is_grave: bool,
    pub message: Text,
    pub detail: Text,
    pub buttons: List<Text>,
    pub default_button: i32,
    pub cancel_button: i32,
    pub checkbox_label: Text,
    pub is_checked: bool,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum SystemRequest {
    PickFiles(FilePicker),
    MessageBox(MessageBox),
    PopUpMenu {
        window: u32,
        at: Point,
        positioning_item: Maybe<u32>,
        items: List<MenuItem>,
        is_submenu_of_first: bool,
    },
    PopUpTrayMenu {
        tray: u32,
        items: List<MenuItem>,
    },
    Trash(Text),
    RegisterUrlScheme(Text),
    /// The password that Chromium keeps in the Secret Service. It is `fresh` if there was none.
    ChromiumPassword {
        application: Text,
        fresh: Text,
    },
    /// Without a prompt.
    ReadKeychain {
        service: Text,
        account: Text,
    },
    CheckSpelling(List<u16>),
    GuessSpelling(Text),
    LearnSpelling(Text),
    /// With the reason.
    Authenticate(Text),
    AskForAccess(Media),
    RegisterForPush,
    Print(PrintJob),
}

#[repr(C)]
#[derive(Debug)]
pub struct Application {
    pub name: Text,
    pub path: Text,
    pub bundle: Text,
}

#[repr(C)]
#[derive(Debug)]
pub struct Preference {
    pub key: Text,
    pub value: PreferenceValue,
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum PreferenceValue {
    Flag(bool),
    Number(f64),
    Text(Text),
    Array(List<PreferenceValue>),
    Dictionary(List<Preference>),
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum PreferenceCommand {
    Set(Preference),
    SetDefault(Preference),
    Remove(Text),
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum SystemEvent {
    Theme {
        is_dark: bool,
    },
    Settings(SystemSettings),
    OpenUrls(List<Text>),
    Activate {
        has_visible_windows: bool,
    },
    Quit,
    BecameActive,
    ResignedActive,
    SessionEnded,
    Suspend,
    Resume,
    Thermal(ThermalState),
    DisplayAdded(u64),
    DisplayRemoved(u64),
    DisplayChanged(u64),
    AccessibilityChanged {
        is_active: bool,
        has_screen_reader: bool,
    },
    Observed {
        name: Text,
        object: Text,
        info: PreferenceValue,
    },
    Pushed(PreferenceValue),
    Activity {
        step: ActivityStep,
        kind: Text,
        info: PreferenceValue,
        /// The URL or the error.
        detail: Text,
    },
    Notification {
        tag: Text,
        action: Maybe<u32>,
    },
    HotKey(u32),
    Menu {
        item: u32,
        is_by_key: bool,
    },
    Tray {
        id: u32,
        event: TrayEvent,
        at: Point,
    },
}

// ───────────────────────────── the table ─────────────────────────────

#[repr(C, u8)]
#[derive(Debug)]
pub enum Command {
    Start {
        is_headless: bool,
        is_accessory: bool,
    },
    ShutDown {
        is_exiting: bool,
    },
    CreateWindow {
        options: WindowOptions,
        icon: Maybe<List<u8>>,
    },
    Window {
        id: u32,
        command: WindowCommand,
    },
    Synthesize {
        window: u32,
        modifiers: u8,
        input: Synthetic,
    },
    Surface {
        id: u32,
        command: SurfaceCommand,
    },
    /// The platform's menus and input methods are not to see the key that is being handled.
    KeyWasHandled,
    WebView {
        id: u32,
        command: WebViewCommand,
    },
    ShowCover {
        description: Text,
        window: u32,
        surface: u32,
    },
    DiscardCover,
    AssumeScreenReader(bool),
    System(SystemCommand),
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum Request {
    DecodeFont(List<u8>),
    SaveCover(Cover),
    System(SystemRequest),
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum Reply {
    Failed(Text),
    Done,
    /// None if the user has cancelled.
    Paths(List<Text>),
    Button {
        index: Maybe<u32>,
        is_checked: bool,
    },
    Secret(List<u8>),
    NoSecret {
        would_ask: bool,
    },
    Misspelled(List<[u32; 2]>),
    Guesses(List<Text>),
    Token(Text),
    /// Whether the user has gone through with it.
    Agreed(bool),
}

#[repr(C, u8)]
#[derive(Debug)]
pub enum Event {
    Surface {
        id: u32,
        input: Input,
    },
    Window {
        id: u32,
        event: WindowEvent,
    },
    System(SystemEvent),
    Reply {
        id: u32,
        reply: Reply,
    },
    Warning(Text),
    /// The library is of no more use.
    Fatal(Text),
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

/// What `bun_desktop_ui` returns.
#[repr(C)]
pub struct Ui {
    /// Does not wait. A failure is an [`Event::Warning`].
    pub tell: extern "C" fn(Command),
    /// Returns why it has failed.
    pub perform: extern "C" fn(Command) -> Maybe<Text>,
    /// There is one [`Event::Reply`] unless it fails.
    pub request: extern "C" fn(id: u32, Request) -> Maybe<Text>,
    /// Moves up to `capacity` events there, and returns how many.
    pub drain: unsafe extern "C" fn(events: *mut Event, capacity: usize) -> usize,
    /// Runs the UI until it has events, `source` (the event loop's descriptor or completion port, or -1) is ready, or
    /// the time (-1 for no limit) is up. Returns whether there are events.
    pub pump: extern "C" fn(source: isize, timeout_ns: i64, from_tick: bool) -> bool,
    /// Whether there is more than a frame to see to. Does not run the UI.
    pub has_input: extern "C" fn() -> bool,
    /// Draws the windows that waited for their [`Input::Frame`] to be handled.
    pub present: extern "C" fn(),

    pub window_geometry: extern "C" fn(window: u32) -> Outcome<Geometry>,
    pub window_mouse: extern "C" fn(window: u32) -> Outcome<Point>,
    pub window_is_focused: extern "C" fn(window: u32) -> Outcome<bool>,
    pub window_is_minimized: extern "C" fn(window: u32) -> Outcome<bool>,
    /// `NSView*` or the XID.
    pub window_handle: extern "C" fn(window: u32) -> Outcome<u64>,
    /// What screen capture knows it by.
    pub window_number: extern "C" fn(window: u32) -> Outcome<u64>,
    /// Returns how much it takes on the left and on the right.
    pub set_overlay: extern "C" fn(window: u32, Maybe<Overlay>) -> Outcome<[f32; 2]>,

    pub surface_metrics: extern "C" fn(surface: u32) -> Outcome<SurfaceMetrics>,
    pub surface_accepts_text: extern "C" fn(surface: u32) -> Outcome<bool>,
    pub capture: extern "C" fn(surface: u32, Maybe<Rect>) -> Outcome<Bitmap>,

    pub register_font: extern "C" fn(FontFace, FontSource) -> Outcome<u32>,
    pub unregister_font: extern "C" fn(font: u32),
    pub drop_font_scope: extern "C" fn(scope: u32),
    /// Returns whether that may change what is shown.
    pub order_font: extern "C" fn(font: u32, order: u32) -> Outcome<bool>,
    /// Returns false if that takes a while, and is left to [`Request::DecodeFont`].
    pub decode_font: extern "C" fn(List<u8>) -> Outcome<bool>,
    pub font_families: extern "C" fn() -> Outcome<List<Text>>,

    pub decode_bitmap: unsafe extern "C" fn(bytes: *const u8, length: usize) -> Outcome<Bitmap>,
    pub resize_bitmap: extern "C" fn(&Bitmap, width: u32, height: u32) -> Outcome<Bitmap>,
    pub encode_bitmap: extern "C" fn(&Bitmap, ImageFormat, quality: u8) -> Outcome<List<u8>>,

    /// `file` is where the other process leaves what has changed, if there is no channel.
    pub open_web_view: extern "C" fn(file: Maybe<Text>) -> Outcome<u32>,
    /// Returns the descriptor for the other process.
    pub open_frame_channel: extern "C" fn() -> Outcome<i32>,
    pub helper_sources: extern "C" fn() -> HelperSources,

    /// Whether the window that shows the cover is the one that is described. It is closed otherwise.
    pub adopt_cover: extern "C" fn(WindowOptions) -> Outcome<bool>,
    pub end_cover: extern "C" fn(click: Maybe<Point>, keep: List<Rect>) -> Outcome<Uncovered>,
    pub focused_under_cover: extern "C" fn() -> Outcome<Maybe<u32>>,
    /// How many keys went down, and texts were entered.
    pub sent_to_cover: extern "C" fn() -> Outcome<u32>,
    /// Whether the window looks there like the picture.
    pub cover_fits: extern "C" fn(Point) -> Outcome<bool>,

    pub system_state: extern "C" fn() -> Outcome<SystemState>,
    pub system_settings: extern "C" fn() -> Outcome<SystemSettings>,
    /// The primary one is first.
    pub displays: extern "C" fn() -> Outcome<List<Display>>,
    /// Returns whether windows are dark now.
    pub set_theme: extern "C" fn(Theme) -> Outcome<bool>,
    pub cursor_position: extern "C" fn() -> Outcome<Point>,
    pub idle_seconds: extern "C" fn() -> Outcome<f64>,
    pub is_on_battery: extern "C" fn() -> Outcome<bool>,
    pub is_hidden: extern "C" fn() -> Outcome<bool>,
    pub opens_at_login: extern "C" fn() -> Outcome<bool>,
    pub is_trusted_for_accessibility: extern "C" fn(prompts: bool) -> Outcome<bool>,
    pub bounce: extern "C" fn(is_critical: bool) -> Outcome<i32>,
    pub read_clipboard: extern "C" fn(ClipboardPart) -> Outcome<Clipboard>,
    pub tray_bounds: extern "C" fn(tray: u32) -> Outcome<Rect>,
    pub application_for: extern "C" fn(url: Text) -> Outcome<Maybe<Application>>,
    /// A PNG, or nothing.
    pub file_icon: extern "C" fn(path: Text, side: u32) -> Outcome<List<u8>>,
    pub preference: extern "C" fn(key: Text) -> Outcome<Maybe<PreferenceValue>>,
    pub change_preference: extern "C" fn(PreferenceCommand) -> Maybe<Text>,
    pub answer: extern "C" fn(Question) -> Outcome<Maybe<u32>>,
    /// One after the other, without a shell. Returns what the last one has printed.
    pub run_as_root: extern "C" fn(prompt: Text, commands: List<List<Text>>) -> Outcome<Text>,
    pub named_image: extern "C" fn(name: Text) -> Outcome<List<u8>>,
}
