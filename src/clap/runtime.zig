//! Runtime-params variant of `ComptimeClap`. The params slice and
//! param→storage-index mapping are still computed at comptime (see `ParamSet`)
//! so the binary carries one small table per distinct params list, but which
//! table to use is selected at *runtime*. Accessors (`flag`/`option`/`options`)
//! do a linear name scan at runtime instead of resolving to an array index at
//! compile time.
//!
//! Used by `Arguments.parse` so it can take `cmd: Command.Tag` as a runtime
//! value instead of `comptime cmd`, collapsing the per-command monomorphized
//! copies into one function body.
//!
//! Unlike `ComptimeClap`, looking up a flag/option that is not present in the
//! current params set is *not* an error — it returns `false` / `null` / `&.{}`.
//! Call sites are expected to guard per-command flags with `if (cmd == .X)`
//! anyway, so a missing flag is just one that never matched.

/// Precomputed metadata for one distinct params list.
///
/// `converted` mirrors `ComptimeClap`'s `converted_params`: each param's `id`
/// is its index into the matching storage slice (flags / single / multi).
pub const ParamSet = struct {
    converted: []const clap.Param(usize),
    n_flags: usize,
    n_single: usize,
    n_multi: usize,

    pub fn init(comptime params: []const clap.Param(clap.Help)) ParamSet {
        @setEvalBranchQuota(1_000_000);
        comptime var n_flags: usize = 0;
        comptime var n_single: usize = 0;
        comptime var n_multi: usize = 0;
        comptime var converted: []const clap.Param(usize) = &.{};
        inline for (params) |param| {
            comptime var index: usize = 0;
            if (param.names.long != null or param.names.short != null) {
                switch (param.takes_value) {
                    .none => {
                        index = n_flags;
                        n_flags += 1;
                    },
                    .one, .one_optional => {
                        index = n_single;
                        n_single += 1;
                    },
                    .many => {
                        index = n_multi;
                        n_multi += 1;
                    },
                }
            }
            converted = converted ++ [_]clap.Param(usize){.{
                .id = index,
                .names = param.names,
                .takes_value = param.takes_value,
            }};
        }
        return .{
            .converted = converted,
            .n_flags = n_flags,
            .n_single = n_single,
            .n_multi = n_multi,
        };
    }
};

/// Parsed arguments with runtime-sized storage. Interface matches
/// `clap.Args(...)` so call sites can swap between the two.
pub const RuntimeArgs = struct {
    arena: bun.ArenaAllocator,
    exe_arg: ?[:0]const u8,

    params: []const clap.Param(usize),
    flags_storage: []bool,
    single_storage: []?[]const u8,
    multi_storage: [][]const []const u8,
    pos: []const []const u8,
    passthrough_positionals: []const []const u8,

    pub fn deinit(self: *RuntimeArgs) void {
        self.arena.deinit();
    }

    pub fn flag(self: *const RuntimeArgs, name: []const u8) bool {
        const param = self.findParam(name) orelse return false;
        if (param.takes_value != .none) return false;
        return self.flags_storage[param.id];
    }

    pub fn option(self: *const RuntimeArgs, name: []const u8) ?[]const u8 {
        const param = self.findParam(name) orelse return null;
        if (param.takes_value != .one and param.takes_value != .one_optional) return null;
        return self.single_storage[param.id];
    }

    pub fn options(self: *const RuntimeArgs, name: []const u8) []const []const u8 {
        const param = self.findParam(name) orelse return &.{};
        if (param.takes_value != .many) return &.{};
        return self.multi_storage[param.id];
    }

    pub fn positionals(self: *const RuntimeArgs) []const []const u8 {
        return self.pos;
    }

    pub fn remaining(self: *const RuntimeArgs) []const []const u8 {
        return self.passthrough_positionals;
    }

    fn findParam(self: *const RuntimeArgs, name: []const u8) ?*const clap.Param(usize) {
        // Name is always a string literal with leading dashes ("-s" or "--long").
        for (self.params) |*param| {
            if (name.len == 2 and name[0] == '-') {
                if (param.names.short) |s| {
                    if (name[1] == s) return param;
                }
            }
            if (name.len > 2 and name[0] == '-' and name[1] == '-') {
                const bare = name[2..];
                if (param.names.long) |l| {
                    if (mem.eql(u8, bare, l)) return param;
                }
                for (param.names.long_aliases) |alias| {
                    if (mem.eql(u8, bare, alias)) return param;
                }
            }
        }
        return null;
    }
};

