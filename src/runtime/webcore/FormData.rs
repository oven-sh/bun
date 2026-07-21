//! HTML `FormData` parsing + JS bridge.

use bun_collections::ArrayHashMap;
use bun_core::{self, declare_scope, scoped_log};
use bun_core::{ZigString, ZigStringSlice, strings};
use bun_jsc::{
    AnyPromise, CallFrame, DOMFormData, JSGlobalObject, JSValue, JsError, JsResult, JsTerminated,
    Local, Scope, ZigStringJsc as _,
};
use bun_semver::{self, SlicedString};
use core::ffi::c_void;

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;

declare_scope!(FormData, visible);

pub struct FormData<'a> {
    pub fields: Map<'a>,
    /// Borrows into caller-owned input.
    pub buffer: &'a [u8],
}

pub type Map<'a> = ArrayHashMap<bun_semver::String, FieldEntry<'a>>;

// `Encoding`, `get_boundary`, and `AsyncFormData` are JSC-free and live in the
// lower-tier `bun_core::form_data` so `Body`/`Request`/`Response` can name them
// without depending on `bun_runtime`. Re-exported here so `crate::webcore::
// form_data::*` callers see the same nominal types.
pub use bun_core::form_data::{AsyncFormData, Encoding, get_boundary};

/// JSC-touching extension on `AsyncFormData` (lives in this crate because it
/// needs `JSGlobalObject` + `AnyPromise`).
pub trait AsyncFormDataExt {
    fn to_js(
        &self,
        global: &JSGlobalObject,
        data: &[u8],
        promise: AnyPromise,
    ) -> Result<(), JsTerminated>;
}

impl AsyncFormDataExt for AsyncFormData {
    // Only a VM-termination error can escape
    // (JS exceptions are routed into the promise rejection above).
    fn to_js(
        &self,
        global: &JSGlobalObject,
        data: &[u8],
        promise: AnyPromise,
    ) -> Result<(), JsTerminated> {
        if let Encoding::Multipart(b) = &self.encoding {
            if b.is_empty() {
                scoped_log!(
                    FormData,
                    "AsnycFormData.toJS -> promise.reject missing boundary"
                );
                promise.reject(
                    global,
                    ZigString::init(b"FormData missing boundary").to_error_instance(global),
                )?;
                return Ok(());
            }
        }

        let js_value = match FormData::to_js(global, data, &self.encoding) {
            Ok(v) => v,
            Err(e) => {
                scoped_log!(FormData, "AsnycFormData.toJS -> failed ");
                promise.reject(
                    global,
                    global.create_error_instance(format_args!("FormData {}", e.name())),
                )?;
                return Ok(());
            }
        };
        promise.resolve(global, js_value)?;
        Ok(())
    }
}

/// Raw slice into the input buffer. Not using `bun.Semver.String` because
/// file bodies are binary data that can contain null bytes, which
/// Semver.String's inline storage treats as terminators.
pub struct Field<'a> {
    /// Borrows into the caller-owned input buffer (binary body slice).
    pub value: &'a [u8],
    pub filename: bun_semver::String,
    pub content_type: bun_semver::String,
    pub is_file: bool,
    pub zero_count: u8,
}

impl Default for Field<'_> {
    fn default() -> Self {
        Field {
            value: b"",
            filename: bun_semver::String::default(),
            content_type: bun_semver::String::default(),
            is_file: false,
            zero_count: 0,
        }
    }
}

