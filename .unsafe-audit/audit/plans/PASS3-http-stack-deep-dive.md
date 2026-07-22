# PASS-3 Deep Dive: HTTP Stack (`bun_http` + `bun_http_jsc`)

Targeted audit of every byte that crosses Bun's HTTP perimeter. 457 `unsafe`
sites across two crates: client-side `fetch`, HTTP/1.1 / HTTP/2 / HTTP/3
clients, WebSocket upgrade + framing, proxy CONNECT tunneling, header
encoding, chunked-transfer parsing, decompression, and SSL/TLS callbacks.

Inputs:
- `src/http/` (170 sites, 23 files)
- `src/http_jsc/` (287 sites, 8 files)
- `.unsafe-audit/unsafe-inventory.jsonl` lines for
  `crate ∈ {bun_http, bun_http_jsc}`
- Prior pass-2 hits on `src/http/AsyncHTTP.rs:117` and `src/http/lib.rs:176`
  (`PASS2-ptr-cast-deep-dive.md` §U2: dealloc-through-SharedReadOnly UB)

---

## 1. Executive Summary

| Metric | Value |
|---|---|
| Sites in scope (`bun_http`) | 170 |
| Sites in scope (`bun_http_jsc`) | 287 |
| Total | **457** |
| Files | 31 |
| Files sampled in depth (≥30 lines context) | 23 |
| Representative sites profiled | 84 |
| **Pre-existing UB candidates** | **1 new (H9 SB write-through-SharedReadOnly path-NUL) + 2 pass-2 carry-ins** |
| **Network-input crash/hardening vectors** | **5** (H1/H2 re-evaluated sound; H8 H3 body buffering, H10 c_int negative, H16 i2d_X509 negative, H17 WebSocket message size) |
| **Request-smuggling primitives** | **3** (H5 Content-Length truncation, H14 streaming-len → CL:0 path on Bytes path, H6 raw-bytes wire write w/o local CRLF gate) |
| **Response-splitting primitives** | **2** (H11 CONNECT host CRLF, H12 Authorization-from-URL) |
| **Decompression hardening items** | **1** (H3 WebSocket deflate bounded-output policy; original unbounded-4GB claim was overstrong) |
| **Async-cancel UAF risks** | 0 found in audited paths — discipline holds |
| **Connection-pool aliasing bugs** | 0 — keyed correctly |
| **HTTP/2 stream-id reuse UAF** | 0 — `saturating_add(2)`, clean disconnect path |
| **Cookie parsing UB** | n/a — cookie path lives in `bun_runtime`, not here |
| **SSL config aliasing** | 0 new — pass-2 verified |
| **`Body::resolve`/`reject` race** | 0 — `ThreadSafeStreamBuffer` mutex-locked, deinit via intrusive refcount |
| **CRLF-validation gaps in WebSocket** | 0 in standard path (FetchHeaders gate); 1 CONNECT-host gap (H11) |
| Hardened-SAFETY templates produced | 6 |
| Recommended follow-up PRs | 7 |

**The high-value finding from this pass is H9** — a write through `cast_mut()`
of a borrowed-slice-derived pointer inside `picohttp::Request::parse` runs on
every inbound HTTP/1.1 response (and every WebSocket upgrade response). This
is the **same UB pattern** that pass-2 flagged at `AsyncHTTP.rs:117` / `lib.rs:176`,
now found in the byte-1 hot path. Tree Borrows tolerates it (the byte after
`path` is owned by the same buffer); Stacked Borrows rejects it (the parent
borrow `buf: &'a [u8]` is `SharedReadOnly`). Recommended fix: route the write
through a `*mut [u8]` derived from the owning `Vec` provenance, or `unsafe { ... }`
a single byte of the response buffer via the same `slice_mut(base.add(off), len)`
pattern used at `lib.rs:4141`.

The second-tier risks are integer-truncation primitives across `as u32` casts
in `HeaderBuilder` (H15) and the 11-byte `request_content_len_buf` (H5), both
of which are inherited from the Zig source and previously documented as
"latent bugs same as Zig". Both are practical only with > 4GB / > 100GB body
sizes — exploitable on a 64-bit host with `Bun.fetch(url, { body: hugeView })`
but not directly remotely exploitable.

The WebSocket compression path (H3) is still worth hardening, but the original
Pass 3 text overclaimed it. `libdeflate_decompressor.decompress_to_vec(...)`
in Bun's wrapper writes into the caller's existing spare capacity; if it cannot
fit the frame it returns an insufficient-space status and the zlib fallback
does chunked growth with size checks. Keep H3 as a bounded memory-amplification
and cap-policy item, not as a proven "tiny frame allocates 4 GiB before the
128 MiB check" bug.

---

## 2. Module Map

### 2.1 `src/http/` (`bun_http`, 170 sites, 23 files)

Density by file (descending):

| File | Sites | Role |
|---|---|---|
| `lib.rs` | 42 | HTTPClient state machine; response parse; redirect; chunked decode; Content-Length build; cert chain |
| `HTTPContext.rs` | 20 | Socket-context per (host,port,SSL); pooled-socket lookup; tagged pointer dispatch |
| `HTTPThread.rs` | 16 | HTTP-thread main loop; CONNECT-thread; SSL-context cache; queued tasks |
| `AsyncHTTP.rs` | 16 | Thread-safe carrier between JS thread and HTTP thread; preconnect |
| `ProxyTunnel.rs` | 13 | Inner-TLS-over-CONNECT; pooled tunnels; refcount handoff |
| `h3_client/PendingConnect.rs` | 10 | Async DNS for QUIC; cross-thread resolved-handler dispatch |
| `lshpack.rs` | 7 | HTTP/2 HPACK FFI wrapper |
| `h2_client/ClientSession.rs` | 7 | HTTP/2 connection; stream lifecycle; ref guards |
| `h3_client/ClientSession.rs` | 6 | HTTP/3 session; QUIC stream binding |
| `Decompressor.rs` | 6 | gzip/deflate/brotli/zstd lifetime-erasure for streaming readers |
| `ssl_config.rs` | 4 | TLS option struct; Send+Sync impl; C-string fields |
| `ThreadSafeStreamBuffer.rs` | 4 | Locked stream buffer shared between JS thread and HTTP thread |
| `h3_client/ClientContext.rs` | 3 | QUIC client context shared across sessions |
| `h2_client/encode.rs` | 3 | HEADERS/CONTINUATION serialisation; DATA framing |
| `SendFile.rs` | 3 | Zero-copy file-to-socket; `sendfile(2)` per OS |
| `h3_client/callbacks.rs` | 2 | lsquic event dispatch |
| `h2_client/dispatch.rs` | 2 | Inbound HTTP/2 frame parser |
| `zlib.rs` | 1 | Pooled mutable-string release-helper for compressed bodies |
| `h3_client/encode.rs` | 1 | HTTP/3 request encode; QPACK header build |
| `h3_client/AltSvc.rs` | 1 | Alt-Svc header parser for upgrade hint |
| `HeaderBuilder.rs` | 1 | Pre-sized header-pair allocator |
| `HTTPCertError.rs` | 1 | Cert-error code/reason `&'static ZStr` widen from uSockets |
| `H2Client.rs` | 1 | re-export module |

### 2.2 `src/http_jsc/` (`bun_http_jsc`, 287 sites, 8 files)

| File | Sites | Role |
|---|---|---|
| `websocket_client/WebSocketUpgradeClient.rs` | 153 | HTTP-Upgrade-to-WS state machine; CONNECT request build; deflate negotiation |
| `websocket_client.rs` | 63 | Connected WS framing (parse/serialize), ping/pong/close, initial-data microtask |
| `websocket_client/WebSocketProxyTunnel.rs` | 41 | Tunneled wss:// over HTTP proxy CONNECT |
| `websocket_client/WebSocketDeflate.rs` | 10 | RFC 7692 permessage-deflate; libdeflate + zlib hybrid |
| `headers_jsc.rs` | 9 | `FetchHeaders` ↔ `bun_http::Headers` bridge; `copy_to` + `set_len` columns |
| `websocket_client/CppWebSocket.rs` | 7 | C++ `Bun__WebSocket__did*` extern shims |
| `fetch_enums_jsc.rs` | 3 | tiny `to_js` thunks for FetchRedirect/Cache/Mode |
| `websocket_client/WebSocketProxy.rs` | 1 | proxy ALPN sniff |

