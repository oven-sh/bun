//! <https://dom.spec.whatwg.org/#dispatching-events>

use bun_jsc::JsResult;
use bun_jsc::bindgen::JsLocal;

use super::listeners::{Is, Key, Listener, Listeners};
use super::script::{calling_scripts, drain_microtasks, is_at_top_level, report, swap_top_level};
use super::window::has_frames;
use super::{EventFlags as F, *};
use crate::api::core::steps::Has;

const INLINE: usize = 32;

/// How an entry of a path that crosses the edge of a shadow tree sees the event.
#[derive(Clone, Copy, Default)]
struct View {
    /// The index of the entry.
    target: u32,
    /// How many closed shadow trees it is in.
    depth: i32,
    is_in_shadow: bool,
}

pub(super) struct Path<'a> {
    first: [Option<&'a EventTarget>; INLINE],
    rest: Option<List<'a>>,
    len: usize,
    /// Empty if all have the first entry for a target, and none is in a shadow tree.
    views: Vec<View>,
    /// For each entry, if they differ.
    related: Option<List<'a>>,
    /// <https://dom.spec.whatwg.org/#concept-event-dispatch>, the legacy target override.
    shown_target: Option<&'a EventTarget>,
    /// `Key::bit` of what listened when it was made.
    keys: u64,
}

impl<'a> Path<'a> {
    #[inline]
    pub(super) fn new() -> Self {
        Path {
            first: [None; INLINE],
            rest: None,
            len: 0,
            views: Vec::new(),
            related: None,
            shown_target: None,
            keys: 0,
        }
    }

    #[inline]
    pub(super) fn push(&mut self, heap: &JsHeap<'a>, target: &'a EventTarget) {
        match self.first.get_mut(self.len) {
            Some(slot) => *slot = Some(target),
            None => self
                .rest
                .get_or_insert_with(|| List::new(heap))
                .push(heap, target.to_js()),
        }
        self.len += 1;
        self.keys |= target.listeners().map_or(0, Listeners::keys);
    }

