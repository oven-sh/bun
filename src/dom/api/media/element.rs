//! https://html.spec.whatwg.org/#media-elements

use bun_core::strings;
use bun_jsc::bindgen::Callable;
use bun_jsc::{JSObject, JSString, Strong};

use super::controls;
use super::player::{Network, SRC_NOT_SUPPORTED, Selection, reject_plays};
use super::*;
use crate::api::canvas::Source;
use crate::api::core::steps::{AttrChange, Steps};
use crate::api::core::{DomString, Element, Known, Node};
use crate::api::images::{self, Pictures, is_lazy};

pub(crate) struct MediaError(pub(super) u16);

impl MediaError {
    pub(crate) fn get_code(&self) -> u16 {
        self.0
    }

    pub(crate) fn get_message(&self) -> &'static [u8] {
        if self.0 == SRC_NOT_SUPPORTED {
            b"Format error"
        } else {
            b""
        }
    }
}

pub(crate) struct TimeRanges(Rc<[[f64; 2]]>);

impl TimeRanges {
    fn range(&self, index: u32) -> core::result::Result<[f64; 2], Failure> {
        self.0
            .get(index as usize)
            .copied()
            .ok_or(Failure::index_size("There is no such range."))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.0.len() as u32
    }

    #[optimize(size)]
    pub(crate) fn start(&self, index: u32) -> core::result::Result<f64, Failure> {
        self.range(index).map(|it| it[0])
    }

    pub(crate) fn end(&self, index: u32) -> core::result::Result<f64, Failure> {
        self.range(index).map(|it| it[1])
    }
}

#[optimize(size)]
fn can_play(mime_type: &str) -> CanPlayTypeResult {
    let mime_type = mime_type.to_ascii_lowercase();
    let essence = strings::split(mime_type.as_bytes(), b";")
        .next()
        .unwrap_or_default()
        .trim_ascii_end();
    let (known, is_implied): (&[u8], _) = match strings::split_once_char(essence, b'/') {
        Some((b"audio", b"aac")) => (b"mp4a.", true),
        Some((b"audio", b"flac")) => (b"flac", true),
        Some((b"audio", b"mp3" | b"mpeg")) => (b"mp3 mp4a.6", true),
        Some((b"audio", b"wav" | b"wave" | b"x-wav")) => (b"1", false),
        Some((b"audio", b"mp4" | b"x-m4a")) => (b"flac mp3 mp4a. opus", false),
        Some((b"audio", b"ogg")) => (b"flac opus vorbis", false),
        Some((b"audio", b"webm")) => (b"opus vorbis", false),
        Some((b"video", b"mp4" | b"x-m4v")) => {
            (b"av01. avc1 avc3 flac mp3 mp4a. opus vp09.", false)
        }
        Some((b"video", b"ogg")) => (b"flac opus vorbis vp8", false),
        Some((b"video", b"webm")) => (b"av01. opus vorbis vp09. vp8 vp9", false),
        _ => return CanPlayTypeResult::No,
    };
    let codecs = strings::split_once(mime_type.as_bytes(), b"codecs=").map(|it| it.1);
    let Some(codecs) = codecs.filter(|it| it.iter().any(u8::is_ascii_alphanumeric)) else {
        return if is_implied {
            CanPlayTypeResult::Probably
        } else {
            CanPlayTypeResult::Maybe
        };
    };
    let is_known = |codec: &[u8]| {
        strings::split(known, b" ").any(|it| strings::trim_left(codec, b" \"").starts_with(it))
    };
    if strings::split(
        strings::split(codecs, b";").next().unwrap_or_default(),
        b",",
    )
    .all(is_known)
    {
        CanPlayTypeResult::Probably
    } else {
        CanPlayTypeResult::No
    }
}

/// Empty if it cannot be played.
#[optimize(size)]
fn url_of<'a>(cx: Cx<'_, 'a>, holder: &'a Element) -> DomString {
    let is_unplayable = |it: &str| !it.is_empty() && can_play(it) == CanPlayTypeResult::No;
    if holder.is_html(atom!("source"))
        && (holder.with_attr(atom!("type"), is_unplayable) == Some(true)
            || !images::matches_media(holder))
    {
        return DomString::default();
    }
    holder
        .attr(atom!("src"))
        .filter(|it| !it.is_empty())
        .and_then(|it| crate::api::interim::resolve(cx, holder.doc(), &it))
        .unwrap_or_default()
}

