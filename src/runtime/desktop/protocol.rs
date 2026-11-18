use std::cell::RefCell;
use std::collections::HashMap;

use bun_jsc::bindgen::{self, Callable, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSUint8Array, JSValue, JsClass, Strong, bun_string_jsc};

use crate::webcore::blob::{MAX_SIZE, store};
use crate::webcore::body::Value as BodyValue;
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::response;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
unsafe extern "C" {
    fn Bun__Desktop__sendSchemeResponseBytes(
        id: u32,
        task_id: u32,
        status: u16,
        headers_ptr: *const u8,
        headers_len: u32,
        body_ptr: *const u8,
        body_len: u32,
    );
    fn Bun__Desktop__sendSchemeResponseFile(
        id: u32,
        task_id: u32,
        status: u16,
        headers_ptr: *const u8,
        headers_len: u32,
        path_ptr: *const u8,
        path_len: u32,
        offset: u64,
        length: u64,
    );
    fn Bun__Desktop__sendSchemeResponseError(id: u32, task_id: u32, status: u16);
    fn Bun__Desktop__registerScheme(ptr: *const u8, len: u32);
}

thread_local! {
    static PROTOCOL_HANDLERS: RefCell<HashMap<String, Strong>> = RefCell::new(HashMap::new());
    static SCHEME_DISPATCHER: RefCell<Option<Strong>> = RefCell::new(None);
}

#[allow(dead_code)]
pub(crate) fn reset_on_hot_reload() {
    PROTOCOL_HANDLERS.with(|h| h.borrow_mut().clear());
}

fn parse_byte_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        let suffix: u64 = end_s.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total.saturating_sub(suffix);
        Some((start, total - 1))
    } else {
        let start: u64 = start_s.trim().parse().ok()?;
        if start >= total {
            return None;
        }
        let end = if end_s.trim().is_empty() {
            total - 1
        } else {
            end_s.trim().parse::<u64>().ok()?.min(total - 1)
        };
        if end < start {
            return None;
        }
        Some((start, end))
    }
}

fn append_headers_json(base_json: &[u8], extra: &[(&str, String)]) -> String {
    let base = core::str::from_utf8(base_json).unwrap_or("{}");
    let trimmed = base.trim();
    let mut out = String::from("{");
    let inner = trimmed
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .unwrap_or("")
        .trim();
    if !inner.is_empty() {
        out.push_str(inner);
    }
    for (k, v) in extra {
        if out.len() > 1 {
            out.push(',');
        }
        out.push('"');
        out.push_str(k);
        out.push_str("\":\"");
        for ch in v.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                _ => out.push(ch),
            }
        }
        out.push('"');
    }
    out.push('}');
    out
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onSchemeRequest(
    global: *mut JSGlobalObject,
    window_id: u32,
    task_id: u32,
    url_ptr: *const u8,
    url_len: u32,
    method_ptr: *const u8,
    method_len: u32,
    range_ptr: *const u8,
    range_len: u32,
    headers_ptr: *const u8,
    headers_len: u32,
    body_ptr: *const u8,
    body_len: u32,
) {
    if global.is_null() {
        return;
    }
    let dispatcher = SCHEME_DISPATCHER.with(|d| d.borrow().as_ref().map(|s| s.get()));
    let Some(func) = dispatcher else {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__sendSchemeResponseError(window_id, task_id, 404);
        }
        return;
    };
    let global_ref = unsafe { &*global };
    let url_bytes = if url_ptr.is_null() || url_len == 0 {
        &[][..]
    } else {
        unsafe { core::slice::from_raw_parts(url_ptr, url_len as usize) }
    };
    let method_bytes = if method_ptr.is_null() || method_len == 0 {
        &b"GET"[..]
    } else {
        unsafe { core::slice::from_raw_parts(method_ptr, method_len as usize) }
    };
    let range_bytes = if range_ptr.is_null() || range_len == 0 {
        &[][..]
    } else {
        unsafe { core::slice::from_raw_parts(range_ptr, range_len as usize) }
    };
    let headers_bytes = if headers_ptr.is_null() || headers_len == 0 {
        &b"{}"[..]
    } else {
        unsafe { core::slice::from_raw_parts(headers_ptr, headers_len as usize) }
    };
    let Ok(url_js) = bun_string_jsc::create_utf8_for_js(global_ref, url_bytes) else {
        return;
    };
    let Ok(method_js) = bun_string_jsc::create_utf8_for_js(global_ref, method_bytes) else {
        return;
    };
    let Ok(range_js) = bun_string_jsc::create_utf8_for_js(global_ref, range_bytes) else {
        return;
    };
    let Ok(headers_js) = bun_string_jsc::create_utf8_for_js(global_ref, headers_bytes) else {
        return;
    };
    let body_js = if body_ptr.is_null() || body_len == 0 {
        JSValue::UNDEFINED
    } else {
        let body_bytes = unsafe { core::slice::from_raw_parts(body_ptr, body_len as usize) };
        JSUint8Array::from_bytes_copy(global_ref, body_bytes).unwrap_or(JSValue::UNDEFINED)
    };
    let args = [
        JSValue::js_number(window_id as f64),
        JSValue::js_number(task_id as f64),
        url_js,
        method_js,
        range_js,
        headers_js,
        body_js,
    ];
    let _ = func.call(global_ref, JSValue::UNDEFINED, &args);
}

