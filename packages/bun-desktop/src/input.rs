//! The platform's input as events for surfaces.

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::abi::Rect;
use crate::bridge::Kind;
use crate::cover;
use crate::error::{Context as _, Result, bail};
use crate::frame::{self, Part};
use crate::hash::FastMap;
use crate::json::{Value, json};
use crate::keys;
use crate::motion::Motion;
use crate::paint::scene::Scene;
use crate::platform::{Cursor, Input, Modifiers, Phase, Point, RawKey, Window, WindowButton};
use crate::window::{self, WindowState};
use crate::{accessibility, bridge, host, surface};

#[derive(Clone, Copy, Default, PartialEq)]
enum Target {
    #[default]
    Nothing,
    Surface(u32),
    Frame(Part),
}

#[derive(Default)]
pub struct Pointer {
    hovered: Cell<Target>,
    captured: Cell<Option<Target>>,
    buttons: Cell<u8>,
    dragged_over: Cell<Option<u32>>,
    dragged_paths: RefCell<Vec<PathBuf>>,
}

impl Pointer {
    pub fn hovered_part(&self) -> Option<Part> {
        match self.hovered.get() {
            Target::Frame(part) => Some(part),
            _ => None,
        }
    }

    pub fn is_pressed(&self) -> bool {
        self.buttons.get() == 1
    }

    pub fn cursor(&self) -> Cursor {
        match self.hovered.get() {
            Target::Nothing => Cursor::Arrow,
            Target::Surface(id) => {
                surface::get(id).map_or(Cursor::Arrow, |surface| surface.borrow().cursor)
            }
            Target::Frame(part) => frame::cursor(part),
        }
    }
}

thread_local! {
    static ACTIVE_WINDOW: Cell<Option<u32>> = const { Cell::new(None) };
    /// Until it is known what becomes of it.
    static RAW_KEY: Cell<Option<RawKey>> = const { Cell::new(None) };
    /// The `key` of each `code` that is down.
    static PRESSED: RefCell<FastMap<String, String>> = RefCell::default();
    static MAY_TYPE: Cell<bool> = const { Cell::new(false) };
    static WAS_HANDLED: Cell<bool> = const { Cell::new(false) };
}

// ───────────────────────────── focus ─────────────────────────────

fn emit_focus(surface: Option<u32>, event: &str) {
    if let Some(surface) = surface {
        bridge::emit(json!({ "t": event, "s": surface }));
    }
}

pub fn focus(state: &WindowState, surface: Option<u32>) {
    let before = state.focused_surface.replace(surface);
    if before != surface {
        if state.is_active.get() {
            emit_focus(before, "blur");
            emit_focus(surface, "focus");
        }
        window::refresh(state.id);
        act(state, |window| window.text_input_changed());
        accessibility::update(state);
    }
}

pub fn activation_changed(state: &WindowState, is_active: bool) {
    if state.is_active.replace(is_active) == is_active {
        return;
    }
    if is_active {
        ACTIVE_WINDOW.set(Some(state.id));
    }
    PRESSED.take();
    emit_focus(
        state.focused_surface.get(),
        if is_active { "focus" } else { "blur" },
    );
}

pub fn forget_surface(state: &WindowState, id: u32) {
    if state.pointer.hovered.get() == Target::Surface(id) {
        state.pointer.hovered.set(Target::Nothing);
    }
    if state.pointer.captured.get() == Some(Target::Surface(id)) {
        state.pointer.captured.set(Some(Target::Nothing));
    }
    if state.focused_surface.get() == Some(id) {
        let next = state
            .surfaces
            .borrow()
            .iter()
            .copied()
            .find(|it| surface::is_focusable(*it));
        focus(state, next);
    }
}

// ───────────────────────────── keys ─────────────────────────────

