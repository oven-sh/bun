//! <https://html.spec.whatwg.org/#navigation-api>

use bun_jsc::JSPromise;
use bun_jsc::bindgen::{Callable, CallbackBody};

use super::navigate::{Options, Source};
use super::*;
use crate::api::events::ErrorEvent;
use crate::api::ui::{entry as page, focus, host::allows_feature};

fn invalid_state<'a>(heap: &JsHeap<'a>, message: &str) -> bindgen::Error<'a> {
    dom_error(heap, DomError::InvalidStateError, message)
}

fn promise<'a>(heap: &JsHeap<'a>, value: Option<JSValue>) -> Option<JsLocal<'a, JSPromise>> {
    JsLocal::new(heap, value?).as_promise()
}

fn fulfill<'a>(cx: &mut Cx<'a>, it: Option<JSValue>, value: JSValue) {
    let settled = promise(&cx.heap, it).map_or(Ok(()), |it| it.resolve(cx, value));
    bun_web::exec::report(cx, settled);
}

fn reject<'a>(cx: &mut Cx<'a>, it: Option<JSValue>, reason: JSValue) {
    let settled = promise(&cx.heap, it).map_or(Ok(()), |it| it.reject(cx, reason));
    bun_web::exec::report(cx, settled);
}

fn handled_promise(heap: &JsHeap<'_>) -> JSValue {
    let promise = heap.create_promise();
    promise.mark_as_handled();
    promise.to_js()
}

fn result_of(heap: &JsHeap<'_>, committed: JSValue, finished: JSValue) -> JSValue {
    let result = heap.create_empty_object().to_js();
    result.put(global_of(heap), b"committed", committed);
    result.put(global_of(heap), b"finished", finished);
    result
}

// ───────────────────────────── entries ─────────────────────────────

#[repr(C)]
pub(crate) struct NavigationHistoryEntry {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_NavigationHistoryEntry::Fields,
    entry: Entry,
}

/// What is known about an entry for as long as the document is active.
fn about(
    history: Option<&History>,
    entry: Option<&Entry>,
    read: fn(&HistoryEntry) -> &String,
) -> String {
    entry
        .filter(|_| history.is_some_and(History::is_active))
        .map(|it| read(&it.borrow()).clone())
        .unwrap_or_default()
}

fn index_in(history: Option<&History>, entry: Option<&Entry>) -> i32 {
    history
        .filter(|it| it.is_active())
        .and_then(|it| it.index_of(entry?))
        .map_or(-1, |it| it as i32)
}

slots!(NavigationHistoryEntry = js_NavigationHistoryEntry { history: History });

impl NavigationHistoryEntry {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, history: &'a History, entry: &Entry) -> &'a Self {
        let this = js_NavigationHistoryEntry::create(
            history.realm(heap),
            Self {
                base: Default::default(),
                fields: Default::default(),
                entry: Rc::clone(entry),
            },
        );
        this.set_history(Some(history));
        this
    }

    pub(super) fn stands_for(&self, entry: &Entry) -> bool {
        Rc::ptr_eq(&self.entry, entry)
    }

    pub(crate) fn get_key(&self) -> String {
        about(self.history(), Some(&self.entry), |it| &it.key)
    }

    pub(crate) fn get_id(&self) -> String {
        about(self.history(), Some(&self.entry), |it| &it.id)
    }

    pub(crate) fn get_url(&self) -> String {
        about(self.history(), Some(&self.entry), |it| &it.url)
    }

    pub(crate) fn get_index(&self) -> i32 {
        index_in(self.history(), Some(&self.entry))
    }

    pub(crate) fn get_same_document(&self) -> bool {
        self.history().is_some_and(History::is_active) && self.entry.borrow().is_of_document
    }

    pub(crate) fn get_state<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, JSValue> {
        let state = self.entry.borrow().navigation_state.clone();
        self.history()
            .filter(|it| it.is_active())
            .map_or(Ok(JSValue::UNDEFINED), |it| {
                deserialize(&cx.heap, it.window(), state)
            })
    }
}

pub(crate) struct NavigationDestination {
    url: RefCell<String>,
    state: RefCell<Option<Serialized>>,
    entry: Option<Entry>,
    is_same_document: bool,
}

slots!(NavigationDestination = js_NavigationDestination { history: History });

impl NavigationDestination {
    pub(crate) fn get_key(&self) -> String {
        about(self.history(), self.entry.as_ref(), |it| &it.key)
    }

    pub(crate) fn get_id(&self) -> String {
        about(self.history(), self.entry.as_ref(), |it| &it.id)
    }

    pub(crate) fn get_url(&self) -> String {
        self.url.borrow().clone()
    }

    pub(crate) fn get_index(&self) -> i32 {
        index_in(self.history(), self.entry.as_ref())
    }

    pub(crate) fn get_same_document(&self) -> bool {
        self.is_same_document
    }

    pub(crate) fn get_state<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, JSValue> {
        let state = self.state.borrow().clone();
        self.history().map_or(Ok(JSValue::UNDEFINED), |it| {
            deserialize(&cx.heap, it.window(), state)
        })
    }
}

pub(crate) struct NavigationTransition(NavigationType, bindgen::Interior);

impl NavigationTransition {
    pub(crate) fn get_navigation_type(&self) -> NavigationType {
        self.0
    }