impl Player {
    pub(super) fn later<'a>(&'a self, heap: &JsHeap<'a>, steps: bun_jsc::bindgen::CallbackBody) {
        heap.queue_microtask(
            heap.create_callback(
                steps,
                [self.to_js(), JSValue::UNDEFINED],
                self.serial.get().into(),
            ),
            JSValue::UNDEFINED,
        );
    }

    /// https://html.spec.whatwg.org/#media-element-load-algorithm
    #[optimize(size)]
    fn load<'a>(&'a self, cx: Cx<'_, 'a>) {
        let (had_position, network) = (self.time() > 0.0, self.network.get());
        self.unload(cx);
        if let Network::Idle | Network::Loading = network {
            self.queue_event(atom!("abort"));
        }
        if network != Network::Empty {
            self.queue_event(atom!("emptied"));
            self.duration.set(f64::NAN);
            self.ready_state.set(0);
            self.deactivate_cues(cx);
            if !self.is_paused.replace(true) {
                self.reject_pending_plays(
                    cx,
                    DOMExceptionCode::AbortError,
                    "The play() request was interrupted by a new load request.",
                );
            }
            self.is_seeking.set(false);
            if had_position {
                self.queue_event(atom!("timeupdate"));
            }
        }
        self.set_playback_rate(self.default_playback_rate.get());
        self.can_autoplay.set(true);
        js_MediaPlayer::set_error(self, None);
        self.select_resource(cx);
        self.show(cx);
    }

    /// https://html.spec.whatwg.org/#concept-media-load-algorithm
    #[optimize(size)]
    fn select_resource<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.network.set(Network::NoSource);
        self.shows_poster.set(true);
        self.selection.set(Selection::Selecting);
        self.current_src.take();
        self.set_delays_load(cx, true);
        self.later(&cx.heap, |cx, [this, _], serial, _| {
            Player::from_js(&cx.heap, this.to_js())
                .filter(|it| u64::from(it.serial.get()) == serial)
                .into_iter()
                .for_each(|it| it.select_mode(cx));
            Ok(JSValue::UNDEFINED)
        });
    }

    #[optimize(size)]
    fn select_mode<'a>(&'a self, cx: Cx<'_, 'a>) {
        let (element, has_object) = (self.element(), js_MediaPlayer::src_object(self).is_some());
        let first_source = || {
            element
                .element_children()
                .find(|it| it.is_html(atom!("source")))
        };
        let Some(candidate) = (if has_object || element.has_attr(atom!("src")) {
            Some(element)
        } else {
            first_source()
        }) else {
            self.network.set(Network::Empty);
            return self.set_delays_load(cx, false);
        };
        if self.is_paused.get() && !self.is_near.get() && is_lazy(element) {
            self.selection.set(Selection::Deferred);
            self.set_delays_load(cx, false);
            return images::load_when_near(&cx.heap, element);
        }
        self.network.set(Network::Loading);
        self.queue_event(atom!("loadstart"));
        self.process_candidate(cx, candidate);
    }

    fn set_pointer_after(&self, node: Option<&Node>) {
        js_MediaPlayer::set_before_pointer(self, node);
        js_MediaPlayer::set_after_pointer(
            self,
            node.map_or_else(|| self.element().first_child(), Node::next_sibling),
        );
    }

    #[optimize(size)]
    fn process_candidate<'a>(&'a self, cx: Cx<'_, 'a>, candidate: &'a Element) {
        js_MediaPlayer::set_candidate(self, Some(candidate));
        self.set_pointer_after((candidate != self.element()).then_some(&**candidate));
        let has_object = js_MediaPlayer::src_object(self).is_some();
        let url = if has_object {
            DomString::default()
        } else {
            url_of(cx, candidate)
        };
        let is_playable = has_object || !url.is_empty();
        if is_playable {
            self.current_src.replace(url);
        } else if candidate != self.element() {
            return self.later(&cx.heap, |cx, [this, _], serial, _| {
                Player::from_js(&cx.heap, this.to_js())
                    .filter(|it| u64::from(it.serial.get()) == serial)
                    .into_iter()
                    .for_each(|it| it.fail(cx, SRC_NOT_SUPPORTED));
                Ok(JSValue::UNDEFINED)
            });
        }
        self.queue(JSValue::UNDEFINED, move |cx, player, _| {
            match is_playable && host::plays_media(cx, player.home(&cx.heap)) {
                true => player.fetch_if_needed(cx),
                false => player.fail(cx, SRC_NOT_SUPPORTED),
            }
        });
    }

    /// Nothing is fetched until something waits for it.
    #[optimize(size)]
    fn fetch_if_needed<'a>(&'a self, cx: Cx<'_, 'a>) {
        const NEED_DATA: [Known; 7] = [
            atom!("canplay"),
            atom!("canplaythrough"),
            atom!("durationchange"),
            atom!("loadeddata"),
            atom!("loadedmetadata"),
            atom!("progress"),
            atom!("timeupdate"),
        ];
        let element = self.element();
        self.selection.set(Selection::Selected);
        let is_blank =
            self.is_video() && element.is_connected() && !element.has_attr(atom!("poster"));
        let is_watched = NEED_DATA.into_iter().any(|it| element.has_listeners(it))
            || js_MediaPlayer::candidate(self).is_some_and(|it| it.has_listeners(atom!("error")));
        let has_choice = js_MediaPlayer::after_pointer(self).is_some();
        if !self.is_paused.get() {
            self.play(cx);
        } else if self.autoplays()
            || self.preloads()
                && (is_blank || is_watched || has_choice || element.has_attr(atom!("controls")))
        {
            self.fetch(cx);
        } else {
            self.suspend(cx);
            self.set_delays_load(cx, false);
        }
    }

    fn preloads(&self) -> bool {
        self.element()
            .with_attr_string(atom!("preload"), |it| it.eq_ignore_ascii_case("none"))
            != Some(true)
    }

    /// For what is asked about the resource.
    fn wanted(&self) -> &Player {
        if self.selection.get() == Selection::Selected
            && self.has_fetched_nothing()
            && self.preloads()
        {
            self.queue(JSValue::UNDEFINED, |cx, player, _| player.fetch(cx));
        }
        self
    }

    #[optimize(size)]
    pub(super) fn find_next_candidate<'a>(&'a self, cx: Cx<'_, 'a>) {
        let after =
            core::iter::successors(js_MediaPlayer::after_pointer(self), |it| it.next_sibling());
        if let Some(next) = after
            .filter_map(Node::as_element)
            .find(|it| it.is_html(atom!("source")))
        {
            self.selection.set(Selection::Selecting);
            self.network.set(Network::Loading);
            self.set_delays_load(cx, true);
            return self.process_candidate(cx, next);
        }
        self.set_pointer_after(self.element().last_child());
        self.selection.set(Selection::Waiting);
        self.network.set(Network::NoSource);
        self.shows_poster.set(true);
        self.queue(JSValue::UNDEFINED, |cx, player, _| {
            player.set_delays_load(cx, player.selection.get() != Selection::Waiting)
        });
    }

    #[optimize(size)]
    fn children_changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        let element = self.element();
        let (before, after) = (
            js_MediaPlayer::before_pointer(self),
            js_MediaPlayer::after_pointer(self),
        );
        match before.is_none_or(|it| it.parent() == Some(element)) {
            true => self.set_pointer_after(before),
            false => self.set_pointer_after(
                after.map_or_else(|| element.last_child(), Node::previous_sibling),
            ),
        }
        if self.selection.get() == Selection::Waiting {
            self.later(&cx.heap, |cx, [this, _], _, _| {
                let this = Player::from_js(&cx.heap, this.to_js())
                    .filter(|it| it.selection.get() == Selection::Waiting);
                this.filter(|it| js_MediaPlayer::after_pointer(it).is_some())
                    .into_iter()
                    .for_each(|it| it.find_next_candidate(cx));
                Ok(JSValue::UNDEFINED)
            });
        }
    }

    #[optimize(size)]
    fn resume<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.is_near.set(true);
        if self.defers_poster.get() {
            poster_changed(cx, self);
        }
        if self.selection.get() == Selection::Deferred {
            self.selection.set(Selection::Selecting);
            self.select_mode(cx);
        }
    }

    /// https://html.spec.whatwg.org/#internal-play-steps
    #[optimize(size)]
    fn play<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.network.get() == Network::Empty {
            self.select_resource(cx);
        }
        self.can_autoplay.set(false);
        if self.is_paused.replace(false) {
            if self.shows_poster.replace(false) {
                self.time_marches_on(cx);
            }
            self.queue_event(atom!("play"));
        }
        match self.selection.get() {
            Selection::Selected => self.start(cx),
            Selection::Deferred => self.resume(cx),
            Selection::Selecting | Selection::Waiting => {}
        }
    }

    pub(super) fn is_unsupported(&self) -> bool {
        js_MediaPlayer::error(self).is_some_and(|it| it.0 == SRC_NOT_SUPPORTED)
    }

    /// https://html.spec.whatwg.org/#internal-pause-steps
    #[optimize(size)]
    pub(super) fn pause<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.can_autoplay.set(false);
        if !self.is_paused.replace(true) {
            self.stop(cx);
            self.queue_event(atom!("timeupdate"));
            self.queue_event(atom!("pause"));
            self.queue_always(
                self.take_pending_plays().unwrap_or(JSValue::UNDEFINED),
                |cx, _, promises| {
                    reject_plays(
                        cx,
                        promises,
                        DOMExceptionCode::AbortError,
                        "The play() request was interrupted by a call to pause().",
                    );
                },
            );
        }
    }

    pub(super) fn toggle<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.is_paused.get() {
            self.pause(cx);
        } else if !self.is_unsupported() {
            self.play(cx);
        }
    }

    pub(super) fn seek_to(&self, time: f64) {
        if self.ready_state.get() > 0 {
            self.shows_poster.set(false);
        }
        self.wanted().seek(time);
    }

    fn set_playback_rate(&self, rate: f64) {
        self.restart_clock();
        self.change(
            &self.playback_rate,
            rate,
            "playbackRate",
            Arg::Number(rate),
            atom!("ratechange"),
        );
    }

    pub(super) fn set_volume(&self, volume: f64) {
        self.change(
            &self.volume,
            volume,
            "volume",
            Arg::Number(volume),
            atom!("volumechange"),
        );
    }

    pub(super) fn set_muted(&self, value: bool) {
        self.muted.set(Some(self.is_muted()));
        self.change(
            &self.muted,
            Some(value),
            "muted",
            Arg::Flag(value),
            atom!("volumechange"),
        );
    }

    fn change<T: Copy + PartialEq>(
        &self,
        slot: &Cell<T>,
        value: T,
        name: &str,
        argument: Arg<'_>,
        event: Known,
    ) {
        if slot.replace(value) != value {
            self.remote().set(name, argument);
            self.queue_event(event);
        }
    }
}

