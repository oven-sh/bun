//! C++ export that joins a path against the VM's cwd. Lives in `jsc/` because
//! it reaches into `globalObject.bunVM().transpiler.fs`; `paths/` is JSC-free.
//! Referenced from `PathInlines.h`.

export fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    globalObject: *bun.jsc.JSGlobalObject,
    in: bun.String,
) bun.String {
    const str = in.toUTF8WithoutRef(bun.default_allocator);
    defer str.deinit();

    const cwd = globalObject.bunVM().transpiler.fs.top_level_dir;

    // The input is user-controlled and may be arbitrarily long. The
    // threadlocal `join_buf` is only 4096 bytes, so use a stack-fallback
    // allocator that heap-allocates for oversized inputs.
    var sfa = std.heap.stackFallback(4096, bun.default_allocator);
    const alloc = sfa.get();
    const buf = bun.handleOom(alloc.alloc(u8, cwd.len + str.slice().len + 2));
    defer alloc.free(buf);

    const out_slice = bun.path.joinAbsStringBuf(
        cwd,
        buf,
        &.{str.slice()},
        .auto,
    );

    return bun.String.cloneUTF8(out_slice);
}

const bun = @import("bun");
const std = @import("std");
