//! https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/ and `com.canonical.dbusmenu`.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context as _, Result};
use image::RgbaImage;
use parking_lot::Mutex;
use serde_json::{Value, json};
use zbus::blocking::Connection;
use zbus::interface;
use zbus::zvariant::{ObjectPath, OwnedValue, Structure, StructureBuilder, Value as Variant};

use crate::bridge;

const ITEM_PATH: &str = "/StatusNotifierItem";
const ITEM_INTERFACE: &str = "org.kde.StatusNotifierItem";
const MENU_PATH: &str = "/MenuBar";
const MENU_INTERFACE: &str = "com.canonical.dbusmenu";

type Pixmap = (i32, i32, Vec<u8>);
type Properties = HashMap<String, OwnedValue>;
type Layout = (i32, Properties, Vec<OwnedValue>);

#[derive(Default)]
struct State {
    icon: Vec<Pixmap>,
    tooltip: String,
    title: String,
    menu: Value,
    revision: u32,
}

struct Item {
    id: u32,
    name: String,
    state: Arc<Mutex<State>>,
}

#[interface(name = "org.kde.StatusNotifierItem")]
impl Item {
    fn activate(&self, x: i32, y: i32) {
        super::emit(self.id, "click", x.into(), y.into());
    }

    fn secondary_activate(&self, x: i32, y: i32) {
        super::emit(self.id, "middle-click", x.into(), y.into());
    }

    fn context_menu(&self, x: i32, y: i32) {
        super::emit(self.id, "right-click", x.into(), y.into());
    }

    fn scroll(&self, _delta: i32, _orientation: &str) {}

    #[zbus(property)]
    fn category(&self) -> &str {
        "ApplicationStatus"
    }

    #[zbus(property)]
    fn id(&self) -> &str {
        &self.name
    }

    #[zbus(property)]
    fn title(&self) -> String {
        let title = &self.state.lock().title;
        if title.is_empty() { &self.name } else { title }.clone()
    }

    #[zbus(property)]
    fn status(&self) -> &str {
        "Active"
    }

    #[zbus(property)]
    fn window_id(&self) -> i32 {
        0
    }

    #[zbus(property)]
    fn icon_name(&self) -> &str {
        ""
    }

    #[zbus(property)]
    fn icon_pixmap(&self) -> Vec<Pixmap> {
        self.state.lock().icon.clone()
    }

    #[zbus(property)]
    fn tool_tip(&self) -> (String, Vec<Pixmap>, String, String) {
        let tooltip = self.state.lock().tooltip.clone();
        (String::new(), Vec::new(), tooltip, String::new())
    }

    #[zbus(property)]
    fn item_is_menu(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn menu(&self) -> ObjectPath<'_> {
        ObjectPath::from_static_str_unchecked(MENU_PATH)
    }
}

struct Menu(Arc<Mutex<State>>);

fn children(item: &Value) -> impl Iterator<Item = &Value> {
    item["submenu"].as_array().into_iter().flatten()
}

fn find(item: &Value, id: i32) -> Option<&Value> {
    if item["id"] == id {
        return Some(item);
    }
    children(item).find_map(|child| find(child, id))
}

fn properties(item: &Value) -> Properties {
    let mut properties = Properties::new();
    let mut set = |name: &str, value: Variant<'_>| {
        if let Ok(value) = value.try_into_owned() {
            properties.insert(name.to_owned(), value);
        }
    };
    if item["type"] == "separator" {
        set("type", "separator".into());
    }
    if let Some(label) = item["label"].as_str() {
        // An underscore marks the access key.
        set("label", label.replace('_', "__").into());
    }
    if item["enabled"] == false {
        set("enabled", false.into());
    }
    if item["submenu"].is_array() {
        set("children-display", "submenu".into());
    }
    if let Some(toggle) = match item["type"].as_str() {
        Some("checkbox") => Some("checkmark"),
        Some("radio") => Some("radio"),
        _ => None,
    } {
        set("toggle-type", toggle.into());
        set("toggle-state", i32::from(item["checked"] == true).into());
    }
    properties
}

fn layout(item: &Value, depth: i32) -> Layout {
    let below = children(item).filter(|_| depth != 0).filter_map(|child| {
        let (id, properties, children) = layout(child, depth - 1);
        let structure: Structure<'_> = StructureBuilder::new()
            .add_field(id)
            .add_field(properties)
            .add_field(children)
            .build()
            .ok()?;
        Variant::from(structure).try_into_owned().ok()
    });
    let id = item["id"].as_i64().unwrap_or(0) as i32;
    (id, properties(item), below.collect())
}

#[interface(name = "com.canonical.dbusmenu")]
impl Menu {
    fn get_layout(&self, parent: i32, depth: i32, _names: Vec<String>) -> (u32, Layout) {
        let state = self.0.lock();
        let item = find(&state.menu, parent).unwrap_or(&Value::Null);
        (state.revision, layout(item, depth))
    }

