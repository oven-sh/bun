//! Between `FormData` and bodies.

use core::ffi::c_void;

use bun_core::{EncodedSlice, strings};
use bun_jsc::DOMFormData;
use bun_jsc::webcore_types::Blob as JsBlob;
use bun_web::convert::blob_from_js;
use bun_web::encoding::{Entry, new_multipart_boundary};
use bun_web::headers::trim_tabs_and_spaces;
use bun_web::mime::Mime;
use bun_web::net::body::{Blob, Data};
use bun_web::runtime::create_file;
use bun_web::time::wall_now;
use bun_web::url::parse_url_encoded;

use super::*;

unsafe extern "C" {
    safe fn DOMFormData__forEach(
        form: &DOMFormData,
        context: *mut c_void,
        each: unsafe extern "C" fn(
            *mut c_void,
            &EncodedSlice,
            *const c_void,
            Option<&EncodedSlice>,
            u8,
        ),
    );
}

struct Field {
    name: String,
    /// Or the name of the file.
    value: String,
    file: Option<Option<Blob>>,
}

/// And its type. `None` if a file cannot be read.
#[optimize(size)]
pub(super) fn encode(form: &DOMFormData) -> Option<(Data, Vec<u8>)> {
    #[optimize(size)]
    unsafe extern "C" fn collect(
        fields: *mut c_void,
        name: &EncodedSlice,
        value: *const c_void,
        file_name: Option<&EncodedSlice>,
        is_file: u8,
    ) {
        let text = |it: &EncodedSlice| bstr::ByteSlice::to_str_lossy(&*it.to_utf8()).into_owned();
        // SAFETY: what is passed below, and `value` is what `is_file` says.
        unsafe {
            (*fields.cast::<Vec<Field>>()).push(match is_file {
                0 => Field {
                    name: text(name),
                    value: text(&*value.cast()),
                    file: None,
                },
                _ => Field {
                    name: text(name),
                    value: file_name.map_or_else(|| "blob".into(), text),
                    file: Some(blob_from_js(&*value.cast::<JsBlob>())),
                },
            });
        }
    }
    let mut fields = Vec::<Field>::new();
    DOMFormData__forEach(form, (&raw mut fields).cast(), collect);
    let boundary = new_multipart_boundary();
    let entries = fields.iter().map(|it| Entry {
        name: &it.name,
        value: &it.value,
        file_type: it
            .file
            .as_ref()
            .map(|it| it.as_ref().map_or(&b""[..], |it| &it.mime)),
    });
    let (text, gaps) = Encoding::default().multipart(entries, &boundary);
    let (text, mut parts, mut at) = (Data::Bytes(text.into()), Vec::new(), 0);
    for (gap, file) in gaps
        .into_iter()
        .zip(fields.into_iter().filter_map(|it| it.file))
    {
        parts.extend([text.slice(at..gap as u64), file?.data]);
        at = gap as u64;
    }
    parts.push(text.slice(at..text.len()));
    Some((
        Data::concat(parts),
        [&b"multipart/form-data; boundary="[..], &boundary].concat(),
    ))
}

struct Part<'b> {
    name: Vec<u8>,
    file_name: Option<Vec<u8>>,
    mime: &'b [u8],
    content: &'b [u8],
}

#[optimize(size)]
fn disposition_parameter(mut parameters: &[u8], wanted: &[u8]) -> Option<Vec<u8>> {
    loop {
        let (name, rest) = strings::split_once_char(parameters, b'=')?;
        let (value, rest) = match rest.strip_prefix(b"\"") {
            Some(quoted) => strings::split_once_char(quoted, b'"')?,
            None => rest.split_at(strings::index_of_char_usize(rest, b';').unwrap_or(rest.len())),
        };
        if trim_tabs_and_spaces(name).eq_ignore_ascii_case(wanted) {
            let escapes = [
                (b"%0A", b"\n"),
                (b"%0a", b"\n"),
                (b"%0D", b"\r"),
                (b"%0d", b"\r"),
                (b"%22", b"\""),
            ];
            return Some(escapes.into_iter().fold(value.to_vec(), |text, it| {
                strings::replace_owned(&text, it.0, it.1)
            }));
        }
        parameters = strings::split_once_char(rest, b';')?.1;
    }
}