pub(crate) mod protocol {
    use super::*;

    pub(crate) fn register_scheme(scheme: &[u8]) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        if !scheme.is_empty() {
            unsafe {
                Bun__Desktop__registerScheme(scheme.as_ptr(), scheme.len() as u32);
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = scheme;
    }

    pub(crate) fn handle<'a>(
        cx: &mut JsScope<'a>,
        scheme: &[u8],
        handler: JsLocal<'a, Callable>,
    ) -> bindgen::Result<'a, ()> {
        let key = String::from_utf8_lossy(scheme).to_ascii_lowercase();
        if key.is_empty() {
            return Err(cx
                .heap
                .error(format_args!("protocol.handle() expects a non-empty scheme")));
        }
        register_scheme(key.as_bytes());
        let strong = Strong::create(handler.to_js(), cx.global());
        PROTOCOL_HANDLERS.with(|h| {
            h.borrow_mut().insert(key, strong);
        });
        Ok(())
    }

    pub(crate) fn unhandle(scheme: &[u8]) {
        let key = String::from_utf8_lossy(scheme).to_ascii_lowercase();
        PROTOCOL_HANDLERS.with(|h| {
            h.borrow_mut().remove(&key);
        });
    }

    pub(crate) fn is_handled(scheme: &[u8]) -> bool {
        let key = String::from_utf8_lossy(scheme).to_ascii_lowercase();
        PROTOCOL_HANDLERS.with(|h| h.borrow().contains_key(&key))
    }

    pub(crate) fn set_dispatcher<'a>(cx: &mut JsScope<'a>, func: JsLocal<'a, Callable>) {
        let strong = Strong::create(func.to_js(), cx.global());
        SCHEME_DISPATCHER.with(|d| {
            *d.borrow_mut() = Some(strong);
        });
    }

    pub(crate) fn send_response<'a>(
        _cx: &mut JsScope<'a>,
        window_id: u32,
        task_id: u32,
        response_val: JsLocal<'a>,
        range_header: &[u8],
        headers_json: &[u8],
    ) -> bool {
        let response_js = response_val.to_js();
        let Some(resp) = response::Response::from_js(&response_js) else {
            return false;
        };
        let mut status = resp.status_code();
        if status == 0 {
            status = 200;
        }
        let BodyValue::Blob(blob) = resp.body.get().value.get() else {
            return false;
        };
        let Some(store) = blob.store() else {
            return false;
        };
        let base_offset = blob.offset.get() as u64;
        let blob_size = blob.size.get();
        let range_str = core::str::from_utf8(range_header).unwrap_or("");

        match store::Store::data_mut(store) {
            store::Data::File(file) => {
                let PathOrFileDescriptor::Path(path) = &file.pathlike else {
                    return false;
                };
                let path_slice = path.slice();
                let Ok(path_str) = core::str::from_utf8(path_slice) else {
                    return false;
                };
                let Ok(meta) = std::fs::metadata(path_str) else {
                    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                    unsafe {
                        Bun__Desktop__sendSchemeResponseError(window_id, task_id, 404);
                    }
                    return true;
                };
                let file_len = meta.len();
                let available = if blob_size == MAX_SIZE {
                    file_len.saturating_sub(base_offset)
                } else {
                    (blob_size as u64).min(file_len.saturating_sub(base_offset))
                };

                let (final_offset, final_len, extra_headers) =
                    if status == 200 && !range_str.is_empty() {
                        if let Some((start, end)) = parse_byte_range(range_str, available) {
                            status = 206;
                            let len = end - start + 1;
                            (
                                base_offset + start,
                                len,
                                vec![
                                    ("Accept-Ranges", "bytes".to_string()),
                                    ("Content-Length", len.to_string()),
                                    ("Content-Range", format!("bytes {start}-{end}/{available}")),
                                ],
                            )
                        } else {
                            (
                                base_offset,
                                available,
                                vec![
                                    ("Accept-Ranges", "bytes".to_string()),
                                    ("Content-Length", available.to_string()),
                                ],
                            )
                        }
                    } else {
                        (
                            base_offset,
                            available,
                            vec![
                                ("Accept-Ranges", "bytes".to_string()),
                                ("Content-Length", available.to_string()),
                            ],
                        )
                    };

                let merged = append_headers_json(headers_json, &extra_headers);
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                unsafe {
                    Bun__Desktop__sendSchemeResponseFile(
                        window_id,
                        task_id,
                        status,
                        merged.as_ptr(),
                        merged.len() as u32,
                        path_slice.as_ptr(),
                        path_slice.len() as u32,
                        final_offset,
                        final_len,
                    );
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
                let _ = (window_id, task_id, merged, final_offset, final_len);
                true
            }
            store::Data::Bytes(bytes) => {
                let raw = bytes.slice();
                let start_off = (base_offset as usize).min(raw.len());
                let avail = if blob_size == MAX_SIZE {
                    raw.len() - start_off
                } else {
                    (blob_size as usize).min(raw.len() - start_off)
                };
                let slice = &raw[start_off..start_off + avail];

                let (body_slice, extra_headers) = if status == 200 && !range_str.is_empty() {
                    if let Some((start, end)) = parse_byte_range(range_str, slice.len() as u64) {
                        status = 206;
                        let s = start as usize;
                        let e = end as usize;
                        let sub = &slice[s..=e];
                        (
                            sub,
                            vec![
                                ("Accept-Ranges", "bytes".to_string()),
                                ("Content-Length", sub.len().to_string()),
                                (
                                    "Content-Range",
                                    format!("bytes {start}-{end}/{}", slice.len()),
                                ),
                            ],
                        )
                    } else {
                        (
                            slice,
                            vec![
                                ("Accept-Ranges", "bytes".to_string()),
                                ("Content-Length", slice.len().to_string()),
                            ],
                        )
                    }
                } else {
                    (
                        slice,
                        vec![
                            ("Accept-Ranges", "bytes".to_string()),
                            ("Content-Length", slice.len().to_string()),
                        ],
                    )
                };

                let merged = append_headers_json(headers_json, &extra_headers);
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                unsafe {
                    Bun__Desktop__sendSchemeResponseBytes(
                        window_id,
                        task_id,
                        status,
                        merged.as_ptr(),
                        merged.len() as u32,
                        body_slice.as_ptr(),
                        body_slice.len() as u32,
                    );
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
                let _ = (window_id, task_id, merged, body_slice);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn send_response_bytes(
        window_id: u32,
        task_id: u32,
        status: u16,
        headers_json: &[u8],
        body: &[u8],
    ) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__sendSchemeResponseBytes(
                window_id,
                task_id,
                status,
                headers_json.as_ptr(),
                headers_json.len() as u32,
                body.as_ptr(),
                body.len() as u32,
            );
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = (window_id, task_id, status, headers_json, body);
    }

    pub(crate) fn send_response_error(window_id: u32, task_id: u32, status: u16) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__sendSchemeResponseError(window_id, task_id, status);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = (window_id, task_id, status);
    }
}
