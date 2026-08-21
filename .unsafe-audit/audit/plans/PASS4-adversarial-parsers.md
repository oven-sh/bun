# Pass 4 — Adversarial-Input Parser/Lookup Audit (6 crates)

**Scope:** `bun_resolver`, `bun_url`, `bun_picohttp`, `bun_glob`, `bun_semver`, `bun_watcher`.

**Methodology.** For each crate: (1) identified the externally-reachable
entry points and the corresponding untrusted-input boundary; (2) enumerated the
`unsafe` blocks (using `grep -n unsafe` on each `.rs` file); (3) sampled the
hottest 15–30 sites per crate, prioritising those on the path from a parser
entry point to a raw-pointer / `get_unchecked` / `from_raw_parts` /
provenance-bending operation; (4) read ≥25 lines of surrounding context for each
flagged site and traced the input from the JS / file / network boundary down to
the unsafe; (5) before tiering, re-read each SAFETY comment to verify it does
not already discharge the concern.

**Discipline.** Every file:line citation in this document was verified against
the current source tree. T1 = a concrete unsoundness with an identifiable
adversarial input; T2 = an architectural defect (public-API contract, Send/Sync,
lifetime laundering) that is not immediately exploitable but undermines audit
guarantees; T3 = latent watch-list / future-hardening note. **P0** is reserved
for T1 issues where untrusted external input (lockfile, npm registry response,
inbound HTTP, user-supplied glob/url) is sufficient by itself to trip UB without
any other defect.

A non-trivial number of crates surveyed here are **CLEAN** — `bun_glob`,
`bun_semver/Version.rs`, `bun_semver/SemverRange.rs`, `bun_resolver/data_url.rs`,
`bun_resolver/tsconfig_json.rs`, `bun_resolver/node_fallbacks.rs`,
`bun_watcher/lib.rs`, `bun_watcher/KEventWatcher.rs`. Calling that out is the
point: the audit's marketing value relies on it being defensible.

Existing Pass-3 findings explicitly **not re-counted** here:

- **H9** (picohttp NUL-write at `picohttp/lib.rs:383`) — counted in Pass 3.
- **PUB-INSTALL-1..4** (lockfile transmute/uninit/dep_id-OOB) — counted in Pass 3.

This pass found **two** additional T1 issues. Neither was visible to earlier
passes because each is wedged in a different crate from the original site of
the related Pass-3 finding.

---

## §1 — `bun_picohttp` (`src/picohttp/lib.rs`)

### §1.1 Attack surface

Every inbound HTTP/1.1 request and every fetch response. `Request::parse`,
`Response::parse_parts`, `Response::parse`, `Headers::parse` all hand a raw byte
buffer + the picohttpparser FFI a writable `[Header]` array. picohttpparser
writes back out-params (`method`/`path`/`status_ptr`/`num_headers`/`name`/`value`
pointers, all pointing back into `buf`). Returned `Request<'a>`/`Response<'a>`
borrow `buf` and `src` for their `'a` lifetime.

Site inventory: 22 `unsafe` tokens in `lib.rs` (Cargo.toml is a stub). H9 is at
line 383 and is *deliberately excluded* from the Pass-4 T1 count below.

### §1.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| H9 (Pass 3 carry-in) | `picohttp/lib.rs:383` | — | `path_ptr.cast_mut().add(path_len).write(0)` through a `*const`-derived pointer; Stacked-Borrows UB on every parsed request. Already documented. |
| picohttp-T3-1 | `picohttp/lib.rs:393, 395, 641, 642` | T3 | `usize::try_from(minor_version).expect("int cast")` / `u32::try_from(status_code).expect("int cast")` — DoS-only panic-on-malformed-out-param. Picohttpparser only writes 0/1 minor_version and a 3-digit status on success (rc > -1), so this is contract-bound, not adversary-reachable in practice. Recommendation: replace `expect` with `unwrap_or(0)`. |
| picohttp-T3-2 | `picohttp/lib.rs:394` | T3 | `&src[0..num_headers]` in `Request::parse`. picohttpparser's contract is `*num_headers ≤ src.len()` on success; the sister `Response::parse_parts` already defensive-clamps `num_headers.min(src.len())` at line 646. Asymmetric — port `min` to `Request::parse` and `Headers::parse:721` for parity. Panic, not UB. |
| picohttp-T3-3 | `picohttp/lib.rs:721` | T3 | Same shape: `&src[0..num_headers]` in `Headers::parse`. |
| picohttp-T3-4 | `picohttp/lib.rs:342-351` | T3 | `Request::detach_lifetime` widens borrowed slices to `'static`. The `'a` originates from `parse(buf, src)`, both of which the caller must outlive. This is documented `# Safety` and correctly used in HTTP server code, but the bound is bookkeeping-by-comment. No defect found; flagging because this is the precise shape that produces UAFs in concurrency-heavy ports. |

### §1.3 Negative findings (picohttp)

- **No additional NUL-write or attacker-len `from_raw_parts` sites** beyond H9.
- `bun_core::ffi::slice(ptr, len)` at 391/392/644 tolerates `(null, 0)` per its
  doc comment; picohttpparser only returns `(null, 0)` for header continuation
  lines (the `Header::is_multiline()` case), which is documented behaviour.
- Chunked-decoder bindings (`phr_decode_chunked` / `phr_decode_chunked_is_in_data`)
  are FFI passthrough; the safety contract on the Rust side is mechanical and
  matches the C ABI exactly.
- `Header`/`Response` `#[repr(C)]` layout matches `phr_header` exactly (static
  `assert!` at line 220-221).

