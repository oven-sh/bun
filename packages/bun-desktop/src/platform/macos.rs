//! AppKit, through the Objective-C in `macos/`.

use std::cell::Cell;
use std::ffi::{CStr, CString, c_char, c_void};
use std::ops::{Deref, Range};
use std::ptr::NonNull;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::{Cursor, Display, Edge, Geometry, Icon, Input, Phase, Platform, Point, RawKey, Window};
use crate::abi::Rect;
use crate::error::{Context as _, Result, bail};
use crate::input::{self, TextInput};
use crate::json::{Serialize as _, Value, json, parse};
use crate::window::{self, Options};
use crate::{Bytes, accessibility, bridge, guard};

#[repr(u8)]
enum Action {
    Close,
    Hide,
    Show,
    ShowAndFocus,
    TextInputChanged,
    StartMove,
    TitleWasDoubleClicked,
}

unsafe extern "C" {
    safe fn bd_retain(object: NonNull<c_void>);
    fn bd_release(object: NonNull<c_void>);
    safe fn bd_create_application();
    safe fn bd_is_accessory() -> bool;
    safe fn bd_finish_launching();
    safe fn bd_launch(is_accessory: bool);
    safe fn bd_shut_down();
    safe fn bd_is_dark() -> bool;
    safe fn bd_set_dark(is_dark: i32);
    safe fn bd_did_send_key();
    safe fn bd_hide_cursor_until_it_moves();
    fn bd_displays(displays: *mut Display, capacity: usize) -> usize;
    fn bd_command(name: *const c_char, json: *const u8, length: usize, reply: u64) -> *mut c_char;
    fn bd_window_open(json: *const u8, length: usize) -> Option<Object>;
    fn bd_window_command(
        view: &c_void,
        name: *const c_char,
        json: *const u8,
        length: usize,
        other: u32,
    ) -> *mut c_char;
    safe fn bd_window_act(view: &c_void, action: Action);
    safe fn bd_window_geometry(view: &c_void) -> Geometry;
    safe fn bd_window_frequency(view: &c_void) -> f32;
    safe fn bd_window_mouse(view: &c_void) -> Rect;
    safe fn bd_window_set_cursor(view: &c_void, cursor: Cursor);
    fn bd_window_set_tree(view: &c_void, json: *const u8, length: usize);
    safe fn bd_window_is_active(view: &c_void) -> bool;
    safe fn bd_window_is_visible(view: &c_void) -> bool;
    safe fn bd_window_request_frame(view: &c_void, is_leisurely: bool);
    safe fn bd_window_layer(view: &c_void) -> *mut c_void;
    safe fn bd_window_fit_backdrop(view: &c_void, edges: &mut [f64; 2]);
    safe fn bd_window_content_view(view: &c_void) -> *mut c_void;
}

/// A reference to one of Objective-C or Core Foundation.
#[repr(transparent)]
pub struct Object(NonNull<c_void>);

impl Deref for Object {
    type Target = c_void;

    fn deref(&self) -> &c_void {
        // SAFETY: it is alive.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for Object {
    fn clone(&self) -> Object {
        bd_retain(self.0);
        Object(self.0)
    }
}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: this is what has the reference.
        unsafe { bd_release(self.0) };
    }
}

/// # Safety
/// It is from `malloc`, and nobody else frees it.
pub unsafe fn take_string(string: *mut c_char) -> String {
    // SAFETY: the caller's contract.
    unsafe {
        let copy = CStr::from_ptr(string).to_string_lossy().into_owned();
        libc::free(string.cast());
        copy
    }
}

/// # Safety
/// It is what `answer` in app.m returned.
pub unsafe fn answer(json: *mut c_char) -> Result<Value> {
    if json.is_null() {
        return Ok(Value::Null);
    }
    // SAFETY: the caller's contract.
    let mut answer = parse(unsafe { take_string(json) }.as_bytes())?;
    match answer["error"].as_str() {
        Some(error) => bail!("{error}"),
        None => Ok(answer["value"].take()),
    }
}

