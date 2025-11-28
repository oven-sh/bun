pub const SystemError = extern struct {
    errno: c_int = 0,
    /// label for errno
    code: String = .empty,
    message: String, // it is illegal to have an empty message
    path: String = .empty,
    syscall: String = .empty,
    hostname: String = .empty,
    /// MinInt = no file descriptor
    fd: c_int = std.math.minInt(c_int),
    dest: String = .empty,

    pub fn Maybe(comptime Result: type) type {
        return union(enum) {
            err: SystemError,
            result: Result,
        };
    }

    extern fn SystemError__toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue;
    extern fn SystemError__toErrorInstanceWithInfoObject(this: *const SystemError, global: *jsc.JSGlobalObject) JSValue;

    pub fn getErrno(this: *const SystemError) bun.sys.E {
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

    pub fn format(self: SystemError, writer: *std.Io.Writer) !void {
        if (!self.path.isEmpty()) {
            // TODO: remove this hardcoding
            switch (bun.Output.enable_ansi_colors_stderr) {
                inline else => |enable_colors| try writer.print(
                    comptime bun.Output.prettyFmt(
                        "<r><red>{f}<r><d>:<r> <b>{f}<r>: {f} <d>({f}())<r>",
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
                    "<r><red>{f}<r><d>:<r> {f} <d>({f}())<r>",
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

const std = @import("std");

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
