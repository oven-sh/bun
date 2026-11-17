//! https://html.spec.whatwg.org/#timed-text-tracks

use bun_jsc::Strong;
use bun_jsc::bindgen::JsAtom;
use bun_web::net::body::SharedBytes;

use super::webvtt::{self, CueSettings, File, RegionSettings};
use super::*;
use crate::api::core::steps::Steps;
use crate::api::core::{
    DocumentFragment, DomString, Edge, Element, Known, Node, NodeFlags, append_detached,
};
use crate::api::events::{Event, EventInit, Trusted, dispatch};
use crate::api::images::{self, Destination};
use crate::api::interim::resolve;
use crate::order::Order as _;

#[derive(Clone, Copy, PartialEq)]
#[repr(u16)]
enum Readiness {
    NotLoaded,
    Loading,
    Loaded,
    Failed,
}

#[repr(C)]
pub(crate) struct TextTrack {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_TextTrack::Fields,
    /// Unless it goes by the attributes of an element.
    given: (TextTrackKind, DomString, DomString),
    mode: Cell<TextTrackMode>,
    readiness: Cell<Readiness>,
    is_processing: Cell<bool>,
    /// Its mode is not up to the automatic selection any more.
    is_configured: Cell<bool>,
    loaded_url: RefCell<Option<DomString>>,
    added_cues: Cell<u32>,
    aborted_loads: Cell<u32>,
    pub(super) style_sheets: RefCell<Vec<Box<[u8]>>>,
}

