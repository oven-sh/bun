# Phase 1 Inventory — Section I: runtime-dns-jsc

Run: `2026-05-15-exhaustive`. Scope: 4 files in `src/runtime/dns_jsc/` —
`mod.rs`, `dns.rs` (6 026 LOC; the bulk), `cares_jsc.rs` (~857 LOC),
`options_jsc.rs` (~280 LOC). All four are `bun_runtime` crate members.

Mapper tallies (audited base `origin/main@4d443e5402`, post prior-audit branch `23e23b6d29`):

| file              |    LOC | unsafe-keyword sites | unsafe blocks | unsafe fn | unsafe impl | unsafe trait | unsafe extern blocks | `#[unsafe(…)]` attrs | SAFETY: comments |
| ----------------- | -----: | -------------------: | ------------: | --------: | ----------: | -----------: | -------------------: | -------------------: | ---------------: |
| `mod.rs`          |     36 |                    0 |             0 |         0 |           0 |            0 |                    0 |                    0 |                0 |
| `dns.rs`          |  6 026 |                  258 |           206 |        21 |           2 |            0 |                    3 |                    9 |              185 |
| `cares_jsc.rs`    |    857 |                   38 |            35 |         1 |           1 |            1 |                    0 |                    0 |               38 |
| `options_jsc.rs`  |    280 |                    2 |             2 |         0 |           0 |            0 |                    0 |                    0 |                2 |
| **Section I**     |  7 199 |              **298** |       **243** |    **22** |       **3** |        **1** |                **3** |                **9** |          **225** |

Independent normalised-site count (Phase-0 definition: `unsafe { … }` blocks +
`unsafe fn` headers + `unsafe impl` rows + `unsafe trait` rows + `unsafe
extern "C" { … }` block headers + `#[unsafe(...)]` attributes) =
243 + 22 + 3 + 1 + 3 + 9 = **297 sites** vs prior `phase0_partition.json`
**257** → **+40 (≈ +16 %)**. Per-file prior subtotals reproduce 257 exactly
(`dns.rs` 219 + `cares_jsc.rs` 36 + `options_jsc.rs` 2). The +40 delta lands
almost entirely in `dns.rs` and reflects continued Zig→Rust ports of (a) the
Windows libuv `UvDnsPoll` path (`on_dns_poll_uv` / `on_close_uv` / extra
`unsafe { (*poll).…}` walks), (b) the `export_host_fn!` shim cluster at
`:5972-6024` (17 `#[unsafe(export_name)]` + per-shim `unsafe { &*g }` /
`unsafe { &*f }` derefs, growing the count without adding new aliasing
hazard), and (c) per-block SAFETY tightening that split a few prior
multi-deref blocks into per-line `unsafe` for finer attribution.
SAFETY-comment density is **225 / 297 ≈ 76 %** — the shortfall is the
`unsafe extern "C" { … }` block headers (3, libinfo + libuv-getaddrinfo-send-reply
+ usockets opaque DNS shim), the `unsafe trait CAresLinked` row in `cares_jsc.rs`,
the 3 `unsafe impl` rows (`Send for SendPtr<T>`, `Send for GlobalCache`,
`unsafe impl CAresLinked for $t` macro-stamped), and a handful of in-loop
`unsafe { (*p).next() }` walks that share the per-walker `// SAFETY:`
introducer one block earlier.

Macro-generated share: the `cares_jsc.rs` `impl_cares_linked!` macro stamps
**5** `unsafe impl CAresLinked for …` rows (one each for `struct_ares_caa_reply`,
`struct_ares_srv_reply`, `struct_ares_mx_reply`, `struct_ares_txt_reply`,
`struct_ares_naptr_reply`). The `dns.rs` `impl_cares_record_type!` macro
stamps **9** `RAW_CALLBACK` `const` entries each typed as
`unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int)` plus a
companion `unsafe fn destroy` (= 18 stamped unsafe-keyword sites, but every
expansion lands within a single `unsafe` block so they don't multiply the
normalised count). The `export_host_fn!` macro at `:5972-5996` stamps **17**
`#[unsafe(export_name)]` + matching `pub unsafe extern "sysv64" fn __shim` /
`pub unsafe extern "C" fn __shim` pairs (= ~34 keyword sites, 17 normalised
sites). Conservative count: 5 (CAresLinked) + 18 (impl_cares_record_type) +
17 (export_host_fn) = **~40 macro-generated unsafe sites** (≈ 13 % of the
297 normalised total); the remainder are source-direct.

