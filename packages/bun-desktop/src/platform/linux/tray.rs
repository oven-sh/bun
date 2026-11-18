//! https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/ and `com.canonical.dbusmenu`.

use std::cell::RefCell;
use std::rc::Rc;

use super::dbus::{Bus, DAEMON, Kind, Message, PROPERTIES, Value};
use crate::bridge;
use crate::error::{Context as _, Result};
use crate::protocol::{
    Icon, List, Maybe, MenuItem, MenuItemKind, Point, SystemEvent, TrayCommand, TrayEvent,
};

const ITEM_PATH: &str = "/StatusNotifierItem";
const ITEM: &str = "org.kde.StatusNotifierItem";
const MENU_PATH: &str = "/MenuBar";
const MENU: &str = "com.canonical.dbusmenu";
const WATCHER: [&str; 3] = [
    "org.kde.StatusNotifierWatcher",
    "/StatusNotifierWatcher",
    "org.kde.StatusNotifierWatcher",
];

struct State {
    id: u32,
    name: String,
    service: String,
    icon: Value,
    tooltip: String,
    title: String,
    menu: MenuItem,
    revision: u32,
}

pub struct Tray {
    pub bus: Bus,
    state: Rc<RefCell<State>>,
}

fn pixmaps(icon: &Icon) -> Result<Value> {
    let image =
        crate::images::decode_still(&icon.bytes).context("could not decode the tray icon")?;
    let (width, height) = (
        Value::I32(image.width as i32),
        Value::I32(image.height as i32),
    );
    let argb = image
        .data
        .as_chunks()
        .0
        .iter()
        .flat_map(|&[r, g, b, a]| [a, r, g, b])
        .collect();
    Ok(Value::Array(
        "(iiay)".into(),
        vec![Value::Struct(vec![width, height, Value::Bytes(argb)])],
    ))
}

fn root(items: List<MenuItem>) -> MenuItem {
    MenuItem {
        is_enabled: true,
        submenu: Maybe::Yes(items),
        ..MenuItem::default()
    }
}

fn children(item: &MenuItem) -> impl Iterator<Item = &MenuItem> {
    item.submenu.as_ref().into_iter().flat_map(|it| it.iter())
}

fn find(item: &MenuItem, id: i64) -> Option<&MenuItem> {
    if i64::from(item.id) == id {
        Some(item)
    } else {
        children(item).find_map(|child| find(child, id))
    }
}

fn properties(item: &MenuItem) -> Value {
    let toggle = match item.kind {
        MenuItemKind::Checkbox => Some("checkmark"),
        MenuItemKind::Radio => Some("radio"),
        _ => None,
    };
    let all = [
        (
            "type",
            (item.kind == MenuItemKind::Separator).then(|| "separator".into()),
        ),
        // An underscore marks the access key.
        (
            "label",
            item.label
                .unless_empty()
                .map(|it| it.replace('_', "__").as_str().into()),
        ),
        ("enabled", (!item.is_enabled).then_some(Value::Bool(false))),
        (
            "children-display",
            item.submenu.as_ref().map(|_| "submenu".into()),
        ),
        ("toggle-type", toggle.map(Value::from)),
        (
            "toggle-state",
            toggle.map(|_| Value::I32(item.is_checked.into())),
        ),
    ];
    Value::options(
        all.into_iter()
            .filter_map(|(name, value)| Some((name, value?))),
    )
}

fn layout(item: &MenuItem, depth: i64) -> Value {
    let below = children(item)
        .filter(|_| depth != 0)
        .map(|child| layout(child, depth - 1).variant());
    let id = Value::I32(item.id as i32);
    Value::Struct(vec![
        id,
        properties(item),
        Value::Array("v".into(), below.collect()),
    ])
}

impl State {
    fn properties(&self, path: &str) -> Value {
        if path == MENU_PATH {
            return Value::options([
                ("Version", Value::U32(3)),
                ("TextDirection", "ltr".into()),
                ("Status", "normal".into()),
                ("IconThemePath", Value::strings([])),
            ]);
        }
        let no_icon = Value::Array("(iiay)".into(), Vec::new());
        Value::options([
            ("Category", "ApplicationStatus".into()),
            ("Id", self.name.as_str().into()),
            (
                "Title",
                if self.title.is_empty() {
                    &self.name
                } else {
                    &self.title
                }
                .as_str()
                .into(),
            ),
            ("Status", "Active".into()),
            ("WindowId", Value::I32(0)),
            ("IconName", "".into()),
            ("IconPixmap", self.icon.clone()),
            (
                "ToolTip",
                Value::Struct(vec![
                    "".into(),
                    no_icon,
                    self.tooltip.as_str().into(),
                    "".into(),
                ]),
            ),
            ("ItemIsMenu", Value::Bool(false)),
            ("Menu", Value::path(MENU_PATH)),
        ])
    }

    fn menu_event(&self, event: &Value) {
        let item = find(&self.menu, event.at(0).number().unwrap_or(0));
        if let Some(item) = item.filter(|it| it.is_enabled && event.at(1).str() == "clicked") {
            bridge::emit_system(SystemEvent::Menu {
                item: item.id,
                is_by_key: false,
            });
        }
    }

