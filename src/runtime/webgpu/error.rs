use core::cell::Cell;

use bun_jsc::bindgen::{self, JsHeap, JsStructure, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue};
use bun_ptr::RefPtr;

use super::{string_of_view, sys};
use crate::generated_bindgen::webgpu::{
    GPUPipelineErrorInit, GPUPipelineErrorReason, GPUUncapturedErrorEventInit, js_GPUError,
    js_GPUInternalError, js_GPUOutOfMemoryError, js_GPUUncapturedErrorEvent, js_GPUValidationError,
};

// ───────────────────────────── GPUError ─────────────────────────────

#[derive(Clone, Copy)]
enum ErrorKind {
    Validation,
    OutOfMemory,
    Internal,
}

/// `GPUError`, and the three interfaces that inherit from it.
pub(crate) struct GPUError {
    kind: ErrorKind,
    message: bun_core::String,
}

impl GPUError {
    /// # Safety
    /// As [`string_of_view`].
    pub(super) unsafe fn of(kind: sys::WGPUErrorType, message: sys::WGPUStringView) -> Self {
        Self {
            kind: match kind {
                sys::WGPUErrorType::Validation => ErrorKind::Validation,
                sys::WGPUErrorType::OutOfMemory => ErrorKind::OutOfMemory,
                _ => ErrorKind::Internal,
            },
            // SAFETY: forwarded.
            message: unsafe { string_of_view(message) },
        }
    }

    pub(crate) fn new_validation_error(message: bun_core::String) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message,
        }
    }
    pub(crate) fn new_out_of_memory_error(message: bun_core::String) -> Self {
        Self {
            kind: ErrorKind::OutOfMemory,
            message,
        }
    }
    pub(crate) fn new_internal_error(message: bun_core::String) -> Self {
        Self {
            kind: ErrorKind::Internal,
            message,
        }
    }

    pub(super) fn into_js(self, global: &JSGlobalObject) -> JSValue {
        match self.kind {
            ErrorKind::Validation => js_GPUValidationError::create_wrapper(global, self).to_js(),
            ErrorKind::OutOfMemory => js_GPUOutOfMemoryError::create_wrapper(global, self).to_js(),
            ErrorKind::Internal => js_GPUInternalError::create_wrapper(global, self).to_js(),
        }
    }

    /// For somebody who reads a terminal.
    pub(super) fn describe(&self) -> String {
        let name = match self.kind {
            ErrorKind::Validation => "GPUValidationError",
            ErrorKind::OutOfMemory => "GPUOutOfMemoryError",
            ErrorKind::Internal => "GPUInternalError",
        };
        format!("{name}: {}", self.message)
    }

    pub(crate) fn get_message(&self) -> bun_core::String {
        self.message.clone()
    }
}

// ───────────────────────────── GPUUncapturedErrorEvent ─────────────────────────────

/// Its `error` is an internal field.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct GPUUncapturedErrorEvent {
    ref_count: Cell<u32>,
    r#type: bun_core::String,
    bubbles: bool,
    cancelable: bool,
    composed: bool,
    is_trusted: bool,
}

impl GPUUncapturedErrorEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        r#type: bun_core::String,
        init: &GPUUncapturedErrorEventInit<'a>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        if js_GPUError::from_js(init.error.to_js()).is_none() {
            return Err(heap.type_error(format_args!(
                "GPUUncapturedErrorEventInit.error must be an instance of GPUError"
            )));
        }
        let event = structure.create(
            heap,
            RefPtr::new(Self {
                ref_count: Cell::new(1),
                r#type,
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
                is_trusted: false,
            }),
        );
        // SAFETY: storing a value in an internal field runs no JavaScript.
        let global = unsafe { heap.global() };
        js_GPUUncapturedErrorEvent::error_set_cached(event.to_js(), global, init.error.to_js());
        Ok(event)
    }

    /// The event that a device fires for an error that no error scope caught.
    pub(super) fn create<'a>(heap: &JsHeap<'a>, error: GPUError) -> JsWrapper<'a, Self> {
        let event = js_GPUUncapturedErrorEvent::create(
            heap,
            RefPtr::new(Self {
                ref_count: Cell::new(1),
                r#type: bun_core::String::static_("uncapturederror"),
                bubbles: false,
                cancelable: true,
                composed: false,
                is_trusted: true,
            }),
        );
        // SAFETY: making the error and storing it allocate and run no JavaScript.
        let global = unsafe { heap.global() };
        js_GPUUncapturedErrorEvent::error_set_cached(event.to_js(), global, error.into_js(global));
        event
    }

    pub(crate) fn event_init(&self) -> bindgen::EventInit {
        bindgen::EventInit {
            r#type: self.r#type.clone(),
            bubbles: self.bubbles,
            cancelable: self.cancelable,
            composed: self.composed,
            is_trusted: self.is_trusted,
        }
    }
}

// ───────────────────────────── GPUPipelineError ─────────────────────────────

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct GPUPipelineError {
    ref_count: Cell<u32>,
    message: bun_core::String,
    reason: GPUPipelineErrorReason,
}

impl GPUPipelineError {
    pub(crate) fn constructor(
        message: bun_core::String,
        options: &GPUPipelineErrorInit,
    ) -> *mut Self {
        RefPtr::new(Self {
            ref_count: Cell::new(1),
            message,
            reason: options.reason,
        })
        .into_raw()
    }

    /// # Safety
    /// As [`string_of_view`].
    pub(super) unsafe fn of(
        status: sys::WGPUCreatePipelineAsyncStatus,
        message: sys::WGPUStringView,
    ) -> Self {
        Self {
            ref_count: Cell::new(1),
            // SAFETY: forwarded.
            message: unsafe { string_of_view(message) },
            reason: match status {
                sys::WGPUCreatePipelineAsyncStatus::ValidationError => {
                    GPUPipelineErrorReason::Validation
                }
                _ => GPUPipelineErrorReason::Internal,
            },
        }
    }

    pub(crate) fn dom_exception_init(&self) -> bindgen::DOMExceptionInit {
        bindgen::DOMExceptionInit {
            message: self.message.clone(),
            name: bun_core::String::static_("GPUPipelineError"),
        }
    }

    pub(crate) fn get_reason(&self) -> GPUPipelineErrorReason {
        self.reason
    }
}
