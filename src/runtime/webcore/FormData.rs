//! HTML `FormData` parsing + JS bridge. Moved from `url/url.zig` because the
//! struct is webcore (fetch Body) and JSC-heavy; `url/` is JSC-free.

use bun_collections::{ArrayHashMap, BabyList};
use bun_core::{self, err};
use bun_jsc::{AnyPromise, CallFrame, DOMFormData, JSGlobalObject, JSValue, JsError, JsResult};
use bun_output::{declare_scope, scoped_log};
use bun_semver::{self, SlicedString};
use bun_str::{strings, ZigString};

use crate::webcore::Blob;

declare_scope!(FormData, visible);

pub struct FormData {
    pub fields: Map,
    // TODO(port): lifetime — borrows into caller-owned input; Phase B may lift
    // to `&'a [u8]` once borrowck threads through callers.
    pub buffer: *const [u8],
}

pub type Map = ArrayHashMap<bun_semver::String, FieldEntry>;
// PORT NOTE: Zig used `bun.Semver.String.ArrayHashContext` + store_hash=false;
// `bun_collections::ArrayHashMap` is wyhash-keyed — Phase B confirm context match.

pub enum Encoding {
    URLEncoded,
    /// boundary
    // PERF(port): Zig held a borrowed `[]const u8` here; boxed because
    // `AsyncFormData.deinit` frees it (Phase-A `[]const u8`-field rule). Hot
    // callers (`from_multipart_data`, `Encoding::get`) now allocate once where
    // Zig did not — profile in Phase B and consider `Encoding<'a>`.
    Multipart(Box<[u8]>),
}

impl Encoding {
    pub fn get(content_type: &[u8]) -> Option<Encoding> {
        if strings::index_of(content_type, b"application/x-www-form-urlencoded").is_some() {
            return Some(Encoding::URLEncoded);
        }

        if strings::index_of(content_type, b"multipart/form-data").is_none() {
            return None;
        }

        let boundary = get_boundary(content_type)?;
        Some(Encoding::Multipart(Box::from(boundary)))
    }
}

pub struct AsyncFormData {
    pub encoding: Encoding,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator`; deleted (non-AST
    // crate, global mimalloc).
}

impl AsyncFormData {
    pub fn init(encoding: Encoding) -> Box<AsyncFormData> {
        // PORT NOTE: Zig duped `encoding.Multipart` here so the struct owned
        // its boundary. With `Encoding::Multipart(Box<[u8]>)` the caller has
        // already transferred ownership, so the match collapses to a move.
        Box::new(AsyncFormData { encoding })
    }

    // PORT NOTE: Zig `deinit` only freed `encoding.Multipart` then
    // `allocator.destroy(this)`. Both are automatic via `Drop` on
    // `Box<AsyncFormData>` / `Box<[u8]>`; no explicit `Drop` impl needed.

    // TODO(port): `bun.JSTerminated!void` — mapped to `JsResult<()>`; Phase B
    // narrow to a `Terminated`-only error set if one exists.
    pub fn to_js(
        &self,
        global: &JSGlobalObject,
        data: &[u8],
        promise: AnyPromise,
    ) -> JsResult<()> {
        if let Encoding::Multipart(b) = &self.encoding {
            if b.is_empty() {
                scoped_log!(FormData, "AsnycFormData.toJS -> promise.reject missing boundary");
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

pub fn get_boundary(content_type: &[u8]) -> Option<&[u8]> {
    let boundary_index = strings::index_of(content_type, b"boundary=")?;
    let boundary_start = boundary_index + b"boundary=".len();
    let begin = &content_type[boundary_start..];
    if begin.is_empty() {
        return None;
    }

    let boundary_end = strings::index_of_char(begin, b';').unwrap_or(begin.len() as u32);
    if begin[0] == b'"' {
        if boundary_end > 1 && begin[boundary_end as usize - 1] == b'"' {
            return Some(&begin[1..boundary_end as usize - 1]);
        }
        // Opening quote with no matching closing quote — malformed.
        return None;
    }

    Some(&begin[..boundary_end as usize])
}

/// Raw slice into the input buffer. Not using `bun.Semver.String` because
/// file bodies are binary data that can contain null bytes, which
/// Semver.String's inline storage treats as terminators.
pub struct Field {
    // TODO(port): lifetime — borrows into caller-owned input buffer (binary
    // body slice, never freed here); Phase B may lift to `&'a [u8]`.
    pub value: *const [u8],
    pub filename: bun_semver::String,
    pub content_type: bun_semver::String,
    pub is_file: bool,
    pub zero_count: u8,
}

impl Default for Field {
    fn default() -> Self {
        Field {
            value: b"" as *const [u8],
            filename: bun_semver::String::default(),
            content_type: bun_semver::String::default(),
            is_file: false,
            zero_count: 0,
        }
    }
}