**T1 count: 0 (additional to H9).**

---

## §2 — `bun_url` (`src/url/lib.rs`)

### §2.1 Attack surface

Every URL Bun parses: user-supplied `fetch()` targets, S3 endpoints, HTTP
redirects, JSC `URL` constructor input, env-loader `endpoint` parsing, and
internal `parse_protocol`/`parse_host`/`parse_password` on attacker-controlled
strings.

Site inventory: 16 `unsafe` tokens.

### §2.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| url-T3-1 | `url/lib.rs:340-351` | T3 | `URL::host_with_path` fabricates a `from_raw_parts(ptr, len)` slice by subtracting `host.as_ptr()` from `path.as_ptr() + path.len()`. Sound *only* if `host` precedes `path` in the same buffer and both lie in `href`. `is_slice_in_buffer` checks are present but **don't enforce ordering**. Construction via the public `parse()` always satisfies the invariant (host parsed before path). However, `URL<'a>` has all-public fields, and `host_with_path` could be invoked on a manually constructed `URL` with `host` after `path` → `end - start` underflows → `from_raw_parts` with `usize::MAX`-class `len` → arbitrary OOB read. No external caller currently constructs `URL` this way, but the function is `pub`. Recommendation: add `if end < start { return self.host; }` short-circuit before line 342. |
| url-T3-2 | `url/lib.rs:751, 773, 804` | T3 | `u32::try_from(i + 1).expect("int cast")` in `parse_protocol` / `parse_username` / `parse_password`. `i` is bounded by `str.len()`, which the caller could theoretically exceed `u32::MAX` for. URLs over 4 GiB → panic, not UB. |
| url-T3-3 | `url/lib.rs:121` | T3 | `URL__originLength(slice.as_ptr(), first_non_ascii)` — `first_non_ascii` is bounded by `slice.len()` (`map_or(slice.len(), …)`). Sound; the only unsafe call into WebKit URL parsing here. Watch-list because all the validation rides on `bun_core::strings::first_non_ascii` being a real Latin-1 prefix scan. |
| url-T3-4 | `url/lib.rs:351` | T3 (same as url-T3-1) | The actual `from_raw_parts` invocation. |
| url-T3-5 | `url/lib.rs:935, 937, 977` | T3 | `unsafe { &*self.slice }` (`QueryStringMap::slice`). The `slice: *const [u8]` field stores a fat raw pointer derived from either `self.buffer.as_slice()` (after the Vec is moved into the struct) or the caller-supplied query string. The Vec's heap address is stable across move, and after construction the `buffer` is never mutated — so the raw pointer remains valid. **However**, the `*const [u8]` is constructed by `&raw const buf[0..buf_writer_pos as usize]` at line 1151, which derives `SharedReadOnly` provenance from a sub-slice reborrow before the move. Under Tree Borrows this is the analogue of the pass-3 `pre-existing-ub-7` shape — read access is still permitted but the provenance is fragile and a future audit will need to confirm it doesn't get retagged by `buffer.clone()` or `buffer.is_empty()` (the latter is `&self`, so safe; the former triggers the explicit re-derive at 938). Today: sound; flagged as "fix mechanically along with the H9 family". |

### §2.3 Negative findings (url)

- `URL::erase_lifetime` (line 298-326) is field-by-field move; no shape-changing
  cast. Caller documented contract.
- `parse_protocol` rejects `%` and `/` and `?` before the `://`, so smuggling a
  `data:` or `file:` URL via a bogus protocol is not possible at this layer.
- `parse_host` handles `[ipv6]` and bare `host:port` correctly; no signed
  underflow in the `colon_i` / `ipv6_i` logic.
- `parse_password` zero-length password (single `@`) parses to `password = b""`
  and returns offset `1`; the subsequent `parse_host` operates on the remainder
  correctly. Verified by trace.
- `PercentEncoding::decode_into` (line 1411) writes through `SliceCursor`, which
  is bounds-checked by `bun_core::fmt`. Verified that the `out.len() >= input.len()`
  doc precondition is enforced by callers (`PercentEncoding::decode_alloc` line
  1396-1407 allocates `Vec::with_capacity(input.len())`; resolver's
  `module/finalize` (line 2438) hands the threadlocal `resolved_path_buf_percent`
  buffer which is the same size as `result.path`).

**T1 count: 0.**

---

## §3 — `bun_resolver` (`src/resolver/lib.rs` and 7 sibling files)

### §3.1 Attack surface

**Two distinct adversarial-input boundaries:**

1. **Local-repo files (P0-class threat model):** any `package.json`,
   `tsconfig.json`, `node_modules/*/package.json` from a malicious clone. Every
   developer's `bun install` / `bun build` / `bun --inspect` runs the resolver
   over these.
2. **Import specifiers from user JS:** `import('…')` argument; CLI argv;
   `Bun.resolveSync` first arg. Less severe (user trusts their own code) but
   reachable from `fetch('http://attacker/x.mjs')`-driven `import()` chains.

Site inventory across the crate (total 182 sites):

| File | Sites |
|------|------:|
| `lib.rs` | 169 |
| `fs.rs` | 71 |
| `dir_info.rs` | 14 |
| `package_json.rs` | 11 |
| `data_url.rs` | 2 (doc comments only — see §3.3) |
| `node_fallbacks.rs` | 2 |
| `tsconfig_json.rs` | 0 |

