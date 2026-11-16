use std::sync::Once;

use anyhow::Result;
use image::RgbaImage;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSStatusBarButton, NSStatusItem};
use serde_json::{Value, json};
use tray_icon::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
};
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::bridge;

pub struct Tray(TrayIcon);

fn to_icon(image: RgbaImage) -> Result<Icon> {
    let (width, height) = image.dimensions();
    Ok(Icon::from_rgba(image.into_raw(), width, height)?)
}

fn listen() {
    MenuEvent::set_event_handler(Some(|event: MenuEvent| {
        if let Ok(id) = event.id.0.parse::<u64>() {
            bridge::emit(json!({ "t": "menu", "id": id }));
        }
    }));
    TrayIconEvent::set_event_handler(Some(|event: TrayIconEvent| {
        let Ok(id) = event.id().0.parse() else { return };
        let (name, position) = match event {
            TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                position,
                ..
            } => match button {
                MouseButton::Left => ("click", position),
                MouseButton::Right => ("right-click", position),
                MouseButton::Middle => ("middle-click", position),
            },
            TrayIconEvent::DoubleClick { position, .. } => ("double-click", position),
            TrayIconEvent::Enter { position, .. } => ("mouse-enter", position),
            TrayIconEvent::Leave { position, .. } => ("mouse-leave", position),
            _ => return,
        };
        #[cfg(target_os = "macos")]
        let position = crate::native::cursor_position(1.).map_or(position, |it| it.into());
        super::emit(id, name, position.x, position.y);
    }));
}

fn items(template: &Value) -> Result<Vec<Box<dyn IsMenuItem>>> {
    let mut built: Vec<Box<dyn IsMenuItem>> = Vec::new();
    for item in template.as_array().into_iter().flatten() {
        let (id, label) = (item["id"].to_string(), item["label"].as_str().unwrap_or(""));
        let enabled = item["enabled"] != false;
        drop(crate::bridge::blob(&item["icon"]["blob"]));
        built.push(if item["type"] == "separator" {
            Box::new(PredefinedMenuItem::separator())
        } else if item["submenu"].is_array() {
            let submenu = Submenu::new(label, enabled);
            for child in items(&item["submenu"])? {
                submenu.append(child.as_ref())?;
            }
            Box::new(submenu)
        } else if item["type"] == "checkbox" || item["type"] == "radio" {
            let checked = item["checked"] == true;
            Box::new(CheckMenuItem::with_id(id, label, enabled, checked, None))
        } else {
            Box::new(MenuItem::with_id(id, label, enabled, None))
        });
    }
    Ok(built)
}

impl Tray {
    pub fn new(id: u32, _name: &str, icon: RgbaImage, template: bool) -> Result<Tray> {
        static LISTEN: Once = Once::new();
        LISTEN.call_once(listen);
        let builder = TrayIconBuilder::new()
            .with_id(id.to_string())
            .with_icon(to_icon(icon)?)
            .with_icon_as_template(template)
            .with_menu_on_left_click(cfg!(target_os = "macos"));
        Ok(Tray(builder.build()?))
    }

    pub fn set_icon(&mut self, icon: RgbaImage, template: bool) -> Result<()> {
        self.0.set_icon(Some(to_icon(icon)?))?;
        self.0.set_icon_as_template(template);
        Ok(())
    }

    pub fn set_tooltip(&mut self, tooltip: &str) -> Result<()> {
        Ok(self.0.set_tooltip(Some(tooltip))?)
    }

    pub fn set_title(&mut self, title: &str) -> Result<()> {
        self.0.set_title(Some(title));
        Ok(())
    }

    pub fn set_menu(&mut self, template: &Value) -> Result<()> {
        if template.is_null() {
            self.0.set_menu(None);
            return Ok(());
        }
        let menu = Menu::new();
        for item in items(template)? {
            menu.append(item.as_ref())?;
        }
        self.0.set_menu(Some(Box::new(menu)));
        Ok(())
    }

    pub fn bounds(&self) -> Option<[f64; 4]> {
        let rect = self.0.rect()?;
        let bounds = [
            rect.position.x,
            rect.position.y,
            rect.size.width.into(),
            rect.size.height.into(),
        ];
        #[cfg(target_os = "macos")]
        let bounds = {
            let scale = self.button()?.window()?.backingScaleFactor();
            bounds.map(|it| it / scale)
        };
        Some(bounds)
    }
}

#[cfg(target_os = "macos")]
impl Tray {
    pub fn status_item(&self) -> Option<Retained<NSStatusItem>> {
        self.0.ns_status_item()
    }

    fn button(&self) -> Option<Retained<NSStatusBarButton>> {
        self.status_item()?.button(objc2::MainThreadMarker::new()?)
    }

    pub fn set_icon_size(&self, size: &Value) {
        if let (Some(button), Some(width), Some(height)) = (
            self.button(),
            size["width"].as_f64(),
            size["height"].as_f64(),
        ) && let Some(image) = button.image()
        {
            image.setSize(objc2_foundation::NSSize::new(width, height));
            button.setImage(None);
            button.setImage(Some(&image));
            // It adjusts the area that can be clicked.
            self.0.set_title(None::<&str>);
        }
    }
}
