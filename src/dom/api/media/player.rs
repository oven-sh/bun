//! The state of a media element, and its copy in the engine.

use std::time::Instant;

use bun_core::strings;
use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{JsResult, Strong};

use super::tracks::home_of;
use super::*;
use crate::abi::Rect;
use crate::abi_graphics::Decoded;
use crate::api::audio::AudioNode;
use crate::api::canvas::{Owned, decode};
use crate::api::core::{DomString, Edge, Element, Known, Node};
use crate::api::images::{self, Destination, Resource, Used};
use crate::api::interim::{allow_load, delay_load, in_realm_of};
use crate::api::ui::assistive;
use crate::tree::Replaced;

#[derive(Clone, Copy, PartialEq)]
#[repr(u16)]
pub(super) enum Network {
    Empty,
    Idle,
    Loading,
    NoSource,
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Selection {
    Selecting,
    /// Until it is near the viewport.
    Deferred,
    Selected,
    /// For another `source`.
    Waiting,
}

#[derive(Clone, Copy, PartialEq)]
enum Transfer {
    NotStarted,
    WaitingForTracks,
    Fetching,
    Done,
}

/// What follows once a picture is shown.
#[derive(Clone, Copy)]
enum AfterPicture {
    FireHeldEvents,
    Repaint { is_last: bool },
}

pub(super) const SRC_NOT_SUPPORTED: u16 = 4;

pub(crate) struct Player {
    remote: Remote,
    pub(super) volume: Cell<f64>,
    pub(super) playback_rate: Cell<f64>,
    pub(super) default_playback_rate: Cell<f64>,
    pub(super) duration: Cell<f64>,
    /// None as long as it goes by the attribute.
    pub(super) muted: Cell<Option<bool>>,
    pub(super) can_autoplay: Cell<bool>,
    /// Buffered, played and seekable.
    pub(super) ranges: RefCell<[Rc<[[f64; 2]]>; 3]>,
    /// How many the engine was told of.
    seeks: Cell<u32>,
    pub(super) preserves_pitch: Cell<bool>,
    pub(super) is_paused: Cell<bool>,
    pub(super) is_seeking: Cell<bool>,
    pub(super) shows_poster: Cell<bool>,
    pub(super) selection: Cell<Selection>,
    pub(super) is_near: Cell<bool>,
    pub(super) defers_poster: Cell<bool>,
    pub(super) has_track_change: Cell<bool>,
    /// None after a jump.
    pub(super) marched_to: Cell<Option<f64>>,
    marches: Cell<u32>,
    pub(super) is_awake: Cell<bool>,
    pub(super) has_stirred: Cell<bool>,
    pub(super) is_tainted: Cell<bool>,
    pub(super) ready_state: Cell<u16>,
    pub(super) network: Cell<Network>,
    pub(super) size: Cell<[u32; 2]>,
    pub(super) current_src: RefCell<DomString>,
    pub(super) sink: RefCell<Box<[u8]>>,
    pub(super) poster: RefCell<Option<Used>>,
    /// The current one, and the one that may still be on the screen.
    frames: RefCell<[Option<Owned>; 2]>,
    presented_frames: Cell<u32>,
    pub(super) last_frame_callback: Cell<u32>,
    /// It changes when what is under way is no longer wanted.
    pub(super) serial: Cell<u32>,
    transfer: Cell<Transfer>,
    /// The position, and when that was if it advances.
    clock: Cell<(f64, Option<Instant>)>,
    /// The events that wait for the picture that goes with the first of them.
    held_events: RefCell<Vec<Known>>,
    is_repainting: Cell<bool>,
    /// The `play` event for that is still to come.
    has_autoplayed: Cell<bool>,
}

impl Mirrored for Player {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        self.remote.send(
            "element",
            &[if self.is_video() { "video" } else { "audio" }.into()],
        );
        js_MediaPlayer::route(self)
            .into_iter()
            .for_each(|it| _ = it.copy(heap));
        for (name, value) in [
            ("volume", &self.volume),
            ("defaultPlaybackRate", &self.default_playback_rate),
            ("playbackRate", &self.playback_rate),
        ] {
            self.remote.set(name, Arg::Number(value.get()));
        }
        for (name, value) in [
            ("muted", self.is_muted()),
            ("preservesPitch", self.preserves_pitch.get()),
            ("loop", self.loops()),
        ] {
            self.remote.set(name, Arg::Flag(value));
        }
        if !self.sink.borrow().is_empty() {
            self.remote
                .invoke("setSinkId", &[Arg::Text(&self.sink.borrow())]);
        }
    }