fn emit_key(
    state: &WindowState,
    down: bool,
    mut key: String,
    code: &str,
    is_held: bool,
    mut bits: u8,
) {
    if let Some(bit) = keys::modifier_bit(&key) {
        bits = if down { bits | bit } else { bits & !bit };
    }
    let was_down = PRESSED.with_borrow_mut(|pressed| match down {
        // It does not report keys that are released while Command is down.
        true if cfg!(target_os = "macos") && bits & 8 != 0 => false,
        true => pressed.insert(code.to_owned(), key.clone()).is_some(),
        false => {
            if cfg!(target_os = "macos") && key == "Meta" {
                pressed.clear();
            }
            let at_press = pressed.remove(code).filter(|_| cfg!(target_os = "macos"));
            // It does not say what a released key types.
            key = at_press
                .filter(|key| key != "Process")
                .unwrap_or(std::mem::take(&mut key));
            false
        }
    });
    let Some(surface) = state.key_target() else {
        return;
    };
    if down && state.cover.get().is_some() {
        cover::key_down(&key, bits);
    }
    #[cfg(target_os = "macos")]
    crate::platform::macos::did_send_key();
    let is_repeat = is_held || (was_down && !code.is_empty());
    let is_composing = with_ime(state, |ime, _| ime.composing.is_some()).unwrap_or(false);
    let (key, location, code) = (
        bridge::name(&key),
        keys::location(code).into(),
        bridge::name(code),
    );
    let fields = [
        surface.into(),
        down.into(),
        key,
        code,
        location,
        is_repeat.into(),
        bits.into(),
        is_composing.into(),
    ];
    bridge::emit_numbers(Kind::Key, &fields, false);
}

fn emit_raw_key(raw: RawKey) {
    let Some(state) = ACTIVE_WINDOW.get().and_then(|id| window::state(id).ok()) else {
        return;
    };
    let code = keys::dom_code(raw.scan_code);
    let key = keys::key_for_symbol(raw.symbol, code).unwrap_or_else(|| "Unidentified".to_owned());
    emit_key(&state, raw.down, key, code, raw.is_repeat, raw.modifiers);
}

pub fn raw_key(raw: RawKey) {
    flush_raw_key();
    let key = keys::key_for_symbol(raw.symbol, keys::dom_code(raw.scan_code));
    match key.as_deref().and_then(keys::modifier_bit) {
        Some(_) => emit_raw_key(raw),
        None => RAW_KEY.set(Some(raw)),
    }
}

/// For a key that nothing was made of.
pub fn flush_raw_key() {
    MAY_TYPE.set(false);
    if let Some(raw) = RAW_KEY.take() {
        emit_raw_key(raw);
    }
}

pub fn key_was_handled() {
    WAS_HANDLED.set(true);
}

/// The input method has no use for the last `raw_key`. Returns whether JavaScript has dealt with it.
pub fn key(down: bool) -> bool {
    flush_raw_key();
    WAS_HANDLED.set(false);
    host::deliver_events(Duration::ZERO);
    MAY_TYPE.set(down);
    WAS_HANDLED.take()
}

// ───────────────────────────── text ─────────────────────────────

/// What the input method gets to know about the focused field. Offsets are in UTF-16 code units.
#[derive(Default)]
pub struct Ime {
    is_enabled: bool,
    text: Vec<u16>,
    selection: Range<usize>,
    composing: Option<Range<usize>>,
    caret: Rect,
}

impl Ime {
    pub fn is_enabled(&self) -> bool {
        self.is_enabled
    }

    pub fn caret_in_empty_field(&self) -> Option<Rect> {
        (self.is_enabled && self.text.is_empty()).then_some(self.caret)
    }

