//! The input method. Fcitx 5 answers as well. https://ibus.github.io/docs/ibus-1.5/IBusInputContext.html

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::dbus::{Bus, Message, Value};
use crate::input::TextInput;

const SERVICE: &str = "org.freedesktop.IBus";
const CONTEXT: &str = "org.freedesktop.IBus.InputContext";
pub const RELEASED: u32 = 1 << 30;

pub struct InputMethod {
    pub bus: Bus,
    context: RefCell<String>,
    /// The window and its caret on the screen.
    focus: Cell<Option<(u32, [i32; 4])>>,
    /// Some methods do that before they say what replaces it.
    hid_composition: Cell<bool>,
    is_composing: Cell<bool>,
    /// The composition, which the page has kept, comes once more as the answer.
    was_reset_at: Cell<Option<Instant>>,
}

fn address() -> Option<String> {
    let variable = |name| {
        std::env::var(name)
            .ok()
            .filter(|it: &String| !it.is_empty())
    };
    variable("IBUS_ADDRESS").or_else(|| {
        let mut machine = ["/var/lib/dbus/machine-id", "/etc/machine-id"]
            .into_iter()
            .map(std::fs::read_to_string);
        let machine = machine.find_map(Result::ok)?;
        let on_x11 = variable("DISPLAY").and_then(|display| {
            let (host, number) = display.rsplit_once(':')?;
            Some(format!(
                "{}-{}",
                if host.is_empty() { "unix" } else { host },
                number.split('.').next()?
            ))
        });
        let on_wayland = variable("WAYLAND_DISPLAY").map(|it| format!("unix-{it}"));
        let folder = super::desktop::folder("XDG_CONFIG_HOME", ".config").join("ibus/bus");
        let mut files = on_wayland
            .into_iter()
            .chain(on_x11)
            .map(|it| folder.join(format!("{}-{it}", machine.trim())));
        let file = files.find_map(|it| std::fs::read_to_string(it).ok())?;
        file.lines()
            .find_map(|line| Some(line.strip_prefix("IBUS_ADDRESS=")?.to_owned()))
    })
}

impl InputMethod {
    /// `forward` gets the keysym, the evdev code and the state of a key that the method makes up.
    pub fn connect(forward: impl Fn(u32, u32, u32, u32) + 'static) -> Option<Rc<InputMethod>> {
        const PREEDIT_TEXT_AND_FOCUS: u32 = 1 | 8;
        let bus = Bus::open(&address()?).ok()?;
        let this = Rc::new(InputMethod {
            bus,
            context: RefCell::default(),
            focus: Cell::default(),
            hid_composition: Cell::default(),
            is_composing: Cell::default(),
            was_reset_at: Cell::default(),
        });
        let (created, listener) = (Rc::downgrade(&this), Rc::downgrade(&this));
        this.bus.subscribe(&format!("interface='{CONTEXT}'"));
        this.bus.listen(move |_, message| {
            listener
                .upgrade()
                .iter()
                .for_each(|it| it.signal(message, &forward))
        });
        let daemon = [SERVICE, "/org/freedesktop/IBus", SERVICE];
        this.bus.call_then(
            daemon,
            "CreateInputContext",
            vec!["bun".into()],
            move |reply| {
                if let (Ok(reply), Some(this)) = (reply, created.upgrade()) {
                    this.context.replace(reply.body.at(0).str().into());
                    this.tell("SetCapabilities", vec![Value::U32(PREEDIT_TEXT_AND_FOCUS)]);
                    this.set_focus(this.focus.take());
                }
            },
        );
        Some(this)
    }

    fn tell(&self, member: &str, body: Vec<Value>) {
        if !self.context.borrow().is_empty() {
            self.bus
                .tell([SERVICE, &self.context.borrow(), CONTEXT], member, body);
        }
    }

    pub fn set_focus(&self, focus: Option<(u32, [i32; 4])>) {
        let before = self.focus.get();
        let is_elsewhere = before.map(|it| it.0) != focus.map(|it| it.0);
        if before.is_some_and(|it| {
            is_elsewhere || self.is_composing.get() && TextInput(it.0).composing().is_none()
        }) {
            self.reset();
        }
        self.focus.set(focus);
        if is_elsewhere {
            if before.is_some() {
                self.tell("FocusOut", Vec::new());
            }
            if focus.is_some() {
                self.tell("FocusIn", Vec::new());
            }
        }
        if let Some((_, caret)) = focus.filter(|_| focus != before) {
            self.tell("SetCursorLocation", caret.map(Value::I32).into());
        }
    }

    pub fn reset(&self) {
        if let (true, Some((window, _))) = (self.is_composing.take(), self.focus.get()) {
            TextInput(window).end_composition();
            self.was_reset_at.set(Some(Instant::now()));
        }
        self.tell("Reset", Vec::new());
    }

    /// Returns whether it has taken the key. What it has made of it waits for `deliver`.
    pub fn takes(&self, symbol: u32, scan_code: u32, state: u32) -> bool {
        let context = self.context.borrow().clone();
        if context.is_empty() || self.focus.get().is_none() {
            return false;
        }
        let (patience, body) = (
            Duration::from_millis(500),
            [symbol, scan_code, state].map(Value::U32).into(),
        );
        if self.was_reset_at.get().is_some() {
            drop(self.bus.call_within(
                patience,
                [SERVICE, &context, "org.freedesktop.DBus.Peer"],
                "Ping",
                Vec::new(),
            ));
            self.bus.dispatch();
            self.was_reset_at.take();
        }
        let reply = self.bus.call_within(
            patience,
            [SERVICE, &context, CONTEXT],
            "ProcessKeyEvent",
            body,
        );
        reply.is_ok_and(|reply| reply.body.at(0).is_true())
    }

    pub fn deliver(&self) {
        self.bus.dispatch();
        self.finish();
    }

    /// After the messages that have arrived.
    pub fn finish(&self) {
        if let (true, Some((window, _))) = (self.hid_composition.take(), self.focus.get()) {
            self.is_composing.set(false);
            TextInput(window).compose(None, "", None);
        }
    }

    fn signal(&self, message: &Message, forward: &dyn Fn(u32, u32, u32, u32)) {
        let Some((window, _)) = self
            .focus
            .get()
            .filter(|_| message.path == *self.context.borrow())
        else {
            return;
        };
        let (input, text) = (TextInput(window), message.body.at(0).at(2).str());
        let number = |index| message.body.at(index).number().unwrap_or(0) as u32;
        match message.member.as_str() {
            "CommitText" | "UpdatePreeditText"
                if self
                    .was_reset_at
                    .get()
                    .is_some_and(|it| it.elapsed() < Duration::from_millis(500)) => {}
            "CommitText" => {
                self.hid_composition.set(false);
                self.is_composing.set(false);
                input.insert(None, text);
            }
            "UpdatePreeditText" if message.body.at(2).is_true() && !text.is_empty() => {
                self.hid_composition.set(false);
                self.is_composing.set(true);
                let caret = text
                    .chars()
                    .take(number(1) as usize)
                    .map(char::len_utf16)
                    .sum();
                input.compose(None, text, Some(caret..caret));
            }
            "UpdatePreeditText" | "HidePreeditText" => self.hid_composition.set(true),
            "ForwardKeyEvent" => forward(window, number(0), number(1), number(2)),
            _ => {}
        }
    }
}