    #[optimize(size)]
    fn heard<'a>(&'a self, cx: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        const EVENTS: [Known; 14] = [
            atom!("canplay"),
            atom!("canplaythrough"),
            atom!("durationchange"),
            atom!("ended"),
            atom!("error"),
            atom!("loadeddata"),
            atom!("loadedmetadata"),
            atom!("pause"),
            atom!("playing"),
            atom!("resize"),
            atom!("seeked"),
            atom!("seeking"),
            atom!("timeupdate"),
            atom!("waiting"),
        ];
        let Some(event) = EVENTS
            .into_iter()
            .find(|it| *it == Known::from_latin1(message.kind))
        else {
            return Ok(());
        };
        match event {
            atom!("pause") if self.is_paused.replace(true) => return Ok(()),
            atom!("error") => {
                self.fail(cx, message.number(3) as u16);
                return Ok(());
            }
            _ => {}
        }
        if message.number(2) == 4.0 && self.is_paused.get() && self.autoplays() {
            self.has_autoplayed.set(true);
            [&self.can_autoplay, &self.is_paused, &self.shows_poster]
                .into_iter()
                .for_each(|it| it.set(false));
            self.set_busy(&cx.heap, true);
        }
        if message.number(8) == f64::from(self.seeks.get()) {
            const JITTER: f64 = 0.05;
            let advances = !self.is_paused.get()
                && message.text(6) == b"false"
                && matches!(event, atom!("playing") | atom!("timeupdate"));
            let (told, expected) = (message.number(0), self.time());
            self.clock.set((
                if (told..told + JITTER).contains(&expected) {
                    expected
                } else {
                    told
                },
                advances.then(Instant::now),
            ));
            self.is_seeking.set(message.text(7) == b"true");
        }
        if event == atom!("seeking") {
            self.marched_to.take();
        }
        self.duration.set(message.number(1));
        self.ready_state.set(message.number(2) as u16);
        self.ranges
            .replace([9, 10, 11].map(|at| message.numbers(at).as_chunks().0.into()));
        let size = [message.number(4) as u32, message.number(5) as u32];
        if self.size.replace(size) != size {
            self.show(cx);
        }
        if self.is_paused.get() && !self.autoplays() {
            self.set_busy(&cx.heap, false);
        }
        assistive::facts_changed(cx, self.element());
        let has_picture = self.size.get()[0] > 0;
        if has_picture && matches!(event, atom!("playing") | atom!("pause")) {
            self.repaint(cx);
        }
        if !self.held_events.borrow().is_empty() {
            self.held_events.borrow_mut().push(event);
        } else if has_picture && matches!(event, atom!("loadeddata") | atom!("seeked")) {
            self.held_events.borrow_mut().push(event);
            self.request_picture(cx, AfterPicture::FireHeldEvents);
        } else {
            self.emit(cx, event);
        }
        Ok(())
    }

    #[optimize(size)]
    fn lost<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let was_loading = self.transfer.replace(Transfer::NotStarted) != Transfer::NotStarted
            && self.ready_state.get() == 0;
        self.seeks.take();
        self.held_events.take();
        self.is_repainting.set(false);
        if was_loading {
            self.fail(cx, SRC_NOT_SUPPORTED);
        } else if !self.is_paused.replace(true) {
            self.clock.set((self.time(), None));
            self.emit(cx, atom!("pause"));
        }
        Ok(())
    }
}