macro_rules! getters {
    ($($class:ident { $($name:ident -> $type:ty = |$it:ident| $value:expr;)* })*) => {
        $(impl $class {
            $(pub(crate) fn $name<'a>(&'a self, heap: &JsHeap<'a>) -> $type {
                let $it = Player::of_element(heap, self);
                $value
            })*
        })*
    };
}

getters! {
    HTMLMediaElement {
        get_error -> Option<&'a MediaError> = |it| js_MediaPlayer::error(it);
        get_src_object -> Option<&'a MediaStream> = |it| js_MediaPlayer::src_object(it);
        get_network_state -> u16 = |it| it.network.get() as u16;
        get_ready_state -> u16 = |it| it.wanted().ready_state.get();
        get_seeking -> bool = |it| it.is_seeking.get();
        get_current_time -> f64 = |it| it.time();
        get_duration -> f64 = |it| it.wanted().duration.get();
        get_paused -> bool = |it| it.is_paused.get();
        get_default_playback_rate -> f64 = |it| it.default_playback_rate.get();
        get_playback_rate -> f64 = |it| it.playback_rate.get();
        get_preserves_pitch -> bool = |it| it.preserves_pitch.get();
        get_ended -> bool = |it| it.ready_state.get() > 0 && !it.loops() && it.time() >= it.duration.get();
        get_volume -> f64 = |it| it.volume.get();
        get_muted -> bool = |it| it.is_muted();
        get_sink_id -> Vec<u8> = |it| it.sink.borrow().to_vec();
    }
    HTMLVideoElement {
        get_video_width -> u32 = |it| it.wanted().size.get()[0];
        get_video_height -> u32 = |it| it.wanted().size.get()[1];
        source -> Option<Source> = |it| it.frame().map(|id| Source::new(id, it.size.get(), !it.is_tainted.get()));
    }
}

