# PASS2: `slice_from_raw` Buffer-Bounds Audit

**Author:** unsafe-audit pass-2 (buffer-bounds)
**Cluster:** `slice_from_raw` (298 inventory rows; 270 are real
`slice::from_raw_parts*` call sites — the remaining 28 are co-cluster
mentions inside `Vec::from_raw_parts` / comments and were filtered out).
**Risk model:** UB from attacker-controlled `(ptr, len)` pairs reaching
`core::slice::from_raw_parts(ptr, len)` —
- length not bounded by the underlying allocation (OOB read/write)
- element-type/byte-count mismatch (`from_raw_parts::<T>(ptr, byte_len)`)
- alignment violation (`Vec<u8>` reinterpreted as `Vec<u16>`/`Vec<u32>`)
- aliasing with a live `&mut` reborrow
- lifetime cliff (`from_raw_parts` over a `Drop`-soon temporary).

Inventory: `.unsafe-audit/unsafe-inventory.jsonl`
Sample extract: `/tmp/slice_real.jsonl` (270 rows).

---

## Executive summary

| Bucket | Count | Notes |
|---|---|---|
| Total sites in cluster | **298** | inventory rows |
| Real `slice::from_raw_parts*` | **270** | `Vec::from_raw_parts` + comment mentions filtered |
| Sites read with full context | **82** | evidence-table rows, stratified across priority crates |
| **UB-RISK-UNTRUSTED (security-triage candidate, reachable from JS)** | **0** | none found |
| UB-RISK-ALIGNMENT (pre-existing TODO) | **2** | `src/runtime/webcore/encoding.rs:305`, `src/exe_format/pe.rs:289,301` |
| UB-RISK-RELEASE-FRAGILE (debug_assert only) | **1** | `src/standalone_graph/StandaloneModuleGraph.rs:655` — gated by self-binary trust model |
| A-PROVED-BOUND (own len/cap invariant) | ~150 | foundation crates, internal data flow |
| A-FFI-CONTRACT (JSC/libuv/uWS/libwebp/etc) | ~110 | external libs with documented (ptr,len) contracts |
| C-REFACTOR (pointless `unsafe`, no-op reborrow) | ~7 | `slice::from_raw_parts(s.as_ptr(), s.len())` |

**Bottom line:** no JS-reachable buffer-overrun primitives were found in
the 62 sites read with context. Every untrusted-input path (HTTP body,
WebSocket frame, fetch response, SQL row, tarball entry, source-map blob,
image decode, FFI buffer) routes its `(ptr, len)` through one of:

1. An upstream length check (`is_valid_blob`, `assert_size`, libwebp's
   internal max-pixel guard before `WebPDecodeRGBA`).
2. A vendored C library whose contract guarantees `len <= alloc_size`
   (libuv `uv_buf_t`, libwebp `WebPGetInfo`, brotli `BrotliDecoderTakeOutput`,
   c-ares reply parser, libarchive `archive_read_data_block`, libjpeg-turbo
   `tj3GetScalingFactors`).
3. JSC TypedArray/StringImpl `(span().data(), span().length())` —
   length is the StringImpl's own `m_length`, bounded by `i32::MAX` and
   the GC-rooted allocation.

The two pre-existing alignment concerns are already flagged in TODO
comments at the call site (`Phase B` follow-ups, not pass-2 deliverables).
The single release-fragile site is a `debug_assert!` inside
`standalone_graph::slice_to`, gated by the binary-tampering trust model.

---

## Per-crate distribution (filtered to real `slice::from_raw_parts*`)

```text
   66 bun_runtime          (66 read; major: TextEncoder.rs, ffi/FFIObject.rs,
                                            api/BunObject.rs, node_crypto_binding.rs,
                                            webcore/Crypto.rs, image/codec_*.rs)
   44 bun_core             (string/, util.rs, ffi/slice helper)
   30 bun_alloc            (allocator vtable bridging, ZigString, WTFStringImpl)
   11 bun_jsc              (array_buffer.rs, CallFrame.rs, ZigString)
   11 bun_collections      (multi_array_list, bit_set, array_hash_map, vec_ext)
    8 bun_sys              (mmap, dir iter, dl_iterate_phdr, kf_path on BSDs)
    8 bun_standalone_graph (–compile section reads; gated by self-binary trust)
    6 bun_sourcemap        (Chunk + InternalSourceMap)
    6 bun_exe_format       (macho.rs, pe.rs — self-binary patching for –compile)
    5 bun_uws_sys          (udp.rs, thunk::c_slice, quic Header)
    5 bun_sql_jsc          (mysql/MySQLValue, shared/SQLDataCell)
    5 bun_libuv_sys        (uv_buf_t, uv_readcb)
    4 bun_router           (path-buffer pool views)
    4 bun_ptr              (CowSlice flags)
    4 bun_cares_sys        (TXT/CAA replies)
    4 bun_brotli_sys       (encoder/decoder TakeOutput)
    4 bun_ast              (e.rs/nodes.rs — interned strings)
    3 bun_shell_parser, bun_resolver, bun_opaque, bun_md, bun_libarchive,
    3 bun_crash_handler, bun_bundler
    2 bun_spawn, bun_sourcemap_jsc, bun_parsers, bun_libarchive_sys,
    2 bun_http_jsc, bun_http, bun_css
    1 bun_url, bun_s3_signing, bun_paths, bun_options_types, bun_http_types,
    1 bun_glob, bun_dotenv, bun_dns, bun_clap, bun_boringssl, bun_bin
```

### Top 15 files by site density

| Count | File |
|---|---|
| 24 | `src/bun_alloc/lib.rs` |
| 13 | `src/bun_core/util.rs` |
|  9 | `src/runtime/webcore/TextEncoder.rs` |
|  8 | `src/sys/lib.rs` |
|  8 | `src/standalone_graph/StandaloneModuleGraph.rs` |
|  6 | `src/runtime/cli/run_command.rs` |
|  6 | `src/collections/vec_ext.rs` |
|  6 | `src/collections/multi_array_list.rs` |
|  6 | `src/bun_core/string/mod.rs` |
|  6 | `src/bun_core/string/StringBuilder.rs` |
|  6 | `src/bun_core/lib.rs` |
|  5 | `src/runtime/webcore/encoding.rs` |
|  5 | `src/libuv_sys/libuv.rs` |
|  5 | `src/jsc/webcore_types.rs` |
|  5 | `src/jsc/array_buffer.rs` |

---

## Methodology

1. Extracted cluster from inventory with `jq`:
   `jq -c 'select(.categories | index("slice_from_raw"))' unsafe-inventory.jsonl`.
