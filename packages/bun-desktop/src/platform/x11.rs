//! Linux and FreeBSD. Wayland compositors are talked to through Xwayland.

mod atom;
mod cursor;
mod dbus;
mod desktop;
mod displays;
mod ibus;
mod keyboard;
mod keysyms;
mod pixels;
mod pointer;
mod selection;
mod tray;
mod window;
mod wire;

use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use self::keyboard::{Composer, HotKey, Keymap, Sequence};
pub use self::keysyms::keysym_to_char;
use self::window::Window;
use self::wire::{Bytes as _, Connection, Extension, Request};
use super::{Cursor, Display, Icon, Platform, RawKey, WindowButton};
use crate::error::{Context as _, Result};
use crate::input::{self, TextInput};
use crate::json::{Value, json};
use crate::window::Options;
use crate::{app, bridge};

mod event {
    pub const KEY_PRESS: u8 = 2;
    pub const KEY_RELEASE: u8 = 3;
    pub const FOCUS_IN: u8 = 9;
    pub const FOCUS_OUT: u8 = 10;
    pub const EXPOSE: u8 = 12;
    pub const VISIBILITY: u8 = 15;
    pub const DESTROY: u8 = 17;
    pub const UNMAP: u8 = 18;
    pub const MAP: u8 = 19;
    pub const CONFIGURE: u8 = 22;
    pub const PROPERTY: u8 = 28;
    pub const SELECTION_CLEAR: u8 = 29;
    pub const SELECTION_REQUEST: u8 = 30;
    pub const SELECTION: u8 = 31;
    pub const MESSAGE: u8 = 33;
    pub const MAPPING: u8 = 34;
}

mod mask {
    pub const KEYS: u32 = 3;
    pub const EXPOSURE: u32 = 0x8000;
    pub const VISIBILITY: u32 = 0x1_0000;
    pub const STRUCTURE: u32 = 0x2_0000;
    pub const FOR_MANAGER: u32 = 0x8_0000 | 0x10_0000;
    pub const FOCUS: u32 = 0x20_0000;
    pub const PROPERTY: u32 = 0x40_0000;
}

struct X11 {
    x: Connection,
    atoms: Vec<u32>,
    xkb: Extension,
    xinput: Extension,
    randr: Option<Extension>,
    sync: Option<Extension>,
    pointer_events: u32,
    /// Owns selections.
    helper: u32,
    /// Of the last input.
    time: Cell<u32>,
    has_ended: Cell<bool>,
    windows: RefCell<Vec<Rc<Window>>>,
    settings_selection: u32,
    settings_owner: Cell<u32>,
    settings: RefCell<displays::Settings>,
    scale: Cell<f32>,
    displays: RefCell<Vec<Display>>,
    supported: RefCell<Option<Vec<u32>>>,
    cursors: RefCell<Option<cursor::Cursors>>,
    keymap: RefCell<Option<Keymap>>,
    last_pressed: Cell<u8>,
    composer: OnceCell<Option<Composer>>,
    /// What is shown for the sequence so far.
    sequence: RefCell<String>,
    input_method: OnceCell<Option<Rc<ibus::InputMethod>>>,
    text_input_changed: Cell<bool>,
    hot_keys: RefCell<Vec<HotKey>>,
    pointer: pointer::Pointer,
    selections: selection::Selections,
    desktop: desktop::Desktop,
}