impl HTMLMediaElement {
    fn time_ranges<'a>(&'a self, heap: &JsHeap<'a>, at: usize) -> &'a TimeRanges {
        js_TimeRanges::create(
            heap,
            TimeRanges(Rc::clone(
                &Player::of_element(heap, self).ranges.borrow()[at],
            )),
        )
    }

    pub(crate) fn get_buffered<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TimeRanges {
        self.time_ranges(heap, 0)
    }

    pub(crate) fn get_played<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TimeRanges {
        self.time_ranges(heap, 1)
    }

    pub(crate) fn get_seekable<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TimeRanges {
        self.time_ranges(heap, 2)
    }

    pub(crate) fn get_current_src<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> JsLocal<'a, bun_jsc::JSString> {
        Player::of_element(heap, self)
            .current_src
            .borrow()
            .to_js(heap)
    }

    pub(crate) fn set_src_object<'a>(&'a self, cx: Cx<'_, 'a>, stream: Option<&'a MediaStream>) {
        let player = Player::of_element(&cx.heap, self);
        js_MediaPlayer::set_src_object(player, stream);
        player.load(cx);
    }

    #[optimize(size)]
    pub(crate) fn load<'a>(&'a self, cx: Cx<'_, 'a>) {
        Player::of_element(&cx.heap, self).load(cx);
    }

    pub(crate) fn can_play_type(&self, mime_type: &[u8]) -> CanPlayTypeResult {
        can_play(crate::values::text(mime_type))
    }

    pub(crate) fn set_current_time<'a>(&'a self, heap: &JsHeap<'a>, time: f64) {
        Player::of_element(heap, self).seek_to(time);
    }

    pub(crate) fn set_default_playback_rate<'a>(&'a self, heap: &JsHeap<'a>, rate: f64) {
        let it = Player::of_element(heap, self);
        it.change(
            &it.default_playback_rate,
            rate,
            "defaultPlaybackRate",
            Arg::Number(rate),
            atom!("ratechange"),
        );
    }

    pub(crate) fn set_playback_rate<'a>(&'a self, heap: &JsHeap<'a>, rate: f64) {
        Player::of_element(heap, self).set_playback_rate(rate);
    }

    pub(crate) fn set_preserves_pitch<'a>(&'a self, heap: &JsHeap<'a>, value: bool) {
        let it = Player::of_element(heap, self);
        it.preserves_pitch.set(value);
        it.remote().set("preservesPitch", Arg::Flag(value));
    }

    pub(crate) fn set_volume<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        volume: f64,
    ) -> core::result::Result<(), Failure> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(Failure::index_size(
                "The volume is outside the range [0, 1].",
            ));
        }
        Player::of_element(heap, self).set_volume(volume);
        Ok(())
    }

    pub(crate) fn set_muted<'a>(&'a self, heap: &JsHeap<'a>, value: bool) {
        Player::of_element(heap, self).set_muted(value);
    }

    #[optimize(size)]
    pub(crate) fn play<'a>(&'a self, cx: Cx<'_, 'a>) -> core::result::Result<JSValue, Failure> {
        let player = Player::of_element(&cx.heap, self);
        if player.is_unsupported() || !host::plays_media(cx, player.home(&cx.heap)) {
            return Err(Failure::Dom(
                DOMExceptionCode::NotSupportedError,
                "The element has no supported sources.",
            ));
        }
        let (promise, pending) = (
            cx.heap.create_promise().to_js(),
            js_MediaPlayer::pending_plays(player)
                .map_or_else(|| List::new(&cx.heap), List::from_value),
        );
        pending.push(&cx.heap, promise);
        js_MediaPlayer::set_pending_plays(player, pending.to_js());
        player.play(cx);
        Ok(promise)
    }

    #[optimize(size)]
    pub(crate) fn pause<'a>(&'a self, cx: Cx<'_, 'a>) {
        let player = Player::of_element(&cx.heap, self);
        if player.network.get() == Network::Empty {
            player.select_resource(cx);
        }
        player.pause(cx);
    }

    #[optimize(size)]
    pub(crate) fn set_sink_id<'a>(&'a self, cx: Cx<'_, 'a>, id: &[u8]) -> Result<'a, JSValue> {
        let player = Player::of_element(&cx.heap, self);
        if !player.remote().is_copied() {
            player.sink.replace(id.into());
            return cx.promise_resolve(JSValue::UNDEFINED).map(JsLocal::to_js);
        }
        let (arguments, id) = (
            [player.remote().object(), "setSinkId".into(), Arg::Text(id)],
            Box::from(id),
        );
        let changed = player.remote().link.ask(
            &cx.heap,
            "perform",
            &arguments,
            player.to_js(),
            |cx, player, _| {
                if let Some(player) = Player::from_js(&cx.heap, player) {
                    player.sink.replace(id);
                }
                Ok(JSValue::UNDEFINED)
            },
        );
        Ok(changed.to_js())
    }
}