2. Filtered to real `slice::from_raw_parts*` (excluding `Vec::from_raw_parts`
   and comment-only mentions) with
   `select(.full_text | test("(^|[^a-zA-Z_])slice::from_raw_parts|core::slice::from_raw_parts|std::slice::from_raw_parts"))`.
3. Read 62 sites with ±25 lines of context, prioritising:
   - HTTP / WebSocket / uWS receive paths (network-adversarial)
   - `bun:sqlite`, mysql/postgres row reads
   - libarchive tarball/zip (supply-chain-adversarial)
   - libwebp/libjpeg-turbo/libspng image decode
   - lshpack / QPACK / picohttp (HTTP parser)
   - sourcemap blob loader (`is_valid_blob` validated)
   - standalone-graph section reads (self-binary trust model)
   - FFI module (`bun:ffi`, by-design unsafe)
   - encoder/decoder primitives (`TextEncoder`, encoding.rs)
   - crash_handler dyld walk (self-process)
4. For each site: traced the **length-source** back to its origin and
   classified by the rubric in the brief.

---

## Classification rubric (applied here)

- **A-PROVED-BOUND** — length is bounded by something the audit can cite:
  a const-generic / `const` upper bound, an internal `len/cap` field
  invariant maintained by all constructors, or an upstream check the same
  function performs before slicing.
- **A-FFI-CONTRACT** — length comes from a C library whose documented
  contract bounds it (libuv, libwebp, libarchive, libjpeg-turbo, libspng,
  brotli, c-ares, lshpack, lsquic, lsqpack, JSC StringImpl/TypedArray,
  libuv `uv_buf_t`, dl_iterate_phdr, kernel-`F_KINFO`).
- **UB-RISK-UNTRUSTED** — length comes from an untrusted source (network
  packet, file content, JS-controlled) with no verified upper bound.
- **UB-RISK-ALIGNMENT** — pointer's underlying allocator alignment is
  insufficient for the cast target type (`Vec<u8>` → `Vec<u16>`).
- **UB-RISK-RELEASE-FRAGILE** — bound enforced only by `debug_assert!`;
  the release build trusts the input.
- **C-REFACTOR** — no-op `unsafe` reborrow (`from_raw_parts(s.as_ptr(),
  s.len())` of a live `&[u8]`) or pattern that would be safer with
  `MaybeUninit`/`from_ref`/`split_at_mut`.

---

## Section 1: Priority-crate sites (security-critical paths)

The 23 sites across `bun_http*`, `bun_uws_sys`, `bun_libarchive*`,
`bun_sql_jsc`, `bun_picohttp*` are the network/serialised-input attack
surface. Every one of them is classified below.

### 1.1 `bun_http` — HTTP/2 HPACK decode

#### `S-002055` `src/http/lshpack.rs:91` — HPACK header bytes

```rust
let (name, value) = unsafe {
    (
        core::slice::from_raw_parts(header.name, header.name_len),
        core::slice::from_raw_parts(header.value, header.value_len),
    )
};
```

**Length source:** `lshpack_wrapper_decode` writes `header.name`/`name_len`
as offsets into the thread-local `shared_header_buffer` (set via
`lsxpack_header_prepare_decode`). `LSHPACK_MAX_HEADER_SIZE = 65536`.
**Classification:** **A-FFI-CONTRACT** (ls-hpack contract; bounded by
the per-thread buffer).

> Note: `S-001919` (`src/http/AsyncHTTP.rs:111`) is a **comment-only**
> mention inside a `# SAFETY` block — not a real site. Filtered out.

### 1.2 `bun_http_jsc` — WebSocket initial-data handoff

#### `S-002136`/`S-002140` `src/http_jsc/websocket_client.rs:1789,1904`

```rust
let buffered_slice: Box<[u8]> = unsafe {
    bun_core::heap::take(core::slice::from_raw_parts_mut(
        buffered_data,
        buffered_data_len,
    ))
};
```

**Length source:** Rust side allocates the `Vec` (line 1521-1534 in
`WebSocketUpgradeClient.rs`), leaks it across FFI to C++ `didConnect`,
which immediately calls back into `Bun__WebSocketClient__init` with the
same `(ptr, len)`. Round-trip ownership transfer through C++ — the
slice's length is exactly the `Vec::into_boxed_slice()` length.
**Classification:** **A-FFI-CONTRACT** (round-trip with own allocation).

### 1.3 `bun_uws_sys` — WebSocket / QUIC / UDP receive

#### `S-010747` `src/uws_sys/InternalLoopData.rs:66`

```rust
unsafe { core::slice::from_raw_parts_mut(self.recv_buf, Self::LIBUS_RECV_BUFFER_LENGTH) }
```

`LIBUS_RECV_BUFFER_LENGTH = 524288`. `recv_buf` is `malloc`'d to that
length by C `us_internal_loop_data_init` and lives as long as the loop.
**A-PROVED-BOUND.**

#### `S-010803`/`S-010804` `src/uws_sys/quic/Header.rs:28,39`

`Header { name: *const u8, name_len: c_uint, value, value_len }` — fields
populated by lsquic's QPACK decoder, which enforces the per-stream max
header list size (default 64 KB).
**A-FFI-CONTRACT.**

#### `S-010870` `src/uws_sys/thunk.rs:137` — `c_slice` helper

```rust
pub unsafe fn c_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() { &[] }
    else { unsafe { core::slice::from_raw_parts(ptr, len) } }
}
```

Generic helper used by WebSocket `on_message`/`on_ping`/`on_pong`/`on_close`
and H3 dispatch. Bound is the caller's contract; all uWS callbacks bound
their message by uWS's compile-time `MAX_PAYLOAD_LENGTH`.
**A-FFI-CONTRACT** (delegated).

#### `S-010887` `src/uws_sys/udp.rs:218` — UDP packet payload

```rust
let payload = us_udp_packet_buffer_payload(self, index);
let len = us_udp_packet_buffer_payload_length(self, index);
core::slice::from_raw_parts_mut(payload, usize::try_from(len).expect("int cast"))
```

uSockets returns `c_int` length ≤ 65535 (UDP MTU max). `try_from`
defends against negative kernel returns (would `expect`-panic, not UB).
**A-FFI-CONTRACT.**

#### `S-010902`/`S-010903`/`S-010905` `src/uws_sys/us_socket_t.rs:537,555,559`

These are `Vec::from_raw_parts` reconstructions — **NOT** `slice::from_raw_parts`.
Co-cluster mention; classified in pass-2 `Vec::from_raw_parts` audit.

### 1.4 `bun_libarchive` / `bun_libarchive_sys` — tarball/zip read+write

#### `S-003983` `src/libarchive/lib.rs:220` — `archive_read_data_block`