pub enum FieldEntry {
    Field(Field),
    List(BabyList<Field>),
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

impl FormData {
    // TODO(port): narrow error set
    pub fn to_js(
        global: &JSGlobalObject,
        input: &[u8],
        encoding: &Encoding,
    ) -> Result<JSValue, bun_core::Error> {
        match encoding {
            Encoding::URLEncoded => {
                let mut str = ZigString::from_utf8(strings::without_utf8_bom(input));
                let result = DOMFormData::create_from_url_query(global, &mut str);
                // Check if an exception was thrown (e.g., string too long)
                if result.is_empty() {
                    return Err(err!("JSError"));
                }
                Ok(result)
            }
            Encoding::Multipart(boundary) => to_js_from_multipart_data(global, input, boundary),
        }
    }
}

#[bun_jsc::host_fn]
// TODO(port): Zig `@export(&jsc.toJSHostFn(fromMultipartData), .{ .name = "FormData__jsFunctionFromMultipartData" })`
// — confirm `#[bun_jsc::host_fn]` emits the shim under that exact symbol name,
// or add `#[unsafe(no_mangle)]` wrapper in Phase B.
pub fn from_multipart_data(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: `jsc.markBinding(@src())` dropped — debug-only source marker.

    // TODO(port): `callframe.arguments_old(2)` — exact Rust shape of the
    // returned buffer (`.ptr[0..2]` in Zig). Assuming indexable `[JSValue; 2]`.
    let args = frame.arguments_old(2);
    let input_value = args[0];
    let boundary_value = args[1];
    let mut boundary_slice = ZigString::Slice::empty();
    // PORT NOTE: `defer boundary_slice.deinit()` — handled by `Drop`.

    let mut encoding = Encoding::URLEncoded;

    if input_value.is_empty_or_undefined_or_null() {
        return global.throw_invalid_arguments(format_args!("input must not be empty"));
    }

    if !boundary_value.is_empty_or_undefined_or_null() {
        if let Some(array_buffer) = boundary_value.as_array_buffer(global) {
            if !array_buffer.byte_slice().is_empty() {
                encoding = Encoding::Multipart(Box::from(array_buffer.byte_slice()));
            }
        } else if boundary_value.is_string() {
            boundary_slice = boundary_value.to_slice_or_null(global)?;
            if boundary_slice.len() > 0 {
                encoding = Encoding::Multipart(Box::from(boundary_slice.slice()));
            }
        } else {
            return global.throw_invalid_arguments(format_args!(
                "boundary must be a string or ArrayBufferView"
            ));
        }
    }
    let mut input_slice = ZigString::Slice::default();
    // PORT NOTE: `defer input_slice.deinit()` — handled by `Drop`.
    let mut input: &[u8] = b"";

    if let Some(array_buffer) = input_value.as_array_buffer(global) {
        input = array_buffer.byte_slice();
    } else if input_value.is_string() {
        input_slice = input_value.to_slice_or_null(global)?;
        input = input_slice.slice();
    } else if let Some(blob) = input_value.as_::<Blob>() {
        // TODO(port): `JSValue::as_::<Blob>()` downcast helper name.
        input = blob.shared_view();
    } else {
        return global
            .throw_invalid_arguments(format_args!("input must be a string or ArrayBufferView"));
    }

    match FormData::to_js(global, input, &encoding) {
        Ok(v) => Ok(v),
        Err(e) if e == err!("JSError") => Err(JsError::Thrown),
        Err(e) if e == err!("JSTerminated") => Err(JsError::Terminated),
        // TODO(port): `globalThis.throwError(err, msg)` signature.
        Err(e) => global.throw_error(e, "while parsing FormData"),
    }
}

// TODO(port): narrow error set
pub fn to_js_from_multipart_data(
    global: &JSGlobalObject,
    input: &[u8],
    boundary: &[u8],
) -> Result<JSValue, bun_core::Error> {
    let form_data_value = DOMFormData::create(global);
    form_data_value.ensure_still_alive();
    let Some(form) = DOMFormData::from_js(form_data_value) else {
        scoped_log!(FormData, "failed to create DOMFormData.fromJS");
        return Err(err!("failed to parse multipart data"));
    };

    struct Wrapper<'a> {
        global: &'a JSGlobalObject,
        form: &'a mut DOMFormData,
    }