    pub fn parse(value: &Value) -> Ime {
        let text: Vec<u16> = value["text"]
            .as_str()
            .unwrap_or("")
            .encode_utf16()
            .collect();
        let range = |value: &Value| {
            let [a, b] =
                [0, 1].map(|index| Some((value[index].as_u64()? as usize).min(text.len())));
            Some(a?.min(b?)..a?.max(b?))
        };
        let number = |key: &str| value["rect"][key].as_f64().unwrap_or(0.) as f32;
        Ime {
            is_enabled: value["enabled"] == true,
            selection: range(&value["selection"]).unwrap_or_default(),
            composing: range(&value["composing"]),
            caret: Rect {
                x: number("x"),
                y: number("y"),
                width: number("width"),
                height: number("height"),
            },
            text,
        }
    }

    /// For news from before JavaScript saw what the input method did.
    pub fn keep_text_of(&mut self, before: &Ime) {
        if self.is_enabled && before.is_enabled {
            self.text.clone_from(&before.text);
            (self.selection, self.composing) = (before.selection.clone(), before.composing.clone());
        }
    }

    fn clamp(&self, range: Range<usize>) -> Range<usize> {
        let end = range.end.min(self.text.len());
        range.start.min(end)..end
    }

    /// The input method asks about the result before JavaScript has seen the event. Returns where `text` is.
    fn replace(&mut self, range: Option<Range<usize>>, text: &str) -> Range<usize> {
        let composing = self.composing.take();
        let range = self.clamp(range.or(composing).unwrap_or(self.selection.clone()));
        let kept = self.text.len() - range.len();
        self.text.splice(range.clone(), text.encode_utf16());
        let end = range.start + self.text.len() - kept;
        self.selection = end..end;
        range.start..end
    }
}

fn with_ime<R>(state: &WindowState, f: impl FnOnce(&mut Ime, Rect) -> R) -> Option<R> {
    let surface = surface::get(state.key_target()?)?;
    let surface = &mut *surface.try_borrow_mut().ok()?;
    Some(f(&mut surface.ime, surface.rect))
}

pub fn ime_changed(state: &WindowState, before: &Ime, surface: u32) {
    let has_changed = surface::get(surface).is_some_and(|it| {
        let now = &it.borrow().ime;
        before.is_enabled != now.is_enabled
            || now.is_enabled && (before.caret, &before.composing) != (now.caret, &now.composing)
    });
    if has_changed {
        act(state, |window| window.text_input_changed());
    }
}

fn emit_text_event(state: &WindowState, mut event: Value, range: Option<Range<usize>>) {
    bridge::will_edit_text();
    event["s"] = json!(state.key_target());
    if let Some(range) = range {
        event["range"] = json!([range.start, range.end]);
    }
    bridge::emit(event);
}

pub fn report_key_taken_by_ime() {
    let Some(raw) = RAW_KEY.take() else { return };
    let code = keys::dom_code(raw.scan_code);
    let key = keys::key_for_symbol(raw.symbol, code).filter(|key| key == "Dead");
    if let Some(state) = ACTIVE_WINDOW.get().and_then(|id| window::state(id).ok()) {
        emit_key(
            &state,
            raw.down,
            key.unwrap_or_else(|| "Process".to_owned()),
            code,
            raw.is_repeat,
            raw.modifiers,
        );
    }
}

fn insert_text(state: &WindowState, range: Option<Range<usize>>, text: &str) {
    report_key_taken_by_ime();
    let Some(was_composing) = with_ime(state, |ime, _| ime.composing.is_some()) else {
        return;
    };
    let is_typed = MAY_TYPE.take() && !was_composing;
    if is_typed && text.contains(char::is_control) {
        return;
    }
    #[cfg(target_os = "macos")]
    if is_typed && with_ime(state, |ime, _| ime.is_enabled) == Some(true) {
        crate::platform::macos::hide_cursor_until_it_moves();
    }
    let range = with_ime(state, |ime, _| {
        let range = range.filter(|range| Some(range) != ime.composing.as_ref());
        ime.replace(range.clone(), text);
        ime.composing = None;
        range
    });
    if state.cover.get().is_some() {
        cover::typed(text, matches!(range, Some(None)));
    }
    match (range.flatten(), state.key_target()) {
        (None, Some(surface)) if is_typed && text.chars().count() == 1 => {
            bridge::will_edit_text();
            bridge::emit_numbers(Kind::Text, &[surface.into(), bridge::name(text)], false)
        }
        (range, _) => emit_text_event(
            state,
            json!({ "t": "text", "text": text, "key": is_typed }),
            range,
        ),
    }
    if was_composing {
        emit_text_event(state, json!({ "t": "composeEnd" }), None);
    }
}

