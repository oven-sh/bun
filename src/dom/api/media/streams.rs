//! https://w3c.github.io/mediacapture-main/

use bun_jsc::bindgen::{ClassStructure, DomException, JsList, JsStringImpl};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSObject, JSString, StringJsc as _};

use super::*;
use crate::api::audio::AudioNode;
use crate::api::core::DomString;
use crate::generated_bindgen::media::{OverconstrainedError, js_OverconstrainedError};

fn new_id() -> Box<[u8]> {
    VirtualMachine::get()
        .rare_data()
        .next_uuid()
        .to_string()
        .into_bytes()
        .into()
}

fn parse<'a>(cx: Cx<'_, 'a>, json: &[u8]) -> Result<'a, JSValue> {
    Ok(
        bun_core::String::clone_utf8(if json.is_empty() { b"{}" } else { json })
            .to_js_by_parse_json(cx.global())?,
    )
}

/// For the engine, which checks them.
#[optimize(size)]
fn stringify<'a>(cx: Cx<'_, 'a>, constraints: JSValue) -> Result<'a, Box<[u8]>> {
    if constraints.is_object() {
        Ok(constraints
            .json_stringify(cx.global(), 0)?
            .to_utf8()
            .slice()
            .into())
    } else {
        Ok(b"{}"[..].into())
    }
}

#[repr(C)]
pub(crate) struct MediaException(pub(crate) DomException);

impl OverconstrainedError {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        constraint: JsLocal<'a, JSString>,
        message: JsStringImpl<'a>,
    ) -> &'a Self {
        let made = structure.create(
            heap,
            MediaException(DomException::new(message.get(), "OverconstrainedError")),
        );
        js_OverconstrainedError::set_constraint(made, constraint.to_js());
        made
    }

    fn new(heap: &JsHeap<'_>, constraint: &[u8], message: &str) -> JSValue {
        let made = js_OverconstrainedError::create(
            heap,
            MediaException(DomException::new(
                DomString::from_utf8(message).as_impl(),
                "OverconstrainedError",
            )),
        );
        js_OverconstrainedError::set_constraint(made, host::string(heap, constraint));
        made.to_js()
    }
}

#[optimize(size)]
pub(super) fn error_from<'a>(
    cx: Cx<'_, 'a>,
    name: &[u8],
    message: &[u8],
    constraint: &[u8],
) -> Result<'a, JSValue> {
    use DOMExceptionCode::*;
    let text = crate::values::text(message);
    let code = match name {
        b"OverconstrainedError" => {
            return Ok(OverconstrainedError::new(&cx.heap, constraint, text));
        }
        b"RangeError" => return cx.catch(cx.heap.range_error(format_args!("{text}"))),
        b"TypeError" => return cx.catch(cx.heap.type_error(format_args!("{text}"))),
        b"AbortError" => AbortError,
        b"EncodingError" => EncodingError,
        b"InvalidStateError" => InvalidStateError,
        b"NotAllowedError" => NotAllowedError,
        b"NotFoundError" => NotFoundError,
        b"NotReadableError" => NotReadableError,
        b"NotSupportedError" => NotSupportedError,
        _ => UnknownError,
    };
    Ok(cx
        .heap
        .create_dom_exception(code, format_args!("{text}"))
        .to_js())
}

#[derive(Clone, Default)]
struct Description {
    label: Box<[u8]>,
    is_muted: bool,
    settings: Box<[u8]>,
    capabilities: Box<[u8]>,
}

impl From<&Message<'_>> for Description {
    fn from(it: &Message<'_>) -> Description {
        Description {
            label: it.text(0).into(),
            is_muted: it.text(1) == b"true",
            settings: it.text(2).into(),
            capabilities: it.text(3).into(),
        }
    }
}

/// The field `source` has the node whose input it is, if it is not a recording.
#[repr(C)]
pub(crate) struct MediaStreamTrack {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_MediaStreamTrack::Fields,
    remote: Remote,
    id: Box<[u8]>,
    is_enabled: Cell<bool>,
    state: Cell<MediaStreamTrackState>,
    content_hint: RefCell<Box<[u8]>>,
    constraints: RefCell<Box<[u8]>>,
    description: RefCell<Description>,
}

