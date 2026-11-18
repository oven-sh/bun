//! <https://xhr.spec.whatwg.org/#interface-formdata>, which is in C++.

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::webcore_types::Blob as JsBlob;
use bun_jsc::{DOMFormData, JSGlobalObject};
use bun_web::convert::blob_from_js;
use bun_web::net::body::Blob;

use super::form;
use crate::api::ui::prelude::*;
use crate::generated_bindgen::forms::HTMLFormElement;
use crate::generated_bindgen::html::HTMLElement;

unsafe extern "C" {
    /// `value` is a string, a `File`, or a `FormData`, which adds its entries.
    safe fn Bun__DOM__appendToFormData(
        global: &JSGlobalObject,
        data: JSValue,
        name: &Impl,
        value: JSValue,
    );
    safe fn Bun__DOM__appendTextToFormData(data: JSValue, name: &Impl, value: &Impl);
    /// Empty behind the last one.
    safe fn Bun__DOM__entryOfFormData(
        data: JSValue,
        index: u32,
        value: &mut Option<DomString>,
        file: &mut *const core::ffi::c_void,
    ) -> Option<DomString>;
}

pub(super) fn create(heap: &JsHeap<'_>) -> JSValue {
    DOMFormData::create(global_of(heap))
}

/// Null is nothing, and `undefined` an empty file.
pub(super) fn append(heap: &JsHeap<'_>, data: JSValue, name: &DomString, value: JSValue) {
    let empty = || {
        bun_web::runtime::create_file(
            global_of(heap),
            Vec::new(),
            b"",
            b"application/octet-stream",
            host::time_of_day(),
        )
    };
    if value.is_undefined()
        || DOMFormData::from_js(&value).is_some()
        || !value.is_null() && !name.is_empty()
    {
        Bun__DOM__appendToFormData(
            global_of(heap),
            data,
            name.as_impl(),
            if value.is_undefined() { empty() } else { value },
        );
    }
}

pub(super) fn append_text(data: JSValue, name: &DomString, value: &DomString) {
    Bun__DOM__appendTextToFormData(data, name.as_impl(), value.as_impl());
}

/// `(File or USVString or FormData)?`
pub(super) fn submission_value<'a>(
    cx: &mut Cx<'a>,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, JSValue> {
    let it = value.to_js();
    if it.is_undefined_or_null() || host::type_of_file(it).is_some() {
        return Ok(if it.is_undefined() { JSValue::NULL } else { it });
    }
    if DOMFormData::from_js(&it).is_none() {
        return Ok(DomString::from_js(cx, value)?
            .into_well_formed()
            .to_js(&cx.heap)
            .to_js());
    }
    let copy = create(&cx.heap);
    append(&cx.heap, copy, &DomString::default(), it);
    Ok(copy)
}

pub(crate) struct Field {
    pub(crate) name: String,
    /// The name, of a file.
    pub(crate) value: String,
    pub(crate) file: Option<Blob>,
}

pub(crate) fn fields(data: JSValue) -> Vec<Field> {
    let read = |index| {
        let (mut value, mut file) = (None, core::ptr::null());
        let name = Bun__DOM__entryOfFormData(data, index, &mut value, &mut file)?;
        // SAFETY: the entry holds it.
        let file = unsafe { file.cast::<JsBlob>().as_ref() }.map(|it| {
            blob_from_js(it).unwrap_or_else(|| Blob {
                data: bun_web::net::body::Data::Bytes(Vec::new().into()),
                mime: Default::default(),
            })
        });
        Some(Field {
            name: name.to_utf8().into_owned(),
            value: value.unwrap_or_default().to_utf8().into_owned(),
            file,
        })
    };
    (0..).map_while(read).collect()
}

/// `new FormData(form, submitter)`. False if it has thrown.
#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__fillFormData(
    global: &JSGlobalObject,
    data: JSValue,
    form: JSValue,
    submitter: JSValue,
    is_strict: bool,
) -> bool {
    fn fill<'a>(
        cx: &mut Cx<'a>,
        data: JSValue,
        form: JSValue,
        submitter: JSValue,
        is_strict: bool,
    ) -> bindgen::Result<'a, ()> {
        let Some(form) = HTMLFormElement::from_js(&cx.heap, form) else {
            return if is_strict {
                Err(cx.heap.type_error(format_args!(
                    "Parameter 1 is not of type 'HTMLFormElement'."
                )))
            } else {
                Ok(())
            };
        };
        let given = HTMLElement::from_js(&cx.heap, submitter);
        if given.is_none() && !submitter.is_undefined_or_null() {
            return Err(cx
                .heap
                .type_error(format_args!("Parameter 2 is not of type 'HTMLElement'.")));
        }
        let submitter = form::checked_submitter(&cx.heap, form, given)?;
        let result = form::construct_entry_list(cx, data, form, submitter, "UTF-8");
        refused(&cx.heap, result)
    }
    // SAFETY: the constructor is calling.
    unsafe {
        Cx::with(global.as_mut_ptr(), |cx| {
            fill(cx, data, form, submitter, is_strict)
                .map_err(|it| it.into_js_error(cx.global()))
                .is_ok()
        })
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__touchBlob(blob: &JsBlob) {
    blob.last_modified.set(host::time_of_day());
}
