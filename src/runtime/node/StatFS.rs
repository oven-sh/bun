//! StatFS and BigIntStatFS classes from node:fs

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
// On POSIX this is `libc::statfs`; on Windows it's `uv_statfs_t` (the value
// `sys_uv::statfs` returns / `uv_fs_statfs` writes into `req.ptr`). Field
// names match (`f_type`/`f_bsize`/…); widths differ (u64 vs platform-specific)
// but `init` does an explicit `as i64`/`as $Int` truncate so either shape works.
#[cfg(unix)]
pub type RawStatFS = libc::statfs;
#[cfg(not(unix))]
pub type RawStatFS = bun_sys::StatFS;

// PORT NOTE: Zig `pub fn StatFSType(comptime big: bool) type` picks the field
// integer type via `const Int = if (big) i64 else i32;`. Stable Rust const
// generics cannot select a field type from a `const BIG: bool`, so we generate
// the two concrete instantiations with a small macro. The two exported aliases
// (`StatFSSmall`, `StatFSBig`) are the only call sites.
macro_rules! define_statfs_type {
    ($name:ident, $Int:ty, big = $big:expr) => {
        #[allow(non_snake_case)]
        pub struct $name {
            // Common fields between Linux and macOS
            pub _fstype: $Int,
            pub _bsize: $Int,
            pub _blocks: $Int,
            pub _bfree: $Int,
            pub _bavail: $Int,
            pub _files: $Int,
            pub _ffree: $Int,
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
                            self._fstype as i64,
                            self._bsize as i64,
                            self._blocks as i64,
                            self._bfree as i64,
                            self._bavail as i64,
                            self._files as i64,
                            self._ffree as i64,
                        )
                    });
                }

                Ok(Bun__createJSStatFSObject(
                    global,
                    self._fstype as i64,
                    self._bsize as i64,
                    self._blocks as i64,
                    self._bfree as i64,
                    self._bavail as i64,
                    self._files as i64,
                    self._ffree as i64,
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

                // @truncate(@as(i64, @intCast(x))) — @intCast to i64 then @truncate to Int.
                // PORT NOTE: platform field types vary (u32/i64/u64); `as i64` matches
                // Zig's @intCast for the in-range values statfs reports, then `as $Int`
                // is the @truncate (intentional wrap).
                Self {
                    _fstype: (fstype_ as i64) as $Int,
                    _bsize: (bsize_ as i64) as $Int,
                    _blocks: (blocks_ as i64) as $Int,
                    _bfree: (bfree_ as i64) as $Int,
                    _bavail: (bavail_ as i64) as $Int,
                    _files: (files_ as i64) as $Int,
                    _ffree: (ffree_ as i64) as $Int,
                }
            }
        }
    };
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub safe fn Bun__JSBigIntStatFSObjectConstructor(global: &JSGlobalObject) -> JSValue;
    pub safe fn Bun__JSStatFSObjectConstructor(global: &JSGlobalObject) -> JSValue;

    pub safe fn Bun__createJSStatFSObject(
        global: &JSGlobalObject,
        fstype: i64,
        bsize: i64,
        blocks: i64,
        bfree: i64,
        bavail: i64,
        files: i64,
        ffree: i64,
    ) -> JSValue;

    pub safe fn Bun__createJSBigIntStatFSObject(
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

define_statfs_type!(StatFSSmall, i32, big = false);
define_statfs_type!(StatFSBig, i64, big = true);

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