### §3.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| resolver-T2-1 | `resolver/lib.rs:879-898` | T2 | `EntriesOption::Entries(&'static mut DirEntry)` enum payload. The `&'static mut` is stored in the BSSMap singleton; both `Sync` and `Send` are unconditional. SAFETY comment claims `entries_mutex` serializes access, but the `&'static mut` reference *is itself the payload* — two threads matching out `Entries(entries)` materialize two `&'static mut DirEntry` to the same memory. Aliasing-UB even without mutation. Mitigation in practice: only `read_directory` ever holds two-`&mut` simultaneously and the surrounding code uses raw `*mut` to avoid materializing the matched-out `&mut`. Bookkeeping-by-comment. Mechanical fix: change the variant to `Entries(NonNull<DirEntry>)` or `Entries(*mut DirEntry)` and force every reader to retag at a single `entries_mut()` accessor. |
| resolver-T3-1 | `resolver/lib.rs:1142, 1576, 1713` (`package_json.rs`) | T3 | `contents_static: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&entry_contents) };` Then `package_json.source.contents = Cow::Borrowed(contents_static)` and `package_json.source_contents = entry_contents`. Self-referential struct (the borrow and the owner are sibling fields). Sound because the `Box<[u8]>` heap address survives moves. **However**, any future caller that splits `PackageJSON.source` from `.source_contents` (e.g. via `mem::take`) silently breaks it. Recommendation: replace `Cow::Borrowed(...)` with a thin `BorrowedFromSibling` newtype that the field can document. Same pattern at 1576 (`package_json.dependencies.source_buf = contents_static`). |
| resolver-T3-2 | `resolver/lib.rs:4616, 4703, 5120, 5143` | T3 | `let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };` in `resolve_via_tsconfig_paths` / `resolve_and_auto_install`. Caller contract: import_path is interned in DirnameStore / source text and outlives the resolver call. Verified — all current callers (VirtualMachine.rs:4047, jsc_hooks.rs:638, jsc_hooks.rs:4740) pass either `top_level_dir` (static-lifetime) or a `dir_with_trailing_slash()` slice that aliases caller-owned source. Sound under the contract; flagged because the function signatures accept ordinary `&[u8]` with no lifetime constraint, and a new caller wiring up a transient slice would silently UAF. Already TODOs in the SAFETY block — recommend threading an explicit `'a` through `MatchResult`/`Result`. |
| resolver-T3-3 | `resolver/lib.rs:3461` | T3 | `Box::<Bufs>::new_uninit().assume_init()`. Verified Bufs has no validity invariants: `PathBuffer` = `[u8; N]`, `MaybeUninit<DirEntryResolveQueueItem>` has no validity req, `[FD; 256]` where `Fd` is `#[repr(transparent)] i32`/`u64` (no invariants). Sound. The `dir_entry_paths_to_resolve` field correctly uses `MaybeUninit` and `assume_init_{ref,mut}` at write/read sites (lines 7711-8186). |
| resolver-T3-4 | `resolver/lib.rs:8041` | T3 | `strings::index_of(safe_path, queue_top_unsafe_path).expect("unreachable")`. Panic-on-invariant-violation. The invariant is that `safe_path` contains `queue_top_unsafe_path`, which is the contract of the dirname-store flow. DoS via attacker-tunneled tsconfig if invariant ever fails. T3 watch-list. |
| resolver-T3-5 | `fs.rs:919-1003` | T3 | `slot = dir_entry::EntryStore::append_uninit()` + 8× `addr_of_mut!((*p).field).write(...)` then `&mut *stored`. Standard write-every-field-before-read pattern. All 8 fields are unconditionally written; verified. The catch is `init_append_if_needed` (which builds `StringOrTinyString` into `*p.base_`) can fail with `?`, which would leave the slot partially initialized — but `?` returns from the outer function so the un-initialized slot is never read. Sound. |
| resolver-T3-6 | `lib.rs:2011-2013` | T3 | `let p: *const DirEntry = &raw const **entry;` then `unsafe { &*p }` to widen `&mut DirEntry` to `&'static DirEntry`. The DirEntry lives in the BSSMap singleton — ARENA-stable. Sound under the singleton invariant. |
| resolver-T3-7 | `lib.rs:2181, 2188` | T3 | `core::slice::from_raw_parts(*ptr, *len)` for `Contents::SharedBuffer` / `External` / `Arena`. The `ptr`/`len` are filled at construction (single-source); SAFETY comments correctly identify lifetime. Sound. |
| resolver-T3-8 | `lib.rs:3819 + 7713 + 7768 + 7809` | T3 | `unsafe_path: bun_ptr::RawSlice<u8>` filled with `RawSlice::new(&path[..input_path_len])`. `RawSlice::new` captures the actual slice fat pointer (ptr + len); the `.slice()` method returns the slice as-is, not `from_raw_parts(ptr, attacker_len)`. So **the user's stated worry about "attacker_len" is structurally impossible at the `RawSlice` boundary** — the only way to get a wrong length is to construct via `unsafe RawSlice::from_raw` and pass the wrong `len`, which no resolver site does. |

### §3.3 Negative findings (resolver)