/// The focused field of the window with this id.
#[derive(Clone, Copy)]
pub struct TextInput(pub u32);

impl TextInput {
    fn with<R>(self, f: impl FnOnce(&mut Ime, Rect) -> R) -> Option<R> {
        with_ime(&*window::state(self.0).ok()?, f)
    }

    pub fn is_enabled(self) -> bool {
        self.with(|ime, _| ime.is_enabled) == Some(true)
    }

    pub fn selection(self) -> Option<Range<usize>> {
        self.with(|ime, _| ime.selection.clone())
    }

    pub fn composing(self) -> Option<Range<usize>> {
        self.with(|ime, _| ime.composing.clone())?
    }

    /// With the range that it is really from.
    pub fn text(self, range: Range<usize>) -> Option<(Vec<u16>, Range<usize>)> {
        self.with(|ime, _| {
            (
                ime.text[ime.clamp(range.clone())].to_vec(),
                ime.clamp(range),
            )
        })
    }

    /// In the window.
    pub fn caret(self) -> Option<Rect> {
        self.with(|ime, surface| Rect {
            x: surface.x + ime.caret.x,
            y: surface.y + ime.caret.y,
            ..ime.caret
        })
    }

    pub fn insert(self, range: Option<Range<usize>>, text: &str) {
        if let Ok(state) = window::state(self.0) {
            insert_text(&state, range, text);
        }
    }

    /// `selection` is in `text`.
    pub fn compose(self, range: Option<Range<usize>>, text: &str, selection: Option<Range<usize>>) {
        let Ok(state) = window::state(self.0) else {
            return;
        };
        if self.with(|ime, _| ime.is_enabled && !(text.is_empty() && ime.composing.is_none()))
            != Some(true)
        {
            return;
        }
        if text.is_empty() {
            return insert_text(&state, range, text);
        }
        MAY_TYPE.set(false);
        report_key_taken_by_ime();
        cover::stop_echo();
        let length = text.encode_utf16().count();
        let selection = selection.map_or(length..length, |it| {
            it.start.min(length)..it.end.min(length)
        });
        let range = self.with(|ime, _| {
            let range = range.filter(|range| Some(range) != ime.composing.as_ref());
            let marked = ime.replace(range.clone(), text);
            ime.selection = marked.start + selection.start..marked.start + selection.end;
            ime.composing = Some(marked);
            range
        });
        let event =
            json!({ "t": "compose", "text": text, "selection": [selection.start, selection.end] });
        emit_text_event(&state, event, range.flatten());
    }

    /// What is being composed stays as it is.
    pub fn end_composition(self) {
        if let (Ok(state), Some(true)) = (
            window::state(self.0),
            self.with(|ime, _| ime.composing.take().is_some()),
        ) {
            emit_text_event(&state, json!({ "t": "composeEnd" }), None);
        }
    }
}

// ───────────────────────────── pointer ─────────────────────────────

fn target_at(state: &WindowState, position: Point) -> Target {
    let Point { x, y } = position;
    if let Some(part) = frame::part_at(&state.metrics.get(), &state.frame_buttons.borrow(), x, y) {
        return Target::Frame(part);
    }
    let surfaces = surface::shown_in(state);
    let mut from_the_top = surfaces.iter().rev().map(|surface| surface.borrow());
    let hit = from_the_top.find(|it| {
        it.is_visible
            && !it.is_passthrough
            && surface::contains(it.rect, x, y)
            && (state.kept_cover.get() != Some(it.id) || cover::keeps(x, y))
    });
    match hit {
        Some(surface) if surface.is_drag_region(x, y) => Target::Frame(Part::Drag),
        Some(surface) => Target::Surface(surface.id),
        None => Target::Nothing,
    }
}

