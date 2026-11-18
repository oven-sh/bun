//! <https://w3c.github.io/FileAPI/#blob-section> and <https://w3c.github.io/FileAPI/#file-section>, in the realm of a page.

use core::ffi::c_void;
use core::task::{Context, Poll};

use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::node_path::{PathLike, PathOrFileDescriptor};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::webcore_types::{Store, store};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, JsThread, UUID, VM, bun_string_jsc};
use bun_ptr::RefPtr;
use bun_web::convert::{blob_from_js, unreadable};
use bun_web::net::NetError;
use bun_web::net::body::{Body, Chunk, Data, Read, SharedBytes, Source, time_of_modification};
use bun_web::net::response::Answer;
use bun_web::realm::Realm;
use bun_web::storage::files::mime_of_name;
use bun_web::streams::{promise_for, stream_of};

use crate::generated_bindgen::desktop_web::{BlobPropertyBag, EndingType, FilePropertyBag};
use crate::webcore::blob::{BlobContentType, BlobExt, is_valid_blob_type};
use crate::webcore::object_url_registry::Owner;
use crate::webcore::{Blob, Lifetime, ObjectURLRegistry};

unsafe extern "C" {
    pub(crate) safe fn Bun__isDesktopRealm(global: &JSGlobalObject) -> bool;
    safe fn Bun__Desktop__adoptFile(global: &JSGlobalObject, file: JSValue);
}

/// Strings, buffers and blobs.
fn parts_of(global: &JSGlobalObject, given: JSValue) -> JsResult<JSValue> {
    extern "C" fn add(_: *mut VM, global: &JSGlobalObject, parts: *mut c_void, part: JSValue) {
        let converted = match part.as_array_buffer(global) {
            Some(buffer) if buffer.shared => {
                Err(global.throw_type_error(format_args!("The buffer must not be shared.")))
            }
            None if !part.is::<Blob>() => part.to_js_string(global).map(|it| it.to_js()),
            _ => Ok(part),
        };
        // SAFETY: what is passed below.
        let (parts, len) = unsafe { &mut *parts.cast::<(JSValue, u32)>() };
        let _ = converted.and_then(|it| parts.put_index(global, *len, it));
        *len += 1;
    }
    if !given.is_object() {
        return Err(global.throw_type_error(format_args!(
            "The provided value cannot be converted to a sequence."
        )));
    }
    let mut parts = (JSValue::create_empty_array(global, 0)?, 0u32);
    given.for_each(global, (&raw mut parts).cast(), add)?;
    Ok(parts.0)
}

/// <https://w3c.github.io/FileAPI/#convert-line-endings-to-native>
fn convert_line_endings(global: &JSGlobalObject, parts: JSValue) -> JsResult<()> {
    for at in 0..parts.get_length(global)? as u32 {
        let part = parts.get_index(global, at)?;
        if part.is_string_literal() {
            let text = strings::replace_owned(
                &strings::replace_owned(part.to_utf8(global)?.slice(), b"\r\n", b"\n"),
                b"\r",
                b"\n",
            );
            let text = if cfg!(windows) {
                strings::replace_owned(&text, b"\n", b"\r\n")
            } else {
                text
            };
            parts.put_index(
                global,
                at,
                bun_string_jsc::create_utf8_for_js(global, &text)?,
            )?;
        }
    }
    Ok(())
}

fn as_plain(blob: Blob, mime: &[u8]) -> Blob {
    let is_set = !mime.is_empty() && is_valid_blob_type(mime);
    blob.content_type_was_set.set(is_set);
    blob.content_type.set(if is_set {
        BlobContentType::from_lowercased(mime)
    } else {
        BlobContentType::default()
    });
    blob.is_jsdom_file.set(false);
    blob.name.set(bun_core::String::DEAD);
    blob
}

fn data_of(blob: &Blob) -> Data {
    blob_from_js(blob).map_or_else(|| Data::Bytes(Vec::new().into()), |it| it.data)
}

