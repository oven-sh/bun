const TextEncoderStreamEncoder = @This();

pending_lead_surrogate: ?u16 = null,

const log = Output.scoped(.TextEncoderStreamEncoder, .visible);

pub const js = jsc.Codegen.JSTextEncoderStreamEncoder;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const new = bun.TrivialNew(TextEncoderStreamEncoder);

pub fn finalize(this: *TextEncoderStreamEncoder) void {
    bun.destroy(this);
}

pub fn constructor(_: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*TextEncoderStreamEncoder {
    return TextEncoderStreamEncoder.new(.{});
}

pub fn encode(this: *TextEncoderStreamEncoder, globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("TextEncoderStreamEncoder.encode", 1, arguments.len);
    }

    const str = try arguments[0].getZigString(globalObject);

    if (str.is16Bit()) {
        return this.encodeUTF16(globalObject, str.utf16SliceAligned());
    }

    return this.encodeLatin1(globalObject, str.slice());
}

pub fn encodeWithoutTypeChecks(this: *TextEncoderStreamEncoder, globalObject: *jsc.JSGlobalObject, input: *jsc.JSString) JSValue {
    const str = input.getZigString(globalObject);

    if (str.is16Bit()) {
        return this.encodeUTF16(globalObject, str.utf16SliceAligned());
    }

    return this.encodeLatin1(globalObject, str.slice());
}

fn encodeLatin1(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, input: []const u8) JSValue {
    log("encodeLatin1: \"{s}\"", .{input});

    if (input.len == 0) return JSUint8Array.createEmpty(globalObject);

    const prepend_replacement_len: usize = prepend_replacement: {
        if (this.pending_lead_surrogate != null) {
            this.pending_lead_surrogate = null;
            // no latin1 surrogate pairs
            break :prepend_replacement 3;
        }

        break :prepend_replacement 0;
    };
    // In a previous benchmark, counting the length took about as much time as allocating the buffer.
    //
    // Benchmark    Time %    CPU (ns)    Iterations    Ratio
    // 288.00 ms   13.5%    288.00 ms           simdutf::arm64::implementation::convert_latin1_to_utf8(char const*, unsigned long, char*) const
    // 278.00 ms   13.0%    278.00 ms           simdutf::arm64::implementation::utf8_length_from_latin1(char const*, unsigned long) const
    //
    //
    var buffer = std.array_list.Managed(u8).initCapacity(bun.default_allocator, input.len + prepend_replacement_len) catch {
        return globalObject.throwOutOfMemoryValue();
    };
    if (prepend_replacement_len > 0) {
        buffer.appendSliceAssumeCapacity(&[3]u8{ 0xef, 0xbf, 0xbd });
    }

    var remain = input;
    while (remain.len > 0) {
        const result = strings.copyLatin1IntoUTF8(buffer.unusedCapacitySlice(), remain);

        buffer.items.len += result.written;
        remain = remain[result.read..];

        if (result.written == 0 and result.read == 0) {
            buffer.ensureUnusedCapacity(2) catch {
                buffer.deinit();
                return globalObject.throwOutOfMemoryValue();
            };
        } else if (buffer.items.len == buffer.capacity and remain.len > 0) {
            buffer.ensureTotalCapacity(buffer.items.len + remain.len + 1) catch {
                buffer.deinit();
                return globalObject.throwOutOfMemoryValue();
            };
        }
    }

    if (comptime Environment.isDebug) {
        // wrap in comptime if so simdutf isn't called in a release build here.
        bun.debugAssert(buffer.items.len == (bun.simdutf.length.utf8.from.latin1(input) + prepend_replacement_len));
    }

    return jsc.JSUint8Array.fromBytes(globalObject, buffer.items);
}

fn encodeUTF16(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, input: []const u16) JSValue {
    log("encodeUTF16: \"{f}\"", .{bun.fmt.utf16(input)});

    if (input.len == 0) return JSUint8Array.createEmpty(globalObject);

    const Prepend = struct {
        bytes: [4]u8,
        len: u8,

        pub const replacement: @This() = .{ .bytes = .{ 0xef, 0xbf, 0xbd, 0 }, .len = 3 };

        pub fn fromSequence(seq: [4]u8, length: u8) @This() {
            return .{ .bytes = seq, .len = length };
        }
    };

    var remain = input;

    const prepend: ?Prepend = prepend: {
        if (this.pending_lead_surrogate) |lead| {
            this.pending_lead_surrogate = null;
            const maybe_trail = remain[0];
            if (strings.u16IsTrail(maybe_trail)) {
                const converted = strings.utf16CodepointWithFFFD(&.{ lead, maybe_trail });
                // shouldn't fail because `u16IsTrail` is true and `pending_lead_surrogate` is always
                // a valid lead.
                bun.debugAssert(!converted.fail);

                const sequence = strings.wtf8Sequence(converted.code_point);

                remain = remain[1..];
                if (remain.len == 0) {
                    return JSUint8Array.fromBytesCopy(
                        globalObject,
                        sequence[0..converted.utf8Width()],
                    );
                }

                break :prepend Prepend.fromSequence(sequence, converted.utf8Width());
            }

            break :prepend Prepend.replacement;
        }
        break :prepend null;
    };

    const length = bun.simdutf.length.utf8.from.utf16.le(remain);

    var buf = std.array_list.Managed(u8).initCapacity(
        bun.default_allocator,
        length + @as(usize, if (prepend) |pre| pre.len else 0),
    ) catch {
        return globalObject.throwOutOfMemoryValue();
    };

    if (prepend) |*pre| {
        buf.appendSliceAssumeCapacity(pre.bytes[0..pre.len]);
    }

    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(remain, buf.unusedCapacitySlice());

    switch (result.status) {
        else => {
            // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
            const lead_surrogate = strings.toUTF8ListWithTypeBun(&buf, remain, true) catch {
                buf.deinit();
                return globalObject.throwOutOfMemoryValue();
            };

            if (lead_surrogate) |pending_lead| {
                this.pending_lead_surrogate = pending_lead;
                if (buf.items.len == 0) return JSUint8Array.createEmpty(globalObject);
            }

            return jsc.JSUint8Array.fromBytes(globalObject, buf.items);
        },
        .success => {
            buf.items.len += result.count;
            return jsc.JSUint8Array.fromBytes(globalObject, buf.items);
        },
    }
}

pub fn flush(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    return flushBody(this, globalObject);
}

pub fn flushWithoutTypeChecks(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject) JSValue {
    return flushBody(this, globalObject);
}

fn flushBody(this: *TextEncoderStreamEncoder, globalObject: *JSGlobalObject) JSValue {
    return if (this.pending_lead_surrogate == null)
        JSUint8Array.createEmpty(globalObject)
    else
        JSUint8Array.fromBytesCopy(globalObject, &.{ 0xef, 0xbf, 0xbd });
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSUint8Array = jsc.JSUint8Array;
const JSValue = jsc.JSValue;
