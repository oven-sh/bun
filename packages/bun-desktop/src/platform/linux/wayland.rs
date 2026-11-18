//! https://wayland.app/protocols/

mod data;
mod keyboard;
mod outputs;
mod pixels;
mod pointer;
mod text_input;
mod window;
mod wire;

use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use self::window::Window;
use self::wire::{Connection, DISPLAY, Event, Kind};
use super::shortcuts::Shortcuts;
use super::typing::Typing;
use super::{atspi, buttons, dbus, desktop, displays_changed};
use crate::app;
use crate::error::{Context as _, Result, ensure};
use crate::platform::{self, Display, Icon, Platform, Point, WindowButton};
use crate::protocol::{
    Clipboard, ClipboardPart, SystemCommand, SystemRequest, SystemSettings, SystemState,
};
use crate::window::Options;

macro_rules! globals {
    ($($name:ident = $interface:literal, $versions:expr, $kind:ident;)*) => {
        #[derive(Clone, Copy)]
        enum Global {
            $($name,)*
        }
        const GLOBALS: &[(&str, [u32; 2], Kind)] = &[$(($interface, $versions, Kind::$kind),)*];
    };
}

globals! {
    Compositor = "wl_compositor", [4, 6], Silent;
    Memory = "wl_shm", [1, 1], Silent;
    Shell = "xdg_wm_base", [1, 6], Shell;
    Seat = "wl_seat", [5, 8], Seat;
    Data = "wl_data_device_manager", [3, 3], Silent;
    Primary = "zwp_primary_selection_device_manager_v1", [1, 1], Silent;
    Outputs = "zxdg_output_manager_v1", [1, 3], Silent;
    Viewports = "wp_viewporter", [1, 1], Silent;
    Scales = "wp_fractional_scale_manager_v1", [1, 1], Silent;
    Presentation = "wp_presentation", [1, 1], Presentation;
    Decorations = "zxdg_decoration_manager_v1", [1, 1], Silent;
    Activation = "xdg_activation_v1", [1, 1], Silent;
    Dialogs = "xdg_wm_dialog_v1", [1, 1], Silent;
    Icons = "xdg_toplevel_icon_manager_v1", [1, 1], Silent;
    Exporter = "zxdg_exporter_v2", [1, 1], Silent;
    Opacity = "wp_alpha_modifier_v1", [1, 1], Silent;
    Bell = "xdg_system_bell_v1", [1, 1], Silent;
    Gestures = "zwp_pointer_gestures_v1", [1, 3], Silent;
    Cursors = "wp_cursor_shape_manager_v1", [1, 1], Silent;
    TextInput = "zwp_text_input_manager_v3", [1, 1], Silent;
    Idle = "ext_idle_notifier_v1", [1, 2], Silent;
}

#[derive(Clone, Copy, Default)]
struct Offered {
    name: u32,
    version: u32,
    /// Once it is used.
    object: u32,
}

struct Wayland {
    wire: Connection,
    registry: u32,
    globals: RefCell<[Offered; GLOBALS.len()]>,
    has_ended: Cell<bool>,
    windows: RefCell<Vec<Rc<Window>>>,
    outputs: RefCell<Vec<outputs::Output>>,
    outputs_changed: Cell<bool>,
    displays: RefCell<Vec<Display>>,
    /// Of the last key or button that was pressed, which proves that the user wants something.
    serial: Cell<u32>,
    clock: Cell<libc::clockid_t>,
    idle_watch: Cell<u32>,
    idle_since: Cell<Option<Instant>>,
    keyboard: keyboard::Keyboard,
    typing: Typing,
    text_input: text_input::State,
    pointer: pointer::Pointer,
    data: data::Data,
    desktop: desktop::Desktop,
    shortcuts: OnceCell<Option<Shortcuts>>,
}

