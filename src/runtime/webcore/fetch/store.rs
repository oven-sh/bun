//! fetch() record/replay store.
//!
//! Not an RFC 9111 HTTP cache: this is a deterministic record/replay layer
//! keyed on `(method, url, sorted request headers, request body)`. A hit
//! short-circuits the network entirely and returns the recorded Response.
//!
//! Backends:
//! - `dir`: one JSON file per unique request under a directory. Non-UTF-8
//!   bodies are base64-encoded. Optimised for humans/agents to read, diff,
//!   and commit alongside tests.
//! - `memory`: process-global hash table with optional TTL and bounded entry
//!   count (FIFO eviction). Cheap and fast; survives only the process.
//! - SQLite: follow-up.

use std::io::Write as _;
use std::time::Instant;

use bun_collections::HashMap;
use bun_core::Mutex;
use bun_core::fmt::{JSONFormatterUTF8Options, format_json_string_utf8};
use bun_core::{String as BunString, strings};
use bun_http::{HTTPResponseMetadata, Headers};
use bun_http_types::ETag::HeaderEntryColumns;
use bun_http_types::Method::Method;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_options_types::context::FetchStoreConfig;
use bun_sys::{Fd, O};

use crate::webcore::body::{Body, Value as BodyValue};
use crate::webcore::jsc::JSPromise;
use crate::webcore::response::HeadersRef;
use crate::webcore::{FetchHeaders, InternalBlob, Response};

bun_core::declare_scope!(fetch_store, hidden);

/// Resolved per-request store handle. Cloned from either the `fetch()` options
/// object or (when that is absent) the process-global `--fetch-cache` /
/// `[fetch] cache` setting. Owned by `FetchTasklet` until the body is fully
/// received.
#[derive(Clone)]
pub enum FetchStore {
    Dir { path: Box<[u8]> },
    Memory { ttl_ms: u32, max: u32 },
}

/// What we need from the request to compute a key and serialise the JSON
/// `"request"` half. All fields are owned copies so the tasklet can outlive
/// the parse scope.
pub struct StoredRequest {
    pub key: u64,
    pub method: Method,
    pub url: Box<[u8]>,
    pub headers: Vec<(Box<[u8]>, Box<[u8]>)>,
    pub body: Option<Box<[u8]>>,
}

/// What a hit yields / what we persist.
pub struct StoredResponse {
    pub status: u16,
    pub status_text: Box<[u8]>,
    pub url: Box<[u8]>,
    pub redirected: bool,
    pub headers: Vec<(Box<[u8]>, Box<[u8]>)>,
    pub body: Vec<u8>,
}

// ─── memory backend ───────────────────────────────────────────────────────

struct MemoryEntry {
    inserted: Instant,
    response: StoredResponse,
}

// Process-global. fetch() is JS-thread-only so a std `Mutex` suffices; the
// lock is held only for the map lookup/insert, never across I/O.
static MEMORY_STORE: Mutex<Option<HashMap<u64, MemoryEntry>>> = Mutex::new(None);

impl StoredResponse {
    fn clone_for_hit(&self) -> StoredResponse {
        StoredResponse {
            status: self.status,
            status_text: self.status_text.clone(),
            url: self.url.clone(),
            redirected: self.redirected,
            headers: self.headers.clone(),
            body: self.body.clone(),
        }
    }
}

// ─── key derivation ───────────────────────────────────────────────────────

/// Inputs that select the transport or shape the response and so must feed
/// the cache key. Non-default values are emitted into the preimage so the
/// common case (no unix/proxy, follow redirects, decompress) keeps the same
/// key as earlier versions.
pub struct KeyInputs<'a> {
    pub method: Method,
    pub url: &'a [u8],
    pub unix_socket_path: &'a [u8],
    pub proxy_href: &'a [u8],
    pub redirect: bun_http::FetchRedirect,
    pub decompress: bool,
    pub max_redirects: Option<u8>,
}

