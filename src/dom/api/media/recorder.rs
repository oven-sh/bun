//! https://w3c.github.io/mediacapture-record/

use bun_jsc::JsClass as _;
use bun_jsc::bindgen::JsAtom;
use bun_jsc::webcore_types::{Blob, BlobContentType};

use super::*;
use crate::api::events::{ErrorEvent, Event, EventInit, Trusted, dispatch};

const DEFAULT_BITS_PER_SECOND: u32 = 128_000;

#[repr(C)]
pub(crate) struct MediaRecorder {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_MediaRecorder::Fields,
    remote: Remote,
    state: Cell<RecordingState>,
    constrained_mime_type: Box<[u8]>,
    mime_type: RefCell<Box<[u8]>>,
    audio_bits_per_second: u32,
    video_bits_per_second: u32,
    audio_bitrate_mode: BitrateMode,
}

impl Mirrored for MediaRecorder {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        let mode = if self.audio_bitrate_mode == BitrateMode::Constant {
            "constant"
        } else {
            "variable"
        };
        let options = [
            ("mimeType", Arg::Text(&self.constrained_mime_type)),
            ("audioBitsPerSecond", self.audio_bits_per_second.into()),
            ("audioBitrateMode", mode.into()),
        ];
        self.remote.send(
            "recorder",
            &[self.stream().copy(heap).object(), Arg::Record(&options)],
        );
    }

    fn heard<'a>(&'a self, cx: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        let event = match message.kind {
            b"dataavailable" => {
                let blob = Blob::init(message.bytes(2), cx.global());
                blob.content_type.set(BlobContentType::Owned(
                    message.text(0).to_ascii_lowercase().into(),
                ));
                blob.content_type_was_set.set(true);
                let data = blob.to_js(cx.global());
                dispatch(
                    cx,
                    self,
                    BlobEvent::trusted(&cx.heap, data, message.number(1)),
                );
                return Ok(());
            }
            b"error" => {
                self.fail(cx);
                return Ok(());
            }
            b"start" => {
                self.mime_type.replace(message.text(0).into());
                atom!("start")
            }
            b"stop" => {
                // Unless it has been started again.
                if message.text(0) == b"inactive" {
                    self.inactivate();
                    self.set_busy(&cx.heap, false);
                }
                atom!("stop")
            }
            b"pause" => atom!("pause"),
            b"resume" => atom!("resume"),
            _ => return Ok(()),
        };
        fire(cx, self, event, Default::default());
        Ok(())
    }

    fn lost<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        if self.state.get() != RecordingState::Inactive {
            self.fail(cx);
            fire(cx, self, atom!("stop"), Default::default());
        }
        Ok(())
    }
}