impl Player {
    #[optimize(size)]
    pub(super) fn of_element<'a>(heap: &JsHeap<'a>, element: &'a Element) -> &'a Player {
        let player = element.same_object(heap, Edge::Player, || {
            let player = Player {
                remote: Remote::new(Link::of(heap, home_of(heap, element))),
                volume: Cell::new(1.0),
                playback_rate: Cell::new(1.0),
                default_playback_rate: Cell::new(1.0),
                duration: Cell::new(f64::NAN),
                muted: Cell::new(None),
                can_autoplay: Cell::new(true),
                ranges: RefCell::default(),
                seeks: Cell::new(0),
                preserves_pitch: Cell::new(true),
                is_paused: Cell::new(true),
                is_seeking: Cell::new(false),
                shows_poster: Cell::new(true),
                selection: Cell::new(Selection::Selecting),
                is_near: Cell::new(false),
                defers_poster: Cell::new(false),
                has_track_change: Cell::new(false),
                marched_to: Cell::new(None),
                marches: Cell::new(0),
                is_awake: Cell::new(false),
                has_stirred: Cell::new(false),
                is_tainted: Cell::new(false),
                ready_state: Cell::new(0),
                network: Cell::new(Network::Empty),
                size: Cell::default(),
                current_src: RefCell::default(),
                sink: RefCell::default(),
                poster: RefCell::default(),
                frames: RefCell::default(),
                presented_frames: Cell::new(0),
                last_frame_callback: Cell::new(0),
                serial: Cell::new(0),
                transfer: Cell::new(Transfer::NotStarted),
                clock: Cell::default(),
                held_events: RefCell::default(),
                is_repainting: Cell::new(false),
                has_autoplayed: Cell::new(false),
            };
            let player = js_MediaPlayer::create(heap, player);
            js_MediaPlayer::set_element(player, Some(element));
            player.to_js()
        });
        // SAFETY: nothing else is put on this edge.
        unsafe { Player::from_js_unchecked(player) }
    }