#[cfg(target_os = "macos")]
pub fn accepts_first_mouse(state: &WindowState, position: Point) -> bool {
    state.options.borrow().accept_first_mouse
        || matches!(target_at(state, position), Target::Frame(_))
}

/// The surface, the position in it and on the screen, and the modifiers.
fn located(state: &WindowState, id: u32, position: Point, modifiers: Modifiers) -> [f64; 6] {
    let Point { x, y } = position;
    let (rect, origin) = (
        surface::get(id)
            .map(|it| it.borrow().rect)
            .unwrap_or_default(),
        state.metrics.get().origin,
    );
    let [x, y, screen_x, screen_y] =
        [x - rect.x, y - rect.y, x + origin.0, y + origin.1].map(f64::from);
    [id.into(), x, y, screen_x, screen_y, modifiers.into()]
}

/// Adds a bit to the modifiers if the engine is not to scroll.
fn offer(mut at: [f64; 6], f: impl FnOnce(&mut Motion, &Scene, [f32; 2]) -> bool) -> [f64; 6] {
    if surface::with_motion(at[0] as u32, at[1], at[2], f) {
        at[5] += 256.;
    }
    at
}

fn emit_located(
    kind: Kind,
    [a, b, c, d, e, f]: [f64; 6],
    [g, h, i, j]: [f64; 4],
    is_replaceable: bool,
) {
    bridge::emit_numbers(kind, &[a, b, c, d, e, f, g, h, i, j], is_replaceable);
}

#[derive(Clone, Copy, PartialEq)]
enum Mouse {
    Move,
    Down,
    Up,
    Leave,
}

fn emit_mouse(state: &WindowState, action: Mouse, at: [f64; 6], button: u8, clicks: u32) {
    surface::change_motion(at[0] as u32, |motion| {
        motion.release_wheel();
        if action == Mouse::Down {
            motion.report_scrolls(at[0] as u32);
        }
    });
    let fields = [
        (action as u8).into(),
        button.into(),
        state.pointer.buttons.get().into(),
        clicks.into(),
    ];
    emit_located(Kind::Mouse, at, fields, action == Mouse::Move);
}

pub fn cursor_changed(state: &WindowState) {
    act(state, |window| window.set_cursor(state.pointer.cursor()));
}

fn hover(state: &WindowState, target: Target, position: Point, modifiers: Modifiers) {
    let before = state.pointer.hovered.replace(target);
    if before != target {
        if let Target::Surface(id) = before {
            emit_mouse(
                state,
                Mouse::Leave,
                located(state, id, position, modifiers),
                0,
                0,
            );
        }
        cursor_changed(state);
        if [before, target]
            .iter()
            .any(|it| matches!(it, Target::Frame(Part::Button(_))))
        {
            window::refresh(state.id);
        }
    }
}

const LEFT: u8 = 0;
const RIGHT: u8 = 2;

fn button_bit(button: u8) -> u8 {
    [1, 4, 2, 8, 16][usize::from(button.min(4))]
}

fn act(state: &WindowState, f: impl FnOnce(&dyn Window)) {
    if let Some(window) = window::platform_window(state.id) {
        f(&*window);
    }
}

fn toggle_maximized(window: &dyn Window) {
    bridge::report(
        window
            .command("maximize", &json!(!window.geometry().is_maximized), None)
            .map(drop),
    );
}

fn release_pointer(state: &WindowState) {
    state.pointer.captured.set(None);
    state.pointer.buttons.set(0);
}

