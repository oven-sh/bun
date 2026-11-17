//! <https://drafts.csswg.org/animation-triggers/>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsList, JsLocal, JsScope, Result};

use super::document::DocumentAnimations;
use super::{Animation, AnimationTimeline, nullable, range};
use crate::animation::{Behavior, TimelineId};
use crate::api::core::{DomError, List, dom_error, seams};
use crate::generated_bindgen::animation::*;
use crate::values::Out;

/// The edges of the activation range and of the active range.
#[derive(Default)]
pub(crate) struct AnimationTrigger([Out; 4], bun_jsc::bindgen::Interior);

impl AnimationTriggerBehavior {
    fn get(self) -> Behavior {
        use Behavior::*;
        [
            Play,
            Pause,
            Reset,
            PlayOnce,
            PlayForwards,
            PlayBackwards,
            Replay,
            None,
        ][self as usize]
    }
}

impl AnimationTrigger {
    fn animations(&self) -> List<'_> {
        List::from_value(js_AnimationTrigger::animations(self).expect("set when it is made"))
    }

    fn has(&self, animation: &Animation) -> bool {
        animation
            .trigger()
            .is_some_and(|it| core::ptr::eq(it, self))
    }

    fn send(&self, animation: &Animation) {
        let timeline =
            js_AnimationTrigger::timeline(self).map_or(TimelineId::None, |it| it.id_if_active());
        animation.engine(|engine, id| {
            engine.set_script_trigger(
                id,
                timeline,
                self.0.each_ref().map(|it| &it[..]),
                animation.behaviors.get(),
            )
        });
    }

    pub(super) fn detach<'a>(&'a self, heap: &JsHeap<'a>, animation: &Animation) {
        self.animations().remove(heap, animation.to_js());
        animation.behaviors.set(None);
        self.send(animation);
        js_Animation::set_trigger(animation, None);
    }

    pub(crate) fn add_animation<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        animation: &'a Animation,
        activate: AnimationTriggerBehavior,
        deactivate: AnimationTriggerBehavior,
    ) -> Result<'a, ()> {
        if animation.trigger().is_none() {
            self.animations().push(&cx.heap, animation.to_js());
            js_Animation::set_trigger(animation, Some(self));
        } else if !self.has(animation) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "Attaching multiple triggers to an animation is not allowed.",
            ));
        }
        animation
            .behaviors
            .set(Some([activate.get(), deactivate.get()]));
        animation.revive(cx);
        self.send(animation);
        animation.changed(cx);
        Ok(())
    }

    pub(crate) fn remove_animation<'a>(&'a self, cx: &mut JsScope<'a>, animation: &'a Animation) {
        if self.has(animation) {
            self.detach(&cx.heap, animation);
            animation.release_if_over(cx);
        }
    }

    pub(crate) fn get_animations(&self) -> impl Iterator<Item = JSValue> {
        self.animations().values()
    }
}

fn edges<'a>(heap: &JsHeap<'a>, given: &TimelineTriggerOptions<'_>) -> Result<'a, [Out; 4]> {
    let all = [
        &given.activation_range_start,
        &given.activation_range_end,
        &given.active_range_start,
        &given.active_range_end,
    ];
    let mut edges: [Out; 4] = Default::default();
    for (index, edge) in edges.iter_mut().enumerate() {
        *edge = match all[index].as_ref().or(all[index ^ 2].as_ref()) {
            Some(value) if !matches!(value, RangeEdge::Text(it) if **it == *b"auto") => {
                range::parse(heap, index & 1, Some(value))?
            }
            _ => if index < 2 { "normal" } else { "auto" }.into(),
        };
    }
    Ok(edges)
}

impl TimelineTrigger {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        options: Option<JsList<'a, JsLocal<'a>>>,
    ) -> Result<'a, &'a Self> {
        let mut all = options.into_iter().flat_map(|it| it.iter());
        let (first, doc) = (all.next(), seams::current_document(cx)?);
        all.next().is_none().ok_or_else(|| {
            cx.heap
                .type_error(format_args!("Multiple timelines are not supported."))
        })?;
        let global = cx.global();
        let read = |it: TimelineTriggerOptions<'_>| {
            Ok((
                edges(JsHeap::from_global(global), &it).map_err(|it| it.into_js_error(global))?,
                it.timeline.to_js(),
            ))
        };
        let (given, heap) = (
            first
                .map(|it| TimelineTriggerOptions::from_js(global, it.to_js(), read))
                .transpose()?,
            &cx.heap,
        );
        let (has_range, (edges, timeline)) = (
            given.is_some(),
            given.unwrap_or_else(|| (Default::default(), JSValue::NULL)),
        );
        let timeline = nullable(heap, timeline)?
            .unwrap_or_else(|| Some(DocumentAnimations::of(heap, doc).timeline(heap, doc)));
        let made = structure.create(heap, AnimationTrigger(edges, Default::default()));
        js_AnimationTrigger::set_timeline(made, timeline);
        js_AnimationTrigger::set_animations(made, List::new(heap).to_js());
        let ranges = js_TimelineTriggerRangeList::create(heap, Default::default());
        js_AnimationTrigger::set_ranges(made, ranges.to_js());
        if has_range {
            let range = js_TimelineTriggerRange::create(heap, Default::default());
            js_TimelineTriggerRange::set_trigger(range, Some(made));
            js_TimelineTriggerRangeList::set_only(ranges, Some(range));
        }
        Ok(made)
    }
}

impl TimelineTriggerRange {
    fn trigger(&self) -> &AnimationTrigger {
        js_TimelineTriggerRange::trigger(self).expect("set when it is made")
    }

    pub(crate) fn get_timeline(&self) -> Option<&AnimationTimeline> {
        js_AnimationTrigger::timeline(self.trigger())
    }

    pub(crate) fn get_activation_range_start(&self) -> &[u8] {
        &self.trigger().0[0]
    }

    pub(crate) fn get_activation_range_end(&self) -> &[u8] {
        &self.trigger().0[1]
    }

    pub(crate) fn get_active_range_start(&self) -> &[u8] {
        &self.trigger().0[2]
    }

    pub(crate) fn get_active_range_end(&self) -> &[u8] {
        &self.trigger().0[3]
    }
}

impl TimelineTriggerRangeList {
    pub(crate) fn get_length(&self) -> u32 {
        js_TimelineTriggerRangeList::only(self).is_some().into()
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<&TimelineTriggerRange> {
        js_TimelineTriggerRangeList::only(self).filter(|_| index == 0)
    }

    pub(crate) fn item(&self, index: u32) -> Option<&TimelineTriggerRange> {
        self.indexed_get(index)
    }
}
