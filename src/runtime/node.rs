//! Node.js APIs in Bun.

// Rust only compiles a `.rs` file if it is reachable via a `mod` declaration —
// `#[no_mangle]` alone does NOT make an orphaned file link. Every Windows-only
// sibling (`uv_signal_handle_windows`, `win_watcher`) must have a
// `#[cfg(windows)] pub mod` entry here or its C-ABI exports will be missing at
// link time.

// ─── compiling submodules ─────────────────────────────────────────────────
#[path = "node/nodejs_error_code.rs"]
pub mod nodejs_error_code;
pub use nodejs_error_code::Code as ErrorCode;

#[path = "node/assert/myers_diff.rs"]
pub mod myers_diff_impl;
pub mod assert {
    pub use super::myers_diff_impl as myers_diff;
}

#[path = "node/types.rs"]
pub mod types;
pub use types::{
    BlobOrStringOrBuffer, Dirent, Encoding, FileSystemFlags, PathLike, PathOrBlob,
    PathOrFileDescriptor, StringOrBuffer, Valid, VectorArrayBuffer, mode_from_js,
};

pub use bun_jsc::MarkedArrayBuffer as Buffer;

#[path = "node/path.rs"]
pub mod path;

#[path = "node/node_os.rs"]
pub mod os;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub use os as node_os;

#[path = "node/node_process.rs"]
pub mod process;

#[path = "node/node_crypto_binding.rs"]
pub mod crypto;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub use crypto as node_crypto_binding;

#[path = "node/fs_events.rs"]
pub mod fs_events;

// Sibling modules node_fs.rs imports by `super::` path.
#[path = "node/Stat.rs"]
pub mod stat;
pub use stat::{Stats, StatsBig, StatsSmall};

#[path = "node/StatFS.rs"]
pub mod statfs;
pub use statfs::{StatFS, StatFSBig, StatFSSmall};

#[path = "node/time_like.rs"]
pub mod time_like;

#[path = "node/dir_iterator.rs"]
pub mod dir_iterator;

#[path = "node/node_fs_constant.rs"]
pub mod node_fs_constant;

#[path = "node/util/parse_args.rs"]
pub mod parse_args_impl;
#[path = "node/util/parse_args_utils.rs"]
pub mod parse_args_utils;
#[path = "node/util/validators.rs"]
pub mod validators_impl;
pub mod util {
    pub use super::parse_args_impl as parse_args;
    pub use super::validators_impl as validators;
}
pub use util::validators;

// `crate::node::dirent::Kind` shim for dir_iterator.rs / node_fs.rs —
// callers reach `.Kind` through `Dirent`. Rust can't hang an associated
// module off a struct re-export, so expose a tiny module mirroring that shape.
pub mod dirent {
    pub use super::types::Dirent;
    pub use super::types::DirentKind as Kind;
}

#[path = "node/node_fs.rs"]
pub mod fs;

// fs.watch() / fs.watchFile() backends — declared here so `fs::watch` /
// `fs::watch_file` can reach the real `Arguments` / `FSWatcher` /
// `StatWatcher` types instead of opaque local stand-ins.
#[cfg(not(windows))]
#[path = "node/path_watcher.rs"]
pub mod path_watcher;
#[cfg(windows)]
#[path = "node/win_watcher.rs"]
pub mod win_watcher;
// Force-references `Bun__UVSignalHandle__init` / `Bun__UVSignalHandle__close`
// for C++ (`src/jsc/bindings/BunProcess.cpp`). Must be `mod`-declared or the
// `#[no_mangle]` exports are never compiled into the binary.
#[path = "node/memory_pressure.rs"]
pub mod memory_pressure;
#[path = "node/node_fs_binding.rs"]
pub mod node_fs_binding;
#[path = "node/node_fs_stat_watcher.rs"]
pub mod node_fs_stat_watcher;
#[path = "node/node_fs_watcher.rs"]
pub mod node_fs_watcher;
#[cfg(windows)]
#[path = "node/uv_signal_handle_windows.rs"]
pub mod uv_signal_handle_windows;

// Type defs + non-JSC FFI bodies are live; every `#[bun_jsc::host_fn]` /
// `#[bun_jsc::JsClass]` item is wrapped in ` mod _impl` inside
// each file. dgram/tls/tty have no `.rs` ports yet — nothing to wire.
#[path = "node/buffer.rs"]
pub mod buffer;

#[path = "node/node_cluster_binding.rs"]
pub mod node_cluster_binding;

#[path = "node/node_net_binding.rs"]
pub mod node_net_binding;

#[path = "node/node_quic_binding.rs"]
pub mod node_quic_binding;

#[path = "node/quic/mod.rs"]
pub mod quic;

#[path = "node/node_http_binding.rs"]
pub mod node_http_binding;

#[path = "node/node_util_binding.rs"]
pub mod node_util_binding;

#[path = "node/node_assert.rs"]
pub mod node_assert;

#[path = "node/node_assert_binding.rs"]
pub mod node_assert_binding;

#[path = "node/node_error_binding.rs"]
pub mod node_error_binding;

#[path = "node/node_zlib_binding.rs"]
pub mod node_zlib_binding;

#[path = "node/net/BlockList.rs"]
pub mod block_list_impl;
pub mod net {
    pub use super::block_list_impl as block_list;
}

#[path = "node/zlib/NativeBrotli.rs"]
pub mod native_brotli_impl;
#[path = "node/zlib/NativeZlib.rs"]
pub mod native_zlib_impl;
#[path = "node/zlib/NativeZstd.rs"]
pub mod native_zstd_impl;
pub mod zlib {
    pub use super::native_brotli_impl as native_brotli;
    pub use super::native_zlib_impl as native_zlib;
    pub use super::native_zstd_impl as native_zstd;
}

// ─── submodule re-exports ─────────────────────────────────────────────────

#[cfg(unix)]
pub type uid_t = libc::uid_t;
#[cfg(not(unix))]
pub type uid_t = bun_sys::windows::libuv::uv_uid_t;

#[cfg(unix)]
pub type gid_t = libc::gid_t;
#[cfg(not(unix))]
pub type gid_t = bun_sys::windows::libuv::uv_gid_t;

/// Node.js expects the error to include contextual information
/// - "syscall"
/// - "path"
/// - "errno"
pub type Maybe<R, E = bun_sys::Error> = core::result::Result<R, E>;

/// Generic helper surface for `Maybe(R, E)`.
/// `unwrap_or`/`is_ok`/`is_err`/`map_err` are already provided by
/// `core::result::Result`, so only the extra helper remains here.
pub trait MaybeExt<R, E>: Sized {
    fn as_err(&self) -> Option<&E>;
}

impl<R, E> MaybeExt<R, E> for Maybe<R, E> {
    #[inline]
    fn as_err(&self) -> Option<&E> {
        self.as_ref().err()
    }
}

/// Extension surface providing `Maybe::todo()` on `bun_sys::Maybe<T>`
/// (= `core::result::Result<T, bun_sys::Error>`), the type-alias form of
/// `Maybe` used throughout `node/`.
pub trait MaybeTodo: Sized {
    fn todo() -> Self;
}

impl<T> MaybeTodo for core::result::Result<T, bun_sys::Error> {
    #[inline]
    fn todo() -> Self {
        Err(bun_sys::Error::todo())
    }
}
