//! Between the types of this crate and JS values.

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, to_js};
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::webcore_types::{Blob as JsBlob, Store, store};
use bun_jsc::{DOMExceptionCode, JSGlobalObject, JSObject, JSValue};
use bun_ptr::RefPtr;

use crate::headers::HeaderList;
use crate::net::NetError;
use crate::net::body::{Blob, Data, SharedBytes};
use crate::net::cookies::Cookie;
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

    pub fn text(
        self,
        cx: &mut JsScope<'a>,
        name: &'static str,
        text: &[u8],
    ) -> bindgen::Result<'a, ()> {
        let text = to_js::utf8(&cx.heap, text)?;
        self.set(cx, name, text);
        Ok(())
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

    pub fn flag(self, cx: &mut JsScope<'a>, name: &'static str, flag: bool) {
        self.0
            .to_js()
            .put(cx.global(), name.as_bytes(), flag.into());
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

pub fn headers_from_pairs(pairs: &[Vec<bun_core::String>]) -> HeaderList {
    pairs
        .iter()
        .filter_map(|it| {
            Some((
                isomorphic_encode(it.first()?),
                isomorphic_encode(it.get(1)?),
            ))
        })
        .collect()
}

pub fn headers_to_pairs<'a>(
    heap: &JsHeap<'a>,
    headers: &HeaderList,
) -> bindgen::Result<'a, JsLocal<'a>> {
    to_js::array(heap, headers.iter(), |heap, it| {
        to_js::array(heap, [it.0, it.1], |heap, it| {
            Ok(heap.create_latin1_string(it).as_value())
        })
    })
}

struct StoredBytes(RefPtr<Store>);

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

/// As Electron has it.
pub fn cookie_to_js<'a>(heap: &JsHeap<'a>, cookie: &Cookie) -> bindgen::Result<'a, JsLocal<'a>> {
    enum Member<'a> {
        Text(&'a [u8]),
        Flag(bool),
        Number(f64),
    }
    use Member::*;
    let domain = [
        if cookie.is_host_only { &b""[..] } else { b"." },
        &cookie.domain,
    ]
    .concat();
    let members = [
        ("name", Some(Text(&cookie.name))),
        ("value", Some(Text(&cookie.value))),
        ("domain", Some(Text(&domain))),
        ("hostOnly", Some(Flag(cookie.is_host_only))),
        ("path", Some(Text(&cookie.path))),
        ("secure", Some(Flag(cookie.is_secure))),
        ("httpOnly", Some(Flag(cookie.is_http_only))),
        ("session", Some(Flag(cookie.expires.is_none()))),
        ("expirationDate", cookie.expires.map(Number)),
        ("sameSite", Some(Text(cookie.same_site.as_bytes()))),
        (
            "partition",
            cookie.partition.as_ref().map(|it| Text(it.as_bytes())),
        ),
    ];
    to_js::record(
        heap,
        members.into_iter().filter_map(|it| Some((it.0, it.1?))),
        |heap, it| match it {
            Text(it) => to_js::utf8(heap, it),
            Flag(it) => to_js::bool(heap, it),
            Number(it) => to_js::f64(heap, it),
        },
    )
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
    let stat = bun_sys::stat(&bun_core::ZBox::from_bytes(path)).ok()?;
    let file = match bun_sys::S::ISREG(stat.st_mode as _) {
        true => runtime::create_chosen_file(global, path, &stat),
        false => {
            let modified = bun_sys::PosixStat::init(&stat).mtime().ms() as f64;
            runtime::create_file(global, Vec::new(), bun_paths::basename(path), b"", modified)
        }
    };
    let path = bun_jsc::bun_string_jsc::create_utf8_for_js(global, path).ok()?;
    Bun__RealmBridge__setPathOfFile(global, file, path);
    Some(file)
}

/// Of what [`file_at`] has made.
pub fn is_directory(global: &JSGlobalObject, file: JSValue) -> bool {
    let path = path_of_file(global, file);
    path.is_string()
        && path.to_utf8(global).is_ok_and(|it| {
            bun_sys::File::open_at(
                bun_sys::Fd::cwd(),
                &it,
                bun_sys::O::RDONLY | bun_sys::O::DIRECTORY,
                0,
            )
            .is_ok()
        })
}

/// `chosen`: what the host has made for a path.
pub fn file_chosen(global: &JSGlobalObject, chosen: JSValue) -> Option<JSValue> {
    let path = path_of_file(global, chosen);
    path.is_string()
        .then(|| file_at(global, &path.to_utf8(global).ok()?))?
}