### 2.3 Category fingerprint

`bun_http` (170 sites):

| Category | Count |
|---|---|
| `other` (mixed call patterns) | 69 |
| `ptr_cast` (`.cast::<>()`/`as`) | 35 |
| `zig_port_mut_ref` (`&mut *RacyCell::get()`) | 20 |
| `ptr_intrinsic` (`from_mut`/`from_ref`/`addr_of_mut`) | 16 |
| `fd_syscall` | 14 |
| `ptr_arith` (`.add(off)`) | 6 |
| `boringssl_ffi` | 6 |
| `raw_ptr_lifecycle` (`Box::from_raw`/`heap::destroy`/`heap::take`) | 5 |
| `allocator` (custom alloc API) | 5 |
| `send_impl`/`sync_impl`/`other_unsafe_impl` | 6 |
| `bun_heap_lifecycle` (`heap::into_raw`/`heap::take`) | 4 |
| `c_alloc` (`mi_malloc`/`mi_free`) | 3 |
| `uws_ffi` | 2 |
| `slice_from_raw` | 2 |
| `raw_method_call` | 2 |
| `unchecked_index` | 1 |
| `maybe_uninit` | 1 |
| `bun_ffi_helper` | 1 |
| `atomic` | 1 |

`bun_http_jsc` (287 sites):

| Category | Count |
|---|---|
| `other` | 71 |
| `ptr_cast` | 65 |
| `zig_port_self_call` (`unsafe { Self::method(this, ..) }`) | 55 |
| `fd_syscall` | 31 |
| `raw_method_call` (`unsafe { (*p).method() }`) | 30 |
| `zig_port_mut_ref` | 24 |
| `zlib_ffi` (`zlib::deflate`/`inflate`/`*Reset`/`*End`) | 17 |
| `c_alloc` | 11 |
| `boringssl_ffi` | 10 |
| `ptr_intrinsic` | 8 |
| `allocator` | 7 |
| `raw_ptr_lifecycle` | 4 |
| `bun_ffi_helper` | 4 |
| `zig_port_shared_ref` | 2 |
| `slice_from_raw` | 2 |
| `ptr_arith` | 2 |
| `bun_heap_lifecycle` | 2 |
| `mimalloc_ffi` | 1 |
| `libc_ffi` | 1 |
| `jsc_object_handle` | 1 |
| `atomic` | 1 |

The `bun_http_jsc` density is dominated by the `*mut Self` callback shape in
`WebSocketUpgradeClient::*` — `Self::terminate(this, ErrorCode::*)`,
`Self::deref(this)`, `Self::handle_*(this, ..)`. This shape is correct and
load-bearing because `terminate`/`fail` paths can drop the last ref and free
`*this` synchronously; materializing a `&self`-derived raw pointer (which
would carry `SharedReadOnly` provenance) before such a call is UB on dealloc.

---

## 3. Attack-Surface Analysis

### 3.1 Inbound HTTP/1.1 (server-side `fetch` is client-side; serve.rs is server)

The fetch client receives an attacker-controlled response. The first parse is
`picohttp::Response::parse_parts`. Then `handle_response_metadata`
(`lib.rs:4207`) iterates headers and consumes Content-Length / Transfer-Encoding
/ Location / Content-Encoding etc. Chunked-encoding decoding is split between
`handle_response_body_chunked_encoding_from_multiple_packets`
(`lib.rs:4040`) and `..._from_single_packet` (`lib.rs:4119`).

Hot unsafe sites on this path:

- `lib.rs:4063` — `picohttp::phr_decode_chunked` on `body_buf.list` tail. The
  pre-`unsafe` block carefully derives the start pointer from the owning
  `Vec`'s `as_mut_ptr()` (not the borrowed `incoming_data`), so the write
  provenance is exclusive. SAFETY argument holds: `body_buf` is the response
  message buffer and not aliased elsewhere on this stack frame. Note the
  `saturating_sub(incoming_data.len())` is a defensive guard — if `body_buf`
  were not as long as `incoming_data` (impossible per the just-appended slice)
  it would devolve to offset 0. **Sound**.

- `lib.rs:4141` — `bun_core::ffi::slice_mut(base.add(off), in_len)` where `base
  = response_message_buffer.list.as_mut_ptr()`. The comment explicitly calls
  out that the `incoming_data.as_ptr() as *mut u8` shortcut would carry
  SharedReadOnly provenance and writing through it is UB; the derivation goes
  through the owning Vec instead. **Sound** under both SB and TB. **This is
  the canonical hardening template that should be applied elsewhere** —
  notably the H9 finding below.

- `lib.rs:3087` — `picohttp::Response::parse_parts` returns a `Response<'a>`
  with `bytes_read: c_int`. Line 3113 casts via `usize::try_from(...).expect("int cast")`
  — panics on a negative value. picohttpparser's contract is non-negative on
  success, so practically OK, but a future libpicohttp change could regress.
  **Hardening recommended** (H10).

- The chunked decoder accepts `picohttp::phr_decode_chunked`'s in-place
  mutation. The decoder state lives in `self.state.chunked_decoder` (a plain
  `phr_chunked_decoder` struct, no allocation, no callbacks); there is no
  way for a hostile peer to inject a callback or corrupt non-buffer memory.
  Out-of-bounds writes would have to come from inside libpicohttp.

#### 3.1.1 Request-smuggling primitives

H5 — `request_content_len_buf: [u8; 11]` (lib.rs:631; used 2214) can only
format up to `4294967295` digits. For `body_len ∈ [10^11, usize::MAX-1]`, the
buf overflows and `buf_print` returns `Err`, then the wire emits
`Content-Length: 0`. The actual body bytes are still written.

Adversarial input shape:

```js
// Requires a 100GB buffer — only practical on big-memory hosts.
const body = new Uint8Array(100_000_000_000);
await fetch("http://upstream.example", { method: "POST", body });
// Sends "Content-Length: 0\r\n\r\n<100GB of bytes>". Upstream parses
// the 100GB as a smuggled second request.
```

This is **directly inherited from the Zig source** and the comment at
lib.rs:2210-2212 acknowledges it as "same latent bug as Zig". Practical
exploitability is gated on the user being able to allocate a 100GB-plus
`Uint8Array` (host RAM permitting). Recommend widening the buffer to
`[u8; b"18446744073709551615".len()] = [u8; 20]` and erroring instead of
silently falling back to "0".

#### 3.1.2 Response-splitting primitives

None found in the standard fetch outbound path: `header_str` returns bytes
from `header_buf`, which is populated by `from_fetch_headers` (headers_jsc.rs)
from `FetchHeaders::create` in C++. WebCore's `FetchHeaders` validates names
via `isValidHTTPToken` and values via `isValidHTTPHeaderValue`, both of which
reject CRLF, NUL, and the standard set of control bytes per RFC 9110 §5.5.

#### 3.1.3 Chunk-parsing surface

`phr_decode_chunked` is a C state machine. It mutates `decoder.consume_trailer`,
`decoder.bytes_left_in_chunk`, etc. The Rust side feeds it pointers into a
Vec the caller already owns (`response_message_buffer.list` or `body_buf.list`).
The wrapper at lib.rs:4063 has correct provenance (write through `as_mut_ptr`
of the owning Vec). **The actual C implementation lives in `vendor/picohttpparser`
and is not in scope for this audit**, but the Rust side does not expose any
new UB primitive that libpicohttp would not already have.