impl TextTrack {
    #[optimize(size)]
    fn new<'a>(
        heap: &JsHeap<'a>,
        given: (TextTrackKind, DomString, DomString),
        mode: TextTrackMode,
        readiness: Readiness,
    ) -> &'a TextTrack {
        let (
            mode,
            readiness,
            (is_processing, is_configured, loaded_url, added_cues, aborted_loads, style_sheets),
        ) = (Cell::new(mode), Cell::new(readiness), Default::default());
        let track = js_TextTrack::create(
            heap,
            TextTrack {
                base: Default::default(),
                fields: Default::default(),
                given,
                mode,
                readiness,
                is_processing,
                is_configured,
                loaded_url,
                added_cues,
                aborted_loads,
                style_sheets,
            },
        );
        js_TextTrack::set_cues(track, List::new(heap).to_js());
        track
    }

    #[optimize(size)]
    fn of_element<'a>(heap: &JsHeap<'a>, element: &'a Element) -> &'a TextTrack {
        let track = element.same_object(heap, Edge::TextTracks, || {
            let given = (
                TextTrackKind::Subtitles,
                DomString::default(),
                DomString::default(),
            );
            let track = TextTrack::new(
                element.doc().heap(heap),
                given,
                TextTrackMode::Disabled,
                Readiness::NotLoaded,
            );
            js_TextTrack::set_element(track, Some(element));
            track.to_js()
        });
        // SAFETY: nothing else is put on this edge of a track element.
        unsafe { TextTrack::from_js_unchecked(track) }
    }

    fn list(&self) -> List<'_> {
        List::from_value(js_TextTrack::cues(self).expect("a track has a list of cues"))
    }

    pub(super) fn cues(&self) -> impl Iterator<Item = &VTTCue> {
        // SAFETY: nothing else is put in the list.
        self.list()
            .values()
            .map(|it| unsafe { VTTCue::from_js_unchecked(it) })
    }

    fn player(&self) -> Option<&Player> {
        js_TextTrack::player(self)
    }

    fn attribute(&self, name: Known) -> Option<DomString> {
        js_TextTrack::element(self).map(|it| it.attr(name).unwrap_or_default())
    }

    fn is_default(&self) -> bool {
        js_TextTrack::element(self).is_some_and(|it| it.has_attr(atom!("default")))
    }

    pub(super) fn is_rendered(&self) -> bool {
        self.mode.get() == TextTrackMode::Showing
            && matches!(
                self.get_kind(),
                TextTrackKind::Subtitles | TextTrackKind::Captions
            )
    }

    #[optimize(size)]
    pub(crate) fn get_kind(&self) -> TextTrackKind {
        use TextTrackKind::*;
        let Some(element) = js_TextTrack::element(self) else {
            return self.given.0;
        };
        let kinds = [
            ("subtitles", Subtitles),
            ("captions", Captions),
            ("descriptions", Descriptions),
            ("chapters", Chapters),
        ];
        element
            .with_attr(atom!("kind"), |kind| {
                kinds
                    .into_iter()
                    .find(|it| it.0.eq_ignore_ascii_case(kind))
                    .map_or(Metadata, |it| it.1)
            })
            .unwrap_or(Subtitles)
    }

    pub(crate) fn get_label(&self) -> DomString {
        self.attribute(atom!("label"))
            .unwrap_or_else(|| self.given.1.clone())
    }

    pub(crate) fn get_language(&self) -> DomString {
        self.attribute(atom!("srclang"))
            .unwrap_or_else(|| self.given.2.clone())
    }

    pub(crate) fn get_id(&self) -> DomString {
        self.attribute(atom!("id")).unwrap_or_default()
    }

    pub(crate) fn get_in_band_metadata_track_dispatch_type(&self) -> DomString {
        DomString::default()
    }

    pub(crate) fn get_mode(&self) -> TextTrackMode {
        self.mode.get()
    }

    #[optimize(size)]
    pub(crate) fn set_mode<'a>(&'a self, cx: Cx<'_, 'a>, mode: TextTrackMode) {
        self.is_configured.set(true);
        if self.mode.replace(mode) == mode {
            return;
        }
        if mode == TextTrackMode::Disabled {
            self.cues().for_each(|it| it.is_active.set(false));
        }
        self.process(&cx.heap);
        let Some(player) = self.player() else { return };
        if !player.has_track_change.replace(true) {
            player.queue_always(JSValue::UNDEFINED, |cx, player, _| {
                player.has_track_change.set(false);
                fire(
                    cx,
                    player.text_tracks(&cx.heap),
                    atom!("change"),
                    Default::default(),
                );
            });
        }
        player.cues_changed(cx);
        player.tracks_settled(cx);
    }

    fn cue_list<'a>(&'a self, heap: &JsHeap<'a>, is_of_active: bool) -> &'a TextTrackCueList {
        let list = js_TextTrackCueList::create(
            self.realm(heap),
            TextTrackCueList {
                is_of_active,
                _interior: Default::default(),
            },
        );
        js_TextTrackCueList::set_track(list, Some(self));
        list
    }

    pub(crate) fn get_cues<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a TextTrackCueList> {
        (self.mode.get() != TextTrackMode::Disabled).then(|| {
            let list = js_TextTrack::all(self).unwrap_or_else(|| self.cue_list(heap, false));
            js_TextTrack::set_all(self, Some(list));
            list
        })
    }

    pub(crate) fn get_active_cues<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a TextTrackCueList> {
        (self.mode.get() != TextTrackMode::Disabled).then(|| {
            let list = js_TextTrack::active(self).unwrap_or_else(|| self.cue_list(heap, true));
            js_TextTrack::set_active(self, Some(list));
            list
        })
    }

    /// https://html.spec.whatwg.org/#text-track-cue-order
    #[optimize(size)]
    fn place<'a>(&'a self, heap: &JsHeap<'a>, cue: &'a TextTrackCue) {
        let (list, order) = (self.list(), |it: &TextTrackCue| {
            (it.times.get()[0], -it.times.get()[1], it.order.get())
        });
        let (mut low, mut high) = (0, list.len());
        while low < high {
            let middle = low.midpoint(high);
            match TextTrackCue::from_js(heap, list.get(middle))
                .is_some_and(|it| order(it) < order(cue))
            {
                true => low = middle + 1,
                false => high = middle,
            }
        }
        list.insert(heap, low, cue.to_js());
    }

    fn insert<'a>(&'a self, heap: &JsHeap<'a>, cue: &'a TextTrackCue) {
        cue.order
            .set(self.added_cues.replace(self.added_cues.get() + 1));
        cue.is_new.set(true);
        js_TextTrackCue::set_track(cue, Some(self));
        self.place(heap, cue);
    }

    fn cues_changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.player().into_iter().for_each(|it| it.cues_changed(cx));
    }

    pub(crate) fn add_cue<'a>(&'a self, cx: Cx<'_, 'a>, cue: &'a TextTrackCue) {
        if let Some(old) = js_TextTrackCue::track(cue) {
            let _is_in_it = old.remove_cue(cx, cue);
        }
        self.insert(&cx.heap, cue);
        self.cues_changed(cx);
    }

    pub(crate) fn remove_cue<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        cue: &'a TextTrackCue,
    ) -> core::result::Result<(), Failure> {
        if !self.list().remove(&cx.heap, cue.to_js()) {
            return Err(Failure::Dom(
                DOMExceptionCode::NotFoundError,
                "The cue is not in the list of cues of the track.",
            ));
        }
        cue.leave_track();
        self.cues_changed(cx);
        Ok(())
    }

    fn empty<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.cues().for_each(|it| it.leave_track());
        self.list().clear(&cx.heap);
        self.cues_changed(cx);
    }

    /// https://html.spec.whatwg.org/#start-the-track-processing-model
    #[optimize(size)]
    fn process<'a>(&'a self, heap: &JsHeap<'a>) {
        let has_begun = self.loaded_url.borrow().is_some() || self.player().is_some();
        if js_TextTrack::element(self).is_some()
            && self.mode.get() != TextTrackMode::Disabled
            && has_begun
            && !self.is_processing.replace(true)
        {
            let steps = heap.create_callback(
                |cx, [this, _], _, _| {
                    TextTrack::from_js(&cx.heap, this.to_js())
                        .into_iter()
                        .for_each(|it| it.load(cx));
                    Ok(JSValue::UNDEFINED)
                },
                [self.to_js(), JSValue::UNDEFINED],
                0,
            );
            heap.queue_microtask(steps, JSValue::UNDEFINED);
        }
    }

    fn url<'a>(&'a self, cx: Cx<'_, 'a>, element: &'a Element) -> DomString {
        element
            .attr(atom!("src"))
            .filter(|it| !it.is_empty())
            .and_then(|it| resolve(cx, element.doc(), &it))
            .unwrap_or_default()
    }

    #[optimize(size)]
    fn load<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(element) = js_TextTrack::element(self) else {
            return;
        };
        let url = self.url(cx, element);
        if self.loaded_url.replace(Some(url.clone())).as_ref() == Some(&url) {
            self.is_processing.set(false);
            return self
                .player()
                .into_iter()
                .for_each(|it| it.tracks_settled(cx));
        }
        self.readiness.set(Readiness::Loading);
        let (this, document) = (
            Strong::create(self.to_js(), cx.global()),
            home_of(&cx.heap, element),
        );
        if url.is_empty() {
            return self.finish(document, None);
        }
        let (media, aborted) = (
            self.player().map_or(element, Player::element),
            self.aborted_loads.get(),
        );
        images::fetch(
            cx,
            document,
            &url.to_utf8(),
            Destination::Track,
            Some(media),
            move |cx, resource| {
                let this = TextTrack::from_js(&cx.heap, this.get())
                    .filter(|it| it.aborted_loads.get() == aborted);
                let this =
                    this.and_then(|it| Some((it, home_of(&cx.heap, js_TextTrack::element(it)?))));
                this.into_iter().for_each(|(it, document)| {
                    it.finish(
                        document,
                        resource
                            .as_ref()
                            .filter(|it| it.is_readable && it.status < 300)
                            .map(|it| it.bytes.clone()),
                    )
                });
            },
        );
    }

    #[optimize(size)]
    fn finish(&self, document: &Doc, bytes: Option<SharedBytes>) {
        let aborted = self.aborted_loads.get();
        queue_task(document, &[self.to_js()], move |cx, this| {
            TextTrack::from_js(&cx.heap, this[0])
                .filter(|it| it.aborted_loads.get() == aborted)
                .into_iter()
                .for_each(|it| it.loaded(cx, bytes.as_deref()));
            Ok(())
        });
    }

    #[optimize(size)]
    fn loaded<'a>(&'a self, cx: Cx<'_, 'a>, bytes: Option<&[u8]>) {
        let Some(element) = js_TextTrack::element(self) else {
            return;
        };
        let is_wanted = self.loaded_url.borrow().clone() == Some(self.url(cx, element));
        let input = bytes.filter(|_| is_wanted).map(webvtt::normalized);
        let file = input.as_deref().and_then(File::parse);
        if let Some(file) = &file {
            let (heap, string) = (self.realm(&cx.heap), |it| {
                DomString::from_utf8(crate::values::text(it))
            });
            let regions = List::new(heap);
            self.style_sheets
                .replace(file.style_sheets.iter().map(|it| Box::from(*it)).collect());
            for (id, settings) in &file.regions {
                regions.push(
                    heap,
                    js_VTTRegion::create(
                        heap,
                        VTTRegion {
                            id: string(id).into(),
                            settings: Cell::new(*settings),
                        },
                    )
                    .to_js(),
                );
            }
            for it in &file.cues {
                let cue = js_VTTCue::create(
                    heap,
                    VTTCue::new(string(it.id), it.times, it.settings, string(it.text)),
                );
                js_TextTrackCue::set_region(
                    cue,
                    it.region
                        .and_then(|it| VTTRegion::from_js(heap, regions.get(it as u32))),
                );
                self.insert(heap, cue);
            }
            self.cues_changed(cx);
        }
        self.readiness.set(if file.is_some() {
            Readiness::Loaded
        } else {
            Readiness::Failed
        });
        self.is_processing.set(false);
        fire(
            cx,
            element,
            if file.is_some() {
                atom!("load")
            } else {
                atom!("error")
            },
            Default::default(),
        );
        self.process(&cx.heap);
    }
}

