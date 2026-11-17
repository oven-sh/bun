//! <https://drafts.csswg.org/css-highlight-api/>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsList, JsLocal, JsScope, Result};
use bun_jsc::{JSString, JSValue};

use crate::api::core::{Doc, DomString, Edge, List, Node};
use crate::api::range::{AbstractRange, Point, client_rects, compare_points, ends_for_engine};
use crate::editing::Mark;
use crate::generated_bindgen::highlight::*;
use crate::name::Name;

pub(crate) struct Highlight {
    priority: Cell<i32>,
    kind: Cell<HighlightType>,
}

impl Highlight {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Highlight>,
        ranges: JsList<'a, &'a AbstractRange>,
    ) -> Result<'a, &'a Highlight> {
        let highlight = structure.create(
            heap,
            Highlight {
                priority: Cell::new(0),
                kind: Cell::new(HighlightType::Highlight),
            },
        );
        js_Highlight::set_registries(highlight, List::new(heap).to_js());
        ranges
            .iter()
            .try_for_each(|it| js_Highlight::backing(heap, highlight).add(heap, it.to_js()))?;
        Ok(highlight)
    }

    /// Once for each name that it has there.
    fn registries(&self) -> List<'_> {
        List::from_value(js_Highlight::registries(self).expect("set when it is made"))
    }

    fn changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        for registry in self.registries().values() {
            HighlightRegistry::from_js(&cx.heap, registry)
                .into_iter()
                .for_each(|it| it.doc().invalidate(cx));
        }
    }

    fn ranges<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, impl Iterator<Item = &'a AbstractRange> + use<'a>> {
        let all = js_Highlight::backing(heap, self).values(heap)?;
        // SAFETY: the set has ranges.
        Ok(all
            .iter()
            .map(|it| unsafe { AbstractRange::from_js_unchecked(it.to_js()) }))
    }

    pub(crate) fn get_priority(&self, _: &mut JsScope<'_>) -> i32 {
        self.priority.get()
    }

    pub(crate) fn set_priority<'a>(&'a self, cx: &mut JsScope<'a>, value: i32) {
        self.priority.set(value);
        self.changed(cx);
    }

    pub(crate) fn get_kind(&self) -> HighlightType {
        self.kind.get()
    }

    pub(crate) fn set_kind(&self, value: HighlightType) {
        self.kind.set(value);
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        range: &'a AbstractRange,
    ) -> Result<'a, &'a Highlight> {
        js_Highlight::backing(&cx.heap, self).add(&cx.heap, range.to_js())?;
        self.changed(cx);
        Ok(self)
    }

    pub(crate) fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        range: &'a AbstractRange,
    ) -> Result<'a, bool> {
        self.changed(cx);
        js_Highlight::backing(&cx.heap, self).remove(&cx.heap, range.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.changed(cx);
        js_Highlight::backing(&cx.heap, self).clear(&cx.heap)
    }
}

/// Of a range that is valid.
fn ends<'a>(cx: &mut JsScope<'a>, range: &'a AbstractRange) -> Option<[Point<'a>; 2]> {
    let [start, end] = range.rendered_ends(cx)?;
    let is_valid = start.node.root() == end.node.root()
        && [start, end].iter().all(|it| it.offset <= it.node.length())
        && compare_points(start, end).is_le();
    is_valid.then_some([start, end])
}

#[derive(Default)]
pub(crate) struct HighlightRegistry {
    painted: RefCell<Vec<Name>>,
}

impl HighlightRegistry {
    pub(crate) fn of<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a HighlightRegistry {
        let it = doc.same_object(heap, Edge::Highlights, || {
            let registry =
                js_HighlightRegistry::create(doc.realm(heap), HighlightRegistry::default());
            js_HighlightRegistry::set_document(registry, Some(doc));
            registry.to_js()
        });
        // SAFETY: the edge holds what is made above.
        unsafe { Self::from_js_unchecked(it) }
    }

    fn doc(&self) -> &Doc {
        js_HighlightRegistry::document(self).expect("set when it is made")
    }

