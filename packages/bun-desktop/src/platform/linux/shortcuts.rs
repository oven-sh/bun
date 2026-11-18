//! https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::dbus::{Bus, Message, PROPERTIES, Value};
use super::desktop::{self, PORTAL};
use crate::bridge;
use crate::error::Result;
use crate::protocol::{self, Chord, SystemEvent};

const SHORTCUTS: [&str; 3] = [
    PORTAL[0],
    PORTAL[1],
    "org.freedesktop.portal.GlobalShortcuts",
];

/// https://specifications.freedesktop.org/shortcuts-spec/latest/
fn trigger(chord: &Chord) -> String {
    const NAMES: [(&str, &str); 28] = [
        ("tab", "Tab"),
        ("enter", "Return"),
        ("escape", "Escape"),
        ("backspace", "BackSpace"),
        ("delete", "Delete"),
        ("insert", "Insert"),
        ("up", "Up"),
        ("down", "Down"),
        ("left", "Left"),
        ("right", "Right"),
        ("home", "Home"),
        ("end", "End"),
        ("pageup", "Prior"),
        ("pagedown", "Next"),
        ("menu", "Menu"),
        ("capslock", "Caps_Lock"),
        ("`", "grave"),
        ("-", "minus"),
        ("=", "equal"),
        ("[", "bracketleft"),
        ("]", "bracketright"),
        ("\\", "backslash"),
        (";", "semicolon"),
        ("'", "apostrophe"),
        (",", "comma"),
        (".", "period"),
        ("/", "slash"),
        ("*", "asterisk"),
    ];
    let modifiers = [
        (protocol::CONTROL, "CTRL+"),
        (protocol::ALT, "ALT+"),
        (protocol::SHIFT, "SHIFT+"),
        (protocol::META, "LOGO+"),
    ];
    let held: String = modifiers
        .iter()
        .filter(|it| chord.modifiers & it.0 != 0)
        .map(|it| it.1)
        .collect();
    let (key, mut characters) = (&*chord.key, chord.key.chars());
    match (
        NAMES.iter().find(|it| it.0 == key),
        characters.next(),
        characters.next(),
    ) {
        (Some((_, name)), ..) => held + name,
        (_, Some('f'), Some(_)) => held + &key.to_uppercase(),
        (_, Some(only), None) if !only.is_ascii_alphanumeric() => {
            format!("{held}U{:04X}", u32::from(only))
        }
        _ => held + key,
    }
}

#[derive(Default)]
struct Wanted {
    /// The trigger is what the desktop remembers it by.
    all: RefCell<Vec<(u32, String)>>,
    sessions: Cell<u32>,
    session: RefCell<String>,
}

impl Wanted {
    fn ask(&self, bus: &Bus, member: &str, mut body: Vec<Value>) {
        let [request, session] =
            [member, "session"].map(|it| Value::Str(format!("{it}{}", self.sessions.get())));
        let session = (member == "CreateSession").then_some(("session_handle_token", session));
        body.push(Value::options(
            [("handle_token", request)].into_iter().chain(session),
        ));
        bus.tell(SHORTCUTS, member, body);
    }

    fn signal(&self, bus: &Bus, message: &Message) {
        let body = &message.body;
        let answers = |member: &str| {
            message.member == "Response"
                && message
                    .path
                    .ends_with(&format!("/{member}{}", self.sessions.get()))
        };
        if message.is(SHORTCUTS[2], "Activated") && body.at(0).str() == *self.session.borrow() {
            desktop::keep_token(body.at(3).get("activation_token").str());
            let found = self
                .all
                .borrow()
                .iter()
                .find(|it| it.1 == body.at(1).str())
                .map(|it| it.0);
            found
                .into_iter()
                .for_each(|id| bridge::emit_system(SystemEvent::HotKey(id)));
        } else if answers("CreateSession")
            && body
                .at(1)
                .get("session_handle")
                .str()
                .starts_with(PORTAL[1])
        {
            self.session
                .replace(body.at(1).get("session_handle").str().into());
            self.ask(
                bus,
                "ListShortcuts",
                vec![Value::path(&self.session.borrow())],
            );
        } else if answers("ListShortcuts") {
            let (all, known) = (self.all.borrow(), body.at(1).get("shortcuts").items());
            // It may ask the user.
            if all
                .iter()
                .any(|it| known.iter().all(|known| known.at(0).str() != it.1))
            {
                let options = |it: &str| {
                    Value::options([("description", it.into()), ("preferred_trigger", it.into())])
                };
                let shortcuts = all
                    .iter()
                    .map(|(_, it)| Value::Struct(vec![it.as_str().into(), options(it)]));
                self.ask(
                    bus,
                    "BindShortcuts",
                    vec![
                        Value::path(&self.session.borrow()),
                        Value::Array("(sa{sv})".into(), shortcuts.collect()),
                        "".into(),
                    ],
                );
            }
        }
    }
}

pub struct Shortcuts {
    pub bus: Bus,
    wanted: Rc<Wanted>,
    changed_at: Cell<Option<Instant>>,
}

impl Shortcuts {
    pub fn connect() -> Result<Shortcuts> {
        let (bus, wanted) = (Bus::session()?, Rc::new(Wanted::default()));
        // Nothing else may have been asked of the portal on this connection.
        bus.tell(
            [PORTAL[0], PORTAL[1], "org.freedesktop.host.portal.Registry"],
            "Register",
            vec![Value::Str(desktop::id_of_app()), Value::options([])],
        );
        bus.call_within(
            Duration::from_secs(2),
            [PORTAL[0], PORTAL[1], PROPERTIES],
            "Get",
            vec![SHORTCUTS[2].into(), "version".into()],
        )?;
        for interface in [SHORTCUTS[2], "org.freedesktop.portal.Request"] {
            bus.subscribe(&format!("sender='{}',interface='{interface}'", PORTAL[0]));
        }
        let listener = wanted.clone();
        bus.listen(move |bus, message| listener.signal(bus, message));
        Ok(Shortcuts {
            bus,
            wanted,
            changed_at: Cell::default(),
        })
    }

    pub fn add(&self, id: u32, chord: &Chord) {
        self.wanted.all.borrow_mut().push((id, trigger(chord)));
        self.changed_at.set(Some(Instant::now()));
    }

    pub fn remove(&self, id: u32) {
        self.wanted.all.borrow_mut().retain(|it| it.0 != id);
        self.changed_at.set(Some(Instant::now()));
    }

    /// A session binds once, so this waits for more. Returns until when.
    pub fn apply(&self, now: Instant) -> Option<Instant> {
        let due = self.changed_at.get()? + Duration::from_millis(100);
        if now < due {
            return Some(due);
        }
        self.changed_at.take();
        let before = self.wanted.session.take();
        if !before.is_empty() {
            self.bus.tell(
                [PORTAL[0], &before, "org.freedesktop.portal.Session"],
                "Close",
                Vec::new(),
            );
        }
        self.wanted.sessions.update(|it| it + 1);
        if !self.wanted.all.borrow().is_empty() {
            self.wanted.ask(&self.bus, "CreateSession", Vec::new());
        }
        None
    }
}