fn mouse_down(state: &WindowState, position: Point, button: u8, clicks: u32, modifiers: Modifiers) {
    let pointer = &state.pointer;
    let target = pointer
        .captured
        .get()
        .unwrap_or_else(|| target_at(state, position));
    hover(state, target, position, modifiers);
    pointer.captured.set(Some(target));
    pointer
        .buttons
        .set(pointer.buttons.get() | button_bit(button));
    match (target, button) {
        (Target::Surface(id), button) => {
            cover::stop_echo();
            if let Some(kept) = state.kept_cover.get().filter(|kept| *kept != id) {
                bridge::emit(json!({ "t": "outside", "s": kept }));
            }
            if surface::is_focusable(id) {
                focus(state, Some(id));
            }
            let at = located(state, id, position, modifiers);
            let at = offer(at, |motion, scene, position| {
                button == LEFT && motion.press(scene, position)
            });
            return emit_mouse(state, Mouse::Down, at, button, clicks);
        }
        (Target::Frame(Part::Button(_)), _) => return window::refresh(state.id),
        (Target::Frame(Part::Edge(edge)), LEFT) => act(state, |window| window.start_resize(edge)),
        (Target::Frame(Part::Drag), LEFT) if clicks == 2 => {
            act(state, |window| window.title_was_double_clicked())
        }
        (Target::Frame(Part::Drag), RIGHT) => {
            act(state, |window| window.show_window_menu(position))
        }
        _ => return,
    }
    // The window manager has the pointer.
    release_pointer(state);
}

fn mouse_up(state: &WindowState, position: Point, pressed: u8, clicks: u32, modifiers: Modifiers) {
    let (pointer, under) = (&state.pointer, target_at(state, position));
    let captured = pointer.captured.get();
    pointer
        .buttons
        .set(pointer.buttons.get() & !button_bit(pressed));
    match captured.unwrap_or(under) {
        Target::Surface(id) => {
            let at = offer(located(state, id, position, modifiers), |motion, _, _| {
                motion.release()
            });
            emit_mouse(state, Mouse::Up, at, pressed, clicks);
        }
        Target::Frame(Part::Button(button)) if captured == Some(under) && pressed == LEFT => {
            window::refresh(state.id);
            match button {
                WindowButton::Minimize => act(state, |window| {
                    bridge::report(window.command("minimize", &Value::Null, None).map(drop))
                }),
                WindowButton::Maximize => act(state, toggle_maximized),
                WindowButton::Close => {
                    bridge::emit(json!({ "t": "window", "w": state.id, "e": "close" }))
                }
            }
        }
        _ => {}
    }
    if pointer.buttons.get() == 0 {
        pointer.captured.set(None);
        if captured.is_some_and(|captured| captured != under) {
            mouse_move(state, position, false, modifiers);
        }
    }
}

fn mouse_move(state: &WindowState, position: Point, is_pressed: bool, modifiers: Modifiers) {
    let pointer = &state.pointer;
    if !is_pressed {
        release_pointer(state);
    }
    if pointer.captured.get() == Some(Target::Frame(Part::Drag)) && pointer.buttons.get() == 1 {
        release_pointer(state);
        if state.options.borrow().movable {
            act(state, |window| window.start_move());
        }
        return;
    }
    let target = pointer
        .captured
        .get()
        .unwrap_or_else(|| target_at(state, position));
    hover(state, target, position, modifiers);
    if let Target::Surface(id) = target {
        let at = located(state, id, position, modifiers);
        emit_mouse(
            state,
            Mouse::Move,
            offer(at, |motion, _, position| motion.drag(position)),
            0,
            0,
        );
    }
}