pub fn start() -> Result<Box<dyn Platform>> {
    let wire = Connection::open()?;
    let registry = wire.create(Kind::Registry, 0, DISPLAY, 1, &[]);
    wire.flush();
    let keyboard = keyboard::Keyboard::new().context("there is no libxkbcommon")?;
    wire.sync();
    let (mut globals, mut outputs) = ([Offered::default(); GLOBALS.len()], Vec::new());
    while let Some(event) = wire.take_event(|it| it.kind == Kind::Registry) {
        let (interface, next) = event.text(1);
        let (name, version) = (event.u32(0), event.u32(next));
        match GLOBALS
            .iter()
            .position(|it| it.0 == interface && version >= it.1[0])
        {
            Some(index) if globals[index].name == 0 => {
                globals[index] = Offered {
                    name,
                    version: version.min(GLOBALS[index].1[1]),
                    object: 0,
                }
            }
            None if interface == "wl_output" => outputs.push((name, version)),
            _ => {}
        }
    }
    for needed in [Global::Compositor, Global::Memory, Global::Shell] {
        ensure!(
            globals[needed as usize].name != 0,
            "the compositor does not have {}",
            GLOBALS[needed as usize].0
        );
    }
    let wayland: &'static Wayland = Box::leak(Box::new(Wayland {
        wire,
        registry,
        globals: globals.into(),
        has_ended: Cell::default(),
        windows: RefCell::default(),
        outputs: RefCell::default(),
        outputs_changed: Cell::default(),
        displays: RefCell::default(),
        serial: Cell::default(),
        clock: Cell::new(libc::CLOCK_MONOTONIC),
        idle_watch: Cell::default(),
        idle_since: Cell::default(),
        keyboard,
        typing: Typing::default(),
        text_input: text_input::State::default(),
        pointer: pointer::Pointer::default(),
        data: data::Data::default(),
        desktop: desktop::Desktop::connect(),
        shortcuts: OnceCell::new(),
    }));
    desktop::keep_token(&std::env::var("XDG_ACTIVATION_TOKEN").unwrap_or_default());
    outputs
        .into_iter()
        .for_each(|(name, version)| wayland.add_output(name, version));
    wayland.watch_data();
    wayland.watch_text_input();
    wayland.wire.sync();
    wayland.handle(|it| matches!(it.kind, Kind::Output | Kind::LogicalOutput | Kind::Seat));
    wayland.outputs_changed.set(false);
    wayland.displays.replace(wayland.read_displays());
    Ok(Box::new(wayland))
}

const IDLE_AFTER: Duration = Duration::from_secs(1);

impl Wayland {
    fn bind(&self, name: u32, interface: &str, version: u32, kind: Kind) -> u32 {
        let object = self.wire.new_id(kind, 0);
        self.wire
            .send_text(self.registry, 0, &[name], interface, &[version, object]);
        object
    }

    /// 0 if the compositor does not have it.
    fn global(&self, which: Global) -> u32 {
        let (offered, (interface, _, kind)) = (
            &mut self.globals.borrow_mut()[which as usize],
            GLOBALS[which as usize],
        );
        if offered.object == 0 && offered.name != 0 {
            offered.object = self.bind(offered.name, interface, offered.version, kind);
        }
        offered.object
    }

    fn version(&self, which: Global) -> u32 {
        self.globals.borrow()[which as usize].version
    }

    fn scales_by_fractions(&self) -> bool {
        self.version(Global::Scales) > 0 && self.version(Global::Viewports) > 0
    }

    fn window(&self, id: u32) -> Option<Rc<Window>> {
        self.windows.borrow().iter().find(|it| it.id == id).cloned()
    }

    fn window_of(&self, surface: u32) -> Option<Rc<Window>> {
        self.windows
            .borrow()
            .iter()
            .find(|it| it.surface == surface)
            .cloned()
    }

    fn all_windows(&self) -> Vec<Rc<Window>> {
        self.windows.borrow().clone()
    }

    fn handle(&'static self, is_wanted: impl Fn(&Event) -> bool) {
        while let Some(event) = self.wire.take_event(&is_wanted) {
            self.event(event);
        }
    }

    fn capabilities_changed(&self, capabilities: u32) {
        self.use_pointer(capabilities & 1 != 0);
        self.use_keyboard(capabilities & 2 != 0);
        self.use_touch(capabilities & 4 != 0);
    }

