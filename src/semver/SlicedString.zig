buf: string,
slice: string,

pub inline fn init(buf: string, slice: string) SlicedString {
    if (Environment.allow_assert and !@inComptime()) {
        if (@intFromPtr(buf.ptr) > @intFromPtr(slice.ptr)) {
            @panic("SlicedString.init buf is not in front of slice");
        }
    }
    return SlicedString{ .buf = buf, .slice = slice };
}

pub inline fn external(this: SlicedString) ExternalString {
    if (comptime Environment.allow_assert) {
        assert(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.slice.ptr) and ((@intFromPtr(this.slice.ptr) + this.slice.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)));
    }

    return ExternalString.init(this.buf, this.slice, bun.Wyhash11.hash(0, this.slice));
}

pub inline fn value(this: SlicedString) String {
    if (comptime Environment.allow_assert) {
        assert(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.slice.ptr) and ((@intFromPtr(this.slice.ptr) + this.slice.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)));
    }

    return String.init(this.buf, this.slice);
}

pub inline fn sub(this: SlicedString, input: string) SlicedString {
    if (Environment.allow_assert) {
        if (!(@intFromPtr(this.buf.ptr) <= @intFromPtr(this.buf.ptr) and ((@intFromPtr(input.ptr) + input.len) <= (@intFromPtr(this.buf.ptr) + this.buf.len)))) {
            @panic("SlicedString.sub input is not a substring of the slice");
        }
    }
    return SlicedString{ .buf = this.buf, .slice = input };
}

const SlicedString = @This();
const assert = bun.assert;
const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSC = bun.JSC;
const IdentityContext = bun.IdentityContext;
const OOM = bun.OOM;
const TruncatedPackageNameHash = bun.install.TruncatedPackageNameHash;
const Lockfile = bun.install.Lockfile;
const ExternalString = bun.Semver.ExternalString;
const String = bun.Semver.String;
