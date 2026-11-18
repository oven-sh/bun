//! `crashReporter` where no reports are written.

use bun_jsc::JSString;
use bun_sys::File;

use crate::generated_bindgen::electron::{CrashReporterOptions, ElectronCrashReporter};
use crate::prelude::*;
use crate::value::Value;

#[derive(Default)]
struct State {
    parameters: RefCell<Vec<(String, String)>>,
    uploads: Cell<bool>,
}

state!(fn state() -> State);

pub(crate) fn for_utility_process() -> Value {
    Value::Null
}

pub(crate) fn begin_in_utility_process(_: &Value) {}

pub(crate) fn file_for_page_process() -> Option<[File; 2]> {
    None
}

pub(crate) fn begin_in_page_process(_: File) {}

pub(crate) async fn keep_report_in(_: File, _: std::rc::Rc<str>) {}

pub(crate) fn put_parameters(into: JSValue) -> JsResult<()> {
    for (key, value) in &*state().parameters.borrow() {
        let key = bun_core::String::clone_utf8(key.as_bytes());
        into.put_may_be_index(global(), &key, js(&**value)?)?;
    }
    Ok(())
}

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
        put_parameters(all).map(|()| all)
    }

    pub(crate) fn get_last_crash_report(_: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(JSValue::NULL)
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