#[optimize(size)]
fn parse_multipart<'b>(bytes: &'b [u8], boundary: &[u8]) -> Option<Vec<Part<'b>>> {
    let (mut rest, mut parts) = (bytes.strip_prefix(b"\r\n").unwrap_or(bytes), Vec::new());
    let delimiter = [b"\r\n--", boundary].concat();
    loop {
        rest = rest.strip_prefix(&delimiter[2..])?;
        if let Some(after) = rest.strip_prefix(b"--") {
            return (after.is_empty() || after.starts_with(b"\r\n")).then_some(parts);
        }
        rest = strings::trim_left(rest, b" \t").strip_prefix(b"\r\n")?;
        let (head, body) = rest.split_at(strings::index_of(rest, b"\r\n\r\n")? + 4);
        let header = |wanted: &[u8]| {
            strings::split(head, b"\r\n")
                .filter_map(|it| strings::split_once_char(it, b':'))
                .find(|it| it.0.eq_ignore_ascii_case(wanted))
        };
        let (kind, parameters) = strings::split_once_char(header(b"content-disposition")?.1, b';')?;
        trim_tabs_and_spaces(kind)
            .eq_ignore_ascii_case(b"form-data")
            .then_some(())?;
        let (content, after) = body.split_at(strings::index_of(body, &delimiter)?);
        let mime =
            header(b"content-type").map_or(&b"text/plain"[..], |it| trim_tabs_and_spaces(it.1));
        parts.push(Part {
            name: disposition_parameter(parameters, b"name")?,
            file_name: disposition_parameter(parameters, b"filename"),
            mime,
            content,
        });
        rest = &after[2..];
    }
}

#[optimize(size)]
pub(super) fn decode<'a>(cx: Cx<'_, 'a>, bytes: &[u8], mime: Option<&Mime>) -> Result<'a, JSValue> {
    let value = DOMFormData::create(cx.global());
    let form = DOMFormData::from_js(&value)
        .ok_or_else(|| type_error(&cx.heap, "There is no FormData."))?;
    let lossy = |it: &[u8]| bstr::ByteSlice::to_str_lossy(it).into_owned();
    let append = |cx: Cx<'_, 'a>, name: &[u8], value: &[u8]| {
        form.append(
            cx.global(),
            &EncodedSlice::utf8(lossy(name).as_bytes()),
            &EncodedSlice::utf8(lossy(value).as_bytes()),
        )
    };
    match mime.map(Mime::essence) {
        Some(b"application/x-www-form-urlencoded") => {
            parse_url_encoded(bytes).try_for_each(|it| append(cx, &it.0, &it.1))?
        }
        Some(b"multipart/form-data") => {
            let parts = mime
                .as_ref()
                .and_then(|it| parse_multipart(bytes, it.parameter(b"boundary")?));
            for part in parts
                .ok_or_else(|| type_error(&cx.heap, "Failed to parse the body as FormData."))?
            {
                let Some(file_name) = part.file_name.map(|it| lossy(&it)) else {
                    append(cx, &part.name, part.content)?;
                    continue;
                };
                let file = create_file(
                    cx.global(),
                    part.content.to_vec(),
                    file_name.as_bytes(),
                    part.mime,
                    (wall_now() * 1e3).floor(),
                );
                let blob = file
                    .as_class_ref::<JsBlob>()
                    .map_or(core::ptr::null_mut(), |it| {
                        core::ptr::from_ref::<JsBlob>(&it).cast_mut().cast()
                    });
                form.append_blob(
                    cx.global(),
                    &EncodedSlice::utf8(lossy(&part.name).as_bytes()),
                    blob,
                    &EncodedSlice::utf8(file_name.as_bytes()),
                )?;
                file.ensure_still_alive();
            }
        }
        _ => return Err(type_error(&cx.heap, "The body is not a form.")),
    }
    drop(form);
    Ok(value)
}
