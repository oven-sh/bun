pub const CommandDescriptor = enum {
    APPEND,
    BITCOUNT,
    HMSET,
    HMGET,
    BLMOVE,
    BLMPOP,
    HINCRBY,
    BLPOP,
    BRPOP,
    BZMPOP,
    BZPOPMAX,
    BZPOPMIN,
    COPY,
    DECR,
    DECRBY,
    DEL,
    DUMP,
    EXISTS,
    EXPIREAT,
    EXPIRETIME,
    GET,
    GETBIT,
    GETDEL,
    GETEX,
    GETSET,
    HDEL,
    HELLO,
    HGET,
    HGETALL,
    HINCRBYFLOAT,
    HKEYS,
    HLEN,
    HRANDFIELD,
    HSCAN,
    HSTRLEN,
    HVALS,
    INCR,
    INCRBY,
    INCRBYFLOAT,
    KEYS,
    LINDEX,
    LINSERT,
    LLEN,
    LMOVE,
    LMPOP,
    LPOP,
    LPOS,
    LPUSH,
    LPUSHX,
    MGET,
    MSET,
    MSETNX,
    PERSIST,
    PEXPIRE,
    PEXPIREAT,
    PEXPIRETIME,
    RPUSH,
    RPUSHX,
    ZMSCORE,
    ZREMRANGEBYLEX,
    ZREMRANGEBYRANK,
    ZREMRANGEBYSCORE,
    PFADD,
    PING,
    PTTL,
    RANDOMKEY,
    RENAME,
    RENAMENX,
    RPOP,
    RPOPLPUSH,
    SCAN,
    SCARD,
    SCRIPT,
    SDIFF,
    SDIFFSTORE,
    SELECT,
    SET,
    SETNX,
    SINTER,
    SINTERCARD,
    SINTERSTORE,
    SMISMEMBER,
    SPUBLISH,
    SSCAN,
    STRLEN,
    SUNION,
    SUNIONSTORE,
    TOUCH,
    TYPE,
    UNLINK,
    ZADD,
    ZCARD,
    ZDIFF,
    ZDIFFSTORE,
    ZINTER,
    ZINTERCARD,
    ZINTERSTORE,
    ZMPOP,
    ZPOPMAX,
    ZPOPMIN,
    ZRANDMEMBER,
    ZRANGE,
    ZRANGEBYLEX,
    ZRANGEBYSCORE,
    ZRANGESTORE,
    ZRANK,
    ZREM,
    ZREVRANGE,
    ZREVRANGEBYLEX,
    ZREVRANGEBYSCORE,
    ZREVRANK,
    ZSCAN,
    ZSCORE,
    ZUNION,
    ZUNIONSTORE,

    BRPOPLPUSH,
    TTL,
    SREM,
    SETBIT,
    GETRANGE,
    SETRANGE,
    LRANGE,
    LREM,
    LSET,
    LTRIM,
    SMEMBERS,
    ZCOUNT,
    ZLEXCOUNT,
    SETEX,
    PSETEX,
    ZINCRBY,
    SUBSTR,
    SISMEMBER,
    HTTL,
    SMOVE,
    SADD,
    SPOP,
    SRANDMEMBER,
    HSETNX,
    HPTTL,

    HGETDEL,
    HGETEX,
    HSETEX,
    HSET,
    HEXPIRE,
    HEXPIREAT,
    HEXPIRETIME,
    HPERSIST,
    HPEXPIRE,
    HPEXPIREAT,
    HPEXPIRETIME,

    // TODO(markovejnovic): Test this better
    HEXISTS,

    pub fn returnsBool(self: CommandDescriptor) bool {
        return switch (self) {
            .EXISTS, .SISMEMBER, .HSETNX, .HEXISTS, .SMOVE => true,
            else => false,
        };
    }

    pub fn toString(self: CommandDescriptor) []const u8 {
        return switch (self) {
            else => |enum_value| @tagName(enum_value),
        };
    }

    /// Whether this command can be pipelined or not.
    ///
    /// This is pretty important as some commands cannot really be pipelined and require flushing
    /// any pending commands before executing them.
    pub fn canBePipelined(self: CommandDescriptor) bool {
        return switch (self) {
            .HELLO => false,
            else => true,
        };
    }
};

pub const Command = struct {
    const Self = @This();

    command: union(enum) {
        inline_str: []const u8,
        command_id: CommandDescriptor,

        /// Test whether this command is one which returns a boolean value.
        pub fn returnsBool(self: @This()) bool {
            return switch (self) {
                .inline_str => |_| false,
                .command_id => |id| id.returnsBool(),
            };
        }

        pub fn toString(self: @This()) []const u8 {
            return switch (self) {
                .inline_str => |s| s,
                .command_id => |id| id.toString(),
            };
        }
    },
    args: CommandArgs,

    pub fn initDirect(command: []const u8, args: CommandArgs) Self {
        return Self{ .command = .{ .inline_str = command }, .args = args };
    }

    pub fn initById(command: CommandDescriptor, args: CommandArgs) Self {
        return Self{ .command = .{ .command_id = command }, .args = args };
    }

    pub fn serialize(self: *const Self, allocator: std.mem.Allocator) ![]u8 {
        var buf = try std.ArrayList(u8).initCapacity(allocator, self.byteLength());
        errdefer buf.deinit();
        try self.write(buf.writer());
        return buf.items;
    }

    pub fn format(
        this: Self,
        comptime _: []const u8,
        _: std.fmt.FormatOptions,
        writer: anytype,
    ) !void {
        try this.write(writer);
    }

    pub fn byteLength(self: *const Self) usize {
        return std.fmt.count("{}", .{self.*});
    }

    pub fn canBePipelined(self: *const Self) bool {
        return switch (self.command) {
            // TODO(markovejnovic): This doesn't make too much sense to me since we don't know what
            // the command is. Maybe we should assume the worst and say it can't be pipelined?
            // However, this was the legacy behavior so I decided not to change it for now.
            .inline_str => |_| return true,
            .command_id => |id| return id.canBePipelined(),
        };
    }

    pub fn returnsBool(self: *const Self) bool {
        return self.command.returnsBool();
    }

    /// Write the command in RESP format to the given writer
    pub fn write(this: *const Self, writer: anytype) !void {
        try writer.print("*{d}\r\n", .{1 + this.args.len()});
        try writer.print("${d}\r\n{s}\r\n", .{
            this.command.toString().len,
            this.command.toString(),
        });

        switch (this.args) {
            inline .slices, .args => |args| {
                for (args) |*arg| {
                    try writer.print(
                        "${d}\r\n{s}\r\n",
                        .{ arg.byteLength(), arg.slice() },
                    );
                }
            },
            .raw => |args| {
                for (args) |arg| {
                    try writer.print("${d}\r\n{s}\r\n", .{ arg.len, arg });
                }
            },
        }
    }
};

pub const CommandArgs = union(enum) {
    slices: []const bun.jsc.ZigString.Slice,
    args: []const bun.api.node.BlobOrStringOrBuffer,
    raw: []const []const u8,

    pub fn len(this: *const @This()) usize {
        return switch (this.*) {
            inline .slices, .args, .raw => |args| args.len,
        };
    }
};

const bun = @import("bun");
const std = @import("std");
