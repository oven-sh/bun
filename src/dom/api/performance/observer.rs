//! <https://w3c.github.io/performance-timeline/#the-performanceobserver-interface>

use bun_jsc::bindgen::{Callable, ClassStructure};

use super::events::{BUFFERED_DURATION, SHORTEST_DURATION};
use super::*;
use crate::api::support::report_exception;

impl DomPerformanceObserverEntryList {
    fn entries(&self) -> impl Iterator<Item = &Entry> {
        entries_in(list(js_DomPerformanceObserverEntryList::entries(self)))
    }

    pub(crate) fn get_entries<'a>(&'a self, _: &JsHeap<'a>) -> Vec<&'a Entry> {
        select(self.entries(), None, None)
    }

    pub(crate) fn get_entries_by_type<'a>(
        &'a self,
        _: &JsHeap<'a>,
        kind: &DomString,
    ) -> Vec<&'a Entry> {
        select(self.entries(), None, Some(kind))
    }

    pub(crate) fn get_entries_by_name<'a>(
        &'a self,
        _: &JsHeap<'a>,
        name: &DomString,
        kind: Option<&DomString>,
    ) -> Vec<&'a Entry> {
        select(self.entries(), Some(name), kind)
    }
}

#[repr(C)]
pub(crate) struct Observer {
    duration_threshold: Cell<f64>,
    types: Cell<u16>,
    is_for_one_type: Cell<Option<bool>>,
    tells_dropped: Cell<bool>,
}