#[repr(C)]
pub(crate) struct TextTrackCue {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_TextTrackCue::Fields,
    id: RefCell<DomString>,
    times: Cell<[f64; 2]>,
    pauses_on_exit: Cell<bool>,
    pub(super) is_active: Cell<bool>,
    /// https://html.spec.whatwg.org/#list-of-newly-introduced-cues
    is_new: Cell<bool>,
    order: Cell<u32>,
}

fn check_end_time(time: f64) -> core::result::Result<(), Failure> {
    if time.is_nan() || time == f64::NEG_INFINITY {
        Err(Failure::Type(
            "The end time is not a number or negative infinity.",
        ))
    } else {
        Ok(())
    }
}

impl TextTrackCue {
    fn leave_track(&self) {
        self.is_active.set(false);
        js_TextTrackCue::set_track(self, None);
    }

    #[optimize(size)]
    fn set_time<'a>(&'a self, cx: Cx<'_, 'a>, at: usize, time: f64) {
        self.times.update(|mut it| {
            it[at] = time;
            it
        });
        if let Some(track) = js_TextTrackCue::track(self) {
            track.list().remove(&cx.heap, self.to_js());
            track.place(&cx.heap, self);
            track.cues_changed(cx);
        }
    }

    fn looks_changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        if let Some(player) = js_TextTrackCue::track(self)
            .and_then(TextTrack::player)
            .filter(|_| self.is_active.get())
        {
            js_TextTrackCue::set_display(self, None);
            player.render_cues(cx);
        }
    }

    pub(crate) fn get_id(&self) -> DomString {
        self.id.borrow().clone()
    }

    pub(crate) fn set_id<'a>(&'a self, cx: Cx<'_, 'a>, id: DomString) {
        self.id.replace(id);
        self.looks_changed(cx);
    }

    pub(crate) fn get_start_time(&self) -> f64 {
        self.times.get()[0]
    }

    pub(crate) fn set_start_time<'a>(&'a self, cx: Cx<'_, 'a>, time: f64) {
        self.set_time(cx, 0, time);
    }

    pub(crate) fn get_end_time(&self) -> f64 {
        self.times.get()[1]
    }

    pub(crate) fn set_end_time<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        time: f64,
    ) -> core::result::Result<(), Failure> {
        check_end_time(time).map(|()| self.set_time(cx, 1, time))
    }

    pub(crate) fn get_pause_on_exit(&self) -> bool {
        self.pauses_on_exit.get()
    }

    pub(crate) fn set_pause_on_exit(&self, value: bool) {
        self.pauses_on_exit.set(value);
    }
}