/// Before anything else asks for it.
pub fn create_application() -> bool {
    let is_wanted = std::env::var("BUN_DESKTOP_HEADLESS").as_deref() != Ok("1");
    if is_wanted {
        bd_create_application();
    }
    is_wanted
}

pub fn is_accessory() -> bool {
    bd_is_accessory()
}

pub fn did_send_key() {
    bd_did_send_key();
}

pub fn hide_cursor_until_it_moves() {
    bd_hide_cursor_until_it_moves();
}

pub fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    let (name, json) = (CString::new(name)?, arguments.to_string());
    // SAFETY: the strings outlive the call.
    unsafe {
        answer(bd_command(
            name.as_ptr(),
            json.as_ptr(),
            json.len(),
            reply.unwrap_or(0),
        ))
    }
}

pub fn finish_launching() {
    bd_finish_launching();
}

pub fn start(is_accessory: bool) -> Result<Box<dyn Platform>> {
    bd_launch(is_accessory);
    if !crate::host::thread::exists() {
        finish_launching();
    }
    Ok(Box::new(AppKit))
}

struct AppKit;

impl Platform for AppKit {
    fn name(&self) -> &'static str {
        ""
    }

    fn open_window(&self, options: &Options, _: Option<&Icon>) -> Result<Rc<dyn Window>> {
        let json = options.to_json().to_string();
        // SAFETY: as above.
        let view = unsafe { bd_window_open(json.as_ptr(), json.len()) }
            .context("the window could not be opened")?;
        Ok(Rc::new(View {
            view,
            last_drawn: Cell::new(None),
        }))
    }

    fn displays(&self) -> Vec<Display> {
        let mut displays = vec![Display::default(); 32];
        // SAFETY: the buffer and its length.
        let count = unsafe { bd_displays(displays.as_mut_ptr(), displays.len()) };
        displays.truncate(count);
        displays
    }

    fn is_dark(&self) -> bool {
        bd_is_dark()
    }

    fn set_dark(&self, is_dark: Option<bool>) {
        bd_set_dark(is_dark.map_or(-1, i32::from));
    }

    fn command(&self, name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
        command(name, arguments, reply)
    }

    fn shut_down(&self, _: bool) {
        bd_shut_down();
    }
}

struct View {
    view: Object,
    last_drawn: Cell<Option<Instant>>,
}

impl Window for View {
    fn geometry(&self) -> Geometry {
        bd_window_geometry(&self.view)
    }

    fn is_active(&self) -> bool {
        bd_window_is_active(&self.view)
    }

    fn is_visible(&self) -> bool {
        bd_window_is_visible(&self.view)
    }

    fn refresh_interval(&self) -> Option<Duration> {
        self.last_drawn.set(Some(Instant::now()));
        let frequency = bd_window_frequency(&self.view);
        (frequency > 0.).then(|| Duration::from_secs_f32(1. / frequency))
    }

    fn mouse_position(&self) -> Point {
        let Rect { x, y, .. } = bd_window_mouse(&self.view);
        Point { x, y }
    }

    fn set_visible(&self, is_visible: bool, takes_focus: bool) {
        bd_window_act(
            &self.view,
            match (is_visible, takes_focus) {
                (false, _) => Action::Hide,
                (true, false) => Action::Show,
                (true, true) => Action::ShowAndFocus,
            },
        );
    }

    fn close(&self) {
        bd_window_act(&self.view, Action::Close);
    }

    fn request_frame(&self) {
        bd_window_request_frame(&self.view, false);
    }

    fn request_leisurely_frame(&self) {
        bd_window_request_frame(&self.view, true);
    }

    fn can_present(&self) -> Option<bool> {
        const MIN_INTERVAL: Duration = Duration::from_millis(1);
        Some(
            self.last_drawn
                .get()
                .is_none_or(|it| it.elapsed() >= MIN_INTERVAL),
        )
    }