    fn get_group_properties(&self, ids: Vec<i32>, _names: Vec<String>) -> Vec<(i32, Properties)> {
        let state = self.0.lock();
        ids.into_iter()
            .filter_map(|id| Some((id, properties(find(&state.menu, id)?))))
            .collect()
    }

    fn get_property(&self, id: i32, name: &str) -> zbus::fdo::Result<OwnedValue> {
        find(&self.0.lock().menu, id)
            .and_then(|item| properties(item).remove(name))
            .ok_or_else(|| zbus::fdo::Error::InvalidArgs(format!("no property {name} on {id}")))
    }

    fn event(&self, id: i32, event: &str, _data: Variant<'_>, _timestamp: u32) {
        let state = self.0.lock();
        let enabled = find(&state.menu, id).is_some_and(|item| item["enabled"] != false);
        if event == "clicked" && enabled {
            bridge::emit(json!({ "t": "menu", "id": id }));
        }
    }

    fn event_group(&self, events: Vec<(i32, String, OwnedValue, u32)>) -> Vec<i32> {
        for (id, event, data, timestamp) in events {
            self.event(id, &event, data.into(), timestamp);
        }
        Vec::new()
    }

    fn about_to_show(&self, _id: i32) -> bool {
        false
    }

    fn about_to_show_group(&self, _ids: Vec<i32>) -> (Vec<i32>, Vec<i32>) {
        (Vec::new(), Vec::new())
    }

    #[zbus(property)]
    fn version(&self) -> u32 {
        3
    }

    #[zbus(property)]
    fn text_direction(&self) -> &str {
        "ltr"
    }

    #[zbus(property)]
    fn status(&self) -> &str {
        "normal"
    }

    #[zbus(property)]
    fn icon_theme_path(&self) -> Vec<String> {
        Vec::new()
    }
}

pub struct Tray {
    connection: Connection,
    state: Arc<Mutex<State>>,
}

fn pixmap(image: RgbaImage) -> Pixmap {
    let (width, height) = image.dimensions();
    let argb = image.pixels().flat_map(|pixel| {
        let [r, g, b, a] = pixel.0;
        [a, r, g, b]
    });
    (width as i32, height as i32, argb.collect())
}

impl Tray {
    pub fn new(id: u32, name: &str, icon: RgbaImage, _template: bool) -> Result<Tray> {
        let state = Arc::new(Mutex::new(State {
            icon: vec![pixmap(icon)],
            menu: json!({ "id": 0, "submenu": [] }),
            ..State::default()
        }));
        let item = Item {
            id,
            name: name.to_owned(),
            state: state.clone(),
        };
        let service = format!("org.kde.StatusNotifierItem-{}-{id}", std::process::id());
        let connection = zbus::blocking::connection::Builder::session()?
            .name(service.as_str())?
            .serve_at(ITEM_PATH, item)?
            .serve_at(MENU_PATH, Menu(state.clone()))?
            .build()?;
        connection
            .call_method(
                Some("org.kde.StatusNotifierWatcher"),
                "/StatusNotifierWatcher",
                Some("org.kde.StatusNotifierWatcher"),
                "RegisterStatusNotifierItem",
                &service,
            )
            .context("this desktop has no tray (org.kde.StatusNotifierWatcher)")?;
        Ok(Tray { connection, state })
    }

    fn item_changed(&self, signal: &str) -> Result<()> {
        Ok(self
            .connection
            .emit_signal(None::<&str>, ITEM_PATH, ITEM_INTERFACE, signal, &())?)
    }

    pub fn set_icon(&mut self, icon: RgbaImage, _template: bool) -> Result<()> {
        self.state.lock().icon = vec![pixmap(icon)];
        self.item_changed("NewIcon")
    }

    pub fn set_tooltip(&mut self, tooltip: &str) -> Result<()> {
        self.state.lock().tooltip = tooltip.to_owned();
        self.item_changed("NewToolTip")
    }

    pub fn set_title(&mut self, title: &str) -> Result<()> {
        self.state.lock().title = title.to_owned();
        self.item_changed("NewTitle")
    }

    pub fn set_menu(&mut self, template: &Value) -> Result<()> {
        let revision = {
            let mut state = self.state.lock();
            let items = template.as_array().cloned().unwrap_or_default();
            state.menu = json!({ "id": 0, "submenu": items });
            state.revision += 1;
            state.revision
        };
        Ok(self.connection.emit_signal(
            None::<&str>,
            MENU_PATH,
            MENU_INTERFACE,
            "LayoutUpdated",
            &(revision, 0i32),
        )?)
    }

    pub fn bounds(&self) -> Option<[f64; 4]> {
        None
    }
}
