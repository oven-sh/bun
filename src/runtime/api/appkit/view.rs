//! `AppKitView`: the JavaScript face of one `bun_appkit::View`.

use std::rc::Rc;

use bun_appkit::{Event, Kind, Named, View, ViewSink};
use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult};

use super::conv::{self, JsStr};
use super::slots::JsSlots;

use crate::generated_classes::js_AppKitView as js;

/// The wrapper object is held weakly: the JavaScript view tree keeps mounted
/// views alive.
struct Events {
    slots: Rc<JsSlots>,
}

/// A `selectedIndex` for JavaScript: `-1` for none.
fn index_to_js(index: Option<usize>) -> JSValue {
    JSValue::js_number(index.map_or(-1.0, |i| i as f64))
}

fn indexes_to_js(global: &JSGlobalObject, indexes: &[usize]) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, indexes.iter(), |i| {
        Ok(JSValue::js_number(*i as f64))
    })
}

impl ViewSink for Events {
    /// Text events carry no payload: `bun:appkit` reads `get("value")` when
    /// the handler runs.
    fn event(&self, event: Event) {
        let global = self.slots.global();
        let (slot, payload): (fn(JSValue) -> Option<JSValue>, Option<JSValue>) = match event {
            Event::Action => (js::on_action_get_cached, None),
            Event::Toggled(on) => (js::on_change_get_cached, Some(JSValue::js_boolean(on))),
            Event::TextChanged => (js::on_change_get_cached, None),
            Event::Submitted => (js::on_submit_get_cached, None),
            Event::ValueChanged(v) => (js::on_change_get_cached, Some(JSValue::js_number(v))),
            Event::IndexChanged(i) => (js::on_change_get_cached, Some(index_to_js(i))),
            Event::SelectionChanged(indexes) => match indexes_to_js(global, &indexes) {
                Ok(array) => (js::on_select_get_cached, Some(array)),
                Err(err) => {
                    // Reported the way a throw from the handler itself would be.
                    let _ = bun_jsc::task::report_error_or_terminate(global, err);
                    return;
                }
            },
            Event::RowActivated(row) => {
                (js::on_activate_get_cached, Some(JSValue::js_number(row as f64)))
            }
            Event::EditingBegan => (js::on_focus_get_cached, None),
            Event::EditingEnded => (js::on_blur_get_cached, None),
        };
        self.slots.call(slot, payload.as_slice());
    }
}

/// One native view. JavaScript picks the kind by name at construction.
#[bun_jsc::JsClass]
pub struct AppKitView {
    view: View,
    slots: Rc<JsSlots>,
}

impl AppKitView {
    pub fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<AppKitView>> {
        let name = JsStr::new(global, frame.argument(0), format_args!("view kind"))?.to_utf8();
        let Some(kind) = Kind::from_name(&name) else {
            return Err(
                global.throw_invalid_arguments(format_args!("Unknown view kind \"{name}\""))
            );
        };
        let slots = Rc::new(JsSlots::weak(this_value, global));
        let view = conv::check(
            global,
            View::new(
                kind,
                Box::new(Events {
                    slots: Rc::clone(&slots),
                }),
            ),
        )?;
        Ok(Box::new(AppKitView { view, slots }))
    }

    /// The native view behind an `AppKitView` wrapper, for a method argument.
    fn peer<'a>(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<&'a AppKitView> {
        value.as_class_ref::<AppKitView>().ok_or_else(|| {
            global.throw_invalid_arguments(format_args!("{what} must be an AppKitView"))
        })
    }

    pub(super) fn native(&self) -> &View {
        &self.view
    }

    pub fn set(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let value = frame.argument(1);
        let kind = self.view.kind();
        let result = conv::with_prop(global, kind, key.as_bytes(), value, |prop| {
            self.view.set(prop)
        })?;
        if let Err(bun_appkit::Error::UnknownProp(kind)) = &result {
            return Err(global.throw_invalid_arguments(format_args!(
                "{} has no property \"{key}\"",
                kind.name()
            )));
        }
        conv::check(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    /// Reads of state the user can change from the UI. Throws, like `set`,
    /// for a key this kind does not have.
    pub fn get(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let view = &self.view;
        let kind = view.kind();
        let missing = || {
            global.throw_invalid_arguments(format_args!(
                "{} has no readable property \"{key}\"",
                kind.name()
            ))
        };
        match key.as_str() {
            "value" if kind.value_is_text() => {
                conv::utf16_to_js(global, &view.text().ok_or_else(missing)?)
            }
            "value" => Ok(JSValue::js_number(view.number().ok_or_else(missing)?)),
            "checked" => Ok(JSValue::js_boolean(view.checked().ok_or_else(missing)?)),
            "selectedIndex" => Ok(index_to_js(view.selected_index().ok_or_else(missing)?)),
            "selectedIndexes" => {
                indexes_to_js(global, &view.selected_indexes().ok_or_else(missing)?)
            }
            _ => Err(missing()),
        }
    }

    pub fn insert_child(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let child = Self::peer(global, frame.argument(0), "child")?;
        let index = conv::number(global, frame.argument(1), format_args!("index"))?;
        if index < 0.0 || index.fract() != 0.0 {
            return Err(global.throw_invalid_arguments(format_args!(
                "index must be a non-negative integer"
            )));
        }
        conv::check(global, self.view.insert_child(&child.view, index as usize))?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn remove_child(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let child = Self::peer(global, frame.argument(0), "child")?;
        conv::check(global, self.view.remove_child(&child.view))?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn click(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.view.click();
        Ok(JSValue::UNDEFINED)
    }

    pub fn snapshot(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(match self.view.snapshot_png() {
            Some(png) => JSUint8Array::from_bytes(global, png.into_boxed_slice()),
            None => JSValue::NULL,
        })
    }

    pub fn get_frame(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let frame = self.view.frame();
        let object = JSValue::create_empty_object(global, 4);
        object.put(global, b"x", JSValue::js_number(frame.origin.x));
        object.put(global, b"y", JSValue::js_number(frame.origin.y));
        object.put(global, b"width", JSValue::js_number(frame.size.width));
        object.put(global, b"height", JSValue::js_number(frame.size.height));
        Ok(object)
    }

    /// Event slots start empty; JavaScript assigns them and the cached
    /// value is what gets read back.
    pub fn get_on_action(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_change(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_submit(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_focus(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_blur(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_select(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_activate(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

impl Drop for AppKitView {
    fn drop(&mut self) {
        self.slots.finalize();
    }
}
