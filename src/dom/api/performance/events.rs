//! <https://w3c.github.io/event-timing/>

use smallvec::SmallVec;

use super::*;
use crate::api::events::{Event, EventFlags, TIMED};
use crate::api::uievents::{InputEvent, KeyboardEvent, PointerEvent};

pub(super) const BUFFERED_DURATION: f64 = 104.0;
pub(super) const SHORTEST_DURATION: f64 = 16.0;
const INTERACTION_STEP: u32 = 7;

struct Dispatched {
    name: Known,
    time: f64,
    processing: [f64; 2],
    interaction: u32,
    is_cancelable: bool,
    /// Of a `pointerdown` that does not know yet whether it begins an interaction.
    holder: Option<i32>,
}

/// It is on the screen, and still has a `holder`.
struct Held {
    event: Dispatched,
    duration: f64,
    target: Option<WeakNode>,
}

#[derive(Default)]
pub(super) struct Timing(Option<Box<State>>);

pub(super) struct State {
    pub(super) is_observed: bool,
    counts: [u32; TIMED.len()],
    interactions: u32,
    first_interaction: u32,
    had_first_input: bool,
    last_key: u32,
    last_dialog: f64,
    by_key: SmallVec<[(i32, u32); 4]>,
    by_pointer: SmallVec<[(i32, u32); 2]>,
    dispatched: Vec<Dispatched>,
    held: Vec<Held>,
}

impl core::ops::Deref for Timing {
    type Target = Option<Box<State>>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Timing {
    pub(super) fn state(&mut self) -> &mut State {
        self.0.get_or_insert_with(|| {
            Box::new(State {
                is_observed: false,
                counts: [0; TIMED.len()],
                interactions: 0,
                first_interaction: 100 + (bun_core::fast_random() % 9900) as u32,
                had_first_input: false,
                last_key: 0,
                last_dialog: 0.0,
                by_key: SmallVec::new(),
                by_pointer: SmallVec::new(),
                dispatched: Vec::new(),
                held: Vec::new(),
            })
        })
    }
}

fn take(all: &mut SmallVec<impl smallvec::Array<Item = (i32, u32)>>, key: i32) -> u32 {
    all.iter()
        .position(|it| it.0 == key)
        .map_or(0, |at| all.swap_remove(at).1)
}

fn find(all: &[(i32, u32)], key: i32) -> u32 {
    all.iter().find(|it| it.0 == key).map_or(0, |it| it.1)
}

struct Details {
    key: i32,
    pointer: i32,
    is_composing: bool,
}

impl State {
    fn count(&mut self, name: Known) {
        if let Some(at) = TIMED.iter().position(|it| *it == name) {
            self.counts[at] += 1;
        }
    }

    fn next_interaction(&mut self) -> u32 {
        self.interactions += 1;
        self.first_interaction + self.interactions * INTERACTION_STEP
    }

    /// `pointer` is none for all of them.
    fn release(&mut self, pointer: Option<i32>, is_interaction: bool, finished: &mut Vec<Held>) {
        let is_meant = |it: &Dispatched| {
            it.holder
                .is_some_and(|it| pointer.is_none_or(|pointer| pointer == it))
        };
        let (mut dispatched, first) = (core::mem::take(&mut self.dispatched), finished.len());
        finished.extend(self.held.extract_if(.., |it| is_meant(&it.event)));
        for it in finished[first..]
            .iter_mut()
            .map(|it| &mut it.event)
            .chain(dispatched.iter_mut().filter(|it| is_meant(it)))
        {
            if let Some(pointer) = it.holder.take().filter(|_| is_interaction) {
                it.interaction = self.next_interaction();
                take(&mut self.by_pointer, pointer);
                self.by_pointer.push((pointer, it.interaction));
            }
        }
        self.dispatched = dispatched;
    }

    /// <https://w3c.github.io/event-timing/#sec-computing-interactionid>
    fn interaction_of(
        &mut self,
        name: Known,
        Details {
            key,
            pointer,
            is_composing,
        }: Details,
        finished: &mut Vec<Held>,
    ) -> u32 {
        match name {
            atom!("keydown") if !is_composing => {
                self.last_key = self.next_interaction();
                take(&mut self.by_key, key);
                self.by_key.push((key, self.last_key));
                return self.last_key;
            }
            atom!("keypress") => return self.last_key,
            atom!("keyup") => return find(&self.by_key, key),
            atom!("input") if is_composing => return self.next_interaction(),
            atom!("pointerdown") => {
                self.release(Some(pointer), false, finished);
                take(&mut self.by_pointer, pointer);
            }
            atom!("pointercancel") => self.release(Some(pointer), false, finished),
            atom!("contextmenu") => self.release(None, true, finished),
            atom!("pointerup") => {
                self.release(Some(pointer), true, finished);
                return find(&self.by_pointer, pointer);
            }
            atom!("click") => {
                return if pointer == -1 {
                    self.last_key
                } else {
                    take(&mut self.by_pointer, pointer)
                };
            }
            _ => {}
        }
        0
    }
}

fn details_of(event: &Event) -> Details {
    let key = event.downcast::<KeyboardEvent>();
    Details {
        key: key.map_or(0, |it| it.get_key_code() as i32),
        pointer: event
            .downcast::<PointerEvent>()
            .map_or(0, PointerEvent::get_pointer_id),
        is_composing: key.map_or_else(
            || {
                event
                    .downcast::<InputEvent>()
                    .is_some_and(InputEvent::get_is_composing)
            },
            KeyboardEvent::get_is_composing,
        ),
    }
}

impl Performance {
    fn finish<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        event: &Dispatched,
        duration: f64,
        target: Option<&'a Node>,
    ) {
        let (is_first, is_observed) = {
            let mut timing = self.events.borrow_mut();
            let state = timing.state();
            let is_first = !state.had_first_input && event.interaction != 0;
            state.had_first_input |= is_first;
            (is_first, state.is_observed)
        };
        let entry = |kind| {
            let base = Entry::new(
                kind,
                event.name.as_str(),
                self.page_time(event.time),
                duration,
            );
            let (processing, target) = (
                event.processing.map(|it| self.page_time(it)),
                target.map(|it| WeakNode::new(heap, it)),
            );
            js_DomPerformanceEventTiming::create(
                heap,
                EventEntry {
                    base,
                    processing,
                    target,
                    interaction: event.interaction,
                    is_cancelable: event.is_cancelable,
                },
            )
        };
        if is_first {
            self.add(heap, entry(Type::FirstInput));
        }
        if duration >= BUFFERED_DURATION {
            self.add_if_there_is_room(heap, entry(Type::Event));
        } else if is_observed && duration >= SHORTEST_DURATION {
            self.notify(heap, entry(Type::Event));
        }
    }