impl Mirrored for MediaStreamTrack {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        js_MediaStreamTrack::source(self)
            .into_iter()
            .for_each(|it| self.remote.send("trackOf", &[it.copy(heap).object()]));
    }

    fn heard<'a>(&'a self, cx: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        if message.kind == b"ended" {
            return self.lost(cx);
        }
        let is_muted = message.kind == b"mute";
        self.description.borrow_mut().is_muted = is_muted;
        fire(
            cx,
            self,
            if is_muted {
                atom!("mute")
            } else {
                atom!("unmute")
            },
            Default::default(),
        );
        Ok(())
    }

    fn lost<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        if self.is_live() && js_MediaStreamTrack::source(self).is_none() {
            self.stop(&cx.heap);
            fire(cx, self, atom!("ended"), Default::default());
        }
        Ok(())
    }
}

impl MediaStreamTrack {
    fn new<'a>(
        heap: &JsHeap<'a>,
        link: &Rc<Link>,
        description: Description,
        constraints: Box<[u8]>,
    ) -> &'a MediaStreamTrack {
        let track = MediaStreamTrack {
            base: Default::default(),
            fields: Default::default(),
            remote: Remote::new(Rc::clone(link)),
            id: new_id(),
            is_enabled: Cell::new(true),
            state: Cell::new(MediaStreamTrackState::Live),
            content_hint: RefCell::default(),
            constraints: RefCell::new(constraints),
            description: RefCell::new(description),
        };
        js_MediaStreamTrack::create(heap, track)
    }

    pub(crate) fn of_node<'a>(heap: &JsHeap<'a>, node: &'a AudioNode) -> &'a MediaStreamTrack {
        let description = Description {
            label: b"MediaStreamAudioDestinationNode"[..].into(),
            ..Default::default()
        };
        let track = MediaStreamTrack::new(heap, &node.remote().link, description, Box::default());
        js_MediaStreamTrack::set_source(track, Some(node));
        track
    }

    pub(crate) fn keep_while_live(&self, heap: &JsHeap<'_>, user: JSValue) {
        let users =
            js_MediaStreamTrack::users(self).map_or_else(|| List::new(heap), List::from_value);
        users.push(heap, user);
        js_MediaStreamTrack::set_users(self, users.to_js());
    }

    fn is_live(&self) -> bool {
        self.state.get() == MediaStreamTrackState::Live
    }

    pub(crate) fn get_kind(&self) -> &'static [u8] {
        b"audio"
    }

    pub(crate) fn get_id(&self) -> &[u8] {
        &self.id
    }

    pub(crate) fn get_label(&self) -> Vec<u8> {
        self.description.borrow().label.to_vec()
    }

    pub(crate) fn get_enabled(&self) -> bool {
        self.is_enabled.get()
    }

    pub(crate) fn set_enabled(&self, value: bool) {
        self.is_enabled.set(value);
        self.remote.set("enabled", Arg::Flag(value));
    }

    pub(crate) fn get_content_hint(&self) -> Vec<u8> {
        self.content_hint.borrow().to_vec()
    }

    #[optimize(size)]
    pub(crate) fn set_content_hint(&self, value: &[u8]) {
        if let b"" | b"speech" | b"speech-recognition" | b"music" = value {
            self.content_hint.replace(value.into());
            self.remote.set("contentHint", Arg::Text(value));
        }
    }

    pub(crate) fn get_muted(&self) -> bool {
        self.description.borrow().is_muted
    }

    pub(crate) fn get_ready_state(&self) -> MediaStreamTrackState {
        self.state.get()
    }

    #[optimize(size)]
    pub(crate) fn clone<'a>(&'a self, heap: &JsHeap<'a>) -> &'a MediaStreamTrack {
        let copy = MediaStreamTrack::new(
            heap,
            &self.remote.link,
            self.description.borrow().clone(),
            self.constraints.borrow().clone(),
        );
        copy.is_enabled.set(self.is_enabled.get());
        copy.state.set(self.state.get());
        if self.is_live() {
            copy.copy(heap).send("clone", &[self.copy(heap).object()]);
            copy.set_busy(heap, true);
        }
        copy
    }

    pub(crate) fn stop(&self, heap: &JsHeap<'_>) {
        self.state.set(MediaStreamTrackState::Ended);
        js_MediaStreamTrack::set_users(self, JSValue::ZERO);
        self.drop_copy(heap);
    }

    pub(crate) fn get_capabilities<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        parse(cx, &self.description.borrow().capabilities)
    }

    pub(crate) fn get_constraints<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        parse(cx, &self.constraints.borrow())
    }

    pub(crate) fn get_settings<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        parse(cx, &self.description.borrow().settings)
    }

    pub(crate) fn apply_constraints<'a>(
        &self,
        cx: Cx<'_, 'a>,
        constraints: Option<JsLocal<'a, JSObject>>,
    ) -> Result<'a, JSValue> {
        let constraints = stringify(cx, constraints.map_or(JSValue::UNDEFINED, JsLocal::to_js))?;
        if !self.remote.is_copied() {
            self.constraints.replace(constraints);
            return cx.promise_resolve(JSValue::UNDEFINED).map(JsLocal::to_js);
        }
        let kept = constraints.clone();
        let applied = self.remote.link.ask(
            &cx.heap,
            "constrain",
            &[self.remote.object(), Arg::Json(&constraints)],
            self.to_js(),
            |cx, this, reply| {
                if let Some(this) = MediaStreamTrack::from_js(&cx.heap, this) {
                    this.description.replace(reply.into());
                    this.constraints.replace(kept);
                }
                Ok(JSValue::UNDEFINED)
            },
        );
        Ok(applied.to_js())
    }
}

