//! <https://drafts.csswg.org/web-animations/#the-animationtimeline-interface>, <https://drafts.csswg.org/scroll-animations/>

use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsScope, Result};

use super::document::{Collected, DocumentAnimations, WatchedBy};
use super::range::only_value;
use super::{nullable, percent};
use crate::animation::{TimelineId, TimelineState};
use crate::api::core::{Doc, DocFlags, DomString, Element, NodeFlags, seams};
use crate::api::typed::CSSNumericValue;
use crate::api::view::scrolling_element;
use crate::calc::Unit;
use crate::generated_bindgen::animation::*;
use crate::generated_bindgen::typed::ValueOrText;
use crate::properties::Prop;
use crate::tree::DOCUMENT;
use crate::types::Axis;
use crate::values::Out;

pub(crate) struct AnimationTimeline {
    id: TimelineId,
    /// If a script has made it.
    collected: Option<Rc<Collected>>,
    _interior: bun_jsc::bindgen::Interior,
}

impl Drop for AnimationTimeline {
    fn drop(&mut self) {
        if let (TimelineId::Progress(id), Some(collected)) = (self.id, &self.collected) {
            collected.timelines.borrow_mut().push(id);
        }
    }
}

impl AnimationTimeline {
    pub(super) fn of_document<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Self {
        let made = js_DocumentTimeline::create(
            doc.realm(heap),
            AnimationTimeline {
                id: TimelineId::Document(0.0),
                collected: None,
                _interior: Default::default(),
            },
        );
        js_AnimationTimeline::set_document(made, Some(doc));
        made
    }

    pub(super) fn of_style<'a>(heap: &JsHeap<'a>, doc: &'a Doc, id: u32) -> &'a Self {
        let is_view = doc
            .engine(|engine, _| engine.timeline_state(id))
            .is_some_and(|it| it.is_view);
        let class = if is_view {
            js_ViewTimeline::CLASS.widen()
        } else {
            js_ScrollTimeline::CLASS.widen()
        };
        let made: &Self = class.create(
            doc.realm(heap),
            AnimationTimeline {
                id: TimelineId::Progress(id),
                collected: None,
                _interior: Default::default(),
            },
        );
        js_AnimationTimeline::set_document(made, Some(doc));
        made
    }

    fn watching<'a>(
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        node: Option<&'a Element>,
        axis: ScrollAxis,
        insets: Option<&[u8]>,
    ) -> AnimationTimeline {
        let (known, axis) = (
            node.filter(|it| it.is_rendered()).map_or(0, |it| it.id()),
            [Axis::Block, Axis::Inline, Axis::X, Axis::Y][axis as usize],
        );
        let id = doc.synced_engine(cx, |engine, _| engine.create_timeline(known, axis, insets));
        let collected = &DocumentAnimations::of(&cx.heap, doc).collected;
        if let Some(node) = node {
            node.set(NodeFlags::ANIMATED);
            node.extra::<WatchedBy>()
                .0
                .borrow_mut()
                .push((Rc::clone(collected), id));
        }
        AnimationTimeline {
            id: TimelineId::Progress(id),
            collected: Some(Rc::clone(collected)),
            _interior: Default::default(),
        }
    }

    fn attach<'a>(&'a self, doc: &'a Doc, node: Option<&'a Element>) {
        js_AnimationTimeline::set_document(self, Some(doc));
        js_AnimationTimeline::set_node(self, node);
    }

    pub(super) fn doc(&self) -> &Doc {
        js_AnimationTimeline::document(self).expect("set when it is made")
    }

    pub(super) fn follows_scroll(&self) -> bool {
        matches!(self.id, TimelineId::Progress(_))
    }

    pub(super) fn id_if_active(&self) -> TimelineId {
        if super::document::active_time_origin(self.doc()).is_some() {
            self.id
        } else {
            TimelineId::None
        }
    }

    fn state(&self) -> Option<TimelineState> {
        let TimelineId::Progress(id) = self.id else {
            return None;
        };
        self.doc().engine(|engine, _| engine.timeline_state(id))
    }

    pub(crate) fn get_current_time<'a>(&'a self, cx: &mut JsScope<'a>) -> JSValue {
        match self.id_if_active() {
            TimelineId::None => JSValue::NULL,
            TimelineId::Document(origin) => {
                DocumentAnimations::of(&cx.heap, self.doc()).advance_clock(cx, self.doc());
                JSValue::js_number(self.doc().engine(|engine, _| engine.clock()) - origin)
            }
            TimelineId::Progress(_) => self
                .state()
                .and_then(|it| it.time)
                .map_or(JSValue::NULL, |it| percent(self.realm(&cx.heap), it)),
        }
    }

    pub(crate) fn get_duration<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        if self.follows_scroll() {
            percent(self.realm(heap), 100.0)
        } else {
            JSValue::NULL
        }
    }
}