    impl<'a> Wrapper<'a> {
        fn on_entry(wrap: &mut Self, name: bun_semver::String, field: Field, buf: &[u8]) {
            // SAFETY: `field.value` points into `buf` (caller-owned input), valid for this call.
            let value_str: &[u8] = unsafe { &*field.value };
            let mut key = ZigString::init_utf8(name.slice(buf));

            if field.is_file {
                let filename_str = field.filename.slice(buf);

                // PORT NOTE: dropped `bun.default_allocator` arg.
                let mut blob = Blob::create(value_str, wrap.global, false);
                let mut filename = ZigString::init_utf8(filename_str);
                let content_type: &[u8] = 'brk: {
                    if !field.content_type.is_empty() {
                        break 'brk field.content_type.slice(buf);
                    }
                    if !filename_str.is_empty() {
                        let extension = bun_paths::extension(filename_str);
                        if !extension.is_empty() {
                            if let Some(mime) =
                                bun_http::MimeType::by_extension_no_default(&extension[1..])
                            {
                                break 'brk mime.value;
                            }
                        }
                    }

                    if let Some(mime) = bun_http::MimeType::sniff(value_str) {
                        break 'brk mime.value;
                    }

                    break 'brk b"";
                };

                if !content_type.is_empty() {
                    // TODO(port): `Blob.content_type*` field types — Zig stored
                    // `[]const u8` + `bool` flags; assuming Rust `Blob` exposes
                    // matching public fields. Revisit once `webcore::Blob` is ported.
                    if !field.content_type.is_empty() {
                        blob.content_type_allocated = true;
                        blob.content_type = Box::<[u8]>::from(content_type);
                        blob.content_type_was_set = true;
                    } else {
                        blob.content_type = content_type;
                        blob.content_type_was_set = false;
                        blob.content_type_allocated = false;
                    }
                }

                wrap.form
                    .append_blob(wrap.global, &mut key, &mut blob, &mut filename);
                // PORT NOTE: Zig `defer blob.detach()` — no early returns in
                // this branch, so call explicitly at scope end.
                blob.detach();
            } else {
                let mut value = ZigString::init_utf8(
                    // > Each part whose `Content-Disposition` header does not
                    // > contain a `filename` parameter must be parsed into an
                    // > entry whose value is the UTF-8 decoded without BOM
                    // > content of the part. This is done regardless of the
                    // > presence or the value of a `Content-Type` header and
                    // > regardless of the presence or the value of a
                    // > `charset` parameter.
                    strings::without_utf8_bom(value_str),
                );
                wrap.form.append(&mut key, &mut value);
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

// TODO(port): narrow error set
pub fn for_each_multipart_entry<C>(
    input: &[u8],
    boundary: &[u8],
    ctx: &mut C,
    mut iterator: impl FnMut(&mut C, bun_semver::String, Field, &[u8]),
) -> Result<(), bun_core::Error> {
    let mut slice = input;
    let subslicer = SlicedString::init(input, input);

    let mut buf = [0u8; 76];
    {
        // PORT NOTE: hand-rolled `std.fmt.bufPrint(&buf, "--{s}--", .{boundary})`
        // — boundary is raw bytes, not guaranteed UTF-8, so avoid `core::fmt`.
        let need = boundary.len() + 4;
        if need > buf.len() {
            return Err(err!("boundary is too long"));
        }
        buf[..2].copy_from_slice(b"--");
        buf[2..2 + boundary.len()].copy_from_slice(boundary);
        buf[2 + boundary.len()..need].copy_from_slice(b"--");
        let final_boundary = &buf[..need];

        let Some(final_boundary_index) = strings::last_index_of(input, final_boundary) else {
            return Err(err!("missing final boundary"));
        };
        slice = &slice[..final_boundary_index];
    }

    // PORT NOTE: hand-rolled `std.fmt.bufPrint(&buf, "--{s}\r\n", .{boundary})`.
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
        let header_end = strings::index_of(remain, b"\r\n\r\n")
            .ok_or(err!("is missing header end"))?;
        let header = &remain[..header_end + 2];
        remain = &remain[header_end + 4..];

        let mut field = Field::default();
        let mut name = bun_semver::String::default();
        let mut filename: Option<bun_semver::String> = None;
        let mut header_chunk = header;
        let mut is_file = false;
        while !header_chunk.is_empty() && (filename.is_none() || name.len() == 0) {
            let line_end = strings::index_of(header_chunk, b"\r\n")
                .ok_or(err!("is missing header line end"))?;
            let line = &header_chunk[..line_end];
            header_chunk = &header_chunk[line_end + 2..];
            let colon = strings::index_of(line, b":")
                .ok_or(err!("is missing header colon separator"))?;

            let key = &line[..colon];
            let mut value: &[u8] = if line.len() > colon + 1 {
                &line[colon + 1..]
            } else {
                b""
            };
            if strings::eql_case_insensitive_ascii(key, b"content-disposition", true) {
                value = strings::trim(value, b" ");
                if value.starts_with(b"form-data;") {
                    value = &value[b"form-data;".len()..];
                    value = strings::trim(value, b" ");
                }

                while let Some(eql_start) = strings::index_of(value, b"=") {
                    let eql_key = strings::trim(&value[..eql_start], b" ;");
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
                field.content_type = subslicer.sub(strings::trim(value, b"; \t")).value();
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

        iterator(ctx, name, field, input);
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/FormData.zig (418 lines)
//   confidence: medium
//   todos:      11
//   notes:      Encoding::Multipart boxed (was borrow); Field.value/FormData.buffer raw *const [u8] (borrow into caller input); host_fn export name + Blob field types need Phase-B wiring.
// ──────────────────────────────────────────────────────────────────────────
