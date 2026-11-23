//! C++ export that joins a path against the VM's cwd. Lives in `jsc/` because
//! it takes a `JSGlobalObject`; `paths/` is JSC-free.
//! Referenced from `PathInlines.h`.

use crate::JSGlobalObject;
use bun_core::String as BunString;

/// The C++ caller `transferToWTFString()`s the result.
#[unsafe(no_mangle)]
extern "C" fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    global_object: &JSGlobalObject,
    input: &BunString,
) -> BunString {
    let str = input.to_utf8();

    // The cwd is the FileSystem singleton's top_level_dir (resolver_jsc.rs
    // uses the same backing storage).
    let cwd: &[u8] = bun_core::working_directory_in_executable()
        .unwrap_or_else(|| bun_paths::fs::FileSystem::instance().top_level_dir());
    let _ = global_object; // the cwd is process-wide

    let mut path = bun_paths::Path::resolve(&[cwd, str.slice()]);
    path.copy_trailing_sep_from(str.slice());
    BunString::clone_utf8(&path)
}