pub fn start(_is_accessory: bool) -> Result<Box<dyn Platform>> {
    let x = Connection::open()?;
    let extensions =
        ["XKEYBOARD", "XInputExtension", "RANDR", "SYNC"].map(|name| x.ask_for_extension(name));
    let atoms: Vec<_> = atom::NAMES
        .iter()
        .map(|name| x.ask_for_atom(name))
        .collect();
    let settings_selection = x.ask_for_atom(&format!("_XSETTINGS_S{}", x.screen.number));
    x.flush();
    let desktop = desktop::Desktop::connect();
    let [xkb, xinput, randr, sync] = extensions.map(|it| x.extension(it));
    let (xkb, xinput) = xkb
        .zip(xinput)
        .context("the display does not have XKEYBOARD and XInput")?;
    let (atoms, settings_selection) = (
        atoms.into_iter().map(|it| x.atom(it)).collect(),
        x.atom(settings_selection),
    );
    keyboard::start(&x, xkb);
    if let Some(randr) = randr {
        x.forget(x.ask(Request::new(randr.opcode, 0).words(&[1, 5])));
        x.send(Request::new(randr.opcode, 4).words(&[x.screen.root, 7]));
    }
    if let Some(sync) = sync {
        x.forget(x.ask(Request::new(sync.opcode, 0).bytes(&[3, 1])));
    }
    let helper = x.new_id();
    let create = Request::new(1, 0)
        .words(&[helper, x.screen.root, 0])
        .u16(1)
        .u16(1)
        .u16(0)
        .u16(2);
    x.send(create.words(&[0, 0x800, mask::PROPERTY]));
    x.select_events(x.screen.root, mask::PROPERTY | mask::STRUCTURE);
    let pointer_events = pointer::start(&x, xinput)?;
    let x11: &'static X11 = Box::leak(Box::new(X11 {
        x,
        atoms,
        xkb,
        xinput,
        randr,
        sync,
        pointer_events,
        helper,
        time: Cell::default(),
        has_ended: Cell::default(),
        windows: RefCell::default(),
        settings_selection,
        settings_owner: Cell::default(),
        settings: RefCell::default(),
        scale: Cell::new(1.),
        displays: RefCell::default(),
        supported: RefCell::default(),
        cursors: RefCell::default(),
        keymap: RefCell::default(),
        last_pressed: Cell::default(),
        composer: OnceCell::new(),
        sequence: RefCell::default(),
        input_method: OnceCell::new(),
        text_input_changed: Cell::default(),
        hot_keys: RefCell::default(),
        pointer: pointer::Pointer::default(),
        selections: selection::Selections::default(),
        desktop,
    }));
    x11.read_settings();
    x11.displays.replace(displays::read(x11));
    Ok(Box::new(x11))
}

impl X11 {
    fn atom(&self, name: atom::Name) -> u32 {
        self.atoms[name as usize]
    }

    fn window(&self, xid: u32) -> Option<Rc<Window>> {
        self.windows
            .borrow()
            .iter()
            .find(|it| it.xid == xid)
            .cloned()
    }

    fn active_window(&self) -> Option<Rc<Window>> {
        self.windows
            .borrow()
            .iter()
            .find(|it| it.is_active.get())
            .cloned()
    }

    fn all_windows(&self) -> Vec<Rc<Window>> {
        self.windows.borrow().clone()
    }

    fn forget(&self, window: &Window) {
        self.windows.borrow_mut().retain(|it| it.xid != window.xid);
        self.text_input_changed.set(true);
    }

    fn manager_supports(&self, name: atom::Name) -> bool {
        let read = || {
            self.x
                .words(self.x.screen.root, self.atom(atom::_NET_SUPPORTED))
        };
        self.supported
            .borrow_mut()
            .get_or_insert_with(read)
            .contains(&self.atom(name))
    }

    fn frequency_at(&self, x: f32, y: f32) -> f32 {
        let displays = self.displays.borrow();
        let found = displays
            .iter()
            .find(|it| crate::surface::contains(it.bounds, x, y));
        found.or(displays.first()).map_or(0., |it| it.frequency)
    }

