//! The menus that the platform draws.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

/// The jump list of Windows.
#[cfg(not(target_os = "macos"))]
mod other {
    use gpui::{Action, App, Menu, MenuItem};
    use serde_json::{Value, json};

    use crate::bridge;

    /// A `MenuItem` of JavaScript's, by its id.
    #[derive(Clone, PartialEq, Action)]
    #[action(namespace = bun, no_json, no_register)]
    struct Invoke(u64);

    pub fn init(cx: &mut App) {
        cx.on_action(|Invoke(id): &Invoke, _| bridge::emit(json!({ "t": "menu", "id": id })));
    }

    fn items(value: &Value) -> Vec<MenuItem> {
        let templates = value.as_array().into_iter().flatten();
        templates
            .map(|item| {
                let (label, disabled) = (
                    item["label"].as_str().unwrap_or("").to_owned(),
                    item["enabled"] == false,
                );
                if item["type"] == "separator" {
                    return MenuItem::Separator;
                }
                if item["submenu"].is_array() {
                    return MenuItem::submenu(
                        Menu::new(label)
                            .items(items(&item["submenu"]))
                            .disabled(disabled),
                    );
                }
                MenuItem::Action {
                    name: label.into(),
                    action: Box::new(Invoke(item["id"].as_u64().unwrap_or(0))),
                    os_action: None,
                    checked: item["checked"] == true,
                    disabled,
                }
            })
            .collect()
    }

    pub fn set_dock_menu(template: &Value, cx: &mut App) {
        cx.set_dock_menu(items(template));
    }
}
#[cfg(not(target_os = "macos"))]
pub use other::*;