    #[inline]
    fn get(&self, index: usize) -> &'a EventTarget {
        match (self.first.get(index), self.rest) {
            (Some(Some(target)), _) => target,
            // SAFETY: what `push` has put there.
            (_, Some(rest)) => unsafe {
                EventTarget::from_js_unchecked(rest.get((index - INLINE) as u32))
            },
            _ => unreachable!(),
        }
    }

    #[inline]
    fn target_index(&self, index: usize) -> usize {
        self.views.get(index).map_or(0, |it| it.target as usize)
    }

    fn show_target(&self, event: &Event, index: usize) {
        js_Event::set_target(
            event,
            self.shown_target
                .unwrap_or_else(|| self.get(self.target_index(index)))
                .exposed(),
        );
    }

    fn pass(
        &self,
        cx: Cx<'_, 'a>,
        run: &Run<'a>,
        order: impl Iterator<Item = usize>,
        captures: bool,
    ) {
        let event = run.event;
        let (key, legacy) = (
            Key::new(run.kind, captures),
            run.legacy.map(|it| (it, Key::new(it.into(), captures))),
        );
        let bits = run.bits(captures);
        for index in order {
            let current = self.get(index);
            let Some(listeners) = current.listeners().filter(|it| it.may_have(bits)) else {
                continue;
            };
            let is_target = self.target_index(index) == index;
            if event.has(F::STOPPED) {
                return;
            }
            if !(captures || is_target || event.has(F::BUBBLES)) {
                continue;
            }
            event.phase.set(if is_target {
                Phase::AtTarget
            } else if captures {
                Phase::Capturing
            } else {
                Phase::Bubbling
            });
            if let Some(view) = self.views.get(index) {
                self.show_target(event, index);
                if let Some(it) = run.window {
                    it.set_event(if view.is_in_shadow {
                        run.outer_event
                    } else {
                        event.exposed()
                    });
                }
            }
            if let Some(it) = self.related {
                event.set_related_target(Some(it.get(index as u32)));
            }
            match legacy.filter(|_| event.has(F::TRUSTED) && !current.has_listeners(run.kind)) {
                None => run.invoke(cx, current, listeners, key),
                Some((name, key)) => {
                    let own = event.name.replace(name.into());
                    run.invoke(cx, current, listeners, key);
                    event.name.replace(own);
                }
            }
        }
    }

    pub(super) fn run(&self, cx: Cx<'_, 'a>, event: &'a Event, window: Option<&'a WindowTarget>) {
        let kind = EventType::of(&event.name.borrow());
        self.show_target(event, self.len - 1);
        let Some(kind) = kind else { return };
        let (legacy, outer_event) = (
            types::legacy_name(event.name()),
            window.map_or(JSValue::ZERO, WindowTarget::event),
        );
        event.path.set(core::ptr::from_ref(self).cast());
        if let Some(it) = window {
            it.set_event(event.exposed());
        }
        calling_scripts(cx, |cx, drains| {
            let run = Run {
                event,
                kind,
                legacy,
                window,
                outer_event,
                drains,
            };
            if self.keys & run.bits(true) != 0 {
                self.pass(cx, &run, (0..self.len).rev(), true);
            }
            let end = if matches!(event.name(), atom!("submit") | atom!("reset")) {
                self.index_of_outer_form()
            } else {
                self.len
            };
            self.pass(cx, &run, 0..end, false);
        });
        if let Some(it) = window {
            it.set_event(outer_event);
        }
        event.path.set(core::ptr::null());
        event.phase.set(Phase::None);
        js_Event::set_current_target(event, JSValue::ZERO);
        if !self.views.is_empty() {
            self.show_target(event, self.len - 1);
        }
    }

    /// Browsers do not let it hear of the forms in it.
    #[cold]
    fn index_of_outer_form(&self) -> usize {
        (1..self.len)
            .find(|it| {
                self.get(*it)
                    .as_node()
                    .is_some_and(|it| it.is_html(atom!("form")))
            })
            .unwrap_or(self.len)
    }

    /// <https://dom.spec.whatwg.org/#dom-event-composedpath>
    fn visible_from(&self, current: JSValue) -> Vec<usize> {
        let Some(index) = (0..self.views.len()).find(|it| self.get(*it).exposed() == current)
        else {
            return (0..self.len).collect();
        };
        let visible = |order: &mut dyn Iterator<Item = usize>| {
            let mut allowed = self.views[index].depth;
            order
                .filter(|it| {
                    self.views[*it].depth <= allowed && {
                        allowed = self.views[*it].depth;
                        true
                    }
                })
                .collect::<Vec<_>>()
        };
        visible(&mut (0..index).rev())
            .into_iter()
            .rev()
            .chain(visible(&mut (index..self.len)))
            .collect()
    }
}

struct Run<'a> {
    event: &'a Event,
    kind: EventType,
    legacy: Option<Known>,
    window: Option<&'a WindowTarget>,
    outer_event: JSValue,
    drains: bool,
}

fn call<'a>(
    cx: Cx<'_, 'a>,
    current: &'a EventTarget,
    listeners: &'a Listeners,
    listener: Listener,
    callback: JSValue,
    event: &'a Event,
    foreign: Option<&'a WindowTarget>,
) -> JsResult<()> {
    if listener.is.contains(Is::HANDLER) {
        return handlers::call(cx, current, listeners, listener, event);
    }
    let global = match foreign {
        Some(window) => global_of(window.realm(&cx.heap)),
        None => cx.global(),
    };
    if listener.is.contains(Is::CALLABLE) {
        return callback
            .call(global, current.exposed(), &[event.exposed()])
            .map(|_| ());
    }
    match callback
        .get(global, "handleEvent")?
        .filter(|it| it.is_callable())
    {
        Some(method) => method
            .call(global, callback, &[event.exposed()])
            .map(|_| ()),
        None => Err(global.throw_type_error(format_args!("handleEvent is not a function."))),
    }
}