The single-packet fast path at lib.rs:4131-4145 has a subtle invariant: if
`response_message_buffer.owns(incoming_data)`, the chunk decoder writes back
into the same buffer (in-place decoding for non-trailer-extension chunks).
The pointer math `incoming_data.as_ptr() as usize - base as usize` *assumes*
`incoming_data` is a subslice of `base..base+capacity`, which `owns()` checked.
**Sound** under both borrow models because the write provenance comes from
`base = response_message_buffer.list.as_mut_ptr()` (Unique).

### 3.2 Inbound HTTP/2 (client receiving HEADERS / DATA / RST_STREAM frames)

`h2_client/dispatch.rs::parse_frames` is the inbound entry point. Every
frame's length is validated against `DEFAULT_MAX_FRAME_SIZE` (16 384, never
negotiated higher per the local SETTINGS at encode.rs:32) before dispatch.
Frame-internal length parsing is bounded.

Header decoding via lshpack (`lshpack.rs:79`/`91`) gets a per-header
`(name, value)` whose pointers point into a **thread-local shared buffer
inside the C wrapper**. The `DecodeResult` carries these as `&'static [u8]`
slices — a deliberate lifetime erasure, with the contract that callers must
copy before the next decode call. The Rust callers in `dispatch.rs:632/634`
do `extend_from_slice` into `stream.decoded_bytes` immediately, so the
contract holds. **Sound, contract-load-bearing**.

`LOCAL_MAX_HEADER_LIST_SIZE` (256 KB, `H2Client.rs:24`) caps `decoded_bytes`
growth (dispatch.rs:624-629); HPACK indexed amplification cannot expand
beyond this. **Sound**.

Stream IDs:
- `next_stream_id` starts at 1, increments by `saturating_add(2)`
  (ClientSession.rs:400), clamps at `wire::MAX_STREAM_ID = (1<<31)-1`.
- `streams: ArrayHashMap<u32, Stream*>` is keyed on stream-id; lookups
  return `Option<&mut Stream>`. RST_STREAM with an unknown id is dropped.
- Streams are removed from the map before `drop_stream` runs (ClientSession.rs:179
  INVARIANT documented). No reuse, no UAF found.

#### 3.2.1 HEADERS/CONTINUATION reassembly

`stream.header_block: Vec<u8>` is bounded by `LOCAL_MAX_HEADER_LIST_SIZE`
(dispatch.rs:385-397) before append. **Sound**.

#### 3.2.2 DATA frame body buffering

Each DATA frame ≤ 16 KB after the size-cap check. The body bytes are
delivered to `client.handle_response_body` which goes through the same
chunked-or-content-length state machine as HTTP/1.1. **Sound**.

### 3.3 Inbound HTTP/3 (lsquic callbacks)

`h3_client/callbacks.rs` registers six callbacks. Frame-level bounds are
enforced inside lsquic (out of scope), but the Rust side has one issue:

H8 — `on_stream_data` (callbacks.rs:247) appends to `stream.body_buffer`
without a per-stream size cap. lsquic delivers up to one MAX_DATAGRAM_SIZE
per frame, but a hostile server can interleave thousands of frames before the
JS side has a chance to drain `body_buffer`. The buffer is drained on
`deliver` (`ClientSession.rs:332`), which fires on every `on_stream_data`,
so the worst case is one frame's worth in flight — practically bounded by
lsquic's per-stream flow control window. **DoS risk: low**.

### 3.4 Outbound `fetch` request build (response-splitting / header injection)

`build_request` (lib.rs:2046) iterates `header_entries`, classifies each
header, and writes user header bytes verbatim into the per-thread
`SHARED_REQUEST_HEADERS_BUF`. The header bytes were already filtered by
WebCore's `FetchHeaders::create` when the JS `Headers` object was constructed
(`isValidHTTPToken` name, `isValidHTTPHeaderValue` value). **No injection
vector** for the standard JS fetch entry point.

However, see H11 below — the **WebSocket CONNECT** request bypasses the JS
FetchHeaders gate for the *target* host string: `target_host` comes from the
URL's `host()`, which the URL parser already filtered for CRLF — so practically
safe — but the path is one validator-failure away from injection.

### 3.5 WebSocket frame parsing (`websocket_client.rs::handle_data_loop`)

Header parse `parse_websocket_header` returns the next state and `is_final`,
`receive_body_remain`, `need_compression`. The two-byte payload length parse
falls back to 16-/64-bit extended length (NeedExtendedPayloadLength16/64).
The 64-bit length is read as `u64::from_be_bytes(self.payload_length_frame_bytes)
as usize`. On 32-bit hosts this truncates; on 64-bit it is exact. Then
`receive_body_remain` is used unbounded in NeedBody state.

This unsubound message length is read as `usize`. The receive buffer is a
`LinearFifo<u8, DynamicBuffer<u8>>`; `consume()` will grow it as needed up to
host RAM. **No per-message-size cap visible** — same concern as H8 but for
WebSocket: a hostile server can send a 2^63-byte message length header and
the client will attempt to receive that much. Mitigated only by the OS-level
TCP RX buffer + the application's `Bun__WebSocketClient__incomingMessage`
delivery, which I have not audited here. **Filed as H17 below**.

Control frames (Ping/Pong/Close) are correctly bounded at 125 bytes
(line 851, 901, 967). **Sound**.

### 3.6 WebSocket compression

H3 — `WebSocketDeflate::decompress` (line 225) first calls
`libdeflate_decompressor.decompress_to_vec(in_buf, out, Deflate)`. Source
review shows Bun's wrapper does **not** grow `out` unbounded in that path: it
writes into the existing spare capacity and returns a failure status when the
frame does not fit. The subsequent zlib fallback grows in bounded chunks and
checks `MAX_DECOMPRESSED_SIZE` after each chunk. Therefore this is **not** a
proved unbounded decompression-bomb primitive.

Adversarial input shape (RFC 7692 permessage-deflate):

```
Client connects with `permessage-deflate; client_max_window_bits=15`.
Server replies with the same negotiation.
Server sends large compressed WebSocket frames that repeatedly force fallback
decompression and output growth near the negotiated cap.
```

Recommended fix: make the cap policy explicit and shared across the libdeflate
and zlib paths. Keep the zlib fallback's chunked checks, and add a regression
test that exercises a frame which exceeds `MAX_DECOMPRESSED_SIZE` without
requiring host OOM. Do not describe this as a 4 GiB allocation primitive unless
a new reproduction shows the wrapper actually grows before returning.

### 3.7 Redirect handling (Location header)

The redirect parser at lib.rs:4380+ is robust:
- Length capped at `MAX_REDIRECT_URL_LENGTH = 128 KB` (line 271, 4422, 4485).
- Protocol whitelist (http/https only); other schemes → `UnsupportedRedirectProtocol`.
- Redirect URL is normalised through WebKit's `bun_url::href_from_string`.
- `redirect_type == FetchRedirect::Follow` plus `remaining_redirect_count`
  ratchets down with each hop (default 127).
- The 303 / non-stream-body interaction is correctly gated (line 4393-4400).
- Old `connected_url` borrow is parked in `prev_redirect` for the next
  `doRedirect` to free, avoiding mid-flight free-while-borrowed.

**Sound**.

### 3.8 Cookie parsing

Out of scope for this crate. The `Bun.Cookie` API lives in
`bun_runtime/api/bun/cookie.rs`; the HTTP side merely treats `Cookie` /
`Set-Cookie` as opaque header values. The `Set-Cookie` value passes through
the same WebCore validation as any other header. **No HTTP-side bug**.

### 3.9 SSL config aliasing

Pass-2 audited `SSLConfig` and confirmed the `Send + Sync` impls hold
(ssl_config.rs:444-445 — all internal pointers are heap-owned C strings, no
interior mutability past `init`). The HTTP-side composition (HTTPContext
caches `SSLConfig` rcs keyed by hash; ClientSession compares by raw pointer)
is consistent with that audit. **No new issue**.

### 3.10 `Body::resolve`/`reject` cross-thread