    fn fail<'a>(&'a self, cx: &mut Cx<'a>, reason: JSValue) {
        reject(cx, js_NavigationTransition::committed(self), reason);
        reject(cx, js_NavigationTransition::finished(self), reason);
    }
}

pub(crate) struct NavigationActivation(NavigationType, bindgen::Interior);

impl NavigationActivation {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        history: &'a History,
        from: Option<Entry>,
        entry: &Entry,
        kind: NavigationType,
    ) -> &'a Self {
        let this = js_NavigationActivation::create(
            history.realm(heap),
            NavigationActivation(kind, Default::default()),
        );
        js_NavigationActivation::set_from(
            this,
            from.map_or(JSValue::NULL, |it| history.wrap(heap, &it).to_js()),
        );
        js_NavigationActivation::set_entry(this, history.wrap(heap, entry).to_js());
        this
    }

    pub(crate) fn get_navigation_type(&self) -> NavigationType {
        self.0
    }
}

/// <https://html.spec.whatwg.org/#navigation-api-method-tracker>
pub(crate) struct Tracker {
    state: RefCell<Option<Serialized>>,
    key: String,
}

impl Tracker {
    fn new<'a>(
        heap: &JsHeap<'a>,
        info: JsLocal<'a>,
        state: Option<Serialized>,
        key: String,
    ) -> &'a Tracker {
        let this = js_NavigationTracker::create(
            heap,
            Tracker {
                state: state.into(),
                key,
            },
        );
        js_NavigationTracker::set_committed(this, heap.create_promise().to_js());
        js_NavigationTracker::set_finished(this, handled_promise(heap));
        js_NavigationTracker::set_info(this, info.to_js());
        this
    }

    fn result(&self, heap: &JsHeap<'_>) -> JSValue {
        let [committed, finished] = [
            js_NavigationTracker::committed(self),
            js_NavigationTracker::finished(self),
        ]
        .map(Option::unwrap_or_default);
        result_of(self.realm(heap), committed, finished)
    }

    fn fail<'a>(&'a self, cx: &mut Cx<'a>, reason: JSValue) {
        reject(cx, js_NavigationTracker::committed(self), reason);
        reject(cx, js_NavigationTracker::finished(self), reason);
    }
}

// ───────────────────────────── NavigateEvent ─────────────────────────────

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Interception {
    #[default]
    None,
    Intercepted,
    Committed,
    Scrolled,
    Finished,
}

#[derive(Default)]
struct Course {
    interception: Cell<Interception>,
    leaves_focus: Cell<bool>,
    leaves_scroll: Cell<bool>,
    promises_left: Cell<u32>,
    classic_state: Option<Serialized>,
    focus_serial: u32,
}

#[repr(C)]
pub(crate) struct NavigateEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_NavigateEvent::Fields,
    kind: Cell<NavigationType>,
    can_intercept: bool,
    user_initiated: bool,
    hash_change: bool,
    has_visual_transition: bool,
    download: Option<DomString>,
    course: Course,
}

slots!(
    NavigateEvent = js_NavigateEvent {
        destination: NavigationDestination,
        navigation: Navigation,
        tracker: Tracker
    }
);

slots!(NavigateEvent = js_NavigateEvent set { source_element: Element, });