impl<'a> Run<'a> {
    #[inline]
    fn bits(&self, captures: bool) -> u64 {
        Key::new(self.kind, captures).bit()
            | self
                .legacy
                .map_or(0, |it| Key::new(it.into(), captures).bit())
    }

    /// The window of the realm that the callback is of. `None` if it is not to be called.
    #[cold]
    fn window_for(
        &self,
        heap: &JsHeap<'a>,
        current: &'a EventTarget,
        listener: Listener,
        callback: JSValue,
    ) -> Option<Option<&'a WindowTarget>> {
        let owner = current.as_node().map_or_else(
            || current.as_window().or(self.window),
            |it| it.doc().last_window(),
        );
        let own = WindowTarget::of_callback(heap, callback)
            .filter(|_| !listener.is.contains(Is::UNCOMPILED))
            .or(self.window);
        let is_foreign = own
            .zip(self.window)
            .is_some_and(|(a, b)| !core::ptr::eq(a, b));
        (!owner.is_some_and(WindowTarget::is_removed_frame)
            && !(is_foreign && own.is_some_and(WindowTarget::is_disposed)))
        .then_some(own)
    }

    /// <https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke>
    fn invoke(&self, cx: Cx<'_, 'a>, current: &'a EventTarget, listeners: &'a Listeners, key: Key) {
        let (event, mut serials) = (self.event, 0..listeners.next_serial());
        while let Some(listener) = listeners.first_among(key, serials.clone()) {
            serials.start = listener.serial + 1;
            let (callback, is_aborted) =
                (listeners.callback(listener), listeners.is_aborted(listener));
            if is_aborted || listener.is.contains(Is::ONCE) {
                current.remove_listener(&cx.heap, listeners, listener);
            }
            if is_aborted {
                continue;
            }
            let Some(window) = (if has_frames() {
                self.window_for(&cx.heap, current, listener, callback)
            } else {
                Some(self.window)
            }) else {
                continue;
            };
            let foreign = window
                .zip(self.window)
                .filter(|(a, b)| !core::ptr::eq(*a, *b))
                .map(|(own, ours)| (own, own.event(), ours, ours.event()));
            if let Some((own, _, ours, shown)) = foreign {
                ours.set_event(self.outer_event);
                if shown == event.exposed() {
                    own.set_event(shown);
                }
            }
            if listener.is.contains(Is::PASSIVE) {
                event.set(F::IN_PASSIVE_LISTENER);
            }
            js_Event::set_current_target(event, current.exposed());
            if let Err(error) = call(
                cx,
                current,
                listeners,
                listener,
                callback,
                event,
                foreign.map(|it| it.0),
            ) {
                event.set(F::LISTENER_THREW);
                report(cx, window, error);
            }
            event.unset(F::IN_PASSIVE_LISTENER);
            if let Some((own, theirs, ours, shown)) = foreign {
                ours.set_event(shown);
                own.set_event(theirs);
            }
            if self.drains {
                drain_microtasks(cx);
            }
            if event.has(F::STOPPED_IMMEDIATELY) || cx.global().has_exception() {
                return;
            }
        }
    }
}

pub(super) fn finish(event: &Event) -> bool {
    event.unset(F::DISPATCHING | F::STOPPED | F::STOPPED_IMMEDIATELY);
    !event.has(F::CANCELED)
}

fn is_in_shadow(node: &Node) -> bool {
    node.root().has(NodeFlags::SHADOW_ROOT)
}

fn is_closed(root: &Node) -> bool {
    root.as_shadow_root()
        .is_some_and(|it| it.is(ShadowFlags::CLOSED))
}