The relevant path is `ThreadSafeStreamBuffer` (used by Stream-body request
upload and by streaming response body delivery). Every access is bracketed
by `self.mutex.lock()`/`unlock()` or the RAII `lock()` guard
(ThreadSafeStreamBuffer.rs:101). The intrusive refcount starts at 2 (one ref
per thread; ThreadSafeStreamBuffer.rs:44) and is released via `deref()`
when each side is done. **Sound**.

### 3.11 Compression input validation (gzip/deflate/brotli/zstd response body)

`Decompressor::update_buffers` re-seats the input/output borrows on every
chunk via the `seat()` helper (Decompressor.rs:40), which centralises the
lifetime-erasure to `'static` so it can be stored in the boxed reader.
The `seat()` SAFETY contract is documented: callers must pass exactly the
buffer pair that the surrounding `HTTPClient` request lifecycle owns and
will drop the `Decompressor` before. Every site in the file complies.

Decompression-bomb protection for *response* bodies is enforced at the
`bun_zlib`/`bun_brotli`/`bun_zstd` reader layer, not here — the HTTP side
hands the readers a `&mut Vec<u8>` and a streaming input, and the readers
write into the Vec until input is exhausted. The Vec's capacity grows
unbounded if the response body lacks Content-Length and the response is
streamed; the protections live in the upper-layer reader (`read_all` is
called with `is_done: bool`). **Out of scope here** but worth a cross-link:
the body-size cap should ideally live in `InternalState::process_body_buffer`,
not in each reader.

---

## 4. Per-Site Deep Dives (84 sites profiled)

### 4.1 `picohttp::Request::parse` at `src/picohttp/lib.rs:383`

Code (lib.rs lines 379-385):

```rust
// Leave a sentinel value, for JavaScriptCore support.
if rc > -1 {
    // SAFETY: path_ptr points into buf; the byte after the path is the
    // space before "HTTP/1.x" which picohttpparser has already consumed,
    // so writing a NUL there is in-bounds. Zig casts away const here too.
    unsafe { path_ptr.cast_mut().add(path_len).write(0) };
}
```

#### H9 (pre-existing-UB candidate) — write-through-SharedReadOnly

**Provenance**: `path_ptr` is set by `phr_parse_request` to a pointer **into
`buf`**, which the Rust signature declares as `&'a [u8]` (shared borrow).
`cast_mut()` produces a `*mut u8` that inherits the borrow's
**SharedReadOnly** tag under Stacked Borrows. Writing through it is UB under
SB — the write attempts to re-tag to Unique but cannot because the parent is
read-only.

Tree Borrows is more permissive: a child write through a shared parent is
allowed if no other read through the same shared parent happens between the
write and the borrow's death. Since `parse_request` is fenced (no other read
of `buf` happens before the function returns and the caller `to_read.slice()`
re-borrows), TB tolerates this write.

This pattern is structurally identical to pass-2's U2 findings at
`AsyncHTTP.rs:117` (`heap::destroy(from_ref(href).cast_mut())`) and
`lib.rs:176` (`heap::destroy(from_ref(list).cast_mut())`).

**Bounds**: `phr_parse_request` only returns `rc > -1` (i.e. success) after
consuming the full HTTP request line, which ends with `\r\n`. The byte at
`path_ptr.add(path_len)` is therefore the space (`0x20`) between the path
and `HTTP/1.x`. Writing `0` over this byte is in-bounds of `buf`. **No
spatial UB**, only the provenance UB.

**Reachability**: this is the **first parse** for every inbound HTTP/1.1
request on Bun.serve, and the first parse for every Bun.fetch response.
Hot, hot path.

**Recommended fix**: route the write through a mutable handle to the owning
buffer. Two options:

1. Change `parse`'s signature to take `&mut [u8]` instead of `&[u8]`. Forces
   callers to hand in the response buffer's `as_mut_slice()`. Mechanical;
   doesn't break any current caller because the response message buffer is
   already `&mut`-owned at the call site (`InternalState::response_message_buffer.list`).

2. Compute `path_len_off = path_ptr.offset_from(buf.as_ptr())` and then have
   the caller perform the NUL-write via `buf[off + path_len] = 0` from the
   `&mut Vec<u8>` provenance. Move the write out of `parse` entirely (it's a
   JSC-internal convenience, not a parse correctness requirement).

Filing as `bd issue` per pass methodology: `pre-existing-ub` candidate, SB
write-through-SharedReadOnly.

### 4.2 `lib.rs:117` — `heap::destroy(from_ref(href).cast_mut())`

**Already filed by pass-2** in `PASS2-ptr-cast-deep-dive.md` §U2. Carried
forward. Same fix as H9 — derive the destroy pointer from the `Box<[u8]>`
the caller previously held, not from `&'static [u8]`. Concretely: thread an
`Option<Box<[u8]>>` instead of `is_url_owned: bool` + `href: &'static [u8]`.

### 4.3 `lib.rs:176` — `heap::destroy(from_ref(list).cast_mut())`

**Already filed by pass-2**. Same UB shape; `list` is `&'static [Header]`
that was `Box::leak`'d in `clone_metadata` (lib.rs:3405-3407). The fix is
to keep ownership in `Box<[Header]>` instead of leaking, and only widen to
`&'static [Header]` for the borrow that the `picohttp::Response<'static>`
self-references.

### 4.4 `lshpack.rs:91` — `from_raw_parts(header.name, header.name_len)`

```rust
let (name, value) = unsafe {
    (
        core::slice::from_raw_parts(header.name, header.name_len),
        core::slice::from_raw_parts(header.value, header.value_len),
    )
};
```

**Sound**: lshpack's wrapper writes name/value pointers into a thread-local
shared buffer registered via `lsxpack_header_prepare_decode`; both pointers
are non-null after a successful decode. The buffer lifetime is "until the
next decode/encode call on this HPACK". The Rust wrapper returns a
`DecodeResult` containing these as `&'static [u8]` — a deliberate lifetime
erasure documented at the type level. Callers `extend_from_slice` immediately
(dispatch.rs:632-634).

**No issue**, but the `&'static` widening is technically a lie; the slice is
only valid for one call. The TODO at line 34 acknowledges this. **Recommend**
parameterising `DecodeResult` over a `'a: 'self.hpack` lifetime in Phase B.

### 4.5 `websocket_client.rs:1790, 1905` — `heap::take(from_raw_parts_mut(...))`

```rust
let buffered_slice: Box<[u8]> = unsafe {
    bun_core::heap::take(core::slice::from_raw_parts_mut(
        buffered_data,
        buffered_data_len,
    ))
};
```

**Sound under the documented contract**: the call comes from the upgrade
client at WebSocketUpgradeClient.rs:1522-1534 which allocated `v: Vec<u8>` via
`try_reserve_exact` and then handed the raw pointer over with
`heap::into_raw(v.into_boxed_slice())`. Both ends use the global mimalloc
allocator, so reclaiming via `heap::take` matches.

**Concern**: there is no explicit pairing check at the FFI boundary. If a
future C++-side caller (e.g. JSWebSocket from a third-party native binding)
hands in a buffer allocated by a different allocator, this UAF/double-free
silently. **Recommend**: document the allocator contract on the extern
`init`/`init_with_tunnel` declarations and consider a debug-build
"isAllocatedByMimalloc" check.

### 4.6 `headers_jsc.rs:61, 64` — `set_len` then `copy_to`

```rust
unsafe { headers.entries.set_len(header_count as usize) };
headers.buf.reserve_exact(buf_len as usize);
unsafe { headers.buf.set_len(buf_len as usize) };
// ...
if let Some(h) = h_ptr {
    unsafe { (*h).copy_to(names_ptr, values_ptr, headers.buf.as_mut_ptr()) };
}
```

**Borderline-sound**:
- `entries.set_len` exposes `header_count` slots that **are** initialised by
  `copy_to` (which writes through `names_ptr` and `values_ptr`).
