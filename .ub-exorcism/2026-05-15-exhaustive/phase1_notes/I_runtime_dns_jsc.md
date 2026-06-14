# Section I: runtime-dns-jsc

## Purpose

The JSC bridge for Node.js `dns`/`Bun.dns` plus the **process-wide internal DNS
cache used by the uSockets `connect` path and HTTP/3 `PendingConnect`**. Three
back-ends are coordinated here: (1) c-ares (cross-platform), (2) macOS libinfo
async getaddrinfo (mach-port driven), (3) libc blocking `getaddrinfo` on a
workpool. The bridge converts c-ares reply structs (`hostent`, `srv`, `caa`,
`mx`, `naptr`, `soa`, `txt`, `any`, `nameinfo`, `AddrInfo`) into `JSValue`
objects, exports `Bun__DNS__*` and `Bun__addrinfo_*` C symbols for C++/uSockets
consumers, and houses the `Resolver` JSC class that hosts the c-ares Channel
+ pending-cache + libuv/FilePoll registration for c-ares socket events.

`src/runtime/dns_jsc/` is the **JSC bridge** side; the *sys side (c-ares
bindings + the raw `Channel` type) lives in `src/cares_sys/` and is audited
in **Section Q**. Section Q's `c_ares.rs:792-797 on_sock_state` is the
mirror of Section I's `dns.rs:4746-4766 on_dns_poll`; the contract is
"`safe fn(&mut Channel)` is sound only while `Channel` is a ZST" on the
Q side, "every Resolver field UnsafeCell-backed so LLVM cannot cache
`ref_count` across re-entry" on the I side.

## Unsafe-surface tally (vs prior 257)

Normalised: **297 sites** (prior 257; **+40 ≈ +16 %**). Keyword count: 298.
SAFETY-comment density 225 / 297 ≈ **76 %** (gap is the 3 `unsafe extern
"C" {…}` block headers, 3 `unsafe impl`/`unsafe trait` rows, and the
shared-introducer-comment style in `cares_jsc.rs` walker loops).

Per file: `mod.rs` 0, `dns.rs` 258, `cares_jsc.rs` 38, `options_jsc.rs` 2.

The +40 delta is concentrated in (a) the `export_host_fn!` macro cluster at
`dns.rs:5972-6024` (17 `#[unsafe(export_name)]` JS-host-fn shims, each
contributing 2 `unsafe extern "C/sysv64" fn __shim` + 2 inline derefs),
(b) the Windows `UvDnsPoll` path (`on_dns_poll_uv`, `on_close_uv`, and the
`on_dns_socket_state` libuv branch), (c) per-block SAFETY-tightening that
split prior multi-deref `unsafe` blocks into per-line `unsafe` for finer
attribution.

Macro-generated share: ~40 / 297 ≈ **13 %**. Largest macros:
`impl_cares_record_type!` (×9 record types ⇒ 18 unsafe-keyword sites
collapsed into normalised count), `export_host_fn!` (×17 ⇒ 17 normalised
sites), `impl_cares_linked!` (×5 `unsafe impl CAresLinked` rows).

## c-ares FFI integration audit

The DNS-side c-ares boundary is **3-tier**:

1. **Channel ownership** — `Resolver.channel: Cell<Option<*mut c_ares::Channel>>`
   (`dns.rs:3620`). Set by `Resolver::init` on success, freed by `deinit`
   via `c_ares::Channel::destroy(channel)` at `:4001-4003`. **The raw
   `*mut Channel` is the JSC-side `Channel` opaque-ZST handle defined in
   Section Q at `cares_sys/c_ares.rs:741`** — Section Q's `const _: () =
   assert!(core::mem::size_of::<Channel>() == 0)` static assertion is the
   load-bearing invariant that makes `safe fn(&mut Channel)` calls sound;
   Section I exercises those `safe fn` signatures from
   `on_dns_poll`/`on_dns_poll_uv`/`request_completed`/etc.

2. **Per-record-type reply trampoline** — `c_ares::ares_reply_callback::<T,
   ResolveInfoRequest<T>>` (Section Q). 9 monomorphisations stamped by
   `impl_cares_record_type!` (srv/soa/txt/naptr/mx/caa/ns/ptr/cname; a/aaaa
   share `hostent_with_ttls`). Each instantiation walks the c-ares-owned
   linked list via the `unsafe trait CAresLinked` introduced in
   `cares_jsc.rs:236`. Walker invariant ("either null or a valid pointer
   into the same c-ares-owned list") is documented but **not type-enforced**
   — Phase 2 candidate to wrap c-ares list heads in a `CAresList<T>` newtype
   whose `Drop` calls `ares_free_data` and whose `iter()` is the only way
   in.

3. **Socket-state callback** — `on_dns_socket_state(&self, fd, readable,
   writable)` at `dns.rs:4768`. c-ares calls this through the
   `ChannelContainer::on_dns_socket_state` trait in Section Q. This is
   where Resolver registers libuv polls (Windows: `UvDnsPoll` struct
   wrapping `uv_poll_t`) or POSIX `FilePoll`s (kqueue/epoll). The
   single-JS-thread invariant is asserted by the comment-only
   `// SAFETY: single-JS-thread` markers at `:4794` and `:4858` —
   **no `cfg!(debug_assertions)` enforcement**.

