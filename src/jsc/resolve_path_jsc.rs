//! C++ export that joins a path against the VM's cwd. Lives in `jsc/` because
//! it reaches into `globalObject.bunVM().transpiler.fs`; `paths/` is JSC-free.
//! Referenced from `PathInlines.h`.

use bun_jsc::JSGlobalObject;
use bun_paths as path;
use bun_str::String as BunString;

#[unsafe(no_mangle)]
pub extern "C" fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    global_object: &JSGlobalObject,
    input: BunString,
) -> BunString {
    let str = input.to_utf8_without_ref();

    let cwd: &[u8] = global_object.bun_vm().transpiler.fs.top_level_dir;

    // The input is user-controlled and may be arbitrarily long. The
    // threadlocal `join_buf` is only 4096 bytes, so allocate a buffer sized
    // to fit. Zig used a StackFallbackAllocator(4096) here.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut buf = vec![0u8; cwd.len() + str.slice().len() + 2];

    let out_slice = path::join_abs_string_buf(
        cwd,
        &mut buf,
        &[str.slice()],
        path::Platform::Auto,
    );

    BunString::clone_utf8(out_slice)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/resolve_path_jsc.zig (33 lines)
//   confidence: high
//   todos:      0
//   notes:      extern "C" export name preserved verbatim for PathInlines.h linkage; field path bun_vm().transpiler.fs.top_level_dir may need accessor in Phase B
// ──────────────────────────────────────────────────────────────────────────