/// Answers what has the activation behavior.
fn build_path<'a>(
    cx: Cx<'_, 'a>,
    path: &mut Path<'a>,
    origin: &'a Node,
    event: &'a Event,
    window: Option<&'a WindowTarget>,
    end: Option<&'a Node>,
) -> Option<&'a Element> {
    let (related, is_click) = (
        event.related_node(),
        event.has(F::IS_MOUSE_EVENT) && event.name() == atom!("click"),
    );
    let (mut activation, mut target, mut view, mut slots_entered) =
        (None, origin, View::default(), 0);
    let mut has_views = origin.scope() != Some(origin.doc()) && is_in_shadow(origin);
    let mut next = Some(origin);
    while let Some(node) = next.filter(|_| next != end) {
        if is_click
            && activation.is_none()
            && node.steps().contains(Has::ACTIVATE)
            && (node == target || event.has(F::BUBBLES))
        {
            activation = node.as_element().filter(|it| pending::can_activate(it));
        }
        if !node.has(NodeFlags::USER_AGENT) {
            if has_views {
                view.target = if node == target {
                    path.len as u32
                } else {
                    view.target
                };
                path.views.push(View {
                    is_in_shadow: is_in_shadow(node),
                    ..view
                });
            }
            path.push(&cx.heap, node);
        }
        next = node.parent();
        if let Some(slot) = next
            .filter(|it| it.has(NodeFlags::HOST))
            .and_then(|_| node.assigned_slot())
        {
            if !core::mem::replace(&mut has_views, true) {
                path.views.resize(path.len, View::default());
            }
            view.depth += i32::from(is_closed(slot.root()));
            slots_entered += 1;
            next = Some(slot);
        } else if let Some(host) = node
            .as_shadow_root()
            .map(|it| -> &Node { it.host_element() })
        {
            if slots_entered == 0
                && (!event.has(F::COMPOSED) && node == origin.root()
                    || related.is_some_and(|it| it.retarget(Some(host)) == host))
            {
                break;
            }
            view.depth -= i32::from(is_closed(node));
            match slots_entered {
                0 => target = host,
                _ => slots_entered -= 1,
            }
            next = Some(host);
        }
    }
    let reaches_document = path.len > 0
        && path
            .get(path.len - 1)
            .as_node()
            .is_some_and(|it| it.as_doc().is_some());
    if let Some(window) = window.filter(|_| reaches_document && event.name() != atom!("load")) {
        if has_views {
            path.views.push(view);
        }
        path.push(&cx.heap, window);
    }
    activation
}

fn dispatch_to_node<'a>(
    cx: Cx<'_, 'a>,
    origin: &'a Node,
    event: &'a Event,
    caller: Option<&'a WindowTarget>,
    end: Option<&'a Node>,
) -> bool {
    let related = event.related_node();
    if related.is_some_and(|it| it != origin && it.retarget(Some(origin)) == origin) {
        return finish(event);
    }
    let (mut path, window) = (Path::new(), origin.doc().window());
    let activation = build_path(cx, &mut path, origin, event, window, end);
    if path.len == 0 {
        return finish(event);
    }
    let saved = activation
        .filter(|it| it.steps().contains(Has::PRE_ACTIVATE))
        .map_or(JSValue::UNDEFINED, |it| pending::pre_activate(cx, it));
    let last_target = path.target_index(path.len - 1);
    let mut clears_targets = path
        .views
        .get(last_target)
        .is_some_and(|it| it.is_in_shadow);
    if let Some(related) = related.filter(|it| is_in_shadow(it)) {
        path.related = Some(List::from_fn(&cx.heap, path.len as u32, |it| {
            related.retarget(path.get(it as usize).as_node()).to_js()
        }));
        clears_targets |= is_in_shadow(related.retarget(path.get(last_target).as_node()));
    }
    path.run(cx, event, window.or(caller));
    if clears_targets {
        js_Event::set_target(event, JSValue::ZERO);
        event.set_related_target(None);
    } else if let Some(all) = path.related {
        event.set_related_target(Some(all.get(path.len as u32 - 1)));
    }
    let proceeds = finish(event);
    match activation {
        Some(element) if proceeds => pending::activate(cx, element, event, origin, saved),
        Some(element) if element.steps().contains(Has::CANCEL_ACTIVATE) => {
            pending::cancel_activate(cx, element, saved)
        }
        _ => {}
    }
    proceeds
}