    fn event(&'static self, event: Event) {
        match (event.kind, event.opcode) {
            (Kind::Display, 0) => {
                eprintln!(
                    "The Wayland compositor has closed the connection: {}",
                    event.text(2).0
                );
                self.wire.give_up();
            }
            (Kind::Display, _) => self.wire.reuse(event.u32(0)),
            (Kind::Registry, 0) if event.text(1).0 == "wl_output" => {
                self.add_output(event.u32(0), event.u32(event.text(1).1))
            }
            (Kind::Registry, 1) => self.remove_output(event.u32(0)),
            (Kind::Shell, _) => self.wire.send(event.object, 3, &[event.u32(0)]),
            (Kind::Presentation, _) => self.clock.set(event.i32(0)),
            (Kind::Seat, 0) => self.capabilities_changed(event.u32(0)),
            (Kind::Idle, opcode) => self
                .idle_since
                .set((opcode == 0).then(|| Instant::now() - IDLE_AFTER)),
            (Kind::Output | Kind::LogicalOutput, _) => self.output_event(&event),
            (Kind::Keyboard, _) => self.keyboard_event(event),
            (Kind::TextInput, _) => self.text_input_event(&event),
            (Kind::Pointer, _) => self.pointer_event(&event),
            (Kind::Pinch | Kind::Hold, _) => self.gesture_event(&event),
            (Kind::Touch, _) => self.touch_event(&event),
            (Kind::DataOffer | Kind::PrimaryOffer, _) => self.offer_event(&event),
            (Kind::DataDevice | Kind::PrimaryDevice, _) => self.device_event(&event),
            (Kind::DataSource | Kind::PrimarySource, _) => self.source_event(event),
            (Kind::Silent | Kind::Registry | Kind::Sync | Kind::Seat, _) => {}
            _ => self
                .window(event.owner)
                .iter()
                .for_each(|it| it.event(&event)),
        }
    }

    fn for_each_bus(&self, mut f: impl FnMut(&dbus::Bus)) {
        self.desktop.for_each_bus(&mut f);
        atspi::with_bus(&mut f);
        self.typing.input_method().iter().for_each(|it| f(&it.bus));
        self.shortcuts().into_iter().for_each(|it| f(&it.bus));
    }

    fn shortcuts(&self) -> Option<&Shortcuts> {
        self.shortcuts.get()?.as_ref()
    }
}

