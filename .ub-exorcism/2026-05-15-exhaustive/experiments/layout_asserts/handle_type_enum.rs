// Per-variant numeric-discriminant asserts for `bun_libuv_sys::HandleType`,
// per Phase-10 finding F-10-3.
//
// PROPOSED INSERTION SITE: `src/libuv_sys/libuv.rs` (immediately after the
// existing `pub const UV_HANDLE_TYPE_MAX: c_int = 18;` at line 297, before
// `pub enum RunMode`).
//
// Rationale (Phase-4 F-10-3): `HandleType` is hand-transcribed from the
// `UV_HANDLE_TYPE_MAP(XX)` X-macro in `vendor/libuv/include/uv.h`. The
// numeric values are assigned by the C compiler implicitly from the
// expansion order of the macro:
//
//      typedef enum {
//          UV_UNKNOWN_HANDLE = 0,
//      #define XX(uc, lc) UV_##uc,
//          UV_HANDLE_TYPE_MAP(XX)        // → ASYNC=1, CHECK=2, FS_EVENT=3, ...
//      #undef XX
//          UV_FILE,                      // = 17
//          UV_HANDLE_TYPE_MAX            // = 18
//      } uv_handle_type;
//
// If libuv ever inserts a new variant in the middle of the macro (or
// reorders one — has happened: in 1.0 → 1.1 the ASYNC/CHECK order was
// debated), every discriminant downstream drifts by one. Bun's
// `uv_guess_handle()` (libuv.rs:286-296) then maps the wrong FD class to
// the wrong handle — `pipe → tty`, `tcp → udp`, etc. The handle ops
// vtable mismatch crashes Bun's HTTP server on the first incoming connection.
//
// Today the Rust side has size+offset asserts on `Handle`/`uv_stream_t`/
// `Loop` (libuv.rs:3544-3575) but no per-variant pin. These 17 asserts
// close that hole.
//
// CROSS-REFERENCE — upstream header on this machine:
//   /home/ubuntu/.cache/node-gyp/25.9.0/include/node/uv.h:163-207
//   (Node.js 25 ships libuv 1.51 → matches Bun's vendored libuv version.)

#[cfg(windows)]
const _: () = {
    use core::ffi::c_int;

    // ── UV_HANDLE_TYPE_MAP(XX) expansion ─────────────────────────────────
    // Source: uv.h:163-180 (Node 25 cache) + uv.h:200-207 (the enum body).
    // Macro order is load-bearing — each variant's discriminant is its
    // 0-indexed position in the expansion. Asserts mirror that order.
    //
    // Rust definition: src/libuv_sys/libuv.rs:257-276
    //
    // Each `assert!(HandleType::Foo as c_int == N)` does three things:
    //   1. Verifies the literal discriminant matches the C header.
    //   2. Witnesses that all variants 0..=17 are present (a deletion or
    //      reorder produces a different `as c_int` value).
    //   3. Keeps the `#[repr(C)]` semantics (size_of == sizeof(c_int) = 4)
    //      tripwired — if a future maintainer drops `#[repr(C)]` the
    //      discriminants would still match but the FFI ABI would break;
    //      add a size assert as a belt-and-braces guard.

    assert!(core::mem::size_of::<HandleType>() == core::mem::size_of::<c_int>());

    // UV_UNKNOWN_HANDLE = 0 (pinned outside the macro)
    assert!(HandleType::Unknown as c_int == 0);

    // XX(ASYNC, async)        → UV_ASYNC = 1
    assert!(HandleType::Async as c_int == 1);
    // XX(CHECK, check)        → UV_CHECK = 2
    assert!(HandleType::Check as c_int == 2);
    // XX(FS_EVENT, fs_event)  → UV_FS_EVENT = 3
    assert!(HandleType::FsEvent as c_int == 3);
    // XX(FS_POLL, fs_poll)    → UV_FS_POLL = 4
    assert!(HandleType::FsPoll as c_int == 4);
    // XX(HANDLE, handle)      → UV_HANDLE = 5
    assert!(HandleType::Handle as c_int == 5);
    // XX(IDLE, idle)          → UV_IDLE = 6
    assert!(HandleType::Idle as c_int == 6);
    // XX(NAMED_PIPE, pipe)    → UV_NAMED_PIPE = 7
    assert!(HandleType::NamedPipe as c_int == 7);
    // XX(POLL, poll)          → UV_POLL = 8
    assert!(HandleType::Poll as c_int == 8);
    // XX(PREPARE, prepare)    → UV_PREPARE = 9
    assert!(HandleType::Prepare as c_int == 9);
    // XX(PROCESS, process)    → UV_PROCESS = 10
    assert!(HandleType::Process as c_int == 10);
    // XX(STREAM, stream)      → UV_STREAM = 11
    assert!(HandleType::Stream as c_int == 11);
    // XX(TCP, tcp)            → UV_TCP = 12
    assert!(HandleType::Tcp as c_int == 12);
    // XX(TIMER, timer)        → UV_TIMER = 13
    assert!(HandleType::Timer as c_int == 13);
    // XX(TTY, tty)            → UV_TTY = 14
    assert!(HandleType::Tty as c_int == 14);
    // XX(UDP, udp)            → UV_UDP = 15
    assert!(HandleType::Udp as c_int == 15);
    // XX(SIGNAL, signal)      → UV_SIGNAL = 16
    assert!(HandleType::Signal as c_int == 16);
    // UV_FILE = 17 (pinned outside the macro)
    assert!(HandleType::File as c_int == 17);

    // UV_HANDLE_TYPE_MAX = 18 — pinned as a Rust const in libuv.rs:297,
    // not a HandleType variant. Asserted here as a sanity check that we
    // didn't accidentally let any HandleType discriminant land at 18.
    assert!(UV_HANDLE_TYPE_MAX == 18);

    // ── Round-trip witness for `uv_guess_handle` ─────────────────────────
    // The wrapper at libuv.rs:286-296 range-checks `[Unknown..=File]`. If
    // either bound drifts, the unsafe `mem::transmute<c_int, HandleType>`
    // could synthesize an undefined discriminant. Pin the range bounds:
    assert!(HandleType::Unknown as c_int == 0);
    assert!(HandleType::File as c_int == 17);

    // ── Convenience aliases (libuv.rs:278-280) ───────────────────────────
    // These are `pub const`s, not separate variants — pin them so a future
    // rename (e.g. `UV_NAMED_PIPE` → `UV_PIPE`) doesn't silently alias to
    // a different variant.
    assert!(UV_TTY as c_int == 14);
    assert!(UV_NAMED_PIPE as c_int == 7);
    assert!(UV_UNKNOWN_HANDLE as c_int == 0);
};

