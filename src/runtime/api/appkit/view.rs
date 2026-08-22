//! `AppKitView`: the JavaScript face of one `bun_appkit::View`.

use core::cell::{Cell, Ref, RefCell};
use core::ops::Deref;
use std::rc::Rc;

use bun_appkit::view::TableRows;
use bun_appkit::{Event, Kind, Named, NsStr, View, ViewSink};
use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsError, JsResult};

use super::conv::{self, JsStr};
use super::gpu;
use super::slots::{JsSlots, SlotOutcome};

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

/// A table's rows as JavaScript gave them: the strings stay JavaScript's
/// and are only read when their cell is displayed.
pub(super) struct JsRows(pub(super) Vec<Vec<JsStr>>);

impl TableRows for JsRows {
    fn len(&self) -> usize {
        self.0.len()
    }

    fn cell(&self, row: usize, column: usize) -> Option<NsStr<'_>> {
        self.0.get(row)?.get(column).map(JsStr::ns)
    }
}

impl ViewSink for Events {
    /// Text events carry no payload: `bun:appkit` reads `get("value")` when
    /// the handler runs.
    fn event(&self, event: Event) -> bool {
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
                    return true;
                }
            },
            Event::RowActivated(row) => (
                js::on_activate_get_cached,
                Some(JSValue::js_number(row as f64)),
            ),
            Event::EditingBegan => (js::on_focus_get_cached, None),
            Event::EditingEnded => (js::on_blur_get_cached, None),
            Event::Frame => {
                if let Some(wrapper) = self
                    .slots
                    .this()
                    .and_then(|this| this.as_class_ref::<AppKitView>())
                {
                    if let Some(view) = wrapper.live() {
                        gpu::deliver_frame(&self.slots, &view);
                    }
                }
                return true;
            }
            Event::DrawableResized(size) => {
                let payload = JSValue::create_empty_object(global, 2);
                payload.put(global, b"width", JSValue::js_number(size.width));
                payload.put(global, b"height", JSValue::js_number(size.height));
                (js::on_resize_get_cached, Some(payload))
            }
        };
        !matches!(
            self.slots.call(slot, payload.as_slice()),
            SlotOutcome::Skipped
        )
    }
}

/// One native view. JavaScript picks the kind by name at construction.
/// `release()` frees the native view ahead of garbage collection; every
/// later call throws.
#[bun_jsc::JsClass]
pub struct AppKitView {
    kind: Kind,
    view: RefCell<Option<View>>,
    /// `release()` arrived while a call on the view was still on the stack
    /// (from inside one of its own event handlers); honoured when it ends.
    release_pending: Cell<bool>,
    slots: Rc<JsSlots>,
}

/// The native view borrowed for one call. Dropping it carries out a
/// `release()` that was asked for during the call.
pub(super) struct Live<'a> {
    view: Option<Ref<'a, View>>,
    owner: &'a AppKitView,
}

impl Deref for Live<'_> {
    type Target = View;
    fn deref(&self) -> &View {
        self.view.as_ref().unwrap()
    }
}

impl Drop for Live<'_> {
    fn drop(&mut self) {
        self.view = None;
        self.owner.settle();
    }
}

fn released(global: &JSGlobalObject, kind: Kind) -> JsError {
    global
        .err(
            bun_jsc::ErrorCode::INVALID_STATE,
            format_args!("{} has been released", kind.name()),
        )
        .throw()
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
        Ok(Box::new(AppKitView {
            kind,
            view: RefCell::new(Some(view)),
            release_pending: Cell::new(false),
            slots,
        }))
    }

    /// The native view behind an `AppKitView` wrapper, for a method argument.
    fn peer<'a>(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<&'a AppKitView> {
        value.as_class_ref::<AppKitView>().ok_or_else(|| {
            global.throw_invalid_arguments(format_args!("{what} must be an AppKitView"))
        })
    }

    /// The native view for one call, or a `TypeError` once released.
    pub(super) fn native(&self, global: &JSGlobalObject) -> JsResult<Live<'_>> {
        self.live().ok_or_else(|| released(global, self.kind))
    }

    fn live(&self) -> Option<Live<'_>> {
        if self.release_pending.get() {
            return None;
        }
        let view = Ref::filter_map(self.view.try_borrow().ok()?, Option::as_ref).ok()?;
        Some(Live {
            view: Some(view),
            owner: self,
        })
    }

    fn settle(&self) {
        if self.release_pending.get() {
            if let Ok(mut slot) = self.view.try_borrow_mut() {
                self.release_pending.set(false);
                drop(slot.take());
            }
        }
    }

    /// Frees the native view now. Idempotent.
    pub fn release(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        match self.view.try_borrow_mut() {
            Ok(mut slot) => drop(slot.take()),
            Err(_) => self.release_pending.set(true),
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_released(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        let gone =
            self.release_pending.get() || matches!(self.view.try_borrow().as_deref(), Ok(None));
        Ok(JSValue::js_boolean(gone))
    }

    pub fn set(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let key = JsStr::new(global, frame.argument(0), format_args!("key"))?.to_utf8();
        let value = frame.argument(1);
        let view = self.native(global)?;
        let kind = view.kind();
        let result = conv::with_prop(global, kind, key.as_bytes(), value, |prop| view.set(prop))?;
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
        let view = self.native(global)?;
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
            return Err(global
                .throw_invalid_arguments(format_args!("index must be a non-negative integer")));
        }
        conv::check(
            global,
            self.native(global)?
                .insert_child(&*child.native(global)?, index as usize),
        )?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn remove_child(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let child = Self::peer(global, frame.argument(0), "child")?;
        conv::check(
            global,
            self.native(global)?.remove_child(&*child.native(global)?),
        )?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn click(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::check(global, self.native(global)?.click())?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn snapshot(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(match self.native(global)?.snapshot_png() {
            Some(png) => JSUint8Array::from_bytes(global, png.into_boxed_slice()),
            None => JSValue::NULL,
        })
    }

    /// MetalView: encode and present one frame now (fires `onFrame`).
    pub fn draw(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if self.kind != Kind::MetalView {
            return Err(global.throw_invalid_arguments(format_args!(
                "{}.draw(): only a MetalView draws frames",
                self.kind.name()
            )));
        }
        conv::check(global, self.native(global)?.draw())?;
        Ok(JSValue::UNDEFINED)
    }

    /// MetalView: the drawable's size in pixels, `null` for other kinds or without a GPU.
    pub fn get_drawable_size(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(size) = self.native(global)?.drawable_size() else {
            return Ok(JSValue::NULL);
        };
        let object = JSValue::create_empty_object(global, 2);
        object.put(global, b"width", JSValue::js_number(size.width));
        object.put(global, b"height", JSValue::js_number(size.height));
        Ok(object)
    }

    /// The widget's `NSView` as an `ObjCObject`; a new wrapper on each read.
    pub fn get_native(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let object = self.native(global)?.ns_view_object();
        Ok(super::objc::ObjCObject::wrap(global, object))
    }

    pub fn get_frame(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let frame = self.native(global)?.frame();
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

    pub fn get_on_frame(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_on_resize(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

impl Drop for AppKitView {
    fn drop(&mut self) {
        self.slots.finalize();
    }
}