fn scroll(
    state: &WindowState,
    position: Point,
    delta: Point,
    is_precise: bool,
    phase: Phase,
    modifiers: Modifiers,
) {
    const PIXELS_PER_LINE: f32 = 40.;
    let Target::Surface(id) = target_at(state, position) else {
        return;
    };
    let [dx, dy] = [delta.x, delta.y].map(|it| if is_precise { it } else { it * PIXELS_PER_LINE });
    let at = located(state, id, position, modifiers);
    if phase == Phase::Started {
        offer(at, |motion, _, _| motion.begin_gesture());
    }
    #[cfg(target_os = "macos")]
    if phase == Phase::Started && surface::with_motion(id, at[1], at[2], Motion::expect_scrolling) {
        window::refresh(state.id);
    }
    // There, momentum follows.
    if cfg!(target_os = "macos") && dx == 0. && dy == 0. {
        return;
    }
    let at = offer(at, |motion, scene, position| {
        let delta = if modifiers & keys::SHIFT != 0 && dx == 0. {
            [-dy, 0.]
        } else {
            [-dx, -dy]
        }
        .map(|it| it / scene.zoom);
        let (ends, now) = (
            phase == Phase::Ended && !cfg!(target_os = "macos"),
            surface::milliseconds(Instant::now()),
        );
        modifiers & (keys::CONTROL | keys::META) == 0
            && motion.wheel(scene, position, delta, !is_precise, ends, now)
    });
    let fields = [
        (0. - dx).into(),
        (0. - dy).into(),
        is_precise.into(),
        (phase as u8).into(),
    ];
    if at[5] >= 256. {
        let ([a, b, c, d, e, f], [g, h, i, j]) = (at, fields);
        surface::change_motion(a as u32, |motion| {
            motion.report_wheel(
                [a, b, c, d, e, f, g, h, i, j],
                surface::milliseconds(Instant::now()),
            )
        });
        #[cfg(target_os = "macos")]
        if is_precise && crate::host::has_scrolled(state.id) {
            return;
        }
        return surface::catch_up(a as u32);
    }
    crate::diagnostics::note(crate::diagnostics::Incident::WheelLeftToScript);
    surface::change_motion(at[0] as u32, Motion::release_wheel);
    emit_located(Kind::Wheel, at, fields, false);
}

/// `last` is "over", "drop", or "" without a position.
fn drag_files(state: &WindowState, position: Option<Point>, last: &str) {
    let pointer = &state.pointer;
    if pointer.dragged_paths.borrow().is_empty() {
        return;
    }
    let target = position.and_then(|position| match target_at(state, position) {
        Target::Surface(id) => Some(id),
        _ => None,
    });
    let event = |kind: &str, id: u32| {
        let paths: Vec<_> = pointer
            .dragged_paths
            .borrow()
            .iter()
            .map(|it| it.to_string_lossy().into_owned())
            .collect();
        let [_, x, y, screen_x, screen_y, _] = located(state, id, position.unwrap_or_default(), 0);
        json!({ "t": "drag", "e": kind, "s": id, "x": x, "y": y, "sx": screen_x, "sy": screen_y, "paths": paths })
    };
    let before = pointer.dragged_over.replace(target);
    if before != target {
        before
            .into_iter()
            .for_each(|id| bridge::emit(event("leave", id)));
        target
            .into_iter()
            .for_each(|id| bridge::emit(event("enter", id)));
    }
    match target {
        Some(id) if last == "drop" => {
            bridge::emit(event(last, id));
            pointer.dragged_over.set(None);
        }
        Some(id) => bridge::emit_latest(event(last, id)),
        None => {}
    }
    if last != "over" {
        pointer.dragged_paths.take();
    }
}

