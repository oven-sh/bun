//! <https://html.spec.whatwg.org/#update-the-rendering>

use bun_jsc::{JsResult, Strong};
use bun_ui::later::{self, Timer};
use bun_ui::protocol::{Command, SurfaceCommand};
use bun_web::tasks::{self, Canvas, Priority, TaskId, Work};

use super::callbacks::{FramePhase, list};
use super::*;
use crate::api::events::{ErrorEvent, EventFlags, EventInit, dispatch, fire, is_listened_to, now};
use crate::api::performance;
use crate::api::transition::{self, PageRevealEvent};
use crate::api::ui::refs::Refs;
use crate::api::ui::{Ui, entry as ui};
use crate::api::{animation, cssom, fonts, frames, highlight, images, observers};
use crate::document::{Document, Request};

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    pub(crate) struct Is: u16 {
        const VISIBLE = 1;
        const RENDERING = 1 << 1;
        const PAINTED = 1 << 2;
        const DRAWN = 1 << 3;
        const REVEALED = 1 << 4;
        const RESIZED = 1 << 5;
        const IN_NEW_ENVIRONMENT = 1 << 6;
        const WITH_DIRTY_FRAMES = 1 << 7;
        const WANTING_ANOTHER_FRAME = 1 << 8;
        /// Its scripts have run with those of the page around it.
        const HALF_RENDERED = 1 << 9;
        const AWARE_OF_ENVIRONMENT = 1 << 10;
    }
}

/// For a window that is not drawn anywhere.
enum FrameTimer {
    KeepsProcessAlive(TaskId),
    Idle(Timer),
}

pub(super) struct Rendering {
    is: Cell<Is>,
    frame_time: Cell<f64>,
    resize_time: Cell<f64>,
    input_time: Cell<f64>,
    unpainted_since: Cell<f64>,
    early_paints_left: Cell<u8>,
    layout_version: Cell<Option<u32>>,
    background: Cell<Option<u32>>,
    preferred_size: Cell<[f32; 2]>,
    frame_timer: Cell<Option<FrameTimer>>,
    wake_timer: Cell<Option<Timer>>,
}

impl Default for Rendering {
    fn default() -> Rendering {
        Rendering {
            is: (Is::VISIBLE | Is::DRAWN).into(),
            frame_time: now().into(),
            resize_time: 0.0.into(),
            input_time: 0.0.into(),
            unpainted_since: 0.0.into(),
            early_paints_left: 0.into(),
            layout_version: None.into(),
            preferred_size: Cell::default(),
            background: None.into(),
            frame_timer: None.into(),
            wake_timer: None.into(),
        }
    }
}

impl Drop for Rendering {
    /// A timer that is pending holds the window, so the VM is going away, and with it what the timer is in.
    fn drop(&mut self) {
        let idle = if let Some(FrameTimer::Idle(it)) = self.frame_timer.take() {
            Some(it)
        } else {
            None
        };
        idle.into_iter()
            .chain(self.wake_timer.take())
            .filter(Timer::is_pending)
            .for_each(core::mem::forget);
    }
}

type Step = for<'a> fn(&'a Window, Cx<'_, 'a>);

const FRAME_INTERVAL: f64 = 16.0;
const MIN_FRAME_GAP: f64 = 3.0;
const EARLY_PAINT_AFTER: f64 = 4.0;
const EARLY_PAINT_UNTIL: f64 = 500.0;
const DARK_CANVAS: u32 = 0x1212_12ff;
const WHITE: u32 = 0xffff_ffff;

static CANVAS: Canvas = Canvas {
    is_awaited: |window| {
        // SAFETY: what `schedule` has passed.
        unsafe { Window::from_js_unchecked(window) }.is_frame_awaited()
    },
    render: |global, window, may_wait| {
        events::from_event_loop::<Window>(global, window, |cx, window| {
            let has_run_any = window.run_early_frame_callbacks(cx, now() - window.time_origin());
            if !window.is_scheduled() {
                return;
            }
            // What they have left to a task probably belongs in the frame.
            match may_wait && has_run_any && tasks::has_ready_tasks(global) {
                true => window.schedule(cx, true),
                false => bun_ui::queue::send_together(|| window.update_rendering(cx)),
            }
        });
    },
    ask_display: |window| {
        // SAFETY: as above.
        let window = unsafe { Window::from_js_unchecked(window) };
        if window.is_scheduled() {
            bun_ui::queue::request_frame(window.surface());
        }
    },
};

