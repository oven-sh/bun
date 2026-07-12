//! `bun_usockets` — Rust rewrite of the uSockets C core. FROZEN API SKELETON.
//!
//! Architecture: .rewrite-specs/api.md (binding). Behavioral rules:
//! .rewrite-specs/core-semantics.md + tls-semantics.md. C boundary:
//! .rewrite-specs/cabi-surface.md. Consumer surface:
//! .rewrite-specs/consumers/*.md.
//!
//! Unsafe policy (api.md §Strategy 5): `unsafe` is confined to `unsafe_core/`
//! (slab, ext downcast, syscall/FFI edges, trampolines) plus the `cabi`
//! extern "C" export module. Everything else compiles under `deny(unsafe_code)`;
//! the handful of `unsafe fn` API items the frozen surface requires carry
//! item-level allows with a `SKELETON` note.
#![deny(unsafe_code)]
// FROZEN SKELETON: stub bodies (`todo!`) leave parameters and internal fields
// unread. Writers remove these two allows as modules gain real bodies.
#![allow(dead_code, unused_variables)]
#![allow(non_camel_case_types)]

pub mod backend;
pub mod connecting;
pub mod dispatch;
pub mod fault;
pub mod group;
pub mod handle;
pub mod kind;
#[path = "loop_/mod.rs"]
pub mod loop_;
pub mod protocol;
pub mod socket;
pub mod tls;
pub mod udp;
pub mod write;

// The ONLY modules allowed to contain `unsafe` (api.md crate layout).
#[allow(unsafe_code)]
pub mod unsafe_core;

// extern "C" surface for surviving C/C++ (uWS, quic.c, NodeTLS, JSHS, webview).
// `#[no_mangle]` is an unsafe attribute in edition 2024, hence the allow; the
// module is feature-gated OFF by default (symbol collision with the live C).
#[cfg(feature = "cabi")]
#[allow(unsafe_code)]
pub mod cabi;

// ───────────────────────── crate-root FFI primitives ─────────────────────────

/// `LIBUS_SOCKET_DESCRIPTOR` — `int` on POSIX, `SOCKET` (`uintptr`) on Windows.
#[cfg(not(windows))]
pub type LIBUS_SOCKET_DESCRIPTOR = core::ffi::c_int;
#[cfg(windows)]
pub type LIBUS_SOCKET_DESCRIPTOR = usize;

/// `LIBUS_SOCKET_ERROR`.
#[cfg(not(windows))]
pub const LIBUS_SOCKET_ERROR: LIBUS_SOCKET_DESCRIPTOR = -1;
#[cfg(windows)]
pub const LIBUS_SOCKET_ERROR: LIBUS_SOCKET_DESCRIPTOR = usize::MAX; // INVALID_SOCKET

/// Ext regions (loop ext, socket ext) are aligned to this (cabi-surface.md §8).
pub const LIBUS_EXT_ALIGNMENT: usize = 16;
/// Shared per-loop receive buffer length (cabi-surface.md §8).
pub const LIBUS_RECV_BUFFER_LENGTH: usize = 524288;
/// Over-read guard on both ends of `recv_buf` for SIMD unmasking.
pub const LIBUS_RECV_BUFFER_PADDING: usize = 32;
/// Short-timeout wheel granularity, seconds.
pub const LIBUS_TIMEOUT_GRANULARITY: u32 = 4;

/// `enum us_socket_options_t` — listen / connect option flags.
pub const LIBUS_LISTEN_DEFAULT: core::ffi::c_int = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: core::ffi::c_int = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: core::ffi::c_int = 2;
pub const LIBUS_LISTEN_REUSE_PORT: core::ffi::c_int = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: core::ffi::c_int = 8;
pub const LIBUS_LISTEN_REUSE_ADDR: core::ffi::c_int = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: core::ffi::c_int = 32;
pub const LIBUS_LISTEN_DEFER_ACCEPT: core::ffi::c_int = 64;

/// `bun.timespec` — `tick_with_timeout` takes `Option<&Timespec>`.
pub use bun_core::Timespec;

// ───────────────────────────── re-exports ────────────────────────────────────

pub use connecting::ConnectingSocket;
pub use dispatch as vtable;
pub use dispatch::Handler;
pub use group::{ConnectResult, SocketGroup, VTable};
pub use handle::{
    AnySocket, CloseCode, ConnectError, ConnectingRef, ExtSlot, InternalSocket, ListenSocket,
    NewSocketHandler, SocketHandler, SocketRef, SocketTCP, SocketTLS, SocketTcp, SocketTls,
    UpgradedDuplex,
};
#[cfg(windows)]
pub use handle::WindowsNamedPipe;
pub use kind::SocketKind;
pub use protocol::{
    CloseCode2, ConnectFailure, OwnerRef, Protocol, VerifyError, owner_ref_of, register,
    this_ptr_of,
};
#[cfg(not(windows))]
pub use loop_::PosixLoop;
pub use loop_::{InternalLoopData, Loop, LoopHandler};
pub use loop_::{PollEvents, PollProtocol, PollRef, PollSource};
#[cfg(windows)]
pub use loop_::WindowsLoop;
pub use loop_::on_thread_exit;
pub use loop_::wakeup::{us_loop_run, us_wakeup_loop};
pub use socket::{SocketHeader, us_socket_t};
pub use tls::SSL;
pub use tls::context::{
    BunSocketContextOptions, SslCtx, create_bun_socket_error_t, us_bun_verify_error_t,
};
pub use write::UsIoVec;

/// Legacy aliases preserved from `bun_uws` (consumers/01-api-surface.md §13).
pub type CloseKind = CloseCode;
pub type DispatchKind = SocketKind;
pub type Socket = us_socket_t;
pub type SocketGroupVTable = VTable;
