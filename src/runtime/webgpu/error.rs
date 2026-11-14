use bun_core::String;
use bun_dawn_sys::ErrorType;
use bun_jsc::bindgen::{DOMExceptionBase, EventBase, JsHeap, JsStructure, JsWrapper};

use super::idl;

pub(crate) struct GPUError {
    message: String,
}

impl GPUError {
    pub(crate) fn constructor(message: String) -> Self {
        Self { message }
    }

    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        r#type: ErrorType,
        message: &[u8],
    ) -> JsWrapper<'a, Self> {
        let error = Self::constructor(String::clone_utf8(message));
        match r#type {
            ErrorType::Validation => idl::js_GPUValidationError::create(heap, error),
            ErrorType::OutOfMemory => idl::js_GPUOutOfMemoryError::create(heap, error),
            _ => idl::js_GPUInternalError::create(heap, error),
        }
    }

    pub(crate) fn get_message(&self) -> String {
        self.message.clone()
    }
}

pub(crate) struct GPUUncapturedErrorEvent;

impl GPUUncapturedErrorEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        r#type: String,
        init: &idl::GPUUncapturedErrorEventInit<'a>,
    ) -> JsWrapper<'a, Self> {
        let base = EventBase {
            r#type,
            bubbles: init.bubbles,
            cancelable: init.cancelable,
            composed: init.composed,
            is_trusted: false,
        };
        let this_value = structure.create(heap, (base, Self));
        idl::js_GPUUncapturedErrorEvent::error_set_cached(
            this_value.to_js(),
            // SAFETY: storing a value runs no JavaScript.
            unsafe { heap.global() },
            init.error.to_js(),
        );
        this_value
    }
}

pub(crate) struct GPUPipelineError {
    pub(super) reason: idl::GPUPipelineErrorReason,
}

impl GPUPipelineError {
    pub(crate) fn constructor(
        message: String,
        options: &idl::GPUPipelineErrorInit,
    ) -> (DOMExceptionBase, Self) {
        let reason = options.reason;
        (DOMExceptionBase { message }, Self { reason })
    }

    pub(crate) fn get_reason(&self) -> idl::GPUPipelineErrorReason {
        self.reason
    }
}

pub(crate) struct GPUDeviceLostInfo {
    pub(super) reason: idl::GPUDeviceLostReason,
    pub(super) message: String,
}

impl GPUDeviceLostInfo {
    pub(crate) fn get_reason(&self) -> idl::GPUDeviceLostReason {
        self.reason
    }

    pub(crate) fn get_message(&self) -> String {
        self.message.clone()
    }
}