pub(super) fn display_wants_frame(global: &JSGlobalObject, window: JSValue) {
    events::from_event_loop::<Window>(global, window, |cx, window| {
        window.in_own_realm(&cx.heap, |cx, window| {
            window.display_wants_frame(cx, false);
            if !window.is_scheduled() {
                performance::present_events(&cx.heap, window.document());
            }
        });
    });
}

fn send_events_of_last_frame(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<Window>(global, window[0], |cx, window| {
        if !window.is_scheduled() && !window.is_disposed() {
            animation::dispatch_events(cx, window.document());
        }
    });
    Ok(())
}

fn render_on_time(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<Window>(global, window[0], |cx, window| window.update_rendering(cx));
    Ok(())
}

fn run_before_frame(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<Window>(global, window[0], |cx, window| window.run_before_frame(cx));
    Ok(())
}

fn fire_visibility_change(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<Window>(global, window[0], |cx, window| {
        _ = fire(
            cx,
            window.document(),
            atom!("visibilitychange"),
            EventInit {
                bubbles: true,
                ..EventInit::default()
            },
        )
    });
    Ok(())
}

/// What style sheets have asked for.
pub(crate) fn take_requests<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    if !doc.has_page() || !doc.synced_engine(cx, |engine, _| engine.has_new_requests()) {
        return;
    }
    fonts::load_requested_fonts(cx, doc);
    for request in doc.engine(|engine, _| engine.take_requests()) {
        match request {
            Request::Image(url) => images::load_for_style(cx, doc, &url),
            Request::Svg(url) => _ = images::load_external_svg(cx, doc, &url),
            Request::Release(image) => drop(crate::api::canvas::Owned::adopt(image)),
            Request::Font(_) => {}
        }
    }
}

impl Window {
    #[inline]
    pub(crate) fn is(&self, any_of: Is) -> bool {
        self.rendering.is.get().intersects(any_of)
    }

    pub(crate) fn shows(doc: &Doc) -> bool {
        doc.window()
            .and_then(|it| it.downcast::<Window>())
            .is_some_and(|it| it.is(Is::VISIBLE))
    }

    pub(crate) fn toggle(&self, flags: Is, on: bool) {
        self.rendering
            .is
            .update(|it| if on { it | flags } else { it - flags });
    }

    fn take(&self, flag: Is) -> bool {
        let was = self.is(flag);
        self.toggle(flag, false);
        was
    }

    fn is_scheduled(&self) -> bool {
        self.document().arena().is_scheduled.get()
    }

    fn is_in_container(&self) -> bool {
        self.document().is(DocFlags::IN_FRAME)
    }