    fn cursor(&self, cursor: Cursor) -> u32 {
        let load = || {
            let settings = self.settings.borrow();
            let theme = settings
                .get("Gtk/CursorThemeName")
                .or(settings.get("Xcursor.theme"))
                .map(String::from);
            let size = std::env::var("XCURSOR_SIZE")
                .ok()
                .and_then(|it| it.parse().ok());
            let size = size
                .or(settings.number("Xcursor.size"))
                .or(settings.number("Gtk/CursorThemeSize"));
            let theme = std::env::var("XCURSOR_THEME").ok().or(theme);
            cursor::Cursors::new(
                &self.x,
                theme,
                size.unwrap_or(24. * self.scale.get()) as u32,
            )
        };
        self.cursors
            .borrow_mut()
            .get_or_insert_with(load)
            .get(&self.x, cursor)
    }

    fn read_settings(&self) {
        let resources = self
            .x
            .ask_for_property(self.x.screen.root, atom::RESOURCE_MANAGER, false);
        let (owner, mut settings) = (
            self.x.selection_owner(self.settings_selection),
            displays::Settings::default(),
        );
        settings.add_resources(self.x.property(resources));
        if owner != 0 {
            self.x.select_events(owner, mask::PROPERTY);
            let property =
                self.x
                    .ask_for_property(owner, self.atom(atom::_XSETTINGS_SETTINGS), false);
            settings.add_xsettings(self.x.property(property));
        }
        self.settings_owner.set(owner);
        self.scale.set(settings.scale());
        self.settings.replace(settings);
    }

    fn settings_changed(&self) {
        self.read_settings();
        self.displays_changed();
        self.cursors.take();
        for window in self.all_windows() {
            window.reload_cursor();
            crate::window::bounds_changed(window.id);
        }
        crate::window::appearance_changed();
    }

    fn displays_changed(&self) {
        let now = displays::read(self);
        let before = self.displays.replace(now.clone());
        let metrics = |it: &Display| (it.bounds, it.work_area, it.scale, it.frequency);
        for display in &now {
            match before.iter().find(|it| it.id == display.id) {
                None => app::event("display-added", display.id.into()),
                Some(old) if metrics(old) != metrics(display) => {
                    app::event("display-metrics-changed", display.id.into())
                }
                Some(_) => {}
            }
        }
        for display in before
            .iter()
            .filter(|old| now.iter().all(|it| it.id != old.id))
        {
            app::event("display-removed", display.id.into());
        }
    }

    // ───────────────────────────── keys ─────────────────────────────

    fn with_keymap<R>(&self, f: impl FnOnce(&Keymap) -> R) -> R {
        let read = || {
            Keymap::read(
                &self
                    .x
                    .reply(Keymap::ask(&self.x, self.xkb))
                    .unwrap_or_default(),
            )
        };
        f(self.keymap.borrow_mut().get_or_insert_with(read))
    }

    fn update_input_method(&'static self) {
        let window = self
            .active_window()
            .filter(|it| TextInput(it.id).is_enabled());
        let focus = window.and_then(|window| {
            let (caret, [left, top, ..]) = (TextInput(window.id).caret()?, window.area.get());
            let [x, y, width, height] = [caret.x, caret.y, caret.width, caret.height]
                .map(|it| (it * self.scale.get()) as i32);
            Some((window.id, [left + x, top + y, width, height]))
        });
        let method = match focus {
            Some(_) => self.input_method.get_or_init(|| {
                ibus::InputMethod::connect(|window, symbol, scan_code, state| {
                    let down = state & ibus::RELEASED == 0;
                    let modifiers = keyboard::modifiers(state as u16);
                    input::raw_key(RawKey {
                        down,
                        is_repeat: false,
                        scan_code,
                        symbol,
                        modifiers,
                    });
                    self.type_key(window, down, symbol, state as u16);
                })
            }),
            None => self.input_method.get().unwrap_or(&None),
        };
        method.iter().for_each(|it| it.set_focus(focus));
    }

    fn end_sequence(&self) {
        self.sequence.take();
        self.composer
            .get()
            .into_iter()
            .flatten()
            .for_each(Composer::reset);
    }

