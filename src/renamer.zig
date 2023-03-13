const js_ast = bun.JSAst;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const Ref = @import("./ast/base.zig").Ref;
const logger = @import("bun").logger;
const JSLexer = @import("./js_lexer.zig");

pub const NoOpRenamer = struct {
    symbols: js_ast.Symbol.Map,
    source: *const logger.Source,

    pub fn init(symbols: js_ast.Symbol.Map, source: *const logger.Source) NoOpRenamer {
        return NoOpRenamer{ .symbols = symbols, .source = source };
    }

    pub const originalName = nameForSymbol;

    pub fn nameForSymbol(renamer: *NoOpRenamer, ref: Ref) string {
        if (ref.isSourceContentsSlice()) {
            return renamer.source.contents[ref.sourceIndex() .. ref.sourceIndex() + ref.innerIndex()];
        }

        const resolved = renamer.symbols.follow(ref);

        if (renamer.symbols.getConst(resolved)) |symbol| {
            return symbol.original_name;
        } else {
            Global.panic("Invalid symbol {s} in {s}", .{ ref, renamer.source.path.text });
        }
    }

    pub fn toRenamer(this: *NoOpRenamer) Renamer {
        return .{
            .NoOpRenamer = this,
        };
    }
};

pub const Renamer = union(enum) {
    NumberRenamer: *NumberRenamer,
    NoOpRenamer: *NoOpRenamer,

    pub fn symbols(this: Renamer) js_ast.Symbol.Map {
        return switch (this) {
            inline else => |r| r.symbols,
        };
    }

    pub fn nameForSymbol(renamer: Renamer, ref: Ref) string {
        return switch (renamer) {
            inline else => |r| r.nameForSymbol(ref),
        };
    }

    pub fn originalName(renamer: Renamer, ref: Ref) ?string {
        return switch (renamer) {
            inline else => |r| r.originalName(ref),
        };
    }

    pub fn deinit(renamer: Renamer) void {
        switch (renamer) {
            .NumberRenamer => |r| r.deinit(),
            else => {},
        }
    }
};

