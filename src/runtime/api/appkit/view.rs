//! `AppKitView`: the JavaScript face of one `bun_appkit::View`, the Metal view.

use std::rc::Rc;

use bun_appkit::geometry::{ClearColor, Size};
use bun_appkit::{View, ViewSink};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::conv::{self, JsStr};
use super::gpu;
use super::slots::JsSlots;

use crate::generated_classes::js_AppKitView as js;

/// The wrapper object is held weakly: the JavaScript view tree keeps mounted
/// views alive.
struct Events {
    slots: Rc<JsSlots>,
}

impl ViewSink for Events {
    fn frame(&self) {
        if let Some(this) = self.slots.this() {
            gpu::deliver_frame(&self.slots, this);
        }
    }

    fn drawable_resized(&self, size: Size) {
        let payload = size_to_js(self.slots.global(), size);
        self.slots.call(js::on_resize_get_cached, &[payload]);
    }
}

fn size_to_js(global: &JSGlobalObject, size: Size) -> JSValue {
    let object = JSValue::create_empty_object(global, 2);
    object.put(global, b"width", JSValue::js_number(size.width));
    object.put(global, b"height", JSValue::js_number(size.height));
    object
}

/// The native part of a `MetalView`, the one view not built in JavaScript.
#[bun_jsc::JsClass]
pub struct AppKitView {
    view: View,
    slots: Rc<JsSlots>,
}

impl AppKitView {
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<AppKitView>> {
        let slots = Rc::new(JsSlots::weak(this_value, global));
        let sink = Box::new(Events {
            slots: Rc::clone(&slots),
        });
        let view = conv::check(global, View::new(sink))?;
        Ok(Box::new(AppKitView { view, slots }))
    }

    /// See [`super::objc::drop_later`]: the view is dropped later, not here.
    pub fn finalize(self: Box<Self>) {
        self.slots.finalize();
        super::objc::drop_later(self);
    }

    pub(super) fn view(&self) -> &View {
        &self.view
    }

    /// `set(key, value)`: one of the three props; `undefined`/`null` restores
    /// the default. `clearColor` arrives parsed, as `[r, g, b, a]` in sRGB.
    pub fn set(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let value = frame.argument(1);
        let what = format_args!("MetalView.{key}");
        match key.as_bytes() {
            b"running" => self
                .view
                .set_running(conv::optional_boolean(global, value, what)?),
            b"clearColor" => self.view.set_clear_color(if value.is_undefined_or_null() {
                None
            } else {
                Some(clear_color(global, value, what)?)
            }),
            b"preferredFPS" => self
                .view
                .set_preferred_fps(conv::optional_number(global, value, what)?),
            _ => {
                return Err(global
                    .throw_invalid_arguments(format_args!("MetalView has no property \"{key}\"")));
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Encode and present one frame now (fires `onFrame`).
    pub fn draw(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.view.draw())?;
        Ok(JSValue::UNDEFINED)
    }

    /// The drawable's size in pixels, `null` without a GPU.
    pub fn get_drawable_size(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match self.view.drawable_size() {
            Some(size) => size_to_js(global, size),
            None => JSValue::NULL,
        })
    }

    /// The view's `NSView` as an `ObjCObject` (the object's one shared wrapper).
    pub fn get_native(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let object = self.view.ns_view_object();
        Ok(super::objc::ObjCObject::wrap(global, object))
    }

    /// Event slots start empty; JavaScript assigns them and the cached
    /// value is what gets read back.
    pub fn get_on_frame(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_resize(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

/// `[r, g, b, a]`, each 0–1: what `bun:appkit` makes of a colour string or
/// array before it reaches Metal.
pub(super) fn clear_color(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<ClearColor> {
    if !value.is_array() || value.get_length(global)? != 4 {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be an [r, g, b, a] array or a color string"
        )));
    }
    let channel = |i: u32| {
        conv::number(
            global,
            value.get_index(global, i)?,
            format_args!("{what}[{i}]"),
        )
    };
    Ok(ClearColor {
        r: channel(0)?,
        g: channel(1)?,
        b: channel(2)?,
        a: channel(3)?,
    })
}