pub enum FieldEntry<'a> {
    Field(Field<'a>),
    List(Vec<Field<'a>>),
}

#[repr(C)]
pub struct FieldExternal {
    pub name: ZigString,
    pub value: ZigString,
    pub blob: *mut Blob,
}

impl Default for FieldExternal {
    fn default() -> Self {
        FieldExternal {
            name: ZigString::default(),
            value: ZigString::default(),
            blob: core::ptr::null_mut(),
        }
    }
}

impl FormData<'_> {
    pub fn to_js(
        global: &JSGlobalObject,
        input: &[u8],
        encoding: &Encoding,
    ) -> crate::Result<JSValue> {
        match encoding {
            Encoding::URLEncoded => {
                let str = ZigString::from_utf8(strings::without_utf8_bom(input));
                // C++ may throw (e.g. string too long) — `create_from_url_query`
                // wraps the FFI in a validation scope and maps zero → JsError.
                DOMFormData::create_from_url_query(global, &str).map_err(|_| crate::Error::JSError)
            }
            Encoding::Multipart(boundary) => to_js_from_multipart_data(global, input, boundary),
        }
    }
}

#[bun_jsc::host_fn(export = "FormData__jsFunctionFromMultipartData", scoped)]
pub fn from_multipart_data<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    let args = frame.scoped_arguments::<2>(scope);
    let input_value = args.ptr[0];
    let boundary_value = args.ptr[1];
    let boundary_slice: ZigStringSlice;

    let mut encoding = Encoding::URLEncoded;

    if input_value.is_empty_or_undefined_or_null() {
        return Err(scope.throw_invalid_arguments(format_args!("input must not be empty")));
    }

    if !boundary_value.is_empty_or_undefined_or_null() {
        if let Some(array_buffer) = boundary_value.array_buffer_bytes(scope) {
            if !array_buffer.is_empty() {
                encoding = Encoding::Multipart(Box::from(&*array_buffer));
            }
        } else if boundary_value.is_string() {
            boundary_slice = boundary_value.unscoped().to_slice_or_null(global)?;
            if !boundary_slice.slice().is_empty() {
                encoding = Encoding::Multipart(Box::from(boundary_slice.slice()));
            }
        } else {
            return Err(scope.throw_invalid_arguments(format_args!(
                "boundary must be a string or ArrayBufferView"
            )));
        }
    }
    let input_slice: ZigStringSlice;
    // Keep the `ArrayBuffer` view alive for the duration of `input`'s borrow.
    let input_array_buffer;
    let input: &[u8];

    if let Some(array_buffer) = input_value.array_buffer_bytes(scope) {
        input_array_buffer = array_buffer;
        input = &input_array_buffer;
    } else if input_value.is_string() {
        input_slice = input_value.unscoped().to_slice_or_null(global)?;
        input = input_slice.slice();
    } else if let Some(blob) = input_value.as_class_ref::<Blob>() {
        input = blob.shared_view();
    } else {
        return Err(scope
            .throw_invalid_arguments(format_args!("input must be a string or ArrayBufferView")));
    }

    match FormData::to_js(global, input, &encoding) {
        Ok(v) => Ok(scope.local(v)),
        Err(crate::Error::JSError) => Err(JsError::Thrown),
        Err(crate::Error::JSTerminated) => Err(JsError::Terminated),
        Err(e) => Err(global.throw_error(e, "while parsing FormData")),
    }
}

