const bun = @import("root").bun;
const Environment = bun.Environment;

/// Returns null on error. Use windows API to lookup the actual error.
/// The reason this function is in zig is so that we can use our own utf16-conversion functions.
///
/// Using characters16() does not seem to always have the sentinel. or something else
/// broke when I just used it. Not sure. ... but this works!
pub export fn Bun__LoadLibraryBunString(str: *bun.String) ?*anyopaque {
    if (comptime !Environment.isWindows) {
        unreachable;
    }

    var buf: bun.WPathBuffer = undefined;
    const data = switch (str.encoding()) {
        .utf8 => bun.strings.convertUTF8toUTF16InBuffer(&buf, str.utf8()),
        .utf16 => brk: {
            @memcpy(buf[0..str.length()], str.utf16());
            break :brk buf[0..str.length()];
        },
        .latin1 => brk: {
            bun.strings.copyU8IntoU16(&buf, str.latin1());
            break :brk buf[0..str.length()];
        },
    };
    buf[data.len] = 0;
    const LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
    return bun.windows.LoadLibraryExW(buf[0..data.len :0].ptr, null, LOAD_WITH_ALTERED_SEARCH_PATH);
}
