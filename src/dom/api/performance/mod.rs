//! <https://w3c.github.io/performance-timeline/>

mod entries;
mod events;
mod observer;
mod paint;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::virtual_machine_exports::read_origin_timer_start;
use bun_jsc::{JSObject, JSValue, Weak};
use bun_web::client::Client;
use bun_web::exec::with_js;
use bun_web::timing::{NavigationType, ResourceTiming};

pub(crate) use entries::{Entry, EventEntry, Metric, Painted, Resource, clone_detail};
use entries::{Type, WeakNode, is_legacy_time};
pub(crate) use events::{count_event, note_modal_dialog, present_events, time_event};
pub(crate) use observer::Observer;
pub(crate) use paint::{note_input, note_new_images, report_paint, time_element};

use crate::api::core::*;
use crate::api::events::{self as dom_events, EventInit, WindowTarget};
use crate::api::realm::{client_of, queue_task, realm_of};
use crate::api::window::Window;
use crate::generated_bindgen::performance::*;
use crate::order::Order as _;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

const BUFFER_SIZE: u32 = 150;
const MILESTONES: [&str; 11] = [
    "unloadEventStart",
    "unloadEventEnd",
    "domLoading",
    "domInteractive",
    "domContentLoadedEventStart",
    "domContentLoadedEventEnd",
    "domComplete",
    "loadEventStart",
    "loadEventEnd",
    "first-paint",
    "first-contentful-paint",
];

/// What scripts are told of a time in milliseconds.
#[inline]
pub(crate) fn coarse(time: f64) -> f64 {
    (time * 10.0).floor() / 10.0
}

#[repr(C)]
pub(crate) struct Performance {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_DomPerformance::Fields,
    /// On the clock of the thread.
    origin: Cell<f64>,
    milestones: [Cell<f64>; MILESTONES.len()],
    events: RefCell<events::Timing>,
    painting: paint::Painting,
    resource_limit: Cell<u32>,
    dropped: Cell<u32>,
    navigation_type: Cell<NavigationType>,
    is_delivery_queued: Cell<bool>,
    /// A script has seen it.
    is_started: Cell<bool>,
}

fn list<'a>(field: Option<JSValue>) -> List<'a> {
    List::from_value(field.expect("set when it is made"))
}

fn entries_in<'a>(list: List<'a>) -> impl Iterator<Item = &'a Entry> {
    // SAFETY: nothing else is put into these lists.
    list.values()
        .map(|it| unsafe { Entry::from_js_unchecked(it) })
}

fn select<'a>(
    entries: impl Iterator<Item = &'a Entry>,
    name: Option<&DomString>,
    kind: Option<&DomString>,
) -> Vec<&'a Entry> {
    let mut found: Vec<_> = entries
        .filter(|it| {
            name.is_none_or(|name| it.name == *name)
                && kind.is_none_or(|kind| kind.eq_str(it.kind.name()))
        })
        .collect();
    found.order_by(|a, b| a.start.total_cmp(&b.start));
    found
}