    pub(crate) fn of<'a>(heap: &JsHeap<'a>, element: JSValue) -> Option<&'a Player> {
        HTMLMediaElement::from_js(heap, element).map(|it| Player::of_element(heap, it))
    }

    pub(super) fn element(&self) -> &Element {
        js_MediaPlayer::element(self).expect("a player has an element")
    }

    pub(super) fn is_video(&self) -> bool {
        self.element().is_html(atom!("video"))
    }

    pub(super) fn loops(&self) -> bool {
        self.element().has_attr(atom!("loop"))
    }

    pub(super) fn autoplays(&self) -> bool {
        self.can_autoplay.get() && self.element().has_attr(atom!("autoplay"))
    }

    pub(super) fn is_muted(&self) -> bool {
        self.muted
            .get()
            .unwrap_or_else(|| self.element().has_attr(atom!("muted")))
    }

    pub(super) fn frame(&self) -> Option<u32> {
        self.frames.borrow()[0].as_ref().map(Owned::id)
    }

    pub(super) fn home<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Doc {
        home_of(heap, self.element())
    }

    /// Unless something else is loaded by then.
    pub(super) fn queue(
        &self,
        value: JSValue,
        steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Player, JSValue) + 'static,
    ) {
        let serial = self.serial.get();
        self.queue_always(value, move |cx, player, value| {
            if player.serial.get() == serial {
                steps(cx, player, value);
            }
        });
    }

    pub(super) fn queue_always(
        &self,
        value: JSValue,
        steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Player, JSValue) + 'static,
    ) {
        queue_task(
            self.element().doc(),
            &[self.to_js(), value],
            move |cx, values| {
                if let Some(player) = Player::from_js(&cx.heap, values[0]) {
                    steps(cx, player, values[1]);
                }
                Ok(())
            },
        );
    }

    pub(super) fn queue_event(&self, event: Known) {
        self.queue(JSValue::UNDEFINED, move |cx, player, _| {
            player.emit(cx, event)
        });
    }

    #[optimize(size)]
    fn emit<'a>(&'a self, cx: Cx<'_, 'a>, event: Known) {
        let serial = self.serial.get();
        if matches!(
            event,
            atom!("timeupdate") | atom!("playing") | atom!("ratechange")
        ) && !self.shows_poster.get()
        {
            self.time_marches_on(cx);
        }
        self.update_controls(cx);
        assistive::facts_changed(cx, self.element());
        fire(cx, self.element(), event, Default::default());
        match event {
            _ if self.serial.get() != serial => {}
            atom!("loadeddata") => self.set_delays_load(cx, false),
            atom!("canplaythrough") if self.has_autoplayed.take() => {
                self.time_marches_on(cx);
                self.queue_event(atom!("play"));
                if !self.is_paused.get() {
                    self.start(cx);
                }
            }
            _ => {}
        }
    }

    /// https://html.spec.whatwg.org/#delaying-the-load-event-flag
    #[optimize(size)]
    pub(super) fn set_delays_load<'a>(&'a self, cx: Cx<'_, 'a>, delays: bool) {
        match js_MediaPlayer::delayed(self) {
            None if delays => {
                js_MediaPlayer::set_delayed(self, Some(self.element().doc()));
                delay_load(cx, self.element().doc());
            }
            Some(document) if !delays => {
                js_MediaPlayer::set_delayed(self, None);
                allow_load(cx, document);
            }
            _ => {}
        }
    }

    #[optimize(size)]
    pub(super) fn march_again_at<'a>(&'a self, heap: &JsHeap<'a>, time: f64) {
        self.marches.update(|it| it.wrapping_add(1));
        let (march, seconds) = (
            self.marches.get(),
            (time - self.time()) / self.playback_rate.get(),
        );
        if self.clock.get().1.is_some() && (0.0..1.0).contains(&seconds) {
            queue_task_after(
                self.home(heap),
                (seconds * 1000.0).ceil().max(1.0),
                &[self.to_js()],
                move |cx, this| {
                    Player::from_js(&cx.heap, this[0])
                        .filter(|it| it.marches.get() == march)
                        .into_iter()
                        .for_each(|it| it.time_marches_on(cx));
                    Ok(())
                },
            );
        }
    }

    pub(super) fn restart_clock(&self) {
        self.clock
            .set((self.time(), self.clock.get().1.map(|_| Instant::now())));
    }

    pub(super) fn has_fetched_nothing(&self) -> bool {
        self.transfer.get() == Transfer::NotStarted
    }

    pub(super) fn tracks_settled<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.transfer.get() == Transfer::WaitingForTracks {
            self.transfer.set(Transfer::NotStarted);
            self.fetch(cx);
        }
    }

    pub(super) fn suspend<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.network.set(Network::Idle);
        fire(cx, self.element(), atom!("suspend"), Default::default());
    }

    #[optimize(size)]
    pub(crate) fn route_to<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        node: &'a AudioNode,
    ) -> core::result::Result<(), Failure> {
        if js_MediaPlayer::route(self).is_some() {
            return Err(Failure::invalid_state(
                "The element is already connected to a node.",
            ));
        }
        js_MediaPlayer::set_route(self, Some(node));
        node.set_tainted(self.is_tainted.get());
        if self.remote.is_copied() {
            node.copy(heap);
        }
        Ok(())
    }

    fn set_tainted(&self, is_tainted: bool) {
        self.is_tainted.set(is_tainted);
        js_MediaPlayer::route(self)
            .into_iter()
            .for_each(|it| it.set_tainted(is_tainted));
    }

    pub(super) fn time(&self) -> f64 {
        let (base, since) = self.clock.get();
        (base
            + since.map_or(0.0, |it| {
                it.elapsed().as_secs_f64() * self.playback_rate.get()
            }))
        .min(self.duration.get())
    }

    #[optimize(size)]
    pub(super) fn seek(&self, time: f64) {
        self.clock.set((time.max(0.0), None));
        self.marched_to.take();
        if self.remote.is_copied() {
            self.is_seeking.set(self.ready_state.get() > 0);
            self.seeks.update(|it| it + 1);
            self.remote.send("seek", &[Arg::Number(time)]);
        }
    }

    pub(super) fn unload<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.serial.set(self.serial.get().wrapping_add(1));
        self.discard_copy(&cx.heap);
        self.size.take();
        self.frames.take();
    }

    #[optimize(size)]
    fn discard_copy(&self, heap: &JsHeap<'_>) {
        js_MediaPlayer::route(self)
            .into_iter()
            .for_each(|it| it.drop_copy(heap));
        self.drop_copy(heap);
        self.set_tainted(false);
        self.transfer.set(Transfer::NotStarted);
        self.clock.take();
        self.ranges.take();
        self.seeks.take();
        self.held_events.take();
        self.is_repainting.set(false);
        self.has_autoplayed.set(false);
    }

    #[optimize(size)]
    pub(super) fn fetch<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.transfer.get() != Transfer::NotStarted {
            return;
        }
        if !self.are_tracks_ready() {
            return self.transfer.set(Transfer::WaitingForTracks);
        }
        if let Some(stream) = js_MediaPlayer::src_object(self) {
            self.transfer.set(Transfer::Done);
            return self
                .copy(&cx.heap)
                .set("srcObject", stream.copy(&cx.heap).object());
        }
        self.transfer.set(Transfer::Fetching);
        self.network.set(Network::Loading);
        self.set_busy(&cx.heap, true);
        let (serial, this, url) = (
            self.serial.get(),
            Strong::create(self.to_js(), cx.global()),
            self.current_src.borrow().clone(),
        );
        let destination = if self.is_video() {
            Destination::Video
        } else {
            Destination::Audio
        };
        images::fetch(
            cx,
            self.home(&cx.heap),
            &url.to_utf8(),
            destination,
            Some(self.element()),
            move |cx, resource| {
                let this = Player::from_js(&cx.heap, this.get()).filter(|it| {
                    it.serial.get() == serial && it.transfer.get() == Transfer::Fetching
                });
                if let Some(this) = this {
                    this.fetched(cx, resource);
                }
            },
        );
    }

    #[optimize(size)]
    fn fetched<'a>(&'a self, cx: Cx<'_, 'a>, resource: Option<Resource>) {
        const PART: usize = 3 << 20;
        let Some(resource) = resource.filter(|it| is_audio_or_video(&it.bytes)) else {
            return self.fail(cx, SRC_NOT_SUPPORTED);
        };
        self.transfer.set(Transfer::Done);
        self.copy(&cx.heap);
        self.set_busy(&cx.heap, !self.is_paused.get() || self.autoplays());
        if !resource.is_readable {
            self.set_tainted(true);
        }
        for part in resource.bytes.chunks(PART) {
            self.remote.send("part", &[Arg::Bytes(part)]);
            self.remote.link.flush(cx);
        }
        let url = self.current_src.borrow().to_utf8().into_owned();
        let fragment = strings::split_once_char(url.as_bytes(), b'#').map_or(&[][..], |it| it.1);
        self.remote
            .send("source", &[Arg::Text(&resource.mime), Arg::Text(fragment)]);
        if self.time() > 0.0 {
            self.seek(self.time());
        }
        if !self.is_paused.get() {
            self.start(cx);
        }
        let serial = self.serial.get();
        fire(cx, self.element(), atom!("progress"), Default::default());
        if self.serial.get() == serial {
            self.suspend(cx);
        }
    }

    /// https://html.spec.whatwg.org/#take-pending-play-promises
    pub(super) fn take_pending_plays(&self) -> Option<JSValue> {
        js_MediaPlayer::pending_plays(self)
            .inspect(|_| js_MediaPlayer::set_pending_plays(self, JSValue::ZERO))
    }

    pub(super) fn reject_pending_plays<'a>(
        &self,
        cx: Cx<'_, 'a>,
        code: DOMExceptionCode,
        message: &str,
    ) {
        reject_plays(
            cx,
            self.take_pending_plays().unwrap_or(JSValue::UNDEFINED),
            code,
            message,
        );
    }

    #[optimize(size)]
    pub(super) fn start<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.set_busy(&cx.heap, true);
        self.fetch(cx);
        if self.transfer.get() == Transfer::Done {
            let played = self.remote.link.ask(
                &cx.heap,
                "perform",
                &[self.remote.object(), "play".into()],
                JSValue::UNDEFINED,
                |_, _, _| Ok(JSValue::UNDEFINED),
            );
            let promises = self
                .take_pending_plays()
                .unwrap_or_else(|| List::new(&cx.heap).to_js());
            let [fulfilled, rejected] = [false, true].map(|it| {
                cx.heap
                    .create_callback(settle_plays, [promises, JSValue::UNDEFINED], it.into())
            });
            played.react(&cx.heap, Some(fulfilled), Some(rejected));
        }
    }

    pub(super) fn stop<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.clock.set((self.time(), None));
        self.remote.invoke("pause", &[]);
        self.set_busy(&cx.heap, self.transfer.get() == Transfer::Fetching);
        if self.size.get()[0] > 0 {
            self.repaint(cx);
        }
    }

    #[optimize(size)]
    pub(super) fn fail<'a>(&'a self, cx: Cx<'_, 'a>, code: u16) {
        let source = js_MediaPlayer::candidate(self)
            .filter(|it| code == SRC_NOT_SUPPORTED && it.is_html(atom!("source")));
        if let Some(source) = source {
            self.discard_copy(&cx.heap);
            self.queue(source.to_js(), |cx, _, source| {
                Node::from_js(&cx.heap, source)
                    .into_iter()
                    .for_each(|it| _ = fire(cx, it, atom!("error"), Default::default()))
            });
            return self.find_next_candidate(cx);
        }
        js_MediaPlayer::set_error(
            self,
            Some(js_MediaError::create(&cx.heap, MediaError(code))),
        );
        self.network.set(if code == SRC_NOT_SUPPORTED {
            Network::NoSource
        } else {
            Network::Idle
        });
        self.set_busy(&cx.heap, false);
        self.clock.set((self.time(), None));
        let (promises, serial) = (
            self.take_pending_plays().unwrap_or(JSValue::UNDEFINED),
            self.serial.get(),
        );
        if code == SRC_NOT_SUPPORTED {
            self.shows_poster.set(true);
            self.selection.set(Selection::Selecting);
        }
        fire(cx, self.element(), atom!("error"), Default::default());
        reject_plays(
            cx,
            promises,
            DOMExceptionCode::NotSupportedError,
            "The element has no supported sources.",
        );
        if self.serial.get() == serial {
            self.set_delays_load(cx, false);
        }
    }

    #[optimize(size)]
    pub(super) fn show<'a>(&'a self, cx: Cx<'_, 'a>) {
        let poster = self
            .poster
            .borrow()
            .as_ref()
            .and_then(|it| Some(it.contents()?.replaced(1.0)));
        let [width, height] = self.size.get().map(f64::from);
        let has_frame =
            width > 0.0 && (poster.is_none() || !self.shows_poster.get() && self.frame().is_some());
        let frame = has_frame
            .then(|| Replaced::new(self.frame().unwrap_or(0), width, height, width / height));
        images::show_replaced(
            cx,
            self.element(),
            Some(
                frame
                    .or(poster)
                    .unwrap_or_else(|| Replaced::new(0, 300.0, 150.0, f64::NAN)),
            ),
        );
    }

    fn border_box<'a>(&'a self, cx: Cx<'_, 'a>) -> Rect {
        if images::is_being_rendered(cx, self.element()) {
            self.element().engine(|engine, id| engine.bounding_rect(id))
        } else {
            Rect::default()
        }
    }

    #[optimize(size)]
    pub(super) fn is_seen<'a>(&'a self, cx: Cx<'_, 'a>) -> bool {
        if js_MediaPlayer::frame_callbacks(self).is_some() || !self.element().is_connected() {
            return true;
        }
        let (area, [width, height]) = (
            self.border_box(cx),
            self.element()
                .doc()
                .engine(|engine, _| engine.environment.viewport),
        );
        area.right() > 0.0
            && area.bottom() > 0.0
            && area.x < width
            && area.y < height
            && host::is_visible(cx, self.element().doc())
    }

    #[optimize(size)]
    fn wanted_width<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        let scale = images::scale(cx, self.element().doc());
        let covered = Some(f64::from(self.border_box(cx).width) * 1.5 * scale)
            .filter(|it| *it > 0.0 && !self.is_paused.get());
        covered
            .unwrap_or(f64::INFINITY)
            .min(self.size.get()[0].into())
            .ceil()
    }

    #[optimize(size)]
    fn request_picture<'a>(&'a self, cx: Cx<'_, 'a>, after: AfterPicture) {
        let (arguments, serial) = (
            [self.remote.object(), Arg::Number(self.wanted_width(cx))],
            self.serial.get(),
        );
        let asked = self.remote.link.ask(
            &cx.heap,
            "picture",
            &arguments,
            self.to_js(),
            move |cx, this, reply| {
                let this = Strong::create(this, cx.global());
                Job::<DecodeFrame>::schedule(
                    &cx.js_thread(),
                    DecodeFrame(reply.bytes(0), Decoded::default()),
                    (this, Waiting(serial, after)),
                );
                Ok(JSValue::UNDEFINED)
            },
        );
        asked.mark_as_handled();
    }

    #[optimize(size)]
    fn present<'a>(&'a self, cx: Cx<'_, 'a>, frame: Owned) {
        let previous = self.frames.borrow_mut()[0].take();
        self.frames.replace([Some(frame), previous]);
        self.show(cx);
        self.presented_frames.set(self.presented_frames.get() + 1);
        if let Some(callbacks) = js_MediaPlayer::frame_callbacks(self) {
            js_MediaPlayer::set_frame_callbacks(self, JSValue::ZERO);
            let run = cx
                .heap
                .create_callback(run_frame_callbacks, [self.to_js(), callbacks], 0);
            host::request_animation_frame(cx, self.element().doc(), run.to_js());
        }
    }

    #[optimize(size)]
    fn after_picture<'a>(&'a self, cx: Cx<'_, 'a>, after: AfterPicture) {
        match after {
            AfterPicture::FireHeldEvents => self
                .held_events
                .take()
                .into_iter()
                .for_each(|it| self.queue_event(it)),
            AfterPicture::Repaint { is_last } => {
                self.is_repainting.set(false);
                if !is_last {
                    self.repaint(cx);
                }
            }
        }
    }

    #[optimize(size)]
    fn repaint<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.remote.is_copied() || self.is_repainting.replace(true) {
            return;
        }
        let (is_last, serial) = (self.is_paused.get(), self.serial.get());
        if is_last || self.is_seen(cx) {
            return self.request_picture(cx, AfterPicture::Repaint { is_last });
        }
        queue_task_after(
            self.home(&cx.heap),
            250.0,
            &[self.to_js()],
            move |cx, this| {
                let this =
                    Player::from_js(&cx.heap, this[0]).filter(|it| it.serial.get() == serial);
                this.into_iter()
                    .for_each(|it| it.after_picture(cx, AfterPicture::Repaint { is_last }));
                Ok(())
            },
        );
    }
}

