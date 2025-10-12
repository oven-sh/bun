pub const CommandTag = union(enum) {
    // For an INSERT command, the tag is INSERT oid rows, where rows is the
    // number of rows inserted. oid used to be the object ID of the inserted
    // row if rows was 1 and the target table had OIDs, but OIDs system
    // columns are not supported anymore; therefore oid is always 0.
    INSERT: u64,
    // For a DELETE command, the tag is DELETE rows where rows is the number
    // of rows deleted.
    DELETE: u64,
    // For an UPDATE command, the tag is UPDATE rows where rows is the
    // number of rows updated.
    UPDATE: u64,
    // For a MERGE command, the tag is MERGE rows where rows is the number
    // of rows inserted, updated, or deleted.
    MERGE: u64,
    // For a SELECT or CREATE TABLE AS command, the tag is SELECT rows where
    // rows is the number of rows retrieved.
    SELECT: u64,
    // For a MOVE command, the tag is MOVE rows where rows is the number of
    // rows the cursor's position has been changed by.
    MOVE: u64,
    // For a FETCH command, the tag is FETCH rows where rows is the number
    // of rows that have been retrieved from the cursor.
    FETCH: u64,
    // For a COPY command, the tag is COPY rows where rows is the number of
    // rows copied. (Note: the row count appears only in PostgreSQL 8.2 and
    // later.)
    COPY: u64,

    other: []const u8,

    pub fn toJSTag(this: CommandTag, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return switch (this) {
            .INSERT => JSValue.jsNumber(1),
            .DELETE => JSValue.jsNumber(2),
            .UPDATE => JSValue.jsNumber(3),
            .MERGE => JSValue.jsNumber(4),
            .SELECT => JSValue.jsNumber(5),
            .MOVE => JSValue.jsNumber(6),
            .FETCH => JSValue.jsNumber(7),
            .COPY => JSValue.jsNumber(8),
            .other => |tag| bun.String.createUTF8ForJS(globalObject, tag),
        };
    }

    pub fn toJSNumber(this: CommandTag) JSValue {
        return switch (this) {
            .other => JSValue.jsNumber(0),
            inline else => |val| JSValue.jsNumber(val),
        };
    }

    const KnownCommand = enum {
        INSERT,
        DELETE,
        UPDATE,
        MERGE,
        SELECT,
        MOVE,
        FETCH,
        COPY,

        pub const Map = bun.ComptimeEnumMap(KnownCommand);
    };

    pub fn init(tag: []const u8) CommandTag {
        const first_space_index = bun.strings.indexOfChar(tag, ' ') orelse return .{ .other = tag };
        const cmd = KnownCommand.Map.get(tag[0..first_space_index]) orelse return .{
            .other = tag,
        };

        const number = brk: {
            switch (cmd) {
                .INSERT => {
                    var remaining = tag[@min(first_space_index + 1, tag.len)..];
                    const second_space = bun.strings.indexOfChar(remaining, ' ') orelse return .{ .other = tag };
                    remaining = remaining[@min(second_space + 1, remaining.len)..];
                    break :brk std.fmt.parseInt(u64, remaining, 0) catch |err| {
                        debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                        return .{ .other = tag };
                    };
                },
                else => {
                    const after_tag = tag[@min(first_space_index + 1, tag.len)..];
                    break :brk std.fmt.parseInt(u64, after_tag, 0) catch |err| {
                        debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                        return .{ .other = tag };
                    };
                },
            }
        };

        switch (cmd) {
            inline else => |t| return @unionInit(CommandTag, @tagName(t), number),
        }
    }
};

const debug = bun.Output.scoped(.Postgres, .visible);

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