pub const NumberRenamer = struct {
    symbols: js_ast.Symbol.Map,
    names: bun.BabyList(bun.BabyList(string)) = .{},
    allocator: std.mem.Allocator,
    temp_allocator: std.mem.Allocator,
    root: NumberScope = .{},

    pub fn deinit(self: *NumberRenamer) void {
        self.names.deinitWithAllocator(self.allocator);
        self.root.deinit(self.temp_allocator);
    }

    pub fn toRenamer(this: *NumberRenamer) Renamer {
        return .{
            .NumberRenamer = this,
        };
    }

    pub fn originalName(r: *NumberRenamer, ref: Ref) string {
        if (ref.isSourceContentsSlice()) {
            unreachable;
        }

        const resolved = r.symbols.follow(ref);
        return r.symbols.getConst(resolved).?.original_name;
    }

    pub fn assignName(r: *NumberRenamer, scope: *NumberScope, input_ref: Ref) void {
        const ref = r.symbols.follow(input_ref);

        // Don't rename the same symbol more than once
        var inner: *bun.BabyList(string) = r.names.mut(input_ref.sourceIndex());
        if (inner.len > ref.innerIndex() and inner.at(ref.innerIndex()).len > 0) return;

        // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
        const symbol = r.symbols.get(ref).?;
        if (symbol.slotNamespace() != .default) {
            return;
        }

        const name = scope.findUnusedName(r.allocator, symbol.original_name) orelse return;

        const new_len = @max(inner.len, ref.innerIndex() + 1);
        if (inner.cap <= new_len) {
            const prev_cap = inner.len;
            inner.ensureUnusedCapacity(r.allocator, new_len - prev_cap) catch unreachable;
            const to_write = inner.ptr[prev_cap..inner.cap];
            @memset(std.mem.sliceAsBytes(to_write).ptr, 0, std.mem.sliceAsBytes(to_write).len);
        }
        inner.len = new_len;
        inner.mut(ref.innerIndex()).* = name;
    }

    pub fn init(
        allocator: std.mem.Allocator,
        temp_allocator: std.mem.Allocator,
        symbols: js_ast.Symbol.Map,
        root_names: bun.StringHashMapUnmanaged(u32),
    ) !*NumberRenamer {
        var renamer = try allocator.create(NumberRenamer);
        renamer.* = NumberRenamer{
            .symbols = symbols,
            .allocator = allocator,
            .temp_allocator = temp_allocator,
            .names = try bun.BabyList(bun.BabyList(string)).initCapacity(allocator, symbols.symbols_for_source.len),
        };
        renamer.root.name_counts = root_names;
        renamer.names.len = symbols.symbols_for_source.len;
        for (renamer.names.slice()) |*inner| {
            inner.* = .{};
        }
        return renamer;
    }

    pub fn assignNamesRecursive(r: *NumberRenamer, scope: *js_ast.Scope, source_index: u32, parent: ?*NumberScope, sorted: *std.ArrayList(u32)) void {
        var s_ = NumberScope{
            .parent = parent,
            .name_counts = .{},
        };
        var s = &s_;
        defer s.deinit(r.temp_allocator);

        assignNamesRecursiveWithNumberScope(r, s, scope, source_index, sorted);
    }

    pub fn assignNamesRecursiveWithNumberScope(r: *NumberRenamer, s: *NumberScope, scope: *js_ast.Scope, source_index: u32, sorted: *std.ArrayList(u32)) void {
        {
            sorted.clearRetainingCapacity();
            sorted.ensureUnusedCapacity(scope.members.count()) catch unreachable;
            sorted.items.len = scope.members.count();
            var remaining = sorted.items;
            var value_iter = scope.members.valueIterator();
            while (value_iter.next()) |value_ref| {
                if (comptime Environment.allow_assert)
                    std.debug.assert(!value_ref.ref.isSourceContentsSlice());

                remaining[0] = value_ref.ref.innerIndex();
                remaining = remaining[1..];
            }
            std.debug.assert(remaining.len == 0);
            std.sort.sort(u32, sorted.items, void{}, std.sort.asc(u32));

            for (sorted.items) |inner_index| {
                r.assignName(s, Ref.init(@intCast(Ref.Int, inner_index), source_index, false));
            }
        }

        for (scope.generated.slice()) |ref| {
            r.assignName(s, ref);
        }

        // We only need one number scope per scope level, so we can reuse the same one for all children
        var child_scope_ = NumberScope{
            .parent = s,
            .name_counts = .{},
        };
        var child_scope = &child_scope_;
        defer child_scope.deinit(r.temp_allocator);

        // Symbols in child scopes may also have to be renamed to avoid conflicts
        for (scope.children.slice()) |child| {
            child_scope.name_counts.clearRetainingCapacity();
            r.assignNamesRecursiveWithNumberScope(child_scope, child, source_index, sorted);
        }
    }

    pub fn addTopLevelSymbol(r: *NumberRenamer, ref: Ref) void {
        r.assignName(&r.root, ref);
    }

    pub fn addTopLevelDeclaredSymbols(r: *NumberRenamer, declared_symbols: js_ast.DeclaredSymbol.List) void {
        var decls = declared_symbols;
        js_ast.DeclaredSymbol.forEachTopLevelSymbol(&decls, r, addTopLevelSymbol);
    }

    pub fn assignNamesByScope(r: *NumberRenamer, nested_scopes: *js_ast.Scope.NestedScopeMap) void {
        // TODO: parallelize this
        var sorted_ = std.ArrayList(u32).init(r.temp_allocator);
        var sorted = &sorted_;
        defer sorted.deinit();

        var scope_iter = nested_scopes.iterator();
        var s_ = NumberScope{
            .parent = &r.root,
            .name_counts = .{},
        };
        var s = &s_;

        while (scope_iter.next()) |entry| {
            var scopes_list = entry.value_ptr.*;
            defer entry.value_ptr.deinitWithAllocator(nested_scopes.allocator);
            const scopes = scopes_list.slice();
            const source_index = entry.key_ptr.*;

            for (scopes) |scope| {
                s.name_counts.clearRetainingCapacity();
                r.assignNamesRecursiveWithNumberScope(s, scope, source_index, sorted);
            }
        }
    }

    pub fn nameForSymbol(renamer: *NumberRenamer, ref: Ref) string {
        if (ref.isSourceContentsSlice()) {
            unreachable;
        }

        const resolved = renamer.symbols.follow(ref);

        const renamed_list = renamer.names
            .at(resolved.sourceIndex());

        if (renamed_list.len > resolved.innerIndex()) {
            const renamed = renamed_list.at(resolved.innerIndex()).*;
            if (renamed.len > 0) {
                return renamed;
            }
        }

        return renamer.symbols.getConst(resolved).?.original_name;
    }

    pub const NumberScope = struct {
        parent: ?*NumberScope = null,
        name_counts: bun.StringHashMapUnmanaged(u32) = .{},

        pub fn deinit(this: *NumberScope, allocator: std.mem.Allocator) void {
            this.name_counts.deinit(allocator);
            this.* = undefined;
        }

        pub const NameUse = union(enum) {
            unused: void,
            same_scope: u32,
            used: void,

            pub fn find(this: *NumberScope, name: []const u8) NameUse {
                // This version doesn't allocate
                if (comptime Environment.allow_assert)
                    std.debug.assert(JSLexer.isIdentifier(name));

                // avoid rehashing the same string over for each scope
                const ctx = bun.StringHashMapContext.pre(name);

                if (this.name_counts.getAdapted(name, ctx)) |count| {
                    return .{ .same_scope = count };
                }

                var s: ?*NumberScope = this.parent;

                while (s) |scope| : (s = scope.parent) {
                    if (scope.name_counts.containsAdapted(name, ctx)) {
                        return .{ .used = void{} };
                    }
                }

                return .{ .unused = void{} };
            }
        };

        /// Caller must use an arena allocator
        pub fn findUnusedName(this: *NumberScope, allocator: std.mem.Allocator, input_name: []const u8) ?string {
            var name = bun.MutableString.ensureValidIdentifier(input_name, allocator) catch unreachable;

            switch (NameUse.find(this, name)) {
                .unused => {},
                else => |use| {
                    var tries: u32 = if (use == .used)
                        1
                    else
                        // To avoid O(n^2) behavior, the number must start off being the number
                        // that we used last time there was a collision with this name. Otherwise
                        // if there are many collisions with the same name, each name collision
                        // would have to increment the counter past all previous name collisions
                        // which is a O(n^2) time algorithm. Only do this if this symbol comes
                        // from the same scope as the previous one since sibling scopes can reuse
                        // the same name without problems.
                        use.same_scope;

                    const prefix = name;

                    tries += 1;

                    var mutable_name = MutableString.initEmpty(allocator);
                    mutable_name.growIfNeeded(prefix.len + 4) catch unreachable;
                    mutable_name.appendSlice(prefix) catch unreachable;
                    mutable_name.appendInt(tries) catch unreachable;

                    switch (NameUse.find(this, mutable_name.toOwnedSliceLeaky())) {
                        .unused => {
                            name = mutable_name.toOwnedSliceLeaky();

                            if (use == .same_scope) {
                                var existing = this.name_counts.getOrPut(allocator, prefix) catch unreachable;
                                if (!existing.found_existing) {
                                    if (strings.eqlLong(input_name, prefix, true)) {
                                        existing.key_ptr.* = input_name;
                                    } else {
                                        existing.key_ptr.* = allocator.dupe(u8, prefix) catch unreachable;
                                    }
                                }

                                existing.value_ptr.* = tries;
                            }
                        },
                        else => |cur_use| {
                            while (true) {
                                mutable_name.resetTo(prefix.len);
                                mutable_name.appendInt(tries) catch unreachable;

                                tries += 1;

                                switch (NameUse.find(this, mutable_name.toOwnedSliceLeaky())) {
                                    .unused => {
                                        if (cur_use == .same_scope) {
                                            var existing = this.name_counts.getOrPut(allocator, prefix) catch unreachable;
                                            if (!existing.found_existing) {
                                                if (strings.eqlLong(input_name, prefix, true)) {
                                                    existing.key_ptr.* = input_name;
                                                } else {
                                                    existing.key_ptr.* = allocator.dupe(u8, prefix) catch unreachable;
                                                }
                                            }

                                            existing.value_ptr.* = tries;
                                        }

                                        name = mutable_name.toOwnedSliceLeaky();
                                        break;
                                    },
                                    else => {},
                                }
                            }
                        },
                    }
                },
            }

            // Each name starts off with a count of 1 so that the first collision with
            // "name" is called "name2"
            if (strings.eqlLong(name, input_name, true)) {
                this.name_counts.putNoClobber(allocator, input_name, 1) catch unreachable;
                return null;
            }

            this.name_counts.putNoClobber(allocator, name, 1) catch unreachable;
            return name;
        }
    };
};