impl Platform for &'static Wayland {
    fn open_window(
        &self,
        options: &Options,
        icon: Option<&Icon>,
    ) -> Result<Rc<dyn platform::Window>> {
        let window = Window::open(self, options, icon);
        self.windows.borrow_mut().push(window.clone());
        Ok(window)
    }

    fn places_windows(&self) -> bool {
        false
    }

    fn displays(&self) -> Vec<Display> {
        self.displays.borrow().clone()
    }

    fn is_dark(&self) -> bool {
        self.desktop.known.is_dark.get().unwrap_or_default()
    }

    fn set_dark(&self, _: Option<bool>) {}

    fn button_layout(&self) -> Option<[Vec<WindowButton>; 2]> {
        self.desktop
            .known
            .button_layout
            .borrow()
            .as_deref()
            .map(buttons)
    }

    fn command(&self, command: SystemCommand) -> Result<()> {
        match command {
            SystemCommand::WriteClipboard {
                contents,
                is_selection,
            } => self.write_clipboard(contents, is_selection),
            SystemCommand::RegisterHotKey { id, chord } => {
                let shortcuts = self.shortcuts.get_or_init(|| Shortcuts::connect().ok());
                shortcuts
                    .as_ref()
                    .map(|it| it.add(id, &chord))
                    .context("this desktop has no global shortcuts")
            }
            SystemCommand::UnregisterHotKey(id) => {
                self.shortcuts().inspect(|it| it.remove(id));
                Ok(())
            }
            command => self.desktop.command(command),
        }
    }

    fn request(&self, id: u32, request: SystemRequest) -> Result<()> {
        desktop::request(id, request)
    }

    fn state(&self) -> SystemState {
        let known = &self.desktop.known;
        SystemState {
            saves_power: known.saves_power.get(),
            reduces_motion: known.reduces_motion.get(),
            ..SystemState::default()
        }
    }

    fn settings(&self) -> SystemSettings {
        SystemSettings {
            more_contrast: self.desktop.known.has_more_contrast.get(),
            ..SystemSettings::default()
        }
    }

    /// Where it was last seen.
    fn cursor_position(&self) -> Result<Point> {
        Ok(self.pointer_on_screen())
    }

    fn idle_seconds(&self) -> Result<f64> {
        if let Ok(milliseconds) = self.desktop.idle_milliseconds() {
            return Ok(milliseconds as f64 / 1000.);
        }
        if self.idle_watch.get() == 0 {
            let (whatever_inhibits, arguments) = (
                self.version(Global::Idle) as u16,
                [IDLE_AFTER.as_millis() as u32, self.global(Global::Seat)],
            );
            ensure!(
                arguments[1] != 0 && whatever_inhibits != 0,
                "the compositor does not tell"
            );
            self.idle_watch.set(self.wire.create(
                Kind::Idle,
                0,
                self.global(Global::Idle),
                whatever_inhibits,
                &arguments,
            ));
        }
        Ok(self
            .idle_since
            .get()
            .map_or(0., |it| it.elapsed().as_secs_f64()))
    }

    fn is_on_battery(&self) -> bool {
        desktop::on_battery()
    }

    fn read_clipboard(&self, part: ClipboardPart) -> Clipboard {
        self.read_selection(part)
    }

    fn descriptors(&self) -> Vec<i32> {
        let mut all = Vec::from_iter((!self.wire.is_broken()).then(|| self.wire.fd()));
        self.for_each_bus(|bus| all.extend(bus.fd()));
        all
    }

    fn before_waiting(&self) -> Option<Instant> {
        self.update_text_input();
        let now = Instant::now();
        let shortcuts = self.shortcuts().and_then(|it| it.apply(now));
        let frames = self
            .windows
            .borrow()
            .iter()
            .filter_map(|it| it.before_waiting(now))
            .min();
        self.wire.flush();
        let mut has_news = self.wire.has_events();
        self.for_each_bus(|bus| {
            bus.flush();
            has_news |= bus.has_messages();
        });
        if has_news {
            Some(now)
        } else {
            [
                frames,
                shortcuts,
                self.keyboard.next_repeat(),
                self.pointer.next_step(),
            ]
            .into_iter()
            .flatten()
            .min()
        }
    }

    fn dispatch(&self, ready: &[i32]) {
        if ready.contains(&self.wire.fd()) {
            self.wire.read();
        }
        self.handle(|_| true);
        if self.outputs_changed.take() {
            let now = self.read_displays();
            displays_changed(&self.displays.replace(now.clone()), &now);
            self.all_windows()
                .iter()
                .for_each(|it| it.display_changed());
        }
        self.for_each_bus(|bus| {
            if bus.has_messages() || bus.fd().is_some_and(|fd| ready.contains(&fd)) {
                bus.dispatch();
            }
        });
        self.typing.input_method().iter().for_each(|it| it.finish());
        if self.wire.is_broken() && !self.has_ended.replace(true) {
            app::session_ended();
        }
        let now = Instant::now();
        self.repeat_key(now);
        self.coast(now);
        let mut index = 0;
        while let Some(window) = { self.windows.borrow().get(index).cloned() } {
            window.begin_frame_if_due(now);
            index += 1;
        }
    }

    fn has_screen_reader(&self) -> bool {
        atspi::has_screen_reader()
    }

    fn accessibility_changed(&self, events: &[crate::accessibility::Event]) {
        atspi::post(events);
    }

    fn shut_down(&self, is_exiting: bool) {
        self.desktop.shut_down();
        if is_exiting {
            self.hand_over_clipboard();
        }
        self.wire.flush();
    }
}