    fn show_counts<'a>(&'a self, heap: &JsHeap<'a>) {
        if let Some(shown) = js_DomPerformance::event_counts(self) {
            let (entries, counts) = (
                js_EventCounts::backing(heap, shown),
                self.events.borrow_mut().state().counts,
            );
            for (name, count) in TIMED.iter().zip(counts) {
                let _ = entries.set(
                    heap,
                    Atom::of(*name).to_js(heap).to_js(),
                    JSValue::js_number(count.into()),
                );
            }
        }
    }

    pub(crate) fn get_event_counts<'a>(&'a self, heap: &JsHeap<'a>) -> &'a EventCounts {
        let made = js_EventCounts::create(self.realm(heap), Default::default());
        js_DomPerformance::set_event_counts(self, Some(made));
        self.show_counts(heap);
        made
    }

    pub(crate) fn get_interaction_count(&self) -> u32 {
        self.events
            .borrow()
            .as_ref()
            .map_or(0, |it| it.interactions)
    }
}

pub(crate) fn time_event<'a>(heap: &JsHeap<'a>, doc: &'a Doc, event: &'a Event, start: f64) {
    let (end, name, details) = (dom_events::now(), event.name(), details_of(event));
    let Some((realm, performance)) = Performance::of_doc(heap, doc) else {
        return;
    };
    let mut finished = Vec::new();
    {
        let mut timing = performance.events.borrow_mut();
        let state = timing.state();
        state.count(name);
        let holder = (name == atom!("pointerdown")).then_some(details.pointer);
        let interaction = state.interaction_of(name, details, &mut finished);
        state.dispatched.push(Dispatched {
            name,
            time: event.time(),
            processing: [start, end],
            interaction,
            is_cancelable: event.has(EventFlags::CANCELABLE),
            holder,
        });
    }
    performance.show_counts(realm);
    list(js_DomPerformance::targets(performance)).push(
        realm,
        event.target_node().map_or(JSValue::NULL, |it| it.to_js()),
    );
    for it in &finished {
        performance.finish(
            realm,
            &it.event,
            it.duration,
            it.target.as_ref().and_then(|it| it.get(realm)),
        );
    }
}

/// What the events have changed is on the screen.
pub(crate) fn present_events<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    let Some(performance) = Performance::of_realm(doc.realm(heap)) else {
        return;
    };
    let (realm, targets) = (
        doc.realm(heap),
        list(js_DomPerformance::targets(performance)),
    );
    if targets.is_empty() {
        return;
    }
    let (now, dialog) = (
        dom_events::now(),
        performance.events.borrow_mut().state().last_dialog,
    );
    let dispatched = core::mem::take(&mut performance.events.borrow_mut().state().dispatched);
    for (event, target) in dispatched
        .into_iter()
        .zip(targets.values().map(|it| Node::from_js(realm, it)))
    {
        let duration =
            ((if dialog > event.time { dialog } else { now } - event.time) / 8.0).round() * 8.0;
        if event.holder.is_none() {
            performance.finish(realm, &event, duration, target);
        } else {
            let target = target.map(|it| WeakNode::new(realm, it));
            performance.events.borrow_mut().state().held.push(Held {
                event,
                duration,
                target,
            });
        }
    }
    targets.clear(realm);
}

/// It is the response that the user sees.
pub(crate) fn note_modal_dialog(realm: &JsHeap<'_>) {
    if let Some(performance) = Performance::of_realm(realm) {
        performance.events.borrow_mut().state().last_dialog = dom_events::now();
    }
}

/// For an event that nothing listens to.
pub(crate) fn count_event<'a>(heap: &JsHeap<'a>, doc: &'a Doc, name: Known) {
    if let Some((realm, performance)) =
        Performance::of_doc(heap, doc).filter(|_| TIMED.contains(&name))
    {
        performance.events.borrow_mut().state().count(name);
        performance.show_counts(realm);
    }
}