/// Derive the store key and the owned request snapshot in one pass.
/// `body` is `None` for GET/HEAD or when the body is a stream (streams are
/// unhashable; a streamed request is never cached).
pub fn build_request(
    inputs: &KeyInputs<'_>,
    headers: &Headers,
    body: Option<&[u8]>,
) -> StoredRequest {
    let KeyInputs {
        method,
        url,
        unix_socket_path,
        proxy_href,
        redirect,
        decompress,
        max_redirects,
    } = *inputs;
    let entries = headers.entries.slice();
    let names = entries.items_name();
    let values = entries.items_value();
    let mut hv: Vec<(Box<[u8]>, Box<[u8]>)> = Vec::with_capacity(names.len());
    for i in 0..names.len() {
        let name = headers.as_str(names[i]);
        let value = headers.as_str(values[i]);
        let mut name_lc = name.to_vec().into_boxed_slice();
        name_lc.make_ascii_lowercase();
        hv.push((name_lc, value.to_vec().into_boxed_slice()));
    }
    // Canonical order so header iteration order doesn't perturb the key.
    hv.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut buf: Vec<u8> = Vec::with_capacity(url.len() + 32);
    buf.extend_from_slice(method.as_str().as_bytes());
    buf.push(b'\n');
    buf.extend_from_slice(url);
    buf.push(b'\n');
    if !unix_socket_path.is_empty() {
        // Leading NUL so this line cannot alias a header (names can't be NUL).
        buf.extend_from_slice(b"\0unix:");
        buf.extend_from_slice(unix_socket_path);
        buf.push(b'\n');
    }
    if !proxy_href.is_empty() {
        buf.extend_from_slice(b"\0proxy:");
        buf.extend_from_slice(proxy_href);
        buf.push(b'\n');
    }
    match redirect {
        bun_http::FetchRedirect::Follow => {}
        bun_http::FetchRedirect::Manual => buf.extend_from_slice(b"\0redirect:manual\n"),
        bun_http::FetchRedirect::Error => buf.extend_from_slice(b"\0redirect:error\n"),
    }
    if !decompress {
        buf.extend_from_slice(b"\0decompress:false\n");
    }
    if let Some(n) = max_redirects {
        let _ = writeln!(&mut buf, "\0maxRedirects:{n}");
    }
    for (n, v) in &hv {
        buf.extend_from_slice(n);
        buf.push(b':');
        buf.extend_from_slice(v);
        buf.push(b'\n');
    }
    // Self-delimit the header block from the body so a body that happens to
    // look like `name:value\n` cannot alias a header (header names can't be
    // empty, so `\n\n` only occurs here).
    buf.push(b'\n');
    if let Some(b) = body {
        buf.extend_from_slice(b);
    }
    let key = bun_wyhash::hash(&buf);

    StoredRequest {
        key,
        method,
        url: url.to_vec().into_boxed_slice(),
        headers: hv,
        body: body.map(|b| b.to_vec().into_boxed_slice()),
    }
}

// ─── config resolution ────────────────────────────────────────────────────

use bun_options_types::context::resolve_against_cwd;

impl FetchStore {
    pub fn from_config(cfg: &FetchStoreConfig) -> Option<Self> {
        match cfg {
            FetchStoreConfig::None => None,
            // `FetchStoreConfig::parse` has already absolutised the path.
            FetchStoreConfig::Dir { path } => Some(FetchStore::Dir { path: path.clone() }),
            FetchStoreConfig::Memory { ttl_ms, max } => Some(FetchStore::Memory {
                ttl_ms: *ttl_ms,
                max: *max,
            }),
        }
    }

    /// Read `{ type: "dir" | "memory", ... }` from a JS options value.
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        if value.is_undefined_or_null() {
            return Ok(None);
        }
        if !value.is_object() {
            return Err(
                global.throw_invalid_arguments(format_args!("fetch: 'store' must be an object"))
            );
        }
        let Some(ty) = value.get(global, "type")? else {
            return Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'store.type' must be \"dir\" or \"memory\""
            )));
        };
        if !ty.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'store.type' must be \"dir\" or \"memory\""
            )));
        }
        let ty = bun_core::OwnedString::new(ty.to_bun_string(global)?);
        if ty.eql_comptime(b"dir") {
            let Some(path) = value.get(global, "path")? else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "fetch: 'store.path' is required when store.type is \"dir\""
                )));
            };
            if !path.is_string() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "fetch: 'store.path' must be a string"
                )));
            }
            let path = path.to_slice_clone(global)?;
            if path.slice().is_empty() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "fetch: 'store.path' is required when store.type is \"dir\""
                )));
            }
            return Ok(Some(FetchStore::Dir {
                path: resolve_against_cwd(path.slice()),
            }));
        }
        if ty.eql_comptime(b"memory") {
            let clamp_u32 = |v: JSValue| -> u32 {
                let n = v.as_number();
                if n.is_finite() && n > 0.0 {
                    n.min(u32::MAX as f64) as u32
                } else {
                    0
                }
            };
            let max = match value.get(global, "max")? {
                Some(v) if v.is_number() => clamp_u32(v),
                _ => 0,
            };
            let ttl_ms = match value.get(global, "ttl")? {
                Some(v) if v.is_number() => clamp_u32(v),
                _ => 0,
            };
            return Ok(Some(FetchStore::Memory { ttl_ms, max }));
        }
        Err(global.throw_invalid_arguments(format_args!(
            "fetch: 'store.type' must be \"dir\" or \"memory\""
        )))
    }
}