impl MediaRecorder {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        stream: &'a MediaStream,
        options: &MediaRecorderOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let mime_type = options.mime_type.unwrap_or_default();
        if !Self::is_type_supported(cx, mime_type)? {
            return Err(Failure::Dom(
                DOMExceptionCode::NotSupportedError,
                "The type provided is not supported.",
            )
            .into_error(&cx.heap));
        }
        let recorder = MediaRecorder {
            base: Default::default(),
            fields: Default::default(),
            remote: Remote::new(Rc::clone(&stream.remote().link)),
            state: Cell::new(RecordingState::Inactive),
            constrained_mime_type: mime_type.into(),
            mime_type: RefCell::new(mime_type.into()),
            audio_bits_per_second: options
                .bits_per_second
                .or(options.audio_bits_per_second)
                .unwrap_or(DEFAULT_BITS_PER_SECOND),
            video_bits_per_second: options
                .video_bits_per_second
                .filter(|_| options.bits_per_second.is_none())
                .unwrap_or(0),
            audio_bitrate_mode: options.audio_bitrate_mode,
        };
        let recorder = structure.create(&cx.heap, recorder);
        js_MediaRecorder::set_stream(recorder, Some(stream));
        Ok(recorder)
    }

    #[optimize(size)]
    pub(crate) fn is_type_supported<'a>(cx: Cx<'_, 'a>, mime_type: &[u8]) -> Result<'a, bool> {
        let bare: Vec<u8> = mime_type
            .iter()
            .filter(|it| !matches!(it, b' ' | b'"'))
            .map(u8::to_ascii_lowercase)
            .collect();
        let is_known = matches!(
            &bare[..],
            b"audio/webm" | b"audio/webm;codecs=opus" | b"audio/webm;codecs=pcm"
        );
        Ok(mime_type.is_empty()
            || is_known && current_document(cx).map(|it| host::plays_media(cx, it))?)
    }

    fn stream(&self) -> &MediaStream {
        js_MediaRecorder::stream(self).expect("a recorder has a stream")
    }

    fn inactivate(&self) {
        self.state.set(RecordingState::Inactive);
        self.mime_type.replace(self.constrained_mime_type.clone());
    }

    #[optimize(size)]
    fn fail<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.inactivate();
        let error = cx.heap.create_dom_exception(
            DOMExceptionCode::UnknownError,
            format_args!("The stream cannot be recorded."),
        );
        dispatch(
            cx,
            self,
            ErrorEvent::trusted(&cx.heap, atom!("error"), Default::default(), error.to_js()),
        );
    }

    fn check_active(&self) -> core::result::Result<(), Failure> {
        if self.state.get() == RecordingState::Inactive {
            Err(Failure::invalid_state(
                "The MediaRecorder's state is 'inactive'.",
            ))
        } else {
            Ok(())
        }
    }

    fn change(&self, state: RecordingState, method: &str) -> core::result::Result<(), Failure> {
        self.check_active()?;
        if self.state.replace(state) != state {
            self.remote.invoke(method, &[]);
        }
        Ok(())
    }

    pub(crate) fn get_mime_type(&self) -> Vec<u8> {
        self.mime_type.borrow().to_vec()
    }

    pub(crate) fn get_state(&self) -> RecordingState {
        self.state.get()
    }

    pub(crate) fn get_video_bits_per_second(&self) -> u32 {
        self.video_bits_per_second
    }

    pub(crate) fn get_audio_bits_per_second(&self) -> u32 {
        self.audio_bits_per_second
    }

    pub(crate) fn get_audio_bitrate_mode(&self) -> BitrateMode {
        self.audio_bitrate_mode
    }

    #[optimize(size)]
    pub(crate) fn start<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        timeslice: Option<u32>,
    ) -> core::result::Result<(), Failure> {
        if self.state.get() != RecordingState::Inactive {
            return Err(Failure::invalid_state(
                "The MediaRecorder's state is not 'inactive'.",
            ));
        }
        if !self.stream().get_active() {
            return Err(Failure::Dom(
                DOMExceptionCode::NotSupportedError,
                "The MediaStream is inactive.",
            ));
        }
        self.state.set(RecordingState::Recording);
        self.copy(heap)
            .invoke("start", timeslice.map(Arg::from).as_slice());
        self.set_busy(heap, true);
        Ok(())
    }

    pub(crate) fn stop(&self) {
        if self.change(RecordingState::Inactive, "stop").is_ok() {
            self.inactivate();
        }
    }

    #[optimize(size)]
    pub(crate) fn pause(&self) -> core::result::Result<(), Failure> {
        self.change(RecordingState::Paused, "pause")
    }

    pub(crate) fn resume(&self) -> core::result::Result<(), Failure> {
        self.change(RecordingState::Recording, "resume")
    }

    pub(crate) fn request_data(&self) -> core::result::Result<(), Failure> {
        self.check_active()
            .map(|()| self.remote.invoke("requestData", &[]))
    }
}

#[repr(C)]
pub(crate) struct BlobEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_BlobEvent::Fields,
    timecode: f64,
}

impl BlobEvent {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: JsAtom<'a>,
        init: &BlobEventInit<'a>,
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
            BlobEvent {
                base,
                fields: Default::default(),
                timecode: init.timecode.unwrap_or(f64::NAN),
            },
        );
        js_BlobEvent::set_data(event, init.data.to_js());
        event
    }

    fn trusted<'a>(heap: &JsHeap<'a>, data: JSValue, timecode: f64) -> &'a Self {
        let base = Event::base(atom!("dataavailable"), Default::default(), Trusted::Yes);
        let event = js_BlobEvent::create(
            heap,
            BlobEvent {
                base,
                fields: Default::default(),
                timecode,
            },
        );
        js_BlobEvent::set_data(event, data);
        event
    }

    pub(crate) fn get_timecode(&self) -> f64 {
        self.timecode
    }
}