    fn answer(&self, call: &Message) -> Result<Vec<Value>, &'static str> {
        const INVALID: &str = "org.freedesktop.DBus.Error.InvalidArgs";
        let (body, no_ids) = (&call.body, || Value::Array("i".into(), Vec::new()));
        let number = |index| body.at(index).number().unwrap_or(0);
        let existing = |value: &Value| {
            matches!(value, Value::Variant(_))
                .then(|| vec![value.clone()])
                .ok_or(INVALID)
        };
        let clicked = |event| {
            bridge::emit_system(SystemEvent::Tray {
                id: self.id,
                event,
                at: Point {
                    x: number(0) as f32,
                    y: number(1) as f32,
                },
            });
            Vec::new()
        };
        Ok(match call.member.as_str() {
            "Get" => return existing(self.properties(&call.path).get(body.at(1).str())),
            "GetAll" => vec![self.properties(&call.path)],
            "Activate" => clicked(TrayEvent::Click),
            "SecondaryActivate" => clicked(TrayEvent::MiddleClick),
            "ContextMenu" => clicked(TrayEvent::RightClick),
            "Scroll" | "Ping" => Vec::new(),
            "ProvideXdgActivationToken" => {
                super::desktop::keep_token(body.at(0).str());
                Vec::new()
            }
            "GetLayout" => vec![
                Value::U32(self.revision),
                layout(find(&self.menu, number(0)).ok_or(INVALID)?, number(1)),
            ],
            "GetGroupProperties" => {
                let found = body.at(0).items().iter().filter_map(|id| {
                    Some(Value::Struct(vec![
                        id.clone(),
                        properties(find(&self.menu, id.number()?)?),
                    ]))
                });
                vec![Value::Array("(ia{sv})".into(), found.collect())]
            }
            "GetProperty" => {
                return existing(
                    properties(find(&self.menu, number(0)).ok_or(INVALID)?).get(body.at(1).str()),
                );
            }
            "Event" => {
                self.menu_event(body);
                Vec::new()
            }
            "EventGroup" => {
                body.at(0)
                    .items()
                    .iter()
                    .for_each(|event| self.menu_event(event));
                vec![no_ids()]
            }
            "AboutToShow" => vec![Value::Bool(false)],
            "AboutToShowGroup" => vec![no_ids(), no_ids()],
            "Introspect" => {
                let interface = if call.path == MENU_PATH { MENU } else { ITEM };
                let xml = format!(
                    "<node><interface name=\"{interface}\"/><interface name=\"{PROPERTIES}\"/></node>"
                );
                vec![xml.as_str().into()]
            }
            _ => return Err("org.freedesktop.DBus.Error.UnknownMethod"),
        })
    }
}

impl Tray {
    pub fn new(id: u32, name: String, icon: &Icon) -> Result<Tray> {
        let service = format!("{ITEM}-{}-{id}", std::process::id());
        let state = Rc::new(RefCell::new(State {
            id,
            name,
            service: service.clone(),
            icon: pixmaps(icon)?,
            tooltip: String::new(),
            title: String::new(),
            menu: root(List::new()),
            revision: 0,
        }));
        let bus = Bus::session()?;
        let has_watcher = bus
            .call(DAEMON, "NameHasOwner", vec![WATCHER[0].into()])?
            .body
            .at(0)
            .is_true();
        has_watcher
            .then_some(())
            .context("this desktop has no tray (org.kde.StatusNotifierWatcher)")?;
        bus.call(
            DAEMON,
            "RequestName",
            vec![service.as_str().into(), Value::U32(0)],
        )?;
        bus.subscribe(&format!("member='NameOwnerChanged',arg0='{}'", WATCHER[0]));
        // It asks for the properties before it answers.
        bus.tell(
            WATCHER,
            "RegisterStatusNotifierItem",
            vec![service.as_str().into()],
        );
        let served = state.clone();
        bus.listen(move |bus, message| match message.kind {
            Kind::Call => bus.answer(message, served.borrow().answer(message)),
            _ if message.member == "NameOwnerChanged" && !message.body.at(2).str().is_empty() => {
                bus.tell(
                    WATCHER,
                    "RegisterStatusNotifierItem",
                    vec![served.borrow().service.as_str().into()],
                );
            }
            _ => {}
        });
        Ok(Tray { bus, state })
    }

    pub fn change(&self, change: TrayCommand) -> Result<()> {
        let mut state = self.state.borrow_mut();
        let signal = match change {
            TrayCommand::Icon(icon) => {
                state.icon = pixmaps(&icon)?;
                "NewIcon"
            }
            TrayCommand::ToolTip(text) => {
                state.tooltip = text.into_string();
                "NewToolTip"
            }
            TrayCommand::Title(text) => {
                state.title = text.into_string();
                "NewTitle"
            }
            TrayCommand::Menu(items) => {
                state.menu = root(items.get().unwrap_or_default());
                state.revision += 1;
                self.bus.emit(
                    MENU_PATH,
                    MENU,
                    "LayoutUpdated",
                    vec![Value::U32(state.revision), Value::I32(0)],
                );
                return Ok(());
            }
            TrayCommand::Create { .. } | TrayCommand::Destroy => return Ok(()),
        };
        self.bus.emit(ITEM_PATH, ITEM, signal, Vec::new());
        Ok(())
    }
}
