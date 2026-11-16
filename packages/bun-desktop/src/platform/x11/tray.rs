//! https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/ and `com.canonical.dbusmenu`.

use std::cell::RefCell;
use std::rc::Rc;

use super::dbus::{Bus, DAEMON, Kind, Message, PROPERTIES, Value};
use crate::bridge;
use crate::error::{Context as _, Result};
use crate::json::{Value as Json, json};

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
    id: u64,
    name: String,
    service: String,
    icon: Value,
    tooltip: String,
    title: String,
    menu: Json,
    revision: u32,
}

pub struct Tray {
    pub bus: Bus,
    state: Rc<RefCell<State>>,
}

fn pixmaps(blob: &Json) -> Result<Value> {
    let image = crate::images::decode_still(&bridge::blob(blob)?)
        .context("could not decode the tray icon")?;
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

fn children(item: &Json) -> impl Iterator<Item = &Json> {
    item["submenu"].as_array().into_iter().flatten()
}

fn find(item: &Json, id: i64) -> Option<&Json> {
    if item["id"].as_i64() == Some(id) {
        Some(item)
    } else {
        children(item).find_map(|child| find(child, id))
    }
}

fn properties(item: &Json) -> Value {
    let toggle = match item["type"].as_str() {
        Some("checkbox") => Some("checkmark"),
        Some("radio") => Some("radio"),
        _ => None,
    };
    let all = [
        (
            "type",
            (item["type"] == "separator").then(|| "separator".into()),
        ),
        // An underscore marks the access key.
        (
            "label",
            item["label"]
                .as_str()
                .map(|it| it.replace('_', "__").as_str().into()),
        ),
        (
            "enabled",
            (item["enabled"] == false).then_some(Value::Bool(false)),
        ),
        (
            "children-display",
            item["submenu"].is_array().then(|| "submenu".into()),
        ),
        ("toggle-type", toggle.map(Value::from)),
        (
            "toggle-state",
            toggle.map(|_| Value::I32((item["checked"] == true).into())),
        ),
    ];
    Value::options(
        all.into_iter()
            .filter_map(|(name, value)| Some((name, value?))),
    )
}

fn layout(item: &Json, depth: i64) -> Value {
    let below = children(item)
        .filter(|_| depth != 0)
        .map(|child| layout(child, depth - 1).variant());
    let id = Value::I32(item["id"].as_i64().unwrap_or(0) as i32);
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
        let (id, no_item) = (event.at(0).number().unwrap_or(0), |item: &Json| {
            item["enabled"] == false
        });
        if event.at(1).str() == "clicked" && !find(&self.menu, id).is_none_or(no_item) {
            bridge::emit(json!({ "t": "menu", "id": id }));
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
        let clicked = |event: &str| {
            bridge::emit(
                json!({ "t": "tray", "id": self.id, "e": event, "x": number(0), "y": number(1) }),
            );
            Vec::new()
        };
        Ok(match call.member.as_str() {
            "Get" => return existing(self.properties(&call.path).get(body.at(1).str())),
            "GetAll" => vec![self.properties(&call.path)],
            "Activate" => clicked("click"),
            "SecondaryActivate" => clicked("middle-click"),
            "ContextMenu" => clicked("right-click"),
            "Scroll" | "Ping" => Vec::new(),
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
    pub fn new(arguments: &Json) -> Result<Tray> {
        let id = arguments["id"].as_u64().unwrap_or(0);
        let service = format!("{ITEM}-{}-{id}", std::process::id());
        let state = Rc::new(RefCell::new(State {
            id,
            name: arguments["name"].as_str().unwrap_or("").into(),
            service: service.clone(),
            icon: pixmaps(&arguments["value"])?,
            tooltip: String::new(),
            title: String::new(),
            menu: json!({ "id": 0, "submenu": [] }),
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

    pub fn change(&self, what: &str, value: &Json) -> Result<()> {
        let mut state = self.state.borrow_mut();
        let signal = match what {
            "image" => {
                state.icon = pixmaps(value)?;
                "NewIcon"
            }
            "tooltip" => {
                state.tooltip = value.as_str().unwrap_or("").into();
                "NewToolTip"
            }
            "title" => {
                state.title = value.as_str().unwrap_or("").into();
                "NewTitle"
            }
            "menu" => {
                state.menu =
                    json!({ "id": 0, "submenu": value.as_array().cloned().unwrap_or_default() });
                state.revision += 1;
                self.bus.emit(
                    MENU_PATH,
                    MENU,
                    "LayoutUpdated",
                    vec![Value::U32(state.revision), Value::I32(0)],
                );
                return Ok(());
            }
            _ => return Ok(()),
        };
        self.bus.emit(ITEM_PATH, ITEM, signal, Vec::new());
        Ok(())
    }
}
