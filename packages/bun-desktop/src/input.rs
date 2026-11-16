//! The platform's input as events for surfaces.

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use gpui::embed::RawKey;
use gpui::{
    App, Bounds, CursorStyle, DispatchEventResult, ExternalPaths, FileDropEvent, InputHandler,
    Keystroke, Modifiers, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels,
    PlatformInput, Point, ScrollDelta, ScrollEvent, TouchPhase, UTF16Selection, Window,
    WindowButton, point, px, size,
};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::abi::Rect;
use crate::bridge::Kind;
use crate::cover;
use crate::frame::{self, Part};
use crate::keys::{self, Chord};
use crate::motion::Motion;
use crate::paint::scene::Scene;
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

    pub fn cursor(&self) -> CursorStyle {
        match self.hovered.get() {
            Target::Nothing => CursorStyle::Arrow,
            Target::Surface(id) => {
                surface::get(id).map_or(CursorStyle::Arrow, |surface| surface.borrow().cursor)
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
    static PRESSED: RefCell<FxHashMap<String, String>> = RefCell::default();
    /// The modifiers that GPUI's `Modifiers` does not have.
    static EXTRA_MODIFIERS: Cell<u8> = const { Cell::new(0) };
    static MAY_TYPE: Cell<bool> = const { Cell::new(false) };
    static WAS_HANDLED: Cell<bool> = const { Cell::new(false) };
}

fn modifier_bits(modifiers: &Modifiers) -> u8 {
    keys::modifier_bits(modifiers) | EXTRA_MODIFIERS.get()
}

fn set_extra_modifier(bit: u8, on: bool) {
    EXTRA_MODIFIERS.set(EXTRA_MODIFIERS.get() & !bit | if on { bit } else { 0 });
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
    set_extra_modifier(keys::ALT_GRAPH, false);
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
        set_extra_modifier(bit & keys::ALT_GRAPH, down);
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
            let at_press = pressed
                .remove(code)
                .filter(|_| cfg!(any(target_os = "macos", target_os = "windows")));
            // These platforms do not say what a released key types.
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
    crate::menu::did_send_key();
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

fn emit_raw_key(raw: RawKey, otherwise: &str) {
    let Some(state) = ACTIVE_WINDOW.get().and_then(|id| window::state(id).ok()) else {
        return;
    };
    let code = keys::dom_code(raw.scan_code);
    let key = keys::key_for_symbol(raw.symbol, code).unwrap_or_else(|| otherwise.to_owned());
    emit_key(
        &state,
        raw.down,
        key,
        code,
        false,
        modifier_bits(&raw.modifiers),
    );
}

pub fn raw_key(raw: RawKey) {
    flush_raw_key();
    let key = keys::key_for_symbol(raw.symbol, keys::dom_code(raw.scan_code));
    match key.as_deref().and_then(keys::modifier_bit) {
        Some(_) => emit_raw_key(raw, ""),
        None => RAW_KEY.set(Some(raw)),
    }
}

/// For a key that GPUI made nothing of.
pub fn flush_raw_key() {
    MAY_TYPE.set(false);
    if let Some(raw) = RAW_KEY.take() {
        emit_raw_key(raw, "Unidentified");
    }
}

pub fn key_was_handled() {
    WAS_HANDLED.set(true);
}

fn key(
    state: &WindowState,
    down: bool,
    keystroke: &Keystroke,
    is_held: bool,
    alt_graph: bool,
) -> DispatchEventResult {
    // Without one, it was reported when the input method acted on it.
    if let Some(raw) = RAW_KEY.take() {
        let code = keys::dom_code(raw.scan_code);
        let key =
            keys::key_for_symbol(raw.symbol, code).unwrap_or_else(|| keys::dom_key(keystroke));
        // GPUI drops Shift from keys that type a symbol with it.
        let modifiers = Modifiers {
            shift: raw.modifiers.shift,
            ..keystroke.modifiers
        };
        let bits = modifier_bits(&modifiers) | if alt_graph { keys::ALT_GRAPH } else { 0 };
        emit_key(state, down, key, code, is_held, bits);
    }
    WAS_HANDLED.set(false);
    host::deliver_events(Duration::ZERO);
    MAY_TYPE.set(down);
    let was_handled = WAS_HANDLED.take();
    DispatchEventResult {
        propagate: !was_handled,
        default_prevented: was_handled,
    }
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
                [0, 1].map(|index| Some((value.get(index)?.as_u64()? as usize).min(text.len())));
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
    let surface = &mut *surface.borrow_mut();
    Some(f(&mut surface.ime, surface.rect))
}

pub fn ime_changed(state: &WindowState, before: &Ime, now: &Ime) {
    if before.is_enabled != now.is_enabled {
        window::refresh(state.id);
    }
    if let Some(handle) =
        window::handle(state.id).filter(|_| now.is_enabled && before.caret != now.caret)
    {
        host::update_window(handle.into(), |window, _| {
            window.invalidate_character_coordinates()
        })
        .ok();
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

fn report_key_taken_by_ime() {
    if let Some(mut raw) = RAW_KEY.take() {
        if cfg!(target_os = "macos") && raw.symbol != u32::MAX {
            raw.symbol = 0;
        }
        emit_raw_key(raw, "Process");
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
        crate::native::hide_cursor_until_it_moves();
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

pub struct TextInput(pub Rc<WindowState>);

impl InputHandler for TextInput {
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut App,
    ) -> Option<UTF16Selection> {
        with_ime(&self.0, |ime, _| UTF16Selection {
            range: ime.selection.clone(),
            reversed: false,
        })
    }

    fn marked_text_range(&mut self, _: &mut Window, _: &mut App) -> Option<Range<usize>> {
        with_ime(&self.0, |ime, _| ime.composing.clone())?
    }

    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut App,
    ) -> Option<String> {
        with_ime(&self.0, |ime, _| {
            let range = ime.clamp(range);
            *adjusted = Some(range.clone());
            String::from_utf16_lossy(&ime.text[range])
        })
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        _: &mut App,
    ) {
        insert_text(&self.0, range, text);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selection: Option<Range<usize>>,
        _: &mut Window,
        _: &mut App,
    ) {
        if with_ime(&self.0, |ime, _| {
            ime.is_enabled && !(text.is_empty() && ime.composing.is_none())
        }) != Some(true)
        {
            return;
        }
        if text.is_empty() {
            return insert_text(&self.0, range, text);
        }
        report_key_taken_by_ime();
        cover::stop_echo();
        MAY_TYPE.set(false);
        let length = text.encode_utf16().count();
        let selection = selection.map_or(length..length, |it| {
            it.start.min(length)..it.end.min(length)
        });
        let range = with_ime(&self.0, |ime, _| {
            let range = range.filter(|range| Some(range) != ime.composing.as_ref());
            let marked = ime.replace(range.clone(), text);
            ime.selection = marked.start + selection.start..marked.start + selection.end;
            ime.composing = Some(marked);
            range
        });
        let event =
            json!({ "t": "compose", "text": text, "selection": [selection.start, selection.end] });
        emit_text_event(&self.0, event, range.flatten());
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut App) {
        if with_ime(&self.0, |ime, _| ime.composing.take().is_some()) == Some(true) {
            emit_text_event(&self.0, json!({ "t": "composeEnd" }), None);
        }
    }

    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        _: &mut Window,
        _: &mut App,
    ) -> Option<Bounds<Pixels>> {
        with_ime(&self.0, |ime, surface| {
            let origin = point(px(surface.x + ime.caret.x), px(surface.y + ime.caret.y));
            Bounds::new(origin, size(px(ime.caret.width), px(ime.caret.height)))
        })
    }

    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut App,
    ) -> Option<usize> {
        with_ime(&self.0, |ime, _| ime.selection.start)
    }

    fn apple_press_and_hold_enabled(&mut self) -> bool {
        with_ime(&self.0, |ime, _| ime.is_enabled).unwrap_or(false)
    }

    fn accepts_text_input(&mut self, _: &mut Window, _: &mut App) -> bool {
        with_ime(&self.0, |ime, _| ime.is_enabled).unwrap_or(false)
    }

    fn prefers_ime_for_printable_keys(&mut self, window: &mut Window, cx: &mut App) -> bool {
        self.accepts_text_input(window, cx)
    }
}

// ───────────────────────────── pointer ─────────────────────────────

fn target_at(state: &WindowState, position: Point<Pixels>) -> Target {
    let (x, y) = (f32::from(position.x), f32::from(position.y));
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
pub fn accepts_first_mouse(state: &WindowState, position: Point<Pixels>) -> bool {
    state.options.borrow().accept_first_mouse
        || matches!(target_at(state, position), Target::Frame(_))
}

/// The surface, the position in it and on the screen, and the modifiers.
fn located(
    state: &WindowState,
    id: u32,
    position: Point<Pixels>,
    modifiers: &Modifiers,
) -> [f64; 6] {
    let (x, y) = (f32::from(position.x), f32::from(position.y));
    let (rect, origin) = (
        surface::get(id)
            .map(|it| it.borrow().rect)
            .unwrap_or_default(),
        state.metrics.get().origin,
    );
    let [x, y, screen_x, screen_y] =
        [x - rect.x, y - rect.y, x + origin.0, y + origin.1].map(f64::from);
    [
        id.into(),
        x,
        y,
        screen_x,
        screen_y,
        modifier_bits(modifiers).into(),
    ]
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

fn emit_mouse(state: &WindowState, action: Mouse, at: [f64; 6], button: u8, clicks: usize) {
    let fields = [
        (action as u8).into(),
        button.into(),
        state.pointer.buttons.get().into(),
        clicks as f64,
    ];
    emit_located(Kind::Mouse, at, fields, action == Mouse::Move);
}

pub fn cursor_changed(state: &WindowState) {
    act(state, |window, cx| {
        window.replace_cursor_style(state.pointer.cursor(), cx)
    });
}

fn hover(state: &WindowState, target: Target, position: Point<Pixels>, modifiers: &Modifiers) {
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

fn button_bit(button: MouseButton) -> u8 {
    [1, 4, 2, 8, 16][usize::from(keys::button_number(button))]
}

fn act(state: &WindowState, f: impl FnOnce(&mut Window, &mut App)) {
    if let Some(handle) = window::handle(state.id) {
        host::update_window(handle.into(), f).ok();
    }
}

fn release_pointer(state: &WindowState) {
    state.pointer.captured.set(None);
    state.pointer.buttons.set(0);
}

fn mouse_down(state: &WindowState, event: &MouseDownEvent) {
    let pointer = &state.pointer;
    let target = pointer
        .captured
        .get()
        .unwrap_or_else(|| target_at(state, event.position));
    hover(state, target, event.position, &event.modifiers);
    pointer.captured.set(Some(target));
    pointer
        .buttons
        .set(pointer.buttons.get() | button_bit(event.button));
    match (target, event.button) {
        (Target::Surface(id), button) => {
            cover::stop_echo();
            if let Some(kept) = state.kept_cover.get().filter(|kept| *kept != id) {
                bridge::emit(json!({ "t": "outside", "s": kept }));
            }
            if surface::is_focusable(id) {
                focus(state, Some(id));
            }
            let at = located(state, id, event.position, &event.modifiers);
            let at = offer(at, |motion, scene, position| {
                button == MouseButton::Left && motion.press(scene, position)
            });
            return emit_mouse(
                state,
                Mouse::Down,
                at,
                keys::button_number(button),
                event.click_count,
            );
        }
        // It hit-tests as the caption.
        (Target::Frame(Part::Drag | Part::Button(_)), _) if cfg!(target_os = "windows") => {}
        (Target::Frame(Part::Button(_)), _) => return window::refresh(state.id),
        (Target::Frame(Part::Edge(edge)), MouseButton::Left) => {
            act(state, |window, _| window.start_window_resize(edge))
        }
        (Target::Frame(Part::Drag), MouseButton::Left) if event.click_count == 2 => {
            act(state, |window, _| {
                if cfg!(target_os = "macos") {
                    window.titlebar_double_click();
                } else if window.is_resizable() {
                    window.zoom_window();
                }
            })
        }
        (Target::Frame(Part::Drag), MouseButton::Right) => {
            act(state, |window, _| window.show_window_menu(event.position))
        }
        _ => return,
    }
    // The window manager has the pointer.
    release_pointer(state);
}

fn mouse_up(state: &WindowState, event: &MouseUpEvent) {
    let (pointer, under) = (&state.pointer, target_at(state, event.position));
    let captured = pointer.captured.get();
    pointer
        .buttons
        .set(pointer.buttons.get() & !button_bit(event.button));
    match captured.unwrap_or(under) {
        Target::Surface(id) => {
            let at = offer(
                located(state, id, event.position, &event.modifiers),
                |motion, _, _| motion.release(),
            );
            emit_mouse(
                state,
                Mouse::Up,
                at,
                keys::button_number(event.button),
                event.click_count,
            );
        }
        Target::Frame(Part::Button(button))
            if captured == Some(under) && event.button == MouseButton::Left =>
        {
            window::refresh(state.id);
            match button {
                WindowButton::Minimize => act(state, |window, _| window.minimize_window()),
                WindowButton::Maximize => act(state, |window, _| window.zoom_window()),
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
            let (position, modifiers) = (event.position, event.modifiers);
            mouse_move(
                state,
                &MouseMoveEvent {
                    position,
                    pressed_button: None,
                    modifiers,
                },
            );
        }
    }
}

fn mouse_move(state: &WindowState, event: &MouseMoveEvent) {
    let pointer = &state.pointer;
    if event.pressed_button.is_none() {
        release_pointer(state);
    }
    if pointer.captured.get() == Some(Target::Frame(Part::Drag)) && pointer.buttons.get() == 1 {
        release_pointer(state);
        if state.options.borrow().movable {
            act(state, |window, _| window.start_window_move());
        }
        return;
    }
    let target = pointer
        .captured
        .get()
        .unwrap_or_else(|| target_at(state, event.position));
    hover(state, target, event.position, &event.modifiers);
    if let Target::Surface(id) = target {
        let at = located(state, id, event.position, &event.modifiers);
        emit_mouse(
            state,
            Mouse::Move,
            offer(at, |motion, _, position| motion.drag(position)),
            0,
            0,
        );
    }
}

fn phase_number(phase: TouchPhase) -> f64 {
    match phase {
        TouchPhase::Started => 0.,
        TouchPhase::Moved => 1.,
        TouchPhase::Ended => 2.,
        TouchPhase::Cancelled => 3.,
    }
}

fn scroll(state: &WindowState, event: &ScrollEvent) {
    const PIXELS_PER_LINE: f32 = if cfg!(target_os = "windows") {
        100. / 3.
    } else {
        40.
    };
    let Target::Surface(id) = target_at(state, event.position) else {
        return;
    };
    let (dx, dy, is_precise) = match event.delta {
        ScrollDelta::Pixels(delta) => (f32::from(delta.x), f32::from(delta.y), true),
        ScrollDelta::Lines(delta) => (delta.x * PIXELS_PER_LINE, delta.y * PIXELS_PER_LINE, false),
    };
    let (at, modifiers) = (
        located(state, id, event.position, &event.modifiers),
        event.modifiers,
    );
    if event.touch_phase == TouchPhase::Started {
        offer(at, |motion, _, _| motion.begin_gesture());
    }
    // There, momentum follows.
    if cfg!(target_os = "macos") && dx == 0. && dy == 0. {
        return;
    }
    let at = offer(at, |motion, scene, position| {
        let delta = if modifiers.shift && dx == 0. {
            [-dy, 0.]
        } else {
            [-dx, -dy]
        }
        .map(|it| it / scene.zoom);
        let (ends, now) = (
            event.touch_phase == TouchPhase::Ended && !cfg!(target_os = "macos"),
            surface::milliseconds(Instant::now()),
        );
        !modifiers.control
            && !modifiers.platform
            && motion.wheel(scene, position, delta, !is_precise, ends, now)
    });
    let fields = [
        (0. - dx).into(),
        (0. - dy).into(),
        is_precise.into(),
        phase_number(event.touch_phase),
    ];
    emit_located(Kind::Wheel, at, fields, false);
}

fn file_drop(state: &WindowState, event: &FileDropEvent) {
    let pointer = &state.pointer;
    let (position, last) = match event {
        FileDropEvent::Entered { position, paths } => {
            pointer.dragged_paths.replace(paths.paths().to_vec());
            (Some(*position), "over")
        }
        FileDropEvent::Pending { .. } if pointer.dragged_paths.borrow().is_empty() => return,
        FileDropEvent::Pending { position } => (Some(*position), "over"),
        FileDropEvent::Submit { position } => (Some(*position), "drop"),
        FileDropEvent::Exited | FileDropEvent::Ended => (None, ""),
    };
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
        let [_, x, y, screen_x, screen_y, _] = located(
            state,
            id,
            position.unwrap_or_default(),
            &Modifiers::default(),
        );
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

/// GPUI gets the pointer's events too: it knows from them where the pointer is.
pub fn handle(state: &WindowState, event: &PlatformInput) -> Option<DispatchEventResult> {
    match event {
        PlatformInput::KeyDown(event) => {
            let modifiers = &event.keystroke.modifiers;
            let alt_graph = event.prefer_character_input && modifiers.control && modifiers.alt;
            return Some(key(state, true, &event.keystroke, event.is_held, alt_graph));
        }
        PlatformInput::KeyUp(event) => {
            return Some(key(state, false, &event.keystroke, false, false));
        }
        PlatformInput::ModifiersChanged(event) => {
            set_extra_modifier(keys::CAPS_LOCK, event.capslock.on)
        }
        PlatformInput::MouseDown(MouseDownEvent {
            button: MouseButton::Navigate(to),
            click_count: 0,
            ..
        }) => {
            let direction = if *to == gpui::NavigationDirection::Back {
                "left"
            } else {
                "right"
            };
            bridge::emit(json!({ "t": "window", "w": state.id, "e": "swipe", "v": direction }));
        }
        PlatformInput::MouseDown(event) => mouse_down(state, event),
        PlatformInput::MouseUp(event) => mouse_up(state, event),
        PlatformInput::MouseMove(event) => mouse_move(state, event),
        PlatformInput::MouseExited(event) if state.pointer.captured.get().is_none() => {
            hover(state, Target::Nothing, event.position, &event.modifiers)
        }
        PlatformInput::Scroll(event) => scroll(state, event),
        PlatformInput::Pinch(event) => {
            if let Target::Surface(id) = target_at(state, event.position) {
                let fields = [event.delta.into(), phase_number(event.phase), 0., 0.];
                emit_located(
                    Kind::Pinch,
                    located(state, id, event.position, &event.modifiers),
                    fields,
                    false,
                );
            }
        }
        PlatformInput::FileDrop(event) => {
            file_drop(state, event);
            return Some(DispatchEventResult {
                propagate: false,
                default_prevented: true,
            });
        }
        _ => {}
    }
    None
}

/// `webContents.sendInputEvent()`
pub fn synthesize(state: &WindowState, event: &Value) -> Result<()> {
    let number = |key: &str| event[key].as_f64().unwrap_or(0.) as f32;
    let content = state.metrics.get().content;
    let position = point(px(content.x + number("x")), px(content.y + number("y")));
    let modifiers = keys::modifiers_from_bits(event["m"].as_u64().unwrap_or(0));
    let button = keys::button_from_number(event["button"].as_u64().unwrap_or(0));
    let click_count = event["clickCount"].as_u64().unwrap_or(1) as usize;
    match event["type"].as_str().unwrap_or("") {
        "mouseDown" => mouse_down(
            state,
            &MouseDownEvent {
                button,
                position,
                modifiers,
                click_count,
                first_mouse: false,
            },
        ),
        "mouseUp" => mouse_up(
            state,
            &MouseUpEvent {
                button,
                position,
                modifiers,
                click_count,
            },
        ),
        "mouseMove" => {
            let pressed_button = (state.pointer.buttons.get() != 0).then_some(button);
            mouse_move(
                state,
                &MouseMoveEvent {
                    position,
                    pressed_button,
                    modifiers,
                },
            )
        }
        "mouseLeave" => hover(state, Target::Nothing, position, &modifiers),
        "mouseWheel" => {
            let delta = ScrollDelta::Pixels(point(px(-number("deltaX")), px(-number("deltaY"))));
            scroll(
                state,
                &ScrollEvent {
                    position,
                    delta,
                    modifiers,
                    ..ScrollEvent::default()
                },
            )
        }
        kind @ ("keyDown" | "keyUp") => {
            let key = match event["key"].as_str() {
                Some(key) => key.to_owned(),
                None => {
                    let mut keystroke = Chord::parse(&event["chord"])
                        .context("the key is missing")?
                        .keystroke();
                    keystroke.key_char = event["text"].as_str().map(str::to_owned);
                    keys::dom_key(&keystroke)
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
            let paths = ExternalPaths(files.filter_map(Value::as_str).map(PathBuf::from).collect());
            file_drop(state, &FileDropEvent::Entered { position, paths });
            file_drop(state, &FileDropEvent::Submit { position });
        }
        other => bail!("unknown input event {other}"),
    }
    Ok(())
}