/// Blocks.
pub(crate) fn in_memory(blob: &Blob) -> Result<Blob, NetError> {
    let bytes = data_of(blob).read_now()?.into_vec();
    let copy = blob.dupe_with_content_type(true);
    copy.offset.set(0);
    copy.size.set(bytes.len() as u64);
    copy.store.set(Some(Store::init(bytes)));
    Ok(copy)
}

/// A blob has one store. Returns the part that cannot be read.
fn read_files(global: &JSGlobalObject, parts: JSValue) -> JsResult<Option<Blob>> {
    let count = parts.get_length(global)? as u32;
    if count < 2 {
        return Ok(None);
    }
    for at in 0..count {
        let part = parts.get_index(global, at)?;
        if let Some(file) = part
            .as_class_ref::<Blob>()
            .filter(|it| it.needs_to_read_file())
        {
            let Ok(copy) = in_memory(&file) else {
                return Ok(Some(file.dupe()));
            };
            parts.put_index(global, at, copy.into_js(global))?;
        }
    }
    Ok(None)
}

pub(crate) fn read(
    cx: &mut JsScope<'_>,
    file: &Blob,
    convert: fn(&Blob, &JsThread<'_>, Lifetime) -> JsResult<JSValue>,
) -> JSValue {
    let mime = file.content_type.get().clone();
    let promise = promise_for(cx, data_of(file).open().read_to_end(), move |cx, read| {
        let blob = Blob::init(
            read.map_err(|it| unreadable(&cx.heap, it))?.into_vec(),
            cx.global(),
        );
        blob.content_type.set(mime);
        let converted = convert(&blob, &cx.js_thread(), Lifetime::Transfer)?;
        Ok(JsLocal::new(&cx.heap, converted))
    });
    promise.to_js()
}

struct InParts(SharedBytes);

impl Source for InParts {
    fn poll_read(&mut self, _: &mut Context<'_>) -> Poll<Read> {
        let (all, now) = (self.0.len(), self.0.len().min(1 << 20));
        let part = self.0.slice(0..now);
        self.0 = self.0.slice(now..all);
        Poll::Ready(Ok((now > 0).then_some(Chunk::Shared(part))))
    }
}

pub(crate) fn stream(cx: &mut JsScope<'_>, blob: &Blob) -> JsResult<JSValue> {
    let body = match data_of(blob) {
        Data::Bytes(bytes) => Body::new(InParts(bytes)),
        file => file.open(),
    };
    stream_of(cx, Answer::of_body(body)).map_err(|it| it.into_js_error(cx.global()))
}

fn assemble(
    global: &JSGlobalObject,
    parts: JSValue,
    endings: EndingType,
    mime: &[u8],
) -> JsResult<Blob> {
    if endings == EndingType::Native {
        convert_line_endings(global, parts)?;
    }
    let blob = match read_files(global, parts)? {
        Some(unreadable) => unreadable,
        None => Blob::get::<false, true>(global, parts)?,
    };
    let blob = as_plain(blob, mime);
    blob.calculate_estimated_byte_size();
    Ok(blob)
}

pub(crate) fn construct_blob(
    global: &JSGlobalObject,
    parts: JSValue,
    options: JSValue,
) -> JsResult<bun_ptr::RefPtr<Blob>> {
    let parts = if parts.is_undefined() {
        JSValue::create_empty_array(global, 0)?
    } else {
        parts_of(global, parts)?
    };
    let options = BlobPropertyBag::from_js(global, options)?;
    Ok(Blob::new(assemble(
        global,
        parts,
        options.endings,
        options.r#type.as_deref().unwrap_or_default(),
    )?))
}

pub(crate) fn slice(
    global: &JSGlobalObject,
    blob: &Blob,
    start: JSValue,
    end: JSValue,
    mime: JSValue,
) -> JsResult<JSValue> {
    let size = blob.resolved_size().1 as i64;
    let relative = |given: JSValue, otherwise: i64| -> JsResult<i64> {
        let at = if given.is_undefined() {
            otherwise
        } else {
            given.to_number(global)?.round_ties_even() as i64
        };
        Ok(if at < 0 {
            at.saturating_add(size).max(0)
        } else {
            at.min(size)
        })
    };
    let (start, end) = (relative(start, 0)?, relative(end, size)?);
    let mime = if mime.is_undefined() {
        Vec::new()
    } else {
        mime.to_bun_string(global)?.to_owned_slice()
    };
    let part = blob.dupe();
    part.offset.set(blob.offset.get() + start as u64);
    part.size.set((end - start).max(0) as u64);
    Ok(as_plain(part, &mime).into_js(global))
}

fn as_file(blob: Blob, name: &[u8], modified: f64) -> Blob {
    blob.name.set(bun_core::String::clone_utf8(name));
    blob.last_modified.set(modified);
    blob.is_jsdom_file.set(true);
    blob
}

pub(crate) fn construct_file(
    global: &JSGlobalObject,
    parts: JSValue,
    name: JSValue,
    options: JSValue,
) -> JsResult<bun_ptr::RefPtr<Blob>> {
    let (parts, name) = (
        parts_of(global, parts)?,
        name.to_bun_string(global)?.to_owned_slice(),
    );
    let options = FilePropertyBag::from_js(global, options)?;
    let modified = options
        .last_modified
        .unwrap_or_else(bun_core::time::milli_timestamp);
    Ok(Blob::new(as_file(
        assemble(
            global,
            parts,
            options.endings,
            options.r#type.as_deref().unwrap_or_default(),
        )?,
        &name,
        modified as f64,
    )))
}

#[unsafe(no_mangle)]
fn __bun_web_create_blob(global: &JSGlobalObject, bytes: Vec<u8>, mime: &[u8]) -> JSValue {
    as_plain(Blob::init(bytes, global), mime).into_js(global)
}

#[unsafe(no_mangle)]
fn __bun_web_create_file(
    global: &JSGlobalObject,
    bytes: Vec<u8>,
    name: &[u8],
    mime: &[u8],
    modified: f64,
) -> JSValue {
    let file = as_file(as_plain(Blob::init(bytes, global), mime), name, modified).into_js(global);
    Bun__Desktop__adoptFile(global, file);
    file
}

fn snapshot_of(
    global: &JSGlobalObject,
    path: Vec<u8>,
    stat: &bun_sys::Stat,
    name: &[u8],
    was_chosen_by_user: bool,
) -> JSValue {
    let modified = time_of_modification(stat);
    let file = store::File {
        pathlike: PathOrFileDescriptor::Path(PathLike::owned(path)),
        mime_type: bun_http_types::MimeType::NONE,
        mode: stat.st_mode as bun_sys::Mode,
        seekable: Some(true),
        max_size: stat.st_size as u64,
        snapshot: Some(store::Snapshot {
            modified,
            was_chosen_by_user,
        }),
        ..Default::default()
    };
    let blob = Blob::init_with_store(
        RefPtr::new(Store::new(
            store::Data::File(file),
            bun_http_types::MimeType::NONE,
        )),
        global,
    );
    blob.size.set(stat.st_size as u64);
    let file = as_file(
        as_plain(blob, &mime_of_name(name)),
        name,
        modified.div_euclid(1_000_000) as f64,
    )
    .into_js(global);
    Bun__Desktop__adoptFile(global, file);
    file
}

#[unsafe(no_mangle)]
fn __bun_web_create_snapshot(
    global: &JSGlobalObject,
    path: Vec<u8>,
    stat: &bun_sys::Stat,
    name: &[u8],
) -> JSValue {
    snapshot_of(global, path, stat, name, false)
}

#[unsafe(no_mangle)]
fn __bun_web_create_chosen_file(
    global: &JSGlobalObject,
    path: &[u8],
    stat: &bun_sys::Stat,
) -> JSValue {
    snapshot_of(global, path.to_vec(), stat, bun_paths::basename(path), true)
}

/// `blob:<origin>/<id>`
fn entry_of(url: &[u8]) -> Option<(Owner, UUID)> {
    let (origin, id) = strings::rsplit_once_char(url.strip_prefix(b"blob:")?, b'/')?;
    Some((Owner::Origin(origin.into()), UUID::parse(id).ok()?))
}

#[unsafe(export_name = "__bun_web_resolve_blob_url")]
pub(crate) fn resolve_url(url: &[u8]) -> Option<Blob> {
    let (owner, id) = entry_of(strings::split_once_char(url, b'#').map_or(url, |it| it.0))?;
    ObjectURLRegistry::singleton().dupe_of(&owner, id, VirtualMachine::get().global())
}

#[unsafe(no_mangle)]
fn __bun_web_revoke_blob_url(url: &[u8]) {
    if let Some((owner, id)) = entry_of(url) {
        ObjectURLRegistry::singleton().remove(&owner, id);
    }
}

#[unsafe(no_mangle)]
fn __bun_web_lend_module(global: &JSGlobalObject, source: Vec<u8>) -> Vec<u8> {
    let blob = as_plain(Blob::init(source, global), b"text/javascript");
    format!(
        "blob:{}",
        ObjectURLRegistry::singleton().register(VirtualMachine::get(), &blob, Owner::Program)
    )
    .into_bytes()
}

#[unsafe(no_mangle)]
fn __bun_web_reclaim_module(url: &[u8]) {
    ObjectURLRegistry::singleton().revoke(&url[b"blob:".len()..]);
}

fn origin_of(realm: &Realm) -> Box<[u8]> {
    realm
        .client()
        .map_or_else(|| b"null"[..].into(), |it| it.origin().as_bytes().into())
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__createObjectURL(
    global: &JSGlobalObject,
    blob: &Blob,
) -> bun_core::String {
    let Some(realm) = Realm::of(global) else {
        return bun_core::String::EMPTY;
    };
    let origin = origin_of(realm);
    let id = ObjectURLRegistry::singleton().register(
        VirtualMachine::get(),
        blob,
        Owner::Origin(origin.clone()),
    );
    let url = format!("blob:{}/{id}", bstr::BStr::new(&origin));
    realm.adopt_blob_url(url.as_bytes());
    bun_core::String::clone_utf8(url.as_bytes())
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__revokeObjectURL(global: &JSGlobalObject, url: &bun_core::String) {
    let url = url.to_utf8();
    if let Some(realm) = Realm::of(global).filter(|it| {
        entry_of(url.slice()).is_some_and(|entry| entry.0 == Owner::Origin(origin_of(it)))
    }) {
        realm.revoke_blob_url(url.slice());
    }
}

/// Unlike `Bun.file()`, which stands for a path.
#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__isBlobOfWeb(blob: &Blob) -> bool {
    blob.snapshot().is_some() || (!blob.needs_to_read_file() && !blob.is_s3())
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__retainBlob(blob: &Blob, id: &mut [u8; 16]) {
    *id = ObjectURLRegistry::singleton()
        .register(VirtualMachine::get(), blob, Owner::Message)
        .bytes;
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__releaseBlob(id: &[u8; 16]) {
    ObjectURLRegistry::singleton().remove(&Owner::Message, UUID { bytes: *id });
}

/// `JSValue::ZERO` if no message has it.
#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__retainedBlob(global: &JSGlobalObject, id: &[u8; 16]) -> JSValue {
    ObjectURLRegistry::singleton()
        .dupe_of(&Owner::Message, UUID { bytes: *id }, global)
        .map_or(JSValue::ZERO, |it| it.into_js(global))
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__nameOfFile(file: &Blob) -> bun_core::String {
    file.get_name_string()
        .cloned()
        .unwrap_or(bun_core::String::EMPTY)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__lastModifiedOfFile(file: &Blob) -> f64 {
    file.get_last_modified()
}