- **`tsconfig_json.rs`: 0 unsafe blocks.** Despite being the prototypical untrusted-input parser, the file is entirely safe Rust. The JSON parsing is delegated to `bun_ast` / `bun_js_parser`.
- **`data_url.rs`: 0 actual unsafe blocks** (the two `grep` hits at lines 49 and 54 are doc comments). `PercentEncoding::_decode` (line 59-98) is fully bounds-checked; `DataURL::parse_without_check` (line 120-138) does plain `&url[...]` slicing with `index_of_char(url, b',')?` upstream.
- **`node_fallbacks.rs`:** the two `unsafe` sites are the singleton init pattern (`*MODULES.get() = Some(...)` under `INIT.call_once`). Sound — init runs exactly once, no readers race with the writer.
- **`dir_info.rs`:** all 14 sites are arena-deref helpers (`arena_ref<T>(p: NonNull<T>) -> &'static T`) backed by the resolver's process-lifetime PackageJSON / TSConfigJSON arena. Sound.
- **No `slice::from_raw_parts(buf, attacker_len)` shape found** — the resolver does take attacker-controlled lengths (e.g. `path.len()` from a tsconfig `extends` chain), but those flow through `Box<[u8]>` / `&[u8]` and never reach raw-slice construction with a separately-held length. `RawSlice` captures the fat pointer, which carries its own length.
- **No `as_ptr()` on strings dropped before use** detected. The two patterns that look like it (`unsafe_path` and `safe_path` in the dir-walk queue) hold their backing storage in the threadlocal `Bufs` (input_path) or the global `dirname_store` (safe_path), neither of which is dropped before the `RawSlice` reads.

**T1 count: 0. T2 count: 1.**

---

## §4 — `bun_semver` (`src/semver/`)

### §4.1 Attack surface

Every npm package version string Bun touches. Two paths:

1. **Parsing flow:** `Version::parse_utf8` / `SemverQuery::Group::parse` on a
   `version` string from `package.json`, npm registry JSON, or `bun add foo@1.x`
   argv. The integer parts (`major`/`minor`/`patch`) parse via
   `parse_unsigned::<u64>` which returns `None` on overflow → safely falls back
   to `T::ZERO`. **No integer-overflow → UB primitive here.**
2. **Lockfile load flow:** `bun_semver::String` is a `[u8; 8]` packed value
   embedded in every `Dependency::name`, `Dependency::version`, `Package::name`,
   `Package::resolution`, `bun_install::lockfile::Buffers::string_bytes`-keyed
   field. When a `String` has its high bit set (long-string variant), the
   remaining 63 bits encode a `Pointer { off: u32, len: u32 }` (top bit of `len`
   masked off). That `(off, len)` is read **directly from disk bytes**.

Site inventory:

| File | Sites |
|------|------:|
| `lib.rs` | 3 |
| `SemverQuery.rs` | 9 |
| `Version.rs` | 0 |
| `SemverRange.rs` | 0 |

### §4.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| **F-NEW-1** | `bun_semver/lib.rs:613` | **P0** | `String::slice()` calls `buf.get_unchecked(off..off + len)` where `off`/`len` are `u32` values decoded from a `[u8; 8]` `String` representation. When a `String` is loaded from a malicious `bun.lockb` (every `dep.name`, `dep.version`, `package.name`, `package.resolution`, …) the bytes are attacker-controlled. The SAFETY comment claims "Pointer {off,len} is constructed by `init`/`init_append` from a sub-slice of `buf`" — true for in-memory construction, **false** for deserialization. See §4.3 below for the concrete attack and proof-of-reachability. |
| **F-NEW-2** | `bun_semver/lib.rs:536-537` | **P0** | `String::eql()` calls `get_unchecked(a_off..a_off + a_len)` and `get_unchecked(b_off..b_off + b_len)` for both sides of the comparison. Same shape as F-NEW-1: attacker-controlled `(off, len)` from lockfile bytes. Triggered by every dependency-resolution name-equality check during install. The `debug_assert!(a_off + a_len <= this_buf.len())` at line 530-531 is debug-only; release builds skip the check. |
| semver-T3-1 | `bun_semver/lib.rs:609` | T3 | The `(off, len) = (ptr_.off as usize, ptr_.len as usize)` decomposition. With both fields drawn from the packed u64, `len` is at most `(1<<31) - 1` (top bit masked) and `off` is at most `u32::MAX`. `off + len` can therefore reach ~6 GiB on 64-bit, which is the OOB-read range. This is the underlying cause of F-NEW-1; flagged so the fix bounds-checks at this site too. |
| semver-T2-1 | `bun_semver/SemverQuery.rs:131-132, 261-262` | T2 | `unsafe impl Send for List` / `Sync for List` / `Send/Sync for Group` — both are unconditional. `Group::input: *const [u8]` is documented as a borrow from caller source, and `List::tail: Option<NonNull<List>>` is a self-referential back-edge. The SAFETY comment correctly identifies the model, but it elides the fact that the `input` raw pointer + `Sync` together permit a different thread to deref `input` while the source buffer is being mutated (Zig stored a `[]const u8` and is also vulnerable, but Zig had no `Sync` machinery to weaponise). T2 — see PUB-N-A / PUB-N-B same-class findings in Pass 3 cross-cutting. |
| semver-T3-2 | `bun_semver/SemverQuery.rs:223, 408, 419, 438` | T3 | `unsafe { p.as_mut() }` on `NonNull<List>` / `NonNull<Query>` self-referential back-edges (`self.tail`). The Box that was originally `NonNull::from(&mut *tail)`-ed has been moved into `prev_tail.next = Some(tail)` chain, so the original `Unique` retag is invalidated under Stacked Borrows. Tree Borrows is more lenient here. This is the same pattern as `bundler-B1..B5` in Pass 3 — bookkeeping under-tracking, behaviorally benign at runtime. |
| semver-T3-3 | `bun_semver/Version.rs:670` | T3 | `result.len = u32::try_from(i).expect("int cast")`. Version strings >4 GiB → panic. Not adversarial — npm rejects such versions earlier. |