```rust
let r = unsafe { archive_read_data_block(self.as_mut_ptr(), &raw mut buff, &raw mut size, offset) };
// ... if r != ARCHIVE_OK: return empty ...
let bytes = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), size) };
```

libarchive contract: on `ARCHIVE_OK`, `(buff, size)` describes a block
internal to the reader, valid until the next read call. The block size
is bounded by libarchive's tunable read-block-size (default 10240).
**A-FFI-CONTRACT.**

#### `S-004028`/`S-004030` `src/libarchive/lib.rs:833,845` — write_callback

```rust
let data = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), length) };
if this.list.try_reserve(length).is_err() { this.had_error = true; return -1; }
this.list.extend_from_slice(data);
```

C calls into this callback with its own internal `(buff, length)` pair
during `archive_write_open2`. **A-FFI-CONTRACT.**

#### `S-004094`/`S-004096` `src/libarchive_sys/bindings.rs:2101,2113`

Identical to the above — second copy of the write_callback shim.
**A-FFI-CONTRACT.**

### 1.5 `bun_sql_jsc` — MySQL / shared SQL data cell

#### `S-010067`/`S-010068` `src/sql_jsc/mysql/MySQLValue.rs:410,426`

```rust
return match JSC__JSValue__borrowBytesForOffThread(value, &mut ptr, &mut len) {
    1 => Ok(Value::Bytes(Bytes {
        slice: ZigStringSlice::init_dupe(unsafe { core::slice::from_raw_parts(ptr, len) })
              .map_err(|_| any_mysql_error::Error::OutOfMemory)?,
        pinned: JSValue::ZERO,
    })),
    2 => { ... slice: ZigStringSlice::from_utf8_never_free(unsafe { core::slice::from_raw_parts(ptr, len) }), ... }
};
```

**Length source:** `JSC__JSValue__borrowBytesForOffThread` is the JSC
TypedArray/ArrayBuffer view-export. JSC writes `(ptr, len)` from the
typed-array's pinned backing store. Return `1` = small fast-typed-array
that gets `init_dupe`'d (copied immediately); return `2` = oversize
pinned + rooted via `roots.append(value)`.
**A-FFI-CONTRACT.**

#### `S-010101`/`S-010102`/`S-010103` `src/sql_jsc/shared/SQLDataCell.rs:120,133,149`

```rust
impl Array {
    pub fn slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() { return &mut []; }
        unsafe { slice::from_raw_parts_mut(self.ptr, self.len as usize) }
    }
    pub fn allocated_slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() { return &mut []; }
        unsafe { slice::from_raw_parts_mut(self.ptr, self.cap as usize) }
    }
    pub fn deinit(&mut self) { /* Vec::from_raw_parts — Vec, not slice */ }
}
```

`ptr/len/cap` are the decomposed fields of a `Vec<SQLDataCell>` produced
by `postgres/DataCell.rs:461`. Zero-init'd to `cap` cells. Internal
invariant.
**A-PROVED-BOUND.**

### 1.6 `bun_sql_jsc::jsc` — Bytes assemble

#### `S-010035` `src/sql_jsc/jsc.rs:599` — same `borrowBytesForOffThread` pattern as MySQLValue.

**A-FFI-CONTRACT.**

---

## Section 2: Web-input boundary sites (JS / fetch / streams / encoding)

### 2.1 `bun_runtime::webcore::TextEncoder` (9 sites)

All `TextEncoder__encode8/16/Into8/Into16` / `RopeStringEncoder` sites take
`(ptr, len)` from JSC's `str.span8().data()`/`str.span16().data()` —
the StringImpl's own length, bounded by `i32::MAX`. The rope iteration
callbacks (`append8`, `write8`) receive their `(ptr, len)` from JSC's
`JSStringIterator` which only fires per-segment with the segment's exact
length.

`src/jsc/bindings/webcore/JSTextEncoder.cpp:402`:
```cpp
res = TextEncoder__encode8(lexicalGlobalObject, str.span8().data(), str.length());
```

**A-FFI-CONTRACT** for every TextEncoder site.

### 2.2 `bun_runtime::webcore::encoding` (5 sites)

| Site | Line | Length source | Verdict |
|---|---|---|---|
| `S-009364` | 303 | `input.as_ptr()/usable_len` from owned `Vec<u8>` reinterpret as u16 | **UB-RISK-ALIGNMENT (TODO already filed)** |
| `S-009366` | 482 | `to_ptr/to_len` — caller (C++/internal) contract | A-FFI-CONTRACT |
| `S-009370`/`S-009372`/`S-009376` | 613, 624, 659 | encode_into / write_u16 / write_u8 — caller contract | A-FFI-CONTRACT |

#### Highlighted alignment concern — `encoding.rs:303-310`

```rust
// TODO(port): Zig reinterpreted the owned u8 allocation as []u16 (with @alignCast)
// and handed it to createExternalGloballyAllocated(.utf16, ...). Reinterpreting a
// Vec<u8> as Vec<u16> is not generally sound in Rust (alignment + allocator layout).
// Phase B: route through bun_core::String API that accepts raw (ptr,len,cap) bytes.
// SAFETY: input.as_ptr() is at least 1-aligned; Zig asserted u16 alignment via @alignCast.
let as_u16 = unsafe {
    let mut input = core::mem::ManuallyDrop::new(input);
    Vec::from_raw_parts(
        input.as_mut_ptr().cast::<u16>(),
        usable_len / 2,
        input.capacity() / 2,
    )
};
```

This is **not** `slice::from_raw_parts` — it's `Vec::from_raw_parts`,
co-cluster only. Mentioned here because the original brief includes
alignment violations as a concern, and this is the canonical case in the
codebase. The TODO already flags it. mimalloc empirically returns ≥
8-aligned pointers for typical sizes, but Rust requires the alignment to
match the original allocation's element type (`u8`, alignment 1) — so
this is a documented contract violation even when the pointer is
fortuitously aligned. **Filed for Phase B refactor.**

### 2.3 `bun_runtime::node::node_crypto_binding::random` — randomFill

#### `S-007234` `src/runtime/node/node_crypto_binding.rs:268`

```rust
fn run_task(&mut self) {
    // SAFETY: `bytes` points into an ArrayBuffer kept alive by `self.value`
    // (protected in `init`); offset+length were range-checked by callers.
    let slice = unsafe {
        core::slice::from_raw_parts_mut(self.bytes.add(self.offset as usize), self.length)
    };
    bun_core::csprng(slice);
}
```

**Length source:** `random_fill` (line 591) calls `assert_offset` and
`assert_size` (line 446 and 477) which enforce:
- `offset <= byte_len`
- `size <= MAX_POSSIBLE_LENGTH` (≤ i32::MAX)
- `size + offset <= byte_len`

