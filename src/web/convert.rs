//! Between the types of this crate and JS values.

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::webcore_types::{Blob as JsBlob, Store, store};
use bun_jsc::{DOMExceptionCode, JSGlobalObject, JSObject, JSValue};
use bun_ptr::RefPtr;

use crate::net::NetError;
use crate::net::body::{Blob, Data, Owner, SharedBytes};
use crate::remote;
use crate::runtime;
use crate::url::Url;

#[derive(Clone, Copy)]
pub struct Object<'a>(JsLocal<'a, JSObject>);

impl<'a> Object<'a> {
    pub fn new(cx: &mut JsScope<'a>) -> Object<'a> {
        Object(cx.heap.create_empty_object())
    }

    pub fn set(self, cx: &mut JsScope<'a>, name: &'static str, value: JsLocal<'a>) {
        self.0
            .to_js()
            .put(cx.global(), name.as_bytes(), value.to_js());
    }

    pub fn latin1(self, cx: &mut JsScope<'a>, name: &'static str, text: &[u8]) {
        let text = cx.heap.create_latin1_string(text);
        self.set(cx, name, text.as_value());
    }

    pub fn number(self, cx: &mut JsScope<'a>, name: &'static str, number: f64) {
        self.0.to_js().put(
            cx.global(),
            name.as_bytes(),
            bun_jsc::JSValue::js_number(number),
        );
    }

    pub fn into_value(self) -> JsLocal<'a> {
        self.0.as_value()
    }
}

/// UTF-8 if it is not a byte string.
pub fn isomorphic_encode(text: &bun_core::String) -> Vec<u8> {
    if text.is_8bit() {
        return text.latin1().to_vec();
    }
    let narrow = text.is_utf16().then(|| {
        text.utf16()
            .iter()
            .map(|it| u8::try_from(*it).ok())
            .collect()
    });
    narrow.flatten().unwrap_or_else(|| text.to_owned_slice())
}

struct StoredBytes(RefPtr<Store>);

impl Owner for StoredBytes {}

impl AsRef<[u8]> for StoredBytes {
    fn as_ref(&self) -> &[u8] {
        self.0.shared_view()
    }
}

/// A file may be shorter than `size`.
pub fn data_of_blob(blob: &JsBlob, size: u64) -> Option<Data> {
    let range = blob.offset.get()..blob.offset.get().saturating_add(size);
    Some(match blob.store.get() {
        None => Data::Bytes(Vec::new().into()),
        Some(stored) => match &stored.data {
            store::Data::Bytes(_) => {
                Data::Bytes(SharedBytes::new(StoredBytes(stored.clone()))).slice(range)
            }
            store::Data::File(store::File {
                pathlike: PathOrFileDescriptor::Path(path),
                snapshot,
                ..
            }) => Data::File {
                path: path.slice().into(),
                range,
                modified: snapshot.map(|it| it.modified),
            },
            _ => return None,
        },
    })
}

pub fn blob_from_js(blob: &JsBlob) -> Option<Blob> {
    let mime = Some(blob.content_type.get().given())
        .filter(|it| !it.is_empty())
        .or_else(|| Some(&*blob.store.get().as_ref()?.mime_type.value));
    Some(Blob {
        data: data_of_blob(blob, runtime::size_of_blob(blob))?,
        mime: mime.unwrap_or_default().into(),
    })
}

/// <https://w3c.github.io/FileAPI/#ErrorAndException>
#[cold]
pub fn unreadable<'a>(heap: &JsHeap<'a>, reason: NetError) -> bindgen::Error<'a> {
    match reason {
        NetError::FileNotFound => heap.dom_exception(
            DOMExceptionCode::NotFoundError,
            format_args!("A requested file or directory could not be found at the time an operation was processed."),
        ),
        _ => heap.dom_exception(
            DOMExceptionCode::NotReadableError,
            format_args!("The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired."),
        ),
    }
}

pub fn resolve_blob_url(url: &Url) -> Option<Blob> {
    blob_from_js(&runtime::resolve_blob_url(url.href())?)
}

unsafe extern "C" {
    safe fn Bun__RealmBridge__setPathOfFile(global: &JSGlobalObject, file: JSValue, path: JSValue);
    #[link_name = "Bun__RealmBridge__pathOfFile"]
    pub safe fn path_of_file(global: &JSGlobalObject, file: JSValue) -> JSValue;
    /// What the host gives a page for a file that has been chosen.
    #[link_name = "Bun__RealmBridge__tokenForPath"]
    pub safe fn token_for_path(global: &JSGlobalObject, path: JSValue) -> JSValue;
}

/// A `File` that the user or the app has chosen. That of a directory is empty.
pub fn file_at(global: &JSGlobalObject, path: &[u8]) -> Option<JSValue> {
    if !bun_paths::is_absolute(path) {
        let mime = crate::storage::files::mime_of_name(path);
        return Some(runtime::create_file(global, Vec::new(), path, &mime, 0.));
    }
    let empty = |modified| {
        runtime::create_file(global, Vec::new(), bun_paths::basename(path), b"", modified)
    };
    let stat = match remote::is_page_process() {
        true => remote::open_file(path).and_then(|it| it.stat()),
        false => bun_sys::stat(&bun_core::ZBox::from_bytes(path)),
    };
    let file = match stat {
        Ok(it) if bun_sys::S::ISREG(it.st_mode as _) => {
            runtime::create_chosen_file(global, path, &it)
        }
        Ok(it) => empty(bun_sys::PosixStat::init(&it).mtime().ms() as f64),
        Err(_) => empty(remote::modification_of_directory(path)?),
    };
    let path = bun_jsc::bun_string_jsc::create_utf8_for_js(global, path).ok()?;
    Bun__RealmBridge__setPathOfFile(global, file, path);
    Some(file)
}

/// Of what [`file_at`] has made.
pub fn is_directory(global: &JSGlobalObject, file: JSValue) -> bool {
    let path = path_of_file(global, file);
    path.is_string()
        && (path.to_utf8(global)).is_ok_and(|it| remote::modification_of_directory(&it).is_some())
}

/// `chosen`: what the host has made for a path.
pub fn file_chosen(global: &JSGlobalObject, chosen: JSValue) -> Option<JSValue> {
    let path = path_of_file(global, chosen);
    path.is_string()
        .then(|| file_at(global, &path.to_utf8(global).ok()?))?
}