    /// Returns whether the key is a part of one.
    fn continue_sequence(&self, input: TextInput, symbol: u32) -> bool {
        if self.sequence.borrow().is_empty()
            && !(keyboard::starts_sequence(symbol) && input.is_enabled())
        {
            return false;
        }
        let Some(composer) = self.composer.get_or_init(Composer::load) else {
            return false;
        };
        let sequence = composer.feed(symbol);
        input::flush_raw_key();
        match sequence {
            Sequence::Nothing => return false,
            Sequence::Continues => {
                self.sequence
                    .borrow_mut()
                    .extend(keyboard::placeholder(symbol));
                let shown = self.sequence.borrow().clone();
                input.compose(None, &shown, None);
            }
            Sequence::Typed(text) => {
                self.end_sequence();
                input.insert(None, &text);
            }
            Sequence::Cancelled => {
                self.end_sequence();
                input.insert(None, "");
            }
        }
        true
    }

    fn type_key(&self, window: u32, down: bool, symbol: u32, state: u16) {
        if down && self.continue_sequence(TextInput(window), symbol) {
            return;
        }
        let is_shortcut = state & (keyboard::CONTROL | keyboard::ALT | keyboard::SUPER) != 0;
        if !input::key(down) && down && !is_shortcut {
            let typed = keysym_to_char(symbol).filter(|it| !it.is_control());
            typed
                .into_iter()
                .for_each(|it| TextInput(window).insert(None, it.encode_utf8(&mut [0; 4])));
        }
    }

    fn key(&self, event: &[u8]) {
        let (down, code, state) = (event[0] & 0x7f == event::KEY_PRESS, event[1], event.u16(28));
        self.time.set(event.u32(4));
        let Some(window) = self.window(event.u32(12)) else {
            let pressed = HotKey::pressed(code, state);
            if down && self.hot_keys.borrow().contains(&pressed) {
                bridge::emit(json!({ "t": "hotkey", "id": pressed.id() }));
            }
            return;
        };
        let (symbol, scan_code) = (
            self.with_keymap(|it| it.symbol(code, state)),
            u32::from(code.saturating_sub(8)),
        );
        let is_repeat = self.last_pressed.replace(if down { code } else { 0 }) == code && down;
        input::raw_key(RawKey {
            down,
            is_repeat,
            scan_code,
            symbol,
            modifiers: keyboard::modifiers(state),
        });
        let state_and_direction = u32::from(state) | if down { 0 } else { ibus::RELEASED };
        match self.input_method.get() {
            Some(Some(method)) if method.takes(symbol, scan_code, state_and_direction) => {
                input::report_key_taken_by_ime()
            }
            _ => self.type_key(window.id, down, symbol, state),
        }
    }

    fn set_hot_key(&self, accelerator: &str, on: bool) -> Result<u32> {
        let key = self.with_keymap(|keymap| HotKey::parse(accelerator, keymap))?;
        if on {
            key.grab(&self.x)?;
            self.hot_keys.borrow_mut().push(key);
        } else {
            self.hot_keys
                .borrow_mut()
                .extract_if(.., |it| *it == key)
                .for_each(|it| it.release(&self.x));
        }
        Ok(key.id())
    }

    // ───────────────────────────── events ─────────────────────────────

    fn focus_changed(&self, event: &[u8]) {
        const POINTER: u8 = 5;
        let is_about_grab = matches!(event[8], 1 | 2);
        let Some(window) = self
            .window(event.u32(4))
            .filter(|_| event[1] != POINTER && !is_about_grab)
        else {
            return;
        };
        window.is_active.set(event[0] & 0x7f == event::FOCUS_IN);
        self.last_pressed.set(0);
        if !self.sequence.borrow().is_empty() {
            self.end_sequence();
            TextInput(window.id).insert(None, "");
        }
        crate::window::activation_changed(window.id, window.is_active.get());
        self.text_input_changed.set(true);
    }