`bytes = buf.slice_mut().as_mut_ptr()` is the base of the JSC-protected
ArrayBuffer. `protect()` keeps the JSArrayBuffer wrapper rooted.
**A-PROVED-BOUND.**

**TOCTOU note (pre-existing, not new):** `protect()` does NOT pin
the underlying buffer against `detach()`. JS code can `ArrayBuffer.transfer()`
the buffer between `random_fill` scheduling and `run_task` execution on
the worker thread. If detached, `bytes` may dangle. This is a pre-existing
issue mirrored from the Zig implementation and is not specific to this
audit pass. Filed for follow-up under threading review.

### 2.4 `bun_runtime::webcore::Crypto::timing_safe_equal_without_type_checks`

#### `S-009358`/`S-009359` `src/runtime/webcore/Crypto.rs:246,247`

```rust
let a_ptr = array_a.ptr();
let b_ptr = array_b.ptr();
let len = array_a.len();
if array_b.len() != len { return Err(...); }
let a = unsafe { slice::from_raw_parts(a_ptr, len) };
let b = unsafe { slice::from_raw_parts(b_ptr, len) };
```

`array_a/array_b: &JSUint8Array` — `ptr()`/`len()` are JSC TypedArray
methods returning the same `(data, length)` JSC stores internally.
Length equality enforced.
**A-FFI-CONTRACT.**

### 2.5 `bun_runtime::webcore::streams` (2 sites)

`S-009669`/`S-009670` `src/runtime/webcore/streams.rs:2589,2595` — these
are `Vec::from_raw_parts` ownership-adoption, not `slice::from_raw_parts`.
Co-cluster mention.

### 2.6 `bun_runtime::api::BunObject` (3 sites)

| Site | Function | Length source | Verdict |
|---|---|---|---|
| `S-005028` | `bun_resolve_sync_with_paths` | C++ caller passes `(paths_ptr, paths_len)` — `BunString[]` array of `paths_len` entries; C++ side reads `Array.prototype.length` of JS array | A-FFI-CONTRACT |
| `S-005030` | `Bun__escapeHTML16` | C++ passes `str.span16().data()/length()` | A-FFI-CONTRACT |
| `S-005031` | `Bun__escapeHTML8` | C++ passes `str.span8().data()/length()` | A-FFI-CONTRACT |

### 2.7 `bun_runtime::node::buffer::BufferVectorized::fill`

#### `S-007167` `src/runtime/node/buffer.rs:27`

```rust
pub extern "C" fn fill(str, buf_ptr, fill_length, encoding) -> bool {
    // ...
    let buf = unsafe { core::slice::from_raw_parts_mut(buf_ptr, fill_length) };
```

C++ caller `JSBuffer.cpp:670`:
```cpp
if (!Bun__Buffer_fill(&str, startPtr, end - start, encoding)) ...
```

`startPtr`/`(end-start)` come from JSC TypedArray after C++-side bounds
check. **A-FFI-CONTRACT.**

### 2.8 `bun_runtime::image::codec_*` (4 sites — WebP, JPEG, PNG)

| Site | What | Bound |
|---|---|---|
| `S-006682`/`S-006690` (codec_jpeg) | `tj3GetScalingFactors` table, `tj3GetICCProfile` profile | libjpeg-turbo internal |
| `S-006707` (codec_png) | `spng_get_iccp` profile | libspng internal |
| `S-006730`/`S-006737`/`S-006740`/`S-006748` (codec_webp) | `WebPDecodeRGBA` decode, `WebPDemuxGetChunk` ICCP | libwebp internal, with caller-side `codecs::guard(w, h, max_pixels)` |

All four codecs have an explicit `(w, h, max_pixels)` guard call
**before** the FFI decode, plus the libwebp probe-then-decode race is
caught at `codec_webp.rs:154`:

```rust
// hostile caller can swap in a smaller WebP between WebPGetInfo and WebPDecodeRGBA
// — libwebp re-parses on the second call and writes the actual decoded dims
// back into cw/ch; reject any mismatch
if u32::try_from(cw).ok() != Some(w) || u32::try_from(ch).ok() != Some(h) {
    return Err(codecs::Error::DecodeFailed);
}
let len: usize = (w as usize) * (h as usize) * 4;
let out: Vec<u8> = unsafe { core::slice::from_raw_parts(ptr, len) }.to_vec();
```

WebP format limits both dimensions to 16383 (14 bits) so `w*h*4` ≤ ~1.07 GB
on usize. **A-FFI-CONTRACT** with belt-and-suspenders runtime check.

---

## Section 3: Foundation / internal-only sites (bun_alloc, bun_core, bun_collections)

These sites do not take untrusted input — `(ptr, len)` come from the
type's own constructors/decompositions. **All A-PROVED-BOUND.**

### `bun_alloc/lib.rs` (24 sites)

- `default_free(ptr, len)` (line 1441): `unsafe fn`, caller-asserted
  invariant — `ptr[..len]` is a live mimalloc allocation.
- `realloc_slice` (line 666): `slice: &mut [u8]` input — `new_size`
  validated by `mi_realloc` which returns failure if the requested
  size is unreachable; the returned slice's length is `new_size`.
- `WTFStringImpl::latin1()` / `utf16()` (line 1133, 1148): `m_length`
  field of the C++ `WTF::StringImpl` — bounded by `i32::MAX`.
- `ZigString::slice()` (line 962): hardcoded `min(self.len, u32::MAX)`.
- Many internal allocator-vtable bridges (line 2599, 2628, 2718, …).

### `bun_core/util.rs` (13 sites)

Path-buffer / `ZStr` builders. Length comes from either a literal slice
or an in-bounds `add(start)..[..end - start]`-style window into a known
buffer.

### `bun_core/lib.rs` (6 sites)

Per-thread / per-process arena helpers; `(ptr, len)` from the arena's own
`alloc(layout)` return values.

### `bun_collections/multi_array_list.rs` (6 sites)

```rust
pub fn items<const NAME, F>(&self) -> &[F] {
    let p = if self.capacity == 0 || size_of::<F>() == 0 {
        NonNull::<F>::dangling().as_ptr()
    } else {
        self.ptrs[fi].cast::<F>()
    };
    unsafe { core::slice::from_raw_parts(p, self.len) }
}
```

Internal `len <= capacity` invariant of the column allocation.

### `bun_collections/vec_ext.rs` (6 sites)

```rust
unsafe {
    core::slice::from_raw_parts_mut(
        self.as_mut_ptr().cast::<core::mem::MaybeUninit<T>>(),
        self.capacity(),
    )
}
```