#[repr(C)]
pub(crate) struct VTTCue {
    pub(crate) base: TextTrackCue,
    pub(super) settings: Cell<CueSettings>,
    pub(super) text: RefCell<DomString>,
}

macro_rules! settings {
    ($class:ident $($get:ident $set:ident $field:ident $([$at:literal])?: $type:ty;)*) => {
        impl $class {
            $(pub(crate) fn $get(&self) -> $type {
                self.settings.get().$field$([$at])?
            }

            pub(crate) fn $set<'a>(&'a self, cx: Cx<'_, 'a>, value: $type) {
                self.change(cx, |it| it.$field$([$at])? = value);
            })*
        }
    };
}

macro_rules! percentages {
    ($class:ident $($get:ident $set:ident $field:ident $([$at:literal])?;)*) => {
        impl $class {
            $(pub(crate) fn $get(&self) -> f64 {
                self.settings.get().$field$([$at])?
            }

            pub(crate) fn $set<'a>(&'a self, cx: Cx<'_, 'a>, value: f64) -> core::result::Result<(), Failure> {
                check_percentage(value).map(|()| self.change(cx, |it| it.$field$([$at])? = value))
            })*
        }
    };
}

settings! { VTTCue
    get_vertical set_vertical vertical: DirectionSetting;
    get_snap_to_lines set_snap_to_lines snaps_to_lines: bool;
    get_line_align set_line_align line_align: LineAlignSetting;
    get_position_align set_position_align position_align: PositionAlignSetting;
    get_align set_align align: AlignSetting;
}
percentages! { VTTCue get_size set_size size; }