    fn property_changed(&self, event: &[u8]) {
        let (window, property) = (event.u32(4), event.u32(8));
        if let Some(window) = self.window(window) {
            window.event(event);
        } else if window == self.settings_owner.get() || property == atom::RESOURCE_MANAGER {
            self.settings_changed();
        } else if window != self.x.screen.root {
            self.selection_event(event);
        } else if property == self.atom(atom::_NET_WORKAREA) {
            self.displays_changed();
        } else if property == self.atom(atom::_NET_SUPPORTED) {
            self.supported.take();
        }
    }

    fn message(&self, event: &[u8]) {
        let (kind, data) = (event.u32(8), &event[12..]);
        match self.window(event.u32(4)) {
            Some(window) if kind == self.atom(atom::WM_PROTOCOLS) => window.protocol_message(data),
            Some(window) => self.drag_message(&window, kind, data),
            None if kind == self.atom(atom::MANAGER) && data.u32(4) == self.settings_selection => {
                self.settings_changed()
            }
            None => {}
        }
    }

    fn event(&self, event: &[u8]) {
        let kind = event[0] & 0x7f;
        match kind {
            wire::GENERIC_EVENT if event[1] == self.xinput.opcode => self.pointer_event(event),
            event::KEY_PRESS | event::KEY_RELEASE => self.key(event),
            event::FOCUS_IN | event::FOCUS_OUT => self.focus_changed(event),
            event::EXPOSE | event::VISIBILITY | event::UNMAP | event::MAP => {
                self.window(event.u32(4))
                    .iter()
                    .for_each(|it| it.event(event));
            }
            event::CONFIGURE => self
                .window(event.u32(4))
                .iter()
                .for_each(|it| it.configured(event)),
            event::DESTROY => {
                if let Some(window) = self.window(event.u32(4)) {
                    self.forget(&window);
                    crate::window::was_closed(window.id);
                }
            }
            event::PROPERTY => self.property_changed(event),
            event::SELECTION_CLEAR | event::SELECTION_REQUEST => self.selection_event(event),
            event::MESSAGE => self.message(event),
            _ if kind == event::MAPPING || kind == self.xkb.first_event => drop(self.keymap.take()),
            _ if self
                .randr
                .is_some_and(|it| kind.wrapping_sub(it.first_event) < 2) =>
            {
                let is_same = |it: &[u8]| it[0] == event[0];
                while self.x.take_event(is_same).is_some() {}
                self.displays_changed();
            }
            _ => {}
        }
    }

    fn for_each_bus(&self, mut f: impl FnMut(&dbus::Bus)) {
        self.desktop.for_each_bus(&mut f);
        self.input_method
            .get()
            .into_iter()
            .flatten()
            .for_each(|it| f(&it.bus));
    }

    fn idle_seconds(&self) -> Result<f64> {
        // Xwayland only knows about the input for its own windows.
        let from_compositor =
            std::env::var_os("WAYLAND_DISPLAY").and_then(|_| self.desktop.idle_milliseconds().ok());
        if let Some(milliseconds) = from_compositor {
            return Ok(milliseconds as f64 / 1000.);
        }
        let saver = self
            .x
            .extension(self.x.ask_for_extension("MIT-SCREEN-SAVER"));
        let query = Request::new(saver.context("the display does not tell")?.opcode, 1)
            .u32(self.x.screen.root);
        Ok(f64::from(self.x.call(query)?.u32(16)) / 1000.)
    }
}

