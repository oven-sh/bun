//! AppKit, through the Objective-C in `macos/`.

mod accessibility;

use std::cell::Cell;
use std::ffi::{CStr, c_char, c_void};
use std::ops::{Deref, Range};
use std::ptr::NonNull;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::{Cursor, Display, Edge, Geometry, Icon, Input, Phase, Platform, Point, RawKey, Window};
use crate::abi::Rect;
use crate::error::{Context as _, Result, bail};
use crate::gfx::Pixmap;
use crate::input::{self, TextInput};
use crate::protocol::{
    Application, BackdropPart, Clipboard, ClipboardPart, Dragged, Event as Queued, List, Maybe,
    PreferenceCommand, PreferenceValue, Reply, SystemCommand, SystemEvent, SystemRequest,
    SystemSettings, SystemState, Text, WindowCommand, WindowEvent,
};
use crate::window::{self, Options};
use crate::{bridge, guard};

#[repr(u8)]
enum Action {
    Close,
    Hide,
    Show,
    ShowAndFocus,
    TextInputChanged,
    StartMove,
    TitleWasDoubleClicked,
    ClaimBackground,
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
    safe fn bd_command(command: &SystemCommand) -> *mut c_char;
    safe fn bd_request(reply: u32, request: &SystemRequest) -> *mut c_char;
    safe fn bd_state() -> SystemState;
    safe fn bd_settings() -> SystemSettings;
    safe fn bd_cursor_position() -> Point;
    safe fn bd_idle_seconds() -> f64;
    safe fn bd_is_on_battery() -> bool;
    safe fn bd_is_hidden() -> bool;
    safe fn bd_opens_at_login() -> bool;
    safe fn bd_is_trusted_for_accessibility(prompts: bool) -> bool;
    safe fn bd_bounce(is_critical: bool) -> i32;
    safe fn bd_tray_bounds(tray: u32) -> Rect;
    safe fn bd_read_clipboard(part: ClipboardPart, empty: &mut Clipboard);
    fn bd_application_for(url: *const u8, length: usize, nothing: &mut Maybe<Application>);
    fn bd_file_icon(path: *const u8, length: usize, side: u32) -> List<u8>;
    fn bd_named_image(name: *const u8, length: usize) -> List<u8>;
    safe fn bd_preference(key: &Text, nothing: &mut Maybe<PreferenceValue>);
    safe fn bd_answer(question: &crate::protocol::Question) -> Maybe<u32>;
    safe fn bd_run_as_root(
        prompt: &Text,
        commands: &List<List<Text>>,
        said: &mut Text,
    ) -> *mut c_char;
    safe fn bd_change_preference(command: &PreferenceCommand) -> *mut c_char;
    safe fn bd_window_open(options: &Options) -> Option<Object>;
    safe fn bd_window_command(view: &c_void, command: &WindowCommand) -> *mut c_char;
    safe fn bd_window_is_minimized(view: &c_void) -> bool;
    safe fn bd_window_number(view: &c_void) -> u64;
    safe fn bd_window_describe_backdrop(view: &c_void) -> List<BackdropPart>;
    fn bd_window_imitate_backdrop(view: &c_void, parts: *const BackdropPart, count: usize);
    safe fn bd_window_act(view: &c_void, action: Action);
    safe fn bd_window_geometry(view: &c_void) -> Geometry;
    safe fn bd_window_frequency(view: &c_void) -> f32;
    safe fn bd_window_mouse(view: &c_void) -> Rect;
    safe fn bd_window_set_cursor(view: &c_void, cursor: Cursor);
    fn bd_window_begin_drag(
        view: &c_void,
        dragged: &Dragged,
        rgba: *const u8,
        width: u32,
        height: u32,
    );
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
/// It is what `attempt` in app.m returned.
pub unsafe fn failure(message: *mut c_char) -> Result<()> {
    if !message.is_null() {
        // SAFETY: the caller's contract.
        bail!("{}", unsafe { take_string(message) });
    }
    Ok(())
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

pub fn request(id: u32, request: &SystemRequest) -> Result<()> {
    // SAFETY: from `attempt`.
    unsafe { failure(bd_request(id, request)) }
}

pub fn preference(key: &Text) -> Maybe<PreferenceValue> {
    let mut found = Maybe::No;
    bd_preference(key, &mut found);
    found
}

pub fn answer(question: &crate::protocol::Question) -> Maybe<u32> {
    bd_answer(question)
}

pub fn run_as_root(prompt: &Text, commands: &List<List<Text>>) -> Result<Text> {
    let mut said = Text::default();
    // SAFETY: from `attempt`.
    unsafe { failure(bd_run_as_root(prompt, commands, &mut said)) }.map(|()| said)
}

pub fn change_preference(command: &PreferenceCommand) -> Result<()> {
    // SAFETY: from `attempt`.
    unsafe { failure(bd_change_preference(command)) }
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
    fn open_window(&self, options: &Options, _: Option<&Icon>) -> Result<Rc<dyn Window>> {
        let view = bd_window_open(options).context("the window could not be opened")?;
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

    fn command(&self, command: SystemCommand) -> Result<()> {
        // SAFETY: from `attempt`.
        unsafe { failure(bd_command(&command)) }
    }

    fn request(&self, id: u32, it: SystemRequest) -> Result<()> {
        request(id, &it)
    }

    fn state(&self) -> SystemState {
        bd_state()
    }

    fn settings(&self) -> SystemSettings {
        bd_settings()
    }

    fn cursor_position(&self) -> Result<Point> {
        Ok(bd_cursor_position())
    }

    fn idle_seconds(&self) -> Result<f64> {
        Ok(bd_idle_seconds())
    }

    fn is_on_battery(&self) -> bool {
        bd_is_on_battery()
    }

    fn is_hidden(&self) -> bool {
        bd_is_hidden()
    }

    fn opens_at_login(&self) -> bool {
        bd_opens_at_login()
    }

    fn is_trusted_for_accessibility(&self, prompts: bool) -> bool {
        bd_is_trusted_for_accessibility(prompts)
    }

    fn bounce(&self, is_critical: bool) -> i32 {
        bd_bounce(is_critical)
    }

    fn tray_bounds(&self, tray: u32) -> Rect {
        bd_tray_bounds(tray)
    }

    fn read_clipboard(&self, part: ClipboardPart) -> Clipboard {
        let mut contents = Clipboard::default();
        bd_read_clipboard(part, &mut contents);
        contents
    }

    fn application_for(&self, url: &str) -> Option<Application> {
        let mut found = Maybe::No;
        // SAFETY: the parts of a string.
        unsafe { bd_application_for(url.as_ptr(), url.len(), &mut found) };
        found.get()
    }

    fn file_icon(&self, path: &str, side: u32) -> Vec<u8> {
        // SAFETY: as above.
        unsafe { bd_file_icon(path.as_ptr(), path.len(), side) }.into_vec()
    }

    fn named_image(&self, name: &str) -> Vec<u8> {
        // SAFETY: as above.
        unsafe { bd_named_image(name.as_ptr(), name.len()) }.into_vec()
    }

    fn has_screen_reader(&self) -> bool {
        accessibility::has_screen_reader()
    }

    fn accessibility_changed(&self, events: &[crate::accessibility::Event]) {
        accessibility::post(events);
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

    fn begin_drag(&self, dragged: &Dragged, image: Option<&Pixmap>) {
        let (rgba, width, height) = image.map_or((std::ptr::null(), 0, 0), |it| {
            (it.data().as_ptr(), it.width(), it.height())
        });
        // SAFETY: there are that many pixels, which it copies.
        unsafe { bd_window_begin_drag(&self.view, dragged, rgba, width, height) };
    }

    fn claim_background(&self) {
        bd_window_act(&self.view, Action::ClaimBackground);
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

    fn command(&self, command: &WindowCommand) -> Result<()> {
        // SAFETY: from `attempt`.
        unsafe { failure(bd_window_command(&self.view, command)) }
    }

    fn is_minimized(&self) -> bool {
        bd_window_is_minimized(&self.view)
    }

    fn number(&self) -> u64 {
        bd_window_number(&self.view)
    }

    fn describe_backdrop(&self) -> Vec<BackdropPart> {
        bd_window_describe_backdrop(&self.view).into_vec()
    }

    fn imitate_backdrop(&self, parts: &[BackdropPart]) {
        // SAFETY: the parts of a slice.
        unsafe { bd_window_imitate_backdrop(&self.view, parts.as_ptr(), parts.len()) };
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

/// The allocators do not care for the alignment of what is freed.
#[unsafe(no_mangle)]
extern "C" fn bd_allocate(count: usize, size: usize) -> *mut c_void {
    Box::leak(vec![0u64; (count * size).div_ceil(8)].into_boxed_slice())
        .as_mut_ptr()
        .cast()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_emit(event: *const SystemEvent) {
    // SAFETY: it moves.
    guard("error", (), || bridge::emit_system(unsafe { event.read() }));
}

#[unsafe(no_mangle)]
extern "C" fn bd_emit_to_window(id: u32, event: &WindowEvent) {
    guard("error", (), || {
        bridge::emit(Queued::Window { id, event: *event })
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_reply(id: u32, reply: *const Reply) {
    // SAFETY: it moves.
    guard("error", (), || {
        bridge::reply(id, Ok(unsafe { reply.read() }))
    });
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
        _ => window::appearance_changed(),
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
extern "C" fn bd_input(window: u32, event: &Event, paths: List<Text>) {
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
            modifiers,
        },
        6 => Input::DragEnter {
            at,
            paths: paths.iter().map(|it| (**it).into()).collect(),
        },
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
extern "C" fn bd_text_is_secret(window: u32) -> bool {
    TextInput(window).is_secret()
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
extern "C" fn bd_text(window: u32, range: &mut Span) -> List<u16> {
    let (text, found) = range
        .get()
        .and_then(|range| TextInput(window).text(range))
        .unwrap_or_default();
    *range = Span::new(Some(found));
    text.into()
}

#[unsafe(no_mangle)]
extern "C" fn bd_free_units(_: List<u16>) {}

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
