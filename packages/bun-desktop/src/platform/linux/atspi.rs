//! https://gitlab.gnome.org/GNOME/at-spi2-core/-/tree/main/xml

mod events;
mod objects;
mod roles;
mod text;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use super::dbus::{Bus, DAEMON, Kind, Message, PROPERTIES, Value};
use crate::accessibility::{self, Event, Id};
use crate::error::Result;

const LAUNCHER: [&str; 3] = ["org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus"];
pub const STATUS: &str = "org.a11y.Status";
const REGISTRY: &str = "org.a11y.atspi.Registry";
const PREFIX: &str = "/org/a11y/atspi/accessible/";
/// Clients tell links from the objects that they stand for by the path.
const LINKS: &str = "/org/a11y/atspi/hyperlink/";
const ROOT: &str = "/org/a11y/atspi/accessible/root";

#[derive(Clone, Copy, PartialEq)]
enum Object {
    Application,
    Window(u32),
    Node(Id),
}

impl Object {
    fn path(self) -> String {
        match self {
            Object::Application => ROOT.to_owned(),
            Object::Window(id) => format!("{PREFIX}w{id}"),
            Object::Node(id) => format!("{PREFIX}{}", id.bits()),
        }
    }

    fn parse(path: &str) -> Option<Object> {
        let name = path
            .strip_prefix(PREFIX)
            .or_else(|| path.strip_prefix(LINKS))?;
        Some(match name.strip_prefix('w') {
            _ if name == "root" => Object::Application,
            Some(id) => Object::Window(id.parse().ok()?),
            None => Object::Node(Id::from_bits(name.parse().ok()?)),
        })
    }
}

struct Connection {
    bus: Bus,
    name: String,
    desktop: RefCell<Value>,
    id: Cell<i32>,
    /// Those that the clients have been told of.
    windows: RefCell<Vec<u32>>,
    active: Cell<Option<u32>>,
    focused: Cell<Option<Id>>,
}

impl Connection {
    fn reference(&self, object: Option<Object>) -> Value {
        Value::Struct(vec![
            self.name.as_str().into(),
            Value::Path(object.map_or("/org/a11y/atspi/null".to_owned(), Object::path)),
        ])
    }

    fn link(&self, id: Id) -> Value {
        Value::Struct(vec![
            self.name.as_str().into(),
            Value::Path(format!("{LINKS}{}", id.bits())),
        ])
    }

    fn references(&self, objects: impl IntoIterator<Item = Object>) -> Value {
        Value::Array(
            "(so)".into(),
            objects
                .into_iter()
                .map(|it| self.reference(Some(it)))
                .collect(),
        )
    }
}

thread_local! {
    static CONNECTION: RefCell<Option<Rc<Connection>>> = const { RefCell::new(None) };
    static HAS_SCREEN_READER: Cell<bool> = const { Cell::new(false) };
    static HAS_LISTENERS: Cell<bool> = const { Cell::new(false) };
}

fn connection() -> Option<Rc<Connection>> {
    CONNECTION.with_borrow(Clone::clone)
}

pub fn with_bus(f: impl FnOnce(&Bus)) {
    if let Some(connection) = connection() {
        f(&connection.bus);
    }
}

pub fn has_screen_reader() -> bool {
    HAS_SCREEN_READER.get()
}

fn clients_changed() {
    accessibility::set_clients(HAS_LISTENERS.get(), HAS_SCREEN_READER.get());
}

fn count_listeners(bus: &Bus) {
    bus.call_then(
        [REGISTRY, "/org/a11y/atspi/registry", REGISTRY],
        "GetRegisteredEvents",
        Vec::new(),
        |reply| {
            HAS_LISTENERS.set(reply.is_ok_and(|it| !it.body.at(0).items().is_empty()));
            clients_changed();
        },
    );
}

fn embed(connection: &Rc<Connection>) {
    let (root, it) = (
        connection.reference(Some(Object::Application)),
        Rc::downgrade(connection),
    );
    connection.bus.call_then(
        [REGISTRY, ROOT, "org.a11y.atspi.Socket"],
        "Embed",
        vec![root],
        move |reply| {
            if let Some((connection, reply)) = it.upgrade().zip(reply.ok()) {
                connection.desktop.replace(reply.body.at(0).clone());
                connection.active.set(None);
                let focused = |forest: &accessibility::Forest| {
                    forest
                        .windows()
                        .find(|it| forest.is_window_active(*it))
                        .map(|window| Event::Focused {
                            window,
                            to: forest.focus(window),
                        })
                };
                post(accessibility::read(focused).as_slice());
            }
        },
    );
    count_listeners(&connection.bus);
}

