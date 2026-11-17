//! <https://dom.spec.whatwg.org/#eventtarget-event-listener-list>

use core::ops::Range;

use bun_jsc::AbortSignal;
use bun_jsc::bindgen::JsLocal;
use smallvec::SmallVec;

use super::*;
use crate::api::indexeddb::IDBDatabase;
use crate::api::storage::listen_to_storage;
use crate::generated_bindgen::core::{
    AddEventListenerOptionsOrBoolean, EventListenerOptionsOrBoolean,
    js_DesktopEventTarget as js_EventTarget,
};
use crate::generated_bindgen::events::js_Listeners;

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) struct Is: u8 {
        const ONCE = 1;
        const PASSIVE = 1 << 1;
        /// `on*`
        const HANDLER = 1 << 2;
        /// What it has for a callback is for `pending::compile_handler`.
        const UNCOMPILED = 1 << 3;
        const CALLABLE = 1 << 4;
    }
}

/// The type, and whether it captures.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Key(u32);

impl Key {
    #[inline]
    pub(super) fn new(kind: EventType, captures: bool) -> Key {
        Key(kind.0 << 1 | u32::from(captures))
    }

    #[inline]
    pub(super) fn bit(self) -> u64 {
        1 << (self.0 % 64)
    }

    fn kind(self) -> EventType {
        EventType(self.0 >> 1)
    }
}

const NO_SIGNAL: u32 = u32::MAX;

#[derive(Clone, Copy)]
pub(super) struct Listener {
    pub(super) key: Key,
    /// In the order in which they were added.
    pub(super) serial: u32,
    callback: u32,
    signal: u32,
    pub(super) is: Is,
}

#[derive(Default)]
pub(crate) struct Listeners {
    /// By their keys, and then by their serials.
    all: RefCell<SmallVec<[Listener; 2]>>,
    /// `Key::bit` of all that it has ever had.
    keys: Cell<u64>,
    next_serial: Cell<u32>,
    free_slots: Cell<u32>,
}

impl Listeners {
    fn rest(&self) -> Option<List<'_>> {
        js_Listeners::rest(self).map(List::from_value)
    }

    fn value(&self, slot: u32) -> JSValue {
        match slot {
            0 => field(js_Listeners::first(self)),
            1 => field(js_Listeners::second(self)),
            _ => self.rest().map_or(JSValue::ZERO, |it| it.get(slot - 2)),
        }
    }

    fn set_value(&self, heap: &JsHeap<'_>, slot: u32, value: JSValue) {
        match slot {
            0 => js_Listeners::set_first(self, value),
            1 => js_Listeners::set_second(self, value),
            _ => _ = self.rest().map(|it| it.set(heap, slot - 2, value)),
        }
    }

    fn store(&self, heap: &JsHeap<'_>, value: JSValue) -> u32 {
        let free = || {
            Some(
                self.rest()
                    .filter(|_| self.free_slots.get() > 0)?
                    .position(JSValue::UNDEFINED)?
                    + 2,
            )
        };
        if let Some(slot) = (0..2).find(|it| self.value(*it).is_empty()).or_else(free) {
            self.free_slots.update(|it| it - u32::from(slot >= 2));
            self.set_value(heap, slot, value);
            return slot;
        }
        let rest = self.rest().unwrap_or_else(|| List::new(heap));
        js_Listeners::set_rest(self, rest.to_js());
        rest.push(heap, value);
        rest.len() + 1
    }

    fn release(&self, heap: &JsHeap<'_>, slot: u32) {
        self.free_slots.update(|it| it + u32::from(slot >= 2));
        self.set_value(
            heap,
            slot,
            if slot < 2 {
                JSValue::ZERO
            } else {
                JSValue::UNDEFINED
            },
        );
    }

    #[inline]
    pub(super) fn may_have(&self, bits: u64) -> bool {
        self.keys.get() & bits != 0
    }

    #[inline]
    pub(super) fn keys(&self) -> u64 {
        self.keys.get()
    }

    pub(super) fn next_serial(&self) -> u32 {
        self.next_serial.get()
    }

    pub(super) fn callback(&self, listener: Listener) -> JSValue {
        self.value(listener.callback)
    }

    /// It is as good as removed.
    pub(super) fn is_aborted(&self, listener: Listener) -> bool {
        listener.signal != NO_SIGNAL
            && AbortSignal::from_js(&self.value(listener.signal)).is_some_and(|it| it.aborted())
    }

    pub(super) fn first_among(&self, key: Key, serials: Range<u32>) -> Option<Listener> {
        let all = self.all.borrow();
        all.get(all.partition_point(|it| (it.key, it.serial) < (key, serials.start)))
            .filter(|it| it.key == key && it.serial < serials.end)
            .copied()
    }

    fn find(&self, key: Key, mut test: impl FnMut(Listener) -> bool) -> Option<Listener> {
        if !self.may_have(key.bit()) {
            return None;
        }
        let all = self.all.borrow();
        all[all.partition_point(|it| it.key < key)..]
            .iter()
            .copied()
            .take_while(|it| it.key == key)
            .find(|it| test(*it))
    }

    fn has(&self, key: Key, unless: Is) -> bool {
        self.find(key, |it| !it.is.intersects(unless) && !self.is_aborted(it))
            .is_some()
    }

    fn add(&self, heap: &JsHeap<'_>, key: Key, is: Is, callback: JSValue, signal: Option<JSValue>) {
        let (callback, signal) = (
            self.store(heap, callback),
            signal.map_or(NO_SIGNAL, |it| self.store(heap, it)),
        );
        let mut all = self.all.borrow_mut();
        let index = all.partition_point(|it| it.key <= key);
        all.insert(
            index,
            Listener {
                key,
                serial: self.next_serial.get(),
                callback,
                signal,
                is,
            },
        );
        self.next_serial
            .update(|it| it + u32::from(it < u32::MAX - 1));
        self.keys.update(|it| it | key.bit());
    }

    fn remove(&self, heap: &JsHeap<'_>, listener: Listener) {
        self.all
            .borrow_mut()
            .retain(|it| it.callback != listener.callback);
        self.release(heap, listener.callback);
        if listener.signal != NO_SIGNAL {
            self.release(heap, listener.signal);
        }
    }

    pub(super) fn handler(&self, kind: EventType) -> Option<Listener> {
        self.find(Key::new(kind, false), |it| it.is.contains(Is::HANDLER))
    }

    pub(super) fn change_handler(
        &self,
        heap: &JsHeap<'_>,
        handler: Listener,
        is: Is,
        callback: JSValue,
    ) {
        self.all
            .borrow_mut()
            .iter_mut()
            .filter(|it| it.callback == handler.callback)
            .for_each(|it| it.is = is);
        self.set_value(heap, handler.callback, callback);
    }
}