impl NavigateEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &NavigateEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            NavigateEvent {
                base: Event::base(
                    name,
                    EventInit {
                        bubbles: init.bubbles,
                        cancelable: init.cancelable,
                        composed: init.composed,
                    },
                    Trusted::No,
                ),
                fields: Default::default(),
                kind: init.navigation_type.into(),
                can_intercept: init.can_intercept,
                user_initiated: init.user_initiated,
                hash_change: init.hash_change,
                has_visual_transition: init.has_ua_visual_transition,
                download: init.download_request.clone(),
                course: Course::default(),
            },
        );
        this.set_destination(Some(init.destination));
        this.set_source_element(init.source_element);
        js_NavigateEvent::set_signal(this, init.signal.to_js());
        js_NavigateEvent::set_form_data(this, init.form_data.map_or(JSValue::NULL, JsLocal::to_js));
        js_NavigateEvent::set_info(this, init.info.to_js());
        this
    }

    pub(crate) fn get_navigation_type(&self) -> NavigationType {
        self.kind.get()
    }

    pub(crate) fn get_can_intercept(&self) -> bool {
        self.can_intercept
    }

    pub(crate) fn get_user_initiated(&self) -> bool {
        self.user_initiated
    }

    pub(crate) fn get_hash_change(&self) -> bool {
        self.hash_change
    }

    pub(crate) fn get_download_request(&self) -> Option<&DomString> {
        self.download.as_ref()
    }

    pub(crate) fn get_has_visual_transition(&self) -> bool {
        self.has_visual_transition
    }

    fn is(&self, interception: Interception) -> bool {
        self.course.interception.get() == interception
    }

    fn is_aborted(&self, heap: &JsHeap<'_>) -> bool {
        js_NavigateEvent::signal(self)
            .and_then(|it| JsLocal::new(heap, it).as_abort_signal())
            .is_some_and(|it| it.is_aborted())
    }

    fn handlers(&self) -> List<'_> {
        List::from_value(js_NavigateEvent::handlers(self).expect("a trusted event has them"))
    }

    fn precommit_handlers(&self) -> List<'_> {
        List::from_value(
            js_NavigateEvent::precommit_handlers(self).expect("a trusted event has them"),
        )
    }

    /// <https://html.spec.whatwg.org/#navigateevent-perform-shared-checks>
    fn check<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a Navigation> {
        match self.navigation().filter(|_| self.is_trusted()) {
            None => Err(dom_error(
                heap,
                DomError::SecurityError,
                "This may only be called on a trusted event.",
            )),
            Some(navigation) if !navigation.history().is_active() => {
                Err(invalid_state(heap, "The window is detached."))
            }
            Some(_) if self.get_default_prevented() => {
                Err(invalid_state(heap, "The event has been canceled."))
            }
            Some(navigation) => Ok(navigation),
        }
    }

    pub(crate) fn intercept<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        options: &NavigationInterceptOptions<'a>,
    ) -> Result<'a> {
        self.check(heap)?;
        if !self.can_intercept {
            return Err(dom_error(
                heap,
                DomError::SecurityError,
                "This navigation cannot be intercepted.",
            ));
        }
        if self.get_event_phase() == 0 {
            return Err(invalid_state(
                heap,
                "intercept() may only be called while the event is being dispatched.",
            ));
        }
        if options.precommit_handler.is_some() && !self.get_cancelable() {
            return Err(invalid_state(
                heap,
                "A precommitHandler needs a cancelable event.",
            ));
        }
        self.course.interception.set(Interception::Intercepted);
        options
            .precommit_handler
            .into_iter()
            .for_each(|it| self.precommit_handlers().push(heap, it.to_js()));
        options
            .handler
            .into_iter()
            .for_each(|it| self.handlers().push(heap, it.to_js()));
        options
            .focus_reset
            .into_iter()
            .for_each(|it| self.course.leaves_focus.set(it == NavigationTiming::Manual));
        options.scroll.into_iter().for_each(|it| {
            self.course
                .leaves_scroll
                .set(it == NavigationTiming::Manual)
        });
        Ok(())
    }

    pub(crate) fn scroll<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a> {
        let navigation = self.check(&cx.heap)?;
        if !self.is(Interception::Committed) {
            return Err(invalid_state(&cx.heap, "scroll() cannot be called now."));
        }
        navigation.scroll_for(cx, self);
        Ok(())
    }

    /// Calls the handlers, and then `success` or what fails the navigation.
    fn wait_for<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        handlers: List<'a>,
        arguments: &[JSValue],
        success: CallbackBody,
    ) {
        let (results, was_at_top_level) = (List::new(&cx.heap), swap_top_level(false));
        for handler in handlers.values() {
            let result = handler
                .call(cx.global(), JSValue::UNDEFINED, arguments)
                .or_else(|error| {
                    let rejected = self.realm(&cx.heap).create_promise();
                    cx.catch(error.into())
                        .and_then(|it| rejected.reject(cx, it))
                        .map(|()| rejected.to_js())
                });
            results.push(&cx.heap, result.unwrap_or(JSValue::UNDEFINED));
        }
        swap_top_level(was_at_top_level);
        if results.is_empty() {
            results.push(&cx.heap, JSValue::UNDEFINED);
        }
        self.course.promises_left.set(results.len());
        let failure: CallbackBody = |cx, [event, _], _, arguments| {
            if let Some(event) = NavigateEvent::from_value(event.to_js())
                && let Some(navigation) = event.navigation()
            {
                navigation.fail(cx, event, arguments[0].to_js());
            }
            Ok(JSValue::UNDEFINED)
        };
        let [success, failure] = [success, failure].map(|it| {
            self.realm(&cx.heap)
                .create_callback(it, [self.to_js(), JSValue::UNDEFINED], 0)
        });
        for result in results.values() {
            let reacted = cx
                .promise_resolve(result)
                .map(|it| it.react(self.realm(&cx.heap), Some(success), Some(failure)));
            bun_web::exec::report(cx, reacted);
        }
    }

    /// If that was the last promise.
    fn fulfilled<'a>(event: JsLocal<'a>) -> Option<(&'a Navigation, &'a NavigateEvent)> {
        let event = NavigateEvent::from_value(event.to_js())?;
        event.course.promises_left.update(|it| it - 1);
        (event.course.promises_left.get() == 0).then_some((event.navigation()?, event))
    }
}

impl NavigationPrecommitController {
    fn event<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, (&'a NavigateEvent, &'a Window)> {
        let event = js_NavigationPrecommitController::event(self)
            .filter(|it| !it.get_default_prevented() && it.is(Interception::Intercepted));
        let found = event
            .and_then(|it| Some((it, it.navigation()?.history().window())))
            .filter(|it| !it.1.is_disposed());
        found.ok_or_else(|| invalid_state(heap, "The navigation has been committed or canceled."))
    }