fn document_for<'a>(cx: &mut JsScope<'a>, node: Option<&'a Element>) -> Result<'a, &'a Doc> {
    node.map(|it| it.doc())
        .filter(|it| it.is(DocFlags::HAS_PAGE))
        .map_or_else(|| seams::current_document(cx), Ok)
}

impl DocumentTimeline {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        options: &DocumentTimelineOptions,
    ) -> Result<'a, &'a Self> {
        let doc = seams::current_document(cx)?;
        let made = structure.create(
            &cx.heap,
            AnimationTimeline {
                id: TimelineId::Document(options.origin_time),
                collected: None,
                _interior: Default::default(),
            },
        );
        made.attach(doc, None);
        Ok(made)
    }
}

impl ScrollTimeline {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        options: &ScrollTimelineOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let source = match nullable::<Element>(&cx.heap, options.source.to_js())? {
            Some(given) => given,
            None => seams::current_document(cx).map(|it| scrolling_element(cx, it))?,
        };
        let doc = document_for(cx, source)?;
        let timeline = AnimationTimeline::watching(cx, doc, source, options.axis, None);
        let made = structure.create(&cx.heap, timeline);
        made.attach(doc, source);
        Ok(made)
    }

    pub(crate) fn get_source<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Element> {
        if let Some(given) =
            js_AnimationTimeline::node(self).filter(|_| !self.is_a::<ViewTimeline>())
        {
            return Some(given);
        }
        self.doc()
            .synced_engine(cx, |engine, _| engine.update_layout());
        match self.state()?.source {
            DOCUMENT => scrolling_element(cx, self.doc()),
            source => self
                .doc()
                .rendered_node(source)?
                .out_of_control()
                .as_element(),
        }
    }

    pub(crate) fn get_axis(&self) -> ScrollAxis {
        [
            ScrollAxis::Block,
            ScrollAxis::Inline,
            ScrollAxis::X,
            ScrollAxis::Y,
        ][self.state().map_or(0, |it| it.axis as usize)]
    }
}

fn source_of<'a>(heap: &JsHeap<'a>, inset: &ValueOrText<'a>) -> Result<'a, Out> {
    Ok(match *inset {
        ValueOrText::Value(it) => it.stringify(heap),
        ValueOrText::Text(it) => DomString::from_js_string(heap, it)?
            .to_utf8()
            .as_bytes()
            .to_vec(),
    })
}

impl ViewTimeline {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        options: &ViewTimelineOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let source = match &options.inset {
            Some(Inset::Values(all)) => all
                .iter()
                .map(|it| source_of(&cx.heap, &it))
                .collect::<Result<'a, Vec<_>>>()?
                .join(&b' '),
            Some(Inset::Text(it)) => it.to_vec(),
            None => "auto".into(),
        };
        let insets = Prop::from_name(b"view-timeline-inset")
            .and_then(|it| only_value(it, &source))
            .ok_or_else(|| cx.heap.type_error(format_args!("Invalid inset")))?;
        let doc = document_for(cx, options.subject)?;
        let timeline =
            AnimationTimeline::watching(cx, doc, options.subject, options.axis, Some(&insets));
        let made = structure.create(&cx.heap, timeline);
        made.attach(doc, options.subject);
        Ok(made)
    }

    pub(crate) fn get_subject(&self) -> Option<&Element> {
        js_AnimationTimeline::node(self).or_else(|| {
            self.doc()
                .rendered_node(self.state()?.subject)?
                .as_element()
        })
    }

    fn offset<'a>(&'a self, heap: &JsHeap<'a>, edge: usize) -> &'a CSSNumericValue {
        CSSNumericValue::of_unit(
            self.realm(heap),
            self.state().map_or(0.0, |it| it.offsets[edge]),
            Unit::Px,
        )
    }

    pub(crate) fn get_start_offset<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CSSNumericValue {
        self.offset(heap, 0)
    }

    pub(crate) fn get_end_offset<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CSSNumericValue {
        self.offset(heap, 1)
    }
}