## Callback aliasing contract

The Section-I callback contract is the **`*mut Self` (no `&mut self`)
EXP-012 discipline**, applied uniformly across 4 request clusters:

- **`DNSLookup`** (`dns.rs:917`) — base intrusive-list head; `process_*`/
  `on_complete`/`destroy` all `pub unsafe fn (this: *mut Self, …)`.
- **`ResolveInfoRequest<T>`** (`:917-1025`) — generic c-ares reply consumer.
- **`CAresNameInfo`** (`:1700-1810`) — `getnameinfo` reverse path.
- **`CAresReverse`** (`:1828-1955`) — c-ares `ares_getaddrinfo` reverse.
- **`CAresLookup<T>`** (`:1850-2127`) — same template as
  `ResolveInfoRequest<T>` but specialised for `c_ares::AddrInfo`.

Every cluster takes a `*mut Self` first arg, materialises `&mut *this` only
inside short scopes that **do not span a JS-re-entrant call**, and finishes
with either `bun_core::heap::take(this)` (consumes the Box, runs Drop once)
or the `*bun_core::heap::take(this)` move-out pattern (`dns.rs:1521-1524`)
that explicitly avoids the `ptr::read + heap::take` double-Drop trap noted in
the inline SAFETY comment.

The **best-in-section SAFETY example** is `dns.rs:4746-4766 on_dns_poll`:

> "R-2: `&self` (no `noalias`). `Channel::process` (== `ares_process_fd`)
> synchronously fires c-ares completion callbacks which re-enter this
> Resolver via a fresh `&Resolver` (e.g. `request_completed`,
> `drain_pending_*`, `ref_`/`deref`). With every mutable field
> UnsafeCell-backed, LLVM cannot cache `ref_count` across the FFI call —
> the structural fix for the previously ASM-verified PROVEN_CACHED
> miscompile that needed `black_box` laundering under `&mut self`."

This is the audit-grade citation for why every Resolver field is
`Cell`/`JsCell`-wrapped.

## Send/Sync inventory

**Two `unsafe impl Send` rows total** (no `unsafe impl Sync` anywhere in
Section I):

1. `dns.rs:107 unsafe impl<T> Send for SendPtr<T>` — generic raw-pointer
   wrapper used by the threaded work pool. **PRESENT_WEAK** SAFETY
   ("synchronization is provided by `global_cache()`") and wider than the
   invariant it documents. Current source constructs only `SendPtr<Request>` at
   `dns.rs:3080`, and the type is private to `dns.rs`, so this is **not** an
   EXP-019-equivalent public safe-API bug. Phase-2 hardening: narrow the
   wrapper to `SendRequestPtr` / `SendPtrLockedBy<Request, GlobalCacheLock>` or
   otherwise encode the `global_cache()` lock discipline in the type.

2. `dns.rs:2386 unsafe impl Send for GlobalCache` — the section's cross-thread
   anchor. Houses `[*mut Request; 256]` + `len`. Lives behind
   `bun_threading::Guarded<GlobalCache>` at `:2487`. Per-Request payload
   includes `notify: Vec<DNSRequestOwner>` whose `Quic(*mut bun_http::H3::
   PendingConnect)` variant ties back to Section Q's
   `PendingConnect.rs:179 unsafe impl Send for Resolved`.
   **PRESENT_WEAK** SAFETY but the invariant is precise: every payload `*mut
   Request` is heap-allocated; every cross-thread access (`getaddrinfo`,
   `after_result`, `freeaddrinfo`, `us_getaddrinfo_set/cancel`) takes
   `global_cache().lock()` first.

