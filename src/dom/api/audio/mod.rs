//! https://webaudio.github.io/web-audio-api/

mod buffer;
mod context;
mod kinds;
mod node;
#[macro_use]
mod nodes;
mod param;
mod worklet;

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{ClassStructure, IntoError as _, JsHeap, JsInterface, JsLocal, Result};
use bun_jsc::{DOMExceptionCode, JSValue};

use crate::api::core::{EventTarget, List, atom};
use crate::api::events::{Event, EventInit, Trusted, dispatch, fire};
use crate::api::graphics::Failure;
use crate::api::media::{Arg, Cx, Link, Message, Mirrored, Remote, current_link};
use crate::generated_bindgen::audio::*;
use crate::generated_bindgen::media::HTMLMediaElement;
pub(crate) use buffer::{AudioBuffer, PeriodicWave};
pub(crate) use context::{AudioProcessingEvent, BaseAudioContext};
pub(crate) use node::AudioNode;
pub(crate) use param::AudioParam;
pub(crate) use worklet::Worklet;

type Floats<'a> = JsLocal<'a, bun_jsc::bindgen::TypedArray<f32>>;

pub(crate) struct Slot(pub(crate) usize);

const MAX_CHANNELS: u32 = 32;

const fn not_supported(message: &'static str) -> Failure {
    Failure::Dom(DOMExceptionCode::NotSupportedError, message)
}

const fn invalid_access(message: &'static str) -> Failure {
    Failure::Dom(DOMExceptionCode::InvalidAccessError, message)
}
