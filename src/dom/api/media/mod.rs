//! `<audio>`, `<video>` and the microphone.

mod captions;
pub(crate) mod controls;
mod element;
mod host;
mod link;
mod player;
mod recorder;
mod streams;
mod tracks;
mod webvtt;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{
    ClassStructure, IntoError as _, JsHeap, JsInterface, JsLocal, JsScope, Result,
};
use bun_jsc::{DOMExceptionCode, JSValue};

use crate::api::core::{Doc, EventTarget, List, atom};
use crate::api::events::fire;
use crate::api::graphics::Failure;
use crate::api::on_behalf::{current_document, queue_task, queue_task_after};
use crate::generated_bindgen::media::*;
pub(crate) use element::{MEDIA_STEPS, MediaError, TimeRanges, resume_lazy_media, source_inserted};
pub(crate) use host::performance_now;
pub(crate) use link::{Arg, Link, Message, Mirrored, Remote, window_has_closed};
pub(crate) use player::Player;
pub(crate) use recorder::{BlobEvent, MediaRecorder};
pub(crate) use streams::{
    MediaDeviceInfo, MediaDevices, MediaException, MediaStream, MediaStreamTrack,
};
pub(crate) use tracks::{
    TRACK_STEPS, TextTrack, TextTrackCue, TextTrackCueList, TrackEvent, VTTCue, VTTRegion,
};

pub(crate) type Cx<'c, 'a> = &'c mut JsScope<'a>;

pub(crate) fn current_link<'a>(cx: Cx<'_, 'a>) -> Result<'a, Rc<Link>> {
    current_document(cx).map(|it| Link::of(&cx.heap, it))
}