// ─── lookup / persist ─────────────────────────────────────────────────────

impl FetchStore {
    pub fn lookup(&self, key: u64) -> Option<StoredResponse> {
        match self {
            FetchStore::Memory { ttl_ms, .. } => {
                let mut guard = MEMORY_STORE.lock();
                let map = guard.as_mut()?;
                let entry = map.get(&key)?;
                if *ttl_ms > 0 {
                    let age = entry.inserted.elapsed().as_millis();
                    if age > u128::from(*ttl_ms) {
                        map.remove(&key);
                        return None;
                    }
                }
                Some(entry.response.clone_for_hit())
            }
            FetchStore::Dir { path } => {
                let file_path = dir_entry_path(path, key);
                let bytes = match bun_sys::File::openat(Fd::cwd(), &file_path, O::RDONLY, 0)
                    .and_then(|f| f.read_to_end())
                {
                    Ok(b) => b,
                    Err(_) => return None,
                };
                match parse_stored_json(&bytes) {
                    Some(resp) => Some(resp),
                    None => {
                        bun_core::scoped_log!(
                            fetch_store,
                            "dir: malformed entry at {:?}",
                            bstr::BStr::new(&file_path)
                        );
                        None
                    }
                }
            }
        }
    }

    pub fn persist(&self, req: &StoredRequest, resp: StoredResponse) {
        match self {
            FetchStore::Memory { max, .. } => {
                let mut guard = MEMORY_STORE.lock();
                let map = guard.get_or_insert_with(HashMap::new);
                if *max > 0 && map.len() as u32 >= *max && !map.contains(&req.key) {
                    // FIFO-ish eviction: drop one arbitrary older entry. Memory
                    // store is a test/dev convenience, not a production LRU.
                    if let Some(victim) = map.keys().next().copied() {
                        map.remove(&victim);
                    }
                }
                map.insert(
                    req.key,
                    MemoryEntry {
                        inserted: Instant::now(),
                        response: resp,
                    },
                );
            }
            FetchStore::Dir { path } => {
                if let Err(err) = write_dir_entry(path, req, &resp) {
                    warn_write_failed_once(path, &err);
                }
            }
        }
    }
}

/// Surface a dir-write failure to stderr once per process; the fetch itself
/// has already succeeded, so we don't fail it, but the user opted into
/// recording and should learn it isn't happening.
fn warn_write_failed_once(path: &[u8], err: &bun_sys::Error) {
    static WARNED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
    if WARNED.swap(true, core::sync::atomic::Ordering::Relaxed) {
        return;
    }
    bun_core::warn!(
        "fetch: failed to record response to {}: {}",
        bstr::BStr::new(path),
        err
    );
}

// ─── dir backend: paths + JSON ────────────────────────────────────────────

fn dir_entry_path(dir: &[u8], key: u64) -> Vec<u8> {
    let mut out = Vec::with_capacity(dir.len() + 1 + 16 + 5);
    out.extend_from_slice(dir);
    if !dir.is_empty() && *dir.last().unwrap() != b'/' && *dir.last().unwrap() != b'\\' {
        out.push(if cfg!(windows) { b'\\' } else { b'/' });
    }
    let _ = write!(&mut out, "{key:016x}.json");
    out
}

fn body_is_text(bytes: &[u8]) -> bool {
    // Require valid UTF-8 and no embedded NULs; anything else round-trips
    // through base64 so the JSON stays hand-editable.
    !bytes.is_empty() && strings::index_of_char(bytes, 0).is_none() && strings::is_valid_utf8(bytes)
}

/// JSON-escape a network-sourced byte string. Header values and reason
/// phrases are RFC 7230 field-values (opaque octets, historically Latin-1),
/// so route non-UTF-8 through the Latin-1 encoder instead of handing invalid
/// bytes to the UTF-8 path's `from_utf8_unchecked`.
fn write_json_string(out: &mut Vec<u8>, bytes: &[u8]) {
    if strings::is_valid_utf8(bytes) {
        let _ = write!(
            out,
            "{}",
            format_json_string_utf8(bytes, JSONFormatterUTF8Options::default())
        );
    } else {
        let _ = write!(out, "{}", bun_core::fmt::format_json_string_latin1(bytes));
    }
}

