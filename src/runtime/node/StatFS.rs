//! StatFS and BigIntStatFS classes from node:fs

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
// On POSIX this is `libc::statfs`; on Windows it's `uv_statfs_t` (the value
// `sys_uv::statfs` returns / `uv_fs_statfs` writes into `req.ptr`). Field
// names match (`f_type`/`f_bsize`/…); widths differ (u64 vs platform-specific)
// but `init` does an explicit `as i64`/`as $Int` truncate so either shape works.
#[cfg(unix)]
pub(crate) type RawStatFS = libc::statfs;
#[cfg(not(unix))]
pub(crate) type RawStatFS = bun_sys::StatFS;

// PORT NOTE: Zig `pub fn StatFSType(comptime big: bool) type` picked the field
// integer type via `const Int = if (big) i64 else i32;`. The `i32` for the
// non-bigint variant truncated block/inode counts above `i32::MAX` (see `init`),
// so both variants store `i64` here and differ only in how they hand the values
// to JS (`jsNumber` double vs `BigInt`). Stable Rust const generics cannot select
// a branch from a `const BIG: bool` inside these bodies, so the two concrete
// instantiations are generated with a small macro. The two exported aliases
// (`StatFSSmall`, `StatFSBig`) are the only call sites.
macro_rules! define_statfs_type {
    ($name:ident, big = $big:expr) => {
        #[allow(non_snake_case)]
        pub struct $name {
            // Common fields between Linux and macOS
            pub _fstype: i64,
            pub _bsize: i64,
            pub _blocks: i64,
            pub _bfree: i64,
            pub _bavail: i64,
            pub _files: i64,
            pub _ffree: i64,
        }

        impl $name {
            pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
                self.statfs_to_js(global)
            }

            fn statfs_to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
                if $big {
                    // TODO(port): bun.jsc.fromJSHostCall wraps an extern call with
                    // JSC exception-scope checking; map to the Rust equivalent.
                    return bun_jsc::from_js_host_call(global, || {
                        Bun__createJSBigIntStatFSObject(
                            global,
                            self._fstype,
                            self._bsize,
                            self._blocks,
                            self._bfree,
                            self._bavail,
                            self._files,
                            self._ffree,
                        )
                    });
                }

                Ok(Bun__createJSStatFSObject(
                    global,
                    self._fstype,
                    self._bsize,
                    self._blocks,
                    self._bfree,
                    self._bavail,
                    self._files,
                    self._ffree,
                ))
            }

            pub fn init(statfs_: &RawStatFS) -> Self {
                #[cfg(any(
                    target_os = "linux",
                    target_os = "android",
                    target_os = "macos",
                    target_os = "freebsd",
                    windows
                ))]
                let (fstype_, bsize_, blocks_, bfree_, bavail_, files_, ffree_) = (
                    statfs_.f_type,
                    statfs_.f_bsize,
                    statfs_.f_blocks,
                    statfs_.f_bfree,
                    statfs_.f_bavail,
                    statfs_.f_files,
                    statfs_.f_ffree,
                );
                #[cfg(target_arch = "wasm32")]
                compile_error!("Unsupported OS");

                // Platform field types vary (i32/i64/u64); widen every field to i64.
                // On linux-x64 the block/inode counts (`f_blocks`/`f_bfree`/
                // `f_bavail`/`f_files`/`f_ffree`) are `u64`, so a filesystem with a
                // block count above `i32::MAX` (roughly `bavail * bsize > 8 TB` with
                // 4 KiB blocks) overflows a 32-bit field and wraps negative. Both the
                // non-bigint and bigint paths hand these values to C++ as `i64`; the
                // non-bigint binding wraps them with `jsNumber(int64_t)` (a double,
                // exact to 2^53), matching Node, and the bigint binding wraps them in
                // a `BigInt`. Neither loses data for the range real filesystems report.
                Self {
                    _fstype: fstype_ as i64,
                    _bsize: bsize_ as i64,
                    _blocks: blocks_ as i64,
                    _bfree: bfree_ as i64,
                    _bavail: bavail_ as i64,
                    _files: files_ as i64,
                    _ffree: ffree_ as i64,
                }
            }
        }
    };
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub safe fn Bun__JSBigIntStatFSObjectConstructor(global: &JSGlobalObject) -> JSValue;
    pub safe fn Bun__JSStatFSObjectConstructor(global: &JSGlobalObject) -> JSValue;

    pub(crate) safe fn Bun__createJSStatFSObject(
        global: &JSGlobalObject,
        fstype: i64,
        bsize: i64,
        blocks: i64,
        bfree: i64,
        bavail: i64,
        files: i64,
        ffree: i64,
    ) -> JSValue;

    pub(crate) safe fn Bun__createJSBigIntStatFSObject(
        global: &JSGlobalObject,
        fstype: i64,
        bsize: i64,
        blocks: i64,
        bfree: i64,
        bavail: i64,
        files: i64,
        ffree: i64,
    ) -> JSValue;
}

define_statfs_type!(StatFSSmall, big = false);
define_statfs_type!(StatFSBig, big = true);

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub enum StatFS {
    Big(StatFSBig),
    Small(StatFSSmall),
}

impl StatFS {
    #[inline]
    pub fn init(stat_: &RawStatFS, big: bool) -> StatFS {
        if big {
            StatFS::Big(StatFSBig::init(stat_))
        } else {
            StatFS::Small(StatFSSmall::init(stat_))
        }
    }

    pub fn to_js_newly_created(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StatFS::Big(big) => big.to_js(global),
            StatFS::Small(small) => small.to_js(global),
        }
    }

    // PORT NOTE: Zig `toJS` body is `@compileError(...)` — intentionally not
    // callable. Omitted in Rust; callers must use `to_js_newly_created` or call
    // `to_js` on `StatFSBig`/`StatFSSmall` directly.
}

// ported from: src/runtime/node/StatFS.zig