#[repr(C)]
pub(crate) struct MediaStream {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_MediaStream::Fields,
    remote: Remote,
    id: Box<[u8]>,
}

impl Mirrored for MediaStream {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        let live: Vec<_> = self
            .tracks()
            .filter(|it| it.is_live())
            .map(|it| it.copy(heap).object())
            .collect();
        self.remote.send("stream", &[Arg::List(&live)]);
    }
}

impl MediaStream {
    fn new(link: Rc<Link>) -> MediaStream {
        MediaStream {
            base: Default::default(),
            fields: Default::default(),
            remote: Remote::new(link),
            id: new_id(),
        }
    }

    fn with_tracks<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        tracks: impl Iterator<Item = &'a MediaStreamTrack>,
    ) -> &'a MediaStream {
        js_MediaStream::set_tracks(self, List::new(heap).to_js());
        tracks.for_each(|it| self.add_track(heap, it));
        self
    }

    pub(crate) fn of_track<'a>(heap: &JsHeap<'a>, track: &'a MediaStreamTrack) -> &'a MediaStream {
        js_MediaStream::create(heap, MediaStream::new(Rc::clone(&track.remote.link)))
            .with_tracks(heap, [track].into_iter())
    }

    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
    ) -> Result<'a, &'a Self> {
        let link = current_link(cx)?;
        Ok(structure
            .create(&cx.heap, MediaStream::new(link))
            .with_tracks(&cx.heap, [].into_iter()))
    }

    pub(crate) fn construct_from_stream<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        stream: &'a MediaStream,
    ) -> Result<'a, &'a Self> {
        Self::constructor(cx, structure).map(|it| it.with_tracks(&cx.heap, stream.tracks()))
    }

    pub(crate) fn construct_from_tracks<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        tracks: JsList<'a, &'a MediaStreamTrack>,
    ) -> Result<'a, &'a Self> {
        Self::constructor(cx, structure).map(|it| it.with_tracks(&cx.heap, tracks.iter()))
    }

    #[optimize(size)]
    fn list(&self) -> List<'_> {
        List::from_value(js_MediaStream::tracks(self).unwrap_or_default())
    }

    pub(crate) fn tracks(&self) -> impl Iterator<Item = &MediaStreamTrack> {
        // SAFETY: what `add_track` put there.
        self.list()
            .values()
            .map(|it| unsafe { MediaStreamTrack::from_js_unchecked(it) })
    }

    pub(crate) fn get_id(&self) -> &[u8] {
        &self.id
    }

    pub(crate) fn get_tracks(&self) -> impl Iterator<Item = &MediaStreamTrack> {
        self.tracks()
    }

    pub(crate) fn get_audio_tracks(&self) -> impl Iterator<Item = &MediaStreamTrack> {
        self.tracks()
    }

    pub(crate) fn get_video_tracks(&self) -> Option<&MediaStreamTrack> {
        None
    }

    pub(crate) fn get_track_by_id(&self, id: &[u8]) -> Option<&MediaStreamTrack> {
        self.tracks().find(|it| *it.id == *id)
    }

    pub(crate) fn add_track<'a>(&self, heap: &JsHeap<'a>, track: &'a MediaStreamTrack) {
        if !self.list().contains(track.to_js()) {
            self.list().push(heap, track.to_js());
            if self.remote.is_copied() && track.is_live() {
                self.remote.invoke("addTrack", &[track.copy(heap).object()]);
            }
        }
    }

    pub(crate) fn remove_track(&self, heap: &JsHeap<'_>, track: &MediaStreamTrack) {
        if self.list().remove(heap, track.to_js()) && track.remote.is_copied() {
            self.remote.invoke("removeTrack", &[track.remote.object()]);
        }
    }

    #[optimize(size)]
    pub(crate) fn clone<'a>(&'a self, heap: &JsHeap<'a>) -> &'a MediaStream {
        js_MediaStream::create(heap, MediaStream::new(Rc::clone(&self.remote.link)))
            .with_tracks(heap, self.tracks().map(|it| it.clone(heap)))
    }

    pub(crate) fn get_active(&self) -> bool {
        self.tracks().any(MediaStreamTrack::is_live)
    }
}