impl EventTarget {
    #[inline]
    pub(super) fn listeners(&self) -> Option<&Listeners> {
        js_EventTarget::listeners(self)
    }

    /// The compositor has to wait for what may cancel a `wheel` event.
    fn wheel_listeners_changed(&self) {
        let blocks = |it: &EventTarget| {
            [atom!("wheel"), atom!("mousewheel")]
                .into_iter()
                .any(|name| it.has_listener_unless(name.into(), Is::PASSIVE))
        };
        match self.as_node().filter(|it| it.as_doc().is_none()) {
            Some(node) => {
                node.toggle(NodeFlags::BLOCKS_WHEEL, blocks(self));
                node.engine(|engine, id| engine.set_blocks_wheel(id, blocks(self)));
            }
            None => {
                let window = self.as_window().or_else(|| self.as_node()?.doc().window());
                if let Some((it, doc)) = window.and_then(|it| Some((it, it.doc()?))) {
                    doc.engine(|engine, id| engine.set_blocks_wheel(id, blocks(it) || blocks(doc)));
                }
            }
        }
    }

    fn press_listeners_changed(&self) {
        if let Some(node) = self
            .as_node()
            .filter(|it| it.is_connected() && it.doc().is(DocFlags::IS_ACCESSIBLE))
        {
            node.engine(|engine, id| engine.forget_facts(id));
        }
    }

    pub(super) fn add_listener(
        &self,
        heap: &JsHeap<'_>,
        key: Key,
        is: Is,
        callback: JSValue,
        signal: Option<JSValue>,
    ) {
        let listeners = self.listeners().unwrap_or_else(|| {
            let made = js_Listeners::create(heap, Listeners::default());
            js_EventTarget::set_listeners(self, Some(made));
            IDBDatabase::from_js(heap, self.to_js()).inspect(|it| it.listener_added(heap));
            made
        });
        listeners.add(heap, key, is, callback, signal);
        if key.kind().is_wheel() {
            self.wheel_listeners_changed();
        } else if key.kind().is_press() {
            self.press_listeners_changed();
        } else if key.kind() == atom!("storage").into() {
            JsInterface::downcast(self).inspect(|it| listen_to_storage(heap, it));
        } else if key.kind() == atom!("change").into() {
            crate::api::cssom::change_listener_added(heap, self);
        }
    }

    pub(super) fn remove_listener(
        &self,
        heap: &JsHeap<'_>,
        listeners: &Listeners,
        listener: Listener,
    ) {
        listeners.remove(heap, listener);
        if listener.key.kind().is_wheel() {
            self.wheel_listeners_changed();
        } else if listener.key.kind().is_press() {
            self.press_listeners_changed();
        }
    }