impl Performance {
    fn get<'a>(realm: &JsHeap<'a>) -> &'a Performance {
        Performance::of_realm(realm).unwrap_or_else(|| Performance::create(realm))
    }

    #[cold]
    fn create<'a>(realm: &JsHeap<'a>) -> &'a Performance {
        let made = Performance {
            base: Default::default(),
            fields: Default::default(),
            origin: WindowTarget::of_realm(realm)
                .map_or(0.0, WindowTarget::time_origin)
                .into(),
            milestones: Default::default(),
            events: Default::default(),
            painting: Default::default(),
            resource_limit: 250.into(),
            dropped: 0.into(),
            navigation_type: Default::default(),
            is_delivery_queued: false.into(),
            is_started: false.into(),
        };
        let this = js_DomPerformance::create(realm, made);
        this.set_of_realm(realm);
        js_DomPerformance::set_buffers(
            this,
            List::from_fn(realm, Type::ALL.len() as u32, |_| JSValue::UNDEFINED).to_js(),
        );
        for set in [
            js_DomPerformance::set_overflow,
            js_DomPerformance::set_observers,
            js_DomPerformance::set_targets,
        ] {
            set(this, List::new(realm).to_js());
        }
        this
    }

    /// Windows that share a realm with another one have none.
    fn of_doc<'h, 'a>(
        heap: &'h JsHeap<'a>,
        doc: &'a Doc,
    ) -> Option<(&'h JsHeap<'a>, &'a Performance)> {
        let realm = doc.realm(heap);
        let is_its_own = doc
            .window()
            .zip(WindowTarget::of_realm(realm))
            .is_some_and(|(a, b)| core::ptr::eq(a, b));
        (is_its_own && client_of(realm).is_some()).then(|| (realm, Performance::get(realm)))
    }

    fn start<'a>(&'a self, heap: &JsHeap<'a>) {
        let Some(client) = client_of(heap).filter(|_| !self.is_started.replace(true)) else {
            return;
        };
        if heap.is_window() {
            self.add_navigation(heap, &client);
            let is_visible = WindowTarget::of_realm(heap)
                .and_then(|it| it.downcast::<Window>())
                .is_none_or(|it| it.environment().is_visible);
            self.add_milestone(heap, if is_visible { b"visible" } else { b"hidden" }, 0.0);
            for name in [&b"first-paint"[..], b"first-contentful-paint"]
                .into_iter()
                .filter(|it| self.milestone(it) != 0.0)
            {
                self.add_milestone(heap, name, self.milestone(name));
            }
        }
        let this = Weak::<()>::create_passive(self.to_js(), global_of(heap));
        client.watch_timings(Rc::new(move |record| {
            with_js(|cx| {
                if let Some(this) = this.get().and_then(|it| Performance::from_js(&cx.heap, it)) {
                    this.add_resource(this.realm(&cx.heap), record);
                }
            });
        }));
    }

    fn add_navigation<'a>(&'a self, heap: &JsHeap<'a>, client: &Client) {
        let (record, kind) = client.navigation_timing();
        self.navigation_type.set(kind);
        for (milestone, time) in self.milestones.iter().zip(client.unload_of_previous()) {
            milestone.set(if time == 0.0 {
                0.0
            } else {
                on_clock_of_thread(time)
            });
        }
        let entry = js_DomPerformanceNavigationTiming::create(
            heap,
            Resource::new(Type::Navigation, record, self.get_time_origin()),
        );
        entry.duration.set(self.milestone(b"loadEventEnd"));
        self.buffer(heap, Type::Navigation)
            .push(heap, entry.to_js());
    }

    fn started<'a>(realm: &JsHeap<'a>) -> &'a Performance {
        let this = Performance::get(realm);
        this.start(realm);
        this
    }

    fn navigation_entry<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Option<&'a DomPerformanceNavigationTiming> {
        entries_in(self.buffer(heap, Type::Navigation))
            .next()?
            .downcast()
    }

    /// From the clock of the thread, where 0 is none.
    fn page_time(&self, time: f64) -> f64 {
        if time == 0.0 {
            0.0
        } else {
            coarse(time - self.origin.get())
        }
    }

    fn milestone(&self, name: &[u8]) -> f64 {
        MILESTONES
            .iter()
            .position(|it| it.as_bytes() == name)
            .map_or(0.0, |at| self.page_time(self.milestones[at].get()))
    }

    fn legacy_time<'a>(&'a self, heap: &JsHeap<'a>, name: &[u8]) -> f64 {
        let time = self.milestone(name)
            + self
                .navigation_entry(heap)
                .map_or(0.0, |it| it.number(name));
        if time == 0.0 && name != b"navigationStart" {
            0.0
        } else {
            (self.get_time_origin() + time).floor()
        }
    }

    fn buffer<'a>(&'a self, heap: &JsHeap<'a>, kind: Type) -> List<'a> {
        let buffers = list(js_DomPerformance::buffers(self));
        if buffers.get(kind as u32).is_undefined() {
            buffers.set(heap, kind as u32, List::new(heap).to_js());
        }
        List::from_value(buffers.get(kind as u32))
    }

    fn buffered(&self) -> impl Iterator<Item = &Entry> {
        let buffers = list(js_DomPerformance::buffers(self));
        let kinds = Type::ALL
            .into_iter()
            .filter(|it| !it.is_only_for_observers());
        kinds
            .map(move |it| buffers.get(it as u32))
            .filter(|it| !it.is_undefined())
            .flat_map(|it| entries_in(List::from_value(it)))
    }

    fn add<'a>(&'a self, heap: &JsHeap<'a>, entry: &'a Entry) {
        self.buffer(heap, entry.kind).push(heap, entry.to_js());
        self.notify(heap, entry);
    }

    fn add_milestone<'a>(&'a self, heap: &JsHeap<'a>, name: &[u8], time: f64) {
        let entry = |kind| Entry::new(kind, DomString::from_latin1(name), time, 0.0);
        match name {
            b"loadEventEnd" => {
                if let Some(navigation) = self.navigation_entry(heap) {
                    navigation.duration.set(time);
                    self.notify(heap, navigation);
                }
            }
            b"first-paint" | b"first-contentful-paint" => self.add(
                heap,
                js_DomPerformancePaintTiming::create(heap, entry(Type::Paint)),
            ),
            b"visible" | b"hidden" => self.add(
                heap,
                js_DomVisibilityStateEntry::create(heap, entry(Type::Visibility)),
            ),
            _ => {}
        }
    }

    fn add_if_there_is_room<'a>(&'a self, heap: &JsHeap<'a>, entry: &'a Entry) {
        if self.buffer(heap, entry.kind).len() < BUFFER_SIZE {
            self.add(heap, entry);
        } else {
            self.notify(heap, entry);
        }
    }

    fn add_resource<'a>(&'a self, heap: &JsHeap<'a>, record: ResourceTiming) {
        let entry = js_DomPerformanceResourceTiming::create(
            heap,
            Resource::new(Type::Resource, record, self.get_time_origin()),
        );
        let (buffer, overflow) = (
            self.buffer(heap, Type::Resource),
            list(js_DomPerformance::overflow(self)),
        );
        self.notify(heap, entry);
        if buffer.len() < self.resource_limit.get() && overflow.is_empty() {
            return buffer.push(heap, entry.to_js());
        }
        overflow.push(heap, entry.to_js());
        if overflow.len() == 1 {
            queue_task(heap, [], |cx, []| {
                Performance::get(&cx.heap).handle_overflow(cx)
            });
        }
    }

    /// <https://w3c.github.io/resource-timing/#dfn-fire-a-buffer-full-event>
    fn handle_overflow<'a>(&'a self, cx: Cx<'_, 'a>) {
        let (buffer, overflow) = (
            self.buffer(&cx.heap, Type::Resource),
            list(js_DomPerformance::overflow(self)),
        );
        while !overflow.is_empty() {
            let before = overflow.len();
            if buffer.len() >= self.resource_limit.get() {
                dom_events::fire(
                    cx,
                    self,
                    atom!("resourcetimingbufferfull"),
                    EventInit::default(),
                );
            }
            let room = self
                .resource_limit
                .get()
                .saturating_sub(buffer.len())
                .min(overflow.len());
            (0..room).for_each(|at| buffer.push(&cx.heap, overflow.get(at)));
            overflow.remove_range(&cx.heap, 0, room);
            if overflow.len() >= before {
                self.dropped.update(|it| it + overflow.len());
                overflow.clear(&cx.heap);
            }
        }
    }

    fn clear<'a>(&'a self, heap: &JsHeap<'a>, kind: Type, name: Option<DomString>) {
        let buffer = self.buffer(heap, kind);
        let Some(name) = name else {
            return buffer.clear(heap);
        };
        let mut kept = 0;
        for it in entries_in(buffer).filter(|it| it.name != name) {
            buffer.set(heap, kept, it.to_js());
            kept += 1;
        }
        buffer.remove_range(heap, kept, buffer.len() - kept);
    }

    /// <https://w3c.github.io/user-timing/#convert-a-mark-to-a-timestamp>
    fn time_of_mark<'a>(&'a self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a, f64> {
        if is_legacy_time(name) {
            let name = name.to_utf8();
            if !heap.is_window() {
                return Err(heap.type_error(format_args!("'{name}' is only known in a window.")));
            }
            return match self.legacy_time(heap, name.as_bytes()) {
                0.0 => Err(dom_error(
                    heap,
                    DomError::InvalidAccessError,
                    &format!("'{name}' is empty: the event has not happened yet."),
                )),
                time => Ok(time - self.get_time_origin().floor()),
            };
        }
        let found = entries_in(self.buffer(heap, Type::Mark))
            .filter(|it| it.name == *name)
            .last();
        found.map(|it| it.start).ok_or_else(|| {
            dom_error(
                heap,
                DomError::SyntaxError,
                &format!("The mark '{}' does not exist.", name.to_utf8()),
            )
        })
    }

    fn time_of<'a>(&'a self, heap: &JsHeap<'a>, given: MarkOrTime<'a>) -> Result<'a, f64> {
        match given {
            MarkOrTime::Mark(name) => self.time_of_mark(heap, &name.into()),
            MarkOrTime::Time(time) if time < 0.0 => {
                Err(heap.type_error(format_args!("A timestamp cannot be negative.")))
            }
            MarkOrTime::Time(time) => Ok(time),
        }
    }

    #[inline]
    pub(crate) fn now(&self) -> f64 {
        coarse(dom_events::now() - self.origin.get())
    }

    pub(crate) fn get_time_origin(&self) -> f64 {
        read_origin_timer_start(VirtualMachine::get()) + self.origin.get()
    }

    pub(crate) fn to_json<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JsLocal<'a, JSObject>> {
        let (json, global) = (cx.heap.create_empty_object(), global_of(&cx.heap));
        json.to_js().put(
            global,
            b"timeOrigin",
            JSValue::js_number(self.get_time_origin()),
        );
        if self.realm(&cx.heap).is_window() {
            json.to_js()
                .put(global, b"timing", self.get_timing(&cx.heap).to_js());
            json.to_js()
                .put(global, b"navigation", self.get_navigation(&cx.heap).to_js());
        }
        Ok(json)
    }

    pub(crate) fn get_timing<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DomPerformanceTiming {
        js_DomPerformance::timing(self).unwrap_or_else(|| {
            let made = js_DomPerformanceTiming::create(self.realm(heap), Default::default());
            js_DomPerformance::set_timing(self, Some(made));
            made
        })
    }

    pub(crate) fn get_navigation<'a>(&'a self, heap: &JsHeap<'a>) -> &'a PerformanceNavigation {
        js_DomPerformance::navigation(self).unwrap_or_else(|| {
            let made = js_PerformanceNavigation::create(self.realm(heap), Default::default());
            js_DomPerformance::set_navigation(self, Some(made));
            made
        })
    }

    pub(crate) fn get_entries<'a>(&'a self, _: &JsHeap<'a>) -> Vec<&'a Entry> {
        select(self.buffered(), None, None)
    }

    pub(crate) fn get_entries_by_type<'a>(
        &'a self,
        _: &JsHeap<'a>,
        kind: &DomString,
    ) -> Vec<&'a Entry> {
        select(self.buffered(), None, Some(kind))
    }

    pub(crate) fn get_entries_by_name<'a>(
        &'a self,
        _: &JsHeap<'a>,
        name: &DomString,
        kind: Option<&DomString>,
    ) -> Vec<&'a Entry> {
        select(self.buffered(), Some(name), kind)
    }

    pub(crate) fn clear_resource_timings<'a>(&'a self, heap: &JsHeap<'a>) {
        self.clear(heap, Type::Resource, None);
    }

    pub(crate) fn set_resource_timing_buffer_size(&self, size: u32) {
        self.resource_limit.set(size);
    }

    pub(crate) fn mark<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: DomString,
        options: &PerformanceMarkOptions<'a>,
    ) -> Result<'a, &'a DomPerformanceMark> {
        let structure = js_DomPerformanceMark::CLASS.structure(self.realm(&cx.heap));
        let options = PerformanceMarkOptions {
            detail: options.detail,
            start_time: Some(options.start_time.unwrap_or_else(|| self.now())),
        };
        let entry = DomPerformanceMark::constructor(cx, structure, name, &options)?;
        self.add(self.realm(&cx.heap), entry);
        Ok(entry)
    }

    pub(crate) fn clear_marks<'a>(&'a self, heap: &JsHeap<'a>, name: Option<DomString>) {
        self.clear(heap, Type::Mark, name);
    }

    pub(crate) fn measure<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: DomString,
        start_or_options: MarkOrOptions<'a>,
        end_mark: Option<DomString>,
    ) -> Result<'a, &'a DomPerformanceMeasure> {
        let realm = self.realm(&cx.heap);
        let PerformanceMeasureOptions {
            detail,
            duration,
            end,
            start,
        } = match start_or_options {
            MarkOrOptions::Mark(it) => PerformanceMeasureOptions {
                detail: JsLocal::UNDEFINED,
                duration: None,
                end: None,
                start: Some(MarkOrTime::Mark(it)),
            },
            MarkOrOptions::Options(it) => {
                let (has_bound, has_duration) = (
                    it.start.is_some() || it.end.is_some(),
                    it.duration.is_some(),
                );
                let is_empty = !has_bound && !has_duration && it.detail.to_js().is_undefined();
                if !is_empty
                    && (end_mark.is_some()
                        || !has_bound
                        || (has_duration && it.start.is_some() && it.end.is_some()))
                {
                    return Err(cx
                        .heap
                        .type_error(format_args!("These options do not go together.")));
                }
                it
            }
        };
        let duration = duration
            .map(|it| self.time_of(realm, MarkOrTime::Time(it)))
            .transpose()?;
        let end = match end_mark {
            Some(name) => Some(self.time_of_mark(realm, &name)?),
            None => end.map(|it| self.time_of(realm, it)).transpose()?,
        };
        let start = start.map(|it| self.time_of(realm, it)).transpose()?;
        let end_time = end
            .or_else(|| Some(start? + duration?))
            .unwrap_or_else(|| self.now());
        let start_time = start.unwrap_or_else(|| duration.map_or(0.0, |it| end_time - it));
        let detail = clone_detail(cx, detail)?;
        let realm = self.realm(&cx.heap);
        let entry = js_DomPerformanceMeasure::create(
            realm,
            Entry::new(Type::Measure, name, start_time, end_time - start_time),
        );
        js_DomPerformanceMeasure::set_detail(entry, detail);
        self.add(realm, entry);
        Ok(entry)
    }

    pub(crate) fn clear_measures<'a>(&'a self, heap: &JsHeap<'a>, name: Option<DomString>) {
        self.clear(heap, Type::Measure, name);
    }
}