fn handle(bus: &Bus, message: &Message) {
    let Some(connection) = connection() else {
        return;
    };
    if message.kind == Kind::Call {
        bus.answer(
            message,
            objects::answer(&connection, message).ok_or("org.freedesktop.DBus.Error.UnknownMethod"),
        );
    } else if message.is(DAEMON[2], "NameOwnerChanged") && !message.body.at(2).str().is_empty() {
        embed(&connection);
    } else if message.interface == REGISTRY {
        count_listeners(bus);
    }
}

fn connect(address: &str) -> Result<()> {
    let bus = Bus::open(address)?;
    let (name, desktop) = (
        bus.unique_name()?,
        Value::Struct(vec![REGISTRY.into(), Value::path(ROOT)]).into(),
    );
    bus.subscribe(&format!("interface='{REGISTRY}'"));
    bus.subscribe(&format!("member='NameOwnerChanged',arg0='{REGISTRY}'"));
    bus.listen(handle);
    let connection = Rc::new(Connection {
        bus,
        name,
        desktop,
        id: Cell::default(),
        windows: RefCell::default(),
        active: Cell::default(),
        focused: Cell::default(),
    });
    embed(&connection);
    CONNECTION.set(Some(connection));
    Ok(())
}

/// With properties of `STATUS`.
pub fn status_changed(session: &Bus, properties: &Value) {
    if let Some(is_on) = properties.get("ScreenReaderEnabled").number() {
        HAS_SCREEN_READER.set(is_on != 0);
        clients_changed();
    }
    if (HAS_SCREEN_READER.get() || properties.get("IsEnabled").is_true()) && connection().is_none()
    {
        session.call_then(LAUNCHER, "GetAddress", Vec::new(), |reply| {
            let connected = reply.and_then(|it| connect(it.body.at(0).str()));
            drop(
                connected.inspect_err(|error| {
                    crate::diagnostics::log!("no accessibility bus: {error:#}")
                }),
            );
        });
    }
}

/// Asking what is not running would start it.
pub fn watch(session: &Rc<Bus>) {
    session.subscribe(&format!(
        "path='{}',member='PropertiesChanged'",
        LAUNCHER[1]
    ));
    let bus = Rc::downgrade(session);
    session.call_then(
        DAEMON,
        "NameHasOwner",
        vec![LAUNCHER[0].into()],
        move |reply| {
            let Some(session) = bus
                .upgrade()
                .filter(|_| reply.is_ok_and(|it| it.body.at(0).is_true()))
            else {
                return;
            };
            session.call_then(
                [LAUNCHER[0], LAUNCHER[1], PROPERTIES],
                "GetAll",
                vec![STATUS.into()],
                move |reply| {
                    if let Some((session, reply)) = bus.upgrade().zip(reply.ok()) {
                        status_changed(&session, reply.body.at(0));
                    }
                },
            );
        },
    );
}

pub fn post(events: &[Event]) {
    if let Some(connection) = connection() {
        accessibility::read(|forest| events::emit(&connection, forest, events));
    }
}

/// Whether the screen reader has taken it for a command.
pub fn takes_key(
    down: bool,
    symbol: u32,
    code: u8,
    state: u16,
    time: u32,
    typed: Option<char>,
) -> bool {
    let Some(connection) = connection().filter(|_| HAS_SCREEN_READER.get()) else {
        return false;
    };
    let text = typed.map_or(String::new(), String::from);
    let event = vec![
        Value::U32((!down).into()),
        Value::I32(symbol as i32),
        Value::I16(code.into()),
        Value::I16(state as i16),
        Value::I32(time as i32),
        text.as_str().into(),
        Value::Bool(typed.is_some()),
    ];
    let controller = [
        REGISTRY,
        "/org/a11y/atspi/registry/deviceeventcontroller",
        "org.a11y.atspi.DeviceEventController",
    ];
    let reply = connection.bus.call_serving(
        Duration::from_millis(500),
        controller,
        "NotifyListenersSync",
        vec![Value::Struct(event)],
    );
    reply.is_ok_and(|it| it.body.at(0).is_true())
}