    fn layer(&self) -> *mut c_void {
        bd_window_layer(&self.view)
    }

    fn fit_backdrop(&self, mut edges: [f64; 2]) -> [f64; 2] {
        bd_window_fit_backdrop(&self.view, &mut edges);
        edges
    }

    fn set_cursor(&self, cursor: Cursor) {
        bd_window_set_cursor(&self.view, cursor);
    }

    fn text_input_changed(&self) {
        bd_window_act(&self.view, Action::TextInputChanged);
    }

    fn start_move(&self) {
        bd_window_act(&self.view, Action::StartMove);
    }

    fn start_resize(&self, _: Edge) {}

    fn show_window_menu(&self, _: Point) {}

    fn title_was_double_clicked(&self) {
        bd_window_act(&self.view, Action::TitleWasDoubleClicked);
    }

    fn set_accessibility_tree(&self, tree: &accessibility::Update) {
        let json =
            json!({ "roots": tree.roots, "nodes": tree.nodes, "focus": tree.focus }).to_string();
        // SAFETY: as above.
        unsafe { bd_window_set_tree(&self.view, json.as_ptr(), json.len()) };
    }

    fn command(&self, name: &str, value: &Value, other: Option<&dyn Window>) -> Result<Value> {
        let (name, json) = (CString::new(name)?, value.to_string());
        let other = other.and(value.as_u64()).unwrap_or(0) as u32;
        // SAFETY: as above.
        unsafe {
            answer(bd_window_command(
                &self.view,
                name.as_ptr(),
                json.as_ptr(),
                json.len(),
                other,
            ))
        }
    }

    fn handle(&self) -> u64 {
        bd_window_content_view(&self.view) as u64
    }
}

// ───────────────────────────── bridge.h ─────────────────────────────