impl crate::generated_bindgen::window::WindowOrWorkerGlobalScope {
    pub(crate) fn get_performance<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a Performance {
        Performance::started(self.realm(&cx.heap))
    }
}

fn on_clock_of_thread(since_epoch: f64) -> f64 {
    since_epoch - read_origin_timer_start(VirtualMachine::get())
}

/// On the clock of the thread.
pub(crate) fn navigation_start(realm: &JsHeap<'_>) -> f64 {
    client_of(realm).map_or_else(dom_events::now, |it| {
        on_clock_of_thread(it.navigation_start())
    })
}

/// The window is getting another document.
pub(crate) fn renewed<'a>(realm: &JsHeap<'a>, window: &'a Window) {
    window.set_time_origin(navigation_start(realm));
    let Some(performance) = Performance::of_realm(realm) else {
        return;
    };
    performance.origin.set(window.time_origin());
    performance.milestones.iter().for_each(|it| it.set(0.0));
    performance.painting.start_over();
    if let Some(client) = client_of(realm).filter(|_| performance.is_started.get()) {
        [Type::Navigation, Type::Paint]
            .into_iter()
            .for_each(|it| performance.clear(realm, it, None));
        performance.add_navigation(realm, &client);
    }
}

pub(crate) fn response_has_ended<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    let Some((realm, performance)) =
        Performance::of_doc(heap, doc).filter(|it| it.1.is_started.get())
    else {
        return;
    };
    let entries = performance
        .buffer(realm, Type::Navigation)
        .values()
        .filter_map(|it| Resource::from_js(realm, it));
    client_of(realm)
        .into_iter()
        .zip(entries)
        .for_each(|(client, it)| it.has_ended_like(&client.navigation_timing().0));
}

/// `time` is on the clock of the thread.
pub(crate) fn reached<'a>(heap: &JsHeap<'a>, doc: &'a Doc, milestone: &[u8], time: f64) {
    let Some((realm, performance)) = Performance::of_doc(heap, doc) else {
        return;
    };
    if let Some(at) = MILESTONES.iter().position(|it| it.as_bytes() == milestone) {
        if performance.milestones[at].get() != 0.0 {
            return;
        }
        performance.milestones[at].set(time);
    }
    if performance.is_started.get() {
        performance.add_milestone(realm, milestone, performance.page_time(time));
    }
}