/// `caller` is the window that has to do with it, unless the target knows better.
fn dispatch_to<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    event: &'a Event,
    caller: Option<&'a WindowTarget>,
    end: Option<&'a Node>,
) -> bool {
    event.set(F::DISPATCHING);
    if let Some(node) = target.as_node() {
        return dispatch_to_node(cx, node, event, caller, end);
    }
    if let Some(related) = event.related_node() {
        event.set_related_node(Some(related.retarget(None)));
    }
    let mut path = Path::new();
    path.push(&cx.heap, target);
    path.run(cx, event, target.as_window().or(caller));
    finish(event)
}

/// For targets that are not nodes.
pub(crate) fn dispatch_along<'a>(
    cx: Cx<'_, 'a>,
    targets: &[&'a EventTarget],
    event: &'a Event,
) -> bool {
    event.set(F::TRUSTED | F::DISPATCHING);
    let (mut path, caller) = (Path::new(), WindowTarget::of_realm(&cx.heap));
    targets.iter().for_each(|it| path.push(&cx.heap, it));
    path.run(cx, event, caller);
    finish(event)
}

macro_rules! timed {
    ($($name:tt)*) => {
        /// <https://w3c.github.io/event-timing/#sec-events-exposed>
        pub(crate) const TIMED: [Known; [$($name),*].len()] = [$(atom!($name)),*];

        fn is_timed(name: Known) -> bool {
            matches!(name, $(atom!($name))|*)
        }
    };
}
timed! {
    "auxclick" "click" "contextmenu" "dblclick" "mousedown" "mouseenter" "mouseleave" "mouseout" "mouseover" "mouseup"
    "pointerover" "pointerenter" "pointerdown" "pointerup" "pointercancel" "pointerout" "pointerleave" "gotpointercapture" "lostpointercapture" "touchstart"
    "touchend" "touchcancel" "keydown" "keypress" "keyup" "beforeinput" "input" "compositionstart" "compositionupdate" "compositionend"
    "dragstart" "dragend" "dragenter" "dragleave" "dragover" "drop"
}

pub(super) fn dispatch_trusted<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    event: &'a Event,
    caller: Option<&'a WindowTarget>,
    end: Option<&'a Node>,
) -> bool {
    event.set(F::TRUSTED);
    let timed = target
        .as_node()
        .filter(|it| is_at_top_level() && it.is_element() && is_timed(event.name()));
    let start = timed.map(|it| (it.doc(), now()));
    if let Some(time) = timed.and_then(|_| script::time_of_input()) {
        event.set_time(time);
    }
    let proceeds = dispatch_to(cx, target, event, caller, end);
    if let Some((doc, start)) = start {
        crate::api::performance::time_event(&cx.heap, doc, event, start);
    }
    proceeds
}

/// False if it was canceled.
pub(crate) fn dispatch<'a>(cx: Cx<'_, 'a>, target: &'a EventTarget, event: &'a Event) -> bool {
    dispatch_below(cx, target, event, None)
}

/// The event does not get to `end` and what is above it.
pub(crate) fn dispatch_below<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    event: &'a Event,
    end: Option<&'a Node>,
) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    let caller = if target.has_window() {
        None
    } else {
        WindowTarget::of_realm(target.realm(&cx.heap))
    };
    if event.is_trusted() {
        dispatch_trusted(cx, target, event, caller, end)
    } else {
        dispatch_in_script(cx, target, event, caller, end)
    }
}

/// <https://dom.spec.whatwg.org/#concept-event-fire>
pub(crate) fn fire<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    name: Known,
    init: EventInit,
) -> bool {
    if !if init.bubbles {
        is_listened_to(name)
    } else {
        target
            .as_node()
            .map_or_else(|| target.has_listeners(name), |it| it.is_heard(name))
    } {
        return true;
    }
    let event = Event::new(
        target
            .as_node()
            .map_or_else(|| target.realm(&cx.heap), |it| it.doc().heap(&cx.heap)),
        name,
        init,
    );
    dispatch(cx, target, event)
}