fn check_percentage(value: f64) -> core::result::Result<(), Failure> {
    if (0.0..=100.0).contains(&value) {
        Ok(())
    } else {
        Err(Failure::index_size(
            "The value is outside the range [0, 100].",
        ))
    }
}

fn number_or_auto(heap: &JsHeap<'_>, value: Option<f64>) -> JSValue {
    value.map_or_else(
        || DomString::from("auto").to_js(heap).to_js(),
        JSValue::js_number,
    )
}

impl LineAndPositionSetting {
    fn number(self) -> Option<f64> {
        if let LineAndPositionSetting::Number(it) = self {
            Some(it)
        } else {
            None
        }
    }
}

impl VTTCue {
    #[optimize(size)]
    fn new(id: DomString, times: [f64; 2], settings: CueSettings, text: DomString) -> VTTCue {
        let (base, fields, pauses_on_exit, is_active, is_new, order) = Default::default();
        let base = TextTrackCue {
            base,
            fields,
            id: id.into(),
            times: times.into(),
            pauses_on_exit,
            is_active,
            is_new,
            order,
        };
        VTTCue {
            base,
            settings: settings.into(),
            text: text.into(),
        }
    }

    pub(crate) fn constructor(
        start: f64,
        end: f64,
        text: DomString,
    ) -> core::result::Result<VTTCue, Failure> {
        check_end_time(end).map(|()| {
            VTTCue::new(
                DomString::default(),
                [start, end],
                CueSettings::default(),
                text,
            )
        })
    }

    fn change<'a>(&'a self, cx: Cx<'_, 'a>, change: impl FnOnce(&mut CueSettings)) {
        let mut settings = self.settings.get();
        change(&mut settings);
        self.settings.set(settings);
        self.looks_changed(cx);
    }

    pub(crate) fn get_region(&self) -> Option<&VTTRegion> {
        js_TextTrackCue::region(self)
    }

    pub(crate) fn set_region<'a>(&'a self, cx: Cx<'_, 'a>, region: Option<&'a VTTRegion>) {
        js_TextTrackCue::set_region(self, region);
        self.looks_changed(cx);
    }

    pub(crate) fn get_line(&self, heap: &JsHeap<'_>) -> JSValue {
        number_or_auto(heap, self.settings.get().line)
    }

    pub(crate) fn set_line<'a>(&'a self, cx: Cx<'_, 'a>, line: LineAndPositionSetting) {
        self.change(cx, |it| it.line = line.number());
    }

    pub(crate) fn get_position(&self, heap: &JsHeap<'_>) -> JSValue {
        number_or_auto(heap, self.settings.get().position)
    }

    pub(crate) fn set_position<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        position: LineAndPositionSetting,
    ) -> core::result::Result<(), Failure> {
        let position = position.number();
        position
            .map_or(Ok(()), check_percentage)
            .map(|()| self.change(cx, |it| it.position = position))
    }

    pub(crate) fn get_text(&self) -> DomString {
        self.text.borrow().clone()
    }

    pub(crate) fn set_text<'a>(&'a self, cx: Cx<'_, 'a>, text: DomString) {
        self.text.replace(text);
        self.looks_changed(cx);
    }

    #[optimize(size)]
    pub(crate) fn get_cue_as_html<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, &'a DocumentFragment> {
        let fragment = current_document(cx)?.create_fragment(&cx.heap);
        webvtt::append_cue_text(cx, fragment, &self.get_text(), None);
        if self.text.borrow().is_empty() {
            append_detached(
                fragment,
                fragment.doc().create_text(&cx.heap, DomString::default()),
            );
        }
        Ok(fragment)
    }
}

