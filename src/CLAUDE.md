# Image library

We are implementing a high-performance streaming image library in Zig. The end goal is to have a simple builtin alternative to `sharp` for Bun. Avoid memory allocation at all costs. Prefer passing in buffers and writing to them.

1. Image resizing algorithms (streaming)
2. Pixel format conversion (streaming)
3. Image encoding and decoding (streaming)

Let's get started

1. Image resizing algorithms

- [x] src/image/lanczos3.zig: lanczos3 algorithm
- [x] src/image/bicubic.zig: bicubic algorithm
- [x] src/image/bilinear.zig: bilinear algorithm
- [x] src/image/box.zig: box algorithm

Run `zig test src/image/lanczos3.zig` to test the lanczos3 algorithm.
Run `zig test src/image/scaling_tests.zig` to run more comprehensive resizing tests (but next time lets put it in the same file)
Run `zig test src/image/bicubic.zig` to test the bicubic algorithm.
Run `zig test src/image/bilinear.zig` to test the bilinear algorithm.
Run `zig test src/image/box.zig` to test the box algorithm.

If you want to create a sample program just make a `main` function in the file.

2. Pixel format conversion

- [x] src/image/pixel_format.zig: pixel format conversion

Run `zig test src/image/pixel_format.zig` to test the pixel format conversion.

3. Image encoding and decoding

- [x] src/image/encoder.zig: Platform-agnostic encoder interface
- [x] src/image/encoder_darwin.zig: macOS encoder using CoreGraphics and ImageIO
- [ ] src/image/encoder_windows.zig: Windows encoder using WIC
- [ ] src/image/encoder_linux.zig: Linux encoder using libpng, libjpeg, etc.
- [x] Direct transcoding between formats (PNG ↔ JPEG, etc.) without pixel decoding
- [ ] src/image/decoder.zig: Platform-agnostic decoder interface

Run `zig test src/image/streaming_tests.zig` to test the streaming and encoder functionality.

Use Zig's @Vector intrinsics for SIMD. Here's a couple examples:

```
/// Count the occurrences of a character in an ASCII byte array
/// uses SIMD
pub fn countChar(self: string, char: u8) usize {
    var total: usize = 0;
    var remaining = self;

    const splatted: AsciiVector = @splat(char);

    while (remaining.len >= 16) {
        const vec: AsciiVector = remaining[0..ascii_vector_size].*;
        const cmp = @popCount(@as(@Vector(ascii_vector_size, u1), @bitCast(vec == splatted)));
        total += @as(usize, @reduce(.Add, cmp));
        remaining = remaining[ascii_vector_size..];
    }

    while (remaining.len > 0) {
        total += @as(usize, @intFromBool(remaining[0] == char));
        remaining = remaining[1..];
    }

    return total;
}

fn indexOfInterestingCharacterInStringLiteral(text_: []const u8, quote: u8) ?usize {
    var text = text_;
    const quote_: @Vector(strings.ascii_vector_size, u8) = @splat(@as(u8, quote));
    const backslash: @Vector(strings.ascii_vector_size, u8) = @splat(@as(u8, '\\'));
    const V1x16 = strings.AsciiVectorU1;

    while (text.len >= strings.ascii_vector_size) {
        const vec: strings.AsciiVector = text[0..strings.ascii_vector_size].*;

        const any_significant =
            @as(V1x16, @bitCast(vec > strings.max_16_ascii)) |
            @as(V1x16, @bitCast(vec < strings.min_16_ascii)) |
            @as(V1x16, @bitCast(quote_ == vec)) |
            @as(V1x16, @bitCast(backslash == vec));

        if (@reduce(.Max, any_significant) > 0) {
            const bitmask = @as(u16, @bitCast(any_significant));
            const first = @ctz(bitmask);
            bun.assert(first < strings.ascii_vector_size);
            return first + (@intFromPtr(text.ptr) - @intFromPtr(text_.ptr));
        }
        text = text[strings.ascii_vector_size..];
    }

    return null;
}
```

Some tips for working with Zig:

- It's `or` `and`, not `||` `&&`
- Zig changed it's syntax to use RLS, so `@as(Type, @truncate(value))` instead of `@truncate(Type, value)`
- Read vendor/zig/lib/std/simd.zig

Here's a complete list of Zig builtin functions:

- @addrSpaceCast
- @addWithOverflow
- @alignCast
- @alignOf
- @as
- @atomicLoad
- @atomicRmw
- @atomicStore
- @bitCast
- @bitOffsetOf
- @bitSizeOf
- @branchHint
- @breakpoint
- @mulAdd
- @byteSwap
- @bitReverse
- @offsetOf
- @call
- @cDefine
- @cImport
- @cInclude
- @clz
- @cmpxchgStrong
- @cmpxchgWeak
- @compileError
- @compileLog
- @constCast
- @ctz
- @cUndef
- @cVaArg
- @cVaCopy
- @cVaEnd
- @cVaStart
- @divExact
- @divFloor
- @divTrunc
- @embedFile
- @enumFromInt
- @errorFromInt
- @errorName
- @errorReturnTrace
- @errorCast
- @export
- @extern
- @field
- @fieldParentPtr
- @FieldType
- @floatCast
- @floatFromInt
- @frameAddress
- @hasDecl
- @hasField
- @import
- @inComptime
- @intCast
- @intFromBool
- @intFromEnum
- @intFromError
- @intFromFloat
- @intFromPtr
- @max
- @memcpy
- @memset
- @min
- @wasmMemorySize
- @wasmMemoryGrow
- @mod
- @mulWithOverflow
- @panic
- @popCount
- @prefetch
- @ptrCast
- @ptrFromInt
- @rem
- @returnAddress
- @select
- @setEvalBranchQuota
- @setFloatMode
- @setRuntimeSafety
- @shlExact
- @shlWithOverflow
- @shrExact
- @shuffle
- @sizeOf
- @splat
- @reduce
- @src
- @sqrt
- @sin
- @cos
- @tan
- @exp
- @exp2
- @log
- @log2
- @log10
- @abs
- @floor
- @ceil
- @trunc
- @round
- @subWithOverflow
- @tagName
- @This
- @trap
- @truncate
- @Type
- @typeInfo
- @typeName
- @TypeOf
- @unionInit
- @Vector
- @volatileCast
- @workGroupId
- @workGroupSize
- @workItemId
