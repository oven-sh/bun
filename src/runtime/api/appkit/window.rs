//! `AppKitWindow`: the JavaScript face of one `bun_appkit::Window`.

use core::cell::Cell;
use std::rc::Rc;

use bun_appkit::{Point, Size, SizeLimits, Window, WindowOptions, WindowSink};
use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult};

use super::app;
use super::conv::{self, JsStr};
use super::slots::JsSlots;
use super::view::AppKitView;

use crate::generated_classes::js_AppKitWindow as js;

/// The wrapper object is held strongly while the window is open (an open
/// window keeps itself alive) and weakly once it closes.
struct Events {
    slots: Rc<JsSlots>,
    open: Cell<Option<app::OpenWindow>>,
}

/// `{ k1: a, k2: b }` for the resize and move payloads.
fn pair_object(global: &JSGlobalObject, k1: &[u8], a: f64, k2: &[u8], b: f64) -> JSValue {
    let object = JSValue::create_empty_object(global, 2);
    object.put(global, k1, JSValue::js_number(a));
    object.put(global, k2, JSValue::js_number(b));
    object
}

impl WindowSink for Events {
    fn should_close(&self) -> bool {
        self.slots.allows(js::should_close_get_cached, &[])
    }

    fn closed(&self) {
        self.open.take();
        self.slots.call(js::on_close_get_cached, &[]);
        self.slots.release();
    }

    fn resized(&self, size: Size) {
        let payload = pair_object(
            self.slots.global(),
            b"width",
            size.width,
            b"height",
            size.height,
        );
        self.slots.call(js::on_resize_get_cached, &[payload]);
    }

    fn moved(&self, origin: Point) {
        let payload = pair_object(self.slots.global(), b"x", origin.x, b"y", origin.y);
        self.slots.call(js::on_move_get_cached, &[payload]);
    }

    fn focused(&self) {
        self.slots.call(js::on_focus_get_cached, &[]);
    }

    fn blurred(&self) {
        self.slots.call(js::on_blur_get_cached, &[]);
    }
}

/// One top-level window.
#[bun_jsc::JsClass]
pub struct AppKitWindow {
    window: Window,
    slots: Rc<JsSlots>,
}

fn options_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<WindowOptions> {
    let mut opts = WindowOptions::default();
    if value.is_undefined_or_null() {
        return Ok(opts);
    }
    if !value.is_object() {
        return Err(
            global.throw_invalid_arguments(format_args!("Window options must be an object"))
        );
    }
    let points = |name: &'static str| -> JsResult<Option<f64>> {
        match value.get(global, name)? {
            Some(v) => conv::optional_points(global, v, format_args!("Window.{name}")),
            None => Ok(None),
        }
    };
    let flag = |name: &'static str, default: bool| -> JsResult<bool> {
        match value.get(global, name)? {
            Some(v) if !v.is_null() => conv::boolean(global, v, format_args!("Window.{name}")),
            _ => Ok(default),
        }
    };
    let string = |name: &'static str| -> JsResult<Option<String>> {
        match value.get(global, name)? {
            Some(v) => Ok(
                conv::optional_string(global, v, format_args!("Window.{name}"))?
                    .map(|s| s.to_utf8().into_string()),
            ),
            None => Ok(None),
        }
    };
    opts.title = string("title")?;
    if let Some(width) = points("width")? {
        opts.width = width.max(0.0);
    }
    if let Some(height) = points("height")? {
        opts.height = height.max(0.0);
    }
    opts.origin = match (points("x")?, points("y")?) {
        (Some(x), Some(y)) => Some(Point { x, y }),
        (None, None) => None,
        _ => {
            return Err(global.throw_invalid_arguments(format_args!(
                "Window.x and Window.y must be given together"
            )));
        }
    };
    opts.limits = SizeLimits {
        min_width: points("minWidth")?,
        min_height: points("minHeight")?,
        max_width: points("maxWidth")?,
        max_height: points("maxHeight")?,
    };
    opts.resizable = flag("resizable", true)?;
    opts.closable = flag("closable", true)?;
    opts.minimizable = flag("minimizable", true)?;
    opts.full_size_content = flag("fullSizeContent", false)?;
    opts.titlebar_transparent = flag("titlebarTransparent", false)?;
    opts.title_hidden = flag("titleHidden", false)?;
    if let Some(background) = value.get(global, "background")? {
        opts.background = conv::color(global, background, format_args!("Window.background"))?;
    }
    opts.restore_name = string("restoreName")?;
    if let Some(alpha) = value.get(global, "alpha")? {
        if let Some(alpha) = conv::optional_number(global, alpha, format_args!("Window.alpha"))? {
            opts.alpha = alpha;
        }
    }
    Ok(opts)
}