    pub(crate) fn redirect<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        given: &DomString,
        options: &NavigationNavigateOptions<'a>,
    ) -> Result<'a> {
        let (event, window) = self.event(&cx.heap)?;
        if !matches!(
            event.kind.get(),
            NavigationType::Push | NavigationType::Replace
        ) {
            return Err(invalid_state(
                &cx.heap,
                "This navigation cannot be redirected.",
            ));
        }
        let Some(url) = window.resolve(cx, given) else {
            return Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("Invalid URL '{}'.", given.to_utf8()),
            ));
        };
        if !can_rewrite_url(window, &url) {
            return Err(cx.heap.dom_exception(
                DomError::SecurityError,
                format_args!("Cannot redirect to '{url}'."),
            ));
        }
        match options.history {
            NavigationHistoryBehavior::Auto => {}
            NavigationHistoryBehavior::Push => event.kind.set(NavigationType::Push),
            NavigationHistoryBehavior::Replace => event.kind.set(NavigationType::Replace),
        }
        let Some(destination) = event.destination() else {
            return Ok(());
        };
        if !options.state.is_undefined() {
            let state = Some(serialize(cx, options.state)?);
            event
                .tracker()
                .into_iter()
                .for_each(|it| drop(it.state.replace(state.clone())));
            destination.state.replace(state);
        }
        destination.url.replace(url);
        if !options.info.is_undefined() {
            js_NavigateEvent::set_info(event, options.info.to_js());
        }
        Ok(())
    }

    pub(crate) fn add_handler<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        handler: JsLocal<'a, Callable>,
    ) -> Result<'a> {
        self.event(heap)?.0.handlers().push(heap, handler.to_js());
        Ok(())
    }
}

// ───────────────────────────── Navigation ─────────────────────────────

/// What a `navigate` event is about.
pub(super) struct Intent<'a, 'u> {
    pub(super) kind: NavigationType,
    pub(super) url: &'u str,
    pub(super) is_same_document: bool,
    pub(super) state: Option<Serialized>,
    pub(super) classic_state: Option<Serialized>,
    pub(super) entry: Option<Entry>,
    pub(super) is_by_user: bool,
    pub(super) form_data: Option<JSValue>,
    pub(super) download: Option<DomString>,
    pub(super) element: Option<&'a Element>,
}

impl<'u> Intent<'_, 'u> {
    pub(super) fn new(kind: NavigationType, url: &'u str, is_same_document: bool) -> Self {
        Intent {
            kind,
            url,
            is_same_document,
            state: None,
            classic_state: None,
            entry: None,
            is_by_user: false,
            form_data: None,
            download: None,
            element: None,
        }
    }
}

#[repr(C)]
#[derive(Default)]
pub(crate) struct Navigation {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_Navigation::Fields,
    suppresses_scroll: Cell<bool>,
    depth: Cell<u8>,
}

slots!(Navigation = js_Navigation {
    activation: NavigationActivation, transition: NavigationTransition, event: NavigateEvent, ongoing: Tracker, upcoming: Tracker,
} [traversals: Tracker]);

fn is_same<T: Handle>(a: Option<&T>, b: Option<&T>) -> bool {
    a.map(Handle::value) == b.map(Handle::value)
}

impl Navigation {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, history: &'a History) -> &'a Navigation {
        let this = js_Navigation::create(history.realm(heap), Navigation::default());
        js_Navigation::set_history(this, history.to_js());
        this
    }

    fn history(&self) -> &History {
        js_Navigation::history(self)
            .and_then(History::from_value)
            .expect("it is set first")
    }

    fn window(&self) -> &Window {
        self.history().window()
    }

    pub(super) fn suppresses_scroll(&self) -> bool {
        self.suppresses_scroll.get()
    }

    /// <https://html.spec.whatwg.org/#has-entries-and-events-disabled>
    fn is_disabled(&self) -> bool {
        !self.history().is_active()
            || self.window().has_opaque_origin()
            || self.window().host().is_initial()
    }

    fn abort_error(&self, heap: &JsHeap<'_>) -> JSValue {
        self.realm(heap)
            .create_dom_exception(DomError::AbortError, format_args!("Navigation was aborted"))
            .to_js()
    }

    fn forget(&self, tracker: Option<&Tracker>) {
        if is_same(self.ongoing(), tracker) {
            self.set_ongoing(None);
        }
    }

    fn end_transition(&self, transition: Option<&NavigationTransition>) {
        if is_same(self.transition(), transition) {
            self.set_transition(None);
        }
    }