#[derive(Clone)]
pub(crate) struct MediaDeviceInfo {
    device_id: Box<[u8]>,
    kind: MediaDeviceKind,
    label: Box<[u8]>,
    group_id: Box<[u8]>,
}

impl MediaDeviceInfo {
    pub(crate) fn get_device_id(&self) -> &[u8] {
        &self.device_id
    }

    pub(crate) fn get_kind(&self) -> MediaDeviceKind {
        self.kind
    }

    pub(crate) fn get_label(&self) -> &[u8] {
        &self.label
    }

    pub(crate) fn get_group_id(&self) -> &[u8] {
        &self.group_id
    }
}

#[repr(C)]
pub(crate) struct MediaDevices {
    pub(crate) base: EventTarget,
    known: RefCell<Vec<MediaDeviceInfo>>,
}

impl crate::generated_bindgen::window::DomNavigator {
    pub(crate) fn get_media_devices<'a>(&'a self, heap: &JsHeap<'a>) -> &'a MediaDevices {
        MediaDevices::new(self.realm(heap))
    }
}

impl MediaDevices {
    fn new<'a>(heap: &JsHeap<'a>) -> &'a MediaDevices {
        let anonymous = |kind| MediaDeviceInfo {
            device_id: Box::default(),
            kind,
            label: Box::default(),
            group_id: Box::default(),
        };
        let known = RefCell::new(vec![
            anonymous(MediaDeviceKind::Audioinput),
            anonymous(MediaDeviceKind::Audiooutput),
        ]);
        js_MediaDevices::create(
            heap,
            MediaDevices {
                base: Default::default(),
                known,
            },
        )
    }

    #[optimize(size)]
    fn list<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        let known = self.known.borrow().clone();
        heap.create_array(known, |heap, it| {
            Ok(js_MediaDeviceInfo::create(heap, it)
                .as_object(heap)
                .as_value())
        })
        .map(JsLocal::to_js)
    }

    /// The engine is not started for a page that is just curious.
    #[optimize(size)]
    pub(crate) fn enumerate_devices<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let document = current_document(cx)?;
        let link = Link::of(&cx.heap, document);
        if !host::may_list_devices(cx, document, link.is_connected()) {
            return self
                .list(&cx.heap)
                .and_then(|it| cx.promise_resolve(it))
                .map(JsLocal::to_js);
        }
        let devices = link.ask(&cx.heap, "devices", &[], self.to_js(), |cx, this, reply| {
            let Some(this) = MediaDevices::from_js(&cx.heap, this) else {
                return Ok(JSValue::UNDEFINED);
            };
            let device = |[device_id, kind, label, group_id]: [&[u8]; 4]| MediaDeviceInfo {
                device_id: device_id.into(),
                kind: if kind == b"audioinput" {
                    MediaDeviceKind::Audioinput
                } else {
                    MediaDeviceKind::Audiooutput
                },
                label: label.into(),
                group_id: group_id.into(),
            };
            this.known.replace(
                reply
                    .parts
                    .as_chunks()
                    .0
                    .iter()
                    .copied()
                    .map(device)
                    .collect(),
            );
            this.list(&cx.heap)
        });
        Ok(devices.to_js())
    }

    pub(crate) fn get_supported_constraints(&self) -> MediaTrackSupportedConstraints {
        MediaTrackSupportedConstraints {
            auto_gain_control: true,
            channel_count: true,
            device_id: true,
            echo_cancellation: true,
            group_id: true,
            latency: true,
            noise_suppression: true,
            sample_rate: true,
            sample_size: true,
            voice_isolation: true,
        }
    }

    #[optimize(size)]
    pub(crate) fn get_user_media<'a>(
        &self,
        cx: Cx<'_, 'a>,
        constraints: &MediaStreamConstraints<'a>,
    ) -> Result<'a, JSValue> {
        let [audio, video] = [constraints.audio, constraints.video]
            .map(|it| it.to_js().is_null() || it.to_js().to_boolean());
        let document = current_document(cx)?;
        let failure = match () {
            () if !audio && !video => {
                Failure::Type("At least one of audio and video must be requested.")
            }
            () if !document.is_fully_active() => {
                Failure::invalid_state("The document is not active.")
            }
            () if video => Failure::Dom(
                DOMExceptionCode::NotFoundError,
                "Requested device not found",
            ),
            () => {
                let wanted = stringify(cx, constraints.audio.to_js())?;
                let track = MediaStreamTrack::new(
                    &cx.heap,
                    &Link::of(&cx.heap, document),
                    Description::default(),
                    wanted,
                );
                let (stream, permission) = (
                    cx.heap.create_promise().to_js(),
                    host::request_microphone(cx, document)?,
                );
                let capture = cx.heap.create_callback(capture, [track.to_js(), stream], 0);
                permission.react(&cx.heap, Some(capture), Some(capture));
                return Ok(stream);
            }
        };
        Err(failure.into_error(&cx.heap))
    }

    pub(crate) fn get_display_media(
        &self,
        _: &JsHeap<'_>,
    ) -> core::result::Result<JSValue, Failure> {
        Err(Failure::Dom(
            DOMExceptionCode::NotSupportedError,
            "Not supported",
        ))
    }
}