    fn entries<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, impl Iterator<Item = (JsLocal<'a>, &'a Highlight)> + use<'a>> {
        let all = js_HighlightRegistry::backing(heap, self).entries(heap)?;
        // SAFETY: the values of the map are highlights.
        Ok(all
            .iter()
            .map(|(name, it)| (name, unsafe { Highlight::from_js_unchecked(it.to_js()) })))
    }

    fn unregister<'a>(&'a self, heap: &JsHeap<'a>, name: JsLocal<'a, JSString>) -> Result<'a, ()> {
        if let Some(old) = Highlight::from_js(
            heap,
            js_HighlightRegistry::backing(heap, self).get(heap, name.to_js())?,
        ) {
            old.registries().remove(heap, self.to_js());
        }
        Ok(())
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a, JSString>,
        highlight: &'a Highlight,
    ) -> Result<'a, &'a HighlightRegistry> {
        self.unregister(&cx.heap, name)?;
        highlight.registries().push(&cx.heap, self.to_js());
        js_HighlightRegistry::backing(&cx.heap, self).set(
            &cx.heap,
            name.to_js(),
            highlight.to_js(),
        )?;
        self.doc().invalidate(cx);
        Ok(self)
    }

    pub(crate) fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a, JSString>,
    ) -> Result<'a, bool> {
        self.unregister(&cx.heap, name)?;
        self.doc().invalidate(cx);
        js_HighlightRegistry::backing(&cx.heap, self).remove(&cx.heap, name.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.entries(&cx.heap)?
            .for_each(|(_, it)| _ = it.registries().remove(&cx.heap, self.to_js()));
        self.doc().invalidate(cx);
        js_HighlightRegistry::backing(&cx.heap, self).clear(&cx.heap)
    }

    pub(crate) fn highlights_from_point<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        x: f32,
        y: f32,
        options: &HighlightsFromPointOptions<'a>,
    ) -> Result<'a, JSValue> {
        let (doc, results, mut priorities) = (self.doc(), List::new(&cx.heap), Vec::new());
        let (hit, [x, y]) = (
            doc.synced_engine(cx, |engine, _| engine.node_at_point([x, y])),
            [x, y].map(f64::from),
        );
        let is_known = |root: &&Node| {
            *root == &**doc
                || options
                    .shadow_roots
                    .into_iter()
                    .flat_map(JsList::iter)
                    .any(|it| &***it == *root)
        };
        let Some(root) = doc
            .rendered_node(hit)
            .map(|it| it.out_of_control().root())
            .filter(is_known)
        else {
            return Ok(results.to_js());
        };
        for (_, highlight) in self.entries(&cx.heap)? {
            let ranges = List::new(&cx.heap);
            for range in highlight.ranges(&cx.heap)? {
                let Some([start, end]) =
                    ends(cx, range).filter(|it| it[0].node.out_of_control().root() == root)
                else {
                    continue;
                };
                if client_rects(cx, start, end)
                    .iter()
                    .any(|[left, top, width, height]| {
                        (*left..left + width).contains(&x) && (*top..top + height).contains(&y)
                    })
                {
                    ranges.push(&cx.heap, range.to_js());
                }
            }
            if !ranges.is_empty() {
                let priority = highlight.priority.get();
                let index = priorities.partition_point(|it| *it > priority);
                priorities.insert(index, priority);
                let result = HighlightHitResult {
                    highlight,
                    ranges: JsLocal::new(&cx.heap, ranges.to_js()),
                }
                .into_js(&cx.heap)?;
                results.insert(&cx.heap, index as u32, result.to_js());
            }
        }
        Ok(results.to_js())
    }
}

/// Tells the engine.
pub(crate) fn flush_highlights<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> Result<'a, ()> {
    let Some(registry) = doc
        .edge(Edge::Highlights)
        .and_then(|it| HighlightRegistry::from_js(&cx.heap, it))
    else {
        return Ok(());
    };
    let mut stale = registry.painted.take();
    for (name, highlight) in registry.entries(&cx.heap)? {
        let name = Name::new(
            DomString::from_js_string(&cx.heap, name.as_string().expect("the keys are strings"))?
                .to_utf8()
                .as_bytes(),
        );
        let mut ranges = Vec::new();
        for range in highlight.ranges(&cx.heap)? {
            ranges.extend(
                ends(cx, range)
                    .filter(|[start, end]| {
                        start != end && start.node.doc() == doc && start.node.is_rendered()
                    })
                    .map(|[start, end]| ends_for_engine(start, end)),
            );
        }
        doc.engine(|engine, _| {
            let ranges = ranges.into_iter().map(|it| engine.range(it)).collect();
            engine.mark_ranges(Mark::Highlight(name), highlight.priority.get(), ranges);
        });
        stale.retain(|it| *it != name);
        registry.painted.borrow_mut().push(name);
    }
    doc.engine(|engine, _| {
        stale
            .into_iter()
            .for_each(|it| engine.mark_ranges(Mark::Highlight(it), 0, Vec::new()))
    });
    Ok(())
}