/// Same as `clap.parse` but with a runtime `ParamSet` and dynamically sized
/// storage. Uses `args.OsIterator` (reads `bun.argv`).
pub fn parse(set: *const ParamSet, opt: clap.ParseOptions) !RuntimeArgs {
    var iter = clap.args.OsIterator.init(opt.allocator);
    var res = RuntimeArgs{
        .arena = iter.arena,
        .exe_arg = iter.exe_arg,
        .params = set.converted,
        .flags_storage = &.{},
        .single_storage = &.{},
        .multi_storage = &.{},
        .pos = &.{},
        .passthrough_positionals = &.{},
    };
    const arena_alloc = res.arena.allocator();

    res.flags_storage = try arena_alloc.alloc(bool, set.n_flags);
    @memset(res.flags_storage, false);
    res.single_storage = try arena_alloc.alloc(?[]const u8, set.n_single);
    @memset(res.single_storage, null);
    res.multi_storage = try arena_alloc.alloc([]const []const u8, set.n_multi);
    @memset(res.multi_storage, &.{});

    var multis = try arena_alloc.alloc(std.array_list.Managed([]const u8), set.n_multi);
    for (multis) |*multi| {
        multi.* = std.array_list.Managed([]const u8).init(arena_alloc);
    }

    var pos = std.array_list.Managed([]const u8).init(arena_alloc);
    var passthrough_positionals = std.array_list.Managed([]const u8).init(arena_alloc);

    var stream = clap.StreamingClap(usize, clap.args.OsIterator){
        .params = set.converted,
        .iter = &iter,
        .diagnostic = opt.diagnostic,
    };

    while (try stream.next()) |arg| {
        const param = arg.param;
        if (param.names.long == null and param.names.short == null) {
            try pos.append(arg.value.?);
            if (opt.stop_after_positional_at > 0 and pos.items.len >= opt.stop_after_positional_at) {
                var remaining_ = stream.iter.remain;
                const first: []const u8 = if (remaining_.len > 0) bun.span(remaining_[0]) else "";
                if (first.len > 0 and mem.eql(u8, first, "--")) {
                    remaining_ = remaining_[1..];
                }

                try passthrough_positionals.ensureTotalCapacityPrecise(remaining_.len);
                for (remaining_) |arg_| {
                    // use bun.span due to the optimization for long strings
                    passthrough_positionals.appendAssumeCapacity(bun.span(arg_));
                }
                break;
            }
        } else if (param.takes_value == .one or param.takes_value == .one_optional) {
            debug.assert(res.single_storage.len != 0);
            if (res.single_storage.len != 0)
                res.single_storage[param.id] = arg.value orelse "";
        } else if (param.takes_value == .many) {
            debug.assert(multis.len != 0);
            if (multis.len != 0)
                try multis[param.id].append(arg.value.?);
        } else {
            debug.assert(res.flags_storage.len != 0);
            if (res.flags_storage.len != 0)
                res.flags_storage[param.id] = true;
        }
    }

    for (multis, 0..) |*multi, i|
        res.multi_storage[i] = try multi.toOwnedSlice();
    res.pos = try pos.toOwnedSlice();
    res.passthrough_positionals = try passthrough_positionals.toOwnedSlice();
    return res;
}

const bun = @import("bun");
const clap = @import("./clap.zig");

const std = @import("std");
const debug = std.debug;
const mem = std.mem;
