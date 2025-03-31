const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const String = bun.String;
const ZigString = @import("ZigString.zig");
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub const SystemError = extern struct {
    errno: c_int = 0,
    /// label for errno
    code: String = String.empty,
    message: String = String.empty,
    path: String = String.empty,
    syscall: String = String.empty,
    hostname: String = String.empty,
    fd: bun.FileDescriptor = bun.toFD(-1),
    dest: String = String.empty,

    pub fn Maybe(comptime Result: type) type {
        return union(enum) {
            err: SystemError,
            result: Result,
        };
    }

    extern fn SystemError__toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue;
    extern fn SystemError__toErrorInstanceWithInfoObject(this: *const SystemError, global: *JSC.JSGlobalObject) JSValue;

    pub fn getErrno(this: *const SystemError) bun.C.E {
        // The inverse in bun.sys.Error.toSystemError()
        return @enumFromInt(this.errno * -1);
    }

    pub fn deref(this: *const SystemError) void {
        this.path.deref();
        this.code.deref();
        this.message.deref();
        this.syscall.deref();
        this.hostname.deref();
        this.dest.deref();
    }

    pub fn ref(this: *SystemError) void {
        this.path.ref();
        this.code.ref();
        this.message.ref();
        this.syscall.ref();
        this.hostname.ref();
        this.dest.ref();
    }

    pub fn toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue {
        defer this.deref();

        return SystemError__toErrorInstance(this, global);
    }

    /// This constructs the ERR_SYSTEM_ERROR error object, which has an `info`
    /// property containing the details of the system error:
    ///
    /// SystemError [ERR_SYSTEM_ERROR]: A system error occurred: {syscall} returned {errno} ({message})
    /// {
    ///     name: "ERR_SYSTEM_ERROR",
    ///     info: {
    ///         errno: -{errno},
    ///         code: {code},        // string
    ///         message: {message},  // string
    ///         syscall: {syscall},  // string
    ///     },
    ///     errno: -{errno},
    ///     syscall: {syscall},
    /// }
    ///
    /// Before using this function, consider if the Node.js API it is
    /// implementing follows this convention. It is exclusively used
    /// to match the error code that `node:os` throws.
    pub fn toErrorInstanceWithInfoObject(this: *const SystemError, global: *JSGlobalObject) JSValue {
        defer this.deref();

        return SystemError__toErrorInstanceWithInfoObject(this, global);
    }

    pub fn format(self: SystemError, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (!self.path.isEmpty()) {
            // TODO: remove this hardcoding
            switch (bun.Output.enable_ansi_colors_stderr) {
                inline else => |enable_colors| try writer.print(
                    comptime bun.Output.prettyFmt(
                        "<r><red>{}<r><d>:<r> <b>{s}<r>: {} <d>({}())<r>",
                        enable_colors,
                    ),
                    .{
                        self.code,
                        self.path,
                        self.message,
                        self.syscall,
                    },
                ),
            }
        } else
        // TODO: remove this hardcoding
        switch (bun.Output.enable_ansi_colors_stderr) {
            inline else => |enable_colors| try writer.print(
                comptime bun.Output.prettyFmt(
                    "<r><red>{}<r><d>:<r> {} <d>({}())<r>",
                    enable_colors,
                ),
                .{
                    self.code,
                    self.message,
                    self.syscall,
                },
            ),
        }
    }
};
