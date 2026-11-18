//! Without a window system.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

use super::{Cursor, Display, Edge, Geometry, Icon, Platform, Point, Window};
use crate::abi::Rect;
use crate::error::{Result, bail};
use crate::protocol::{
    Clipboard, ClipboardPart, Reply, SystemCommand, SystemRequest, SystemState, WindowCommand,
};
use crate::window::{self, Options};
use crate::{accessibility, bridge};

pub struct Headless;

impl Platform for Headless {
    fn has_display(&self) -> bool {
        false
    }

    fn open_window(&self, options: &Options, _: Option<&Icon>) -> Result<Rc<dyn Window>> {
        let geometry = Geometry {
            x: options.x.get().unwrap_or(0.),
            y: options.y.get().unwrap_or(0.),
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

    fn command(&self, command: SystemCommand) -> Result<()> {
        match command {
            SystemCommand::Tray { .. } | SystemCommand::RegisterHotKey { .. } => {
                bail!("that needs a display")
            }
            _ => Ok(()),
        }
    }

    fn request(&self, id: u32, request: SystemRequest) -> Result<()> {
        bridge::reply(
            id,
            Ok(match request {
                SystemRequest::CheckSpelling(_) => Reply::Misspelled(Default::default()),
                SystemRequest::GuessSpelling(_) => Reply::Guesses(Default::default()),
                SystemRequest::LearnSpelling(_) => Reply::Done,
                _ => bail!("that needs a display"),
            }),
        );
        Ok(())
    }

    fn state(&self) -> SystemState {
        SystemState::default()
    }

    fn cursor_position(&self) -> Result<Point> {
        Ok(Point::default())
    }

    fn idle_seconds(&self) -> Result<f64> {
        Ok(0.)
    }

    fn is_on_battery(&self) -> bool {
        false
    }

    fn read_clipboard(&self, _: ClipboardPart) -> Clipboard {
        Clipboard::default()
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    fn descriptors(&self) -> Vec<i32> {
        Vec::new()
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    fn before_waiting(&self) -> Option<std::time::Instant> {
        None
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    fn dispatch(&self, _: &[i32]) {}

    fn has_screen_reader(&self) -> bool {
        false
    }

    fn accessibility_changed(&self, _: &[accessibility::Event]) {}

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

    fn command(&self, command: &WindowCommand) -> Result<()> {
        match *command {
            WindowCommand::Size(size) => {
                self.geometry.set(Geometry {
                    width: size.width,
                    height: size.height,
                    ..self.geometry.get()
                });
                window::bounds_changed(self.id);
            }
            WindowCommand::Fullscreen(is_fullscreen) => self.geometry.set(Geometry {
                is_fullscreen,
                ..self.geometry.get()
            }),
            _ => {}
        }
        Ok(())
    }

    fn is_minimized(&self) -> bool {
        false
    }

    fn handle(&self) -> u64 {
        0
    }
}