pub const ExportRenamer = struct {
    string_buffer: bun.MutableString,
    used: bun.StringHashMap(u32),

    pub fn init(allocator: std.mem.Allocator) ExportRenamer {
        return ExportRenamer{
            .string_buffer = MutableString.initEmpty(allocator),
            .used = bun.StringHashMap(u32).init(allocator),
        };
    }

    pub fn clearRetainingCapacity(this: *ExportRenamer) void {
        this.used.clearRetainingCapacity();
        this.string_buffer.reset();
    }

    pub fn deinit(this: *ExportRenamer) void {
        this.used.deinit();
        this.string_buffer.deinit();
    }

    pub fn nextRenamedName(this: *ExportRenamer, input: []const u8) string {
        var entry = this.used.getOrPut(input) catch unreachable;
        var tries: u32 = 1;
        if (entry.found_existing) {
            while (true) {
                this.string_buffer.reset();
                var writer = this.string_buffer.writer();
                writer.print("{s}{d}", .{ input, tries }) catch unreachable;
                tries += 1;
                var attempt = this.string_buffer.toOwnedSliceLeaky();
                entry = this.used.getOrPut(attempt) catch unreachable;
                if (!entry.found_existing) {
                    const to_use = this.string_buffer.allocator.dupe(u8, attempt) catch unreachable;
                    entry.key_ptr.* = to_use;
                    entry.value_ptr.* = tries;

                    entry = this.used.getOrPut(input) catch unreachable;
                    entry.value_ptr.* = tries;
                    return to_use;
                }
            }
        } else {
            entry.value_ptr.* = tries;
        }

        return entry.key_ptr.*;
    }
};