    /// <https://html.spec.whatwg.org/#update-the-navigation-api-entries-for-a-same-document-navigation>
    pub(super) fn committed<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        from: &Entry,
        kind: Option<NavigationType>,
        dropped: &[Entry],
    ) {
        if self.is_disabled() {
            return;
        }
        let (history, event) = (self.history(), self.event());
        let current = history.current();
        if let Some(ongoing) = self.ongoing().filter(|_| kind.is_some()) {
            let entry = history.wrap(&cx.heap, &current).to_js();
            js_NavigationTracker::set_entry(ongoing, entry);
            let state = ongoing.state.borrow().clone();
            if state.is_some() {
                current.borrow_mut().navigation_state = state;
                history.save(&current, HistoryChange::Update);
            }
            fulfill(cx, js_NavigationTracker::committed(ongoing), entry);
        }
        let change = NavigationCurrentEntryChangeEvent::new(
            self.realm(&cx.heap),
            kind,
            history.wrap(&cx.heap, from),
        );
        dispatch_now(cx, self, change);
        for it in dropped {
            let key = it.borrow().key.clone();
            if key != current.borrow().key {
                self.give_up_traversal(cx, Some(&key), None);
            }
            history.dispose_of(cx, it);
        }
        if let Some(event) = event
            .filter(|it| kind == Some(NavigationType::Traverse) && is_same(Some(*it), self.event()))
        {
            self.run_handlers(cx, event);
        }
    }

    pub(super) fn fire_for_traversal<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        entry: Entry,
        is_by_user: bool,
    ) -> bool {
        let HistoryEntry {
            url,
            navigation_state,
            is_of_document,
            ..
        } = entry.borrow().clone();
        self.fire(
            cx,
            Intent {
                state: navigation_state,
                entry: Some(entry),
                is_by_user,
                ..Intent::new(NavigationType::Traverse, &url, is_of_document)
            },
        )
    }

    pub(super) fn is_under_way(&self) -> bool {
        self.event().is_some()
    }

    fn take_traversal<'a>(&'a self, heap: &JsHeap<'a>, key: &str) -> Option<&'a Tracker> {
        let found = self.traversals().iter().find(|it| it.key == key)?;
        self.set_traversals(self.traversals().without(heap, found));
        Some(found)
    }

    /// A listener that navigates, over and over.
    pub(super) fn is_nested_too_deep(&self) -> bool {
        self.depth.get() >= 50
    }

    /// <https://html.spec.whatwg.org/#inner-navigate-event-firing-algorithm>. False if there is nothing else to do.
    pub(super) fn fire<'a>(&'a self, cx: &mut Cx<'a>, intent: Intent<'a, '_>) -> bool {
        if self.is_disabled() {
            return true;
        }
        if self.is_nested_too_deep() {
            return false;
        }
        let (history, window, upcoming) = (self.history(), self.window(), self.upcoming());
        self.set_upcoming(None);
        self.abort(cx);
        let tracker = intent.entry.as_ref().map_or(upcoming, |it| {
            self.take_traversal(&cx.heap, &it.borrow().key)
        });
        self.set_ongoing(tracker);
        if !history.is_active() {
            let error = self.abort_error(&cx.heap);
            tracker.into_iter().for_each(|it| it.fail(cx, error));
            return false;
        }
        let Intent {
            kind,
            url,
            is_same_document,
            ..
        } = intent;
        let (is_traversal, ui) = (kind == NavigationType::Traverse, Ui::of(window.document()));
        let cancelable = !is_traversal
            || is_same_document
                && ui.and_then(Ui::container).is_none()
                && (!intent.is_by_user || window.has_activation());
        let state = NavigateEvent {
            base: Event::base(
                atom!("navigate"),
                EventInit {
                    cancelable,
                    ..PLAIN
                },
                Trusted::Yes,
            ),
            fields: Default::default(),
            kind: kind.into(),
            can_intercept: can_rewrite_url(window, url) && (is_same_document || !is_traversal),
            user_initiated: intent.is_by_user,
            hash_change: intent.classic_state.is_none()
                && is_same_document
                && differ_in_fragment_only(url, &window.url()),
            has_visual_transition: false,
            download: intent.download,
            course: Course {
                classic_state: intent.classic_state,
                focus_serial: ui.map_or(0, |it| it.focus.changes.get()),
                ..Default::default()
            },
        };
        let heap = self.realm(&cx.heap);
        let event = js_NavigateEvent::create(heap, state);
        let destination = js_NavigationDestination::create(
            heap,
            NavigationDestination {
                url: String::from(url).into(),
                state: intent.state.into(),
                entry: intent.entry,
                is_same_document,
            },
        );
        destination.set_history(Some(history));
        event.set_destination(Some(destination));
        event.set_source_element(intent.element);
        event.set_navigation(Some(self));
        event.set_tracker(tracker);
        js_NavigateEvent::set_signal(event, heap.create_abort_signal().to_js());
        js_NavigateEvent::set_form_data(event, intent.form_data.unwrap_or(JSValue::NULL));
        js_NavigateEvent::set_info(
            event,
            tracker
                .and_then(js_NavigationTracker::info)
                .unwrap_or(JSValue::UNDEFINED),
        );
        js_NavigateEvent::set_handlers(event, List::new(heap).to_js());
        js_NavigateEvent::set_precommit_handlers(event, List::new(heap).to_js());
        tracker
            .into_iter()
            .for_each(|it| js_NavigationTracker::set_info(it, JSValue::UNDEFINED));
        self.set_event(Some(event));
        self.suppresses_scroll.set(false);
        self.depth.update(|it| it + 1);
        let proceeds = dispatch_now(cx, self, event);
        self.depth.update(|it| it - 1);
        if !proceeds {
            if !event.is_aborted(&cx.heap) {
                self.abort(cx);
            }
            return false;
        }
        let heap = self.realm(&cx.heap);
        if !event.is(Interception::None) {
            let transition = js_NavigationTransition::create(
                heap,
                NavigationTransition(kind, Default::default()),
            );
            js_NavigationTransition::set_from(
                transition,
                history.wrap(heap, &history.current()).to_js(),
            );
            js_NavigationTransition::set_to(transition, destination.to_js());
            js_NavigationTransition::set_committed(transition, handled_promise(heap));
            js_NavigationTransition::set_finished(transition, handled_promise(heap));
            self.set_transition(Some(transition));
        }
        if event.precommit_handlers().is_empty() {
            self.commit(cx, event);
        } else {
            let controller = js_NavigationPrecommitController::create(heap, Default::default());
            js_NavigationPrecommitController::set_event(controller, Some(event));
            event.wait_for(
                cx,
                event.precommit_handlers(),
                &[controller.to_js()],
                |cx, [event, _], _, _| {
                    NavigateEvent::fulfilled(event)
                        .into_iter()
                        .for_each(|(navigation, event)| navigation.commit(cx, event));
                    Ok(JSValue::UNDEFINED)
                },
            );
        }
        event.is(Interception::None)
    }

    fn is_over(&self, heap: &JsHeap<'_>, event: &NavigateEvent) -> bool {
        !self.history().is_active() || event.is_aborted(heap)
    }

    fn commit<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent) {
        let (history, Some(destination)) = (
            self.history(),
            event
                .destination()
                .filter(|_| !self.is_over(&cx.heap, event)),
        ) else {
            return;
        };
        let (kind, is_intercepted) = (event.kind.get(), !event.is(Interception::None));
        if is_intercepted {
            event.course.interception.set(Interception::Committed);
        }
        if kind == NavigationType::Traverse {
            if !destination.is_same_document {
                self.forget(event.tracker());
            }
            self.suppresses_scroll.set(is_intercepted);
            if is_intercepted {
                history.proceed(cx);
            }
            return;
        }
        if is_intercepted && kind != NavigationType::Reload {
            let (url, state) = (destination.get_url(), destination.state.borrow().clone());
            history.commit(
                cx,
                &url,
                kind == NavigationType::Replace,
                event.course.classic_state.clone(),
                state,
            );
        } else if is_intercepted {
            history.remember_scroll();
            self.committed(cx, &history.current(), Some(kind), &[]);
        }
        if (is_intercepted || destination.is_same_document) && !self.is_over(&cx.heap, event) {
            self.run_handlers(cx, event);
        }
    }

    fn run_handlers<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent) {
        fulfill(
            cx,
            self.transition()
                .and_then(js_NavigationTransition::committed),
            JSValue::UNDEFINED,
        );
        event.wait_for(cx, event.handlers(), &[], |cx, [event, _], _, _| {
            NavigateEvent::fulfilled(event)
                .into_iter()
                .for_each(|(navigation, event)| navigation.succeed(cx, event));
            Ok(JSValue::UNDEFINED)
        });
    }

    fn succeed<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent) {
        if self.is_over(&cx.heap, event) {
            return;
        }
        let transition = self.transition();
        self.set_event(None);
        self.finish(cx, event, true);
        if let Some(tracker) = event.tracker() {
            self.forget(Some(tracker));
            fulfill(
                cx,
                js_NavigationTracker::finished(tracker),
                js_NavigationTracker::entry(tracker).unwrap_or(JSValue::UNDEFINED),
            );
        }
        let success = Event::new(self.realm(&cx.heap), atom!("navigatesuccess"), PLAIN);
        dispatch_now(cx, self, success);
        fulfill(
            cx,
            transition.and_then(js_NavigationTransition::finished),
            JSValue::UNDEFINED,
        );
        self.end_transition(transition);
    }

    fn scroll_for<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent) {
        event.course.interception.set(Interception::Scrolled);
        if event.kind.get() == NavigationType::Traverse {
            self.history().restore_scroll(cx);
        } else if !self.history().scroll_to_fragment(cx, true)
            && event.kind.get() != NavigationType::Reload
        {
            view::jump_viewport(cx, self.window().document(), [0.0; 2], ScrollBehavior::Auto);
        }
    }

    /// <https://html.spec.whatwg.org/#potentially-reset-the-focus>
    fn reset_focus<'a>(&'a self, cx: &mut Cx<'a>, ui: &'a Ui) {
        let candidates = Refs::collect(
            &cx.heap,
            ui.doc()
                .elements_with_objects()
                .filter(|it| it.has_attr(atom!("autofocus"))),
        );
        match candidates.iter().find(|it| focus::is_focusable(cx, it)) {
            Some(target) => focus::focus(cx, target, focus::Cause::Script, Default::default()),
            None => page::reset_focus(cx, ui),
        }
    }

    fn finish<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent, did_fulfill: bool) {
        if event.is(Interception::None) {
            return;
        }
        let resets_focus = !event.is(Interception::Intercepted) && !event.course.leaves_focus.get();
        if let Some(ui) = Ui::of(self.window().document())
            .filter(|it| resets_focus && it.focus.changes.get() == event.course.focus_serial)
        {
            if event.user_initiated
                || allows_feature(
                    ui,
                    bun_web::permissions_policy::Feature::FocusWithoutUserActivation,
                )
            {
                self.reset_focus(cx, ui);
            }
        }
        if did_fulfill && event.is(Interception::Committed) && !event.course.leaves_scroll.get() {
            self.scroll_for(cx, event);
        }
        event.course.interception.set(Interception::Finished);
    }

    fn fail<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent, reason: JSValue) {
        if !self.is_over(&cx.heap, event) {
            self.finish(cx, event, false);
            self.end(cx, event, reason);
        }
    }

    fn end<'a>(&'a self, cx: &mut Cx<'a>, event: &'a NavigateEvent, error: JSValue) {
        let (tracker, transition) = (event.tracker(), self.transition());
        self.set_event(None);
        let was_at_top_level = swap_top_level(false);
        js_NavigateEvent::signal(event)
            .and_then(|it| JsLocal::new(&cx.heap, it).as_abort_signal())
            .into_iter()
            .for_each(|it| it.abort(cx, error));
        swap_top_level(was_at_top_level);
        tracker.into_iter().for_each(|it| self.forget(Some(it)));
        let description = host::describe_error(cx, self.window(), error);
        let failure = ErrorEvent::described(
            self.realm(&cx.heap),
            atom!("navigateerror"),
            description,
            error,
        );
        dispatch_now(cx, self, failure);
        tracker.into_iter().for_each(|it| it.fail(cx, error));
        transition.into_iter().for_each(|it| it.fail(cx, error));
        self.end_transition(transition);
    }

    /// <https://html.spec.whatwg.org/#inform-the-navigation-api-about-aborting-navigation>
    pub(super) fn abort<'a>(&'a self, cx: &mut Cx<'a>) {
        while let Some(event) = self.event() {
            self.suppresses_scroll.set(false);
            if event.get_event_phase() != 0 {
                event.set(crate::api::events::EventFlags::CANCELED);
            }
            let error = self.abort_error(&cx.heap);
            self.end(cx, event, error);
        }
    }

    /// `None`: all of them, and an `AbortError`.
    pub(super) fn give_up_traversal<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        key: Option<&str>,
        error: Option<DomError>,
    ) {
        for tracker in self
            .traversals()
            .iter()
            .filter(|it| key.is_none_or(|key| it.key == key))
        {
            self.set_traversals(self.traversals().without(&cx.heap, tracker));
            let failed = |it| {
                self.realm(&cx.heap)
                    .create_dom_exception(it, format_args!("The traversal failed."))
                    .to_js()
            };
            let error = error.map_or_else(|| self.abort_error(&cx.heap), failed);
            tracker.fail(cx, error);
        }
    }

    /// <https://html.spec.whatwg.org/#navigation-api-early-error-result>
    fn or_early_error<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        result: Result<'a, JSValue>,
    ) -> Result<'a, JSValue> {
        result.or_else(|error| {
            let (error, [committed, finished]) = (
                cx.catch(error)?,
                [(); 2].map(|()| self.realm(&cx.heap).create_promise()),
            );
            committed.reject(cx, error)?;
            finished.reject(cx, error)?;
            Ok(result_of(
                self.realm(&cx.heap),
                committed.to_js(),
                finished.to_js(),
            ))
        })
    }

    /// `start` may fire the `navigate` event.
    fn track<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        info: JsLocal<'a>,
        state: Option<Serialized>,
        start: &dyn Fn(&mut Cx<'a>, &'a History),
    ) -> Result<'a, JSValue> {
        self.require_navigable(&cx.heap)?;
        let tracker = Tracker::new(self.realm(&cx.heap), info, state, String::new());
        if !self.is_disabled() {
            self.set_upcoming(Some(tracker));
        }
        start(cx, self.history().up_to_date());
        if !is_same(self.upcoming(), Some(tracker)) {
            return Ok(tracker.result(&cx.heap));
        }
        self.set_upcoming(None);
        Err(dom_error(
            self.realm(&cx.heap),
            DomError::AbortError,
            "Navigation was aborted",
        ))
    }

    fn require_navigable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        match (self.history().is_active(), self.window().is_unloading()) {
            (false, _) => Err(invalid_state(self.realm(heap), "The window is detached.")),
            (_, true) => Err(invalid_state(
                self.realm(heap),
                "The document is being unloaded.",
            )),
            _ => Ok(()),
        }
    }

    /// <https://html.spec.whatwg.org/#performing-a-navigation-api-traversal>
    fn try_traversal<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        entry: Option<Entry>,
        info: JsLocal<'a>,
    ) -> Result<'a, JSValue> {
        let Some(entry) = entry.filter(|_| !self.is_disabled()) else {
            return Err(invalid_state(
                self.realm(&cx.heap),
                "There is no such entry.",
            ));
        };
        self.require_navigable(&cx.heap)?;
        let (history, key) = (self.history(), entry.borrow().key.clone());
        if Rc::ptr_eq(&entry, &history.current()) {
            let (current, [committed, finished]) = (
                history.wrap(&cx.heap, &entry).to_js(),
                [(); 2].map(|()| self.realm(&cx.heap).create_promise()),
            );
            committed.resolve(cx, current)?;
            finished.resolve(cx, current)?;
            return Ok(result_of(
                self.realm(&cx.heap),
                committed.to_js(),
                finished.to_js(),
            ));
        }
        if let Some(known) = self.traversals().iter().find(|it| it.key == key) {
            return Ok(known.result(&cx.heap));
        }
        let tracker = Tracker::new(self.realm(&cx.heap), info, None, key.clone());
        self.set_traversals(self.traversals().with(&cx.heap, tracker));
        if !host::traverse_to(cx, self, self.window(), &key) {
            history.traverse(
                cx,
                index_in(Some(history), Some(&entry)) - history.index.get() as i32,
            );
        }
        Ok(tracker.result(&cx.heap))
    }

    fn traverse_to_entry<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        entry: Option<Entry>,
        options: &NavigationOptions<'a>,
    ) -> Result<'a, JSValue> {
        let result = self.try_traversal(cx, entry, options.info);
        self.or_early_error(cx, result)
    }

    pub(crate) fn entries<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, JSValue> {
        let entries = if self.is_disabled() {
            Vec::new()
        } else {
            self.history().up_to_date().entries.borrow().clone()
        };
        Ok(self
            .realm(&cx.heap)
            .create_array(entries, |heap, it| {
                Ok(JsLocal::new(heap, self.history().wrap(heap, &it).to_js()))
            })?
            .to_js())
    }

    pub(crate) fn get_current_entry<'a>(
        &'a self,
        cx: &mut Cx<'a>,
    ) -> Option<&'a NavigationHistoryEntry> {
        (!self.is_disabled()).then(|| self.history().wrap(&cx.heap, &self.history().current()))
    }

    pub(crate) fn update_current_entry<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: &NavigationUpdateCurrentEntryOptions<'a>,
    ) -> Result<'a> {
        if options.state.is_undefined() {
            return Err(cx
                .heap
                .type_error(format_args!("Required member state is undefined.")));
        }
        if self.is_disabled() {
            return Err(invalid_state(&cx.heap, "There is no current entry."));
        }
        let (entry, state) = (self.history().current(), serialize(cx, options.state)?);
        entry.borrow_mut().navigation_state = Some(state);
        self.history().save(&entry, HistoryChange::Update);
        self.committed(cx, &entry, None, &[]);
        Ok(())
    }

    pub(crate) fn get_activation<'a>(
        &'a self,
        cx: &mut Cx<'a>,
    ) -> Option<&'a NavigationActivation> {
        if self.is_disabled() {
            return None;
        }
        if self.activation().is_none() {
            let (history, known) = (
                self.history(),
                self.window().host().activation().unwrap_or_default(),
            );
            let (from, entry) = (
                known.from.map(|it| history.known_as(it)),
                known
                    .entry
                    .map_or_else(|| history.current(), |it| history.known_as(it)),
            );
            let kind = match &*known.kind {
                "replace" => NavigationType::Replace,
                "reload" => NavigationType::Reload,
                "traverse" => NavigationType::Traverse,
                _ => NavigationType::Push,
            };
            self.set_activation(Some(NavigationActivation::new(
                &cx.heap, history, from, &entry, kind,
            )));
        }
        self.activation()
    }

    pub(crate) fn get_can_go_back<'a>(&'a self, _: &mut Cx<'a>) -> bool {
        !self.is_disabled() && self.history().at_offset(-1).is_some()
    }

    pub(crate) fn get_can_go_forward<'a>(&'a self, _: &mut Cx<'a>) -> bool {
        !self.is_disabled() && self.history().at_offset(1).is_some()
    }

    fn try_navigation<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        given: &DomString,
        options: &NavigationNavigateOptions<'a>,
    ) -> Result<'a, JSValue> {
        let Some(url) = crate::api::core::url::Url::parse(
            &cx.heap,
            given,
            Some(&self.window().document().base_url()),
        ) else {
            return Err(self.realm(&cx.heap).dom_exception(
                DomError::SyntaxError,
                format_args!("Invalid URL '{}'.", given.to_utf8()),
            ));
        };
        let (url, push, replace) = (
            url.href().to_utf8(),
            options.history == NavigationHistoryBehavior::Push,
            options.history == NavigationHistoryBehavior::Replace,
        );
        if url.starts_with("javascript:") || push && self.window().host().is_initial() {
            return Err(dom_error(
                self.realm(&cx.heap),
                DomError::NotSupportedError,
                "This navigation is not supported.",
            ));
        }
        let state = Some(serialize(cx, options.state)?);
        self.track(cx, options.info, state.clone(), &|cx, history| {
            history.navigate(
                cx,
                &url,
                Options {
                    replace,
                    push,
                    source: Source::Script,
                    navigation_state: state.clone(),
                    ..Default::default()
                },
                "",
            );
        })
    }

    pub(crate) fn navigate<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        url: &DomString,
        options: &NavigationNavigateOptions<'a>,
    ) -> Result<'a, JSValue> {
        let result = self.try_navigation(cx, url, options);
        self.or_early_error(cx, result)
    }

    pub(crate) fn reload<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: &NavigationReloadOptions<'a>,
    ) -> Result<'a, JSValue> {
        let state = (!options.state.is_undefined())
            .then(|| serialize(cx, options.state))
            .transpose();
        let result = state.and_then(|state| {
            self.track(cx, options.info, state.clone(), &|cx, history| {
                history.reload(cx, state.clone())
            })
        });
        self.or_early_error(cx, result)
    }

    pub(crate) fn traverse_to<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        key: &[u8],
        options: &NavigationOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.traverse_to_entry(
            cx,
            self.history().find(&|it| it.key.as_bytes() == key),
            options,
        )
    }

    pub(crate) fn back<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: &NavigationOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.traverse_to_entry(cx, self.history().at_offset(-1), options)
    }

    pub(crate) fn forward<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: &NavigationOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.traverse_to_entry(cx, self.history().at_offset(1), options)
    }
}