fn write_json_body(out: &mut Vec<u8>, bytes: Option<&[u8]>) {
    match bytes {
        None | Some([]) => out.extend_from_slice(b"null"),
        Some(b) if body_is_text(b) => {
            let _ = write!(
                out,
                "{}",
                format_json_string_utf8(b, JSONFormatterUTF8Options::default())
            );
        }
        Some(b) => {
            out.extend_from_slice(br#"{"encoding":"base64","data":""#);
            let enc = bun_base64::encode_alloc(b);
            out.extend_from_slice(&enc);
            out.extend_from_slice(br#""}"#);
        }
    }
}

fn write_json_headers(out: &mut Vec<u8>, headers: &[(Box<[u8]>, Box<[u8]>)]) {
    // Array of [name, value] pairs (same shape as `new Headers([...])`) so
    // repeated names like Set-Cookie survive JSON.parse / jq / formatters.
    out.push(b'[');
    for (i, (name, value)) in headers.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.push(b'[');
        write_json_string(out, name);
        out.push(b',');
        write_json_string(out, value);
        out.push(b']');
    }
    out.push(b']');
}

fn write_dir_entry(dir: &[u8], req: &StoredRequest, resp: &StoredResponse) -> bun_sys::Result<()> {
    bun_sys::Dir::borrow(&Fd::cwd()).make_path(dir)?;
    let path = dir_entry_path(dir, req.key);

    let mut out: Vec<u8> = Vec::with_capacity(512 + resp.body.len());
    out.extend_from_slice(br#"{"request":{"method":""#);
    out.extend_from_slice(req.method.as_str().as_bytes());
    out.extend_from_slice(br#"","url":"#);
    write_json_string(&mut out, &req.url);
    out.extend_from_slice(br#","headers":"#);
    write_json_headers(&mut out, &req.headers);
    out.extend_from_slice(br#","body":"#);
    write_json_body(&mut out, req.body.as_deref());
    out.extend_from_slice(br#"},"response":{"status":"#);
    let _ = write!(&mut out, "{}", resp.status);
    out.extend_from_slice(br#","statusText":"#);
    write_json_string(&mut out, &resp.status_text);
    out.extend_from_slice(br#","url":"#);
    write_json_string(&mut out, &resp.url);
    out.extend_from_slice(br#","redirected":"#);
    out.extend_from_slice(if resp.redirected { b"true" } else { b"false" });
    out.extend_from_slice(br#","headers":"#);
    write_json_headers(&mut out, &resp.headers);
    out.extend_from_slice(br#","body":"#);
    write_json_body(&mut out, Some(&resp.body));
    out.extend_from_slice(br#"},"time":"#);
    let _ = write!(&mut out, "{}", bun_core::time::milli_timestamp());
    out.extend_from_slice(b"}\n");

    // Write to a per-writer temp sibling and rename over the target so
    // concurrent readers and crash-interrupted writes never see a partial
    // file. 0o600 because request headers/bodies can carry credentials.
    static TMP_SEQ: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);
    let seq = TMP_SEQ.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    let mut tmp_path = path.clone();
    let _ = write!(&mut tmp_path, ".{}.{seq}.tmp", std::process::id());
    tmp_path.push(0);
    let tmp_z = bun_core::ZStr::from_slice_with_nul(&tmp_path);
    let write = || -> bun_sys::Result<()> {
        let file = bun_sys::File::openat(
            Fd::cwd(),
            &tmp_path[..tmp_path.len() - 1],
            O::WRONLY | O::CREAT | O::TRUNC,
            0o600,
        )?;
        file.write_all(&out)?;
        drop(file);
        let mut path = path;
        path.push(0);
        bun_sys::renameat(
            Fd::cwd(),
            tmp_z,
            Fd::cwd(),
            bun_core::ZStr::from_slice_with_nul(&path),
        )
    };
    let result = write();
    if result.is_err() {
        let _ = bun_sys::unlink(tmp_z);
    }
    result
}

// ─── dir backend: read-back JSON parse ────────────────────────────────────

fn parse_stored_json(bytes: &[u8]) -> Option<StoredResponse> {
    let bump = bun_alloc::MimallocArena::new();
    let source = bun_ast::Source::init_path_string(b"fetch-store.json", bytes);
    let mut log = bun_ast::Log::init();
    let parsed = bun_parsers::json::parse_utf8(&source, &mut log, &bump).ok()?;
    let root = parsed;
    let response = root.get(b"response")?;

    let status = response.get(b"status")?.as_number()? as u16;
    let status_text = response
        .get(b"statusText")
        .and_then(|e| e.as_string(&bump))
        .unwrap_or(b"")
        .to_vec()
        .into_boxed_slice();
    let url = response
        .get(b"url")
        .and_then(|e| e.as_string(&bump))
        .unwrap_or(b"")
        .to_vec()
        .into_boxed_slice();
    let redirected = response
        .get(b"redirected")
        .and_then(|e| e.as_bool())
        .unwrap_or(false);

    let mut headers: Vec<(Box<[u8]>, Box<[u8]>)> = Vec::new();
    if let Some(h) = response.get(b"headers") {
        if let Some(mut arr) = h.as_array() {
            while let Some(pair) = arr.next() {
                let Some(mut it) = pair.as_array() else {
                    continue;
                };
                let k = it
                    .next()
                    .and_then(|e| e.as_string(&bump))
                    .unwrap_or(b"")
                    .to_vec()
                    .into_boxed_slice();
                let v = it
                    .next()
                    .and_then(|e| e.as_string(&bump))
                    .unwrap_or(b"")
                    .to_vec()
                    .into_boxed_slice();
                headers.push((k, v));
            }
        } else {
            h.for_each_property(|k, _loc, v| {
                headers.push((
                    k.to_vec().into_boxed_slice(),
                    v.as_string(&bump)
                        .unwrap_or(b"")
                        .to_vec()
                        .into_boxed_slice(),
                ));
            });
        }
    }

    let body: Vec<u8> = match response.get(b"body") {
        None => Vec::new(),
        Some(b) => {
            if let Some(s) = b.as_string(&bump) {
                s.to_vec()
            } else if let Some(data) = b.get(b"data").and_then(|d| d.as_string(&bump)) {
                bun_base64::decode_alloc(data).ok()?
            } else {
                Vec::new()
            }
        }
    };

    Some(StoredResponse {
        status,
        status_text,
        url,
        redirected,
        headers,
        body,
    })
}

// ─── build a JS Response from a cache hit ─────────────────────────────────

pub fn response_from_hit(global: &JSGlobalObject, hit: StoredResponse) -> JSValue {
    let headers = FetchHeaders::create_from_pico_headers(&build_pico_headers(&hit.headers));
    let status_text = if hit.status_text.is_empty() {
        crate::server::http_status_text::get(hit.status)
            .map(|t| BunString::static_(&t[4..]))
            .unwrap_or_else(BunString::empty)
    } else {
        BunString::clone_utf8(&hit.status_text)
    };
    let url = BunString::clone_utf8(&hit.url);

    let response = bun_core::heap::into_raw(Box::new(Response::init(
        crate::webcore::response::Init {
            // SAFETY: create_from_pico_headers returns a fresh refcount=1 FetchHeaders*.
            headers: Some(unsafe { HeadersRef::adopt(headers) }),
            status_code: hit.status,
            status_text: status_text.into(),
            ..Default::default()
        },
        Body::new(BodyValue::InternalBlob(InternalBlob {
            bytes: hit.body,
            was_string: false,
        })),
        url,
        hit.redirected,
    )));

    JSPromise::resolved_promise_value(global, Response::make_maybe_pooled(global, response))
}

/// `FetchHeaders::create_from_pico_headers` needs a slice of `picohttp::Header`,
/// which borrows its name/value; keep the owned `(name, value)` boxes alive in
/// the caller's `hit.headers` while this Vec borrows them.
fn build_pico_headers(headers: &[(Box<[u8]>, Box<[u8]>)]) -> Vec<bun_picohttp::Header> {
    headers
        .iter()
        .map(|(n, v)| bun_picohttp::Header::new(n, v))
        .collect()
}

/// Snapshot response metadata + body into an owned `StoredResponse`. Called on
/// the JS thread once the full body has been buffered.
pub fn capture_response(metadata: &HTTPResponseMetadata, body: &[u8]) -> StoredResponse {
    let http_response = &metadata.response;
    let mut headers: Vec<(Box<[u8]>, Box<[u8]>)> =
        Vec::with_capacity(http_response.headers.list.len());
    for h in http_response.headers.list {
        let mut name = h.name().to_vec().into_boxed_slice();
        name.make_ascii_lowercase();
        headers.push((name, h.value().to_vec().into_boxed_slice()));
    }
    StoredResponse {
        status: http_response.status_code as u16,
        status_text: http_response.status.to_vec().into_boxed_slice(),
        url: metadata.url.slice().to_vec().into_boxed_slice(),
        redirected: false,
        headers,
        body: body.to_vec(),
    }
}
