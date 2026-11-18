//! <https://drafts.csswg.org/cssom-view/#the-mediaquerylist-interface>

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::JSObject;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsLocal, JsScope, Result};

use crate::api::core::{Doc, DomString, Edge, EventTarget, List, atom};
use crate::api::events::dispatch;
use crate::api::style_events::MediaQueryListEvent;
use crate::condition::{Condition, media_list};
use crate::generated_bindgen::cssom::js_MediaQueryList;
use crate::values::{Out, text};

#[repr(C)]
pub(crate) struct MediaQueryList {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_MediaQueryList::Fields,
    parsed: Rc<Parsed>,
    /// While the document holds it.
    reported: Cell<Option<bool>>,
    serial: u64,
}

struct Parsed {
    source: Box<[u8]>,
    condition: Condition,
    media: Out,
}

/// How many, and what the last ones are for.
#[derive(Default)]
struct Made(Cell<u64>, RefCell<[Option<Rc<Parsed>>; 32]>);

impl MediaQueryList {
    fn doc(&self) -> &Doc {
        js_MediaQueryList::document(self).expect("set when it is made")
    }

    pub(crate) fn get_media(&self) -> &[u8] {
        &self.parsed.media
    }

    fn evaluate(&self) -> bool {
        self.doc()
            .engine(|engine, _| self.parsed.condition.evaluate(&engine.environment) == Some(true))
    }

    pub(crate) fn get_matches<'a>(&'a self, cx: &mut JsScope<'a>) -> bool {
        self.doc().sync(cx);
        self.evaluate()
    }

    pub(crate) fn add_listener<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        callback: Option<JsLocal<'a, JSObject>>,
    ) -> Result<'a, ()> {
        self.add_event_listener(heap, &atom!("change").into(), callback, None)
    }

    pub(crate) fn remove_listener<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        callback: Option<JsLocal<'a, JSObject>>,
    ) {
        self.remove_event_listener(heap, &atom!("change").into(), callback, None);
    }
}

pub(crate) fn match_media<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    query: &[u8],
) -> &'a MediaQueryList {
    let parsed = {
        let known = &mut doc.extra::<Made>().1.borrow_mut()[bun_wyhash::hash(query) as usize % 32];
        known.take_if(|it| *it.source != *query);
        Rc::clone(known.get_or_insert_with(|| {
            let (condition, queries) = media_list(query);
            Rc::new(Parsed {
                source: query.into(),
                condition,
                media: queries.join(&b", "[..]),
            })
        }))
    };
    let list = MediaQueryList {
        base: Default::default(),
        fields: Default::default(),
        parsed,
        reported: Cell::new(None),
        serial: doc
            .extra::<Made>()
            .0
            .replace(doc.extra::<Made>().0.get() + 1),
    };
    let made = js_MediaQueryList::create(doc.realm(&cx.heap), list);
    js_MediaQueryList::set_document(made, Some(doc));
    doc.sync(cx);
    made
}

pub(crate) fn change_listener_added(heap: &JsHeap<'_>, target: &EventTarget) {
    if let Some(list) = target
        .downcast::<MediaQueryList>()
        .filter(|it| it.reported.get().is_none())
    {
        list.reported.set(Some(list.evaluate()));
        let all = list.doc().edge_list(heap, Edge::MediaQueryLists);
        let older = all
            .values()
            .filter_map(|it| MediaQueryList::from_js(heap, it))
            .take_while(|it| it.serial < list.serial)
            .count();
        all.insert(heap, older as u32, list.to_js());
    }
}

/// <https://drafts.csswg.org/cssom-view/#evaluate-media-queries-and-report-changes>
pub(crate) fn report_media_queries<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    let (Some(all), mut index) = (doc.edge(Edge::MediaQueryLists).map(List::from_value), 0) else {
        return;
    };
    while let Some(list) = MediaQueryList::from_js(&cx.heap, all.get(index)) {
        if !list.has_any_listener() {
            list.reported.set(None);
            all.remove_range(&cx.heap, index, 1);
            continue;
        }
        let matches = list.get_matches(cx);
        if list.reported.replace(Some(matches)) != Some(matches) {
            let event = MediaQueryListEvent::new(
                list.realm(&cx.heap),
                DomString::from_utf8(text(&list.parsed.media)),
                matches,
            );
            dispatch(cx, list, event);
        }
        index += 1;
    }
}