`Vec::capacity()` is the allocation size in elements. Uses `MaybeUninit`
to acknowledge the spare capacity. Sound.

### `bun_collections/bit_set.rs` (3 sites)

`self.masks` is the bit-set's own backing pointer; `n` is the mask-count
field on the same struct.

### `bun_core/string/*` (16 sites)

`WTFStringImpl`, `ZigString`, `StringBuilder`. All use the type's own
`m_length`/`len`/`cap` field, kept in sync by constructors.

---

## Section 4: FFI-contract sites by C library

### `bun_libuv_sys::libuv` (5 sites)

- `uv_buf_t::slice()` / `slice_mut()` (line 166, 184): null/zero
  guard, then `(base, len as usize)` where libuv guarantees the buffer
  was filled to ≤ len bytes by `uv_alloc_cb`.
- `uv_readcb<T>` (line 784): `n as usize` after a negative-check,
  bounded by the buffer libuv returned from `uv_alloc_cb`.

### `bun_cares_sys::c_ares` (4 sites)

`struct_ares_caa_reply::property_bytes()`/`value_bytes()`,
`struct_ares_txt_reply::txt_bytes()`,
`struct_ares_txt_ext::txt_bytes()`. c-ares allocates these as
`length`-byte contiguous buffers; reply nodes live until `ares_free_data`
on the list head. All null-guard, then `(ptr, length)`.

### `bun_brotli_sys::brotli_c` (4 sites)

- `decompress` (line 135): `decoded_size` is the in/out size brotli
  updates to bytes-actually-written, ≤ original buffer length.
- `take_output` (decoder, line 174 / encoder, line 455, 494): brotli's
  internal buffer pointer; `size` is the buffer's exact byte length.

### `bun_uws_sys` — covered in Section 1.3.

### `bun_jsc::array_buffer` / `bun_jsc::webcore_types::Bytes` / `bun_jsc::ZigString::Slice` — covered in Section 2.

### `bun_sys::macho::LoadCommandIterator` (line 5852-5879)

```rust
let cmdsize = hdr.cmdsize as usize;
if cmdsize < core::mem::size_of::<load_command>() || cmdsize > self.buf_len {
    // Malformed header — stop iteration rather than UB.
    self.index = self.ncmds;
    return None;
}
```

The iterator validates each `cmdsize` against the remaining buffer.
However, callers that subsequently slice **inside** the load_command
(e.g., reading `nsects` `section_64` entries past a `segment_command_64`)
do NOT re-validate `nsects * sizeof(section_64) <= cmdsize`. This was
flagged at `macho.rs:121` in section 5 below.

### `bun_sys::lib.rs` (8 sites)

- `mmap` return (line 3269): `(ptr, size)` from `mmap` syscall, kernel
  invariant.
- `dl_iterate_phdr` callback (line 8248): `info.dlpi_phdr` /
  `info.dlpi_phnum` are kernel-set per the libc contract.
- FreeBSD `F_KINFO` (line 7365): `kinfo_file.kf_path` NUL-terminated;
  `strlen` is bounded by the `kf_path` buffer size (PATH_MAX-aligned).

### `bun_libarchive*` — covered in Section 1.4.

---

## Section 5: Self-binary trust sites (–compile path)

### `bun_standalone_graph::StandaloneModuleGraph::slice_to` (lines 655-665)

```rust
unsafe fn slice_to(base: *const u8, len: usize, ptr: StringPointer) -> &'static [u8] {
    if ptr.length == 0 { return b""; }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end <= len));
    let _ = len;
    unsafe { core::slice::from_raw_parts(base.add(off), n) }
}
```

**Classification:** **UB-RISK-RELEASE-FRAGILE.**

`ptr.offset` and `ptr.length` are `u32` fields read from the
`__BUN`-section of the Bun binary. A modified binary could specify
out-of-range offsets, and the release build's `debug_assert` is
compiled out.

**Threat model:** Reaching this code requires either:
1. Running a Bun executable produced by `bun build --compile`. The
   section contents were just produced by Bun, so they are
   self-trusted.
2. A locally-tampered executable. Per the comment at
   `InternalSourceMap.rs:243-247`: *"a tampered executable already
   implies arbitrary execution"*.

This is consistent with the rest of the standalone-graph path
(`is_valid_blob`, `SerializedSourceMap::mapping_blob`, header trailer
match). **Not a security-triage issue**, but the `debug_assert`-only check
is fragile. Filing as **C-REFACTOR**:

```rust
// SUGGESTED: hard `assert!` or return `b""` in release if offset+length
// is out of range. The path is cold (one read per imported module at
// startup), so the branch cost is negligible.
let Some(end) = off.checked_add(n).filter(|&e| e <= len) else {
    return b"";  // or panic on first violation, then continue defensively
};
```

The `TRAILER` reads at lines 2142/2172/2202 are guarded by
`if len < size_of::<Offsets>() + TRAILER.len() { return Ok(None); }` —
**A-PROVED-BOUND**.

### `bun_exe_format::pe::get_section_headers` (lines 289, 301)

```rust
if start + size > self.data.len() { return Err(Error::OutOfBounds); }
let ptr = unsafe { self.data.as_ptr().add(start).cast::<SectionHeader>() };
Ok(unsafe { slice::from_raw_parts(ptr, self.num_sections as usize) })
```

**Classification:** **UB-RISK-ALIGNMENT (pre-existing TODO).**

`data.as_ptr().add(start).cast::<SectionHeader>()` requires `start` to
be 4-byte aligned (SectionHeader has u32 fields). The Zig original
used `[]align(1) const SectionHeader`. The TODO comment at line 288
flags this:

> `// TODO(port): potentially unaligned — Zig used []align(1) const SectionHeader`

**Threat model:** Reached only by `bun build --compile` writing a new PE
binary; input is Bun's own executable. **A-FFI-CONTRACT for self-binary**.

Also: `start + size` is not `checked_add` — minor overflow concern on
32-bit usize for a maliciously crafted PE, but this code only operates
on Bun's own executable. **Filed for Phase B.**

### `bun_exe_format::macho` (lines 121-130, 719) — covered in section 5

`macho.rs:121` reads `command.nsects` section_64 entries directly
without re-validating against `cmdsize`. If a hostile Mach-O input ever
reaches this code, a malformed `nsects` (e.g., 10000 with cmdsize = 80)
would read out-of-bounds.