    pub(crate) fn remove_all_listeners(&self) {
        self.listeners().map(|it| it.all.take());
        js_EventTarget::set_listeners(self, None);
    }

    fn has_listener_unless(&self, kind: EventType, unless: Is) -> bool {
        self.listeners().is_some_and(|it| {
            it.has(Key::new(kind, false), unless) || it.has(Key::new(kind, true), unless)
        })
    }

    pub(crate) fn has_listeners(&self, kind: impl Into<EventType>) -> bool {
        self.has_listener_unless(kind.into(), Is::empty())
    }

    pub(crate) fn has_any_listener(&self) -> bool {
        self.listeners()
            .is_some_and(|all| all.all.borrow().iter().any(|it| !all.is_aborted(*it)))
    }

    fn is_outermost(&self) -> bool {
        match self.as_node() {
            Some(node) => {
                node.as_doc().is_some()
                    || node.parent() == Some(node.doc())
                    || node.doc().body().is_some_and(|it| **it == *node)
            }
            None => self.as_window().is_some(),
        }
    }

    pub(crate) fn add_event_listener<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &Atom,
        callback: Option<JsLocal<'a, bun_jsc::JSObject>>,
        options: Option<AddEventListenerOptionsOrBoolean<'a>>,
    ) -> bindgen::Result<'a, ()> {
        let (captures, once, passive, signal) = match options {
            None => (false, false, None, None),
            Some(AddEventListenerOptionsOrBoolean::Capture(captures)) => {
                (captures, false, None, None)
            }
            Some(AddEventListenerOptionsOrBoolean::Options(it)) => (
                it.capture,
                it.once,
                it.passive,
                Some(it.signal.to_js()).filter(|it| !it.is_undefined()),
            ),
        };
        match signal.as_ref().map(AbortSignal::from_js) {
            Some(None) => {
                return Err(heap.type_error(format_args!(
                    "Failed to execute 'addEventListener': signal is not an 'AbortSignal'."
                )));
            }
            Some(Some(signal)) if signal.aborted() => return Ok(()),
            _ => {}
        }
        let Some(callback) = callback.map(JsLocal::to_js) else {
            return Ok(());
        };
        let kind = EventType::for_listener(name);
        let key = Key::new(kind, captures);
        if let Some(listeners) = self.listeners() {
            while let Some(it) = listeners.find(key, |it| {
                listeners.is_aborted(it)
                    || listeners.callback(it) == callback && !it.is.contains(Is::HANDLER)
            }) {
                if !listeners.is_aborted(it) {
                    return Ok(());
                }
                listeners.remove(heap, it);
            }
        }
        let mut is = if once { Is::ONCE } else { Is::empty() };
        is.set(
            Is::PASSIVE,
            passive.unwrap_or_else(|| kind.blocks_scrolling() && self.is_outermost()),
        );
        is.set(Is::CALLABLE, callback.is_callable());
        self.add_listener(heap, key, is, callback, signal);
        Ok(())
    }

    pub(crate) fn remove_event_listener<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &Atom,
        callback: Option<JsLocal<'a, bun_jsc::JSObject>>,
        options: Option<EventListenerOptionsOrBoolean>,
    ) {
        let captures = match options {
            None => false,
            Some(EventListenerOptionsOrBoolean::Capture(captures)) => captures,
            Some(EventListenerOptionsOrBoolean::Options(it)) => it.capture,
        };
        if let (Some(listeners), Some(kind), Some(callback)) =
            (self.listeners(), EventType::of(name), callback)
            && let Some(found) = listeners.find(Key::new(kind, captures), |it| {
                listeners.callback(it) == callback.to_js() && !it.is.contains(Is::HANDLER)
            })
        {
            self.remove_listener(heap, listeners, found);
        }
    }
}

impl Node {
    fn window_target(&self) -> Option<&EventTarget> {
        self.doc().window().map(|it| &**it)
    }

    /// Whether an event that does not bubble is listened to.
    pub(crate) fn is_heard(&self, name: Known) -> bool {
        let above = core::iter::successors(self.flat_parent(), |it| it.flat_parent())
            .chain([&**self.doc()])
            .map(|it| &**it);
        let captures = |it: &EventTarget| {
            it.listeners()
                .is_some_and(|it| it.has(Key::new(name.into(), true), Is::empty()))
        };
        is_listened_to(name)
            && (self.has_listeners(name) || above.chain(self.window_target()).any(captures))
    }

    pub(crate) fn has_blocking_listener_above(&self, name: Known) -> bool {
        let above = core::iter::successors(Some(self), |it| {
            it.assigned_slot()
                .map(|it| &**it)
                .or_else(|| it.parent_or_host())
        })
        .map(|it| &**it);
        above
            .chain(self.window_target())
            .any(|it| it.has_listener_unless(name.into(), Is::PASSIVE))
    }
}