pub fn to_js_from_multipart_data(
    global: &JSGlobalObject,
    input: &[u8],
    boundary: &[u8],
) -> crate::Result<JSValue> {
    let form_data_value = DOMFormData::create(global);
    form_data_value.ensure_still_alive();
    let Some(form) = DOMFormData::from_js(form_data_value) else {
        scoped_log!(FormData, "failed to create DOMFormData.fromJS");
        return Err(crate::Error::FailedToParseMultipartData);
    };

    struct Wrapper<'a> {
        global: &'a JSGlobalObject,
        form: &'a mut DOMFormData,
    }

    impl<'a> Wrapper<'a> {
        fn on_entry(wrap: &mut Self, name: bun_semver::String, field: &Field<'_>, buf: &[u8]) {
            let value_str: &[u8] = field.value;
            let key = ZigString::init_utf8(name.slice(buf));

            if field.is_file {
                let filename_str = field.filename.slice(buf);

                let mut blob = Blob::create(value_str, wrap.global, false);
                let filename = ZigString::init_utf8(filename_str);

                if !field.content_type.is_empty() {
                    let ct = field.content_type.slice(buf);
                    blob.content_type
                        .set(crate::webcore::blob::BlobContentType::Owned(ct.into()));
                    blob.content_type_was_set.set(true);
                } else {
                    let mime = 'brk: {
                        if !filename_str.is_empty() {
                            let extension = bun_paths::extension(filename_str);
                            if !extension.is_empty() {
                                if let Some(m) =
                                    bun_http::MimeType::by_extension_no_default(&extension[1..])
                                {
                                    break 'brk Some(m);
                                }
                            }
                        }
                        bun_http::MimeType::sniff(value_str)
                    };
                    if let Some(mime) = mime {
                        blob.content_type
                            .set(crate::webcore::blob::BlobContentType::from(mime));
                        blob.content_type_was_set.set(false);
                    }
                }

                wrap.form.append_blob(
                    wrap.global,
                    &key,
                    (&raw mut blob).cast::<c_void>(),
                    &filename,
                );
                // `append_blob` dupes the content type; release this stack-local.
                blob.detach();
            } else {
                let value = ZigString::init_utf8(
                    // > Each part whose `Content-Disposition` header does not
                    // > contain a `filename` parameter must be parsed into an
                    // > entry whose value is the UTF-8 decoded without BOM
                    // > content of the part. This is done regardless of the
                    // > presence or the value of a `Content-Type` header and
                    // > regardless of the presence or the value of a
                    // > `charset` parameter.
                    strings::without_utf8_bom(value_str),
                );
                wrap.form.append(&key, &value);
            }
        }
    }

    {
        let mut wrap = Wrapper { global, form };

        if let Err(e) = for_each_multipart_entry(input, boundary, &mut wrap, Wrapper::on_entry) {
            scoped_log!(FormData, "failed to parse multipart data");
            return Err(e);
        }
    }

    Ok(form_data_value)
}