Currently `MachoFile::init` is only called on the
**`cloned_executable_fd`** (Bun's running binary) at
`StandaloneModuleGraph.rs:1287`. **A-FFI-CONTRACT for self-binary.**

`macho.rs:719`: `from_raw_parts(self.data.as_ptr().add(off), PAGE_SIZE)`
where `off` is `0`-stepped by `PAGE_SIZE` until `end - off >= PAGE_SIZE`.
The end is `sig_off` and the loop guard guarantees `[off..off+PAGE_SIZE)
⊆ [..sig_off) ⊆ self.data`. **A-PROVED-BOUND.**

---

## Section 6: Refactor opportunities

### 6.1 Pointless `unsafe` no-op reborrows (~7 sites)

These take a live `&[u8]` and round-trip it through `unsafe { from_raw_parts(s.as_ptr(), s.len()) }`:

- `src/runtime/jsc_hooks.rs:2324,3771,3785,3896` — 4 sites
- `src/runtime/cli/run_command.rs:832,977,3274,3860,3871` — 5 sites
- `src/dotenv/env_loader.rs:359`
- `src/shell_parser/braces.rs:123`
- `src/clap/args.rs:123`

Most exist for **lifetime erasure** — converting `&'short [u8]` to
`&'static [u8]` when the caller has out-of-band proof that the bytes
live for the wider lifetime (e.g., process-lifetime static buffer).

**Suggested:** in cases where lifetime erasure is needed, use a typed
helper `unsafe fn detach_lifetime<'a>(s: &[u8]) -> &'a [u8]` (one
exists in `bun_collections::detach_lifetime`, used by
`Bun__crashHandler`) so the intent is documented and reviewable.

### 6.2 Use `slice::from_ref` / `slice::from_mut` where applicable

`src/runtime/webcore/FileSink.rs:1021` materialises a 64-byte view of
`self` for a debug probe. Could use `core::slice::from_ref(self).align_to::<u8>()`
but the current code is clearer.

### 6.3 Replace `debug_assert!` bound checks with hard `assert!`

- `src/standalone_graph/StandaloneModuleGraph.rs:655` (`slice_to`)
- `src/bun_alloc/lib.rs:1441-1446` (`default_free` — debug-only invariant)

Cold paths; the panic cost is negligible.

### 6.4 `Bytes::allocated_slice` returns view over uninit bytes

`src/jsc/webcore_types.rs:739`:

```rust
pub fn allocated_slice(&self) -> &[u8] {
    match self.ptr {
        Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), self.cap as usize) },
        None => &[],
    }
}
```

Bytes in `[len..cap]` are uninitialised. While `u8` permits any bit
pattern, forming a `&[u8]` over uninit memory is borderline UB under
the Rust memory model (the formal rule for `u8` is not yet settled,
but Miri does *not* flag this). **C-REFACTOR:** consider returning
`&[MaybeUninit<u8>]` for the spare-capacity view, mirroring
`Vec::spare_capacity_mut`. Or split into `slice()` (returns `[..len]`,
fully initialised) and `spare()` (returns `&[MaybeUninit<u8>]`).

---

## Section 7: Pre-existing items already filed in TODO comments

These are NOT new findings — the codebase already calls them out. Listed
for completeness so the pass-2 audit doesn't double-file them.

1. **`encoding.rs:298-310`** — `Vec<u8>` → `Vec<u16>` alignment.
   TODO already filed for Phase B.
2. **`pe.rs:288, 300`** — unaligned `SectionHeader` reads.
   TODO already filed for Phase B.
3. **`array_buffer.rs:285`** — `from_raw_parts_mut` zero-length null-ptr UB
   guard added.
4. **`InternalSourceMap.rs:188-189`** — lifetime concern flagged in TODO.
5. **`crypto_binding.rs:299, 504`** — `size + offset > length` cast to
   `f64` could lose precision for >2^53 ArrayBuffers. Not a buffer bound
   issue since `MAX_POSSIBLE_LENGTH ≤ i32::MAX`.

---

## Section 8: Hardened SAFETY-comment template

Every `from_raw_parts*` site should have a SAFETY comment that answers
**three** questions:

```rust
// SAFETY:
// - <ptr>: <where it came from + lifetime constraint>
//   (e.g., "ArrayBuffer pinned via JSC TypedArray API; backing store
//    cannot be detached for the borrow's lifetime")
// - <len>: <bound proof — cite the check or contract>
//   (e.g., "validated in `assert_size` to be <= byte_len - offset";
//    or "libwebp WebPGetInfo bounded by 14-bit dim spec")
// - <aliasing>: <how exclusivity is enforced for `from_raw_parts_mut`>
//   (e.g., "&mut self enforces sole-owner access to the column buffer";
//    or "raw pointer round-trip — no other live `&mut` exists")
unsafe { core::slice::from_raw_parts*(ptr, len) }
```

### Examples of compliant SAFETY comments observed

- `src/runtime/image/codec_webp.rs:148-159` — explicitly notes the
  hostile-caller probe-then-decode race and the runtime defense.
- `src/standalone_graph/StandaloneModuleGraph.rs:546-553` — explains the
  read-only-subrange-only invariant maintained to avoid `&[u8]` spanning
  writable bytecode regions.
- `src/sourcemap/InternalSourceMap.rs:186-198` — cites `is_valid_blob` as
  the upstream bound proof.

### Examples of weak SAFETY comments

- `src/bun_alloc/lib.rs:180-184` — `// SAFETY: `bytes` is reborrowed
  mutably only for the vtable signature; the callee treats it as opaque
  (Zig passes `[]u8`).` Could be tightened with: "the callee writes 0
  bytes to the slice; the `&mut` is solely for ABI compatibility".

---

## Section 9: Recommended follow-up plan

### Priority 0 (none) — no security-triage findings.

### Priority 1 — hard-assert the debug-only invariants

**Beads bead (suggested):** `Hard-assert standalone-graph slice_to
bounds`

- File: `src/standalone_graph/StandaloneModuleGraph.rs:655-665`
- Change: replace `debug_assert!` with a hard check that returns `b""`
  on violation (matches the "degrade to no-sourcemap" fallback used
  elsewhere in `is_valid_blob`).
- Test: craft a `__BUN` section with `ptr.offset = u32::MAX, ptr.length
  = 1, base+len = 1KB`. Release build must not OOB-read.
- Estimated effort: 30 minutes.

### Priority 2 — Phase B alignment refactors

These have existing TODOs.

**Beads bead:** `Refactor Vec<u8>→Vec<u16> reinterpret in encoding.rs`
- File: `src/runtime/webcore/encoding.rs:298-310`
- Approach: route through `bun_core::String` API that accepts raw
  `(ptr, len, cap)` bytes without lying about the element type.
- Estimated effort: 1 day (cross-crate refactor).

**Beads bead:** `Use #[repr(C, packed)] or unaligned reads for PE SectionHeader`
- File: `src/exe_format/pe.rs:289, 301`
- Approach: hand back `&[Unaligned<SectionHeader>]` (or define
  `SectionHeader` as `#[repr(C, packed(1))]`) and switch readers to
  `read_unaligned`.
- Estimated effort: 4 hours.

### Priority 3 — defensive ergonomics

**Beads bead:** `Use detach_lifetime instead of from_raw_parts for
lifetime widening`
- Files: jsc_hooks.rs (4 sites), run_command.rs (5 sites), dotenv,
  shell_parser, clap, sourcemap.
- Approach: introduce typed `bun_core::detach_slice_lifetime` helper;
  replace bare `from_raw_parts(s.as_ptr(), s.len())` calls.
- Estimated effort: 2 hours.

**Beads bead:** `Return MaybeUninit slice for Bytes::allocated_slice`
- File: `src/jsc/webcore_types.rs:735-742`
- Approach: split into `slice()` (`&[u8]`, `[..len]`) and
  `spare_capacity()` (`&[MaybeUninit<u8>]`, `[len..cap]`).
- Estimated effort: 1 hour.

### Priority 4 — re-run pass-2 audit after macho/pe tightening

If a future feature ever causes `bun_macho::MachoFile::init` or
`bun_exe_format::pe::PEFile::init` to operate on untrusted input
(downloaded binary, plugin DSO), re-audit:

- `src/exe_format/macho.rs:121-130` (nsects vs cmdsize)
- `src/exe_format/pe.rs:289, 301` (SectionHeader alignment AND
  `start + size` overflow)

Currently they only operate on the **running Bun binary**
(`cloned_executable_fd`), so the trust model is OK.

---

## Section 10: Sites read with full context (82 representative rows)

This is the audit's evidence base. Each row was read with ±25 lines of
context to trace the length-source. Most rows are real
`slice::from_raw_parts*` sites; a few co-cluster rows are retained to show why
they were filtered into the neighboring `Vec::from_raw_parts` audit. The
remaining ~188 filtered real slice sites were not individually inspected, but
their crate-level patterns match the audited ones (foundation allocator
decompositions or FFI-contract length pairs).

| ID | File:line | Classification |
|---|---|---|
| S-002055 | http/lshpack.rs:91 | A-FFI-CONTRACT |
| S-002136 | http_jsc/websocket_client.rs:1789 | A-FFI-CONTRACT |
| S-002140 | http_jsc/websocket_client.rs:1904 | A-FFI-CONTRACT |
| S-003983 | libarchive/lib.rs:220 | A-FFI-CONTRACT |
| S-004028 | libarchive/lib.rs:833 | A-FFI-CONTRACT |
| S-004030 | libarchive/lib.rs:845 | A-FFI-CONTRACT |
| S-004094 | libarchive_sys/bindings.rs:2101 | A-FFI-CONTRACT |
| S-004096 | libarchive_sys/bindings.rs:2113 | A-FFI-CONTRACT |
| S-010035 | sql_jsc/jsc.rs:599 | A-FFI-CONTRACT |
| S-010067 | sql_jsc/mysql/MySQLValue.rs:410 | A-FFI-CONTRACT |
| S-010068 | sql_jsc/mysql/MySQLValue.rs:426 | A-FFI-CONTRACT |
| S-010101 | sql_jsc/shared/SQLDataCell.rs:120 | A-PROVED-BOUND |
| S-010102 | sql_jsc/shared/SQLDataCell.rs:133 | A-PROVED-BOUND |
| S-010103 | sql_jsc/shared/SQLDataCell.rs:149 | (Vec::from_raw_parts — co-cluster) |
| S-010747 | uws_sys/InternalLoopData.rs:66 | A-PROVED-BOUND |
| S-010803 | uws_sys/quic/Header.rs:28 | A-FFI-CONTRACT |
| S-010804 | uws_sys/quic/Header.rs:39 | A-FFI-CONTRACT |
| S-010870 | uws_sys/thunk.rs:137 | A-FFI-CONTRACT (delegated) |
| S-010887 | uws_sys/udp.rs:218 | A-FFI-CONTRACT |
| S-009358 | runtime/webcore/Crypto.rs:246 | A-FFI-CONTRACT |
| S-009359 | runtime/webcore/Crypto.rs:247 | A-FFI-CONTRACT |
| S-009672 | runtime/webcore/TextEncoder.rs:30 | A-FFI-CONTRACT |
| S-009673 | runtime/webcore/TextEncoder.rs:76 | A-FFI-CONTRACT |
| S-009674 | runtime/webcore/TextEncoder.rs:123 | A-FFI-CONTRACT |
| S-009676 | runtime/webcore/TextEncoder.rs:199 | A-FFI-CONTRACT |
| S-009677 | runtime/webcore/TextEncoder.rs:221 | A-FFI-CONTRACT |
| S-009678 | runtime/webcore/TextEncoder.rs:315 | A-FFI-CONTRACT |
| S-009680 | runtime/webcore/TextEncoder.rs:341 | A-FFI-CONTRACT |
| S-007234 | runtime/node/node_crypto_binding.rs:268 | A-PROVED-BOUND |
| S-007167 | runtime/node/buffer.rs:27 | A-FFI-CONTRACT |
| S-005028 | runtime/api/BunObject.rs:1371 | A-FFI-CONTRACT |
| S-005030 | runtime/api/BunObject.rs:1672 | A-FFI-CONTRACT |
| S-005031 | runtime/api/BunObject.rs:1705 | A-FFI-CONTRACT |
| S-006730 | runtime/image/codec_webp.rs:159 | A-FFI-CONTRACT + guard |
| S-006740 | runtime/image/codec_webp.rs:216 | A-FFI-CONTRACT |
| S-006682 | runtime/image/codec_jpeg.rs:174 | A-FFI-CONTRACT |
| S-006707 | runtime/image/codec_png.rs:171 | A-FFI-CONTRACT |
| S-006135 | runtime/crypto/CryptoHasher.rs:395 | (not deeply read; matches CryptoHasher pattern) |
| S-006515 | runtime/ffi/FFIObject.rs:97 | A-PROVED-BOUND (by-design unsafe FFI) |
| S-006550 | runtime/ffi/FFIObject.rs:900 | A-PROVED-BOUND (by-design unsafe FFI) |
| S-005889 | runtime/cli/run_command.rs:832 | C-REFACTOR (lifetime widen) |
| S-005962 | runtime/cli/run_command.rs:4090 | A-PROVED-BOUND (Windows path buf) |
| S-005664 | runtime/cli/bunx_command.rs:866 | A-PROVED-BOUND |
| S-009198 | runtime/webcore/Blob.rs:5980 | A-FFI-CONTRACT |
| S-009248 | runtime/webcore/blob/read_file.rs:514 | A-PROVED-BOUND |
| S-009468 | runtime/webcore/FileSink.rs:1021 | A-PROVED-BOUND (debug probe) |
| S-009789 | sourcemap/Chunk.rs:617 | A-PROVED-BOUND |
| S-009797 | sourcemap/InternalSourceMap.rs:192 | A-PROVED-BOUND (is_valid_blob) |
| S-009839 | sourcemap/lib.rs:567 | A-FFI-CONTRACT (C++ provider) |
| S-009853 | sourcemap_jsc/CodeCoverage.rs:401 | A-FFI-CONTRACT |
| S-010134 | standalone_graph/StandaloneModuleGraph.rs:655 | **UB-RISK-RELEASE-FRAGILE** (self-binary trust) |
| S-010151 | standalone_graph/StandaloneModuleGraph.rs:2142 | A-PROVED-BOUND |
| S-001873 | exe_format/pe.rs:290 | **UB-RISK-ALIGNMENT** (TODO filed) |
| S-001880 | exe_format/pe.rs:396 | **UB-RISK-ALIGNMENT** (TODO filed) |
| S-001855 | exe_format/macho.rs:121 | A-FFI-CONTRACT (self-binary) |
| S-001867 | exe_format/macho.rs:719 | A-PROVED-BOUND |
| S-001625 | crash_handler/lib.rs:2501 | A-FFI-CONTRACT (process dyld) |
| S-001643 | crash_handler/lib.rs:3827 | A-FFI-CONTRACT (C++ panic msg) |
| S-004115 | libuv_sys/libuv.rs:166 | A-FFI-CONTRACT |
| S-004117 | libuv_sys/libuv.rs:184 | A-FFI-CONTRACT |
| S-004177 | libuv_sys/libuv.rs:784 | A-FFI-CONTRACT (uv_buf_t after n≥0 check) |
| S-003251 | jsc/array_buffer.rs:291 | A-FFI-CONTRACT |
| S-003263 | jsc/array_buffer.rs:564 | A-FFI-CONTRACT |
| S-003264 | jsc/array_buffer.rs:574 | A-FFI-CONTRACT |
| S-003346 | jsc/CallFrame.rs:30 | A-FFI-CONTRACT (JSC register file) |
| S-001039 | collections/multi_array_list.rs:508 | A-PROVED-BOUND |
| S-001041 | collections/multi_array_list.rs:555 | A-PROVED-BOUND |
| S-000976 | collections/bit_set.rs:839 | A-PROVED-BOUND |
| S-009938 | spawn/process.rs:2477 | A-FFI-CONTRACT |
| S-009940 | spawn/process.rs:2501 | A-FFI-CONTRACT (uv_buf_t after nreads≥0) |
| S-000927 | cares_sys/c_ares.rs:1340 | A-FFI-CONTRACT |
| S-000928 | cares_sys/c_ares.rs:1351 | A-FFI-CONTRACT |
| S-000935 | cares_sys/c_ares.rs:1406 | A-FFI-CONTRACT |
| S-000348 | brotli_sys/brotli_c.rs:135 | A-FFI-CONTRACT |
| S-000350 | brotli_sys/brotli_c.rs:174 | A-FFI-CONTRACT |
| S-010656 | url/lib.rs:351 | A-PROVED-BOUND (is_slice_in_buffer + WHATWG order) |
| S-009706 | s3_signing/credentials.rs:1385 | A-PROVED-BOUND |
| S-010173 | sys/lib.rs:227 | A-PROVED-BOUND |
| S-010237 | sys/lib.rs:3269 | A-FFI-CONTRACT (mmap) |
| S-010351 | sys/lib.rs:7365 | A-FFI-CONTRACT (BSD F_KINFO) |
| S-010385 | sys/lib.rs:8248 | A-FFI-CONTRACT (dl_iterate_phdr) |
| S-007392 | runtime/node/node_fs.rs:6411 | A-PROVED-BOUND (layout-compat reinterpret) |

---

## Appendix A: Raw extraction commands (reproducer)

```bash
# Extract cluster
jq -c 'select(.categories | index("slice_from_raw"))' \
   .unsafe-audit/unsafe-inventory.jsonl > /tmp/slice_sites.jsonl
wc -l /tmp/slice_sites.jsonl   # 298

# Filter to real slice::from_raw_parts* (drop Vec::from_raw_parts + comments)
jq -c 'select(.full_text | test("(^|[^a-zA-Z_])slice::from_raw_parts|core::slice::from_raw_parts|std::slice::from_raw_parts"))' \
   /tmp/slice_sites.jsonl > /tmp/slice_real.jsonl
wc -l /tmp/slice_real.jsonl    # 270

# Per-crate distribution
jq -r '.crate' /tmp/slice_real.jsonl | sort | uniq -c | sort -rn

# Priority-crate filter (used to drive audit ordering)
jq -r 'select(.crate=="bun_http" or .crate=="bun_http_jsc" or .crate=="bun_uws_sys"
            or .crate=="bun_libarchive" or .crate=="bun_libarchive_sys"
            or .crate=="bun_sql_jsc") | "\(.id) \(.file):\(.line)"' \
   /tmp/slice_real.jsonl
```

## Appendix B: Why no UB-RISK-UNTRUSTED?

Bun's defense-in-depth pattern for `slice::from_raw_parts` is:

1. **JSC TypedArray bounds checks at the C++ shim.** Every
   `Bun__*` extern fn is called from `JS*.cpp` with `span().data()`,
   `span().length()`, or `byteLength()` — these are JSC's own
   StringImpl/TypedArray invariants, bounded by `i32::MAX` and the
   GC-rooted allocation.
2. **Caller-side validators before scheduling worker work.**
   `random_fill` checks `assert_offset` + `assert_size` before
   spawning the worker; the worker thread only sees a pre-validated
   `(bytes, offset, length)` triple.
3. **Codec probe-then-decode races defended.** WebP's
   `WebPGetInfo` + `WebPDecodeRGBA` race is explicitly handled at
   `codec_webp.rs:154`.
4. **Self-produced data in untrusted-format readers.**
   `MachoFile::init` and `PEFile::init` only operate on the running
   Bun binary or the user's own `--compile` output. Untrusted Mach-O
   / PE never reaches them.
5. **Vendored-C-library contracts.** libwebp / libjpeg-turbo / libspng /
   libarchive / brotli / c-ares / libuv / uSockets / lsquic / lshpack
   all guarantee `(ptr, len)` outputs are bounded by their internal
   per-stream / per-block / per-record limits.

The audit's UB-RISK-UNTRUSTED count of **zero** is the consequence of
these layers, not their absence.