**Cross-thread handoff shape**: Section I does **NOT** mirror Section Q's
`PendingConnect.rs:179 Guarded<Vec<*mut T>>` head pattern (per-call drain).
Instead it uses a different shape:

- One global mutex (`GLOBAL_CACHE`) protecting a fixed-size 256-slot cache of
  `*mut Request` plus per-Request `Vec<DNSRequestOwner>` subscriber lists.
- The C side calls back into Rust via `us_internal_dns_callback_threadsafe`
  (`dns.rs:2544-2547`); uSockets internally routes the message to the JS
  thread before invoking `Bun__addrinfo_set/get/freeRequest`.
- The H3 QUIC variant uses `bun_http::H3::PendingConnect::
  on_dns_resolved_threadsafe`, defined in Section Q.

**Both Send impls' lifecycle is sound** under the documented invariants, but
the Phase 2 sharpening candidates are: typed `SendPtr`, replace
`GlobalCache.cache: [*mut Request; 256]` with `[Option<NonNull<Request>>; 256]`
to make the null-check at `:2407` compile-checked.

## Notable patterns

1. **`*bun_core::heap::take(this)` move-out, NOT `ptr::read(this); heap::take`** —
   the latter would double-Drop `DNSLookup`'s `JSPromiseStrong` /
   `BackRef<JSGlobalObject>` / `Option<IntrusiveRc<Resolver>>` fields. The
   inline SAFETY comment at `dns.rs:1520-1523` documents the trap.
   Same pattern recurs at `:1572-1573`, `:1616-1617`. Phase 2: extract a
   `consume_into_head!` macro to centralise.

2. **`process_results` MaybeUninit slot-by-slot init** (`dns.rs:2615-2695`).
   Every byte of `ResultEntry { info, addr }` is explicitly written before
   `assume_init`, including the **Windows-specific** zeroing of `addr` for
   non-AF_INET/AF_INET6 families. The inline comment cites this as a
   discovered-on-Windows bug that the original Zig code did not handle.
   **Best-in-section MaybeUninit pattern**.

3. **POD-contract `ptr::read` on pending-cache slots** (`dns.rs:4244-4275`,
   4 sites). Reads the `PendingCacheKey` out by value, then unsets the
   `used` bit on the HiveArray. **Assumes `PendingCacheKey: !Drop`** but
   doesn't enforce it with a static-assertion. If a future maintainer adds
   a `Drop` impl to `PendingCacheKey` (or one of its fields gains a Box/
   IntrusiveRc), every one of these 4 sites becomes a double-Drop UAF.
   Phase 2 must-fix: `static_assertions::assert_not_impl_any!
   (PendingCacheKey: Drop)`.

## Open questions

1. Should the macOS `mach_port → i32 fd` bitcast at `dns.rs:2826/2919` be
   audited for sign-bit safety? `mach_port_t` is `u32`; storing into
   `sys::Fd::from_native(i32)` and later reading back via `poll.fd.native()`
   round-trips correctly only if `mach_port` ≤ `i32::MAX`. The comment
   "matches Zig @bitCast" is accurate but the upper-bound contract is not
   documented.

2. The `SendPtr<T>` Send-impl is fully generic in `T` — what other call sites
   instantiate it besides `thread_pool::Task`? `rg 'SendPtr<' src/runtime/
   dns_jsc/` returns only the local definition; if the wrapper is private to
   `dns_jsc`, it can be specialised to `*mut Request` rather than generic.

3. Does the `unsafe trait CAresLinked` invariant ("`.next` is c-ares-owned")
   actually prevent a forged impl from a different crate? The trait is
   `pub(crate)` only via module-private exports; safe to leave as-is, but
   document the boundary in Phase 2.

4. The `Resolver` field `pending_*_cache_cares` (16 of them) all share the
   same `JsCell<HiveArray<…>>` shape; the `with_mut(|c| …)` pattern (`dns.rs:
   3787`, `:3817`, `:4262`, `:4270`) gives short-lived `&mut` references.
   Are any of them held across a `Channel::process` call? A grep audit
   should find this; if any are held, that's a re-entrancy violation that
   the `UnsafeCell`-backing doesn't catch (because `with_mut` does *form*
   a `&mut` — the protection is only that LLVM doesn't *cache* loads
   across the call).