impl HTMLVideoElement {
    #[optimize(size)]
    pub(crate) fn request_video_frame_callback<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> u32 {
        let player = Player::of_element(heap, self);
        let (handle, callbacks) = (
            player.last_frame_callback.get() + 1,
            js_MediaPlayer::frame_callbacks(player)
                .map_or_else(|| List::new(heap), List::from_value),
        );
        player.last_frame_callback.set(handle);
        [JSValue::js_number(handle.into()), callback.to_js()]
            .into_iter()
            .for_each(|it| callbacks.push(heap, it));
        js_MediaPlayer::set_frame_callbacks(player, callbacks.to_js());
        handle
    }

    #[optimize(size)]
    pub(crate) fn cancel_video_frame_callback<'a>(&'a self, heap: &JsHeap<'a>, handle: u32) {
        let callbacks =
            js_MediaPlayer::frame_callbacks(Player::of_element(heap, self)).map(List::from_value);
        if let Some((callbacks, at)) = callbacks
            .and_then(|it| Some((it, it.position_of_key(JSValue::js_number(handle.into()))?)))
        {
            callbacks.remove_range(heap, at, 2);
        }
    }
}

impl HTMLAudioElement {
    #[optimize(size)]
    pub(crate) fn new_audio<'a>(
        cx: Cx<'_, 'a>,
        _: JsLocal<'a, JSObject>,
        src: Option<JsLocal<'a, JSString>>,
    ) -> Result<'a, JSValue> {
        let audio = current_document(cx)?.create_html(&cx.heap, atom!("audio"));
        audio.set_attr(cx, atom!("preload"), DomString::from("auto"));
        if let Some(src) = src {
            audio.set_attr(cx, atom!("src"), DomString::from_js_string(&cx.heap, src)?);
        }
        Ok(audio.to_js())
    }
}