impl Observer {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        callback: JsLocal<'a, Callable>,
    ) -> &'a Self {
        let made = structure.create(
            heap,
            Observer {
                duration_threshold: BUFFERED_DURATION.into(),
                types: 0.into(),
                is_for_one_type: None.into(),
                tells_dropped: false.into(),
            },
        );
        js_DomPerformanceObserver::set_callback(made, callback.to_js());
        js_DomPerformanceObserver::set_entries(made, List::new(heap).to_js());
        made
    }

    fn entries(&self) -> List<'_> {
        list(js_DomPerformanceObserver::entries(self))
    }

    fn take_entries<'a>(&'a self, heap: &JsHeap<'a>) -> List<'a> {
        let taken = self.entries();
        js_DomPerformanceObserver::set_entries(self, List::new(heap).to_js());
        taken
    }

    fn wants(&self, entry: &Entry) -> bool {
        self.types.get() & entry.kind.bit() != 0
            && (entry.kind != Type::Event || entry.duration.get() >= self.duration_threshold.get())
    }

    pub(crate) fn get_supported_entry_types(heap: &JsHeap<'_>) -> JSValue {
        let performance = Performance::get(heap);
        js_DomPerformance::supported_types(performance).unwrap_or_else(|| {
            let names = Type::ALL.into_iter().filter(|it| it.is_supported(heap));
            let names = heap
                .create_array(names.collect::<Vec<_>>(), |heap, it| {
                    Ok(DomString::from(it.name()).to_js(heap).as_value())
                })
                .and_then(|it| heap.freeze_array(it));
            let names = names.map_or(JSValue::UNDEFINED, JsLocal::to_js);
            js_DomPerformance::set_supported_types(performance, names);
            names
        })
    }

    pub(crate) fn observe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &PerformanceObserverInit<'a>,
    ) -> Result<'a> {
        let realm = self.realm(&cx.heap);
        let (kept, added) = match (options.entry_types, &options.r#type) {
            (None, None) => {
                return Err(cx
                    .heap
                    .type_error(format_args!("Either entryTypes or type is required.")));
            }
            (Some(_), Some(_)) => {
                return Err(cx
                    .heap
                    .type_error(format_args!("entryTypes and type do not go together.")));
            }
            (Some(all), None) => (
                0,
                all.iter()
                    .filter_map(|it| Type::parse(realm, &it.into()))
                    .fold(0, |all, it| all | it.bit()),
            ),
            (None, Some(one)) => (
                self.types.get(),
                Type::parse(realm, one).map_or(0, Type::bit),
            ),
        };
        let is_for_one_type = options.r#type.is_some();
        if self
            .is_for_one_type
            .get()
            .is_some_and(|it| it != is_for_one_type)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidModificationError,
                "This observer was first used with the other kind of options.",
            ));
        }
        self.is_for_one_type.set(Some(is_for_one_type));
        self.tells_dropped.set(true);
        if added == 0 {
            return Ok(());
        }
        self.types.set(kept | added);
        if let Some(threshold) = options.duration_threshold {
            self.duration_threshold
                .set(threshold.max(SHORTEST_DURATION));
        }
        let performance = Performance::started(realm);
        if added & Type::Event.bit() != 0 {
            performance.events.borrow_mut().state().is_observed = true;
        }
        let observers = performance.observers();
        if !observers.contains(self.to_js()) {
            observers.push(realm, self.to_js());
        }
        if let Some(kind) = Type::ALL
            .into_iter()
            .find(|it| is_for_one_type && options.buffered && it.bit() == added)
        {
            entries_in(performance.buffer(realm, kind))
                .filter(|it| self.wants(it))
                .for_each(|it| self.entries().push(realm, it.to_js()));
            performance.queue_delivery(realm);
        }
        if let Some(doc) = WindowTarget::of_realm(realm)
            .and_then(WindowTarget::doc)
            .filter(|_| added & Type::LargestPaint.bit() != 0)
        {
            performance.observe_largest_paint(cx, doc);
        }
        Ok(())
    }

    pub(crate) fn disconnect(&self, heap: &JsHeap<'_>) {
        Performance::get(self.realm(heap))
            .observers()
            .remove(heap, self.to_js());
        self.entries().clear(heap);
        self.types.set(0);
    }

    pub(crate) fn take_records<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> impl Iterator<Item = &'a Entry> + use<'a> {
        entries_in(self.take_entries(heap))
    }

    fn deliver<'a>(&'a self, cx: Cx<'_, 'a>, dropped: u32) {
        let entries = js_DomPerformanceObserverEntryList::create(&cx.heap, Default::default());
        js_DomPerformanceObserverEntryList::set_entries(
            entries,
            self.take_entries(&cx.heap).to_js(),
        );
        let options = cx.heap.create_empty_object().to_js();
        if self.tells_dropped.take() {
            let dropped = if self.types.get() & Type::Resource.bit() != 0 {
                dropped
            } else {
                0
            };
            options.put(
                cx.global(),
                b"droppedEntriesCount",
                JSValue::js_number(dropped.into()),
            );
        }
        let callback = js_DomPerformanceObserver::callback(self).expect("set when it is made");
        if let Err(error) = callback.call(
            cx.global(),
            self.to_js(),
            &[entries.to_js(), self.to_js(), options],
        ) {
            report_exception(cx, error.into());
        }
    }
}

impl Performance {
    fn observers(&self) -> List<'_> {
        list(js_DomPerformance::observers(self))
    }

    pub(super) fn notify<'a>(&'a self, heap: &JsHeap<'a>, entry: &'a Entry) {
        for observer in self
            .observers()
            .values()
            .filter_map(|it| Observer::from_js(heap, it))
            .filter(|it| it.wants(entry))
        {
            observer.entries().push(heap, entry.to_js());
            self.queue_delivery(heap);
        }
    }

    fn queue_delivery(&self, heap: &JsHeap<'_>) {
        if !self.is_delivery_queued.replace(true) {
            queue_task(heap, [], |cx, []| Performance::get(&cx.heap).deliver(cx));
        }
    }

    fn deliver<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.is_delivery_queued.set(false);
        let observers = self.observers();
        let observers = List::from_fn(&cx.heap, observers.len(), |at| observers.get(at));
        for at in 0..observers.len() {
            if let Some(observer) =
                Observer::from_js(&cx.heap, observers.get(at)).filter(|it| !it.entries().is_empty())
            {
                observer.deliver(cx, self.dropped.get());
            }
        }
    }
}
