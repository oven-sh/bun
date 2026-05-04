//! StatFS and BigIntStatFS classes from node:fs

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_sys::StatFS as RawStatFS;

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
                    // SAFETY: FFI call into C++ binding; global is a valid &JSGlobalObject.
                    return bun_jsc::from_js_host_call(global, || unsafe {
                        Bun__createJSBigIntStatFSObject(
                            global as *const _ as *mut _,
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

                // SAFETY: FFI call into C++ binding; global is a valid &JSGlobalObject.
                Ok(unsafe {
                    Bun__createJSStatFSObject(
                        global as *const _ as *mut _,
                        self._fstype as i64,
                        self._bsize as i64,
                        self._blocks as i64,
                        self._bfree as i64,
                        self._bavail as i64,
                        self._files as i64,
                        self._ffree as i64,
                    )
                })
            }

            pub fn init(statfs_: &RawStatFS) -> Self {
                #[cfg(any(
                    target_os = "linux",
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
                // PORT NOTE: inner @intCast → i64::try_from(..).unwrap() (debug-asserts
                // fit, matching Zig); outer @truncate → bare `as $Int` (intentional wrap).
                Self {
                    _fstype: i64::try_from(fstype_).unwrap() as $Int,
                    _bsize: i64::try_from(bsize_).unwrap() as $Int,
                    _blocks: i64::try_from(blocks_).unwrap() as $Int,
                    _bfree: i64::try_from(bfree_).unwrap() as $Int,
                    _bavail: i64::try_from(bavail_).unwrap() as $Int,
                    _files: i64::try_from(files_).unwrap() as $Int,
                    _ffree: i64::try_from(ffree_).unwrap() as $Int,
                }
            }
        }
    };
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn Bun__JSBigIntStatFSObjectConstructor(global: *mut JSGlobalObject) -> JSValue;
    pub fn Bun__JSStatFSObjectConstructor(global: *mut JSGlobalObject) -> JSValue;

    pub fn Bun__createJSStatFSObject(
        global: *mut JSGlobalObject,
        fstype: i64,
        bsize: i64,
        blocks: i64,
        bfree: i64,
        bavail: i64,
        files: i64,
        ffree: i64,
    ) -> JSValue;

    pub fn Bun__createJSBigIntStatFSObject(
        global: *mut JSGlobalObject,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/StatFS.zig (141 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime-bool type-generator expressed as macro_rules! (stable Rust cannot pick field type from const-generic bool); from_js_host_call wrapper shape needs Phase-B confirmation
// ──────────────────────────────────────────────────────────────────────────