/// https://mimesniff.spec.whatwg.org/#matching-an-audio-or-video-type-pattern, with the formats that it leaves out.
fn is_audio_or_video(bytes: &[u8]) -> bool {
    const SIGNATURES: [&[u8]; 7] = [
        b"\x1a\x45\xdf\xa3",
        b"ID3",
        b"OggS",
        b"RIFF",
        b"RF64",
        b"fLaC",
        b"\0\0",
    ];
    SIGNATURES.into_iter().any(|it| bytes.starts_with(it))
        || bytes
            .array_windows()
            .take(4096)
            .any(|[a, b]| *a == 0xff && *b >= 0xe0)
}

pub(super) fn reject_plays(
    cx: Cx<'_, '_>,
    promises: JSValue,
    code: DOMExceptionCode,
    message: &str,
) {
    if !promises.is_undefined() {
        let error = cx
            .heap
            .create_dom_exception(code, format_args!("{message}"));
        settle_all(cx, promises, Some(error.to_js()));
    }
}

#[optimize(size)]
fn settle_all(cx: Cx<'_, '_>, promises: JSValue, error: Option<JSValue>) {
    for promise in List::from_value(promises).values() {
        if let Some(promise) = JsLocal::new(&cx.heap, promise).as_promise() {
            let _termination = match error {
                Some(error) => promise.reject(cx, error),
                None => promise.resolve(cx, JSValue::UNDEFINED),
            };
        }
    }
}