#[derive(Default)]
pub(crate) struct VTTRegion {
    id: RefCell<DomString>,
    pub(super) settings: Cell<RegionSettings>,
}

settings! { VTTRegion
    get_lines set_lines lines: u32;
    get_scroll set_scroll scroll: ScrollSetting;
}
percentages! { VTTRegion
    get_width set_width width;
    get_region_anchor_x set_region_anchor_x anchor[0];
    get_region_anchor_y set_region_anchor_y anchor[1];
    get_viewport_anchor_x set_viewport_anchor_x viewport_anchor[0];
    get_viewport_anchor_y set_viewport_anchor_y viewport_anchor[1];
}

impl VTTRegion {
    pub(crate) fn constructor() -> VTTRegion {
        VTTRegion::default()
    }

    fn change(&self, _: Cx<'_, '_>, change: impl FnOnce(&mut RegionSettings)) {
        let mut settings = self.settings.get();
        change(&mut settings);
        self.settings.set(settings);
    }

    pub(crate) fn get_id(&self) -> DomString {
        self.id.borrow().clone()
    }

    pub(crate) fn set_id(&self, id: DomString) {
        self.id.replace(id);
    }
}

pub(crate) struct TextTrackCueList {
    is_of_active: bool,
    _interior: bun_jsc::bindgen::Interior,
}

impl TextTrackCueList {
    fn cues(&self) -> impl Iterator<Item = &TextTrackCue> {
        js_TextTrackCueList::track(self)
            .into_iter()
            .flat_map(TextTrack::cues)
            .map(|it| &**it)
            .filter(|it| !self.is_of_active || it.is_active.get())
    }

    pub(crate) fn get_length(&self) -> u32 {
        match js_TextTrackCueList::track(self) {
            Some(track) if !self.is_of_active => track.list().len(),
            _ => self.cues().count() as u32,
        }
    }

    pub(crate) fn indexed_get<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        index: u32,
    ) -> Option<&'a TextTrackCue> {
        match js_TextTrackCueList::track(self)?.list() {
            all if !self.is_of_active => {
                (index < all.len()).then(|| TextTrackCue::from_js(heap, all.get(index)))?
            }
            _ => self.cues().nth(index as usize),
        }
    }

    pub(crate) fn get_cue_by_id(&self, id: &[u8]) -> Option<&TextTrackCue> {
        self.cues()
            .find(|it| !id.is_empty() && it.id.borrow().to_utf8().as_bytes() == id)
    }
}

impl TextTrackList {
    fn tracks(&self) -> impl Iterator<Item = &TextTrack> {
        js_TextTrackList::player(self)
            .into_iter()
            .flat_map(Player::tracks)
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.tracks().count() as u32
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<&TextTrack> {
        self.tracks().nth(index as usize)
    }

    pub(crate) fn get_track_by_id(&self, id: &[u8]) -> Option<&TextTrack> {
        self.tracks()
            .find(|it| it.get_id().to_utf8().as_bytes() == id)
    }
}

#[repr(C)]
pub(crate) struct TrackEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_TrackEvent::Fields,
}

impl TrackEvent {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: JsAtom<'a>,
        init: &TrackEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let event = structure.create(
            heap,
            TrackEvent {
                base,
                fields: Default::default(),
            },
        );
        js_TrackEvent::set_track(event, init.track);
        event
    }
}

impl HTMLTrackElement {
    pub(crate) fn get_ready_state<'a>(&'a self, heap: &JsHeap<'a>) -> u16 {
        TextTrack::of_element(heap, self).readiness.get() as u16
    }

    pub(crate) fn get_track<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TextTrack {
        TextTrack::of_element(heap, self)
    }
}

impl HTMLMediaElement {
    pub(crate) fn get_text_tracks<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TextTrackList {
        Player::of_element(heap, self).text_tracks(heap)
    }

    pub(crate) fn add_text_track<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: TextTrackKind,
        label: DomString,
        language: DomString,
    ) -> &'a TextTrack {
        let track = TextTrack::new(
            self.doc().heap(&cx.heap),
            (kind, label, language),
            TextTrackMode::Hidden,
            Readiness::Loaded,
        );
        Player::of_element(&cx.heap, self).add_track(&cx.heap, track, u32::MAX);
        track
    }
}

