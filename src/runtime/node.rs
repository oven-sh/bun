//! Node.js APIs in Bun.

// Rust only compiles a `.rs` file if it is reachable via a `mod` declaration —
// `#[no_mangle]` alone does NOT make an orphaned file link. Every Windows-only
// sibling (`uv_signal_handle_windows`, `win_watcher`) must have a
// `#[cfg(windows)] pub mod` entry here or its C-ABI exports will be missing at
// link time.

// ─── compiling submodules ─────────────────────────────────────────────────
#[path = "node/assert/myers_diff.rs"]
pub(crate) mod myers_diff_impl;
pub(crate) mod assert {
    pub(crate) use super::myers_diff_impl as myers_diff;
}

#[path = "node/types.rs"]
pub(crate) mod types;
pub(crate) use types::{
    BlobOrStringOrBuffer, Dirent, Encoding, FileBlobs, Flavor, PathLike, PathOrBlob,
    PathOrFileDescriptor, StringObjects, StringOrBuffer, ThreadIsolated, ThreadIsolatedArg,
};

#[path = "node/path.rs"]
pub(crate) mod path;

#[path = "node/node_os.rs"]
pub(crate) mod os;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub(crate) use os as node_os;

#[path = "node/node_process.rs"]
pub(crate) mod process;

#[path = "node/node_crypto_binding.rs"]
pub(crate) mod crypto;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub(crate) use crypto as node_crypto_binding;

#[cfg(target_os = "macos")]
#[path = "node/fs_events.rs"]
pub(crate) mod fs_events;

// Sibling modules node_fs.rs imports by `super::` path.
#[path = "node/Stat.rs"]
pub(crate) mod stat;
pub(crate) use stat::StatsSmall;

#[path = "node/StatFS.rs"]
pub(crate) mod statfs;

#[path = "node/time_like.rs"]
pub(crate) mod time_like;

#[path = "node/dir_iterator.rs"]
pub(crate) mod dir_iterator;

#[path = "node/node_fs_constant.rs"]
pub(crate) mod node_fs_constant;

#[path = "node/util/parse_args.rs"]
pub(crate) mod parse_args_impl;
#[path = "node/util/parse_args_utils.rs"]
pub(crate) mod parse_args_utils;
#[path = "node/util/validators.rs"]
pub(crate) mod validators_impl;
pub(crate) mod util {
    pub(crate) use super::parse_args_impl as parse_args;
    pub(crate) use super::validators_impl as validators;
}
pub(crate) use util::validators;

// `crate::node::dirent::Kind` shim for dir_iterator.rs / node_fs.rs —
// callers reach `.Kind` through `Dirent`. Rust can't hang an associated
// module off a struct re-export, so expose a tiny module mirroring that shape.
pub(crate) mod dirent {
    pub(crate) use super::types::DirentKind as Kind;
}

#[path = "node/node_fs.rs"]
pub(crate) mod fs;

// fs.watch() / fs.watchFile() backends — declared here so `fs::watch` /
// `fs::watch_file` can reach the real `Arguments` / `FSWatcher` /
// `StatWatcher` types instead of opaque local stand-ins.
#[cfg(not(windows))]
#[path = "node/path_watcher.rs"]
pub(crate) mod path_watcher;
#[cfg(windows)]
#[path = "node/win_watcher.rs"]
pub(crate) mod win_watcher;
// Force-references `Bun__UVSignalHandle__init` / `Bun__UVSignalHandle__close`
// for C++ (`src/jsc/bindings/BunProcess.cpp`). Must be `mod`-declared or the
// `#[no_mangle]` exports are never compiled into the binary.
#[path = "node/memory_pressure.rs"]
pub(crate) mod memory_pressure;
#[path = "node/node_fs_binding.rs"]
pub(crate) mod node_fs_binding;
#[path = "node/node_fs_stat_watcher.rs"]
pub(crate) mod node_fs_stat_watcher;
#[path = "node/node_fs_watcher.rs"]
pub(crate) mod node_fs_watcher;
#[cfg(windows)]
#[path = "node/uv_signal_handle_windows.rs"]
pub(crate) mod uv_signal_handle_windows;

// Type defs + non-JSC FFI bodies are live; every `#[bun_jsc::host_fn]` /
// `#[bun_jsc::JsClass]` item is wrapped in ` mod _impl` inside
// each file. dgram/tls/tty have no `.rs` ports yet — nothing to wire.
#[path = "node/buffer.rs"]
pub(crate) mod buffer;

#[path = "node/node_cluster_binding.rs"]
pub(crate) mod node_cluster_binding;

#[path = "node/node_net_binding.rs"]
pub(crate) mod node_net_binding;

#[path = "node/node_quic_binding.rs"]
pub(crate) mod node_quic_binding;

#[path = "node/quic/mod.rs"]
pub(crate) mod quic;

#[path = "node/node_http_binding.rs"]
pub(crate) mod node_http_binding;

#[path = "node/node_util_binding.rs"]
pub(crate) mod node_util_binding;

#[path = "node/node_assert.rs"]
pub(crate) mod node_assert;

#[path = "node/node_assert_binding.rs"]
pub(crate) mod node_assert_binding;

#[path = "node/node_zlib_binding.rs"]
pub(crate) mod node_zlib_binding;

#[path = "node/net/BlockList.rs"]
pub(crate) mod block_list_impl;
pub(crate) mod net {
    pub(crate) use super::block_list_impl as block_list;
}

#[path = "node/zlib/NativeBrotli.rs"]
pub(crate) mod native_brotli_impl;
#[path = "node/zlib/NativeZlib.rs"]
pub(crate) mod native_zlib_impl;
#[path = "node/zlib/NativeZstd.rs"]
pub(crate) mod native_zstd_impl;
pub(crate) mod zlib {
    pub(crate) use super::native_brotli_impl as native_brotli;
    pub(crate) use super::native_zlib_impl as native_zlib;
    pub(crate) use super::native_zstd_impl as native_zstd;
}

// ─── submodule re-exports ─────────────────────────────────────────────────

#[cfg(unix)]
pub(crate) type uid_t = libc::uid_t;
#[cfg(not(unix))]
pub(crate) type uid_t = bun_sys::windows::libuv::uv_uid_t;

#[cfg(unix)]
pub(crate) type gid_t = libc::gid_t;
#[cfg(not(unix))]
pub(crate) type gid_t = bun_sys::windows::libuv::uv_gid_t;