fn dispatch_in_script<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    event: &'a Event,
    caller: Option<&'a WindowTarget>,
    end: Option<&'a Node>,
) -> bool {
    let was_at_top_level = swap_top_level(false);
    let proceeds = dispatch_to(cx, target, event, caller, end);
    swap_top_level(was_at_top_level);
    proceeds
}

pub(super) fn dispatch_for_script<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    event: &'a Event,
    caller: Option<&'a WindowTarget>,
    trusted: Trusted,
) -> bindgen::Result<'a, bool> {
    if event.has(F::DISPATCHING | F::UNINITIALIZED) {
        return Err(dom_error(
            &cx.heap,
            DomError::InvalidStateError,
            "The event is already being dispatched, or it is not initialized.",
        ));
    }
    event.unset(F::TRUSTED);
    if trusted == Trusted::Yes {
        event.set(F::TRUSTED);
    }
    Ok(dispatch_in_script(cx, target, event, caller, None))
}

/// `load` and `pageshow`, whose target is the document.
pub(crate) fn dispatch_for_document<'a>(
    cx: Cx<'_, 'a>,
    window: &'a WindowTarget,
    event: &'a Event,
) {
    event.set(F::TRUSTED | F::DISPATCHING);
    let mut path = Path {
        shown_target: window.doc().map(|it| &***it),
        ..Path::new()
    };
    path.push(&cx.heap, window);
    path.run(cx, event, Some(window));
    finish(event);
}

#[cold]
pub(crate) fn twin_of_native_event<'a>(
    cx: Cx<'_, 'a>,
    native: JSValue,
) -> bindgen::Result<'a, &'a Event> {
    unsafe extern "C" {
        safe fn Bun__DOM__twinOfNativeEvent(
            global: &bun_jsc::JSGlobalObject,
            value: JSValue,
            event: JSValue,
            error_event: JSValue,
        ) -> JSValue;
    }
    let (global, event, error_event) = (
        global_of(&cx.heap),
        Event::interface_object(&cx.heap),
        ErrorEvent::interface_object(&cx.heap),
    );
    let twin = bun_jsc::call_zero_is_throw(global, || {
        Bun__DOM__twinOfNativeEvent(global, native, event, error_event)
    })?;
    let refused = || {
        cx.heap.type_error(format_args!(
            "Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'."
        ))
    };
    let twin = Event::from_js(&cx.heap, twin).ok_or_else(refused)?;
    js_Event::set_native(twin, native);
    Ok(twin)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__isEvent(value: JSValue) -> bool {
    Event::is(value)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__cancelEvent(event: JSValue) {
    // SAFETY: the caller has asked `Bun__DOM__isEvent`.
    unsafe { Event::from_js_unchecked(event) }.cancel();
}

impl EventTarget {
    #[inline]
    fn has_window(&self) -> bool {
        self.as_node()
            .is_some_and(|it| it.doc().is(DocFlags::HAS_PAGE))
    }

    pub(crate) fn dispatch_event<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        event: JsLocal<'a>,
    ) -> bindgen::Result<'a, bool> {
        let event = match Event::from_js(&cx.heap, event.to_js()) {
            Some(event) => event,
            None => twin_of_native_event(cx, event.to_js())?,
        };
        let caller = if self.has_window() {
            None
        } else {
            WindowTarget::of_realm(&cx.heap)
        };
        dispatch_for_script(cx, self, event, caller, Trusted::No)
    }
}

impl Event {
    pub(crate) fn composed_path<'a>(&'a self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        // SAFETY: `Path::run` has not returned, or it is null.
        let path = unsafe { self.path.get().cast::<Path<'a>>().as_ref() };
        let visible = path.into_iter().flat_map(|path| {
            path.visible_from(field(js_Event::current_target(self)))
                .into_iter()
                .map(|it| path.get(it).exposed())
        });
        Ok(heap
            .create_array(
                visible.collect::<smallvec::SmallVec<[_; INLINE]>>(),
                bindgen::to_js::any,
            )?
            .to_js())
    }
}
