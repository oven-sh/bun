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

// The field integer type is i64 ("big") or i32 ("small"). Stable Rust const
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
            pub _frsize: $Int,
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
                    return bun_jsc::from_js_host_call(global, || {
                        Bun__createJSBigIntStatFSObject(
                            global,
                            self._fstype as i64,
                            self._bsize as i64,
                            self._frsize as i64,
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
                    self._frsize as i64,
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
                // libuv reports f_frsize only where the OS provides one (Linux);
                // everywhere else it mirrors f_bsize (deps/uv/src/unix/fs.c, win/fs.c).
                #[cfg(target_os = "linux")]
                let frsize_ = statfs_.f_frsize;
                #[cfg(not(target_os = "linux"))]
                let frsize_ = bsize_;
                #[cfg(target_arch = "wasm32")]
                compile_error!("Unsupported OS");

                // Platform field types vary (u32/i64/u64); widen with `as i64`
                // (lossless for the in-range values statfs reports), then `as $Int`
                // truncates (intentional wrap).
                Self {
                    _fstype: (fstype_ as i64) as $Int,
                    _bsize: (bsize_ as i64) as $Int,
                    _frsize: (frsize_ as i64) as $Int,
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

unsafe extern "C" {
    pub(crate) safe fn Bun__createJSStatFSObject(
        global: &JSGlobalObject,
        fstype: i64,
        bsize: i64,
        frsize: i64,
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
        frsize: i64,
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

    // A `to_js` method is intentionally omitted; callers must use
    // `to_js_newly_created` or call `to_js` on `StatFSBig`/`StatFSSmall` directly.
}