## Selected high-signal sites

| file:line | site_kind | bucket(s) | safety_status | macro_status | prior_id | notes |
|---|---|---|---|---|---|---|
| `dns.rs:107` | `unsafe impl<T> Send for SendPtr<T>` | 7 (Data races) + 1 (Aliasing) | PRESENT_WEAK ("synchronization is provided by `global_cache()`") | source-direct | S-prior batch | Private raw-pointer Send wrapper; current source constructs only `SendPtr<Request>` at `dns.rs:3080` for the threaded DNS workpool (Send via `GlobalCache` lock). Mirror of Section Q's `Resolved`/`InitOpts`/`HpackHandle` Send-wrappers, but the generic definition is wider than its documented invariant. Phase 2 hardening candidate: narrow to `SendRequestPtr` / `SendPtrLockedBy<Request, GlobalCacheLock>`. Do not count as EXP-019-equivalent public safe-API UB without a second instantiation or safe escape. |
| `dns.rs:2386` | `unsafe impl Send for GlobalCache` | 7 (Data races) | PRESENT_WEAK ("every `*mut Request` stored here is a heap allocation transferred between threads only while `GLOBAL_CACHE` is locked; no thread-affine data hangs off it") | source-direct | S-prior batch | The Section-I cross-thread anchor. `GlobalCache: { cache: [*mut Request; 256], len }` lives behind a `bun_threading::Guarded<GlobalCache>` (`:2487`). The `*mut Request` payload itself owns a `notify: Vec<DNSRequestOwner>` whose `DNSRequestOwner::Quic(*mut bun_http::H3::PendingConnect)` variant ties the cross-thread handoff back to Section Q's `PendingConnect.rs:179` `unsafe impl Send for Resolved` chain. **NOT a `Guarded<Vec<*mut T>>`-shaped per-call handoff** like Section Q — instead a global mutex-guarded fixed-size cache of `*mut Request`, plus a `notify_threadsafe` per-request closure list. |
| `cares_jsc.rs:236-256` | `unsafe trait CAresLinked` + 5× macro-stamped `unsafe impl CAresLinked for $t` | 11 (Library invariant — intrusive list contract) + 21 (FFI re-entry) | PRESENT_STRONG (trait doc: "impls must return null or a valid pointer into the same c-ares-owned linked list"; per-row "`.next` is the c-ares-owned intrusive list pointer") | macro-generated (`impl_cares_linked!`) | S-006246..S-006250 batch | Replaces 5× hand-rolled Zig two-pass count→walk; the only new unsafe surface added by the rewrite. Trait bound is `unsafe` because all the bucket-21 contract lives in the C side. |
| `dns.rs:3140` | `#[unsafe(no_mangle)] pub fn __bun_dns_prefetch(loop_, hostname, len, port)` | 2 (Provenance) + 21 (FFI) + 11 (Library invariant — crate-cycle workaround) | PRESENT_STRONG ("caller passes a NUL-terminated `[u8; len]` live for the call") | source-direct | n/a | Link-time crate-cycle workaround: the lower-tier `bun_dns` crate declares `extern "Rust" fn __bun_dns_prefetch` so `bun_install` can prefetch registry hostnames without a `bun_install → bun_runtime` cycle. Same shape as Section Q's `Bun__addrinfo_registerQuic` (and that one is also here at `dns.rs:3265-3271`). |
| `dns.rs:3209` (and `Bun__addrinfo_freeRequest:3255`) | `pub(super) extern "C" fn freeaddrinfo(req: *mut Request, err: c_int)` | 8 (Custom alloc/free — C lifetime) + 7 (Data races) + 21 (FFI re-entry) | PRESENT_STRONG (refcount decrement under `global_cache().lock()`; debug-assert refcount > 0) | source-direct | n/a | Cross-thread `Request` reclaim. uSockets / H3 caller invokes from any thread; the lock-then-decrement-then-conditional-`Request::deinit` ordering is the chokepoint that keeps the unsafe-impl-Send-for-GlobalCache invariant whole. |
| `dns.rs:3234-3271` (`Bun__addrinfo_set/cancel/get/freeRequest/getRequestResult/registerQuic`) | 6× `#[unsafe(no_mangle)] pub extern "C" fn Bun__addrinfo_*` | 21 (FFI) | PRESENT_WEAK (mostly inherit doc from internal `us_*` wrapper above) | source-direct | n/a | C-callable DNS API surface for uSockets and H3 quic. Each thin-wraps an `us_*` fn defined immediately above. Pure thin-shim layer — no new aliasing hazard, but the `#[unsafe(no_mangle)]` attribute is what counts toward the +40 delta. |
| `dns.rs:2487-2492` | `static GLOBAL_CACHE: bun_threading::Guarded<GlobalCache>` + `fn global_cache() -> &'static …` | 7 (Data races) | n/a (no `unsafe` keyword on the static itself; the unsafety lives on `unsafe impl Send for GlobalCache` above) | source-direct | n/a | The actual cross-thread synchronisation point for the entire DNS subsystem. Every Section-I cross-thread crossing (`work_pool_callback` → `after_result` → `notify_threadsafe`) is serialised by this lock. |
| `dns.rs:2544-2547` | `unsafe extern "C" { fn us_internal_dns_callback(…); fn us_internal_dns_callback_threadsafe(…); }` | 21 (FFI re-entry) + 7 (Data races) | PRESENT_WEAK (one paragraph just above: `#[allow(improper_ctypes)]` "`Request` is passed opaquely to usockets and round-tripped back into Rust; the C side never dereferences fields, so layout is irrelevant") | source-direct | n/a | The other half of the cross-thread handoff — `_threadsafe` variant is called from the work pool (DNS resolver thread), normal variant from the JS thread; uSockets internally routes the message to the right loop. |
| `dns.rs:2549-2604` | `enum DNSRequestOwner { Socket(*mut ConnectingSocket), Prefetch(*mut Loop), Quic(*mut bun_http::H3::PendingConnect) }` + `notify/notify_threadsafe` | 1 (Aliasing — raw ptr enum payload) + 7 (Data races) + 11 (Library invariant — owner-thread routing) | mixed (notify call sites carry inline `// SAFETY:` for each variant) | source-direct | n/a | The per-Request subscriber list. Lives inside the `GlobalCache`-protected `Request.notify: Vec<DNSRequestOwner>`. **This is the Section-Q `PendingConnect.rs:179` cross-thread handoff pattern's DNS-side counterpart** — but the storage shape is different: here it's an unbounded `Vec<*mut …>` per Request, not a `Guarded<Vec<*mut T>>` head with single drain. |
| `dns.rs:417-441` | `extern "C" fn on_raw_libuv_complete(*mut libuv::uv_getaddrinfo_t)` | 21 (FFI re-entry) + 1 (Aliasing — `*mut Self` recovered from `(*uv_info).data`) | PRESENT_STRONG (libuv contract documented at `:1623-1650` on the cousin `on_libuv_complete`) | source-direct | n/a | Windows-side libuv getaddrinfo completion. Lives in `BackendLibInfo` cluster. |
| `dns.rs:765-778` | `unsafe extern "C" fn raw_callback(ctx, status, timeouts, buffer, buffer_length)` | 21 (FFI re-entry) | PRESENT_WEAK (forwarding shim to `T::RAW_CALLBACK`) | source-direct | n/a | The `c_ares::ReplyHandler` template's C-ABI trampoline for `ResolveInfoRequest<T>`. One concrete instantiation per record type via `impl_cares_record_type!` macro (9 record types). |
| `dns.rs:962-1025` | `pub unsafe fn process_resolve(this: *mut Self, …)`, `on_complete(this: *mut Self, …)`, `destroy(this: *mut Self)` — `ResolveInfoRequest<T>` cluster | 1 (Aliasing — `*mut Self` re-entrant pattern) + 21 (FFI re-entry) | PRESENT_STRONG (each `# Safety` doc on the `pub unsafe fn` signature) | source-direct | n/a | **R-2 / EXP-012-shape callback pattern** — `*mut Self` discipline so c-ares re-entry into the body doesn't form a `&mut *self` that the call may free. Mirror cluster at `:1752-1812` (`CAresNameInfo`), `:1880-1955` (`CAresReverse`), `:2015-2127` (`CAresLookup<T>`). |
| `dns.rs:1485-1526` | `pub extern "C" fn get_addr_info_async_callback(status, addr_info, arg)` | 21 (FFI re-entry) + 1 (Aliasing) + 8 (Custom alloc/free — `heap::take(this)` consumes the Request) | PRESENT_STRONG (multi-paragraph: cites why `*mut Self` not `&mut self`, recovers `(*request).head` by value via `*bun_core::heap::take(this)` to avoid double-Drop) | source-direct | n/a | macOS libinfo completion callback. **Best-in-section SAFETY** documentation — explicitly notes the alternative `ptr::read + heap::take` is double-Drop UB. |
| `dns.rs:1591-1620` | `pub fn on_cares_complete(this, err, timeout, result)` | 21 (FFI re-entry) + 1 (Aliasing) + 8 (Custom alloc/free) | PRESENT_STRONG (same as `get_addr_info_async_callback` above; copies the same `bun_core::heap::take` discipline) | source-direct | n/a | c-ares completion path; cousin to the libinfo path above. |
| `dns.rs:4694-4732` | Windows: `pub extern "C" fn on_dns_poll_uv(watcher, status, events)` + `pub unsafe extern "C" fn on_close_uv(watcher)` | 21 (FFI re-entry) + 1 (Aliasing — `&Resolver` recovered from `(*poll).parent`) + 8 (Custom alloc/free in `on_close_uv`) | PRESENT_STRONG (multi-line SAFETY citing libuv's "handle outlives this callback" guarantee + `ref_()`/`_deref` bracketing) | source-direct | n/a | Windows c-ares-over-libuv socket-state callback. Bracketed by `Self::ref_scope(parent)` to keep the Resolver alive across `Channel::process` re-entry. |
| `dns.rs:4746-4766` | `pub fn on_dns_poll(&self, poll: &mut FilePoll)` (POSIX FilePoll callback) | 21 (FFI re-entry) + 1 (Aliasing — R-2 `&self` discipline) | PRESENT_STRONG (multi-paragraph doc explains the R-2 choice: "every mutable field UnsafeCell-backed, LLVM cannot cache `ref_count` across the FFI call — the structural fix for the previously ASM-verified PROVEN_CACHED miscompile that needed `black_box` laundering under `&mut self`") | source-direct | n/a | **Best-in-section R-2 documentation.** The POSIX c-ares poll callback. Section-Q `cares_sys/c_ares.rs:792-797` `on_sock_state` is the mirror call site one layer down. |
| `dns.rs:4768-4934` | `pub fn on_dns_socket_state(&self, fd, readable, writable)` | 21 (FFI re-entry) + 1 (Aliasing) + 8 (libuv handle lifecycle) | PRESENT_STRONG (per-`unsafe`-block SAFETY for each libuv call, including `uv_close → on_close_uv` ownership transfer) | source-direct | n/a | c-ares's "socket state changed" upcall — registers/unregisters libuv polls (Windows) or POSIX FilePolls. The poll-map lifecycle owner. |
| `dns.rs:3617-3645` | `#[bun_jsc::JsClass(name = "DNSResolver")] pub struct Resolver { ref_count, channel: Cell<Option<*mut c_ares::Channel>>, vm: BackRef<VirtualMachine>, polls: JsCell<PollsMap>, event_loop_timer: JsCell<EventLoopTimer>, pending_*_cache_cares: JsCell<…> }` | 1 (Aliasing — R-2 UnsafeCell-backed) + 21 (FFI re-entry) | PRESENT_STRONG (multi-paragraph: "R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy)") | source-direct | n/a | The whole `Resolver` type's `JsCell`/`Cell` interior-mutability choice is the Section-Q-equivalent of opaque-ZST for c-ares Channel: it neutralises Stacked-Borrows protector UB across re-entrant FFI without `black_box` laundering. |
| `dns.rs:3935-3938` | `pub unsafe fn deref(this: *mut Self)` (Resolver) + `unsafe fn ref_scope(this: *mut Self) -> ResolverRefGuard` at `:3952` | 1 (Aliasing) + 8 (Custom alloc/free) | PRESENT_STRONG (`ref_scope` Drop SAFETY at `:3654` cites scoped-ref invariant) | source-direct | n/a | The Resolver ref/deref pair + RAII `ResolverRefGuard`. Mirrors Section K's `Strong`/`Weak` thread-affinity story, but Resolver is `bun_ptr::IntrusiveRc` not `Strong` (no `unsafe impl !Send` marker; Section-K Strong-affinity audit lessons apply here too). |
| `dns.rs:2615-2695` | `fn process_results(info: *mut AddrInfo) -> Box<[ResultEntry]>` | 5 (Uninit — MaybeUninit slot-by-slot init + assume_init at end) + 1 (Aliasing — `entry.info.ai_next = &raw mut right[0].info`) | PRESENT_STRONG (per-slot SAFETY citing "every slot 0..count was written above" + cross-platform addr-init contract: "Windows getaddrinfo may return non-null ai_addr with families other than AF_INET/AF_INET6; zero `addr` for those rather than leaving it uninit") | source-direct | n/a | Re-orders + repacks libc addrinfo list into a single `Box<[ResultEntry]>` allocation that the C side borrows via `RequestResult.info`. **One of the cleanest MaybeUninit patterns in the section** — explicit "every byte written" justification for `assume_init`. |
| `dns.rs:4244-4275` | `unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) }` (4 sites: generic `get_key` + host/addr/nameinfo monomorphisations) | 8 (Custom alloc/free — slot ownership transfer) + 5 (Uninit — paired with `used.unset(index)`) | PRESENT_STRONG (cites `used` bit invariant: "`used` bit is set ⇒ slot was initialized by `get_or_put_into_resolve_pending_cache` + `*Request::init`. `PendingCacheKey` is POD; reading by value then unsetting the bit hands ownership of the slot back to the HiveArray (Zig's `= undefined`)") | source-direct | n/a | The pending-cache slot drain. **POD-only contract** — if `PendingCacheKey` ever gains a `Drop` impl, these become double-Drop sites. Phase 2 should add a static-assert `static_assertions::assert_not_impl_any!(PendingCacheKey: Drop)`. |
| `dns.rs:5972-5996` (macro) + `:5998-6024` (19 invocations) | `export_host_fn!` macro: `#[unsafe(export_name = $name)] pub unsafe extern "sysv64" fn __shim(g, f)` / `pub unsafe extern "C" fn __shim(g, f)` | 21 (FFI re-entry) | PRESENT_WEAK (per-shim "JSC guarantees both pointers are live for the call") | macro-generated | n/a | C++→Rust JS-host-function shims. Per-shim `unsafe { &*g }` + `unsafe { &*f }` to materialise references for the wrapped fn. **Mirrors Section B's `jsc_host_abi!` ABI handshake** — uses `extern "sysv64"` on Windows-x64 to match C++ `SYSV_ABI`. |
| `cares_jsc.rs:36/46/55/60/83/92/103/111` etc. (~25 sites) | `unsafe { bun_core::ffi::cstr(this.h_name).to_bytes() }`, `unsafe { (*this.h_aliases.add(count as usize)).is_null() }`, `unsafe { *(addr as *const [u8; 16]) }` | 2 (Provenance — `add` walk over c-ares-owned NULL-terminated array) + 4 (Validity — pointer-to-array materialisation) + 21 (FFI re-entry) | mixed (most have per-line `// SAFETY:` citing c-ares NULL-terminated array invariant; the `addr as *const [u8; 16]` casts cite "≥16 bytes for AF_INET6" with no alignment justification because `[u8; N]` has align 1) | source-direct | S-006220..S-006245 batch | The classic c-ares `struct_hostent` walker. Bounds and NULL-termination contract come from the c-ares API; alignment is trivial because the target is `[u8; N]`. |
| `cares_jsc.rs:258-284` | `fn cares_list_to_js_array<T: CAresLinked>(head, global, to_js)` | 1 (Aliasing — `&mut *p` walk over intrusive list) + 21 (FFI re-entry) | PRESENT_STRONG (per-block SAFETY citing `CAresLinked` trait invariant; two-pass count→walk) | source-direct | n/a | The generic two-pass walker that replaces 5× hand-rolled Zig per-record-type bodies. |
| `options_jsc.rs:201-204` | `unsafe { &*addrinfo }` (in `result_any_to_js`) and `options_jsc.rs:262` `unsafe { current.as_ref() }` (in `addr_info_to_js_array`) | 2 (Provenance) + 21 (FFI — getaddrinfo linked-list walk) | PRESENT_STRONG (`addrinfo is a non-null *mut libc::addrinfo owned by the resolver; valid for the duration of this call`; `current walks the getaddrinfo(3) singly-linked result list; each node and its ai_next are valid until freeaddrinfo is called by the owner`) | source-direct | S-006477/S-006478 | The libc `addrinfo` linked-list walker. Same shape as `cares_jsc.rs` `cares_list_to_js_array` but for libc-allocated lists. |
| `dns.rs:2268-2270` | `unsafe extern "C" { fn getaddrinfo_send_reply(port: mach_port, reply: GetaddrinfoAsyncHandleReply) -> bool; }` | 21 (FFI) | PRESENT_STRONG (caller-side wrapper at `:1264-1289` documents the libinfo contract) | source-direct | n/a | macOS libinfo-private symbol. The function-pointer arg `reply` is the dlsym'd `getaddrinfo_async_handle_reply`. |

(Full per-line list reproduced from `.unsafe-audit/unsafe-inventory.jsonl`
filtered to the 4 Section-I files — 257 prior rows; the ~40 new rows are the
+40 delta enumerated in the table above plus the `export_host_fn!` shim
cluster which prior audit IDs `S-006xxx` does not yet cover.)

## Notes

- **`mod.rs` is 36 lines of pure re-exports** — `pub use dns_body::{…}` over the
  real `dns.rs` body; 0 unsafe. Same shape as `bun_url_jsc/lib.rs` in Section Q.
- The Section-K `Strong`/`Weak` thread-affinity audit lesson applies indirectly:
  `Resolver` uses `bun_ptr::IntrusiveRc` (not `Strong`), and every JS-exposed
  method takes `&self` (R-2 discipline). The `ResolverRefGuard` RAII at
  `dns.rs:3650-3658` is the section's centralised `ref_()`/`deref()` chokepoint.
- The `cares_jsc.rs:25-66` `hostent_to_js_response` walker, the `:69-151`
  `hostent_with_ttls_to_js_response` walker, and the `:507-651`
  `any_reply_to_js` 10-variant dispatcher are the densest unsafe clusters in
  Section I outside of `dns.rs`. All three carry per-line `// SAFETY:` density.
- `dns.zig` (28 KB sibling at `dns_jsc/dns.zig`) is the porting reference; the
  Rust file is ~7× longer because the Rust port (a) inlines the `comptime`
  monomorphisations of `ResolveInfoRequest`/`CAresLookup` as 9 separate
  `impl_cares_record_type!` macro invocations and (b) carries multi-line SAFETY
  prose where Zig had only one-line comments.
- The 9 `RAW_CALLBACK` consts under `impl CAresRecordType` (`dns.rs:3320`,
  `:3413`, `:3453`, `:3496`, etc.) all point at the **same**
  `c_ares::ares_reply_callback::<T, ResolveInfoRequest<T>>` template
  instantiation — the entire c-ares reply path goes through that one
  trampoline. Phase 2 candidate for a Miri-driven validation of the
  `*mut c_void` → `*mut ResolveInfoRequest<T>` re-cast inside that
  trampoline.