pub fn handle(window: u32, event: Input) {
    let Ok(state) = window::state(window) else {
        return;
    };
    let state = &*state;
    match event {
        Input::MouseDown {
            at,
            button,
            clicks,
            modifiers,
        } => mouse_down(state, at, button, clicks, modifiers),
        Input::MouseUp {
            at,
            button,
            clicks,
            modifiers,
        } => mouse_up(state, at, button, clicks, modifiers),
        Input::MouseMove {
            at,
            is_pressed,
            modifiers,
        } => mouse_move(state, at, is_pressed, modifiers),
        Input::MouseLeave { .. } if state.pointer.captured.get().is_some() => {}
        Input::MouseLeave { at, modifiers } => hover(state, Target::Nothing, at, modifiers),
        Input::Scroll {
            at,
            delta,
            is_precise,
            phase,
            modifiers,
        } => scroll(state, at, delta, is_precise, phase, modifiers),
        Input::Pinch {
            at,
            delta,
            phase,
            modifiers,
        } => {
            if let Target::Surface(id) = target_at(state, at) {
                let fields = [delta.into(), (phase as u8).into(), 0., 0.];
                emit_located(
                    Kind::Pinch,
                    located(state, id, at, modifiers),
                    fields,
                    false,
                );
            }
        }
        Input::DragEnter { at, paths } => {
            state.pointer.dragged_paths.replace(paths);
            drag_files(state, Some(at), "over");
        }
        Input::DragOver { at } => drag_files(state, Some(at), "over"),
        Input::Drop { at } => drag_files(state, Some(at), "drop"),
        Input::DragLeave => drag_files(state, None, ""),
    }
}

/// `webContents.sendInputEvent()`
pub fn synthesize(state: &WindowState, event: &Value) -> Result<()> {
    let number = |key: &str| event[key].as_f64().unwrap_or(0.) as f32;
    let content = state.metrics.get().content;
    let position = Point {
        x: content.x + number("x"),
        y: content.y + number("y"),
    };
    let modifiers = event["m"].as_u64().unwrap_or(0) as u8 & 15;
    let button = event["button"].as_u64().filter(|it| *it <= 4).unwrap_or(0) as u8;
    let clicks = event["clickCount"].as_u64().unwrap_or(1) as u32;
    match event["type"].as_str().unwrap_or("") {
        "mouseDown" => mouse_down(state, position, button, clicks, modifiers),
        "mouseUp" => mouse_up(state, position, button, clicks, modifiers),
        "mouseMove" => mouse_move(state, position, state.pointer.buttons.get() != 0, modifiers),
        "mouseLeave" => hover(state, Target::Nothing, position, modifiers),
        "mouseWheel" => {
            let delta = Point {
                x: -number("deltaX"),
                y: -number("deltaY"),
            };
            scroll(state, position, delta, true, Phase::Moved, modifiers)
        }
        kind @ ("keyDown" | "keyUp") => {
            let key = match event["key"].as_str() {
                Some(key) => key.to_owned(),
                None => {
                    let name = event["chord"][0].as_str().context("the key is missing")?;
                    keys::dom_key(
                        name,
                        event["chord"][1].as_u64().unwrap_or(0) as u8,
                        event["text"].as_str(),
                    )
                }
            };
            let code = event["code"]
                .as_str()
                .map_or_else(|| keys::code_for_key(&key), str::to_owned);
            let bits = event["m"]
                .as_u64()
                .or(event["chord"][1].as_u64())
                .unwrap_or(0) as u8;
            emit_key(
                state,
                kind == "keyDown",
                key,
                &code,
                event["repeat"] == true,
                bits,
            );
            if let Some(text) = event["text"].as_str().filter(|_| kind == "keyDown") {
                MAY_TYPE.set(true);
                insert_text(state, None, text);
            }
        }
        "char" => insert_text(
            state,
            None,
            event["text"].as_str().context("the text is missing")?,
        ),
        "drop" => {
            let files = event["files"].as_array().into_iter().flatten();
            let paths = files.filter_map(Value::as_str).map(PathBuf::from).collect();
            handle(
                state.id,
                Input::DragEnter {
                    at: position,
                    paths,
                },
            );
            handle(state.id, Input::Drop { at: position });
        }
        other => bail!("unknown input event {other}"),
    }
    Ok(())
}