impl AppKitWindow {
    pub fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<AppKitWindow>> {
        let opts = options_from_js(global, frame.argument(0))?;
        let application = app::started(global)?;
        let slots = Rc::new(JsSlots::strong(this_value, global));
        let window = conv::check(
            global,
            Window::new(
                application,
                &opts,
                Box::new(Events {
                    slots: Rc::clone(&slots),
                    open: Cell::new(Some(app::OpenWindow::new())),
                }),
            ),
        )?;
        Ok(Box::new(AppKitWindow { window, slots }))
    }

    pub fn set(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let value = frame.argument(1);
        let window = &self.window;
        match key.as_str() {
            "title" => {
                let title = conv::optional_string(global, value, format_args!("Window.title"))?;
                let title = title
                    .as_ref()
                    .map_or(bun_appkit::NsStr::Utf8(""), JsStr::ns);
                conv::check(global, window.set_title(title))?;
            }
            "width" | "height" => {
                let v = conv::optional_points(global, value, format_args!("Window.{key}"))?;
                let mut size = window.content_size();
                let default = WindowOptions::default();
                if key == "width" {
                    size.width = v.unwrap_or(default.width).max(0.0);
                } else {
                    size.height = v.unwrap_or(default.height).max(0.0);
                }
                conv::check(global, window.set_content_size(size))?;
            }
            "x" | "y" => {
                let v = conv::optional_points(global, value, format_args!("Window.{key}"))?;
                let result = match v {
                    None => window.center(),
                    Some(v) => {
                        let mut origin = window.position();
                        if key == "x" {
                            origin.x = v;
                        } else {
                            origin.y = v;
                        }
                        window.set_position(origin)
                    }
                };
                conv::check(global, result)?;
            }
            "minWidth" | "minHeight" | "maxWidth" | "maxHeight" => {
                let v = conv::optional_points(global, value, format_args!("Window.{key}"))?;
                let mut limits = window.limits();
                match key.as_str() {
                    "minWidth" => limits.min_width = v,
                    "minHeight" => limits.min_height = v,
                    "maxWidth" => limits.max_width = v,
                    _ => limits.max_height = v,
                }
                conv::check(global, window.set_limits(limits))?;
            }
            "background" => {
                let color = conv::color(global, value, format_args!("Window.background"))?;
                conv::check(global, window.set_background(color.as_ref()))?;
            }
            "alpha" => {
                let alpha = conv::optional_number(global, value, format_args!("Window.alpha"))?;
                conv::check(global, window.set_alpha(alpha.unwrap_or(1.0)))?;
            }
            other => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Window has no settable property \"{other}\""
                )));
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let window = &self.window;
        Ok(match key.as_str() {
            "title" => conv::utf16_to_js(global, &window.title())?,
            "width" => JSValue::js_number(window.content_size().width),
            "height" => JSValue::js_number(window.content_size().height),
            "x" => JSValue::js_number(window.position().x),
            "y" => JSValue::js_number(window.position().y),
            other => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Window has no readable property \"{other}\""
                )));
            }
        })
    }

    pub fn set_content(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let value = frame.argument(0);
        if value.is_undefined_or_null() {
            conv::check(global, self.window.set_content(None))?;
            return Ok(JSValue::UNDEFINED);
        }
        let Some(view) = value.as_class_ref::<AppKitView>() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Window content must be an AppKitView or null"
            )));
        };
        conv::check(
            global,
            self.window.set_content(Some(&*view.native(global)?)),
        )?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn show(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.window.show())?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn hide(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.window.hide())?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn center(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.window.center())?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn focus(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.window.focus())?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn close(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.window.close();
        Ok(JSValue::UNDEFINED)
    }

    pub fn snapshot(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(match self.window.snapshot_png() {
            Some(png) => JSUint8Array::from_bytes(global, png.into_boxed_slice()),
            None => JSValue::NULL,
        })
    }

    /// The `NSWindow` as an `ObjCObject`; a new wrapper on each read.
    pub fn get_native(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let object = conv::check(global, self.window.ns_window_object())?;
        Ok(super::objc::ObjCObject::wrap(global, object))
    }

    pub fn get_closed(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.window.is_closed()))
    }

    pub fn get_visible(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.window.is_visible()))
    }

    pub fn get_key(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.window.is_key()))
    }

    /// Event slots start empty; JavaScript assigns them and the cached
    /// value is what gets read back.
    pub fn get_on_close(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_should_close(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_resize(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_move(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_focus(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_blur(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

impl Drop for AppKitWindow {
    fn drop(&mut self) {
        // `Window`'s drop closes an open window, which reports `closed`;
        // a collected wrapper must not be called into from there.
        self.slots.finalize();
    }
}