- `buf.set_len(buf_len)` exposes `buf_len` bytes that **are** initialised by
  `copy_to`'s third argument (the byte buffer for header names+values).
- Between the `set_len` and the `copy_to`, a panic — e.g. from
  `bun_alloc::out_of_memory` if `reserve_exact` failed (it can't fail
  silently because the previous `ensure_total_capacity` already would have
  hit OOM, but borrowck can't see this) — would expose uninit memory to
  Drop / debug printing.

**No live UB** because the surrounding allocations are POD (`StringPointer`
slots have no Drop, `u8` is trivially-init). But the pattern is **fragile**:
adding any fallible call between `set_len` and `copy_to` introduces
init-UB.

**Recommend**: reorder to `copy_to` first into a freshly-allocated buffer,
then call `set_len`. Or use `Vec::spare_capacity_mut` + `MaybeUninit<T>::write`
+ `assume_init`. Filed as H4.

### 4.7 `WebSocketDeflate.rs:232` — `libdeflate decompress_to_vec` (H3 detail)

```rust
let result = unsafe { &mut *self.rare_data.decompressor() }.decompress_to_vec(
    in_buf,
    out,
    libdeflate_sys::Encoding::Deflate,
);
if result.status == libdeflate_sys::Status::Success {
    if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
        return Err(DecompressError::TooLarge);
    }
    return Ok(());
}
```

**Corrected finding**: the first Pass 3 draft treated Bun's
`decompress_to_vec` wrapper as an unbounded grow-until-success API. That is
not what the local wrapper does: it attempts decompression into existing spare
capacity and falls back to a zlib loop that checks the cap as it grows. H3 is
a useful hardening/test item around consistent cap enforcement, not a
confirmed OOM-before-check bug.

**Adversarial input**:

```
permessage-deflate frame:
  Compressed payload: large enough to exceed the 128 MiB cap when inflated.
  Expected behavior: deterministic TooLarge error without excessive allocation.
```

**Recommended fix**: add an explicit regression for the cap boundary and keep
both decompression engines behind the same running-total check. A
caller-supplied fixed-size output buffer would make the proof simpler, but the
existing fallback path is not the catastrophic unbounded allocation described
in the first draft.

### 4.8 `lib.rs:2218` — `Content-Length` 11-byte buffer (H5 detail)

```rust
let value: &[u8] = match bun_core::fmt::buf_print(
    &mut self.request_content_len_buf,  // [u8; 11]
    format_args!("{body_len}"),         // body_len: usize
) {
    Ok(s) => unsafe { bun_ptr::detach_lifetime(s) },
    Err(_) => b"0",  // ← request-smuggling primitive
};
```

`request_content_len_buf` is `[u8; "-4294967295".len()] = [u8; 11]`. For
`body_len ≥ 10^11`, `buf_print` returns `Err` and the wire emits
`Content-Length: 0`. The body bytes are still sent.

**Mitigations**: `body_len = original_request_body.len()`; for the `Bytes(&[u8])`
arm this is the slice length (capped by host RAM). For `Stream` it returns
`usize::MAX` but the streaming path uses chunked encoding instead (gated at
lib.rs:2190). For `Sendfile` it returns `content_size`. So the bug fires
only for non-streaming Bytes bodies > 99GB.

**Exploit feasibility**: requires a host with > 100GB RAM and a fetch with
a 100GB+ body. Not remotely-exploitable in a typical deployment; locally
exploitable on big-memory hosts. **Filed**, fix is trivial: widen to
`[u8; 20]` (covers u64::MAX = 18446744073709551615, 20 digits).

### 4.9 `HeaderBuilder.rs:33, 40, 65, 89` — `as u32` truncation (H15)

`length: name.len() as u32` — for `name.len() > 2^32` (4 GB), the cast
silently truncates. The resulting `StringPointer` returns a wrong-length
view into the buf.

Practical only with a > 4GB header value. The fetch JS API caps the *encoded*
header buffer at 1 MB-ish (per WebKit's `FetchHeaders::create` upper bound),
so this is not directly user-reachable. **Filed for hardening**; mechanical
fix is `u32::try_from(...).unwrap_or_else(|_| out_of_memory())`.

### 4.10 `h3_client/encode.rs:76` — `headers.set_len(4)` over uninit (H13)

```rust
let mut headers: Vec<quic::Header> = Vec::with_capacity(request.headers.len() + 4);
// ...
unsafe { headers.set_len(4) };
for h in request.headers {
    // ... headers.push(quic::Header::init(...));  // appends at index 4+
}
// ...
headers[0] = quic::Header::init(b":method", request.method, Some(Qpack::MethodGet));
headers[1] = quic::Header::init(b":scheme", b"https", Some(Qpack::SchemeHttps));
headers[2] = quic::Header::init(b":authority", authority, Some(Qpack::Authority));
headers[3] = quic::Header::init(b":path", ..., Some(Qpack::Path));
```

The `set_len(4)` exposes slots 0..4 as initialised before they actually are.
Slots 0..4 are overwritten before `send_headers(&headers, ...)` reads them,
but if **any** of the loop iterations panics (e.g.
`strings::copy_lowercase` on a hostile header name), the Vec is dropped
with `len = 4 + i` and slots 0..4 are still uninit.

Saving grace: `quic::Header` has no `Drop` (per the comment line 75). So
"dropping uninit slots" is a no-op; no double-free or UAF. **Init-UB only
in the sense that reading slots 0..4 between `set_len` and the explicit
writes is UB**, and the panic path could read them via a panic hook that
prints the Vec.

**Recommend**: write slots 0..4 *before* the loop, and `push` (not `set_len`)
for the loop body. Mechanical refactor; ~5 lines.

### 4.11 `WebSocketUpgradeClient.rs:2042-2045` — wire write of extra headers

```rust
write!(
    &mut extra_headers_buf,
    "{}: {}\r\n",
    bstr::BStr::new(name_slice),
    bstr::BStr::new(value)
)
.unwrap();
```

The names and values come from the user-provided `headers: Headers` parameter
to `new WebSocket(url, { headers })`. WebCore's `FetchHeaders::create`
(WebSocket.cpp:612) validates these via `isValidHTTPToken`/`isValidHTTPHeaderValue`,
which **reject CRLF**. Therefore **no response-splitting through user
headers**.

**Sound**, but the safety relies on a cross-language invariant (WebCore C++
validates → bun_http_jsc trusts). Recommend a `debug_assert!` on the Rust
side that the bytes contain no CRLF (cheap; SIMD `index_of` for `b'\r'`/`b'\n'`).

### 4.12 `WebSocketUpgradeClient.rs:1854, 1864` — CONNECT request build (H11 detail)

```rust
write!(
    &mut buf,
    "CONNECT {}:{} HTTP/1.1\r\n",
    bstr::BStr::new(target_host),
    target_port
).unwrap();
```

`target_host` is the BunString `host: &BunString` passed to `connect()`. C++
side derives it from `m_url.host()` (WebSocket.cpp:646). WebKit's URL parser
rejects CRLF in the host (and we re-normalise through
`bun_url::href_from_string` per `target_authorization`). So **practically safe**
for the URL path.

However: the function takes `target_host: &[u8]` from
`host_slice.slice()` — no Rust-side validation. If the BunString
`host` parameter were ever populated from a source that bypasses URL
parsing (e.g. a future "low-level connect" API), CRLF injection would be
direct.

**Recommend** a `debug_assert!(!strings::contains(target_host, b"\r\n"))`
at function entry, similar to H11 (writes a guard once at the API boundary).

### 4.13 `lib.rs:535` — `cast_fn_ptr` over `*mut T → *mut ()` first arg

```rust
function: unsafe {
    bun_ptr::cast_fn_ptr::<
        fn(*mut T, *mut AsyncHTTP<'static>, HTTPClientResult<'_>),
        HTTPClientResultCallbackFunction,
    >(callback)
}
```

**Sound** under both SB and TB. The fn-pointer cast is ABI-identical (`*mut T`
and `*mut ()` have the same size/alignment/calling convention), and the
callback receiver reinterprets the erased pointer back to `*mut T` before
deref. Same shape as `bun_threading::Task` callbacks throughout the codebase.

### 4.14 `lib.rs:898/893/888/883` — `&mut *RacyCell::get()` of static buffers

These are the per-HTTP-thread scratch buffers (`SHARED_REQUEST_HEADERS_BUF`,
`SHARED_RESPONSE_HEADERS_BUF`, `SINGLE_PACKET_SMALL_BUFFER`, `TEMP_HOSTNAME`).
The `RacyCell` wrapper documents single-thread access; the HTTP thread is
the sole accessor. **Sound** under the documented invariant. Each `&mut`
borrow is per-statement and audited (per the SAFETY comments).

### 4.15 `HTTPThread.rs:987` — `(*HTTP_THREAD.get_unchecked()).as_mut_ptr()`

```rust
let this = unsafe {
    bun_ptr::ParentRef::<Self>::from_raw((*crate::HTTP_THREAD.get_unchecked()).as_mut_ptr())
};
```

Process-lifetime singleton. `HTTP_THREAD` is a `OnceLock<MaybeUninit<HttpThread>>`;
`get_unchecked` is sound after `init()` ran (preconnect path explicitly calls
`http_thread::init` at lib.rs:432). `ParentRef` is a process-lifetime safe wrapper
around the raw pointer. **Sound**.

### 4.16 `lib.rs:1481` — `i2d_X509` size cast (H16)

```rust
let cert_size = unsafe { boringssl::c::i2d_X509(x509, core::ptr::null_mut()) };
let mut cert = vec![0u8; usize::try_from(cert_size).expect("int cast")].into_boxed_slice();
```

`i2d_X509` returns `c_int`; on error returns ≤ 0 (BoringSSL convention).
`usize::try_from(-1)` panics. Practically the call only fails on OOM (which
would have caused us to be dead anyway) or invalid X509 (cannot happen — we
just received a verified chain from BoringSSL). **Filed for hardening**;
fix is `if cert_size <= 0 { return false; }`.

### 4.17 `lib.rs:1717` — ALPN inspection during handshake

```rust
let alpn = unsafe {
    let mut data: *const c_uchar = core::ptr::null();
    let mut len: c_uint = 0;
    boringssl::c::SSL_get0_alpn_selected(ssl_ptr, &raw mut data, &raw mut len);
    bun_core::ffi::slice(data, len as usize)
};
```

**Sound**: BoringSSL writes either `(null, 0)` or a pointer into the SSL
session's negotiated-protocol storage (valid for SSL session lifetime).
`ffi::slice` handles the null case (returns `b""`).

### 4.18 `h3_client/PendingConnect.rs:117` — cross-thread on_dns_resolved

```rust
pub unsafe fn on_dns_resolved_threadsafe(this: *mut PendingConnect) {
    // ... swaps the resolved pointer into a queue ...
    unsafe { (*loop_ptr).wakeup() };
}
```

The cross-thread DNS callback path. `this` is enqueued from any DNS-resolver
thread (c-ares fires from a worker); the HTTP thread drains the queue in
`on_dns_resolved`. The `Resolved` type is `unsafe impl Send` at line 179.
**Sound** given the queue is MPSC and the wakeup is atomic.

### 4.19 `ProxyTunnel.rs:841` — `RefPtr::from_raw(from_mut(&mut *self))`

```rust
client.proxy_tunnel = Some(unsafe { RefPtr::from_raw(core::ptr::from_mut(&mut *self)) });
```

Transfers a strong ref from the pool's parked entry to the new client. The
comment correctly identifies this as `take_ref` not `add_ref` — the parked
entry's ref is moved, not duplicated. **Sound** under the documented "pool
parked one ref" invariant.

### 4.20 `Decompressor.rs:40` — `seat()` lifetime erasure helper

```rust
unsafe fn seat<'a>(input: &'a [u8], out: &'a mut Vec<u8>) -> (&'static [u8], &'static mut Vec<u8>) {
    unsafe {
        (
            bun_ptr::Interned::assume(input).as_bytes(),
            bun_ptr::detach_lifetime_mut(out),
        )
    }
}
```

**Sound under the module-level invariant** (`Decompressor` is owned by the
surrounding `HTTPClient` request and dropped before the buffer pair is
freed; `InternalState::deinit` enforces this ordering). The
`Interned::assume` annotation routes through the audited helper. Single
centralised unsafe, every call site complies. **Good pattern, no issue**.

### 4.21 Survey of remaining unaudited sites

A further 60 sites were briefly examined and classified:

- **24 `(*p).method()` calls** in WebSocketUpgradeClient where the function
  signature is `fn xxx(this: *mut Self, ...)` and the body must not form a
  `&mut Self` because the call may free `*this`. All audited examples
  correctly use raw-pointer access until the body proves ownership. The
  `Self::terminate(this, ...)` pattern is the load-bearing variant. **Sound**.

- **17 `zlib_ffi` calls** in WebSocketDeflate: all wrap `zlib::deflate*`,
  `zlib::inflate*`, `zlib::*Reset`, `zlib::*End`. The `z_stream` is `#[repr(C)]`
  zeroed at construction; `deflateInit2_`/`inflateInit2_` are the only
  fallible inits; `*End` is a no-op-on-zeroed-stream per zlib spec. **Sound**.

- **10 `boringssl_ffi` calls**: all are after a `!ssl_ptr.is_null()` /
  `cert_chain.is_null()` check. **Sound**.

- **11 `c_alloc` calls**: paired alloc/free via `mi_malloc`/`mi_free`. **Sound**.

- **8 `ptr_intrinsic`**: `addr_of!`/`addr_of_mut!`/`from_ref`/`from_mut`
  uses — provenance-correct projection. **Sound**.

- **7 `allocator`**: custom alloc callbacks for lshpack. **Sound**.

---

## 5. Bug Findings (Filed for `pre-existing-ub` + Hardening Tickets)

### H1 — `pre-existing-ub` candidate ✗ (re-evaluation: sound after re-read)

The `Ping`/`Pong` ping_frame_bytes slicing arithmetic at websocket_client.rs:866-868:
on re-reading the bounds (ping_len ≤ 125, ping_frame_bytes is 128+6 = 134
bytes, `[6..]` exposes 128 bytes, `total_received ≤ ping_len ≤ 125`), no
overflow. Downgraded to **no-issue**.

### H2 — `pre-existing-ub` candidate ✗

Close-frame parser arithmetic — confirmed bounded after dataflow re-analysis.
Downgraded to **no-issue**.

### H3 — **WebSocket deflate cap-policy hardening** (corrected)

File: `src/http_jsc/websocket_client/WebSocketDeflate.rs:232-242`.

```rust
let result = unsafe { &mut *self.rare_data.decompressor() }.decompress_to_vec(
    in_buf, out, libdeflate_sys::Encoding::Deflate,
);
if result.status == libdeflate_sys::Status::Success {
    if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
        return Err(DecompressError::TooLarge);
    }
    return Ok(());
}
```

**Severity**: medium as a hardening/test gap, not a confirmed unbounded OOM.
The local wrapper does not grow `out` before returning an insufficient-space
status, and the fallback path checks the cap while growing. Keep this filed so
both engines share an explicit cap proof and regression test.

**Fix**: add a regression that forces the `TooLarge` path without excessive
allocation, and consider replacing the first-stage helper with a
caller-supplied bounded output buffer to make the proof obvious.

### H4 — **init-UB risk in `headers_jsc.rs`** (filed for hardening)

File: `src/http_jsc/headers_jsc.rs:61-78`.

```rust
unsafe { headers.entries.set_len(header_count as usize) };
headers.buf.reserve_exact(buf_len as usize);
unsafe { headers.buf.set_len(buf_len as usize) };
// ...
unsafe { (*h).copy_to(names_ptr, values_ptr, headers.buf.as_mut_ptr()) };
```

**Severity**: low — no live UB; fragile pattern. A future panic between
`set_len` and `copy_to` would expose uninit.

**Fix**: use `MaybeUninit<T>::write` + `assume_init` (or call `copy_to`
before the second `set_len`).

### H5 — **request-smuggling primitive: Content-Length truncation** (filed)

File: `src/http/lib.rs:631, 2210-2219`.

```rust
pub request_content_len_buf: [u8; b"-4294967295".len()],   // = 11
// ...
match bun_core::fmt::buf_print(&mut self.request_content_len_buf,
                                format_args!("{body_len}")) {
    Ok(s) => unsafe { bun_ptr::detach_lifetime(s) },
    Err(_) => b"0",
}
```

**Severity**: medium — requires 100GB-plus body; not remotely exploitable
in typical deployments but is request-smuggling-capable on big-memory hosts.

**Fix**: widen to `[u8; 20]` (u64::MAX is 20 digits). Or `unreachable_unchecked`
on `Err` — `body_len > 10^20` is impossible on any current host.

### H6 — verified sound (no Rust-side CRLF in standard fetch outbound) ✗

Downgraded after confirming WebCore `FetchHeaders::create` validates user
headers. **No-issue** on the JS fetch path.

### H7 — `StringPointer::slice` u32 overflow

File: `src/bun_core/util.rs:3417` (technically out of HTTP scope but heavily
used by HTTP):

```rust
&buf[self.offset as usize..(self.offset + self.length) as usize]
```

**Severity**: low — `u32 + u32` overflow wraps in release, panics in debug.
A wrapped result devolves to a `start > end` slice panic. No UB, just a
remote crash.

**Fix**: `self.offset.checked_add(self.length).expect("StringPointer overflow")`.

### H8 — H3 body buffer per-stream unbounded growth

File: `src/http/h3_client/callbacks.rs:247-253`.

**Severity**: low — bounded by lsquic's per-stream flow-control window
(typically 256 KB - 1 MB). DoS only if `deliver` is starved (e.g. JS thread
stuck), in which case the buffer grows until lsquic backs off.

**Fix**: optional — apply `LOCAL_MAX_HEADER_LIST_SIZE`-equivalent cap and
RST_STREAM on excess.

### H9 — **`pre-existing-ub` candidate: write-through-SharedReadOnly in `picohttp::Request::parse`** (filed)

File: `src/picohttp/lib.rs:383`.

```rust
unsafe { path_ptr.cast_mut().add(path_len).write(0) };
```

`path_ptr` is `*const u8` derived from `buf: &'a [u8]`. `cast_mut()` inherits
SharedReadOnly; writing through is UB under Stacked Borrows. **Hot path —
fires on every HTTP/1.1 request parsed on Bun.serve and every fetch response.**

**Adversarial input**: not adversarial. The bug fires on every well-formed
HTTP request.

**Fix**: change `parse(buf: &[u8], src: &mut [Header])` to take
`buf: &mut [u8]`, or perform the NUL-write from the owning Vec at the
caller site (lib.rs:3087, etc.).

### H10 — `bytes_read: c_int` round-trip in Response

File: `src/picohttp/lib.rs:538`, `src/http/lib.rs:3113`.

```rust
pub bytes_read: c_int,
// ...
let bytes_read = (usize::try_from(response.bytes_read).expect("int cast")).min(to_read.len());
```

**Severity**: low — picohttpparser contract makes this unreachable. Panic
on a negative value would be a remote crash if the contract ever regresses.

**Fix**: store as `usize` and clamp at parse time.

### H11 — **CRLF injection vector in CONNECT host (defense-in-depth)** (filed)

File: `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:1854, 1864`.

```rust
write!(&mut buf, "CONNECT {}:{} HTTP/1.1\r\n", bstr::BStr::new(target_host), target_port).unwrap();
```

**Severity**: low — `target_host` flows from WebKit's URL parser which
rejects CRLF. **Practically safe**, but the Rust side has no local guard;
a future change to the upstream parser or a low-level API could expose the
vector.

**Fix**: `debug_assert!(!strings::contains(target_host, b"\r\n"))` at
`build_connect_request` entry. ~3 lines.

### H12 — **Authorization-header CRLF (defense-in-depth)** (filed)

File: `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:2017-2019`.

```rust
write!(&mut extra_headers_buf, "Authorization: {}\r\n", bstr::BStr::new(auth)).expect(...);
```

`auth` is the C++-side base64-encoded `Basic` credential. Base64 alphabet
excludes CRLF, so **practically safe**. Same defense-in-depth concern as H11.

**Fix**: `debug_assert!(!strings::contains(auth, b"\r\n"))`.

### H13 — `Vec::set_len(4)` over uninit in h3 encode (filed)

File: `src/http/h3_client/encode.rs:76`.

**Severity**: low — `quic::Header` has no `Drop`; init-UB only on a panic
between the `set_len` and the four explicit writes.

**Fix**: write the four pseudo-headers first (`push`), then the user
headers (`push`), then `send_headers(&headers, end_stream)`.

### H14 — `HTTPRequestBody::Stream::len() = usize::MAX` interaction

File: `src/http/HTTPRequestBody.rs:83`, `src/http/lib.rs:2046`.

Confirmed gated by `self.flags.is_streaming_request_body` at lib.rs:2190 —
streaming requests use chunked encoding, not Content-Length. **No live bug**.
The `usize::MAX` sentinel is correctly handled. **No-issue** but documented
here for future-developers.

### H15 — `HeaderBuilder` u32 truncation (filed for hardening)

File: `src/http/HeaderBuilder.rs:33, 40, 65, 89`.

**Severity**: low — practical only with > 4GB header values; WebCore's
FetchHeaders caps the encoded buffer below this.

**Fix**: `u32::try_from(name.len()).unwrap_or_else(|_| out_of_memory())`.
Mechanical, ~4 sites.

### H16 — `i2d_X509` negative-size panic

File: `src/http/lib.rs:1481`.

**Severity**: low — practically unreachable; defensive `if cert_size <= 0
{ return false; }` is the fix.

### H17 — WebSocket message length unbounded (filed for hardening)

File: `src/http_jsc/websocket_client.rs:828-835`.

64-bit extended payload length is read as `usize`. No per-message cap
enforced on this side. The downstream `consume()` grows `receive_buffer`
to fit. Mitigation: OS TCP RX window + application-level delivery
back-pressure.

**Fix**: enforce a configurable max message size (default 1 GB? 100 MB?) at
the `ReceiveState::ExtendedPayloadLength64` transition.

---

## 6. Hardened SAFETY-Comment Templates

These are the patterns the audit confirmed are sound under both SB and TB.
Each template names the **invariant**, **provenance source**, **borrow
model proof**, and **failure mode if violated**.

### Template T1 — `*mut Self` callback whose body may free `*this`

```rust
/// # Safety
/// `this` points to a live `Self` allocated via `bun_core::heap::into_raw`.
/// The body MUST NOT materialise a `&Self` or `&mut Self` before calling
/// any path that may drop the last refcount on `*this`. The pattern is:
///
///   1. Bump the intrusive refcount via `ScopedRef::new(this)` (Drops to deref).
///   2. Use `(*this).field` raw access only.
///   3. Forward to other methods as `Self::method(this, ...)`.
///   4. Form a `&mut *this` only inside a final terminal frame where no
///      further reentrant call follows.
///
/// Failure mode: SB/TB UB on dealloc through a `&Self`/`&mut Self`-derived
/// raw pointer (provenance is SharedReadOnly/Unique, the dealloc requires
/// the original Box provenance).
pub unsafe fn name_of_callback(this: *mut Self, /* args */) {
    let _guard = unsafe { ScopedRef::new(this) };
    // ... raw access only ...
}
```

Used canonically in:
- `WebSocketUpgradeClient::handle_data`, `::handle_end`, `::handle_writable`
- `WebSocketProxyTunnel::on_*` callbacks
- `WebSocket::finalize`, `::handle_tunnel_*`

### Template T2 — In-place mutation of a `&[u8]` from C parser

When a C parser (`phr_decode_chunked`, `phr_parse_request`) writes back into
a slice you only hold by shared borrow, derive the write pointer from the
**owning** `Vec`'s `as_mut_ptr()`, not the borrowed slice's `as_ptr().cast_mut()`.

```rust
// WRONG (SB UB):
let p = incoming.as_ptr() as *mut u8;   // SharedReadOnly provenance
unsafe { phr_decode_chunked(decoder, p.add(off), &mut len); }

// CORRECT:
let base = owning_vec.as_mut_ptr();
let off = incoming.as_ptr() as usize - base as usize;
let p = unsafe { base.add(off) };       // Unique provenance
unsafe { phr_decode_chunked(decoder, p, &mut len); }
```

Used canonically at `lib.rs:4141`. Should be applied to `picohttp::Request::parse`
to fix H9.

### Template T3 — FFI thread-local-buffer pointer round-trip

When a C library writes into a thread-local buffer and returns pointers
*into* that buffer, the Rust wrapper must document the buffer's lifetime
explicitly. Use `bun_ptr::Interned::assume` to name the holder.

```rust
/// Returns name/value as `&'static [u8]` borrowed into the lshpack
/// thread-local shared buffer. The borrow is valid only until the next
/// call on `*self`. Callers MUST copy before the next decode/encode.
pub struct DecodeResult {
    pub name: &'static [u8],
    pub value: &'static [u8],
    // ...
}
```

Used canonically at `lshpack.rs:32-41`.

### Template T4 — `set_len` over partially-initialised Vec

Avoid the `set_len` first / write later pattern. Either:

```rust
// Use MaybeUninit
let mut headers: Vec<MaybeUninit<Header>> = Vec::with_capacity(n);
unsafe { headers.set_len(n); }
for i in 0..n {
    headers[i].write(Header::new(...));
}
let headers: Vec<Header> = unsafe { core::mem::transmute(headers) };
```

Or push:

```rust
let mut headers: Vec<Header> = Vec::with_capacity(n);
for h in source {
    headers.push(Header::new(...));
}
```

H4 and H13 should be reshaped to use one of these.

### Template T5 — Cross-allocator boundary FFI

When receiving a raw `(ptr, len)` from C++ that you intend to reclaim as
`Box<[u8]>`, **document the allocator contract on the extern declaration**:

```rust
// SAFETY: callers MUST allocate via `mi_malloc` (the Rust global allocator
// is also mimalloc, so `heap::take` adopts the same allocation). Callers
// MUST transfer ownership; the Rust side reclaims via `heap::take` and
// `Box`'s `Drop` will `mi_free` it.
#[no_mangle]
pub unsafe extern "C" fn Bun__WebSocketClient__init(
    buffered_data: *mut u8,
    buffered_data_len: usize,
    /* ... */
) -> *mut c_void {
    // ... heap::take(slice::from_raw_parts_mut(buffered_data, buffered_data_len))
}
```

Used canonically at `websocket_client.rs:1789, 1904`. The current comments
reference the contract; consider hoisting to a Rustdoc on the extern.

### Template T6 — Local-scope CRLF guard at outbound-write boundaries

Even when upstream parsers filter CRLF, add a local `debug_assert!` at the
*last* point before bytes hit the wire:

```rust
fn build_connect_request(target_host: &[u8], target_port: u16, /* ... */) -> Vec<u8> {
    debug_assert!(!strings::contains(target_host, b"\r\n"),
                  "CRLF in target_host bypasses URL validation");
    debug_assert!(!strings::contains(target_host, b"\0"),
                  "NUL in target_host");
    // ... write!(..., "CONNECT {}:{} HTTP/1.1\r\n", target_host, target_port) ...
}
```

Defense-in-depth for H11/H12. Free in release builds.

---

## 7. Recommended Follow-up PRs

1. **PR-H9** — `pre-existing-ub` fix for `picohttp::Request::parse` write-through-SharedReadOnly.
   Change signature to `parse(buf: &mut [u8], ...)` or move the NUL-write to the
   caller (`InternalState::handle_response`). Touches `src/picohttp/lib.rs` and
   every caller (≤ 5 sites). **Highest priority** — hot path.

2. **PR-H3** — WebSocket permessage-deflate cap-policy test/hardening.
   Add a regression around `src/http_jsc/websocket_client/WebSocketDeflate.rs`
   that exceeds `MAX_DECOMPRESSED_SIZE` deterministically without large host
   allocation, and optionally move the first-stage libdeflate path to an
   explicit caller-supplied bounded output buffer. **Medium priority**.

3. **PR-H5** — Widen `request_content_len_buf` to 20 bytes and remove the
   silent "0" fallback. `src/http/lib.rs:631`. Single-line struct change +
   the buf_print call site. **Medium priority** — practical exploit gated
   on 100GB body.

4. **PR-H4 / PR-H13** — Replace `set_len`-then-write with `MaybeUninit`/`push`
   in `headers_jsc.rs:61-78` and `h3_client/encode.rs:76`. **Low priority** —
   no live UB, fragility hardening.

5. **PR-H11 / PR-H12 / Template-T6** — Add `debug_assert!` CRLF guards at
   the four outbound-write boundaries: `build_connect_request`,
   `Authorization` line, custom-header loop, and the proxy-header loop.
   ~12 lines total. **Low priority** — defense-in-depth.

6. **PR-H15** — Replace `as u32` truncation casts in `HeaderBuilder` with
   `u32::try_from(...).unwrap_or_else(|_| out_of_memory())`. ~4 sites.
   **Low priority**.

7. **PR-H10 / PR-H16 / PR-H8** — Misc defensive `<=0` checks for c_int
   return values from picohttp / boringssl / lsquic. ~5 sites. **Low
   priority** — practically unreachable, contract-hardening.

---

## 8. Closing Notes

The HTTP stack is **the most carefully audited subsystem in the codebase**.
Pass-1 sampled it; pass-2 caught the two `heap::destroy(from_ref(...).cast_mut())`
patterns in this exact crate. Pass-3 extended the search: every site where
a borrow-derived raw pointer is fed to a write was inspected. The H9 finding
is the same pattern in `picohttp::Request::parse` and is the only **new
pre-existing-UB candidate** this pass found — every other site reviewed was
sound under the documented contract.

H3 remains a useful WebSocket permessage-deflate hardening target, but the
first draft's decompression-bomb framing was too strong. The libdeflate path
does not allocate 4 GiB before checking; the local wrapper writes into spare
capacity and the fallback path checks as it grows. Keep H3 as cap-policy
testing and proof hardening, not as the most impactful network-DoS finding.

The integer-truncation primitives (H5, H7, H15) are all inherited from the
Zig source and previously documented as latent. They are gated on body sizes
that approach or exceed host RAM, so are not directly remote-exploitable in
typical deployments. They should still be fixed because they trade a remote
crash for a silent protocol violation — the wrong tradeoff for an HTTP
client.

Stream-id reuse, async cancellation, connection-pool aliasing, and the
`Body::resolve`/`reject` race were all examined and found sound. The
`ThreadSafeStreamBuffer` mutex + intrusive refcount combination is the
canonical correct pattern for cross-thread data ownership and is
consistently applied.

**Total filed bugs/hardening items**: 7 actionable (H3, H4, H5, H9, H11+H12,
H13, H15); 3 informational (H8, H10, H16, H17); 2 carry-ins from pass-2
(`AsyncHTTP.rs:117`, `lib.rs:176`). **Net pre-existing-UB candidates added by
this pass: 1 (H9)** in the picohttp path-NUL write; the rest are
crash-on-malicious-input hardening (H5, H17), cap-policy hardening (H3), and
fragility cleanup.

`pre-existing-ub` ticket count: **1 new** (H9) + **2 carry-in** (AsyncHTTP.rs:117,
lib.rs:176) = **3**.