    fn post<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        steps: fn(&JSGlobalObject, u64, &[JSValue]) -> JsResult<()>,
    ) {
        tasks::post(
            global_of(self.realm(heap)),
            Priority::Visible,
            Work::Function(steps, 0),
            &[self.to_js()],
        );
    }

    fn after<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        delay: f64,
        steps: for<'b> fn(Cx<'_, 'b>, &'b Window),
    ) -> Timer {
        let window = Strong::create(self.to_js(), global_of(heap));
        later::after(delay, move |global| {
            events::from_event_loop::<Window>(global, window.get(), steps);
            Ok(())
        })
    }

    fn stop_frame_timer(&self, heap: &JsHeap<'_>) {
        if let Some(FrameTimer::KeepsProcessAlive(task)) = self.rendering.frame_timer.take() {
            tasks::cancel(global_of(heap), task);
        }
    }

    fn start_frame_timer<'a>(&'a self, heap: &JsHeap<'a>, keeps_process_alive: bool) {
        let timer =
            self.rendering
                .frame_timer
                .take()
                .unwrap_or_else(|| match keeps_process_alive {
                    true => FrameTimer::KeepsProcessAlive(tasks::post_delayed(
                        global_of(self.realm(heap)),
                        FRAME_INTERVAL,
                        false,
                        Work::Function(render_on_time, 0),
                        &[self.to_js()],
                    )),
                    false => FrameTimer::Idle(self.after(heap, FRAME_INTERVAL, |cx, window| {
                        window.update_rendering(cx)
                    })),
                });
        self.rendering.frame_timer.set(Some(timer));
    }

    pub(super) fn keep_frame_timer_alive<'a>(&'a self, heap: &JsHeap<'a>) {
        match self.rendering.frame_timer.take() {
            Some(FrameTimer::Idle(_)) => self.start_frame_timer(heap, true),
            other => self.rendering.frame_timer.set(other),
        }
    }

    pub(crate) fn schedule<'a>(&'a self, cx: Cx<'_, 'a>, keeps_process_alive: bool) {
        if self.is_disposed() || !self.is(Is::DRAWN) && self.is(Is::PAINTED) {
            return;
        }
        if self.is_in_container() {
            Ui::of(self.document())
                .and_then(Ui::container)
                .into_iter()
                .for_each(|it| it.schedule(cx));
        } else if self.surface() != 0 {
            if !tasks::is_between_frames(cx.global()) {
                bun_ui::queue::request_frame(self.surface());
            }
            tasks::wants_frame(cx.global(), self.to_js(), &CANVAS);
        } else {
            self.start_frame_timer(&cx.heap, keeps_process_alive);
        }
    }

    /// They are no reason to render.
    pub(super) fn schedule_early_callbacks<'a>(&'a self, cx: Cx<'_, 'a>) {
        match self.surface() != 0
            && !self.is_in_container()
            && self.is(Is::DRAWN)
            && self.is(Is::PAINTED)
        {
            true => tasks::wants_frame(cx.global(), self.to_js(), &CANVAS),
            false => self.document().invalidate(cx),
        }
    }

    pub(super) fn frame_callback_was_canceled(&self, heap: &JsHeap<'_>) {
        if !self.is_scheduled() && !self.has_frame_callbacks() {
            tasks::wants_no_frame(global_of(heap), self.to_js());
        }
    }

    pub(crate) fn stop_rendering(&self, heap: &JsHeap<'_>) {
        self.stop_frame_timer(heap);
        self.rendering.wake_timer.take();
        tasks::wants_no_frame(global_of(heap), self.to_js());
    }

    /// The next frame takes everything to have moved.
    pub(crate) fn forget_layout(&self) {
        self.rendering.layout_version.set(None);
    }

    pub(crate) fn attach<'a>(&'a self, cx: Cx<'_, 'a>, surface: u32, is_composited: bool) {
        self.stop_frame_timer(&cx.heap);
        self.document().arena().is_scheduled.set(false);
        self.toggle(Is::PAINTED, false);
        self.document().engine(|engine, _| {
            engine.fonts_changed();
            if is_composited {
                engine.set_composited(true);
            }
        });
        self.set_surface(surface);
        Ui::of(self.document())
            .into_iter()
            .for_each(|it| ui::note_technology(cx, it, true));
        if let Some(it) = bun_ui::loaded().and_then(|ui| (ui.surface_metrics)(surface).get().ok()) {
            self.resize(
                cx,
                [it.bounds.width, it.bounds.height].map(f64::from),
                it.scale.into(),
            );
        }
    }

    /// Whether the next frame has a new size to report.
    pub(crate) fn resize<'a>(&'a self, cx: Cx<'_, 'a>, size: [f64; 2], scale: f64) -> bool {
        let old = (self.viewport_size(), self.scale());
        self.resize_surface(size, scale);
        self.environment_changed(cx);
        if old != (self.viewport_size(), self.scale()) {
            self.toggle(Is::RESIZED, true);
        }
        self.is(Is::RESIZED)
    }

    pub(crate) fn environment_changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        let (doc, old_zoom) = (self.document(), self.zoom());
        self.read_environment(container::from_container(cx, self));
        self.toggle(
            if old_zoom == self.zoom() {
                Is::IN_NEW_ENVIRONMENT
            } else {
                Is::IN_NEW_ENVIRONMENT | Is::RESIZED
            },
            true,
        );
        let [is_visible, is_drawn] = [self.environment().is_visible, self.environment().is_drawn];
        if self.is(Is::DRAWN) != is_drawn {
            self.toggle(Is::DRAWN, is_drawn);
            self.forget_layout();
            observers::observe_again(&cx.heap, doc);
            doc.arena().is_scheduled.set(false);
            if !is_drawn {
                transition::skip_view_transitions(cx, doc);
            }
        }
        if self.is(Is::VISIBLE) != is_visible {
            self.toggle(Is::VISIBLE, is_visible);
            if self.is(Is::AWARE_OF_ENVIRONMENT) {
                performance::reached(
                    &cx.heap,
                    self.document(),
                    if is_visible { b"visible" } else { b"hidden" },
                    now(),
                );
                self.post(&cx.heap, fire_visibility_change);
            }
        }
        self.toggle(Is::AWARE_OF_ENVIRONMENT, true);
        doc.invalidate(cx);
    }

    /// A task that the next frame does not overtake.
    pub(crate) fn queue_before_frame<'a>(&'a self, heap: &JsHeap<'a>, task: JSValue) {
        let all = list(heap, js_DomWindow::before_frame(self), |it| {
            js_DomWindow::set_before_frame(self, it)
        });
        all.push(heap, task);
        if all.len() == 1 {
            self.post(heap, run_before_frame);
        }
    }

    fn run_before_frame<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(all) = js_DomWindow::before_frame(self).map(List::from_value) else {
            return;
        };
        js_DomWindow::set_before_frame(self, JSValue::ZERO);
        for task in all.values() {
            if let Err(error) = task.call(cx.global(), JSValue::UNDEFINED, &[]) {
                events::report(cx, Some(self), error);
            }
        }
    }

    pub(crate) fn display_wants_frame<'a>(&'a self, cx: Cx<'_, 'a>, is_urgent: bool) {
        if !self.is_scheduled() {
            return;
        }
        match !is_urgent
            && (self.has_just_rendered()
                || self.has_rendered_for_size()
                || tasks::can_frame_wait(cx.global()))
        {
            true => bun_ui::queue::request_frame(self.surface()),
            false => self.update_rendering(cx),
        }
    }

    /// Not every frame is for the display, whose next one may follow at once.
    fn has_just_rendered(&self) -> bool {
        self.is(Is::PAINTED) && now() - self.rendering.frame_time.get() < MIN_FRAME_GAP
    }

    fn is_frame_awaited(&self) -> bool {
        self.has_awaited_frame_callbacks()
            || self.document().needs_sync()
            || self.document().engine(|engine, _| engine.needs_painting())
    }

    fn only_animates(&self) -> bool {
        let animates =
            self.has_frame_callbacks() || self.document().engine(|engine, _| engine.is_animating());
        animates
            && !self.is(Is::RESIZED)
            && !self.is(Is::IN_NEW_ENVIRONMENT)
            && !self.is(Is::WITH_DIRTY_FRAMES)
            && !self.is_frame_awaited()
    }

    /// While the window is being resized, the frame for each size is the one that the display shows.
    fn has_rendered_for_size(&self) -> bool {
        now() - self.rendering.resize_time.get() < bun_ui::queue::frame_interval() - MIN_FRAME_GAP
            && self.only_animates()
    }

    /// What an event has changed does not wait for the display.
    pub(crate) fn render_now<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.is_scheduled()
            && self.surface() != 0
            && !self.is_in_container()
            && !self.only_animates()
        {
            self.update_rendering(cx);
        }
    }

    fn has_news_for_container(&self) -> bool {
        self.is_scheduled() || self.is(Is::WITH_DIRTY_FRAMES)
    }

    /// When the page around it is about to be painted.
    pub(crate) fn render_in_container<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.in_own_realm(&cx.heap, |cx, window| {
            if window.take(Is::HALF_RENDERED) {
                window.finish_frame(cx);
            } else if window.has_news_for_container() {
                window.update_rendering(cx);
            }
        });
    }

    fn in_own_realm<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Window),
    ) {
        events::from_event_loop::<Window>(global_of(self.realm(heap)), self.to_js(), steps);
    }

    /// What it turns out to need delays the `load` event.
    pub(crate) fn render_before_load<'a>(&'a self, cx: Cx<'_, 'a>) {
        match self.has_just_rendered() {
            true => {
                _ = self
                    .document()
                    .synced_engine(cx, |engine, _| engine.update_layout_for_frame())
            }
            false => self.update_rendering(cx),
        }
        take_requests(cx, self.document());
    }

    pub(crate) fn got_input(&self) {
        let it = &self.rendering;
        [&it.input_time, &it.unpainted_since]
            .iter()
            .for_each(|it| it.set(now()));
        it.early_paints_left.set(2);
    }

    /// For a script that takes long to answer input: shows what it has so far, unless an observer has yet to hear of a new size.
    pub(crate) fn paint_now<'a>(&'a self, cx: Cx<'_, 'a>, delivers_resizes: bool) {
        let (it, doc, time) = (&self.rendering, self.document(), now());
        let is_worth_it = it.early_paints_left.get() > 0
            && time - it.unpainted_since.get() >= EARLY_PAINT_AFTER
            && time - it.input_time.get() <= EARLY_PAINT_UNTIL;
        let is_possible = self.is(Is::PAINTED)
            && !self.is(Is::RENDERING | Is::RESIZED)
            && self.surface() != 0
            && !self.is_in_container()
            && !self.is_disposed();
        if !(is_worth_it && is_possible && self.is_scheduled())
            || transition::has_view_transitions(doc)
        {
            return;
        }
        doc.synced_engine(cx, |engine, _| {
            engine.set_time(time - self.time_origin());
            engine.update_layout_for_frame()
        });
        if delivers_resizes {
            observers::deliver_resizes(cx, doc, false);
        } else if observers::has_resized_boxes(&cx.heap, doc) {
            return;
        }
        it.early_paints_left.update(|it| it.saturating_sub(1));
        _ = highlight::flush_highlights(cx, doc);
        Ui::of(doc)
            .into_iter()
            .for_each(|it| ui::show_selection(cx, it));
        self.paint(doc);
    }

    fn paint(&self, doc: &Doc) {
        doc.engine(|engine, _| doc.arena().paint(engine, self.surface()));
        self.rendering.unpainted_since.set(now());
    }

    pub(crate) fn canvas_color(&self) -> u32 {
        if self.environment().is_transparent {
            0
        } else {
            self.rendering
                .background
                .get()
                .filter(|it| *it != 0)
                .unwrap_or(WHITE)
        }
    }

    fn update_background<'a>(&'a self, cx: Cx<'_, 'a>, doc: &'a Doc) {
        let Some(root) = doc
            .document_element()
            .filter(|_| self.is_in_container() || !self.environment().is_transparent)
        else {
            return;
        };
        let is_dark = root.engine(|engine, id| {
            engine.update_style();
            engine
                .tree
                .style(id)
                .is_some_and(|it| it.dark && it.display() != crate::types::Display::None)
        });
        let background = match self.is_in_container() {
            true if is_dark == container::from_container(cx, self).looks_dark => 0,
            _ if self.environment().forces_colors => crate::color::forced(b"canvas", is_dark),
            _ if is_dark => DARK_CANVAS,
            true => WHITE,
            false => 0,
        };
        if self.rendering.background.replace(Some(background)) != Some(background) {
            bun_ui::loaded().into_iter().for_each(|ui| {
                (ui.tell)(Command::Surface {
                    id: self.surface(),
                    command: SurfaceCommand::Canvas(background),
                })
            });
        }
    }

    /// <https://html.spec.whatwg.org/#reveal>
    fn reveal<'a>(&'a self, cx: Cx<'_, 'a>, doc: &'a Doc) {
        self.toggle(Is::REVEALED, true);
        let transition = Some(self.host().inbound_transition())
            .filter(|it| *it != 0)
            .and_then(|it| transition::start_inbound_transition(cx, doc, it).ok()?);
        if self.has_listeners(atom!("pagereveal")) {
            let event = PageRevealEvent::new(self.realm(&cx.heap), transition);
            dispatch(cx, self, event);
        }
        if let Some(transition) = transition {
            transition::activate_transition(cx, transition);
            events::microtask_checkpoint(cx);
        }
    }

    fn update_rendering<'a>(&'a self, cx: Cx<'_, 'a>) {
        let time = now();
        if !self.begin_frame(cx, time) {
            return;
        }
        let inside = Ui::of(self.document())
            .filter(|_| self.surface() != 0 && self.is(Is::WITH_DIRTY_FRAMES));
        let inside = Refs::collect(
            &cx.heap,
            inside
                .map(|it| frames::below(&cx.heap, it))
                .unwrap_or_default()
                .iter()
                .filter_map(|it| Window::of(it.doc())),
        );
        for frame in inside.iter().filter(|it| it.has_news_for_container()) {
            frame.in_own_realm(&cx.heap, |cx, frame| {
                frame.toggle(Is::HALF_RENDERED, frame.begin_frame(cx, time))
            });
        }
        let steps: [Step; 4] = [
            Window::report_resizes,
            Window::report_environment,
            Window::send_events,
            Window::run_callbacks,
        ];
        for step in steps {
            step(self, cx);
            inside
                .iter()
                .filter(|it| it.is(Is::HALF_RENDERED))
                .for_each(|it| it.in_own_realm(&cx.heap, |cx, frame| step(frame, cx)));
        }
        self.finish_frame(cx);
        inside
            .iter()
            .filter(|it| it.is(Is::HALF_RENDERED))
            .for_each(|it| it.render_in_container(cx));
    }

    fn begin_frame<'a>(&'a self, cx: Cx<'_, 'a>, time: f64) -> bool {
        if !self.is(Is::RENDERING) {
            observers::notify_intersection_observers(cx, self.document());
        }
        let doc = self.document();
        self.stop_frame_timer(&cx.heap);
        if self.is(Is::RENDERING) || self.is_disposed() {
            return false;
        }
        if transition::suppresses_rendering(doc)
            || !self.is(Is::PAINTED) && crate::api::loading::is_render_blocked(cx, doc)
        {
            doc.arena().is_scheduled.set(false);
            return false;
        }
        self.rendering.frame_time.set(time);
        tasks::begins_frame(cx.global(), self.to_js());
        doc.arena().is_scheduled.set(true);
        self.toggle(Is::RENDERING, true);
        animation::set_rendering(&cx.heap, doc, true);
        doc.synced_engine(cx, |engine, _| engine.set_time(time - self.time_origin()));
        if !self.is(Is::REVEALED) && doc.document_element().is_some() {
            self.reveal(cx, doc);
        }
        true
    }

    fn report_resizes<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.run_frame_callbacks(
            cx,
            FramePhase::BeforeEvents,
            self.rendering.frame_time.get() - self.time_origin(),
        );
        let Some(ui) = Ui::of(self.document()) else {
            return;
        };
        ui::flush_autofocus(cx, ui);
        if self.take(Is::RESIZED) {
            self.rendering
                .resize_time
                .set(self.rendering.frame_time.get());
            ui::window_resized(cx, ui);
            fire(cx, self, atom!("resize"), EventInit::default());
            js_DomWindow::visual_viewport(self)
                .into_iter()
                .for_each(|it| _ = fire(cx, it, atom!("resize"), EventInit::default()));
        }
        self.run_before_frame(cx);
        let goes_on = ui::autoscroll(cx, ui);
        self.toggle(Is::WANTING_ANOTHER_FRAME, goes_on);
    }

    fn report_environment<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.take(Is::IN_NEW_ENVIRONMENT) {
            images::reselect_images(cx, self.document());
            cssom::report_media_queries(cx, self.document());
        }
    }

    fn send_events<'a>(&'a self, cx: Cx<'_, 'a>) {
        animation::dispatch_events(cx, self.document());
        Ui::of(self.document())
            .into_iter()
            .for_each(|it| ui::fire_fullscreen_events(cx, it));
    }

    fn run_callbacks<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.run_frame_callbacks(
            cx,
            FramePhase::AfterEvents,
            self.rendering.frame_time.get() - self.time_origin(),
        );
    }

    fn finish_frame<'a>(&'a self, cx: Cx<'_, 'a>) {
        let doc = self.document();
        Ui::of(doc)
            .into_iter()
            .for_each(|it| self.lay_out_and_paint(cx, doc, it));
        self.toggle(Is::RENDERING, false);
        animation::set_rendering(&cx.heap, doc, false);
    }

    fn lay_out_and_paint<'a>(&'a self, cx: Cx<'_, 'a>, doc: &'a Doc, ui: &'a Ui) {
        let (it, mut needs_another) = (&self.rendering, self.take(Is::WANTING_ANOTHER_FRAME));
        doc.synced_engine(cx, |engine, _| engine.update_layout_for_frame());
        if observers::deliver_resizes(cx, doc, true) {
            needs_another = true;
            let event = ErrorEvent::trusted(
                self.realm(&cx.heap),
                atom!("error"),
                "ResizeObserver loop completed with undelivered notifications.".into(),
                JSValue::UNDEFINED,
            );
            event.set(EventFlags::CANCELABLE);
            dispatch(cx, self, event);
        }
        ui::fix_up_focus(cx, ui);
        take_requests(cx, doc);
        let version = Some(doc.synced_engine(cx, |engine, _| engine.update_layout_for_frame()));
        let has_moved = it.layout_version.replace(version) != version;
        needs_another |= observers::update_intersections(cx, doc, has_moved);
        if self.viewport_size()[0] > 0.0 {
            images::load_lazy_images(cx, doc);
        }
        if has_moved {
            images::reselect_auto_sized_images(cx, doc);
            frames::plugins::update_rendered(cx, ui);
        }
        if self.surface() != 0 && !self.is_disposed() {
            if has_moved {
                frames::place_all(cx, ui);
            }
            if self.take(Is::WITH_DIRTY_FRAMES) {
                frames::render_all(cx, ui);
            }
        }
        if self.is_disposed() {
            return;
        }
        if self.surface() != 0 {
            _ = highlight::flush_highlights(cx, doc);
            ui::show_selection(cx, ui);
            self.update_background(cx, doc);
            if transition::has_view_transitions(doc) {
                transition::perform_view_transitions(cx, doc, self.canvas_color());
                needs_another = true;
            }
            self.paint(doc);
            take_requests(cx, doc);
            if self.is_in_container() {
                self.host().painted_in_frame(self.surface_scale());
            } else if self.environment().reports_paints {
                self.host().painted();
            }
            if doc.is(DocFlags::IS_ACCESSIBLE) {
                ui::update_accessibility_soon(cx, ui);
            }
        }
        if doc.arena().is_broken() {
            return self.host().crashed();
        }
        animation::take_events(cx, doc);
        self.schedule_what_follows(cx, doc, needs_another);
        if !self.is(Is::PAINTED) && doc.body().is_some() {
            self.toggle(Is::PAINTED, true);
            performance::reached(&cx.heap, doc, b"first-paint", now());
            crate::api::core::metadata::tell_theme_color(doc);
            self.host().first_paint();
        }
        if has_moved && self.environment().reports_preferred_size {
            let size = doc.synced_engine(cx, |engine, _| engine.preferred_size());
            if it.preferred_size.replace(size) != size {
                self.host()
                    .preferred_size_changed(size[0].into(), size[1].into());
            }
        }
        if self.is(Is::PAINTED) {
            performance::report_paint(&cx.heap, doc, has_moved);
        }
        ui::after_paint(cx, ui, has_moved);
    }

    fn schedule_what_follows<'a>(&'a self, cx: Cx<'_, 'a>, doc: &'a Doc, needs_another: bool) {
        let mut has_work = needs_another
            || [Is::WITH_DIRTY_FRAMES, Is::RESIZED, Is::IN_NEW_ENVIRONMENT]
                .into_iter()
                .any(|it| self.is(it))
            || self.has_callbacks_of(FramePhase::AfterEvents);
        let moves = doc.engine(|engine, _| {
            engine.scrolling.time_scrollbars(engine.animations.now);
            engine.needs_painting() || engine.is_animating() || engine.scrolling.is_animating()
        });
        if animation::has_queued_events(&cx.heap, doc) {
            // A frame would consist of nothing else.
            match has_work
                || moves
                || self.surface() == 0
                || self.is_in_container()
                || animation::has_events_for_frame(&cx.heap, doc)
            {
                true => has_work = true,
                false => self.post(&cx.heap, send_events_of_last_frame),
            }
        }
        let goes_on = has_work || moves;
        doc.arena().is_scheduled.set(goes_on);
        self.rendering.wake_timer.take();
        if goes_on {
            return self.schedule(cx, has_work);
        }
        if self.has_frame_callbacks() {
            self.schedule_early_callbacks(cx);
        }
        let delay = doc
            .engine(|engine: &mut Document, _| {
                Some(engine.next_wake(is_listened_to(atom!("animationiteration"))))
            })
            .filter(|it| it.is_finite());
        self.rendering.wake_timer.set(delay.map(|it| {
            self.after(&cx.heap, it + 1.0, |cx, window| {
                window.document().invalidate(cx)
            })
        }));
    }
}
