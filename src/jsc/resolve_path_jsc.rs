//! C++ export that joins a path against the VM's cwd. Lives in `jsc/` because
//! it reaches into `globalObject.bunVM().transpiler.fs`; `paths/` is JSC-free.
//! Referenced from `PathInlines.h`.

use crate::JSGlobalObject;
use bun_core::String as BunString;
use bun_paths::resolve_path;

/// The C++ caller `transferToWTFString()`s the result.
#[unsafe(no_mangle)]
extern "C" fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    global_object: &JSGlobalObject,
    input: &BunString,
) -> BunString {
    let str = input.to_utf8();

    // The cwd is the FileSystem singleton's top_level_dir (resolver_jsc.rs
    // uses the same backing storage).
    let cwd: &[u8] = bun_paths::fs::FileSystem::instance().top_level_dir();
    let _ = global_object; // bun_vm() retained for future direct field access

    // The input is user-controlled and may be arbitrarily long. The
    // threadlocal `join_buf` is only 4096 bytes, so allocate a buffer sized
    // to fit.
    let mut buf = vec![0u8; cwd.len() + str.slice().len() + 2];

    let out_slice = resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        cwd,
        &mut buf,
        &[str.slice()],
    );

    BunString::clone_utf8(out_slice)
}

pub mod testing_apis {
    use crate::bun_string_jsc::to_js;
    use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};
    use bun_core::String as BunString;

    /// `pathsInternals.withoutTrailingSlashWindows` in `internal-for-testing.ts`.
    #[bun_jsc::host_fn]
    pub fn without_trailing_slash_windows(
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let path_value = call_frame.argument(0);
        if !path_value.is_string() {
            return Err(global.throw(format_args!("expected a string path")));
        }
        let path = path_value.to_slice(global)?;

        let output = BunString::clone_utf8(
            bun_paths::string_paths::without_trailing_slash_windows(path.slice()),
        );
        let js = to_js(&output, global);
        output.deref();
        js
    }
}