impl Player {
    pub(super) fn tracks(&self) -> impl Iterator<Item = &TextTrack> {
        // SAFETY: nothing else is put in the list.
        js_MediaPlayer::tracks(self)
            .into_iter()
            .flat_map(|it| List::from_value(it).values())
            .map(|it| unsafe { TextTrack::from_js_unchecked(it) })
    }

    pub(super) fn active_cues(&self) -> impl Iterator<Item = &VTTCue> {
        self.tracks()
            .flat_map(TextTrack::cues)
            .filter(|it| it.is_active.get())
    }

    #[optimize(size)]
    fn text_tracks<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TextTrackList {
        let list = js_MediaPlayer::track_list(self).unwrap_or_else(|| {
            js_TextTrackList::create(self.element().doc().heap(heap), Default::default())
        });
        js_TextTrackList::set_player(list, Some(self));
        js_MediaPlayer::set_track_list(self, Some(list));
        list
    }

    #[optimize(size)]
    fn queue_track_event(&self, name: Known, track: &TextTrack) {
        self.queue_always(track.to_js(), move |cx, player, track| {
            let (list, base) = (
                player.text_tracks(&cx.heap),
                Event::base(name, Default::default(), Trusted::Yes),
            );
            let event = js_TrackEvent::create(
                list.realm(&cx.heap),
                TrackEvent {
                    base,
                    fields: Default::default(),
                },
            );
            js_TrackEvent::set_track(event, TextTrack::from_js(&cx.heap, track));
            dispatch(cx, list, event);
        });
    }

    #[optimize(size)]
    fn add_track<'a>(&'a self, heap: &JsHeap<'a>, track: &'a TextTrack, index: u32) {
        let list = js_MediaPlayer::tracks(self).map_or_else(|| List::new(heap), List::from_value);
        list.insert(heap, index.min(list.len()), track.to_js());
        js_MediaPlayer::set_tracks(self, list.to_js());
        js_TextTrack::set_player(track, Some(self));
        self.queue_track_event(atom!("addtrack"), track);
    }

    #[optimize(size)]
    fn remove_track<'a>(&'a self, cx: Cx<'_, 'a>, track: &'a TextTrack) {
        js_MediaPlayer::tracks(self)
            .into_iter()
            .for_each(|it| _ = List::from_value(it).remove(&cx.heap, track.to_js()));
        js_TextTrack::set_player(track, None);
        track.cues().for_each(|it| it.is_active.set(false));
        self.queue_track_event(atom!("removetrack"), track);
        self.cues_changed(cx);
        self.tracks_settled(cx);
    }

    /// https://html.spec.whatwg.org/#honor-user-preferences-for-automatic-text-track-selection
    #[optimize(size)]
    pub(super) fn select_tracks<'a>(&'a self, cx: Cx<'_, 'a>) {
        use TextTrackKind::*;
        let is_candidate = |it: &&TextTrack| it.is_default() && !it.is_configured.get();
        for kinds in [[Subtitles, Captions], [Descriptions; 2]] {
            let candidates = || self.tracks().filter(|it| kinds.contains(&it.get_kind()));
            if !candidates().any(|it| it.mode.get() == TextTrackMode::Showing) {
                candidates()
                    .find(is_candidate)
                    .into_iter()
                    .for_each(|it| it.set_mode(cx, TextTrackMode::Showing));
            }
        }
        self.tracks()
            .filter(|it| matches!(it.get_kind(), Chapters | Metadata))
            .filter(is_candidate)
            .for_each(|it| it.set_mode(cx, TextTrackMode::Hidden));
        self.tracks().for_each(|it| it.is_configured.set(true));
    }

    /// https://html.spec.whatwg.org/#the-text-tracks-are-ready
    pub(super) fn are_tracks_ready(&self) -> bool {
        let is_pending = |it: &TextTrack| {
            it.is_processing.get() && it.mode.get() != TextTrackMode::Disabled
                || it.is_default() && !it.is_configured.get()
        };
        !self.element().has(NodeFlags::BEING_PARSED) && !self.tracks().any(is_pending)
    }

    pub(super) fn deactivate_cues<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.active_cues().for_each(|it| it.is_active.set(false));
        self.marched_to.take();
        self.render_cues(cx);
    }

    fn cues_changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.shows_poster.get() {
            self.time_marches_on(cx);
        }
        self.render_cues(cx);
    }

    /// https://html.spec.whatwg.org/#time-marches-on
    #[optimize(size)]
    pub(super) fn time_marches_on<'a>(&'a self, cx: Cx<'_, 'a>) {
        if js_MediaPlayer::tracks(self).is_none() {
            return;
        }
        let last = self.marched_to.get().filter(|_| !self.is_seeking.get());
        let now = self.time().max(last.unwrap_or(0.0));
        self.marched_to.set(Some(now));
        let (mut events, affected, mut pauses, mut next) =
            (Vec::new(), List::new(&cx.heap), false, f64::INFINITY);
        for track in self
            .tracks()
            .filter(|it| it.mode.get() != TextTrackMode::Disabled)
        {
            let known = events.len();
            for cue in track.cues() {
                let [start, end] = cue.times.get();
                let (is_current, order) = (start <= now && end > now, events.len());
                let is_missed = !cue.is_new.take()
                    && !is_current
                    && last.is_some_and(|it| start > it && end.max(start) <= now);
                let was_active = cue.is_active.replace(is_current);
                if !was_active && (is_current || is_missed) {
                    events.push((start, order, atom!("enter"), cue.to_js()));
                }
                if !is_current && (was_active || is_missed) {
                    events.push((end.max(start), order + 1, atom!("exit"), cue.to_js()));
                    pauses |= last.is_some() && cue.pauses_on_exit.get();
                }
                next = [start, end]
                    .into_iter()
                    .filter(|it| *it > now)
                    .fold(next, f64::min);
            }
            if events.len() > known {
                affected.push(&cx.heap, track.to_js());
            }
        }
        if pauses {
            self.pause(cx);
        }
        events.order_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        for (.., name, cue) in events {
            self.queue(cue, move |cx, _, cue| {
                TextTrackCue::from_js(&cx.heap, cue)
                    .into_iter()
                    .for_each(|it| _ = fire(cx, it, name, Default::default()))
            });
        }
        for track in affected.values() {
            self.queue(track, |cx, _, track| {
                let Some(track) = TextTrack::from_js(&cx.heap, track) else {
                    return;
                };
                fire(cx, track, atom!("cuechange"), Default::default());
                js_TextTrack::element(track)
                    .into_iter()
                    .for_each(|it| _ = fire(cx, it, atom!("cuechange"), Default::default()));
            });
        }
        if !affected.is_empty() {
            self.render_cues(cx);
        }
        let next_timestamp = self.mark_past_and_future(cx, now);
        self.march_again_at(&cx.heap, next.min(next_timestamp));
    }
}