fn settle_plays<'a>(
    cx: Cx<'_, 'a>,
    [promises, _]: [JsLocal<'a>; 2],
    is_rejected: u64,
    outcome: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    settle_all(
        cx,
        promises.to_js(),
        (is_rejected != 0).then(|| outcome[0].to_js()),
    );
    Ok(JSValue::UNDEFINED)
}

/// The list has a handle and a callback for each.
#[optimize(size)]
fn run_frame_callbacks<'a>(
    cx: Cx<'_, 'a>,
    [player, callbacks]: [JsLocal<'a>; 2],
    _: u64,
    now: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let Some(player) = Player::from_js(&cx.heap, player.to_js()) else {
        return Ok(JSValue::UNDEFINED);
    };
    let ([width, height], now) = (player.size.get(), now[0].to_js());
    for callback in List::from_value(callbacks.to_js())
        .values()
        .skip(1)
        .step_by(2)
    {
        let metadata = VideoFrameCallbackMetadata {
            expected_display_time: now.as_number(),
            height,
            media_time: player.time(),
            presentation_time: now.as_number(),
            presented_frames: player.presented_frames.get(),
            width,
        };
        let metadata = metadata.into_js(&cx.heap)?.to_js();
        crate::api::events::call_back(
            cx,
            player.element().doc().window(),
            callback,
            JSValue::UNDEFINED,
            &[now, metadata],
        );
    }
    Ok(JSValue::UNDEFINED)
}

