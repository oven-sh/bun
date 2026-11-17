//! What Electron has, and has nothing behind it here.

use bun_jsc::JSString;

use crate::generated_bindgen::electron::{
    CrashReporterOptions, ElectronContentTracing, ElectronCrashReporter, ElectronInAppPurchase,
};
use crate::prelude::*;

#[derive(Default)]
struct State {
    parameters: RefCell<Vec<(String, String)>>,
    uploads: Cell<bool>,
}

state!(fn state() -> State);

impl ElectronCrashReporter {
    pub(crate) fn start<'a>(_: Cx<'a, '_>, options: &CrashReporterOptions<'a>) -> JsResult<()> {
        let bytes = |it: JsLocal<'a, JSString>| it.to_js().to_utf8(global());
        for (key, value) in options.extra.iter().flat_map(|it| it.iter()) {
            Self::add_extra_parameter(&bytes(key)?, &bytes(value)?);
        }
        state()
            .uploads
            .set(options.upload_to_server.unwrap_or(true));
        Ok(())
    }

    pub(crate) fn add_extra_parameter(key: &[u8], value: &[u8]) {
        Self::remove_extra_parameter(key);
        state()
            .parameters
            .borrow_mut()
            .push((string(key), string(value)));
    }

    pub(crate) fn remove_extra_parameter(key: &[u8]) {
        state()
            .parameters
            .borrow_mut()
            .retain(|it| it.0.as_bytes() != key);
    }

    pub(crate) fn get_parameters(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let all = object!({});
        for (key, value) in &*state().parameters.borrow() {
            all.put_may_be_index(
                global(),
                &bun_core::String::clone_utf8(key.as_bytes()),
                js(&**value)?,
            )?;
        }
        Ok(all)
    }

    pub(crate) fn get_last_crash_report(_: &JsHeap<'_>) -> JSValue {
        JSValue::NULL
    }

    pub(crate) fn get_uploaded_reports(_: Cx<'_, '_>) -> JsResult<JSValue> {
        array(&[])
    }

    pub(crate) fn get_upload_to_server() -> bool {
        state().uploads.get()
    }

    pub(crate) fn set_upload_to_server(uploads: bool) {
        state().uploads.set(uploads);
    }
}

impl ElectronContentTracing {
    pub(crate) fn get_categories(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(array(&[])?)
    }

    pub(crate) fn get_trace_buffer_usage(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(object!({ "value": 0, "percentage": 0 }))
    }

    pub(crate) fn refuse(_: Cx<'_, '_>) -> JsResult<JSValue> {
        Err(unsupported("contentTracing"))
    }
}

impl ElectronInAppPurchase {
    pub(crate) fn can_make_payments() -> bool {
        false
    }
}

pub(crate) struct TouchBar;

impl TouchBar {
    pub(crate) fn constructor(_: Cx<'_, '_>) -> JsResult<Self> {
        Err(unsupported("TouchBar"))
    }
}