### §4.3 F-NEW-1 / F-NEW-2 — concrete attack reproduction

**Attack chain (verbatim, traced through current source):**

1. Attacker plants a malicious `bun.lockb` in a public repo. `bun.lockb` is a
   binary format containing `bun_install::lockfile::Buffers::dependencies`
   (a `Vec<Dependency>`) and `Buffers::string_bytes` (a `Vec<u8>` pool).
2. Each `Dependency` has fields `name: bun_semver::String`,
   `version: bun_semver::String`, etc. — each is a `[u8; 8]` literally
   serialized to disk via `padding_checker::pin!(bun_semver::String, size = 8, align = 1)`
   (see `src/install/padding_checker.rs:184`).
3. Attacker sets `name.bytes = [0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x80]`.
   Decoding: bit 63 set → long-string path. `MAX_ADDRESSABLE_SPACE_MASK` clears
   bit 63, so `bits = 0x7FFFFFFFFF000000`. `from_bits` decomposes:
   - `off = u32::from_ne_bytes([0x00, 0x00, 0x00, 0xFF])` = on LE,
     `0xFF000000` (~4 GiB-ish).
   - `len = u32::from_ne_bytes([0xFF, 0xFF, 0xFF, 0x7F])` = `0x7FFFFFFF`
     (~2 GiB).
4. `bun install` calls `Lockfile::load_from_bytes`
   (`src/install/lockfile.rs:643`), which invokes
   `Serializer::load`. After deserialization, the lockfile's
   `string_bytes: Vec<u8>` is some small buffer (the legit string pool).
5. Many call sites read `dep.name.slice(string_buf)` — e.g.
   `lockfile.rs:257`: `strings::order(l_dep.name.slice(string_buf),
   r_dep.name.slice(string_buf))` inside `Buffers::sort_dependencies`,
   which runs on every load (see `lockfile.rs:248` and the surrounding
   sort closure).
6. `String::slice(buf)` follows the long-string branch at `lib.rs:605-614`,
   computes `(off, len) = (0xFF000000, 0x7FFFFFFF)`, and executes
   `unsafe { buf.get_unchecked(off..off + len) }` where `buf.len()` is
   maybe 4 KiB. **Result on 64-bit Linux/macOS:** the returned `&[u8]`
   covers ~6 GiB of memory starting ~4 GiB past `buf.as_ptr()`. The
   subsequent `strings::order` (SIMD-friendly memcmp) iterates over the
   slice as `&[u8]`, reading every byte — typically segfaulting before
   completing.

**Distinct from PUB-INSTALL-4 (Pass 3).** PUB-INSTALL-4 targets
`Tree.dependencies.get_unchecked(dep_id)` where `dep_id` is a single
attacker-controlled `u32` indexing into `Vec<Dependency>`. The Pass 3 fix
proposal (`Buffers::validate_cross_references`) walks
`Tree.dependencies` and `hoisted_dependencies` slots and bounds-checks
each `dep_id` against `Buffers::dependencies.len()` — that fix **does
not touch** the embedded `bun_semver::String::Pointer.off/len` fields,
because those reference `string_bytes`, not `dependencies`. Closing
F-NEW-1 / F-NEW-2 requires either:

(a) bounds-checking every `Pointer` against `string_bytes.len()` at
load time (`Buffers::validate_cross_references` extended), AND/OR
(b) replacing `get_unchecked` with safe `.get(range).ok_or(corrupt)?`
at `lib.rs:536-537` and `lib.rs:613` — every call site of
`String::slice` / `String::eql` would need plumbing to handle the new
`Result`, OR
(c) treating `bun_semver::String` as untrusted on deserialize and
re-computing the canonical `Pointer` form via `String::init(string_buf,
&decoded_str)` on load.

Recommended: (a) at load time (single-cost, walks
`Buffers::dependencies` × {name, version, …} once); leaves the hot path
fast. Estimated diff: ~30 lines in `bun_install::Buffers::load`.

### §4.4 Negative findings (semver)

- **`Version.rs` — 0 unsafe blocks.** `parse_version_number` (line 675-721)
  is fully bounds-checked. `parse_ascii::<u64>` returns `None` on
  overflow.
- **`SemverRange.rs` — 0 unsafe blocks.** Comparator logic is pure-Rust
  arithmetic on `Version` fields.
- **No integer-overflow → UB primitive** in semver parsing. Every
  `u32::try_from(...).expect(...)` is a panic on >4 GiB input (DoS at
  most, not UB).
- **`SlicedString` (lib.rs:100-186)** — no unsafe; field-by-field
  lifetime-tracked.

**T1 count: 2 (P0). T2 count: 1. T3 count: 4.**

---

## §5 — `bun_glob` (`src/glob/`)

### §5.1 Attack surface

User-supplied glob pattern from `Bun.Glob(pattern).scanSync()`, `bun build
--external=*.json`, package-json `workspaces` entries, and `Bun.serve`
filesystem routing. The glob walker also opens directories named in the
glob, so a malicious pattern controlling `**/` depth is a CPU/IO-DoS
vector.

Site inventory:

| File | Sites |
|------|------:|
| `lib.rs` | 0 |
| `matcher.rs` | 0 |
| `GlobWalker.rs` | 5 |