impl Platform for &'static X11 {
    fn name(&self) -> &'static str {
        "X11"
    }

    fn open_window(&self, options: &Options, icon: Option<&Icon>) -> Result<Rc<dyn super::Window>> {
        let window = Window::open(self, options, icon)?;
        self.windows.borrow_mut().push(window.clone());
        Ok(window)
    }

    fn displays(&self) -> Vec<Display> {
        self.displays.borrow().clone()
    }

    fn is_dark(&self) -> bool {
        let has_dark_theme = || {
            self.settings
                .borrow()
                .get("Net/ThemeName")
                .is_some_and(|it| it.to_lowercase().contains("dark"))
        };
        self.desktop
            .known
            .is_dark
            .get()
            .unwrap_or_else(has_dark_theme)
    }

    fn set_dark(&self, is_dark: Option<bool>) {
        self.all_windows()
            .iter()
            .for_each(|it| it.set_dark(is_dark.unwrap_or_else(|| self.is_dark())));
    }

    fn button_layout(&self) -> Option<[Vec<WindowButton>; 2]> {
        let (from_portal, settings) = (
            self.desktop.known.button_layout.borrow(),
            self.settings.borrow(),
        );
        let layout = from_portal
            .as_deref()
            .or(settings.get("Gtk/DecorationLayout"))?;
        let (left, right) = layout.split_once(':').unwrap_or((layout, ""));
        let button = |name: &str| match name.trim() {
            "minimize" => Some(WindowButton::Minimize),
            "maximize" => Some(WindowButton::Maximize),
            "close" => Some(WindowButton::Close),
            _ => None,
        };
        Some([left, right].map(|side| side.split(',').filter_map(button).collect()))
    }

    fn command(&self, name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
        Ok(match name {
            "info" => json!({
                "thermalState": "nominal",
                "lowPower": self.desktop.known.saves_power.get(),
                "reduceMotion": self.desktop.known.reduces_motion.get()
                    || self.settings.borrow().get("Gtk/EnableAnimations") == Some("0"),
            }),
            "readClipboard" => self.read_clipboard(arguments.as_str().unwrap_or("")),
            "writeClipboard" => self.write_clipboard(arguments).map(|()| Value::Null)?,
            "cursor" => {
                let pointer = self.x.call(Request::new(38, 0).u32(self.x.screen.root))?;
                let [x, y] = [16, 18].map(|at| f32::from(pointer.i16(at)) / self.scale.get());
                json!({ "x": x, "y": y })
            }
            "idleSeconds" => self.idle_seconds()?.into(),
            "hotkey" => self
                .set_hot_key(
                    arguments["accelerator"].as_str().unwrap_or(""),
                    arguments["on"] == true,
                )?
                .into(),
            _ => self.desktop.command(name, arguments, reply)?,
        })
    }

    fn descriptors(&self) -> Vec<i32> {
        let mut all = Vec::from_iter((!self.x.is_broken()).then(|| self.x.fd()));
        self.for_each_bus(|bus| all.extend(bus.fd()));
        all
    }

    fn before_waiting(&self) -> Option<Instant> {
        if self.text_input_changed.take() {
            self.update_input_method();
        }
        self.x.flush();
        let (now, mut has_news) = (Instant::now(), self.x.has_events());
        self.for_each_bus(|bus| {
            bus.flush();
            has_news |= bus.has_messages();
        });
        if has_news {
            Some(now)
        } else {
            self.windows
                .borrow()
                .iter()
                .filter_map(|it| it.next_frame(now))
                .min()
        }
    }

    fn dispatch(&self, ready: &[i32]) {
        if ready.contains(&self.x.fd()) {
            self.x.read(0);
        }
        while let Some(event) = self.x.next_event() {
            self.event(&event);
        }
        self.for_each_bus(|bus| {
            if bus.has_messages() || bus.fd().is_some_and(|fd| ready.contains(&fd)) {
                bus.dispatch();
            }
        });
        self.input_method
            .get()
            .into_iter()
            .flatten()
            .for_each(|it| it.finish());
        if self.x.is_broken() && !self.has_ended.replace(true) {
            app::session_ended();
        }
        let now = Instant::now();
        let mut index = 0;
        while let Some(window) = { self.windows.borrow().get(index).cloned() } {
            window.begin_frame_if_due(now);
            index += 1;
        }
    }

    fn shut_down(&self, is_exiting: bool) {
        self.desktop.shut_down();
        self.hot_keys
            .take()
            .into_iter()
            .for_each(|it| it.release(&self.x));
        if is_exiting {
            self.hand_over_clipboard();
        }
        self.x.flush();
    }
}