pub fn computeInitialReservedNames(
    allocator: std.mem.Allocator,
) !bun.StringHashMapUnmanaged(u32) {
    var names = bun.StringHashMapUnmanaged(u32){};

    const extras = .{
        "Promise",
        "Require",
    };

    try names.ensureTotalCapacityContext(
        allocator,
        @truncate(u32, JSLexer.Keywords.keys().len + JSLexer.StrictModeReservedWords.keys().len + 1 + extras.len),
        bun.StringHashMapContext{},
    );

    for (JSLexer.Keywords.keys()) |keyword| {
        names.putAssumeCapacity(keyword, 1);
    }

    for (JSLexer.StrictModeReservedWords.keys()) |keyword| {
        names.putAssumeCapacity(keyword, 1);
    }

    inline for (comptime extras) |extra| {
        names.putAssumeCapacity(extra, 1);
    }

    return names;
}

pub fn computeReservedNamesForScope(
    scope: *js_ast.Scope,
    symbols: *const js_ast.Symbol.Map,
    names_: *bun.StringHashMapUnmanaged(u32),
    allocator: std.mem.Allocator,
) void {
    var names = names_.*;
    defer names_.* = names;

    var member_iter = scope.members.valueIterator();
    while (member_iter.next()) |member| {
        const symbol = symbols.get(member.ref).?;
        if (symbol.kind == .unbound or symbol.must_not_be_renamed) {
            names.put(allocator, symbol.original_name, 1) catch unreachable;
        }
    }

    for (scope.generated.slice()) |ref| {
        const symbol = symbols.get(ref).?;
        if (symbol.kind == .unbound or symbol.must_not_be_renamed) {
            names.put(allocator, symbol.original_name, 1) catch unreachable;
        }
    }

    // If there's a direct "eval" somewhere inside the current scope, continue
    // traversing down the scope tree until we find it to get all reserved names
    if (scope.contains_direct_eval) {
        for (scope.children.slice()) |child| {
            if (child.contains_direct_eval) {
                names_.* = names;
                computeReservedNamesForScope(child, symbols, &names, allocator);
            }
        }
    }
}
