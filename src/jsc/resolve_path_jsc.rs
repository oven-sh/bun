//! C++ export that joins a path against the VM's cwd. Lives in `jsc/` because
//! it reaches into `globalObject.bunVM().transpiler.fs`; `paths/` is JSC-free.
//! Referenced from `PathInlines.h`.

use crate::JSGlobalObject;
use bun_core::String as BunString;
use bun_paths::resolve_path;

#[unsafe(no_mangle)]
pub extern "C" fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    global_object: &JSGlobalObject,
    input: BunString,
) -> BunString {
    let str = input.to_utf8_without_ref();

    // Spec: `globalObject.bunVM().transpiler.fs.top_level_dir`. The Phase-B
    // `Transpiler` shape doesn't expose `fs` directly; the singleton accessor
    // is the same backing storage (resolver_jsc.rs uses it identically).
    let cwd: &[u8] = bun_paths::fs::FileSystem::instance().top_level_dir();
    let _ = global_object; // bun_vm() retained for future direct field access

    // The input is user-controlled and may be arbitrarily long. The
    // threadlocal `join_buf` is only 4096 bytes, so allocate a buffer sized
    // to fit. Zig used a StackFallbackAllocator(4096) here.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut buf = vec![0u8; cwd.len() + str.slice().len() + 2];

    let out_slice = resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        cwd,
        &mut buf,
        &[str.slice()],
    );

    BunString::clone_utf8(out_slice)
}

// ported from: src/jsc/resolve_path_jsc.zig