struct Waiting(u32, AfterPicture);

// SAFETY: plain data.
unsafe impl JsAffine for Waiting {}

struct DecodeFrame(Vec<u8>, Decoded);

impl JobContext for DecodeFrame {
    type OffThread = DecodeFrame;
    type Js = (Strong, Waiting);

    fn run(job: &mut DecodeFrame, done: Completion<Self>) -> Option<Completion<Self>> {
        job.1 = decode(&job.0, true);
        Some(done)
    }

    #[optimize(size)]
    fn then(
        mut job: DecodeFrame,
        (player, Waiting(serial, after)): Self::Js,
        thread: &JsThread<'_>,
    ) -> JsResult<()> {
        let frame = Owned::adopt(core::mem::take(&mut job.1).id);
        let present = |cx: Cx<'_, '_>| {
            let Some(player) =
                Player::from_js(&cx.heap, player.get()).filter(|it| it.serial.get() == serial)
            else {
                return;
            };
            if frame.id() != 0 {
                player.present(cx, frame);
            }
            player.after_picture(cx, after);
        };
        in_realm_of(thread, Some(player.get()), present);
        Ok(())
    }
}

impl Drop for DecodeFrame {
    fn drop(&mut self) {
        drop(Owned::adopt(self.1.id));
    }
}