pub(crate) static TRACK_STEPS: Steps = Steps {
    parent_changed: Some(|cx, element, _| {
        let track = TextTrack::of_element(&cx.heap, element);
        track
            .player()
            .into_iter()
            .for_each(|it| it.remove_track(cx, track));
        let Some(player) = element
            .parent()
            .and_then(|it| Player::of(&cx.heap, it.to_js()))
        else {
            return;
        };
        let before = core::iter::successors(element.previous_sibling(), |it| it.previous_sibling())
            .filter(|it| it.is_html(atom!("track")));
        player.add_track(&cx.heap, track, before.count() as u32);
        player.queue_always(JSValue::UNDEFINED, |cx, player, _| {
            if !player.element().has(NodeFlags::BEING_PARSED) {
                player.select_tracks(cx);
                player.tracks_settled(cx);
            }
        });
        track.process(&cx.heap);
        player.cues_changed(cx);
    }),
    attribute_changed: Some(|cx, element, change| match change.known() {
        atom!("src") if change.old != change.new => {
            let track = TextTrack::of_element(&cx.heap, element);
            track.empty(cx);
            if track.readiness.get() == Readiness::Loading {
                track.aborted_loads.update(|it| it + 1);
                track.finish(home_of(&cx.heap, element), None);
            }
            track.process(&cx.heap);
        }
        atom!("kind") => TextTrack::of_element(&cx.heap, element).cues_changed(cx),
        _ => {}
    }),
    ..Steps::NONE
};

pub(super) fn home_of<'a>(heap: &JsHeap<'a>, node: &'a Node) -> &'a Doc {
    let document = node.doc();
    let shown = || crate::api::events::WindowTarget::of_realm(document.heap(heap))?.doc();
    if document.has_page() {
        document
    } else {
        shown().unwrap_or(document)
    }
}