#[optimize(size)]
fn poster_changed<'a>(cx: Cx<'_, 'a>, player: &'a Player) {
    let (element, document) = (player.element(), player.element().doc());
    player
        .defers_poster
        .set(!player.is_near.get() && is_lazy(element));
    if player.defers_poster.get() {
        return images::load_when_near(&cx.heap, element);
    }
    let value = element
        .attr(atom!("poster"))
        .filter(|it| !it.is_empty() && document.has_page());
    let url = value.and_then(|it| crate::api::interim::resolve(cx, document, &it));
    let poster = url.map(|it| Pictures::request(cx, document, it, None));
    let picture = poster.as_ref().map(|it| it.picture());
    drop(player.poster.replace(poster));
    let Some(picture) = picture else {
        return player.show(cx);
    };
    crate::api::interim::delay_load(cx, document);
    let document = Strong::create(document.to_js(), cx.global());
    picture.when_settled(cx, player.to_js(), move |cx, player| {
        Player::from_js(&cx.heap, player)
            .into_iter()
            .for_each(|it| it.show(cx));
        Node::from_js(&cx.heap, document.get())
            .and_then(Node::as_doc)
            .into_iter()
            .for_each(|it| crate::api::interim::allow_load(cx, it));
    });
}

#[optimize(size)]
fn attribute_changed<'a>(cx: Cx<'_, 'a>, element: &'a Element, change: &AttrChange<'_>) {
    let player = Player::of_element(&cx.heap, element);
    match change.name.known_without_namespace() {
        atom!("src") if change.new.is_some() => player.load(cx),
        atom!("loop") => player.remote().set("loop", Arg::Flag(change.new.is_some())),
        atom!("muted") => player.remote().set("muted", Arg::Flag(player.is_muted())),
        atom!("poster") if player.is_video() => player.later(&cx.heap, |cx, [this, _], _, _| {
            Player::from_js(&cx.heap, this.to_js())
                .into_iter()
                .for_each(|it| poster_changed(cx, it));
            Ok(JSValue::UNDEFINED)
        }),
        atom!("loading") if !is_lazy(element) => player.resume(cx),
        atom!("controls") => player.add_or_remove_controls(cx),
        atom!("controlslist") => player.renew_controls(cx),
        _ => {}
    }
}