/// # Safety
/// It is terminated.
unsafe fn borrow<'a>(string: *const c_char) -> std::borrow::Cow<'a, str> {
    // SAFETY: the caller's contract.
    unsafe { CStr::from_ptr(string) }.to_string_lossy()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_emit(json: *const u8, length: usize) {
    // SAFETY: the bytes of an `NSData`.
    let event = parse(unsafe { crate::borrow(json, length) });
    guard("error", (), || event.into_iter().for_each(bridge::emit));
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_log(message: *const c_char) {
    // SAFETY: a string.
    crate::diagnostics::log!("error: {}", unsafe { borrow(message) });
}

#[unsafe(no_mangle)]
extern "C" fn bd_window_event(id: u32, event: u8) {
    guard("error", (), || match event {
        0 => window::frame_is_due(id),
        1 => window::bounds_changed(id),
        2 => window::was_resized(id),
        3 | 4 => window::activation_changed(id, event == 3),
        5 => window::visibility_changed(id),
        6 => window::close_requested(id),
        7 => window::was_closed(id),
        8 => window::appearance_changed(),
        _ => accessibility::set_active(id, event == 9),
    });
}

#[repr(C)]
struct Event {
    kind: u8,
    button: u8,
    modifiers: u8,
    phase: Phase,
    flag: bool,
    clicks: u32,
    x: f32,
    y: f32,
    delta_x: f32,
    delta_y: f32,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_input(window: u32, event: &Event, paths: *const c_char) {
    let Event {
        button,
        modifiers,
        phase,
        flag,
        clicks,
        x,
        y,
        delta_x,
        delta_y,
        ..
    } = *event;
    let at = Point { x, y };
    let event = match event.kind {
        0 => Input::MouseDown {
            at,
            button,
            clicks,
            modifiers,
        },
        1 => Input::MouseUp {
            at,
            button,
            clicks,
            modifiers,
        },
        2 => Input::MouseMove {
            at,
            is_pressed: flag,
            modifiers,
        },
        3 => Input::MouseLeave { at, modifiers },
        4 => Input::Scroll {
            at,
            delta: Point {
                x: delta_x,
                y: delta_y,
            },
            is_precise: flag,
            phase,
            modifiers,
        },
        5 => Input::Pinch {
            at,
            delta: delta_x,
            phase,
            modifiers,
        },
        6 => {
            // SAFETY: this kind comes with them.
            let paths = parse(unsafe { borrow(paths) }.as_bytes()).unwrap_or_default();
            let paths = paths
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str);
            Input::DragEnter {
                at,
                paths: paths.map(Into::into).collect(),
            }
        }
        7 => Input::DragOver { at },
        8 => Input::Drop { at },
        _ => Input::DragLeave,
    };
    guard("error", (), || input::handle(window, event));
}

#[unsafe(no_mangle)]
extern "C" fn bd_accepts_first_mouse(window: u32, x: f32, y: f32) -> bool {
    guard("error", true, || {
        window::state(window).is_ok_and(|state| input::accepts_first_mouse(&state, Point { x, y }))
    })
}

#[unsafe(no_mangle)]
extern "C" fn bd_raw_key(down: bool, is_repeat: bool, scan_code: u32, symbol: u32, modifiers: u8) {
    guard("error", (), || {
        input::raw_key(RawKey {
            down,
            is_repeat,
            scan_code,
            symbol,
            modifiers,
        })
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_trace(step: *const c_char, seconds_since_event: f64) {
    // SAFETY: a string.
    crate::diagnostics::trace!(
        "{}, {:.2} ms after the event",
        unsafe { borrow(step) },
        seconds_since_event * 1000.
    );
}

#[unsafe(no_mangle)]
extern "C" fn bd_key(down: bool) -> bool {
    guard("error", false, || input::key(down))
}

#[unsafe(no_mangle)]
extern "C" fn bd_key_was_taken() {
    guard("error", (), input::report_key_taken_by_ime);
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Span {
    start: i64,
    end: i64,
}

impl Span {
    fn new(range: Option<Range<usize>>) -> Span {
        range.map_or(Span { start: -1, end: -1 }, |it| Span {
            start: it.start as i64,
            end: it.end as i64,
        })
    }

    fn get(self) -> Option<Range<usize>> {
        (self.start >= 0).then_some(self.start as usize..self.end as usize)
    }
}

#[unsafe(no_mangle)]
extern "C" fn bd_text_is_enabled(window: u32) -> bool {
    TextInput(window).is_enabled()
}

#[unsafe(no_mangle)]
extern "C" fn bd_text_range(window: u32, composing: bool) -> Span {
    Span::new(if composing {
        TextInput(window).composing()
    } else {
        TextInput(window).selection()
    })
}

#[unsafe(no_mangle)]
extern "C" fn bd_text_caret(window: u32) -> Rect {
    TextInput(window).caret().unwrap_or_default()
}

#[unsafe(no_mangle)]
extern "C" fn bd_text(window: u32, range: &mut Span) -> Bytes {
    let (text, found) = range
        .get()
        .and_then(|range| TextInput(window).text(range))
        .unwrap_or_default();
    *range = Span::new(Some(found));
    text.into_iter()
        .flat_map(u16::to_ne_bytes)
        .collect::<Vec<_>>()
        .into()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_text_insert(window: u32, range: Span, text: *const c_char) {
    // SAFETY: a string.
    guard("error", (), || {
        TextInput(window).insert(range.get(), &unsafe { borrow(text) })
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_text_compose(
    window: u32,
    range: Span,
    text: *const c_char,
    selection: Span,
) {
    // SAFETY: a string.
    guard("error", (), || {
        TextInput(window).compose(range.get(), &unsafe { borrow(text) }, selection.get())
    });
}

#[unsafe(no_mangle)]
extern "C" fn bd_text_end_composition(window: u32) {
    guard("error", (), || TextInput(window).end_composition());
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_accessibility_action(
    node: u64,
    action: *const c_char,
    json: *const c_char,
) {
    // SAFETY: strings.
    let (action, json) = unsafe { (borrow(action), borrow(json)) };
    accessibility::perform(node, &action, parse(json.as_bytes()).unwrap_or_default());
}