#[optimize(size)]
fn capture<'a>(
    cx: Cx<'_, 'a>,
    [track, stream]: [JsLocal<'a>; 2],
    _: u64,
    is_granted: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(track), Some(stream)) = (
        MediaStreamTrack::from_js(&cx.heap, track.to_js()),
        stream.as_promise(),
    ) else {
        return Ok(JSValue::UNDEFINED);
    };
    if is_granted[0].to_js() != JSValue::TRUE {
        let error = cx.heap.create_dom_exception(
            DOMExceptionCode::NotAllowedError,
            format_args!("Permission denied"),
        );
        return stream
            .reject(cx, error.to_js())
            .map(|()| JSValue::UNDEFINED);
    }
    let wanted = track.constraints.borrow().clone();
    let captured = track.remote.link.ask(
        &cx.heap,
        "capture",
        &[track.copy(&cx.heap).id.into(), Arg::Json(&wanted)],
        track.to_js(),
        |cx, track, reply| {
            let Some(track) = MediaStreamTrack::from_js(&cx.heap, track) else {
                return Ok(JSValue::UNDEFINED);
            };
            track.description.replace(reply.into());
            track.set_busy(&cx.heap, true);
            Ok(MediaStream::of_track(&cx.heap, track).to_js())
        },
    );
    stream
        .resolve(cx, captured.to_js())
        .map(|()| JSValue::UNDEFINED)
}