pub fn for_each_multipart_entry<C>(
    input: &[u8],
    boundary: &[u8],
    ctx: &mut C,
    mut iterator: impl FnMut(&mut C, bun_semver::String, &Field<'_>, &[u8]),
) -> crate::Result<()> {
    let mut slice = input;
    let subslicer = SlicedString::init(input, input);

    let mut buf = [0u8; 76];
    {
        // Hand-rolled `--{boundary}--` formatting — boundary is raw bytes,
        // not guaranteed UTF-8, so avoid `core::fmt`.
        let need = boundary.len() + 4;
        if need > buf.len() {
            return Err(crate::Error::BoundaryIsTooLong);
        }
        buf[..2].copy_from_slice(b"--");
        buf[2..2 + boundary.len()].copy_from_slice(boundary);
        buf[2 + boundary.len()..need].copy_from_slice(b"--");
        let final_boundary = &buf[..need];

        let Some(final_boundary_index) = strings::last_index_of(input, final_boundary) else {
            return Err(crate::Error::MissingFinalBoundary);
        };
        slice = &slice[..final_boundary_index];
    }

    // Hand-rolled `--{boundary}\r\n` formatting (same raw-bytes caveat).
    // Length check already passed above (same `boundary.len() + 4`).
    let sep_len = boundary.len() + 4;
    buf[..2].copy_from_slice(b"--");
    buf[2..2 + boundary.len()].copy_from_slice(boundary);
    buf[2 + boundary.len()..sep_len].copy_from_slice(b"\r\n");
    let separator = &buf[..sep_len];

    let mut splitter = strings::split(slice, separator);
    let _ = splitter.next(); // skip first boundary

    while let Some(chunk) = splitter.next() {
        let mut remain = chunk;
        let header_end =
            strings::index_of(remain, b"\r\n\r\n").ok_or(crate::Error::IsMissingHeaderEnd)?;
        let header = &remain[..header_end + 2];
        remain = &remain[header_end + 4..];

        let mut field = Field::default();
        let mut name = bun_semver::String::default();
        let mut filename: Option<bun_semver::String> = None;
        let mut header_chunk = header;
        let mut is_file = false;
        while !header_chunk.is_empty() && (filename.is_none() || name.len() == 0) {
            let line_end = strings::index_of(header_chunk, b"\r\n")
                .ok_or(crate::Error::IsMissingHeaderLineEnd)?;
            let line = &header_chunk[..line_end];
            header_chunk = &header_chunk[line_end + 2..];
            let colon =
                strings::index_of(line, b":").ok_or(crate::Error::IsMissingHeaderColonSeparator)?;

            let key = &line[..colon];
            let mut value: &[u8] = if line.len() > colon + 1 {
                &line[colon + 1..]
            } else {
                b""
            };
            if strings::eql_case_insensitive_ascii(key, b"content-disposition", true) {
                // OWS after the colon is SP or HTAB (RFC 9112 §5.6.3); the
                // disposition type is a case-insensitive token (RFC 2183 §2).
                value = strings::trim(value, b" \t");
                if strings::starts_with_case_insensitive_ascii(value, b"form-data;") {
                    value = &value[b"form-data;".len()..];
                    value = strings::trim(value, b" \t");
                }

                while let Some(eql_start) = strings::index_of(value, b"=") {
                    let eql_key = strings::trim(&value[..eql_start], b" \t;");
                    value = &value[eql_start + 1..];
                    if value.starts_with(b"\"") {
                        value = &value[1..];
                    }

                    let mut field_value = value;
                    {
                        let mut i: usize = 0;
                        while i < field_value.len() {
                            match field_value[i] {
                                b'"' => {
                                    field_value = &field_value[..i];
                                    break;
                                }
                                b'\\' => {
                                    i += (field_value.len() > i + 1 && field_value[i + 1] == b'"')
                                        as usize;
                                }
                                // the spec requires a end quote, but some browsers don't send it
                                _ => {}
                            }
                            i += 1;
                        }
                        value = &value[(i + 1).min(value.len())..];
                    }

                    if strings::eql_case_insensitive_ascii(eql_key, b"name", true) {
                        name = subslicer.sub(field_value).value();
                    } else if strings::eql_case_insensitive_ascii(eql_key, b"filename", true) {
                        filename = Some(subslicer.sub(field_value).value());
                        is_file = true;
                    }

                    if !name.is_empty() && filename.is_some() {
                        break;
                    }

                    if let Some(semi_start) = strings::index_of_char(value, b';') {
                        value = &value[semi_start as usize + 1..];
                    } else {
                        break;
                    }
                }
            } else if !value.is_empty()
                && field.content_type.is_empty()
                && strings::eql_case_insensitive_ascii(key, b"content-type", true)
            {
                let trimmed = strings::trim(value, b"; \t");
                // Only an exact `\r\n` terminates a header line above, so a bare
                // CR or LF can survive into the value. Reject anything outside
                // printable ASCII so it cannot reach `blob.content_type` and be
                // reflected verbatim into outgoing request headers. HTAB stays
                // allowed: it is valid optional whitespace inside a field value
                // and cannot start a new header line.
                if trimmed
                    .iter()
                    .all(|&b| b == b'\t' || (0x20..=0x7E).contains(&b))
                {
                    field.content_type = subslicer.sub(trimmed).value();
                }
            }
        }

        if name.len() + field.zero_count as usize == 0 {
            continue;
        }

        let mut body = remain;
        if body.ends_with(b"\r\n") {
            body = &body[..body.len() - 2];
        }
        field.value = body;
        field.filename = filename.unwrap_or_default();
        field.is_file = is_file;

        iterator(ctx, name, &field, input);
    }

    Ok(())
}