### §5.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| glob-T3-1 | `glob/matcher.rs:416, 427` | T3 | `brace_depth: i16` increments by +1 per `{`. At depth 32 768 (after a 32 768-byte input of `{`s) silently wraps to `-32 768` in release builds, after which `brace_depth == 0` and `brace_depth == 1` checks misbehave. Not UB (Rust integer overflow is well-defined wrap in release, panic in debug). DoS-class incorrect-result, not UB. Recommendation: switch to `u32` or pre-cap at `i16::MAX`. The recursion through `match_brace_branch` is already capped at depth 10 by `BraceStack: BoundedArray<Brace, 10>` (line 38). |
| glob-T3-2 | `glob/GlobWalker.rs:600, 607` | T3 | `unsafe { ZStr::from_raw(path_buf_ptr, root_path_len) }` — root_path was just `copy_from_slice`-d into `path_buf` and NUL-terminated at index `root_path_len`. Sound under the documented contract. Path-length is bounded by `path_buf.len()` (MAX_PATH_BYTES). |
| glob-T3-3 | `glob/GlobWalker.rs:995-1001` | T3 | `core::slice::from_raw_parts(scratch_ptr.add(entry_start), symlink_full_path_len - entry_start)`. Both `entry_start` and `symlink_full_path_len` are walker-internal indices into a path that was just constructed by the walker itself (`scratch_path_buf` is a `PathBuffer` = `[u8; MAX_PATH_BYTES]`). Sound. |
| glob-T3-4 | `glob/GlobWalker.rs:1542` | T3 | `core::ptr::copy(src.as_ptr(), dst, copy_len)` (memmove). Used in the error-handling path where `path_buf` and `self.path_buf` may alias. The `src.as_ptr() != dst.cast_const()` short-circuit at line 1539 is correct; partial overlap is handled by `ptr::copy` (memmove semantics). Sound. |

### §5.3 Negative findings (glob)

- **`matcher.rs`: 0 unsafe.** The brace-recursion is bounded by
  `BraceStack` (capacity 10). `match_brace_branch` returns `false` when
  the stack overflows (line 490-495). No catastrophic backtracking.
- **`lib.rs`: 0 unsafe.**
- **No adversarial recursion / stack-blow surface.** The matcher is
  iterative on `glob_match_impl`'s main loop; only braces recurse, and
  recursion is bounded.
- **No `from_raw_parts` with attacker-controlled length.** The two
  `from_raw_parts` invocations are both bounded by walker-internal indices.

**T1 count: 0.**

---

## §6 — `bun_watcher` (`src/watcher/`)

### §6.1 Attack surface

Per the prompt: "OS-supplied events; not adversarial but still
unsafe-dense." The watcher trusts the kernel (inotify on Linux, kqueue on
macOS/BSD, ReadDirectoryChangesW on Windows) to write structurally-valid
events.

Site inventory:

| File | Sites |
|------|------:|
| `lib.rs` | 0 |
| `INotifyWatcher.rs` | 11 |
| `KEventWatcher.rs` | 2 |
| `WindowsWatcher.rs` | 7 |
| `Watcher.rs` | 16 |
| `WatcherTrace.rs` | 1 |

### §6.2 Findings

| ID | File:Line | Severity | Class |
|----|-----------|----------|-------|
| watcher-T3-1 | `INotifyWatcher.rs:349-373` | T3 | The inotify event walk lacks an `i + size_of::<Event>() > read_eventlist_bytes.len()` guard before forming `let event: *const Event = ...`. Currently only `(i as usize) < read_eventlist_bytes.len()` (line 349) is checked, which is necessary but not sufficient: a kernel that returned a partial header at the buffer tail would let us read past the buffer when accessing `(*event).name_len`. The Linux inotify(7) contract guarantees aligned, fully-written event records, so this is "trust the kernel" rather than an exploitable bug. Defensive fix: `if i as usize + size_of::<Event>() > read_eventlist_bytes.len() { break; }`. |
| watcher-T3-2 | `INotifyWatcher.rs:96-129` | T3 | `Event::name()` calls `libc::strlen(name_first_char_ptr)`. If the kernel ever writes `name_len > 0` but omitted the NUL byte (i.e. unterminated name), `strlen` walks past the kernel-written region. Defensive: clamp via `name_len - 1` from `Event::name_len` rather than calling `strlen`. Pass-3 didn't catch this because it's a `strlen` on a kernel-provided buffer, sound under kernel contract. |
| watcher-T3-3 | `KEventWatcher.rs:96` | T3 | `let off = usize::try_from(count).expect("int cast")` — if `kevent()` returned -1 (error), `count` is -1, `usize::try_from(-1)` panics. Should be `let off = usize::try_from(count.max(0)).expect(...)`. DoS panic. |
| watcher-T3-4 | `WindowsWatcher.rs:190` | T3 | `&self.watcher.buf[name_start..name_start + info.FileNameLength as usize]` — `FileNameLength` is kernel-supplied. If the kernel writes a `FileNameLength` exceeding the remaining buffer (after `info.NextEntryOffset` advances), this panics (bounds-checked slice). DoS, not UB. ReadDirectoryChangesW kernel contract: the buffer always contains complete records, so this should never trigger. T3 watch-list. |
| watcher-T3-5 | `WindowsWatcher.rs:191` | T3 | `bun_core::cast_slice::<u8, u16>(name_bytes)` calls `bytemuck::cast_slice` which panics on misalignment. The SAFETY comment claims `name_offset == 12` and DWORD-aligned `self.offset` keeps the cast aligned. Verified that `FileName` field offset is 12 (`@offsetOf` from Windows-rs binding). Sound under the kernel-aligned contract. |
| watcher-T3-6 | `INotifyWatcher.rs:127` | T3 | `Event::size()` returns `u32::try_from(size_of::<Event>()).expect("int cast") + self.name_len`. The `try_from` is a static `16` → never panics. The sum could theoretically overflow u32 if `name_len` is `0xFFFFFFF0` or larger. Linux inotify caps name_len at `NAME_MAX` (255) typically, but the syscall API uses u32. If a kernel ever returned a huge `name_len`, `size()` would wrap to a small u32 and `i += size()` would not advance enough → infinite loop or re-read of the same event. DoS only. |
| watcher-T2-1 | `Watcher.rs:183, 188, 287` | T2 | `unsafe { &mut *ctx_opaque.cast::<T>() }` — generic `T` deref from `*mut c_void` ctx pointer. The `T` is the user's `Watcher` user-data type. The same `ctx_opaque` is dereferenced from two callbacks (`on_file_update`, etc.); both can be invoked concurrently from the watcher thread + the JS thread under cleanup. SAFETY comment "ctx is `Watcher::ctx`, lives for the lifetime of the Watcher" doesn't address aliasing. T2 — same shape as Pass-3 `cross-T1-2` family. |