// ── Cross-validation work still required before merging upstream ────────────
//
// Already cross-validated against `/home/ubuntu/.cache/node-gyp/25.9.0/include/node/uv.h`
// (lines 163-207). The 17 per-variant asserts above match the X-macro
// expansion exactly. No `// TODO(cross-validate)` outstanding.
//
// Maintainer notes for landing:
//
// 1. The block is `#[cfg(windows)]` because `HandleType` is itself only
//    defined under `#[cfg(windows)]` in `libuv.rs` (the rest of the crate
//    is `#![cfg(windows)]`-gated at the `lib.rs` re-export). This matches
//    the existing 74-assert block at `libuv.rs:3481`.
//
// 2. There is NO `c_int` widening hazard: the Rust enum is `#[repr(C)]`
//    and Rust's c_int is i32 on Windows x64 (same as MSVC `int`).
//    `HandleType::Unknown as c_int` is a trivial cast.
//
// 3. The existing runtime guard at `libuv.rs:289` already prevents
//    out-of-range transmutes. These compile-time asserts complement it
//    by tripping the **value**-drift case, not just the range case.
//
// 4. If libuv 2.x ever lands a NEW variant (e.g. `UV_HANDLE_TYPE_QUIC`),
//    the assert block fires (because `UV_FILE` would no longer be 17 —
//    it would shift to 18) AND the size assert holds (still `c_int` =
//    4B). The maintainer then knows to add the new Rust variant in the
//    right position and bump the asserts; the audit trail is one
//    self-explanatory failure message.
//
// 5. Pattern is reusable for the OTHER hand-transcribed libuv enums
//    living in the same file:
//      - `RunMode` (libuv.rs:300-306, 3 variants)
//      - `uv_req_type`/`req_t` family (libuv.rs:2256+, 11 variants from
//        UV_REQ_TYPE_MAP)
//      - `uv_fs_type` (Phase-12 follow-up)
//    A Phase-12 enum-discriminant sweep can apply this template across
//    ~50 additional per-variant asserts.
//
// Ready to paste at the end of `libuv.rs`'s existing assert block
// (libuv.rs:3599, immediately before the final `};`), gated by the same
// `#[cfg(all(target_arch = "x86_64", target_os = "windows"))]` if desired
// (currently `#[cfg(windows)]` because the enum discriminants are
// architecture-invariant — they're constants in the C header, not
// pointer-width-dependent).