pub(crate) fn resume_lazy_media<'a>(cx: Cx<'_, 'a>, element: &'a Element) {
    Player::of_element(&cx.heap, element).resume(cx);
}

/// https://html.spec.whatwg.org/#the-source-element:html-element-insertion-steps
pub(crate) fn source_inserted<'a>(cx: Cx<'_, 'a>, parent: &'a Node) {
    let player = Player::of(&cx.heap, parent.to_js())
        .filter(|it| it.network.get() == Network::Empty && !it.element().has_attr(atom!("src")));
    player.into_iter().for_each(|it| it.select_resource(cx));
}

pub(crate) static MEDIA_STEPS: Steps = Steps {
    children_changed: Some(|cx, element, _| {
        Player::of_element(&cx.heap, element).children_changed(cx)
    }),
    removed: Some(|cx, element, _, is_move| {
        if !is_move {
            Player::of_element(&cx.heap, element).later(&cx.heap, |cx, [this, _], _, _| {
                Player::from_js(&cx.heap, this.to_js())
                    .filter(|it| !it.element().is_connected())
                    .into_iter()
                    .for_each(|it| it.pause(cx));
                Ok(JSValue::UNDEFINED)
            });
        }
    }),
    finished_parsing: Some(|cx, element| {
        let player = Player::of_element(&cx.heap, element);
        player.select_tracks(cx);
        player.tracks_settled(cx);
    }),
    adopted: Some(|cx, element, _| {
        let player = Player::of_element(&cx.heap, element);
        if element.has_attr(atom!("poster")) && player.is_video() {
            poster_changed(cx, player);
        }
    }),
    rendered: Some(|cx, element| {
        let player = Player::of_element(&cx.heap, element);
        if element.shadow_root().is_some() {
            element.engine(|engine, _| engine.use_media_styles());
        }
        if player.defers_poster.get() || player.selection.get() == Selection::Deferred {
            images::load_when_near(&cx.heap, element);
        }
        player.show(cx);
        player.add_or_remove_controls(cx);
        player.restore_cue_styles(&cx.heap);
    }),
    activate: Some(controls::activate),
    default_action: Some(controls::default_action),
    attribute_changed: Some(attribute_changed),
    ..Steps::NONE
};