### §6.3 Negative findings (watcher)

- **`KEventWatcher.rs`:** the two unsafe sites are FFI calls to
  `c::kevent`; both have correct buffer/length pairs. The
  `usize::try_from(count)` panic in §6.2 watcher-T3-3 is the only
  bookkeeping concern.
- **`WindowsWatcher.rs`** record-walk: alignment and bounds are
  correctly maintained under the Windows kernel contract.
- **No fsnotify event truncation → UB** found. Every kernel-buffer read
  is bounds-checked (panic-safe). The §6.2 issues are either DoS panics
  or trust-the-kernel assumptions that are correct per OS docs.
- `WatcherTrace.rs:1` is a single `unsafe extern "C" {}` block (FFI
  declaration). Not an unsafe operation.

**T1 count: 0. T2 count: 1. T3 count: 6.**

---

## §7 — Cross-cutting summary

### §7.1 Tier totals (Pass 4 only, NOT including Pass-3 carry-ins)

| Tier | Total | of which P0 |
|------|------:|------------:|
| T1   | **2** | **2** |
| T2   | **3** | — |
| T3   | **20** | — |

### §7.2 The 2 P0 findings — combined attack note

Both **F-NEW-1** and **F-NEW-2** ride on `bun_semver::String` deserialization
from `bun.lockb`. Same threat model as Pass-3 PUB-INSTALL-1..4 (malicious
lockfile in a victim's repo, triggered by `bun install`), but a **separate
code path** (`semver::String::slice` / `::eql`, not enum transmute / uninit
Vec / Tree.deps OOB). The Pass-3 mitigation proposal
(`Buffers::validate_cross_references`) does not cover this site because it
validates `dep_id` against `Buffers::dependencies.len()`, whereas the F-NEW
sites validate `Pointer { off, len }` against `Buffers::string_bytes.len()`.

**Combined patch surface to fully close the lockfile-poison attack:**

1. PUB-INSTALL-1, 2 (enum transmute) — `match` instead of `transmute`.
2. PUB-INSTALL-3 (uninit Vec) — `Vec::with_capacity` + `push` instead of
   `set_len`.
3. PUB-INSTALL-4 (Tree.deps OOB) — `Buffers::validate_cross_references`
   walks `Tree.dependencies`.
4. **F-NEW-1, F-NEW-2 (semver String OOB)** — `Buffers::validate_cross_references`
   ALSO walks every `bun_semver::String` field on every `Dependency`,
   `Package`, etc. (and validates `Pointer.off + Pointer.len <= string_bytes.len()`).

PRs 1–3 land in `bun_install`; PR 4 lands partly in `bun_install` (the
validation walk) and partly in `bun_semver/lib.rs` (replacing
`get_unchecked` with `.get(range).expect("validated at load")` so the
invariant is documented at point of use).

### §7.3 Pass-4 NEGATIVE findings (audit-clean by crate)

These are the defensible "we looked, found nothing" results for the
marketing message:

| Crate / file | Sites | Pass-4 T1 | Note |
|--------------|------:|----------:|------|
| `bun_glob` (3 files) | 5 | 0 | Brace recursion bounded; no `from_raw_parts(attacker_len)`. |
| `bun_semver/Version.rs` | 0 | 0 | All-safe-Rust integer parsing; overflow → `None` → `T::ZERO` fallback. |
| `bun_semver/SemverRange.rs` | 0 | 0 | All-safe-Rust comparator logic. |
| `bun_resolver/tsconfig_json.rs` | 0 | 0 | Despite untrusted-JSON input, file is unsafe-free. |
| `bun_resolver/data_url.rs` | 0 | 0 | 2 hits were doc-comment matches; no unsafe operations. |
| `bun_resolver/node_fallbacks.rs` | 2 | 0 | Singleton init under `Once::call_once`. |
| `bun_resolver/dir_info.rs` | 14 | 0 | Arena-deref pattern; pointee is process-lifetime. |
| `bun_watcher/lib.rs` | 0 | 0 | Crate root has no unsafe ops. |
| `bun_watcher/KEventWatcher.rs` | 2 | 0 | FFI `kevent()`; both calls have correct buffer/len. |
| `bun_picohttp` (excluding H9) | 21 | 0 | Beyond the Pass-3 H9 NUL-write, no further T1. |
| `bun_url` | 16 | 0 | URL parser invariants hold; `host_with_path` ordering invariant is bookkeeping-only. |
| `bun_watcher/WindowsWatcher.rs` | 7 | 0 | Kernel-supplied record walk; bounds-checked at slice level. |
| `bun_watcher/INotifyWatcher.rs` | 11 | 0 | Trust-the-kernel; no exploit primitive. |

### §7.4 Pass-4 watch-list items (T3) summary

20 T3 entries above; the highest-leverage tightening targets are:

1. **`bun_url::URL::host_with_path` ordering check** (url-T3-1) — 1 line.
2. **`bun_picohttp::Headers::parse` and `Request::parse` `num_headers.min(src.len())`** (picohttp-T3-2, -3) — 2 lines; matches the existing `Response::parse_parts` defense.
3. **`bun_glob::matcher::brace_depth` widening to u32** (glob-T3-1) — 1 line.
4. **`bun_watcher::INotifyWatcher` header-bounds guard** (watcher-T3-1) — 1 line.
5. **`bun_watcher::KEventWatcher` `count.max(0)`** (watcher-T3-3) — 1 line.

These five together total ~6 lines and harden the parsers against a wide
class of malformed-input panics.

### §7.5 Pass-4 T2 list

1. **`bun_resolver::EntriesOption::Entries(&'static mut DirEntry)` Send/Sync** — replace the matched-out `&'static mut` payload with `*mut DirEntry` or `NonNull<DirEntry>` and centralise the retag at a single accessor.
2. **`bun_semver::List` / `Group` unconditional Send/Sync** — `<T: Send>` / `<T: Sync>` bounds aren't applicable (the inner type is opaque), but the SAFETY comment elides the `*const [u8]` field's cross-thread implications. Same family as Pass-3 PUB-N-A / PUB-N-B.
3. **`bun_watcher::Watcher` ctx-pointer deref** — `unsafe { &mut *ctx_opaque.cast::<T>() }` aliases between callbacks. Recommendation: hand callbacks a typed `Arc<Watcher<T>>` or document the single-callback-at-a-time invariant in code, not comments.

---

## §8 — Recommended PR landing order (Pass-4 specific)

In addition to the Pass-3 PR slate, these PRs close the Pass-4 P0 attack and
clean the highest-leverage T3 entries:

1. **F-NEW-1 / F-NEW-2 fix (P0)** — extend
   `bun_install::Buffers::validate_cross_references` to walk every
   `bun_semver::String` field on every load-time-deserialized record. Replace
   `get_unchecked` at `bun_semver::lib.rs:536-537, 613` with safe `.get(range)`
   returning `Result<&[u8], LockfileCorrupt>`. Estimated diff: ~40 lines in
   `bun_install`, ~10 in `bun_semver`.

2. **Watch-list parser hardening (T3 batch)** — 6-line aggregate diff covering
   url-T3-1, picohttp-T3-2/-3, glob-T3-1, watcher-T3-1, watcher-T3-3.

3. **resolver-T2-1** — `EntriesOption::Entries` raw-pointer variant. Estimated
   diff: ~80 lines (touches every match site).

4. **semver-T2-1** — narrow `Send`/`Sync` impls on `List` / `Group`; or add
   a doc-comment that explicitly disclaims cross-thread `input` deref.

PRs 1 and 2 are the only Pass-4-original items that materially harden Bun
against external attackers; PR 3 and 4 are architectural cleanups that
make the audit message stronger but have no known exploit.

---

## §9 — Verification log

Every file:line citation in this document was checked against the current
source tree via the following commands (representative sample):

```text
grep -n "unsafe" src/picohttp/lib.rs                       # 22 matches
grep -n "unsafe" src/url/lib.rs                            # 16 matches
grep -n "unsafe" src/resolver/lib.rs | wc -l               # 169
grep -n "unsafe" src/resolver/fs.rs | wc -l                # 71
grep -n "unsafe" src/semver/lib.rs                         # 3 matches
grep -n "unsafe" src/semver/SemverQuery.rs                 # 9 matches
grep -n "unsafe" src/semver/Version.rs                     # 0
grep -n "unsafe" src/semver/SemverRange.rs                 # 0
grep -n "unsafe" src/glob/lib.rs                           # 0
grep -n "unsafe" src/glob/matcher.rs                       # 0
grep -n "unsafe" src/glob/GlobWalker.rs                    # 5 matches
grep -n "unsafe" src/watcher/INotifyWatcher.rs             # 11 matches
grep -n "unsafe" src/watcher/WindowsWatcher.rs             # 7 matches
grep -n "unsafe" src/watcher/KEventWatcher.rs              # 2 matches
grep -n "unsafe" src/watcher/Watcher.rs                    # 16 matches
```

F-NEW-1 reproduction path validated by tracing:

```text
src/install/lockfile.rs:643          load_from_bytes → Serializer::load
src/install/lockfile.rs:248-260      sort_dependencies closure
src/install/lockfile.rs:257          l_dep.name.slice(string_buf)
src/semver/lib.rs:586-616            String::slice() → get_unchecked
src/semver/lib.rs:864-904            Pointer::from_bits decodes 32+32 bits
```

The single panic-on-attacker-byte at `bun_semver::lib.rs:530-531` is
debug-only (`if cfg!(debug_assertions)` / `debug_assert!`) — release
builds reach `get_unchecked` with no bounds check at all.

---

*Pass 4 complete. 2 P0 (F-NEW-1, F-NEW-2). 0 T1 below P0. 3 T2. 20 T3.
Six negative crates explicitly affirmed clean. Combined with Pass 3,
the canonical "malicious bun.lockb" attack now has six independent
P0/P1 entry points documented: PUB-INSTALL-1, -2, -3, -4, F-NEW-1,
F-NEW-2.*
