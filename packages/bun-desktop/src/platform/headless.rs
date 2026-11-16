//! Without a window system.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

use super::{Cursor, Display, Edge, Geometry, Icon, Platform, Point, Window};
use crate::abi::Rect;
use crate::error::{Result, bail};
use crate::json::{Value, json};
use crate::window::{self, Options};
use crate::{accessibility, bridge};

pub struct Headless;

impl Platform for Headless {
    fn name(&self) -> &'static str {
        "headless"
    }

    fn open_window(&self, options: &Options, _: Option<&Icon>) -> Result<Rc<dyn Window>> {
        let geometry = Geometry {
            x: options.x.unwrap_or(0.),
            y: options.y.unwrap_or(0.),
            width: options.width,
            height: options.height,
            scale: 1.,
            is_fullscreen: options.fullscreen,
            ..Geometry::default()
        };
        Ok(Rc::new(Unseen {
            id: options.id,
            geometry: Cell::new(geometry),
        }))
    }

    fn displays(&self) -> Vec<Display> {
        let bounds = Rect {
            x: 0.,
            y: 0.,
            width: 1920.,
            height: 1080.,
        };
        vec![Display {
            id: 0,
            bounds,
            work_area: bounds,
            scale: 1.,
            frequency: 0.,
        }]
    }

    fn is_dark(&self) -> bool {
        false
    }

    fn set_dark(&self, _: Option<bool>) {}

    fn command(&self, name: &str, _: &Value, reply: Option<u64>) -> Result<Value> {
        Ok(match (name, reply) {
            ("info", _) => {
                json!({ "thermalState": "nominal", "lowPower": false, "reduceMotion": false })
            }
            ("cursor", _) => json!({ "x": 0, "y": 0 }),
            ("systemSettings" | "readClipboard", _) => json!({}),
            ("idleSeconds", _) => json!(0),
            ("onBattery" | "isHidden", _) => json!(false),
            ("tray" | "hotkey" | "messageBox" | "trash" | "registerUrlScheme", _) => {
                bail!("{name} needs a display")
            }
            (_, Some(reply)) => {
                bridge::reply(
                    reply,
                    Ok(if name.starts_with("spelling.") {
                        json!([])
                    } else {
                        Value::Null
                    }),
                );
                Value::Null
            }
            _ => Value::Null,
        })
    }

    #[cfg(not(target_os = "macos"))]
    fn descriptors(&self) -> Vec<i32> {
        Vec::new()
    }

    #[cfg(not(target_os = "macos"))]
    fn before_waiting(&self) -> Option<std::time::Instant> {
        None
    }

    #[cfg(not(target_os = "macos"))]
    fn dispatch(&self, _: &[i32]) {}

    fn shut_down(&self, _: bool) {}
}

struct Unseen {
    id: u32,
    geometry: Cell<Geometry>,
}

impl Window for Unseen {
    fn geometry(&self) -> Geometry {
        self.geometry.get()
    }

    fn is_active(&self) -> bool {
        false
    }

    fn is_visible(&self) -> bool {
        false
    }

    fn refresh_interval(&self) -> Option<Duration> {
        None
    }

    fn mouse_position(&self) -> Point {
        Point::default()
    }

    fn set_visible(&self, _: bool, _: bool) {}

    fn close(&self) {}

    fn request_frame(&self) {}

    fn can_present(&self) -> Option<bool> {
        None
    }

    #[cfg(not(target_os = "macos"))]
    fn present(&self, _: super::Painter) {}

    #[cfg(target_os = "macos")]
    fn layer(&self) -> *mut std::ffi::c_void {
        std::ptr::null_mut()
    }

    fn set_cursor(&self, _: Cursor) {}

    fn text_input_changed(&self) {}

    fn start_move(&self) {}

    fn start_resize(&self, _: Edge) {}

    fn show_window_menu(&self, _: Point) {}

    fn title_was_double_clicked(&self) {}

    fn set_accessibility_tree(&self, _: &accessibility::Update) {}

    fn command(&self, name: &str, value: &Value, _: Option<&dyn Window>) -> Result<Value> {
        let [width, height] = [0, 1].map(|index| value[index].as_f64().unwrap_or(0.) as f32);
        match name {
            "isMinimized" => return Ok(false.into()),
            "windowNumber" => return Ok(0.into()),
            "size" => {
                self.geometry.set(Geometry {
                    width,
                    height,
                    ..self.geometry.get()
                });
                window::bounds_changed(self.id);
            }
            "fullscreen" => self.geometry.set(Geometry {
                is_fullscreen: value == true,
                ..self.geometry.get()
            }),
            _ => {}
        }
        Ok(Value::Null)
    }

    fn handle(&self) -> u64 {
        0
    }
}
