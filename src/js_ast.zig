const std = @import("std");
const logger = bun.logger;
const JSXRuntime = @import("options.zig").JSX.Runtime;
const Runtime = @import("runtime.zig").Runtime;
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
pub const Ref = @import("ast/base.zig").Ref;
pub const Index = @import("ast/base.zig").Index;
const RefHashCtx = @import("ast/base.zig").RefHashCtx;
const ObjectPool = @import("./pool.zig").ObjectPool;
const ImportRecord = @import("import_record.zig").ImportRecord;
const allocators = @import("allocators.zig");
const JSC = bun.JSC;
const RefCtx = @import("./ast/base.zig").RefCtx;
const JSONParser = bun.JSON;
const ComptimeStringMap = bun.ComptimeStringMap;
const JSPrinter = @import("./js_printer.zig");
const js_lexer = @import("./js_lexer.zig");
const TypeScript = @import("./js_parser.zig").TypeScript;
const ThreadlocalArena = @import("./allocators/mimalloc_arena.zig").Arena;
const MimeType = bun.http.MimeType;
const OOM = bun.OOM;
const Loader = bun.options.Loader;
/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const namespace_export_part_index = 0;

/// This "Store" is a specialized memory allocation strategy very similar to an
/// arena, used for allocating expression and statement nodes during JavaScript
/// parsing and visiting. Allocations are grouped into large blocks, where each
/// block is treated as a fixed-buffer allocator. When a block runs out of
/// space, a new one is created; all blocks are joined as a linked list.
///
/// Similarly to an arena, you can call .reset() to reset state, reusing memory
/// across operations.
pub fn NewStore(comptime types: []const type, comptime count: usize) type {
    const largest_size, const largest_align = brk: {
        var largest_size = 0;
        var largest_align = 1;
        for (types) |T| {
            if (@sizeOf(T) == 0) {
                @compileError("NewStore does not support 0 size type: " ++ @typeName(T));
            }
            largest_size = @max(@sizeOf(T), largest_size);
            largest_align = @max(@alignOf(T), largest_align);
        }
        break :brk .{ largest_size, largest_align };
    };

    const backing_allocator = bun.default_allocator;

    const log = Output.scoped(.Store, true);

    return struct {
        const Store = @This();

        current: *Block,
        debug_lock: std.debug.SafetyLock = .{},

        pub const Block = struct {
            pub const size = largest_size * count * 2;
            pub const Size = std.math.IntFittingRange(0, size + largest_size);

            buffer: [size]u8 align(largest_align) = undefined,
            bytes_used: Size = 0,
            next: ?*Block = null,

            pub fn tryAlloc(block: *Block, comptime T: type) ?*T {
                const start = std.mem.alignForward(usize, block.bytes_used, @alignOf(T));
                if (start + @sizeOf(T) > block.buffer.len) return null;
                defer block.bytes_used = @intCast(start + @sizeOf(T));

                // it's simpler to use @ptrCast, but as a sanity check, we also
                // try to compute the slice. Zig will report an out of bounds
                // panic if the null detection logic above is wrong
                if (Environment.isDebug) {
                    _ = block.buffer[block.bytes_used..][0..@sizeOf(T)];
                }

                return @alignCast(@ptrCast(&block.buffer[start]));
            }
        };

        const PreAlloc = struct {
            metadata: Store,
            first_block: Block,
        };

        pub fn firstBlock(store: *Store) *Block {
            return &@as(*PreAlloc, @fieldParentPtr("metadata", store)).first_block;
        }

        pub fn init() *Store {
            log("init", .{});
            const prealloc = backing_allocator.create(PreAlloc) catch bun.outOfMemory();

            prealloc.first_block.bytes_used = 0;
            prealloc.first_block.next = null;

            prealloc.metadata = .{
                .current = &prealloc.first_block,
            };

            return &prealloc.metadata;
        }

        pub fn deinit(store: *Store) void {
            log("deinit", .{});
            var it = store.firstBlock().next; // do not free `store.head`
            while (it) |next| {
                if (Environment.isDebug)
                    @memset(next.buffer, undefined);
                it = next.next;
                backing_allocator.destroy(next);
            }

            const prealloc: PreAlloc = @fieldParentPtr("metadata", store);
            bun.assert(&prealloc.first_block == store.head);
            backing_allocator.destroy(prealloc);
        }

        pub fn reset(store: *Store) void {
            log("reset", .{});

            if (Environment.isDebug) {
                var it: ?*Block = store.firstBlock();
                while (it) |next| : (it = next.next) {
                    next.bytes_used = undefined;
                    @memset(&next.buffer, undefined);
                }
            }

            store.current = store.firstBlock();
            store.current.bytes_used = 0;
        }

        fn allocate(store: *Store, comptime T: type) *T {
            comptime bun.assert(@sizeOf(T) > 0); // don't allocate!
            comptime if (!supportsType(T)) {
                @compileError("Store does not know about type: " ++ @typeName(T));
            };

            if (store.current.tryAlloc(T)) |ptr|
                return ptr;

            // a new block is needed
            const next_block = if (store.current.next) |next| brk: {
                next.bytes_used = 0;
                break :brk next;
            } else brk: {
                const new_block = backing_allocator.create(Block) catch
                    bun.outOfMemory();
                new_block.next = null;
                new_block.bytes_used = 0;
                store.current.next = new_block;
                break :brk new_block;
            };

            store.current = next_block;

            return next_block.tryAlloc(T) orelse
                unreachable; // newly initialized blocks must have enough space for at least one
        }

        pub inline fn append(store: *Store, comptime T: type, data: T) *T {
            const ptr = store.allocate(T);
            if (Environment.isDebug) {
                log("append({s}) -> 0x{x}", .{ bun.meta.typeName(T), @intFromPtr(ptr) });
            }
            ptr.* = data;
            return ptr;
        }

        pub fn lock(store: *Store) void {
            store.debug_lock.lock();
        }

        pub fn unlock(store: *Store) void {
            store.debug_lock.unlock();
        }

        fn supportsType(T: type) bool {
            return std.mem.indexOfScalar(type, types, T) != null;
        }
    };
}

// There are three types.
// 1. Expr (expression)
// 2. Stmt (statement)
// 3. Binding
// Q: "What's the difference between an expression and a statement?"
// A:  > Expression: Something which evaluates to a value. Example: 1+2/x
//     > Statement: A line of code which does something. Example: GOTO 100
//     > https://stackoverflow.com/questions/19132/expression-versus-statement/19224#19224

// Expr, Binding, and Stmt each wrap a Data:
// Data is where the actual data where the node lives.
// There are four possible versions of this structure:
// [ ] 1.  *Expr, *Stmt, *Binding
// [ ] 1a. *Expr, *Stmt, *Binding something something dynamic dispatch
// [ ] 2.  *Data
// [x] 3.  Data.(*) (The union value in Data is a pointer)
// I chose #3 mostly for code simplification -- sometimes, the data is modified in-place.
// But also it uses the least memory.
// Since Data is a union, the size in bytes of Data is the max of all types
// So with #1 or #2, if S.Function consumes 768 bits, that means Data must be >= 768 bits
// Which means "true" in code now takes up over 768 bits, probably more than what v8 spends
// Instead, this approach means Data is the size of a pointer.
// It's not really clear which approach is best without benchmarking it.
// The downside with this approach is potentially worse memory locality, since the data for the node is somewhere else.
// But it could also be better memory locality due to smaller in-memory size (more likely to hit the cache)
// only benchmarks will provide an answer!
// But we must have pointers somewhere in here because can't have types that contain themselves
pub const BindingNodeIndex = Binding;
pub const StmtNodeIndex = Stmt;
pub const ExprNodeIndex = Expr;
pub const BabyList = bun.BabyList;

/// Slice that stores capacity and length in the same space as a regular slice.
pub const ExprNodeList = BabyList(Expr);

pub const StmtNodeList = []Stmt;
pub const BindingNodeList = []Binding;

pub const ImportItemStatus = enum(u2) {
    none,
    /// The linker doesn't report import/export mismatch errors
    generated,
    /// The printer will replace this import with "undefined"
    missing,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};

pub const AssignTarget = enum(u2) {
    none = 0,
    replace = 1, // "a = b"
    update = 2, // "a += b"
    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};

pub const LocRef = struct {
    loc: logger.Loc = logger.Loc.Empty,

    // TODO: remove this optional and make Ref a function getter
    // That will make this struct 128 bits instead of 192 bits and we can remove some heap allocations
    ref: ?Ref = null,
};

pub const Flags = struct {
    pub const JSXElement = enum {
        is_key_after_spread,
        has_any_dynamic,
        pub const Bitset = std.enums.EnumSet(JSXElement);
    };

    pub const Property = enum {
        is_computed,
        is_method,
        is_static,
        was_shorthand,
        is_spread,

        pub inline fn init(fields: Fields) Set {
            return Set.init(fields);
        }

        pub const None = Set{};
        pub const Fields = std.enums.EnumFieldStruct(Flags.Property, bool, false);
        pub const Set = std.enums.EnumSet(Flags.Property);
    };

    pub const Function = enum {
        is_async,
        is_generator,
        has_rest_arg,
        has_if_scope,

        is_forward_declaration,

        /// This is true if the function is a method
        is_unique_formal_parameters,

        /// Only applicable to function statements.
        is_export,

        pub inline fn init(fields: Fields) Set {
            return Set.init(fields);
        }

        pub const None = Set{};
        pub const Fields = std.enums.EnumFieldStruct(Function, bool, false);
        pub const Set = std.enums.EnumSet(Function);
    };
};

pub const Binding = struct {
    loc: logger.Loc,
    data: B,

    const Serializable = struct {
        type: Tag,
        object: string,
        value: B,
        loc: logger.Loc,
    };

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(Serializable{ .type = std.meta.activeTag(self.data), .object = "binding", .value = self.data, .loc = self.loc });
    }

    pub fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type {
        const ExprType = expr_type;
        return struct {
            context: *ExprType,
            allocator: std.mem.Allocator,
            pub const Context = @This();

            pub fn wrapIdentifier(ctx: *const Context, loc: logger.Loc, ref: Ref) Expr {
                return func_type(ctx.context, loc, ref);
            }

            pub fn init(context: *ExprType) Context {
                return Context{ .context = context, .allocator = context.allocator };
            }
        };
    }

    pub fn toExpr(binding: *const Binding, wrapper: anytype) Expr {
        const loc = binding.loc;

        switch (binding.data) {
            .b_missing => {
                return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = loc };
            },
            .b_identifier => |b| {
                return wrapper.wrapIdentifier(loc, b.ref);
            },
            .b_array => |b| {
                var exprs = wrapper.allocator.alloc(Expr, b.items.len) catch unreachable;
                var i: usize = 0;
                while (i < exprs.len) : (i += 1) {
                    const item = b.items[i];
                    exprs[i] = convert: {
                        const expr = toExpr(&item.binding, wrapper);
                        if (b.has_spread and i == exprs.len - 1) {
                            break :convert Expr.init(E.Spread, E.Spread{ .value = expr }, expr.loc);
                        } else if (item.default_value) |default| {
                            break :convert Expr.assign(expr, default);
                        } else {
                            break :convert expr;
                        }
                    };
                }

                return Expr.init(E.Array, E.Array{ .items = ExprNodeList.init(exprs), .is_single_line = b.is_single_line }, loc);
            },
            .b_object => |b| {
                const properties = wrapper
                    .allocator
                    .alloc(G.Property, b.properties.len) catch unreachable;
                for (properties, b.properties) |*property, item| {
                    property.* = .{
                        .flags = item.flags,
                        .key = item.key,
                        .kind = if (item.flags.contains(.is_spread))
                            .spread
                        else
                            .normal,
                        .value = toExpr(&item.value, wrapper),
                        .initializer = item.default_value,
                    };
                }
                return Expr.init(
                    E.Object,
                    E.Object{
                        .properties = G.Property.List.init(properties),
                        .is_single_line = b.is_single_line,
                    },
                    loc,
                );
            },
        }
    }

    pub const Tag = enum(u5) {
        b_identifier,
        b_array,
        b_object,
        b_missing,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub var icount: usize = 0;

    pub fn init(t: anytype, loc: logger.Loc) Binding {
        icount += 1;
        switch (@TypeOf(t)) {
            *B.Identifier => {
                return Binding{ .loc = loc, .data = B{ .b_identifier = t } };
            },
            *B.Array => {
                return Binding{ .loc = loc, .data = B{ .b_array = t } };
            },
            *B.Object => {
                return Binding{ .loc = loc, .data = B{ .b_object = t } };
            },
            B.Missing => {
                return Binding{ .loc = loc, .data = B{ .b_missing = t } };
            },
            else => {
                @compileError("Invalid type passed to Binding.init");
            },
        }
    }

    pub fn alloc(allocator: std.mem.Allocator, t: anytype, loc: logger.Loc) Binding {
        icount += 1;
        switch (@TypeOf(t)) {
            B.Identifier => {
                const data = allocator.create(B.Identifier) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_identifier = data } };
            },
            B.Array => {
                const data = allocator.create(B.Array) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_array = data } };
            },
            B.Object => {
                const data = allocator.create(B.Object) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_object = data } };
            },
            B.Missing => {
                return Binding{ .loc = loc, .data = B{ .b_missing = .{} } };
            },
            else => {
                @compileError("Invalid type passed to Binding.alloc");
            },
        }
    }
};

/// B is for Binding! Bindings are on the left side of variable
/// declarations (s_local), which is how destructuring assignments
/// are represented in memory. Consider a basic example.
///
///     let hello = world;
///         ^       ^
///         |       E.Identifier
///         B.Identifier
///
/// Bindings can be nested
///
///                B.Array
///                | B.Identifier
///                | |
///     let { foo: [ bar ] } = ...
///         ----------------
///         B.Object
pub const B = union(Binding.Tag) {
    // let x = ...
    b_identifier: *B.Identifier,
    // let [a, b] = ...
    b_array: *B.Array,
    // let { a, b: c } = ...
    b_object: *B.Object,
    // this is used to represent array holes
    b_missing: B.Missing,

    pub const Identifier = struct {
        ref: Ref,
    };

    pub const Property = struct {
        flags: Flags.Property.Set = Flags.Property.None,
        key: ExprNodeIndex,
        value: Binding,
        default_value: ?Expr = null,
    };

    pub const Object = struct {
        properties: []B.Property,
        is_single_line: bool = false,

        pub const Property = B.Property;
    };

    pub const Array = struct {
        items: []ArrayBinding,
        has_spread: bool = false,
        is_single_line: bool = false,
    };

    pub const Missing = struct {};

    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn writeToHasher(b: B, hasher: anytype, symbol_table: anytype) void {
        switch (b) {
            .b_identifier => |id| {
                const original_name = id.ref.getSymbol(symbol_table).original_name;
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), original_name.len });
            },
            .b_array => |array| {
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), array.has_spread, array.items.len });
                for (array.items) |item| {
                    writeAnyToHasher(hasher, .{item.default_value != null});
                    if (item.default_value) |default| {
                        default.data.writeToHasher(hasher, symbol_table);
                    }
                    item.binding.data.writeToHasher(hasher, symbol_table);
                }
            },
            .b_object => |object| {
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), object.properties.len });
                for (object.properties) |property| {
                    writeAnyToHasher(hasher, .{ property.default_value != null, property.flags });
                    if (property.default_value) |default| {
                        default.data.writeToHasher(hasher, symbol_table);
                    }
                    property.key.data.writeToHasher(hasher, symbol_table);
                    property.value.data.writeToHasher(hasher, symbol_table);
                }
            },
            .b_missing => {},
        }
    }
};

pub const ClauseItem = struct {
    alias: string,
    alias_loc: logger.Loc = logger.Loc.Empty,
    name: LocRef,

    /// This is the original name of the symbol stored in "Name". It's needed for
    /// "SExportClause" statements such as this:
    ///
    ///   export {foo as bar} from 'path'
    ///
    /// In this case both "foo" and "bar" are aliases because it's a re-export.
    /// We need to preserve both aliases in case the symbol is renamed. In this
    /// example, "foo" is "OriginalName" and "bar" is "Alias".
    original_name: string = "",

    pub const default_alias: string = "default";
};

pub const SlotCounts = struct {
    slots: Symbol.SlotNamespace.CountsArray = Symbol.SlotNamespace.CountsArray.initFill(0),

    pub fn unionMax(this: *SlotCounts, other: SlotCounts) void {
        for (&this.slots.values, other.slots.values) |*a, b| {
            if (a.* < b) a.* = b;
        }
    }
};

const char_freq_count = 64;
pub const CharAndCount = struct {
    char: u8 = 0,
    count: i32 = 0,
    index: usize = 0,

    pub const Array = [char_freq_count]CharAndCount;

    pub fn lessThan(_: void, a: CharAndCount, b: CharAndCount) bool {
        if (a.count != b.count) {
            return a.count > b.count;
        }

        if (a.index != b.index) {
            return a.index < b.index;
        }

        return a.char < b.char;
    }
};

pub const CharFreq = struct {
    const Vector = @Vector(char_freq_count, i32);
    const Buffer = [char_freq_count]i32;

    freqs: Buffer align(1) = undefined,

    const scan_big_chunk_size = 32;
    pub fn scan(this: *CharFreq, text: string, delta: i32) void {
        if (delta == 0)
            return;

        if (text.len < scan_big_chunk_size) {
            scanSmall(&this.freqs, text, delta);
        } else {
            scanBig(&this.freqs, text, delta);
        }
    }

    fn scanBig(out: *align(1) Buffer, text: string, delta: i32) void {
        // https://zig.godbolt.org/z/P5dPojWGK
        var freqs = out.*;
        defer out.* = freqs;
        var deltas: [256]i32 = [_]i32{0} ** 256;
        var remain = text;

        bun.assert(remain.len >= scan_big_chunk_size);

        const unrolled = remain.len - (remain.len % scan_big_chunk_size);
        const remain_end = remain.ptr + unrolled;
        var unrolled_ptr = remain.ptr;
        remain = remain[unrolled..];

        while (unrolled_ptr != remain_end) : (unrolled_ptr += scan_big_chunk_size) {
            const chunk = unrolled_ptr[0..scan_big_chunk_size].*;
            inline for (0..scan_big_chunk_size) |i| {
                deltas[@as(usize, chunk[i])] += delta;
            }
        }

        for (remain) |c| {
            deltas[@as(usize, c)] += delta;
        }

        freqs[0..26].* = deltas['a' .. 'a' + 26].*;
        freqs[26 .. 26 * 2].* = deltas['A' .. 'A' + 26].*;
        freqs[26 * 2 .. 62].* = deltas['0' .. '0' + 10].*;
        freqs[62] = deltas['_'];
        freqs[63] = deltas['$'];
    }

    fn scanSmall(out: *align(1) Buffer, text: string, delta: i32) void {
        var freqs: [char_freq_count]i32 = out.*;
        defer out.* = freqs;

        for (text) |c| {
            const i: usize = switch (c) {
                'a'...'z' => @as(usize, @intCast(c)) - 'a',
                'A'...'Z' => @as(usize, @intCast(c)) - ('A' - 26),
                '0'...'9' => @as(usize, @intCast(c)) + (53 - '0'),
                '_' => 62,
                '$' => 63,
                else => continue,
            };
            freqs[i] += delta;
        }
    }

    pub fn include(this: *CharFreq, other: CharFreq) void {
        // https://zig.godbolt.org/z/Mq8eK6K9s
        const left: @Vector(char_freq_count, i32) = this.freqs;
        const right: @Vector(char_freq_count, i32) = other.freqs;

        this.freqs = left + right;
    }

    pub fn compile(this: *const CharFreq, allocator: std.mem.Allocator) NameMinifier {
        const array: CharAndCount.Array = brk: {
            var _array: CharAndCount.Array = undefined;

            for (&_array, NameMinifier.default_tail, this.freqs, 0..) |*dest, char, freq, i| {
                dest.* = CharAndCount{
                    .char = char,
                    .index = i,
                    .count = freq,
                };
            }

            std.sort.pdq(CharAndCount, &_array, {}, CharAndCount.lessThan);

            break :brk _array;
        };

        var minifier = NameMinifier.init(allocator);
        minifier.head.ensureTotalCapacityPrecise(NameMinifier.default_head.len) catch unreachable;
        minifier.tail.ensureTotalCapacityPrecise(NameMinifier.default_tail.len) catch unreachable;
        // TODO: investigate counting number of < 0 and > 0 and pre-allocating
        for (array) |item| {
            if (item.char < '0' or item.char > '9') {
                minifier.head.append(item.char) catch unreachable;
            }
            minifier.tail.append(item.char) catch unreachable;
        }

        return minifier;
    }
};

pub const NameMinifier = struct {
    head: std.ArrayList(u8),
    tail: std.ArrayList(u8),

    pub const default_head = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub const default_tail = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

    pub fn init(allocator: std.mem.Allocator) NameMinifier {
        return .{
            .head = std.ArrayList(u8).init(allocator),
            .tail = std.ArrayList(u8).init(allocator),
        };
    }

    pub fn numberToMinifiedName(this: *NameMinifier, name: *std.ArrayList(u8), _i: isize) !void {
        name.clearRetainingCapacity();
        var i = _i;
        var j = @as(usize, @intCast(@mod(i, 54)));
        try name.appendSlice(this.head.items[j .. j + 1]);
        i = @divFloor(i, 54);

        while (i > 0) {
            i -= 1;
            j = @as(usize, @intCast(@mod(i, char_freq_count)));
            try name.appendSlice(this.tail.items[j .. j + 1]);
            i = @divFloor(i, char_freq_count);
        }
    }

    pub fn defaultNumberToMinifiedName(allocator: std.mem.Allocator, _i: isize) !string {
        var i = _i;
        var j = @as(usize, @intCast(@mod(i, 54)));
        var name = std.ArrayList(u8).init(allocator);
        try name.appendSlice(default_head[j .. j + 1]);
        i = @divFloor(i, 54);

        while (i > 0) {
            i -= 1;
            j = @as(usize, @intCast(@mod(i, char_freq_count)));
            try name.appendSlice(default_tail[j .. j + 1]);
            i = @divFloor(i, char_freq_count);
        }

        return name.items;
    }
};

pub const G = struct {
    pub const Decl = struct {
        binding: BindingNodeIndex,
        value: ?ExprNodeIndex = null,

        pub const List = BabyList(Decl);
    };

    pub const NamespaceAlias = struct {
        namespace_ref: Ref,
        alias: string,

        was_originally_property_access: bool = false,

        import_record_index: u32 = std.math.maxInt(u32),
    };

    pub const ExportStarAlias = struct {
        loc: logger.Loc,

        // Although this alias name starts off as being the same as the statement's
        // namespace symbol, it may diverge if the namespace symbol name is minified.
        // The original alias name is preserved here to avoid this scenario.
        original_name: string,
    };

    pub const Class = struct {
        class_keyword: logger.Range = logger.Range.None,
        ts_decorators: ExprNodeList = ExprNodeList{},
        class_name: ?LocRef = null,
        extends: ?ExprNodeIndex = null,
        body_loc: logger.Loc = logger.Loc.Empty,
        close_brace_loc: logger.Loc = logger.Loc.Empty,
        properties: []Property = &([_]Property{}),
        has_decorators: bool = false,

        pub fn canBeMoved(this: *const Class) bool {
            if (this.extends != null)
                return false;

            if (this.has_decorators) {
                return false;
            }

            for (this.properties) |property| {
                if (property.kind == .class_static_block)
                    return false;

                const flags = property.flags;
                if (flags.contains(.is_computed) or flags.contains(.is_spread)) {
                    return false;
                }

                if (property.kind == .normal) {
                    if (flags.contains(.is_static)) {
                        for ([2]?Expr{ property.value, property.initializer }) |val_| {
                            if (val_) |val| {
                                switch (val.data) {
                                    .e_arrow, .e_function => {},
                                    else => {
                                        if (!val.canBeMoved()) {
                                            return false;
                                        }
                                    },
                                }
                            }
                        }
                    }
                }
            }

            return true;
        }
    };

    // invalid shadowing if left as Comment
    pub const Comment = struct { loc: logger.Loc, text: string };

    pub const ClassStaticBlock = struct {
        stmts: BabyList(Stmt) = .{},
        loc: logger.Loc,
    };

    pub const Property = struct {
        /// This is used when parsing a pattern that uses default values:
        ///
        ///   [a = 1] = [];
        ///   ({a = 1} = {});
        ///
        /// It's also used for class fields:
        ///
        ///   class Foo { a = 1 }
        ///
        initializer: ?ExprNodeIndex = null,
        kind: Kind = .normal,
        flags: Flags.Property.Set = Flags.Property.None,

        class_static_block: ?*ClassStaticBlock = null,
        ts_decorators: ExprNodeList = .{},
        // Key is optional for spread
        key: ?ExprNodeIndex = null,

        // This is omitted for class fields
        value: ?ExprNodeIndex = null,

        ts_metadata: TypeScript.Metadata = .m_none,

        pub const List = BabyList(Property);

        pub fn deepClone(this: *const Property, allocator: std.mem.Allocator) !Property {
            var class_static_block: ?*ClassStaticBlock = null;
            if (this.class_static_block != null) {
                class_static_block = bun.create(allocator, ClassStaticBlock, .{
                    .loc = this.class_static_block.?.loc,
                    .stmts = try this.class_static_block.?.stmts.clone(allocator),
                });
            }
            return .{
                .initializer = if (this.initializer) |init| try init.deepClone(allocator) else null,
                .kind = this.kind,
                .flags = this.flags,
                .class_static_block = class_static_block,
                .ts_decorators = try this.ts_decorators.deepClone(allocator),
                .key = if (this.key) |key| try key.deepClone(allocator) else null,
                .value = if (this.value) |value| try value.deepClone(allocator) else null,
                .ts_metadata = this.ts_metadata,
            };
        }

        pub const Kind = enum(u3) {
            normal,
            get,
            set,
            spread,
            declare,
            abstract,
            class_static_block,

            pub fn jsonStringify(self: @This(), writer: anytype) !void {
                return try writer.write(@tagName(self));
            }
        };
    };

    pub const FnBody = struct {
        loc: logger.Loc,
        stmts: StmtNodeList,
    };

    pub const Fn = struct {
        name: ?LocRef = null,
        open_parens_loc: logger.Loc = logger.Loc.Empty,
        args: []Arg = &.{},
        // This was originally nullable, but doing so I believe caused a miscompilation
        // Specifically, the body was always null.
        body: FnBody = .{ .loc = logger.Loc.Empty, .stmts = &.{} },
        arguments_ref: ?Ref = null,

        flags: Flags.Function.Set = Flags.Function.None,

        return_ts_metadata: TypeScript.Metadata = .m_none,

        pub fn deepClone(this: *const Fn, allocator: std.mem.Allocator) !Fn {
            const args = try allocator.alloc(Arg, this.args.len);
            for (0..args.len) |i| {
                args[i] = try this.args[i].deepClone(allocator);
            }
            return .{
                .name = this.name,
                .open_parens_loc = this.open_parens_loc,
                .args = args,
                .body = .{
                    .loc = this.body.loc,
                    .stmts = this.body.stmts,
                },
                .arguments_ref = this.arguments_ref,
                .flags = this.flags,
                .return_ts_metadata = this.return_ts_metadata,
            };
        }
    };
    pub const Arg = struct {
        ts_decorators: ExprNodeList = ExprNodeList{},
        binding: BindingNodeIndex,
        default: ?ExprNodeIndex = null,

        // "constructor(public x: boolean) {}"
        is_typescript_ctor_field: bool = false,

        ts_metadata: TypeScript.Metadata = .m_none,

        pub fn deepClone(this: *const Arg, allocator: std.mem.Allocator) !Arg {
            return .{
                .ts_decorators = try this.ts_decorators.deepClone(allocator),
                .binding = this.binding,
                .default = if (this.default) |d| try d.deepClone(allocator) else null,
                .is_typescript_ctor_field = this.is_typescript_ctor_field,
                .ts_metadata = this.ts_metadata,
            };
        }
    };
};

pub const Symbol = struct {
    /// This is the name that came from the parser. Printed names may be renamed
    /// during minification or to avoid name collisions. Do not use the original
    /// name during printing.
    original_name: string,

    /// This is used for symbols that represent items in the import clause of an
    /// ES6 import statement. These should always be referenced by EImportIdentifier
    /// instead of an EIdentifier. When this is present, the expression should
    /// be printed as a property access off the namespace instead of as a bare
    /// identifier.
    ///
    /// For correctness, this must be stored on the symbol instead of indirectly
    /// associated with the Ref for the symbol somehow. In ES6 "flat bundling"
    /// mode, re-exported symbols are collapsed using MergeSymbols() and renamed
    /// symbols from other files that end up at this symbol must be able to tell
    /// if it has a namespace alias.
    namespace_alias: ?G.NamespaceAlias = null,

    /// Used by the parser for single pass parsing.
    link: Ref = Ref.None,

    /// An estimate of the number of uses of this symbol. This is used to detect
    /// whether a symbol is used or not. For example, TypeScript imports that are
    /// unused must be removed because they are probably type-only imports. This
    /// is an estimate and may not be completely accurate due to oversights in the
    /// code. But it should always be non-zero when the symbol is used.
    use_count_estimate: u32 = 0,

    /// This is for generating cross-chunk imports and exports for code splitting.
    ///
    /// Do not use this directly. Use `chunkIndex()` instead.
    chunk_index: u32 = invalid_chunk_index,

    /// This is used for minification. Symbols that are declared in sibling scopes
    /// can share a name. A good heuristic (from Google Closure Compiler) is to
    /// assign names to symbols from sibling scopes in declaration order. That way
    /// local variable names are reused in each global function like this, which
    /// improves gzip compression:
    ///
    ///   function x(a, b) { ... }
    ///   function y(a, b, c) { ... }
    ///
    /// The parser fills this in for symbols inside nested scopes. There are three
    /// slot namespaces: regular symbols, label symbols, and private symbols.
    ///
    /// Do not use this directly. Use `nestedScopeSlot()` instead.
    nested_scope_slot: u32 = invalid_nested_scope_slot,

    did_keep_name: bool = true,

    must_start_with_capital_letter_for_jsx: bool = false,

    /// The kind of symbol. This is used to determine how to print the symbol
    /// and how to deal with conflicts, renaming, etc.
    kind: Kind = Kind.other,

    /// Certain symbols must not be renamed or minified. For example, the
    /// "arguments" variable is declared by the runtime for every function.
    /// Renaming can also break any identifier used inside a "with" statement.
    must_not_be_renamed: bool = false,

    /// We automatically generate import items for property accesses off of
    /// namespace imports. This lets us remove the expensive namespace imports
    /// while bundling in many cases, replacing them with a cheap import item
    /// instead:
    ///
    ///   import * as ns from 'path'
    ///   ns.foo()
    ///
    /// That can often be replaced by this, which avoids needing the namespace:
    ///
    ///   import {foo} from 'path'
    ///   foo()
    ///
    /// However, if the import is actually missing then we don't want to report a
    /// compile-time error like we do for real import items. This status lets us
    /// avoid this. We also need to be able to replace such import items with
    /// undefined, which this status is also used for.
    import_item_status: ImportItemStatus = ImportItemStatus.none,

    /// --- Not actually used yet -----------------------------------------------
    /// Sometimes we lower private symbols even if they are supported. For example,
    /// consider the following TypeScript code:
    ///
    ///   class Foo {
    ///     #foo = 123
    ///     bar = this.#foo
    ///   }
    ///
    /// If "useDefineForClassFields: false" is set in "tsconfig.json", then "bar"
    /// must use assignment semantics instead of define semantics. We can compile
    /// that to this code:
    ///
    ///   class Foo {
    ///     constructor() {
    ///       this.#foo = 123;
    ///       this.bar = this.#foo;
    ///     }
    ///     #foo;
    ///   }
    ///
    /// However, we can't do the same for static fields:
    ///
    ///   class Foo {
    ///     static #foo = 123
    ///     static bar = this.#foo
    ///   }
    ///
    /// Compiling these static fields to something like this would be invalid:
    ///
    ///   class Foo {
    ///     static #foo;
    ///   }
    ///   Foo.#foo = 123;
    ///   Foo.bar = Foo.#foo;
    ///
    /// Thus "#foo" must be lowered even though it's supported. Another case is
    /// when we're converting top-level class declarations to class expressions
    /// to avoid the TDZ and the class shadowing symbol is referenced within the
    /// class body:
    ///
    ///   class Foo {
    ///     static #foo = Foo
    ///   }
    ///
    /// This cannot be converted into something like this:
    ///
    ///   var Foo = class {
    ///     static #foo;
    ///   };
    ///   Foo.#foo = Foo;
    ///
    /// --- Not actually used yet -----------------------------------------------
    private_symbol_must_be_lowered: bool = false,

    remove_overwritten_function_declaration: bool = false,

    /// In debug mode, sometimes its helpful to know what source file
    /// A symbol came from. This is used for that.
    ///
    /// We don't want this in non-debug mode because it increases the size of
    /// the symbol table.
    debug_mode_source_index: if (Environment.allow_assert)
        Index.Int
    else
        u0 = 0,

    const invalid_chunk_index = std.math.maxInt(u32);
    pub const invalid_nested_scope_slot = std.math.maxInt(u32);

    pub const SlotNamespace = enum {
        must_not_be_renamed,
        default,
        label,
        private_name,
        mangled_prop,

        pub const CountsArray = std.EnumArray(SlotNamespace, u32);
    };

    /// This is for generating cross-chunk imports and exports for code splitting.
    pub inline fn chunkIndex(this: *const Symbol) ?u32 {
        const i = this.chunk_index;
        return if (i == invalid_chunk_index) null else i;
    }

    pub inline fn nestedScopeSlot(this: *const Symbol) ?u32 {
        const i = this.nested_scope_slot;
        return if (i == invalid_nested_scope_slot) null else i;
    }

    pub fn slotNamespace(this: *const Symbol) SlotNamespace {
        const kind = this.kind;

        if (kind == .unbound or this.must_not_be_renamed) {
            return .must_not_be_renamed;
        }

        if (kind.isPrivate()) {
            return .private_name;
        }

        return switch (kind) {
            // .mangled_prop => .mangled_prop,
            .label => .label,
            else => .default,
        };
    }

    pub inline fn hasLink(this: *const Symbol) bool {
        return this.link.tag != .invalid;
    }

    pub const Kind = enum {
        /// An unbound symbol is one that isn't declared in the file it's referenced
        /// in. For example, using "window" without declaring it will be unbound.
        unbound,

        /// This has special merging behavior. You're allowed to re-declare these
        /// symbols more than once in the same scope. These symbols are also hoisted
        /// out of the scope they are declared in to the closest containing function
        /// or module scope. These are the symbols with this kind:
        ///
        /// - Function arguments
        /// - Function statements
        /// - Variables declared using "var"
        hoisted,
        hoisted_function,

        /// There's a weird special case where catch variables declared using a simple
        /// identifier (i.e. not a binding pattern) block hoisted variables instead of
        /// becoming an error:
        ///
        ///   var e = 0;
        ///   try { throw 1 } catch (e) {
        ///     print(e) // 1
        ///     var e = 2
        ///     print(e) // 2
        ///   }
        ///   print(e) // 0 (since the hoisting stops at the catch block boundary)
        ///
        /// However, other forms are still a syntax error:
        ///
        ///   try {} catch (e) { let e }
        ///   try {} catch ({e}) { var e }
        ///
        /// This symbol is for handling this weird special case.
        catch_identifier,

        /// Generator and async functions are not hoisted, but still have special
        /// properties such as being able to overwrite previous functions with the
        /// same name
        generator_or_async_function,

        /// This is the special "arguments" variable inside functions
        arguments,

        /// Classes can merge with TypeScript namespaces.
        class,

        /// A class-private identifier (i.e. "#foo").
        private_field,
        private_method,
        private_get,
        private_set,
        private_get_set_pair,
        private_static_field,
        private_static_method,
        private_static_get,
        private_static_set,
        private_static_get_set_pair,

        /// Labels are in their own namespace
        label,

        /// TypeScript enums can merge with TypeScript namespaces and other TypeScript
        /// enums.
        ts_enum,

        /// TypeScript namespaces can merge with classes, functions, TypeScript enums,
        /// and other TypeScript namespaces.
        ts_namespace,

        /// In TypeScript, imports are allowed to silently collide with symbols within
        /// the module. Presumably this is because the imports may be type-only.
        /// Import statement namespace references should NOT have this set.
        import,

        /// Assigning to a "const" symbol will throw a TypeError at runtime
        constant,

        /// This annotates all other symbols that don't have special behavior.
        other,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }

        pub inline fn isPrivate(kind: Symbol.Kind) bool {
            return @intFromEnum(kind) >= @intFromEnum(Symbol.Kind.private_field) and @intFromEnum(kind) <= @intFromEnum(Symbol.Kind.private_static_get_set_pair);
        }

        pub inline fn isHoisted(kind: Symbol.Kind) bool {
            return switch (kind) {
                .hoisted, .hoisted_function => true,
                else => false,
            };
        }

        pub inline fn isHoistedOrFunction(kind: Symbol.Kind) bool {
            return switch (kind) {
                .hoisted, .hoisted_function, .generator_or_async_function => true,
                else => false,
            };
        }

        pub inline fn isFunction(kind: Symbol.Kind) bool {
            return switch (kind) {
                .hoisted_function, .generator_or_async_function => true,
                else => false,
            };
        }
    };

    pub const isKindPrivate = Symbol.Kind.isPrivate;
    pub const isKindHoisted = Symbol.Kind.isHoisted;
    pub const isKindHoistedOrFunction = Symbol.Kind.isHoistedOrFunction;
    pub const isKindFunction = Symbol.Kind.isFunction;

    pub const Use = struct {
        count_estimate: u32 = 0,
    };

    pub const List = BabyList(Symbol);
    pub const NestedList = BabyList(List);

    pub fn mergeContentsWith(this: *Symbol, old: *Symbol) void {
        this.use_count_estimate += old.use_count_estimate;
        if (old.must_not_be_renamed) {
            this.original_name = old.original_name;
            this.must_not_be_renamed = true;
        }

        // TODO: MustStartWithCapitalLetterForJSX
    }

    pub const Map = struct {
        // This could be represented as a "map[Ref]Symbol" but a two-level array was
        // more efficient in profiles. This appears to be because it doesn't involve
        // a hash. This representation also makes it trivial to quickly merge symbol
        // maps from multiple files together. Each file only generates symbols in a
        // single inner array, so you can join the maps together by just make a
        // single outer array containing all of the inner arrays. See the comment on
        // "Ref" for more detail.
        symbols_for_source: NestedList = .{},

        pub fn dump(this: Map) void {
            defer Output.flush();
            for (this.symbols_for_source.slice(), 0..) |symbols, i| {
                Output.prettyln("\n\n-- Source ID: {d} ({d} symbols) --\n\n", .{ i, symbols.len });
                for (symbols.slice(), 0..) |symbol, inner_index| {
                    Output.prettyln(
                        " name: {s}\n  tag: {s}\n       {any}\n",
                        .{
                            symbol.original_name, @tagName(symbol.kind),
                            if (symbol.hasLink()) symbol.link else Ref{
                                .source_index = @as(Ref.Int, @truncate(i)),
                                .inner_index = @as(Ref.Int, @truncate(inner_index)),
                                .tag = .symbol,
                            },
                        },
                    );
                }
            }
        }

        pub fn assignChunkIndex(this: *Map, decls_: DeclaredSymbol.List, chunk_index: u32) void {
            const Iterator = struct {
                map: *Map,
                chunk_index: u32,

                pub fn next(self: @This(), ref: Ref) void {
                    var symbol = self.map.get(ref).?;
                    symbol.chunk_index = self.chunk_index;
                }
            };
            var decls = decls_;

            DeclaredSymbol.forEachTopLevelSymbol(&decls, Iterator{ .map = this, .chunk_index = chunk_index }, Iterator.next);
        }

        pub fn merge(this: *Map, old: Ref, new: Ref) Ref {
            if (old.eql(new)) {
                return new;
            }

            var old_symbol = this.get(old).?;
            if (old_symbol.hasLink()) {
                const old_link = old_symbol.link;
                old_symbol.link = this.merge(old_link, new);
                return old_symbol.link;
            }

            var new_symbol = this.get(new).?;

            if (new_symbol.hasLink()) {
                const new_link = new_symbol.link;
                new_symbol.link = this.merge(old, new_link);
                return new_symbol.link;
            }

            old_symbol.link = new;
            new_symbol.mergeContentsWith(old_symbol);
            return new;
        }

        pub fn get(self: *const Map, ref: Ref) ?*Symbol {
            if (Ref.isSourceIndexNull(ref.sourceIndex()) or ref.isSourceContentsSlice()) {
                return null;
            }

            return self.symbols_for_source.at(ref.sourceIndex()).mut(ref.innerIndex());
        }

        pub fn getConst(self: *const Map, ref: Ref) ?*const Symbol {
            if (Ref.isSourceIndexNull(ref.sourceIndex()) or ref.isSourceContentsSlice()) {
                return null;
            }

            return self.symbols_for_source.at(ref.sourceIndex()).at(ref.innerIndex());
        }

        pub fn init(sourceCount: usize, allocator: std.mem.Allocator) !Map {
            const symbols_for_source: NestedList = NestedList.init(try allocator.alloc([]Symbol, sourceCount));
            return Map{ .symbols_for_source = symbols_for_source };
        }

        pub fn initList(list: NestedList) Map {
            return Map{ .symbols_for_source = list };
        }

        pub fn getWithLink(symbols: *const Map, ref: Ref) ?*Symbol {
            var symbol: *Symbol = symbols.get(ref) orelse return null;
            if (symbol.hasLink()) {
                return symbols.get(symbol.link) orelse symbol;
            }
            return symbol;
        }

        pub fn getWithLinkConst(symbols: *Map, ref: Ref) ?*const Symbol {
            var symbol: *const Symbol = symbols.getConst(ref) orelse return null;
            if (symbol.hasLink()) {
                return symbols.getConst(symbol.link) orelse symbol;
            }
            return symbol;
        }

        pub fn followAll(symbols: *Map) void {
            const trace = bun.tracy.traceNamed(@src(), "Symbols.followAll");
            defer trace.end();
            for (symbols.symbols_for_source.slice()) |list| {
                for (list.slice()) |*symbol| {
                    if (!symbol.hasLink()) continue;
                    symbol.link = follow(symbols, symbol.link);
                }
            }
        }

        /// Equivalent to followSymbols in esbuild
        pub fn follow(symbols: *const Map, ref: Ref) Ref {
            var symbol = symbols.get(ref) orelse return ref;
            if (!symbol.hasLink()) {
                return ref;
            }

            const link = follow(symbols, symbol.link);

            if (!symbol.link.eql(link)) {
                symbol.link = link;
            }

            return link;
        }
    };

    pub inline fn isHoisted(self: *const Symbol) bool {
        return Symbol.isKindHoisted(self.kind);
    }
};

pub const OptionalChain = enum(u1) {
    /// "a?.b"
    start,

    /// "a?.b.c" => ".c" is .continuation
    /// "(a?.b).c" => ".c" is null
    continuation,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};

pub const E = struct {
    pub const Array = struct {
        items: ExprNodeList = ExprNodeList{},
        comma_after_spread: ?logger.Loc = null,
        is_single_line: bool = false,
        is_parenthesized: bool = false,
        was_originally_macro: bool = false,
        close_bracket_loc: logger.Loc = logger.Loc.Empty,

        pub fn push(this: *Array, allocator: std.mem.Allocator, item: Expr) !void {
            try this.items.push(allocator, item);
        }

        pub inline fn slice(this: Array) []Expr {
            return this.items.slice();
        }

        pub fn inlineSpreadOfArrayLiterals(
            this: *Array,
            allocator: std.mem.Allocator,
            estimated_count: usize,
        ) !ExprNodeList {
            var out = try allocator.alloc(
                Expr,
                // This over-allocates a little but it's fine
                estimated_count + @as(usize, this.items.len),
            );
            var remain = out;
            for (this.items.slice()) |item| {
                switch (item.data) {
                    .e_spread => |val| {
                        if (val.value.data == .e_array) {
                            for (val.value.data.e_array.items.slice()) |inner_item| {
                                if (inner_item.data == .e_missing) {
                                    remain[0] = Expr.init(E.Undefined, .{}, inner_item.loc);
                                    remain = remain[1..];
                                } else {
                                    remain[0] = inner_item;
                                    remain = remain[1..];
                                }
                            }

                            // skip empty arrays
                            // don't include the inlined spread.
                            continue;
                        }
                        // non-arrays are kept in
                    },
                    else => {},
                }

                remain[0] = item;
                remain = remain[1..];
            }

            return ExprNodeList.init(out[0 .. out.len - remain.len]);
        }

        pub fn toJS(this: @This(), allocator: std.mem.Allocator, globalObject: *JSC.JSGlobalObject) ToJSError!JSC.JSValue {
            const items = this.items.slice();
            var array = JSC.JSValue.createEmptyArray(globalObject, items.len);
            array.protect();
            defer array.unprotect();
            for (items, 0..) |expr, j| {
                array.putIndex(globalObject, @as(u32, @truncate(j)), try expr.data.toJS(allocator, globalObject));
            }

            return array;
        }

        /// Assumes each item in the array is a string
        pub fn alphabetizeStrings(this: *Array) void {
            if (comptime Environment.allow_assert) {
                for (this.items.slice()) |item| {
                    bun.assert(item.data == .e_string);
                }
            }
            std.sort.pdq(Expr, this.items.slice(), {}, Sorter.isLessThan);
        }

        const Sorter = struct {
            pub fn isLessThan(ctx: void, lhs: Expr, rhs: Expr) bool {
                return strings.cmpStringsAsc(ctx, lhs.data.e_string.data, rhs.data.e_string.data);
            }
        };
    };

    pub const Unary = struct {
        op: Op.Code,
        value: ExprNodeIndex,
    };

    pub const Binary = struct {
        left: ExprNodeIndex,
        right: ExprNodeIndex,
        op: Op.Code,
    };

    pub const Boolean = struct {
        value: bool,
        pub fn toJS(this: @This(), ctx: JSC.C.JSContextRef) JSC.C.JSValueRef {
            return JSC.C.JSValueMakeBoolean(ctx, this.value);
        }
    };
    pub const Super = struct {};
    pub const Null = struct {};
    pub const This = struct {};
    pub const Undefined = struct {};
    pub const New = struct {
        target: ExprNodeIndex,
        args: ExprNodeList = ExprNodeList{},

        // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
        // this call expression. See the comment inside ECall for more details.
        can_be_unwrapped_if_unused: bool = false,

        close_parens_loc: logger.Loc,
    };
    pub const NewTarget = struct {
        range: logger.Range,
    };
    pub const ImportMeta = struct {};
    pub const ImportMetaMain = struct {
        /// If we want to print `!import.meta.main`, set this flag to true
        /// instead of wrapping in a unary not. This way, the printer can easily
        /// print `require.main != module` instead of `!(require.main == module)`
        inverted: bool = false,
    };

    pub const Call = struct {
        // Node:
        target: ExprNodeIndex,
        args: ExprNodeList = ExprNodeList{},
        optional_chain: ?OptionalChain = null,
        is_direct_eval: bool = false,
        close_paren_loc: logger.Loc = logger.Loc.Empty,

        // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
        // this call expression. This is an annotation used for tree shaking, and
        // means that the call can be removed if it's unused. It does not mean the
        // call is pure (e.g. it may still return something different if called twice).
        //
        // Note that the arguments are not considered to be part of the call. If the
        // call itself is removed due to this annotation, the arguments must remain
        // if they have side effects.
        can_be_unwrapped_if_unused: bool = false,

        // Used when printing to generate the source prop on the fly
        was_jsx_element: bool = false,

        pub fn hasSameFlagsAs(a: *Call, b: *Call) bool {
            return (a.optional_chain == b.optional_chain and
                a.is_direct_eval == b.is_direct_eval and
                a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused);
        }
    };

    pub const Dot = struct {
        // target is Node
        target: ExprNodeIndex,
        name: string,
        name_loc: logger.Loc,
        optional_chain: ?OptionalChain = null,

        // If true, this property access is known to be free of side-effects. That
        // means it can be removed if the resulting value isn't used.
        can_be_removed_if_unused: bool = false,

        // If true, this property access is a function that, when called, can be
        // unwrapped if the resulting value is unused. Unwrapping means discarding
        // the call target but keeping any arguments with side effects.
        call_can_be_unwrapped_if_unused: bool = false,

        pub fn hasSameFlagsAs(a: *Dot, b: *Dot) bool {
            return (a.optional_chain == b.optional_chain and
                a.is_direct_eval == b.is_direct_eval and
                a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused and a.call_can_be_unwrapped_if_unused == b.call_can_be_unwrapped_if_unused);
        }
    };

    pub const Index = struct {
        index: ExprNodeIndex,
        target: ExprNodeIndex,
        optional_chain: ?OptionalChain = null,

        pub fn hasSameFlagsAs(a: *E.Index, b: *E.Index) bool {
            return (a.optional_chain == b.optional_chain);
        }
    };

    pub const Arrow = struct {
        args: []G.Arg = &[_]G.Arg{},
        body: G.FnBody,

        is_async: bool = false,
        has_rest_arg: bool = false,
        prefer_expr: bool = false, // Use shorthand if true and "Body" is a single return statement
    };

    pub const Function = struct { func: G.Fn };

    pub const Identifier = struct {
        ref: Ref = Ref.None,

        // If we're inside a "with" statement, this identifier may be a property
        // access. In that case it would be incorrect to remove this identifier since
        // the property access may be a getter or setter with side effects.
        must_keep_due_to_with_stmt: bool = false,

        // If true, this identifier is known to not have a side effect (i.e. to not
        // throw an exception) when referenced. If false, this identifier may or may
        // not have side effects when referenced. This is used to allow the removal
        // of known globals such as "Object" if they aren't used.
        can_be_removed_if_unused: bool = false,

        // If true, this identifier represents a function that, when called, can be
        // unwrapped if the resulting value is unused. Unwrapping means discarding
        // the call target but keeping any arguments with side effects.
        call_can_be_unwrapped_if_unused: bool = false,

        pub inline fn init(ref: Ref) Identifier {
            return Identifier{
                .ref = ref,
                .must_keep_due_to_with_stmt = false,
                .can_be_removed_if_unused = false,
                .call_can_be_unwrapped_if_unused = false,
            };
        }
    };

    /// This is similar to an `Identifier` but it represents a reference to an ES6
    /// import item.
    ///
    /// Depending on how the code is linked, the file containing this EImportIdentifier
    /// may or may not be in the same module group as the file it was imported from.
    ///
    /// If it's the same module group than we can just merge the import item symbol
    /// with the corresponding symbol that was imported, effectively renaming them
    /// to be the same thing and statically binding them together.
    ///
    /// But if it's a different module group, then the import must be dynamically
    /// evaluated using a property access off the corresponding namespace symbol,
    /// which represents the result of a require() call.
    ///
    /// It's stored as a separate type so it's not easy to confuse with a plain
    /// identifier. For example, it'd be bad if code trying to convert "{x: x}" into
    /// "{x}" shorthand syntax wasn't aware that the "x" in this case is actually
    /// "{x: importedNamespace.x}". This separate type forces code to opt-in to
    /// doing this instead of opt-out.
    pub const ImportIdentifier = struct {
        ref: Ref = Ref.None,

        /// If true, this was originally an identifier expression such as "foo". If
        /// false, this could potentially have been a member access expression such
        /// as "ns.foo" off of an imported namespace object.
        was_originally_identifier: bool = false,
    };

    /// This is a dot expression on exports, such as `exports.<ref>`. It is given
    /// it's own AST node to allow CommonJS unwrapping, in which this can just be
    /// the identifier in the Ref
    pub const CommonJSExportIdentifier = struct {
        ref: Ref = Ref.None,
        base: Base = .exports,

        /// The original variant of the dot expression must be known so that in the case that we
        /// - fail to convert this to ESM
        /// - ALSO see an assignment to `module.exports` (commonjs_module_exports_assigned_deoptimized)
        /// It must be known if `exports` or `module.exports` was written in source
        /// code, as the distinction will alter behavior. The fixup happens in the printer when
        /// printing this node.
        pub const Base = enum {
            exports,
            module_dot_exports,
        };
    };

    // This is similar to EIdentifier but it represents class-private fields and
    // methods. It can be used where computed properties can be used, such as
    // EIndex and Property.
    pub const PrivateIdentifier = struct {
        ref: Ref,
    };

    /// In development mode, the new JSX transform has a few special props
    /// - `React.jsxDEV(type, arguments, key, isStaticChildren, source, self)`
    /// - `arguments`:
    ///      ```{ ...props, children: children, }```
    /// - `source`: https://github.com/babel/babel/blob/ef87648f3f05ccc393f89dea7d4c7c57abf398ce/packages/babel-plugin-transform-react-jsx-source/src/index.js#L24-L48
    ///      ```{
    ///         fileName: string | null,
    ///         columnNumber: number | null,
    ///         lineNumber: number | null,
    ///      }```
    /// - `children`:
    ///     - static the function is React.jsxsDEV, "jsxs" instead of "jsx"
    ///     - one child? the function is React.jsxDEV,
    ///     - no children? the function is React.jsxDEV and children is an empty array.
    /// `isStaticChildren`: https://github.com/facebook/react/blob/4ca62cac45c288878d2532e5056981d177f9fdac/packages/react/src/jsx/ReactJSXElementValidator.js#L369-L384
    ///     This flag means children is an array of JSX Elements literals.
    ///     The documentation on this is sparse, but it appears that
    ///     React just calls Object.freeze on the children array.
    ///     Object.freeze, historically, is quite a bit slower[0] than just not doing that.
    ///     Given that...I am choosing to always pass "false" to this.
    ///     This also skips extra state that we'd need to track.
    ///     If React Fast Refresh ends up using this later, then we can revisit this decision.
    ///  [0]: https://github.com/automerge/automerge/issues/177
    pub const JSXElement = struct {
        /// JSX tag name
        /// <div> => E.String.init("div")
        /// <MyComponent> => E.Identifier{.ref = symbolPointingToMyComponent }
        /// null represents a fragment
        tag: ?ExprNodeIndex = null,

        /// JSX props
        properties: G.Property.List = G.Property.List{},

        /// JSX element children <div>{this_is_a_child_element}</div>
        children: ExprNodeList = ExprNodeList{},

        // needed to make sure parse and visit happen in the same order
        key_prop_index: i32 = -1,

        flags: Flags.JSXElement.Bitset = Flags.JSXElement.Bitset{},

        close_tag_loc: logger.Loc = logger.Loc.Empty,

        pub const SpecialProp = enum {
            __self, // old react transform used this as a prop
            __source,
            key,
            ref,
            any,

            pub const Map = ComptimeStringMap(SpecialProp, .{
                .{ "__self", .__self },
                .{ "__source", .__source },
                .{ "key", .key },
                .{ "ref", .ref },
            });
        };
    };

    pub const Missing = struct {
        pub fn jsonStringify(_: *const @This(), writer: anytype) !void {
            return try writer.write(null);
        }
    };

    pub const Number = struct {
        value: f64,

        const double_digit = [_]string{ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "100" };
        const neg_double_digit = [_]string{ "-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9", "-10", "-11", "-12", "-13", "-14", "-15", "-16", "-17", "-18", "-19", "-20", "-21", "-22", "-23", "-24", "-25", "-26", "-27", "-28", "-29", "-30", "-31", "-32", "-33", "-34", "-35", "-36", "-37", "-38", "-39", "-40", "-41", "-42", "-43", "-44", "-45", "-46", "-47", "-48", "-49", "-50", "-51", "-52", "-53", "-54", "-55", "-56", "-57", "-58", "-59", "-60", "-61", "-62", "-63", "-64", "-65", "-66", "-67", "-68", "-69", "-70", "-71", "-72", "-73", "-74", "-75", "-76", "-77", "-78", "-79", "-80", "-81", "-82", "-83", "-84", "-85", "-86", "-87", "-88", "-89", "-90", "-91", "-92", "-93", "-94", "-95", "-96", "-97", "-98", "-99", "-100" };

        /// String concatenation with numbers is required by the TypeScript compiler for
        /// "constant expression" handling in enums. We can match the behavior of a JS VM
        /// by calling out to the APIs in WebKit which are responsible for this operation.
        ///
        /// This can return `null` in wasm builds to avoid linking JSC
        pub fn toString(this: Number, allocator: std.mem.Allocator) ?string {
            return toStringFromF64(this.value, allocator);
        }

        pub fn toStringFromF64(value: f64, allocator: std.mem.Allocator) ?string {
            if (value == @trunc(value) and (value < std.math.maxInt(i32) and value > std.math.minInt(i32))) {
                const int_value = @as(i64, @intFromFloat(value));
                const abs = @as(u64, @intCast(@abs(int_value)));

                // do not allocate for a small set of constant numbers: -100 through 100
                if (abs < double_digit.len) {
                    return if (int_value < 0)
                        neg_double_digit[abs]
                    else
                        double_digit[abs];
                }

                return std.fmt.allocPrint(allocator, "{d}", .{@as(i32, @intCast(int_value))}) catch return null;
            }

            if (std.math.isNan(value)) {
                return "NaN";
            }

            if (std.math.isNegativeInf(value)) {
                return "-Infinity";
            }

            if (std.math.isInf(value)) {
                return "Infinity";
            }

            if (Environment.isNative) {
                var buf: [124]u8 = undefined;
                return allocator.dupe(u8, bun.fmt.FormatDouble.dtoa(&buf, value)) catch bun.outOfMemory();
            } else {
                // do not attempt to implement the spec here, it would be error prone.
            }

            return null;
        }

        pub inline fn toU64(self: Number) u64 {
            return self.to(u64);
        }

        pub inline fn toUsize(self: Number) usize {
            return self.to(usize);
        }

        pub inline fn toU32(self: Number) u32 {
            return self.to(u32);
        }

        pub inline fn toU16(self: Number) u16 {
            return self.to(u16);
        }

        pub fn to(self: Number, comptime T: type) T {
            return @as(T, @intFromFloat(@min(@max(@trunc(self.value), 0), comptime @min(std.math.floatMax(f64), std.math.maxInt(T)))));
        }

        pub fn jsonStringify(self: *const Number, writer: anytype) !void {
            return try writer.write(self.value);
        }

        pub fn toJS(this: @This()) JSC.JSValue {
            return JSC.JSValue.jsNumber(this.value);
        }
    };

    pub const BigInt = struct {
        value: string,

        pub var empty = BigInt{ .value = "" };

        pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
            return try writer.write(self.value);
        }

        pub fn toJS(_: @This()) JSC.JSValue {
            // TODO:
            return JSC.JSValue.jsNumber(0);
        }
    };

    pub const Object = struct {
        properties: G.Property.List = G.Property.List{},
        comma_after_spread: ?logger.Loc = null,
        is_single_line: bool = false,
        is_parenthesized: bool = false,
        was_originally_macro: bool = false,

        close_brace_loc: logger.Loc = logger.Loc.Empty,

        // used in TOML parser to merge properties
        pub const Rope = struct {
            head: Expr,
            next: ?*Rope = null,
            pub fn append(this: *Rope, expr: Expr, allocator: std.mem.Allocator) OOM!*Rope {
                if (this.next) |next| {
                    return try next.append(expr, allocator);
                }

                const rope = try allocator.create(Rope);
                rope.* = .{ .head = expr };
                this.next = rope;
                return rope;
            }
        };

        pub fn get(self: *const Object, key: string) ?Expr {
            return if (asProperty(self, key)) |query| query.expr else @as(?Expr, null);
        }

        pub fn toJS(this: *Object, allocator: std.mem.Allocator, globalObject: *JSC.JSGlobalObject) ToJSError!JSC.JSValue {
            var obj = JSC.JSValue.createEmptyObject(globalObject, this.properties.len);
            obj.protect();
            defer obj.unprotect();
            const props: []const G.Property = this.properties.slice();
            for (props) |prop| {
                if (prop.kind != .normal or prop.class_static_block != null or prop.key == null or prop.key.?.data != .e_string or prop.value == null) {
                    return error.@"Cannot convert argument type to JS";
                }
                var key = prop.key.?.data.e_string.toZigString(allocator);
                obj.put(globalObject, &key, try prop.value.?.toJS(allocator, globalObject));
            }

            return obj;
        }

        pub fn put(self: *Object, allocator: std.mem.Allocator, key: string, expr: Expr) !void {
            if (asProperty(self, key)) |query| {
                self.properties.ptr[query.i].value = expr;
            } else {
                try self.properties.push(allocator, .{
                    .key = Expr.init(E.String, E.String.init(key), expr.loc),
                    .value = expr,
                });
            }
        }

        pub fn putString(self: *Object, allocator: std.mem.Allocator, key: string, value: string) !void {
            return try put(self, allocator, key, Expr.init(E.String, E.String.init(value), logger.Loc.Empty));
        }

        pub const SetError = error{ OutOfMemory, Clobber };

        pub fn set(self: *const Object, key: Expr, allocator: std.mem.Allocator, value: Expr) SetError!void {
            if (self.hasProperty(key.data.e_string.data)) return error.Clobber;
            try self.properties.push(allocator, .{
                .key = key,
                .value = value,
            });
        }

        pub const RopeQuery = struct {
            expr: Expr,
            rope: *const Rope,
        };

        // this is terribly, shamefully slow
        pub fn setRope(self: *Object, rope: *const Rope, allocator: std.mem.Allocator, value: Expr) SetError!void {
            if (self.get(rope.head.data.e_string.data)) |existing| {
                switch (existing.data) {
                    .e_array => |array| {
                        if (rope.next == null) {
                            try array.push(allocator, value);
                            return;
                        }

                        if (array.items.last()) |last| {
                            if (last.data != .e_object) {
                                return error.Clobber;
                            }

                            try last.data.e_object.setRope(rope.next.?, allocator, value);
                            return;
                        }

                        try array.push(allocator, value);
                        return;
                    },
                    .e_object => |object| {
                        if (rope.next != null) {
                            try object.setRope(rope.next.?, allocator, value);
                            return;
                        }

                        return error.Clobber;
                    },
                    else => {
                        return error.Clobber;
                    },
                }
            }

            var value_ = value;
            if (rope.next) |next| {
                var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
                try obj.data.e_object.setRope(next, allocator, value);
                value_ = obj;
            }

            try self.properties.push(allocator, .{
                .key = rope.head,
                .value = value_,
            });
        }

        pub fn getOrPutObject(self: *Object, rope: *const Rope, allocator: std.mem.Allocator) SetError!Expr {
            if (self.get(rope.head.data.e_string.data)) |existing| {
                switch (existing.data) {
                    .e_array => |array| {
                        if (rope.next == null) {
                            return error.Clobber;
                        }

                        if (array.items.last()) |last| {
                            if (last.data != .e_object) {
                                return error.Clobber;
                            }

                            return try last.data.e_object.getOrPutObject(rope.next.?, allocator);
                        }

                        return error.Clobber;
                    },
                    .e_object => |object| {
                        if (rope.next == null) {
                            // success
                            return existing;
                        }

                        return try object.getOrPutObject(rope.next.?, allocator);
                    },
                    else => {
                        return error.Clobber;
                    },
                }
            }

            if (rope.next) |next| {
                var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
                const out = try obj.data.e_object.getOrPutObject(next, allocator);
                try self.properties.push(allocator, .{
                    .key = rope.head,
                    .value = obj,
                });
                return out;
            }

            const out = Expr.init(E.Object, E.Object{}, rope.head.loc);
            try self.properties.push(allocator, .{
                .key = rope.head,
                .value = out,
            });
            return out;
        }

        pub fn getOrPutArray(self: *Object, rope: *const Rope, allocator: std.mem.Allocator) SetError!Expr {
            if (self.get(rope.head.data.e_string.data)) |existing| {
                switch (existing.data) {
                    .e_array => |array| {
                        if (rope.next == null) {
                            return existing;
                        }

                        if (array.items.last()) |last| {
                            if (last.data != .e_object) {
                                return error.Clobber;
                            }

                            return try last.data.e_object.getOrPutArray(rope.next.?, allocator);
                        }

                        return error.Clobber;
                    },
                    .e_object => |object| {
                        if (rope.next == null) {
                            return error.Clobber;
                        }

                        return try object.getOrPutArray(rope.next.?, allocator);
                    },
                    else => {
                        return error.Clobber;
                    },
                }
            }

            if (rope.next) |next| {
                var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
                const out = try obj.data.e_object.getOrPutArray(next, allocator);
                try self.properties.push(allocator, .{
                    .key = rope.head,
                    .value = obj,
                });
                return out;
            }

            const out = Expr.init(E.Array, E.Array{}, rope.head.loc);
            try self.properties.push(allocator, .{
                .key = rope.head,
                .value = out,
            });
            return out;
        }

        pub fn hasProperty(obj: *const Object, name: string) bool {
            for (obj.properties.slice()) |prop| {
                const key = prop.key orelse continue;
                if (std.meta.activeTag(key.data) != .e_string) continue;
                if (key.data.e_string.eql(string, name)) return true;
            }
            return false;
        }

        pub fn asProperty(obj: *const Object, name: string) ?Expr.Query {
            for (obj.properties.slice(), 0..) |prop, i| {
                const value = prop.value orelse continue;
                const key = prop.key orelse continue;
                if (std.meta.activeTag(key.data) != .e_string) continue;
                const key_str = key.data.e_string;
                if (key_str.eql(string, name)) {
                    return Expr.Query{
                        .expr = value,
                        .loc = key.loc,
                        .i = @as(u32, @truncate(i)),
                    };
                }
            }

            return null;
        }

        /// Assumes each key in the property is a string
        pub fn alphabetizeProperties(this: *Object) void {
            if (comptime Environment.allow_assert) {
                for (this.properties.slice()) |prop| {
                    bun.assert(prop.key.?.data == .e_string);
                }
            }
            std.sort.pdq(G.Property, this.properties.slice(), {}, Sorter.isLessThan);
        }

        pub fn packageJSONSort(this: *Object) void {
            std.sort.pdq(G.Property, this.properties.slice(), {}, PackageJSONSort.Fields.isLessThan);
        }

        const PackageJSONSort = struct {
            const Fields = enum(u8) {
                name = 0,
                version = 1,
                author = 2,
                repository = 3,
                config = 4,
                main = 5,
                module = 6,
                dependencies = 7,
                devDependencies = 8,
                optionalDependencies = 9,
                peerDependencies = 10,
                exports = 11,
                __fake = 12,

                pub const Map = ComptimeStringMap(Fields, .{
                    .{ "name", Fields.name },
                    .{ "version", Fields.version },
                    .{ "author", Fields.author },
                    .{ "repository", Fields.repository },
                    .{ "config", Fields.config },
                    .{ "main", Fields.main },
                    .{ "module", Fields.module },
                    .{ "dependencies", Fields.dependencies },
                    .{ "devDependencies", Fields.devDependencies },
                    .{ "optionalDependencies", Fields.optionalDependencies },
                    .{ "peerDependencies", Fields.peerDependencies },
                    .{ "exports", Fields.exports },
                });

                pub fn isLessThan(ctx: void, lhs: G.Property, rhs: G.Property) bool {
                    var lhs_key_size: u8 = @intFromEnum(Fields.__fake);
                    var rhs_key_size: u8 = @intFromEnum(Fields.__fake);

                    if (lhs.key != null and lhs.key.?.data == .e_string) {
                        lhs_key_size = @intFromEnum(Map.get(lhs.key.?.data.e_string.data) orelse Fields.__fake);
                    }

                    if (rhs.key != null and rhs.key.?.data == .e_string) {
                        rhs_key_size = @intFromEnum(Map.get(rhs.key.?.data.e_string.data) orelse Fields.__fake);
                    }

                    return switch (std.math.order(lhs_key_size, rhs_key_size)) {
                        .lt => true,
                        .gt => false,
                        .eq => strings.cmpStringsAsc(ctx, lhs.key.?.data.e_string.data, rhs.key.?.data.e_string.data),
                    };
                }
            };
        };

        const Sorter = struct {
            pub fn isLessThan(ctx: void, lhs: G.Property, rhs: G.Property) bool {
                return strings.cmpStringsAsc(ctx, lhs.key.?.data.e_string.data, rhs.key.?.data.e_string.data);
            }
        };
    };

    pub const Spread = struct { value: ExprNodeIndex };

    /// JavaScript string literal type
    pub const String = struct {
        // A version of this where `utf8` and `value` are stored in a packed union, with len as a single u32 was attempted.
        // It did not improve benchmarks. Neither did converting this from a heap-allocated type to a stack-allocated type.
        // TODO: change this to *const anyopaque and change all uses to either .slice8() or .slice16()
        data: []const u8 = "",
        prefer_template: bool = false,

        // A very simple rope implementation
        // We only use this for string folding, so this is kind of overkill
        // We don't need to deal with substrings
        next: ?*String = null,
        end: ?*String = null,
        rope_len: u32 = 0,
        is_utf16: bool = false,

        pub fn isIdentifier(this: *String, allocator: std.mem.Allocator) bool {
            if (!this.isUTF8()) {
                return bun.js_lexer.isIdentifierUTF16(this.slice16());
            }

            return bun.js_lexer.isIdentifier(this.slice(allocator));
        }

        pub const class = E.String{ .data = "class" };

        pub fn push(this: *String, other: *String) void {
            bun.assert(this.isUTF8());
            bun.assert(other.isUTF8());

            if (other.rope_len == 0) {
                other.rope_len = @truncate(other.data.len);
            }

            if (this.rope_len == 0) {
                this.rope_len = @truncate(this.data.len);
            }

            this.rope_len += other.rope_len;
            if (this.next == null) {
                this.next = other;
                this.end = other;
            } else {
                var end = this.end.?;
                while (end.next != null) end = end.end.?;
                end.next = other;
                this.end = other;
            }
        }

        /// Cloning the rope string is rarely needed, see `foldStringAddition`'s
        /// comments and the 'edgecase/EnumInliningRopeStringPoison' test
        pub fn cloneRopeNodes(s: String) String {
            var root = s;

            if (root.next != null) {
                var current: ?*String = &root;
                while (true) {
                    const node = current.?;
                    if (node.next) |next| {
                        node.next = Expr.Data.Store.append(String, next.*);
                        current = node.next;
                    } else {
                        root.end = node;
                        break;
                    }
                }
            }

            return root;
        }

        pub fn toUTF8(this: *String, allocator: std.mem.Allocator) !void {
            if (!this.is_utf16) return;
            this.data = try strings.toUTF8Alloc(allocator, this.slice16());
            this.is_utf16 = false;
        }

        pub fn init(value: anytype) String {
            const Value = @TypeOf(value);
            if (Value == []u16 or Value == []const u16) {
                return .{
                    .data = @as([*]const u8, @ptrCast(value.ptr))[0..value.len],
                    .is_utf16 = true,
                };
            }

            return .{ .data = value };
        }

        /// E.String containing non-ascii characters may not fully work.
        /// https://github.com/oven-sh/bun/issues/11963
        /// More investigation is needed.
        pub fn initReEncodeUTF8(utf8: []const u8, allocator: std.mem.Allocator) String {
            return if (bun.strings.isAllASCII(utf8))
                init(utf8)
            else
                init(bun.strings.toUTF16AllocForReal(allocator, utf8, false, false) catch bun.outOfMemory());
        }

        pub fn slice8(this: *const String) []const u8 {
            bun.assert(!this.is_utf16);
            return this.data;
        }

        pub fn slice16(this: *const String) []const u16 {
            bun.assert(this.is_utf16);
            return @as([*]const u16, @ptrCast(@alignCast(this.data.ptr)))[0..this.data.len];
        }

        pub fn resolveRopeIfNeeded(this: *String, allocator: std.mem.Allocator) void {
            if (this.next == null or !this.isUTF8()) return;
            var bytes = std.ArrayList(u8).initCapacity(allocator, this.rope_len) catch bun.outOfMemory();

            bytes.appendSliceAssumeCapacity(this.data);
            var str = this.next;
            while (str) |part| {
                bytes.appendSlice(part.data) catch bun.outOfMemory();
                str = part.next;
            }
            this.data = bytes.items;
            this.next = null;
        }

        pub fn slice(this: *String, allocator: std.mem.Allocator) []const u8 {
            this.resolveRopeIfNeeded(allocator);
            return this.string(allocator) catch bun.outOfMemory();
        }

        pub var empty = String{};
        pub var @"true" = String{ .data = "true" };
        pub var @"false" = String{ .data = "false" };
        pub var @"null" = String{ .data = "null" };
        pub var @"undefined" = String{ .data = "undefined" };

        pub fn clone(str: *const String, allocator: std.mem.Allocator) !String {
            return String{
                .data = try allocator.dupe(u8, str.data),
                .prefer_template = str.prefer_template,
                .is_utf16 = !str.isUTF8(),
            };
        }

        pub fn cloneSliceIfNecessary(str: *const String, allocator: std.mem.Allocator) !bun.string {
            if (Expr.Data.Store.memory_allocator) |mem| {
                if (mem == GlobalStoreHandle.global_store_ast) {
                    return str.string(allocator);
                }
            }

            if (str.isUTF8()) {
                return allocator.dupe(u8, str.string(allocator) catch unreachable);
            }

            return str.string(allocator);
        }

        pub fn javascriptLength(s: *const String) ?u32 {
            if (s.rope_len > 0) {
                // We only support ascii ropes for now
                return s.rope_len;
            }

            if (s.isUTF8()) {
                if (!strings.isAllASCII(s.data)) {
                    return null;
                }
                return @truncate(s.data.len);
            }

            return @truncate(s.slice16().len);
        }

        pub inline fn len(s: *const String) usize {
            return if (s.rope_len > 0) s.rope_len else s.data.len;
        }

        pub inline fn isUTF8(s: *const String) bool {
            return !s.is_utf16;
        }

        pub inline fn isBlank(s: *const String) bool {
            return s.len() == 0;
        }

        pub inline fn isPresent(s: *const String) bool {
            return s.len() > 0;
        }

        pub fn eql(s: *const String, comptime _t: type, other: anytype) bool {
            if (s.isUTF8()) {
                switch (_t) {
                    @This() => {
                        if (other.isUTF8()) {
                            return strings.eqlLong(s.data, other.data, true);
                        } else {
                            return strings.utf16EqlString(other.slice16(), s.data);
                        }
                    },
                    bun.string => {
                        return strings.eqlLong(s.data, other, true);
                    },
                    []u16, []const u16 => {
                        return strings.utf16EqlString(other, s.data);
                    },
                    else => {
                        @compileError("Invalid type");
                    },
                }
            } else {
                switch (_t) {
                    @This() => {
                        if (other.isUTF8()) {
                            return strings.utf16EqlString(s.slice16(), other.data);
                        } else {
                            return std.mem.eql(u16, other.slice16(), s.slice16());
                        }
                    },
                    bun.string => {
                        return strings.utf16EqlString(s.slice16(), other);
                    },
                    []u16, []const u16 => {
                        return std.mem.eql(u16, other.slice16(), s.slice16());
                    },
                    else => {
                        @compileError("Invalid type");
                    },
                }
            }
        }

        pub fn eqlComptime(s: *const String, comptime value: []const u8) bool {
            return if (s.isUTF8())
                strings.eqlComptime(s.data, value)
            else
                strings.eqlComptimeUTF16(s.slice16(), value);
        }

        pub fn hasPrefixComptime(s: *const String, comptime value: anytype) bool {
            if (s.data.len < value.len)
                return false;

            return if (s.isUTF8())
                strings.eqlComptime(s.data[0..value.len], value)
            else
                strings.eqlComptimeUTF16(s.slice16()[0..value.len], value);
        }

        pub fn string(s: *const String, allocator: std.mem.Allocator) OOM!bun.string {
            if (s.isUTF8()) {
                return s.data;
            } else {
                return strings.toUTF8Alloc(allocator, s.slice16());
            }
        }

        pub fn stringZ(s: *const String, allocator: std.mem.Allocator) OOM!bun.stringZ {
            if (s.isUTF8()) {
                return allocator.dupeZ(u8, s.data);
            } else {
                return strings.toUTF8AllocZ(allocator, s.slice16());
            }
        }

        pub fn stringCloned(s: *const String, allocator: std.mem.Allocator) OOM!bun.string {
            if (s.isUTF8()) {
                return allocator.dupe(u8, s.data);
            } else {
                return strings.toUTF8Alloc(allocator, s.slice16());
            }
        }

        pub fn hash(s: *const String) u64 {
            if (s.isBlank()) return 0;

            if (s.isUTF8()) {
                // hash utf-8
                return bun.hash(s.data);
            } else {
                // hash utf-16
                return bun.hash(@as([*]const u8, @ptrCast(s.slice16().ptr))[0 .. s.slice16().len * 2]);
            }
        }

        pub fn toJS(s: *String, allocator: std.mem.Allocator, globalObject: *JSC.JSGlobalObject) !JSC.JSValue {
            s.resolveRopeIfNeeded(allocator);
            if (!s.isPresent()) {
                var emp = bun.String.empty;
                return emp.toJS(globalObject);
            }

            if (s.isUTF8()) {
                if (try strings.toUTF16Alloc(allocator, s.slice8(), false, false)) |utf16| {
                    var out, const chars = bun.String.createUninitialized(.utf16, utf16.len);
                    @memcpy(chars, utf16);
                    return out.transferToJS(globalObject);
                } else {
                    var out, const chars = bun.String.createUninitialized(.latin1, s.slice8().len);
                    @memcpy(chars, s.slice8());
                    return out.transferToJS(globalObject);
                }
            } else {
                var out, const chars = bun.String.createUninitialized(.utf16, s.slice16().len);
                @memcpy(chars, s.slice16());
                return out.transferToJS(globalObject);
            }
        }

        pub fn toZigString(s: *String, allocator: std.mem.Allocator) JSC.ZigString {
            if (s.isUTF8()) {
                return JSC.ZigString.fromUTF8(s.slice(allocator));
            } else {
                return JSC.ZigString.initUTF16(s.slice16());
            }
        }

        pub fn format(s: String, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            comptime bun.assert(fmt.len == 0);

            try writer.writeAll("E.String");
            if (s.next == null) {
                try writer.writeAll("(");
                if (s.isUTF8()) {
                    try writer.print("\"{s}\"", .{s.data});
                } else {
                    try writer.print("\"{}\"", .{bun.fmt.utf16(s.slice16())});
                }
                try writer.writeAll(")");
            } else {
                try writer.writeAll("(rope: [");
                var it: ?*const String = &s;
                while (it) |part| {
                    if (part.isUTF8()) {
                        try writer.print("\"{s}\"", .{part.data});
                    } else {
                        try writer.print("\"{}\"", .{bun.fmt.utf16(part.slice16())});
                    }
                    it = part.next;
                    if (it != null) try writer.writeAll(" ");
                }
                try writer.writeAll("])");
            }
        }

        pub fn jsonStringify(s: *const String, writer: anytype) !void {
            var buf = [_]u8{0} ** 4096;
            var i: usize = 0;
            for (s.slice16()) |char| {
                buf[i] = @as(u8, @intCast(char));
                i += 1;
                if (i >= 4096) {
                    break;
                }
            }

            return try writer.write(buf[0..i]);
        }
    };

    // value is in the Node
    pub const TemplatePart = struct {
        value: ExprNodeIndex,
        tail_loc: logger.Loc,
        tail: Template.Contents,
    };

    pub const Template = struct {
        tag: ?ExprNodeIndex = null,
        parts: []TemplatePart = &.{},
        head: Contents,

        pub const Contents = union(Tag) {
            cooked: E.String,
            raw: string,

            const Tag = enum {
                cooked,
                raw,
            };

            pub fn isUTF8(contents: Contents) bool {
                return contents == .cooked and contents.cooked.isUTF8();
            }
        };

        /// "`a${'b'}c`" => "`abc`"
        pub fn fold(
            this: *Template,
            allocator: std.mem.Allocator,
            loc: logger.Loc,
        ) Expr {
            if (this.tag != null or (this.head == .cooked and !this.head.cooked.isUTF8())) {
                // we only fold utf-8/ascii for now
                return Expr{
                    .data = .{ .e_template = this },
                    .loc = loc,
                };
            }

            bun.assert(this.head == .cooked);

            if (this.parts.len == 0) {
                return Expr.init(E.String, this.head.cooked, loc);
            }

            var parts = std.ArrayList(TemplatePart).initCapacity(allocator, this.parts.len) catch unreachable;
            var head = Expr.init(E.String, this.head.cooked, loc);
            for (this.parts) |part_src| {
                var part = part_src;
                bun.assert(part.tail == .cooked);

                part.value = part.value.unwrapInlined();

                switch (part.value.data) {
                    .e_number => {
                        if (part.value.data.e_number.toString(allocator)) |s| {
                            part.value = Expr.init(E.String, E.String.init(s), part.value.loc);
                        }
                    },
                    .e_null => {
                        part.value = Expr.init(E.String, E.String.init("null"), part.value.loc);
                    },
                    .e_boolean => {
                        part.value = Expr.init(E.String, E.String.init(if (part.value.data.e_boolean.value)
                            "true"
                        else
                            "false"), part.value.loc);
                    },
                    .e_undefined => {
                        part.value = Expr.init(E.String, E.String.init("undefined"), part.value.loc);
                    },
                    .e_big_int => |value| {
                        part.value = Expr.init(E.String, E.String.init(value.value), part.value.loc);
                    },
                    else => {},
                }

                if (part.value.data == .e_string and part.tail.cooked.isUTF8() and part.value.data.e_string.isUTF8()) {
                    if (parts.items.len == 0) {
                        if (part.value.data.e_string.len() > 0) {
                            head.data.e_string.push(Expr.init(E.String, part.value.data.e_string.*, logger.Loc.Empty).data.e_string);
                        }

                        if (part.tail.cooked.len() > 0) {
                            head.data.e_string.push(Expr.init(E.String, part.tail.cooked, part.tail_loc).data.e_string);
                        }

                        continue;
                    } else {
                        var prev_part = &parts.items[parts.items.len - 1];
                        bun.assert(prev_part.tail == .cooked);

                        if (prev_part.tail.cooked.isUTF8()) {
                            if (part.value.data.e_string.len() > 0) {
                                prev_part.tail.cooked.push(Expr.init(E.String, part.value.data.e_string.*, logger.Loc.Empty).data.e_string);
                            }

                            if (part.tail.cooked.len() > 0) {
                                prev_part.tail.cooked.push(Expr.init(E.String, part.tail.cooked, part.tail_loc).data.e_string);
                            }
                        } else {
                            parts.appendAssumeCapacity(part);
                        }
                    }
                } else {
                    parts.appendAssumeCapacity(part);
                }
            }

            if (parts.items.len == 0) {
                parts.deinit();
                head.data.e_string.resolveRopeIfNeeded(allocator);
                return head;
            }

            return Expr.init(E.Template, .{
                .tag = null,
                .parts = parts.items,
                .head = .{ .cooked = head.data.e_string.* },
            }, loc);
        }
    };

    pub const RegExp = struct {
        value: string,

        // This exists for JavaScript bindings
        // The RegExp constructor expects flags as a second argument.
        // We want to avoid re-lexing the flags, so we store them here.
        // This is the index of the first character in a flag, not the "/"
        // /foo/gim
        //      ^
        flags_offset: ?u16 = null,

        pub var empty = RegExp{ .value = "" };

        pub fn pattern(this: RegExp) string {

            // rewind until we reach the /foo/gim
            //                               ^
            // should only ever be a single character
            // but we're being cautious
            if (this.flags_offset) |i_| {
                var i = i_;
                while (i > 0 and this.value[i] != '/') {
                    i -= 1;
                }

                return std.mem.trim(u8, this.value[0..i], "/");
            }

            return std.mem.trim(u8, this.value, "/");
        }

        pub fn flags(this: RegExp) string {
            // rewind until we reach the /foo/gim
            //                               ^
            // should only ever be a single character
            // but we're being cautious
            if (this.flags_offset) |i| {
                return this.value[i..];
            }

            return "";
        }

        pub fn jsonStringify(self: *const RegExp, writer: anytype) !void {
            return try writer.write(self.value);
        }
    };

    pub const Class = G.Class;

    pub const Await = struct {
        value: ExprNodeIndex,
    };

    pub const Yield = struct {
        value: ?ExprNodeIndex = null,
        is_star: bool = false,
    };

    pub const If = struct {
        test_: ExprNodeIndex,
        yes: ExprNodeIndex,
        no: ExprNodeIndex,
    };

    pub const RequireString = struct {
        import_record_index: u32 = 0,

        unwrapped_id: u32 = std.math.maxInt(u32),
    };

    pub const RequireResolveString = struct {
        import_record_index: u32 = 0,

        // close_paren_loc: logger.Loc = logger.Loc.Empty,
    };

    pub const InlinedEnum = struct {
        value: ExprNodeIndex,
        comment: string,
    };

    pub const Import = struct {
        expr: ExprNodeIndex,
        options: ExprNodeIndex = Expr.empty,
        import_record_index: u32,

        /// TODO:
        /// Comments inside "import()" expressions have special meaning for Webpack.
        /// Preserving comments inside these expressions makes it possible to use
        /// esbuild as a TypeScript-to-JavaScript frontend for Webpack to improve
        /// performance. We intentionally do not interpret these comments in esbuild
        /// because esbuild is not Webpack. But we do preserve them since doing so is
        /// harmless, easy to maintain, and useful to people. See the Webpack docs for
        /// more info: https://webpack.js.org/api/module-methods/#magic-comments.
        // leading_interior_comments: []G.Comment = &([_]G.Comment{}),

        pub fn isImportRecordNull(this: *const Import) bool {
            return this.import_record_index == std.math.maxInt(u32);
        }

        pub fn importRecordTag(import: *const Import) ?ImportRecord.Tag {
            const obj = import.options.data.as(.e_object) orelse
                return null;
            const with = obj.get("with") orelse obj.get("assert") orelse
                return null;
            const with_obj = with.data.as(.e_object) orelse
                return null;
            const str = (with_obj.get("type") orelse
                return null).data.as(.e_string) orelse
                return null;

            if (str.eqlComptime("json")) {
                return .with_type_json;
            } else if (str.eqlComptime("toml")) {
                return .with_type_toml;
            } else if (str.eqlComptime("text")) {
                return .with_type_text;
            } else if (str.eqlComptime("file")) {
                return .with_type_file;
            } else if (str.eqlComptime("sqlite")) {
                const embed = brk: {
                    const embed = with_obj.get("embed") orelse break :brk false;
                    const embed_str = embed.data.as(.e_string) orelse break :brk false;
                    break :brk embed_str.eqlComptime("true");
                };

                return if (embed) .with_type_sqlite_embedded else .with_type_sqlite;
            }

            return null;
        }
    };
};

pub const Stmt = struct {
    loc: logger.Loc,
    data: Data,

    pub const Batcher = bun.Batcher(Stmt);

    pub fn assign(a: Expr, b: Expr) Stmt {
        return Stmt.alloc(
            S.SExpr,
            S.SExpr{
                .value = Expr.assign(a, b),
            },
            a.loc,
        );
    }

    const Serializable = struct {
        type: Tag,
        object: string,
        value: Data,
        loc: logger.Loc,
    };

    pub fn jsonStringify(self: *const Stmt, writer: anytype) !void {
        return try writer.write(Serializable{ .type = std.meta.activeTag(self.data), .object = "stmt", .value = self.data, .loc = self.loc });
    }

    pub fn isTypeScript(self: *Stmt) bool {
        return @as(Stmt.Tag, self.data) == .s_type_script;
    }

    pub fn isSuperCall(self: Stmt) bool {
        return self.data == .s_expr and self.data.s_expr.value.data == .e_call and self.data.s_expr.value.data.e_call.target.data == .e_super;
    }

    pub fn isMissingExpr(self: Stmt) bool {
        return self.data == .s_expr and self.data.s_expr.value.data == .e_missing;
    }

    pub fn empty() Stmt {
        return Stmt{ .data = .{ .s_empty = None }, .loc = logger.Loc{} };
    }

    pub fn toEmpty(this: Stmt) Stmt {
        return .{
            .data = .{
                .s_empty = None,
            },
            .loc = this.loc,
        };
    }

    const None = S.Empty{};

    pub var icount: usize = 0;
    pub fn init(comptime StatementType: type, origData: *StatementType, loc: logger.Loc) Stmt {
        icount += 1;

        return switch (comptime StatementType) {
            S.Empty => Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } },
            S.Block => Stmt.comptime_init("s_block", S.Block, origData, loc),
            S.Break => Stmt.comptime_init("s_break", S.Break, origData, loc),
            S.Class => Stmt.comptime_init("s_class", S.Class, origData, loc),
            S.Comment => Stmt.comptime_init("s_comment", S.Comment, origData, loc),
            S.Continue => Stmt.comptime_init("s_continue", S.Continue, origData, loc),
            S.Debugger => Stmt.comptime_init("s_debugger", S.Debugger, origData, loc),
            S.Directive => Stmt.comptime_init("s_directive", S.Directive, origData, loc),
            S.DoWhile => Stmt.comptime_init("s_do_while", S.DoWhile, origData, loc),
            S.Enum => Stmt.comptime_init("s_enum", S.Enum, origData, loc),
            S.ExportClause => Stmt.comptime_init("s_export_clause", S.ExportClause, origData, loc),
            S.ExportDefault => Stmt.comptime_init("s_export_default", S.ExportDefault, origData, loc),
            S.ExportEquals => Stmt.comptime_init("s_export_equals", S.ExportEquals, origData, loc),
            S.ExportFrom => Stmt.comptime_init("s_export_from", S.ExportFrom, origData, loc),
            S.ExportStar => Stmt.comptime_init("s_export_star", S.ExportStar, origData, loc),
            S.SExpr => Stmt.comptime_init("s_expr", S.SExpr, origData, loc),
            S.ForIn => Stmt.comptime_init("s_for_in", S.ForIn, origData, loc),
            S.ForOf => Stmt.comptime_init("s_for_of", S.ForOf, origData, loc),
            S.For => Stmt.comptime_init("s_for", S.For, origData, loc),
            S.Function => Stmt.comptime_init("s_function", S.Function, origData, loc),
            S.If => Stmt.comptime_init("s_if", S.If, origData, loc),
            S.Import => Stmt.comptime_init("s_import", S.Import, origData, loc),
            S.Label => Stmt.comptime_init("s_label", S.Label, origData, loc),
            S.Local => Stmt.comptime_init("s_local", S.Local, origData, loc),
            S.Namespace => Stmt.comptime_init("s_namespace", S.Namespace, origData, loc),
            S.Return => Stmt.comptime_init("s_return", S.Return, origData, loc),
            S.Switch => Stmt.comptime_init("s_switch", S.Switch, origData, loc),
            S.Throw => Stmt.comptime_init("s_throw", S.Throw, origData, loc),
            S.Try => Stmt.comptime_init("s_try", S.Try, origData, loc),
            S.TypeScript => Stmt.comptime_init("s_type_script", S.TypeScript, origData, loc),
            S.While => Stmt.comptime_init("s_while", S.While, origData, loc),
            S.With => Stmt.comptime_init("s_with", S.With, origData, loc),
            else => @compileError("Invalid type in Stmt.init"),
        };
    }
    inline fn comptime_alloc(comptime tag_name: string, comptime typename: type, origData: anytype, loc: logger.Loc) Stmt {
        return Stmt{
            .loc = loc,
            .data = @unionInit(
                Data,
                tag_name,
                Data.Store.append(
                    typename,
                    origData,
                ),
            ),
        };
    }

    fn allocateData(allocator: std.mem.Allocator, comptime tag_name: string, comptime typename: type, origData: anytype, loc: logger.Loc) Stmt {
        const value = allocator.create(@TypeOf(origData)) catch unreachable;
        value.* = origData;

        return comptime_init(tag_name, *typename, value, loc);
    }

    inline fn comptime_init(comptime tag_name: string, comptime TypeName: type, origData: TypeName, loc: logger.Loc) Stmt {
        return Stmt{ .loc = loc, .data = @unionInit(Data, tag_name, origData) };
    }

    pub fn alloc(comptime StatementData: type, origData: StatementData, loc: logger.Loc) Stmt {
        Stmt.Data.Store.assert();

        icount += 1;
        return switch (StatementData) {
            S.Block => Stmt.comptime_alloc("s_block", S.Block, origData, loc),
            S.Break => Stmt.comptime_alloc("s_break", S.Break, origData, loc),
            S.Class => Stmt.comptime_alloc("s_class", S.Class, origData, loc),
            S.Comment => Stmt.comptime_alloc("s_comment", S.Comment, origData, loc),
            S.Continue => Stmt.comptime_alloc("s_continue", S.Continue, origData, loc),
            S.Debugger => Stmt{ .loc = loc, .data = .{ .s_debugger = origData } },
            S.Directive => Stmt.comptime_alloc("s_directive", S.Directive, origData, loc),
            S.DoWhile => Stmt.comptime_alloc("s_do_while", S.DoWhile, origData, loc),
            S.Empty => Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } },
            S.Enum => Stmt.comptime_alloc("s_enum", S.Enum, origData, loc),
            S.ExportClause => Stmt.comptime_alloc("s_export_clause", S.ExportClause, origData, loc),
            S.ExportDefault => Stmt.comptime_alloc("s_export_default", S.ExportDefault, origData, loc),
            S.ExportEquals => Stmt.comptime_alloc("s_export_equals", S.ExportEquals, origData, loc),
            S.ExportFrom => Stmt.comptime_alloc("s_export_from", S.ExportFrom, origData, loc),
            S.ExportStar => Stmt.comptime_alloc("s_export_star", S.ExportStar, origData, loc),
            S.SExpr => Stmt.comptime_alloc("s_expr", S.SExpr, origData, loc),
            S.ForIn => Stmt.comptime_alloc("s_for_in", S.ForIn, origData, loc),
            S.ForOf => Stmt.comptime_alloc("s_for_of", S.ForOf, origData, loc),
            S.For => Stmt.comptime_alloc("s_for", S.For, origData, loc),
            S.Function => Stmt.comptime_alloc("s_function", S.Function, origData, loc),
            S.If => Stmt.comptime_alloc("s_if", S.If, origData, loc),
            S.Import => Stmt.comptime_alloc("s_import", S.Import, origData, loc),
            S.Label => Stmt.comptime_alloc("s_label", S.Label, origData, loc),
            S.Local => Stmt.comptime_alloc("s_local", S.Local, origData, loc),
            S.Namespace => Stmt.comptime_alloc("s_namespace", S.Namespace, origData, loc),
            S.Return => Stmt.comptime_alloc("s_return", S.Return, origData, loc),
            S.Switch => Stmt.comptime_alloc("s_switch", S.Switch, origData, loc),
            S.Throw => Stmt.comptime_alloc("s_throw", S.Throw, origData, loc),
            S.Try => Stmt.comptime_alloc("s_try", S.Try, origData, loc),
            S.TypeScript => Stmt{ .loc = loc, .data = Data{ .s_type_script = S.TypeScript{} } },
            S.While => Stmt.comptime_alloc("s_while", S.While, origData, loc),
            S.With => Stmt.comptime_alloc("s_with", S.With, origData, loc),
            else => @compileError("Invalid type in Stmt.init"),
        };
    }

    pub const Disabler = bun.DebugOnlyDisabler(@This());

    /// When the lifetime of an Stmt.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an allocator that does it for you)
    /// Also, prefer Stmt.init or Stmt.alloc when possible. This will be slower.
    pub fn allocate(allocator: std.mem.Allocator, comptime StatementData: type, origData: StatementData, loc: logger.Loc) Stmt {
        Stmt.Data.Store.assert();

        icount += 1;
        return switch (StatementData) {
            S.Block => Stmt.allocateData(allocator, "s_block", S.Block, origData, loc),
            S.Break => Stmt.allocateData(allocator, "s_break", S.Break, origData, loc),
            S.Class => Stmt.allocateData(allocator, "s_class", S.Class, origData, loc),
            S.Comment => Stmt.allocateData(allocator, "s_comment", S.Comment, origData, loc),
            S.Continue => Stmt.allocateData(allocator, "s_continue", S.Continue, origData, loc),
            S.Debugger => Stmt{ .loc = loc, .data = .{ .s_debugger = origData } },
            S.Directive => Stmt.allocateData(allocator, "s_directive", S.Directive, origData, loc),
            S.DoWhile => Stmt.allocateData(allocator, "s_do_while", S.DoWhile, origData, loc),
            S.Empty => Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } },
            S.Enum => Stmt.allocateData(allocator, "s_enum", S.Enum, origData, loc),
            S.ExportClause => Stmt.allocateData(allocator, "s_export_clause", S.ExportClause, origData, loc),
            S.ExportDefault => Stmt.allocateData(allocator, "s_export_default", S.ExportDefault, origData, loc),
            S.ExportEquals => Stmt.allocateData(allocator, "s_export_equals", S.ExportEquals, origData, loc),
            S.ExportFrom => Stmt.allocateData(allocator, "s_export_from", S.ExportFrom, origData, loc),
            S.ExportStar => Stmt.allocateData(allocator, "s_export_star", S.ExportStar, origData, loc),
            S.SExpr => Stmt.allocateData(allocator, "s_expr", S.SExpr, origData, loc),
            S.ForIn => Stmt.allocateData(allocator, "s_for_in", S.ForIn, origData, loc),
            S.ForOf => Stmt.allocateData(allocator, "s_for_of", S.ForOf, origData, loc),
            S.For => Stmt.allocateData(allocator, "s_for", S.For, origData, loc),
            S.Function => Stmt.allocateData(allocator, "s_function", S.Function, origData, loc),
            S.If => Stmt.allocateData(allocator, "s_if", S.If, origData, loc),
            S.Import => Stmt.allocateData(allocator, "s_import", S.Import, origData, loc),
            S.Label => Stmt.allocateData(allocator, "s_label", S.Label, origData, loc),
            S.Local => Stmt.allocateData(allocator, "s_local", S.Local, origData, loc),
            S.Namespace => Stmt.allocateData(allocator, "s_namespace", S.Namespace, origData, loc),
            S.Return => Stmt.allocateData(allocator, "s_return", S.Return, origData, loc),
            S.Switch => Stmt.allocateData(allocator, "s_switch", S.Switch, origData, loc),
            S.Throw => Stmt.allocateData(allocator, "s_throw", S.Throw, origData, loc),
            S.Try => Stmt.allocateData(allocator, "s_try", S.Try, origData, loc),
            S.TypeScript => Stmt{ .loc = loc, .data = Data{ .s_type_script = S.TypeScript{} } },
            S.While => Stmt.allocateData(allocator, "s_while", S.While, origData, loc),
            S.With => Stmt.allocateData(allocator, "s_with", S.With, origData, loc),
            else => @compileError("Invalid type in Stmt.init"),
        };
    }

    pub fn allocateExpr(allocator: std.mem.Allocator, expr: Expr) Stmt {
        return Stmt.allocate(allocator, S.SExpr, S.SExpr{ .value = expr }, expr.loc);
    }

    pub const Tag = enum {
        s_block,
        s_break,
        s_class,
        s_comment,
        s_continue,
        s_directive,
        s_do_while,
        s_enum,
        s_export_clause,
        s_export_default,
        s_export_equals,
        s_export_from,
        s_export_star,
        s_expr,
        s_for_in,
        s_for_of,
        s_for,
        s_function,
        s_if,
        s_import,
        s_label,
        s_local,
        s_namespace,
        s_return,
        s_switch,
        s_throw,
        s_try,
        s_while,
        s_with,
        s_type_script,
        s_empty,
        s_debugger,
        s_lazy_export,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }

        pub fn isExportLike(tag: Tag) bool {
            return switch (tag) {
                .s_export_clause, .s_export_default, .s_export_equals, .s_export_from, .s_export_star, .s_empty => true,
                else => false,
            };
        }
    };

    pub const Data = union(Tag) {
        s_block: *S.Block,
        s_break: *S.Break,
        s_class: *S.Class,
        s_comment: *S.Comment,
        s_continue: *S.Continue,
        s_directive: *S.Directive,
        s_do_while: *S.DoWhile,
        s_enum: *S.Enum,
        s_export_clause: *S.ExportClause,
        s_export_default: *S.ExportDefault,
        s_export_equals: *S.ExportEquals,
        s_export_from: *S.ExportFrom,
        s_export_star: *S.ExportStar,
        s_expr: *S.SExpr,
        s_for_in: *S.ForIn,
        s_for_of: *S.ForOf,
        s_for: *S.For,
        s_function: *S.Function,
        s_if: *S.If,
        s_import: *S.Import,
        s_label: *S.Label,
        s_local: *S.Local,
        s_namespace: *S.Namespace,
        s_return: *S.Return,
        s_switch: *S.Switch,
        s_throw: *S.Throw,
        s_try: *S.Try,
        s_while: *S.While,
        s_with: *S.With,

        s_type_script: S.TypeScript,
        s_empty: S.Empty, // special case, its a zero value type
        s_debugger: S.Debugger,

        s_lazy_export: *Expr.Data,

        comptime {
            if (@sizeOf(Stmt) > 24) {
                @compileLog("Expected Stmt to be <= 24 bytes, but it is", @sizeOf(Stmt), " bytes");
            }
        }

        pub const Store = struct {
            const StoreType = NewStore(&.{
                S.Block,
                S.Break,
                S.Class,
                S.Comment,
                S.Continue,
                S.Directive,
                S.DoWhile,
                S.Enum,
                S.ExportClause,
                S.ExportDefault,
                S.ExportEquals,
                S.ExportFrom,
                S.ExportStar,
                S.SExpr,
                S.ForIn,
                S.ForOf,
                S.For,
                S.Function,
                S.If,
                S.Import,
                S.Label,
                S.Local,
                S.Namespace,
                S.Return,
                S.Switch,
                S.Throw,
                S.Try,
                S.While,
                S.With,
            }, 128);

            pub threadlocal var instance: ?*StoreType = null;
            pub threadlocal var memory_allocator: ?*ASTMemoryAllocator = null;
            pub threadlocal var disable_reset = false;

            pub fn create() void {
                if (instance != null or memory_allocator != null) {
                    return;
                }

                instance = StoreType.init();
            }

            pub fn reset() void {
                if (disable_reset or memory_allocator != null) return;
                instance.?.reset();
            }

            pub fn deinit() void {
                if (instance == null or memory_allocator != null) return;
                instance.?.deinit();
                instance = null;
            }

            pub inline fn assert() void {
                if (comptime Environment.allow_assert) {
                    if (instance == null and memory_allocator == null)
                        bun.unreachablePanic("Store must be init'd", .{});
                }
            }

            pub fn append(comptime T: type, value: T) *T {
                if (memory_allocator) |allocator| {
                    return allocator.append(T, value);
                }

                Disabler.assert();
                return instance.?.append(T, value);
            }
        };
    };

    pub fn StoredData(tag: Tag) type {
        const T = std.meta.FieldType(Data, tag);
        return switch (@typeInfo(T)) {
            .Pointer => |ptr| ptr.child,
            else => T,
        };
    }

    pub fn caresAboutScope(self: *Stmt) bool {
        return switch (self.data) {
            .s_block, .s_empty, .s_debugger, .s_expr, .s_if, .s_for, .s_for_in, .s_for_of, .s_do_while, .s_while, .s_with, .s_try, .s_switch, .s_return, .s_throw, .s_break, .s_continue, .s_directive => {
                return false;
            },

            .s_local => |local| {
                return local.kind != .k_var;
            },
            else => {
                return true;
            },
        };
    }
};

pub const Expr = struct {
    loc: logger.Loc,
    data: Data,

    pub const empty = Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = logger.Loc.Empty };

    pub fn isAnonymousNamed(expr: Expr) bool {
        return switch (expr.data) {
            .e_arrow => true,
            .e_function => |func| func.func.name == null,
            .e_class => |class| class.class_name == null,
            else => false,
        };
    }

    pub fn clone(this: Expr, allocator: std.mem.Allocator) !Expr {
        return .{
            .loc = this.loc,
            .data = try this.data.clone(allocator),
        };
    }

    pub fn deepClone(this: Expr, allocator: std.mem.Allocator) anyerror!Expr {
        return .{
            .loc = this.loc,
            .data = try this.data.deepClone(allocator),
        };
    }

    pub fn wrapInArrow(this: Expr, allocator: std.mem.Allocator) !Expr {
        var stmts = try allocator.alloc(Stmt, 1);
        stmts[0] = Stmt.alloc(S.Return, S.Return{ .value = this }, this.loc);

        return Expr.init(E.Arrow, E.Arrow{
            .args = &.{},
            .body = .{
                .loc = this.loc,
                .stmts = stmts,
            },
        }, this.loc);
    }

    pub fn canBeInlinedFromPropertyAccess(this: Expr) bool {
        return switch (this.data) {
            // if the array has a spread we must keep it
            // https://github.com/oven-sh/bun/issues/2594
            .e_spread => false,

            .e_missing => false,
            else => true,
        };
    }

    pub fn canBeConstValue(this: Expr) bool {
        return this.data.canBeConstValue();
    }

    pub fn canBeMoved(expr: Expr) bool {
        return expr.data.canBeMoved();
    }

    pub fn unwrapInlined(expr: Expr) Expr {
        if (expr.data.as(.e_inlined_enum)) |inlined| return inlined.value;
        return expr;
    }

    pub fn fromBlob(
        blob: *const JSC.WebCore.Blob,
        allocator: std.mem.Allocator,
        mime_type_: ?MimeType,
        log: *logger.Log,
        loc: logger.Loc,
    ) !Expr {
        const bytes = blob.sharedView();

        const mime_type = mime_type_ orelse MimeType.init(blob.content_type, null, null);

        if (mime_type.category == .json) {
            var source = logger.Source.initPathString("fetch.json", bytes);
            var out_expr = JSONParser.parseForMacro(&source, log, allocator) catch {
                return error.MacroFailed;
            };
            out_expr.loc = loc;

            switch (out_expr.data) {
                .e_object => {
                    out_expr.data.e_object.was_originally_macro = true;
                },
                .e_array => {
                    out_expr.data.e_array.was_originally_macro = true;
                },
                else => {},
            }

            return out_expr;
        }

        if (mime_type.category.isTextLike()) {
            var output = MutableString.initEmpty(allocator);
            output = try JSPrinter.quoteForJSON(bytes, output, true);
            var list = output.toOwnedSlice();
            // remove the quotes
            if (list.len > 0) {
                list = list[1 .. list.len - 1];
            }
            return Expr.init(E.String, E.String.init(list), loc);
        }

        return Expr.init(
            E.String,
            E.String{
                .data = try JSC.ZigString.init(bytes).toBase64DataURL(allocator),
            },
            loc,
        );
    }

    pub inline fn initIdentifier(ref: Ref, loc: logger.Loc) Expr {
        return Expr{
            .loc = loc,
            .data = .{
                .e_identifier = E.Identifier.init(ref),
            },
        };
    }

    pub fn toEmpty(expr: Expr) Expr {
        return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = expr.loc };
    }
    pub fn isEmpty(expr: Expr) bool {
        return expr.data == .e_missing;
    }
    pub const Query = struct { expr: Expr, loc: logger.Loc, i: u32 = 0 };

    pub fn hasAnyPropertyNamed(expr: *const Expr, comptime names: []const string) bool {
        if (std.meta.activeTag(expr.data) != .e_object) return false;
        const obj = expr.data.e_object;
        if (@intFromPtr(obj.properties.ptr) == 0) return false;

        for (obj.properties.slice()) |prop| {
            if (prop.value == null) continue;
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            const key_str = key.data.e_string;
            if (strings.eqlAnyComptime(key_str.data, names)) return true;
        }

        return false;
    }

    pub fn toJS(this: Expr, allocator: std.mem.Allocator, globalObject: *JSC.JSGlobalObject) ToJSError!JSC.JSValue {
        return this.data.toJS(allocator, globalObject);
    }

    pub inline fn isArray(this: *const Expr) bool {
        return this.data == .e_array;
    }

    pub inline fn isObject(this: *const Expr) bool {
        return this.data == .e_object;
    }

    pub fn get(expr: *const Expr, name: string) ?Expr {
        return if (asProperty(expr, name)) |query| query.expr else null;
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property, creating it if it doesn't exist.
    /// `expr` must be an object.
    pub fn set(expr: *Expr, allocator: std.mem.Allocator, name: string, value: Expr) OOM!void {
        bun.assertWithLocation(expr.isObject(), @src());
        for (0..expr.data.e_object.properties.len) |i| {
            const prop = &expr.data.e_object.properties.ptr[i];
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            if (key.data.e_string.eql(string, name)) {
                prop.value = value;
                return;
            }
        }

        var new_props = expr.data.e_object.properties.listManaged(allocator);
        try new_props.append(.{
            .key = Expr.init(E.String, .{ .data = name }, logger.Loc.Empty),
            .value = value,
        });

        expr.data.e_object.properties = BabyList(G.Property).fromList(new_props);
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property to a string, creating it if it doesn't exist.
    /// `expr` must be an object.
    pub fn setString(expr: *Expr, allocator: std.mem.Allocator, name: string, value: string) OOM!void {
        bun.assertWithLocation(expr.isObject(), @src());
        for (0..expr.data.e_object.properties.len) |i| {
            const prop = &expr.data.e_object.properties.ptr[i];
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            if (key.data.e_string.eql(string, name)) {
                prop.value = Expr.init(E.String, .{ .data = value }, logger.Loc.Empty);
                return;
            }
        }

        var new_props = expr.data.e_object.properties.listManaged(allocator);
        try new_props.append(.{
            .key = Expr.init(E.String, .{ .data = name }, logger.Loc.Empty),
            .value = Expr.init(E.String, .{ .data = value }, logger.Loc.Empty),
        });

        expr.data.e_object.properties = BabyList(G.Property).fromList(new_props);
    }

    pub fn getObject(expr: *const Expr, name: string) ?Expr {
        if (expr.asProperty(name)) |query| {
            if (query.expr.isObject()) {
                return query.expr;
            }
        }
        return null;
    }

    pub fn getString(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?struct { string, logger.Loc } {
        if (asProperty(expr, name)) |q| {
            if (q.expr.asString(allocator)) |str| {
                return .{
                    str,
                    q.expr.loc,
                };
            }
        }
        return null;
    }

    pub fn getNumber(expr: *const Expr, name: string) ?struct { f64, logger.Loc } {
        if (asProperty(expr, name)) |q| {
            if (q.expr.asNumber()) |num| {
                return .{
                    num,
                    q.expr.loc,
                };
            }
        }
        return null;
    }

    pub fn getStringCloned(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?string {
        return if (asProperty(expr, name)) |q| q.expr.asStringCloned(allocator) else null;
    }

    pub fn getStringClonedZ(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?stringZ {
        return if (asProperty(expr, name)) |q| q.expr.asStringZ(allocator) else null;
    }

    pub fn getArray(expr: *const Expr, name: string) ?ArrayIterator {
        return if (asProperty(expr, name)) |q| q.expr.asArray() else null;
    }

    pub fn getRope(self: *const Expr, rope: *const E.Object.Rope) ?E.Object.RopeQuery {
        if (self.get(rope.head.data.e_string.data)) |existing| {
            switch (existing.data) {
                .e_array => |array| {
                    if (rope.next) |next| {
                        if (array.items.last()) |end| {
                            return end.getRope(next);
                        }
                    }

                    return E.Object.RopeQuery{
                        .expr = existing,
                        .rope = rope,
                    };
                },
                .e_object => {
                    if (rope.next) |next| {
                        if (existing.getRope(next)) |end| {
                            return end;
                        }
                    }

                    return E.Object.RopeQuery{
                        .expr = existing,
                        .rope = rope,
                    };
                },
                else => return E.Object.RopeQuery{
                    .expr = existing,
                    .rope = rope,
                },
            }
        }

        return null;
    }

    // Making this comptime bloats the binary and doesn't seem to impact runtime performance.
    pub fn asProperty(expr: *const Expr, name: string) ?Query {
        if (std.meta.activeTag(expr.data) != .e_object) return null;
        const obj = expr.data.e_object;
        if (@intFromPtr(obj.properties.ptr) == 0) return null;

        return obj.asProperty(name);
    }

    pub fn asPropertyStringMap(expr: *const Expr, name: string, allocator: std.mem.Allocator) ?*bun.StringArrayHashMap(string) {
        if (std.meta.activeTag(expr.data) != .e_object) return null;
        const obj_ = expr.data.e_object;
        if (@intFromPtr(obj_.properties.ptr) == 0) return null;
        const query = obj_.asProperty(name) orelse return null;
        if (query.expr.data != .e_object) return null;

        const obj = query.expr.data.e_object;
        var count: usize = 0;
        for (obj.properties.slice()) |prop| {
            const key = prop.key.?.asString(allocator) orelse continue;
            const value = prop.value.?.asString(allocator) orelse continue;
            count += @as(usize, @intFromBool(key.len > 0 and value.len > 0));
        }

        if (count == 0) return null;
        var map = bun.StringArrayHashMap(string).init(allocator);
        map.ensureUnusedCapacity(count) catch return null;

        for (obj.properties.slice()) |prop| {
            const key = prop.key.?.asString(allocator) orelse continue;
            const value = prop.value.?.asString(allocator) orelse continue;

            if (!(key.len > 0 and value.len > 0)) continue;

            map.putAssumeCapacity(key, value);
        }

        const ptr = allocator.create(bun.StringArrayHashMap(string)) catch unreachable;
        ptr.* = map;
        return ptr;
    }

    pub const ArrayIterator = struct {
        array: *const E.Array,
        index: u32,

        pub fn next(this: *ArrayIterator) ?Expr {
            if (this.index >= this.array.items.len) {
                return null;
            }
            defer this.index += 1;
            return this.array.items.ptr[this.index];
        }
    };

    pub fn asArray(expr: *const Expr) ?ArrayIterator {
        if (std.meta.activeTag(expr.data) != .e_array) return null;
        const array = expr.data.e_array;
        if (array.items.len == 0 or @intFromPtr(array.items.ptr) == 0) return null;

        return ArrayIterator{ .array = array, .index = 0 };
    }

    pub inline fn asUtf8StringLiteral(expr: *const Expr) ?string {
        if (expr.data == .e_string) {
            bun.debugAssert(expr.data.e_string.next == null);
            return expr.data.e_string.data;
        }
        return null;
    }

    pub inline fn asStringLiteral(expr: *const Expr, allocator: std.mem.Allocator) ?string {
        if (std.meta.activeTag(expr.data) != .e_string) return null;
        return expr.data.e_string.string(allocator) catch null;
    }

    pub inline fn isString(expr: *const Expr) bool {
        return switch (expr.data) {
            .e_string => true,
            else => false,
        };
    }

    pub inline fn asString(expr: *const Expr, allocator: std.mem.Allocator) ?string {
        switch (expr.data) {
            .e_string => |str| return str.string(allocator) catch bun.outOfMemory(),
            else => return null,
        }
    }
    pub inline fn asStringHash(expr: *const Expr, allocator: std.mem.Allocator, comptime hash_fn: *const fn (buf: []const u8) callconv(.Inline) u64) OOM!?u64 {
        switch (expr.data) {
            .e_string => |str| {
                if (str.isUTF8()) return hash_fn(str.data);
                const utf8_str = try str.string(allocator);
                defer allocator.free(utf8_str);
                return hash_fn(utf8_str);
            },
            else => return null,
        }
    }

    pub inline fn asStringCloned(expr: *const Expr, allocator: std.mem.Allocator) OOM!?string {
        switch (expr.data) {
            .e_string => |str| return try str.stringCloned(allocator),
            else => return null,
        }
    }

    pub inline fn asStringZ(expr: *const Expr, allocator: std.mem.Allocator) OOM!?stringZ {
        switch (expr.data) {
            .e_string => |str| return try str.stringZ(allocator),
            else => return null,
        }
    }

    pub fn asBool(
        expr: *const Expr,
    ) ?bool {
        if (std.meta.activeTag(expr.data) != .e_boolean) return null;

        return expr.data.e_boolean.value;
    }

    pub fn asNumber(expr: *const Expr) ?f64 {
        if (expr.data != .e_number) return null;

        return expr.data.e_number.value;
    }

    pub const EFlags = enum { none, ts_decorator };

    const Serializable = struct {
        type: Tag,
        object: string,
        value: Data,
        loc: logger.Loc,
    };

    pub fn isMissing(a: *const Expr) bool {
        return std.meta.activeTag(a.data) == Expr.Tag.e_missing;
    }

    // The goal of this function is to "rotate" the AST if it's possible to use the
    // left-associative property of the operator to avoid unnecessary parentheses.
    //
    // When using this, make absolutely sure that the operator is actually
    // associative. For example, the "-" operator is not associative for
    // floating-point numbers.
    pub fn joinWithLeftAssociativeOp(
        comptime op: Op.Code,
        a: Expr,
        b: Expr,
        allocator: std.mem.Allocator,
    ) Expr {
        // "(a, b) op c" => "a, b op c"
        switch (a.data) {
            .e_binary => |comma| {
                if (comma.op == .bin_comma) {
                    comma.right = joinWithLeftAssociativeOp(op, comma.right, b, allocator);
                }
            },
            else => {},
        }

        // "a op (b op c)" => "(a op b) op c"
        // "a op (b op (c op d))" => "((a op b) op c) op d"
        switch (b.data) {
            .e_binary => |binary| {
                if (binary.op == op) {
                    return joinWithLeftAssociativeOp(
                        op,
                        joinWithLeftAssociativeOp(op, a, binary.left, allocator),
                        binary.right,
                        allocator,
                    );
                }
            },
            else => {},
        }

        // "a op b" => "a op b"
        // "(a op b) op c" => "(a op b) op c"
        return Expr.init(E.Binary, E.Binary{ .op = op, .left = a, .right = b }, a.loc);
    }

    pub fn joinWithComma(a: Expr, b: Expr, _: std.mem.Allocator) Expr {
        if (a.isMissing()) {
            return b;
        }

        if (b.isMissing()) {
            return a;
        }

        return Expr.init(E.Binary, E.Binary{ .op = .bin_comma, .left = a, .right = b }, a.loc);
    }

    pub fn joinAllWithComma(all: []Expr, allocator: std.mem.Allocator) Expr {
        bun.assert(all.len > 0);
        switch (all.len) {
            1 => {
                return all[0];
            },
            2 => {
                return Expr.joinWithComma(all[0], all[1], allocator);
            },
            else => {
                var expr = all[0];
                for (1..all.len) |i| {
                    expr = Expr.joinWithComma(expr, all[i], allocator);
                }
                return expr;
            },
        }
    }

    pub fn joinAllWithCommaCallback(all: []Expr, comptime Context: type, ctx: Context, comptime callback: (fn (ctx: anytype, expr: Expr) ?Expr), allocator: std.mem.Allocator) ?Expr {
        switch (all.len) {
            0 => return null,
            1 => {
                return callback(ctx, all[0]);
            },
            2 => {
                return Expr.joinWithComma(
                    callback(ctx, all[0]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[0].loc,
                    },
                    callback(ctx, all[1]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[1].loc,
                    },
                    allocator,
                );
            },
            else => {
                var i: usize = 1;
                var expr = callback(ctx, all[0]) orelse Expr{
                    .data = .{ .e_missing = .{} },
                    .loc = all[0].loc,
                };

                while (i < all.len) : (i += 1) {
                    expr = Expr.joinWithComma(expr, callback(ctx, all[i]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[i].loc,
                    }, allocator);
                }

                return expr;
            },
        }
    }

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(Serializable{ .type = std.meta.activeTag(self.data), .object = "expr", .value = self.data, .loc = self.loc });
    }

    pub fn extractNumericValues(left: Expr.Data, right: Expr.Data) ?[2]f64 {
        return .{
            left.extractNumericValue() orelse return null,
            right.extractNumericValue() orelse return null,
        };
    }

    pub var icount: usize = 0;

    // We don't need to dynamically allocate booleans
    var true_bool = E.Boolean{ .value = true };
    var false_bool = E.Boolean{ .value = false };
    var bool_values = [_]*E.Boolean{ &false_bool, &true_bool };

    /// When the lifetime of an Expr.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an allocator that does it for you)
    /// Also, prefer Expr.init or Expr.alloc when possible. This will be slower.
    pub fn allocate(allocator: std.mem.Allocator, comptime Type: type, st: Type, loc: logger.Loc) Expr {
        icount += 1;
        Data.Store.assert();

        switch (Type) {
            E.Array => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_array = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Class => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_class = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Unary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_unary = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Binary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_binary = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.This => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_this = st,
                    },
                };
            },
            E.Boolean => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_boolean = st,
                    },
                };
            },
            E.Super => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_super = st,
                    },
                };
            },
            E.Null => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_null = st,
                    },
                };
            },
            E.Undefined => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_undefined = st,
                    },
                };
            },
            E.New => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.NewTarget => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new_target = st,
                    },
                };
            },
            E.Function => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_function = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.ImportMeta => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_meta = st,
                    },
                };
            },
            E.Call => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_call = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Dot => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_dot = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Index => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_index = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Arrow => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_arrow = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Identifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_identifier = E.Identifier{
                            .ref = st.ref,
                            .must_keep_due_to_with_stmt = st.must_keep_due_to_with_stmt,
                            .can_be_removed_if_unused = st.can_be_removed_if_unused,
                            .call_can_be_unwrapped_if_unused = st.call_can_be_unwrapped_if_unused,
                        },
                    },
                };
            },
            E.ImportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_identifier = .{
                            .ref = st.ref,
                            .was_originally_identifier = st.was_originally_identifier,
                        },
                    },
                };
            },
            E.CommonJSExportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_commonjs_export_identifier = .{
                            .ref = st.ref,
                        },
                    },
                };
            },

            E.PrivateIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_private_identifier = st,
                    },
                };
            },
            E.JSXElement => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_jsx_element = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Missing => {
                return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
            },
            E.Number => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_number = st,
                    },
                };
            },
            E.BigInt => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_big_int = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Object => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_object = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Spread => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_spread = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.String => {
                if (comptime Environment.isDebug) {
                    // Sanity check: assert string is not a null ptr
                    if (st.data.len > 0 and st.isUTF8()) {
                        bun.assert(@intFromPtr(st.data.ptr) > 0);
                    }
                }
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.TemplatePart => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template_part = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Template => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.RegExp => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_reg_exp = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Await => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_await = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.Yield => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_yield = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.If => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_if = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.RequireResolveString => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_resolve_string = st,
                    },
                };
            },
            E.Import => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st;
                            break :brk item;
                        },
                    },
                };
            },
            E.RequireString => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_string = st,
                    },
                };
            },
            *E.String => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = brk: {
                            const item = allocator.create(Type) catch unreachable;
                            item.* = st.*;
                            break :brk item;
                        },
                    },
                };
            },

            else => {
                @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
            },
        }
    }

    pub const Disabler = bun.DebugOnlyDisabler(@This());

    pub fn init(comptime Type: type, st: Type, loc: logger.Loc) Expr {
        icount += 1;
        Data.Store.assert();

        switch (Type) {
            E.Array => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_array = Data.Store.append(Type, st),
                    },
                };
            },
            E.Class => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_class = Data.Store.append(Type, st),
                    },
                };
            },
            E.Unary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_unary = Data.Store.append(Type, st),
                    },
                };
            },
            E.Binary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_binary = Data.Store.append(Type, st),
                    },
                };
            },
            E.This => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_this = st,
                    },
                };
            },
            E.Boolean => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_boolean = st,
                    },
                };
            },
            E.Super => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_super = st,
                    },
                };
            },
            E.Null => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_null = st,
                    },
                };
            },
            E.Undefined => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_undefined = st,
                    },
                };
            },
            E.New => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new = Data.Store.append(Type, st),
                    },
                };
            },
            E.NewTarget => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new_target = st,
                    },
                };
            },
            E.Function => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_function = Data.Store.append(Type, st),
                    },
                };
            },
            E.ImportMeta => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_meta = st,
                    },
                };
            },
            E.Call => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_call = Data.Store.append(Type, st),
                    },
                };
            },
            E.Dot => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_dot = Data.Store.append(Type, st),
                    },
                };
            },
            E.Index => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_index = Data.Store.append(Type, st),
                    },
                };
            },
            E.Arrow => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_arrow = Data.Store.append(Type, st),
                    },
                };
            },
            E.Identifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_identifier = E.Identifier{
                            .ref = st.ref,
                            .must_keep_due_to_with_stmt = st.must_keep_due_to_with_stmt,
                            .can_be_removed_if_unused = st.can_be_removed_if_unused,
                            .call_can_be_unwrapped_if_unused = st.call_can_be_unwrapped_if_unused,
                        },
                    },
                };
            },
            E.ImportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_identifier = .{
                            .ref = st.ref,
                            .was_originally_identifier = st.was_originally_identifier,
                        },
                    },
                };
            },
            E.CommonJSExportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_commonjs_export_identifier = .{
                            .ref = st.ref,
                            .base = st.base,
                        },
                    },
                };
            },
            E.PrivateIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_private_identifier = st,
                    },
                };
            },
            E.JSXElement => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_jsx_element = Data.Store.append(Type, st),
                    },
                };
            },
            E.Missing => {
                return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
            },
            E.Number => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_number = st,
                    },
                };
            },
            E.BigInt => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_big_int = Data.Store.append(Type, st),
                    },
                };
            },
            E.Object => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_object = Data.Store.append(Type, st),
                    },
                };
            },
            E.Spread => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_spread = Data.Store.append(Type, st),
                    },
                };
            },
            E.String => {
                if (comptime Environment.isDebug) {
                    // Sanity check: assert string is not a null ptr
                    if (st.data.len > 0 and st.isUTF8()) {
                        bun.assert(@intFromPtr(st.data.ptr) > 0);
                    }
                }
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.append(Type, st),
                    },
                };
            },
            E.TemplatePart => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template_part = Data.Store.append(Type, st),
                    },
                };
            },
            E.Template => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template = Data.Store.append(Type, st),
                    },
                };
            },
            E.RegExp => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_reg_exp = Data.Store.append(Type, st),
                    },
                };
            },
            E.Await => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_await = Data.Store.append(Type, st),
                    },
                };
            },
            E.Yield => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_yield = Data.Store.append(Type, st),
                    },
                };
            },
            E.If => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_if = Data.Store.append(Type, st),
                    },
                };
            },
            E.RequireResolveString => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_resolve_string = st,
                    },
                };
            },
            E.Import => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import = Data.Store.append(Type, st),
                    },
                };
            },
            E.RequireString => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_string = st,
                    },
                };
            },
            *E.String => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.append(@TypeOf(st.*), st.*),
                    },
                };
            },
            E.InlinedEnum => return .{ .loc = loc, .data = .{
                .e_inlined_enum = Data.Store.append(@TypeOf(st), st),
            } },

            else => {
                @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
            },
        }
    }

    pub fn isPrimitiveLiteral(this: Expr) bool {
        return @as(Tag, this.data).isPrimitiveLiteral();
    }

    pub fn isRef(this: Expr, ref: Ref) bool {
        return switch (this.data) {
            .e_import_identifier => |import_identifier| import_identifier.ref.eql(ref),
            .e_identifier => |ident| ident.ref.eql(ref),
            else => false,
        };
    }

    pub const Tag = enum {
        e_array,
        e_unary,
        e_binary,
        e_class,
        e_new,
        e_function,
        e_call,
        e_dot,
        e_index,
        e_arrow,
        e_jsx_element,
        e_object,
        e_spread,
        e_template_part,
        e_template,
        e_reg_exp,
        e_await,
        e_yield,
        e_if,
        e_import,
        e_identifier,
        e_import_identifier,
        e_private_identifier,
        e_commonjs_export_identifier,
        e_module_dot_exports,
        e_boolean,
        e_number,
        e_big_int,
        e_string,
        e_require_string,
        e_require_resolve_string,
        e_require_call_target,
        e_require_resolve_call_target,
        e_missing,
        e_this,
        e_super,
        e_null,
        e_undefined,
        e_new_target,
        e_import_meta,
        e_import_meta_main,
        e_require_main,
        e_inlined_enum,

        // object, regex and array may have had side effects
        pub fn isPrimitiveLiteral(tag: Tag) bool {
            return switch (tag) {
                .e_null, .e_undefined, .e_string, .e_boolean, .e_number, .e_big_int => true,
                else => false,
            };
        }

        pub fn typeof(tag: Tag) ?string {
            return switch (tag) {
                .e_array, .e_object, .e_null, .e_reg_exp => "object",
                .e_undefined => "undefined",
                .e_boolean => "boolean",
                .e_number => "number",
                .e_big_int => "bigint",
                .e_string => "string",
                .e_class, .e_function, .e_arrow => "function",
                else => null,
            };
        }

        pub fn format(tag: Tag, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try switch (tag) {
                .e_string => writer.writeAll("string"),
                .e_array => writer.writeAll("array"),
                .e_unary => writer.writeAll("unary"),
                .e_binary => writer.writeAll("binary"),
                .e_boolean => writer.writeAll("boolean"),
                .e_super => writer.writeAll("super"),
                .e_null => writer.writeAll("null"),
                .e_undefined => writer.writeAll("undefined"),
                .e_new => writer.writeAll("new"),
                .e_function => writer.writeAll("function"),
                .e_new_target => writer.writeAll("new target"),
                .e_import_meta => writer.writeAll("import.meta"),
                .e_call => writer.writeAll("call"),
                .e_dot => writer.writeAll("dot"),
                .e_index => writer.writeAll("index"),
                .e_arrow => writer.writeAll("arrow"),
                .e_identifier => writer.writeAll("identifier"),
                .e_import_identifier => writer.writeAll("import identifier"),
                .e_private_identifier => writer.writeAll("#privateIdentifier"),
                .e_jsx_element => writer.writeAll("<jsx>"),
                .e_missing => writer.writeAll("<missing>"),
                .e_number => writer.writeAll("number"),
                .e_big_int => writer.writeAll("BigInt"),
                .e_object => writer.writeAll("object"),
                .e_spread => writer.writeAll("..."),
                .e_template_part => writer.writeAll("template_part"),
                .e_template => writer.writeAll("template"),
                .e_reg_exp => writer.writeAll("regexp"),
                .e_await => writer.writeAll("await"),
                .e_yield => writer.writeAll("yield"),
                .e_if => writer.writeAll("if"),
                .e_require_resolve_string => writer.writeAll("require_or_require_resolve"),
                .e_import => writer.writeAll("import"),
                .e_this => writer.writeAll("this"),
                .e_class => writer.writeAll("class"),
                .e_require_string => writer.writeAll("require"),
                else => writer.writeAll(@tagName(tag)),
            };
        }

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }

        pub fn isArray(self: Tag) bool {
            switch (self) {
                .e_array => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isUnary(self: Tag) bool {
            switch (self) {
                .e_unary => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBinary(self: Tag) bool {
            switch (self) {
                .e_binary => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isThis(self: Tag) bool {
            switch (self) {
                .e_this => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isClass(self: Tag) bool {
            switch (self) {
                .e_class => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBoolean(self: Tag) bool {
            switch (self) {
                .e_boolean => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isSuper(self: Tag) bool {
            switch (self) {
                .e_super => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNull(self: Tag) bool {
            switch (self) {
                .e_null => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isUndefined(self: Tag) bool {
            switch (self) {
                .e_undefined => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNew(self: Tag) bool {
            switch (self) {
                .e_new => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNewTarget(self: Tag) bool {
            switch (self) {
                .e_new_target => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isFunction(self: Tag) bool {
            switch (self) {
                .e_function => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImportMeta(self: Tag) bool {
            switch (self) {
                .e_import_meta => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isCall(self: Tag) bool {
            switch (self) {
                .e_call => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isDot(self: Tag) bool {
            switch (self) {
                .e_dot => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIndex(self: Tag) bool {
            switch (self) {
                .e_index => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isArrow(self: Tag) bool {
            switch (self) {
                .e_arrow => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIdentifier(self: Tag) bool {
            switch (self) {
                .e_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImportIdentifier(self: Tag) bool {
            switch (self) {
                .e_import_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isPrivateIdentifier(self: Tag) bool {
            switch (self) {
                .e_private_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isJsxElement(self: Tag) bool {
            switch (self) {
                .e_jsx_element => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isMissing(self: Tag) bool {
            switch (self) {
                .e_missing => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNumber(self: Tag) bool {
            switch (self) {
                .e_number => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBigInt(self: Tag) bool {
            switch (self) {
                .e_big_int => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isObject(self: Tag) bool {
            switch (self) {
                .e_object => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isSpread(self: Tag) bool {
            switch (self) {
                .e_spread => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isString(self: Tag) bool {
            switch (self) {
                .e_string => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isTemplatePart(self: Tag) bool {
            switch (self) {
                .e_template_part => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isTemplate(self: Tag) bool {
            switch (self) {
                .e_template => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isRegExp(self: Tag) bool {
            switch (self) {
                .e_reg_exp => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isAwait(self: Tag) bool {
            switch (self) {
                .e_await => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isYield(self: Tag) bool {
            switch (self) {
                .e_yield => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIf(self: Tag) bool {
            switch (self) {
                .e_if => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isRequireResolveString(self: Tag) bool {
            switch (self) {
                .e_require_resolve_string => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImport(self: Tag) bool {
            switch (self) {
                .e_import => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
    };

    pub fn isBoolean(a: Expr) bool {
        switch (a.data) {
            .e_boolean => {
                return true;
            },

            .e_if => |ex| {
                return isBoolean(ex.yes) and isBoolean(ex.no);
            },
            .e_unary => |ex| {
                return ex.op == .un_not or ex.op == .un_delete;
            },
            .e_binary => |ex| {
                switch (ex.op) {
                    .bin_strict_eq, .bin_strict_ne, .bin_loose_eq, .bin_loose_ne, .bin_lt, .bin_gt, .bin_le, .bin_ge, .bin_instanceof, .bin_in => {
                        return true;
                    },
                    .bin_logical_or => {
                        return isBoolean(ex.left) and isBoolean(ex.right);
                    },
                    .bin_logical_and => {
                        return isBoolean(ex.left) and isBoolean(ex.right);
                    },
                    else => {},
                }
            },
            else => {},
        }

        return false;
    }

    pub fn assign(a: Expr, b: Expr) Expr {
        return init(E.Binary, E.Binary{
            .op = .bin_assign,
            .left = a,
            .right = b,
        }, a.loc);
    }
    pub inline fn at(expr: Expr, comptime Type: type, t: Type, _: std.mem.Allocator) Expr {
        return init(Type, t, expr.loc);
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(expr: Expr, allocator: std.mem.Allocator) Expr {
        return maybeSimplifyNot(
            expr,
            allocator,
        ) orelse Expr.init(
            E.Unary,
            E.Unary{
                .op = .un_not,
                .value = expr,
            },
            expr.loc,
        );
    }

    pub fn hasValueForThisInCall(expr: Expr) bool {
        return switch (expr.data) {
            .e_dot, .e_index => true,
            else => false,
        };
    }

    /// The given "expr" argument should be the operand of a "!" prefix operator
    /// (i.e. the "x" in "!x"). This returns a simplified expression for the
    /// whole operator (i.e. the "!x") if it can be simplified, or false if not.
    /// It's separate from "Not()" above to avoid allocation on failure in case
    /// that is undesired.
    pub fn maybeSimplifyNot(expr: Expr, allocator: std.mem.Allocator) ?Expr {
        switch (expr.data) {
            .e_null, .e_undefined => {
                return expr.at(E.Boolean, E.Boolean{ .value = true }, allocator);
            },
            .e_boolean => |b| {
                return expr.at(E.Boolean, E.Boolean{ .value = b.value }, allocator);
            },
            .e_number => |n| {
                return expr.at(E.Boolean, E.Boolean{ .value = (n.value == 0 or std.math.isNan(n.value)) }, allocator);
            },
            .e_big_int => |b| {
                return expr.at(E.Boolean, E.Boolean{ .value = strings.eqlComptime(b.value, "0") }, allocator);
            },
            .e_function,
            .e_arrow,
            .e_reg_exp,
            => {
                return expr.at(E.Boolean, E.Boolean{ .value = false }, allocator);
            },
            // "!!!a" => "!a"
            .e_unary => |un| {
                if (un.op == Op.Code.un_not and knownPrimitive(un.value) == .boolean) {
                    return un.value;
                }
            },
            .e_binary => |ex| {
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                switch (ex.op) {
                    Op.Code.bin_loose_eq => {
                        // "!(a == b)" => "a != b"
                        ex.op = .bin_loose_ne;
                        return expr;
                    },
                    Op.Code.bin_loose_ne => {
                        // "!(a != b)" => "a == b"
                        ex.op = .bin_loose_eq;
                        return expr;
                    },
                    Op.Code.bin_strict_eq => {
                        // "!(a === b)" => "a !== b"
                        ex.op = .bin_strict_ne;
                        return expr;
                    },
                    Op.Code.bin_strict_ne => {
                        // "!(a !== b)" => "a === b"
                        ex.op = .bin_strict_eq;
                        return expr;
                    },
                    Op.Code.bin_comma => {
                        // "!(a, b)" => "a, !b"
                        ex.right = ex.right.not(allocator);
                        return expr;
                    },
                    else => {},
                }
            },
            .e_inlined_enum => |inlined| {
                return maybeSimplifyNot(inlined.value, allocator);
            },

            else => {},
        }

        return null;
    }

    pub fn toStringExprWithoutSideEffects(expr: Expr, allocator: std.mem.Allocator) ?Expr {
        const unwrapped = expr.unwrapInlined();
        const slice = switch (unwrapped.data) {
            .e_null => "null",
            .e_string => return expr,
            .e_undefined => "undefined",
            .e_boolean => |data| if (data.value) "true" else "false",
            .e_big_int => |bigint| bigint.value,
            .e_number => |num| if (num.toString(allocator)) |str|
                str
            else
                null,
            .e_reg_exp => |regexp| regexp.value,
            .e_dot => |dot| @as(?[]const u8, brk: {
                // This is dumb but some JavaScript obfuscators use this to generate string literals
                if (bun.strings.eqlComptime(dot.name, "constructor")) {
                    break :brk switch (dot.target.data) {
                        .e_string => "function String() { [native code] }",
                        .e_reg_exp => "function RegExp() { [native code] }",
                        else => null,
                    };
                }
                break :brk null;
            }),
            else => null,
        };
        return if (slice) |s| Expr.init(E.String, E.String.init(s), expr.loc) else null;
    }

    pub fn isOptionalChain(self: *const @This()) bool {
        return switch (self.data) {
            .e_dot => self.data.e_dot.optional_chain != null,
            .e_index => self.data.e_index.optional_chain != null,
            .e_call => self.data.e_call.optional_chain != null,
            else => false,
        };
    }

    pub inline fn knownPrimitive(self: @This()) PrimitiveType {
        return self.data.knownPrimitive();
    }

    pub const PrimitiveType = enum {
        unknown,
        mixed,
        null,
        undefined,
        boolean,
        number,
        string,
        bigint,

        pub const static = std.enums.EnumSet(PrimitiveType).init(.{
            .mixed = true,
            .null = true,
            .undefined = true,
            .boolean = true,
            .number = true,
            .string = true,
            // for our purposes, bigint is dynamic
            // it is technically static though
            // .@"bigint" = true,
        });

        pub inline fn isStatic(this: PrimitiveType) bool {
            return static.contains(this);
        }

        pub fn merge(left_known: PrimitiveType, right_known: PrimitiveType) PrimitiveType {
            if (right_known == .unknown or left_known == .unknown)
                return .unknown;

            return if (left_known == right_known)
                left_known
            else
                .mixed;
        }
    };

    pub const Data = union(Tag) {
        e_array: *E.Array,
        e_unary: *E.Unary,
        e_binary: *E.Binary,
        e_class: *E.Class,

        e_new: *E.New,
        e_function: *E.Function,
        e_call: *E.Call,
        e_dot: *E.Dot,
        e_index: *E.Index,
        e_arrow: *E.Arrow,

        e_jsx_element: *E.JSXElement,
        e_object: *E.Object,
        e_spread: *E.Spread,
        e_template_part: *E.TemplatePart,
        e_template: *E.Template,
        e_reg_exp: *E.RegExp,
        e_await: *E.Await,
        e_yield: *E.Yield,
        e_if: *E.If,
        e_import: *E.Import,

        e_identifier: E.Identifier,
        e_import_identifier: E.ImportIdentifier,
        e_private_identifier: E.PrivateIdentifier,
        e_commonjs_export_identifier: E.CommonJSExportIdentifier,
        e_module_dot_exports,

        e_boolean: E.Boolean,
        e_number: E.Number,
        e_big_int: *E.BigInt,
        e_string: *E.String,

        e_require_string: E.RequireString,
        e_require_resolve_string: E.RequireResolveString,
        e_require_call_target,
        e_require_resolve_call_target,

        e_missing: E.Missing,
        e_this: E.This,
        e_super: E.Super,
        e_null: E.Null,
        e_undefined: E.Undefined,
        e_new_target: E.NewTarget,
        e_import_meta: E.ImportMeta,

        e_import_meta_main: E.ImportMetaMain,
        e_require_main,

        e_inlined_enum: *E.InlinedEnum,

        comptime {
            bun.assert_eql(@sizeOf(Data), 24); // Do not increase the size of Expr
        }

        pub fn as(data: Data, comptime tag: Tag) ?std.meta.FieldType(Data, tag) {
            return if (data == tag) @field(data, @tagName(tag)) else null;
        }

        pub fn clone(this: Expr.Data, allocator: std.mem.Allocator) !Data {
            return switch (this) {
                .e_array => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_array)));
                    item.* = el.*;
                    return .{ .e_array = item };
                },
                .e_unary => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_unary)));
                    item.* = el.*;
                    return .{ .e_unary = item };
                },
                .e_binary => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_binary)));
                    item.* = el.*;
                    return .{ .e_binary = item };
                },
                .e_class => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_class)));
                    item.* = el.*;
                    return .{ .e_class = item };
                },
                .e_new => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_new)));
                    item.* = el.*;
                    return .{ .e_new = item };
                },
                .e_function => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_function)));
                    item.* = el.*;
                    return .{ .e_function = item };
                },
                .e_call => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_call)));
                    item.* = el.*;
                    return .{ .e_call = item };
                },
                .e_dot => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_dot)));
                    item.* = el.*;
                    return .{ .e_dot = item };
                },
                .e_index => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_index)));
                    item.* = el.*;
                    return .{ .e_index = item };
                },
                .e_arrow => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_arrow)));
                    item.* = el.*;
                    return .{ .e_arrow = item };
                },
                .e_jsx_element => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_jsx_element)));
                    item.* = el.*;
                    return .{ .e_jsx_element = item };
                },
                .e_object => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_object)));
                    item.* = el.*;
                    return .{ .e_object = item };
                },
                .e_spread => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_spread)));
                    item.* = el.*;
                    return .{ .e_spread = item };
                },
                .e_template_part => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_template_part)));
                    item.* = el.*;
                    return .{ .e_template_part = item };
                },
                .e_template => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_template)));
                    item.* = el.*;
                    return .{ .e_template = item };
                },
                .e_reg_exp => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_reg_exp)));
                    item.* = el.*;
                    return .{ .e_reg_exp = item };
                },
                .e_await => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_await)));
                    item.* = el.*;
                    return .{ .e_await = item };
                },
                .e_yield => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_yield)));
                    item.* = el.*;
                    return .{ .e_yield = item };
                },
                .e_if => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_if)));
                    item.* = el.*;
                    return .{ .e_if = item };
                },
                .e_import => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_import)));
                    item.* = el.*;
                    return .{ .e_import = item };
                },
                .e_big_int => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_big_int)));
                    item.* = el.*;
                    return .{ .e_big_int = item };
                },
                .e_string => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_string)));
                    item.* = el.*;
                    return .{ .e_string = item };
                },
                .e_inlined_enum => |el| {
                    const item = try allocator.create(std.meta.Child(@TypeOf(this.e_inlined_enum)));
                    item.* = el.*;
                    return .{ .e_inlined_enum = item };
                },
                else => this,
            };
        }

        pub fn deepClone(this: Expr.Data, allocator: std.mem.Allocator) !Data {
            return switch (this) {
                .e_array => |el| {
                    const items = try el.items.deepClone(allocator);
                    const item = bun.create(allocator, E.Array, .{
                        .items = items,
                        .comma_after_spread = el.comma_after_spread,
                        .was_originally_macro = el.was_originally_macro,
                        .is_single_line = el.is_single_line,
                        .is_parenthesized = el.is_parenthesized,
                        .close_bracket_loc = el.close_bracket_loc,
                    });
                    return .{ .e_array = item };
                },
                .e_unary => |el| {
                    const item = bun.create(allocator, E.Unary, .{
                        .op = el.op,
                        .value = try el.value.deepClone(allocator),
                    });
                    return .{ .e_unary = item };
                },
                .e_binary => |el| {
                    const item = bun.create(allocator, E.Binary, .{
                        .op = el.op,
                        .left = try el.left.deepClone(allocator),
                        .right = try el.right.deepClone(allocator),
                    });
                    return .{ .e_binary = item };
                },
                .e_class => |el| {
                    const properties = try allocator.alloc(G.Property, el.properties.len);
                    for (el.properties, 0..) |prop, i| {
                        properties[i] = try prop.deepClone(allocator);
                    }

                    const item = bun.create(allocator, E.Class, .{
                        .class_keyword = el.class_keyword,
                        .ts_decorators = try el.ts_decorators.deepClone(allocator),
                        .class_name = el.class_name,
                        .extends = if (el.extends) |e| try e.deepClone(allocator) else null,
                        .body_loc = el.body_loc,
                        .close_brace_loc = el.close_brace_loc,
                        .properties = properties,
                        .has_decorators = el.has_decorators,
                    });
                    return .{ .e_class = item };
                },
                .e_new => |el| {
                    const item = bun.create(allocator, E.New, .{
                        .target = try el.target.deepClone(allocator),
                        .args = try el.args.deepClone(allocator),
                        .can_be_unwrapped_if_unused = el.can_be_unwrapped_if_unused,
                        .close_parens_loc = el.close_parens_loc,
                    });

                    return .{ .e_new = item };
                },
                .e_function => |el| {
                    const item = bun.create(allocator, E.Function, .{
                        .func = try el.func.deepClone(allocator),
                    });
                    return .{ .e_function = item };
                },
                .e_call => |el| {
                    const item = bun.create(allocator, E.Call, .{
                        .target = try el.target.deepClone(allocator),
                        .args = try el.args.deepClone(allocator),
                        .optional_chain = el.optional_chain,
                        .is_direct_eval = el.is_direct_eval,
                        .close_paren_loc = el.close_paren_loc,
                        .can_be_unwrapped_if_unused = el.can_be_unwrapped_if_unused,
                        .was_jsx_element = el.was_jsx_element,
                    });
                    return .{ .e_call = item };
                },
                .e_dot => |el| {
                    const item = bun.create(allocator, E.Dot, .{
                        .target = try el.target.deepClone(allocator),
                        .name = el.name,
                        .name_loc = el.name_loc,
                        .optional_chain = el.optional_chain,
                        .can_be_removed_if_unused = el.can_be_removed_if_unused,
                        .call_can_be_unwrapped_if_unused = el.call_can_be_unwrapped_if_unused,
                    });
                    return .{ .e_dot = item };
                },
                .e_index => |el| {
                    const item = bun.create(allocator, E.Index, .{
                        .target = try el.target.deepClone(allocator),
                        .index = try el.index.deepClone(allocator),
                        .optional_chain = el.optional_chain,
                    });
                    return .{ .e_index = item };
                },
                .e_arrow => |el| {
                    const args = try allocator.alloc(G.Arg, el.args.len);
                    for (0..args.len) |i| {
                        args[i] = try el.args[i].deepClone(allocator);
                    }
                    const item = bun.create(allocator, E.Arrow, .{
                        .args = args,
                        .body = el.body,
                        .is_async = el.is_async,
                        .has_rest_arg = el.has_rest_arg,
                        .prefer_expr = el.prefer_expr,
                    });

                    return .{ .e_arrow = item };
                },
                .e_jsx_element => |el| {
                    const item = bun.create(allocator, E.JSXElement, .{
                        .tag = if (el.tag) |tag| try tag.deepClone(allocator) else null,
                        .properties = try el.properties.deepClone(allocator),
                        .children = try el.children.deepClone(allocator),
                        .key_prop_index = el.key_prop_index,
                        .flags = el.flags,
                        .close_tag_loc = el.close_tag_loc,
                    });
                    return .{ .e_jsx_element = item };
                },
                .e_object => |el| {
                    const item = bun.create(allocator, E.Object, .{
                        .properties = try el.properties.deepClone(allocator),
                        .comma_after_spread = el.comma_after_spread,
                        .is_single_line = el.is_single_line,
                        .is_parenthesized = el.is_parenthesized,
                        .was_originally_macro = el.was_originally_macro,
                        .close_brace_loc = el.close_brace_loc,
                    });
                    return .{ .e_object = item };
                },
                .e_spread => |el| {
                    const item = bun.create(allocator, E.Spread, .{
                        .value = try el.value.deepClone(allocator),
                    });
                    return .{ .e_spread = item };
                },
                .e_template_part => |el| {
                    const item = bun.create(allocator, E.TemplatePart, .{
                        .value = try el.value.deepClone(allocator),
                        .tail_loc = el.tail_loc,
                        .tail = el.tail,
                    });
                    return .{ .e_template_part = item };
                },
                .e_template => |el| {
                    const item = bun.create(allocator, E.Template, .{
                        .tag = if (el.tag) |tag| try tag.deepClone(allocator) else null,
                        .parts = el.parts,
                        .head = el.head,
                    });
                    return .{ .e_template = item };
                },
                .e_reg_exp => |el| {
                    const item = bun.create(allocator, E.RegExp, .{
                        .value = el.value,
                        .flags_offset = el.flags_offset,
                    });
                    return .{ .e_reg_exp = item };
                },
                .e_await => |el| {
                    const item = bun.create(allocator, E.Await, .{
                        .value = try el.value.deepClone(allocator),
                    });
                    return .{ .e_await = item };
                },
                .e_yield => |el| {
                    const item = bun.create(allocator, E.Yield, .{
                        .value = if (el.value) |value| try value.deepClone(allocator) else null,
                        .is_star = el.is_star,
                    });
                    return .{ .e_yield = item };
                },
                .e_if => |el| {
                    const item = bun.create(allocator, E.If, .{
                        .test_ = try el.test_.deepClone(allocator),
                        .yes = try el.yes.deepClone(allocator),
                        .no = try el.no.deepClone(allocator),
                    });
                    return .{ .e_if = item };
                },
                .e_import => |el| {
                    const item = bun.create(allocator, E.Import, .{
                        .expr = try el.expr.deepClone(allocator),
                        .options = try el.options.deepClone(allocator),
                        .import_record_index = el.import_record_index,
                    });
                    return .{ .e_import = item };
                },
                .e_big_int => |el| {
                    const item = bun.create(allocator, E.BigInt, .{
                        .value = el.value,
                    });
                    return .{ .e_big_int = item };
                },
                .e_string => |el| {
                    const item = bun.create(allocator, E.String, .{
                        .data = el.data,
                        .prefer_template = el.prefer_template,
                        .next = el.next,
                        .end = el.end,
                        .rope_len = el.rope_len,
                        .is_utf16 = el.is_utf16,
                    });
                    return .{ .e_string = item };
                },
                .e_inlined_enum => |el| {
                    const item = bun.create(allocator, E.InlinedEnum, .{
                        .value = el.value,
                        .comment = el.comment,
                    });
                    return .{ .e_inlined_enum = item };
                },
                else => this,
            };
        }

        /// `hasher` should be something with 'pub fn update([]const u8) void';
        /// symbol table is passed to serialize `Ref` as an identifier names instead of a nondeterministic numbers
        pub fn writeToHasher(this: Expr.Data, hasher: anytype, symbol_table: anytype) void {
            writeAnyToHasher(hasher, std.meta.activeTag(this));
            switch (this) {
                .e_array => |e| {
                    writeAnyToHasher(hasher, .{
                        e.is_single_line,
                        e.is_parenthesized,
                        e.was_originally_macro,
                        e.items.len,
                    });
                    for (e.items.slice()) |item| {
                        item.data.writeToHasher(hasher, symbol_table);
                    }
                },
                .e_unary => |e| {
                    writeAnyToHasher(hasher, .{e.op});
                    e.value.data.writeToHasher(hasher, symbol_table);
                },
                .e_binary => |e| {
                    writeAnyToHasher(hasher, .{e.op});
                    e.left.data.writeToHasher(hasher, symbol_table);
                    e.right.data.writeToHasher(hasher, symbol_table);
                },
                .e_class => |e| {
                    _ = e; // autofix
                },
                inline .e_new, .e_call => |e| {
                    _ = e; // autofix
                },
                .e_function => |e| {
                    _ = e; // autofix
                },
                .e_dot => |e| {
                    writeAnyToHasher(hasher, .{ e.optional_chain, e.name.len });
                    e.target.data.writeToHasher(hasher, symbol_table);
                    hasher.update(e.name);
                },
                .e_index => |e| {
                    writeAnyToHasher(hasher, .{e.optional_chain});
                    e.target.data.writeToHasher(hasher, symbol_table);
                    e.index.data.writeToHasher(hasher, symbol_table);
                },
                .e_arrow => |e| {
                    _ = e; // autofix
                },
                .e_jsx_element => |e| {
                    _ = e; // autofix
                },
                .e_object => |e| {
                    _ = e; // autofix
                },
                inline .e_spread, .e_await => |e| {
                    e.value.data.writeToHasher(hasher, symbol_table);
                },
                inline .e_yield => |e| {
                    writeAnyToHasher(hasher, .{ e.is_star, e.value });
                    if (e.value) |value|
                        value.data.writeToHasher(hasher, symbol_table);
                },
                .e_template_part => {
                    // TODO: delete e_template_part as hit has zero usages
                },
                .e_template => |e| {
                    _ = e; // autofix
                },
                .e_if => |e| {
                    _ = e; // autofix
                },
                .e_import => |e| {
                    _ = e; // autofix

                },
                inline .e_identifier,
                .e_import_identifier,
                .e_private_identifier,
                .e_commonjs_export_identifier,
                => |e| {
                    const symbol = e.ref.getSymbol(symbol_table);
                    hasher.update(symbol.original_name);
                },
                inline .e_boolean, .e_number => |e| {
                    writeAnyToHasher(hasher, e.value);
                },
                inline .e_big_int, .e_reg_exp => |e| {
                    hasher.update(e.value);
                },

                .e_string => |e| {
                    var next: ?*E.String = e;
                    if (next) |current| {
                        if (current.isUTF8()) {
                            hasher.update(current.data);
                        } else {
                            hasher.update(bun.reinterpretSlice(u8, current.slice16()));
                        }
                        next = current.next;
                        hasher.update("\x00");
                    }
                },
                inline .e_require_string, .e_require_resolve_string => |e| {
                    writeAnyToHasher(hasher, e.import_record_index); // preferably, i'd like to write the filepath
                },

                .e_import_meta_main => |e| {
                    writeAnyToHasher(hasher, e.inverted);
                },
                .e_inlined_enum => |e| {
                    // pretend there is no comment
                    e.value.data.writeToHasher(hasher, symbol_table);
                },

                // no data
                .e_require_call_target,
                .e_require_resolve_call_target,
                .e_missing,
                .e_this,
                .e_super,
                .e_null,
                .e_undefined,
                .e_new_target,
                .e_require_main,
                .e_import_meta,
                .e_module_dot_exports,
                => {},
            }
        }

        /// "const values" here refers to expressions that can participate in constant
        /// inlining, as they have no side effects on instantiation, and there would be
        /// no observable difference if duplicated. This is a subset of canBeMoved()
        pub fn canBeConstValue(this: Expr.Data) bool {
            return switch (this) {
                .e_number,
                .e_boolean,
                .e_null,
                .e_undefined,
                .e_inlined_enum,
                => true,
                .e_string => |str| str.next == null,
                .e_array => |array| array.was_originally_macro,
                .e_object => |object| object.was_originally_macro,
                else => false,
            };
        }

        /// Expressions that can be moved are those that do not have side
        /// effects on their own. This is used to determine what can be moved
        /// outside of a module wrapper (__esm/__commonJS).
        pub fn canBeMoved(data: Expr.Data) bool {
            return switch (data) {
                // TODO: identifiers can be removed if unused, however code that
                // moves expressions around sometimes does so incorrectly when
                // doing destructures. test case: https://github.com/oven-sh/bun/issues/14027
                // .e_identifier => |id| id.can_be_removed_if_unused,

                .e_class => |class| class.canBeMoved(),

                .e_arrow,
                .e_function,

                .e_number,
                .e_boolean,
                .e_null,
                .e_undefined,
                // .e_reg_exp,
                .e_big_int,
                .e_string,
                .e_inlined_enum,
                .e_import_meta,
                => true,

                .e_template => |template| template.tag == null and template.parts.len == 0,

                .e_array => |array| array.was_originally_macro,
                .e_object => |object| object.was_originally_macro,

                // TODO: experiment with allowing some e_binary, e_unary, e_if as movable

                else => false,
            };
        }

        pub fn knownPrimitive(data: Expr.Data) PrimitiveType {
            return switch (data) {
                .e_big_int => .bigint,
                .e_boolean => .boolean,
                .e_null => .null,
                .e_number => .number,
                .e_string => .string,
                .e_undefined => .undefined,
                .e_template => if (data.e_template.tag == null) PrimitiveType.string else PrimitiveType.unknown,
                .e_if => mergeKnownPrimitive(data.e_if.yes.data, data.e_if.no.data),
                .e_binary => |binary| brk: {
                    switch (binary.op) {
                        .bin_strict_eq,
                        .bin_strict_ne,
                        .bin_loose_eq,
                        .bin_loose_ne,
                        .bin_lt,
                        .bin_gt,
                        .bin_le,
                        .bin_ge,
                        .bin_instanceof,
                        .bin_in,
                        => break :brk PrimitiveType.boolean,
                        .bin_logical_or, .bin_logical_and => break :brk binary.left.data.mergeKnownPrimitive(binary.right.data),

                        .bin_nullish_coalescing => {
                            const left = binary.left.data.knownPrimitive();
                            const right = binary.right.data.knownPrimitive();
                            if (left == .null or left == .undefined)
                                break :brk right;

                            if (left != .unknown) {
                                if (left != .mixed)
                                    break :brk left; // Definitely not null or undefined

                                if (right != .unknown)
                                    break :brk PrimitiveType.mixed; // Definitely some kind of primitive
                            }
                        },

                        .bin_add => {
                            const left = binary.left.data.knownPrimitive();
                            const right = binary.right.data.knownPrimitive();

                            if (left == .string or right == .string)
                                break :brk PrimitiveType.string;

                            if (left == .bigint or right == .bigint)
                                break :brk PrimitiveType.bigint;

                            if (switch (left) {
                                .unknown, .mixed, .bigint => false,
                                else => true,
                            } and switch (right) {
                                .unknown, .mixed, .bigint => false,
                                else => true,
                            })
                                break :brk PrimitiveType.number;

                            break :brk PrimitiveType.mixed; // Can be number or bigint or string (or an exception)
                        },

                        .bin_sub,
                        .bin_sub_assign,
                        .bin_mul,
                        .bin_mul_assign,
                        .bin_div,
                        .bin_div_assign,
                        .bin_rem,
                        .bin_rem_assign,
                        .bin_pow,
                        .bin_pow_assign,
                        .bin_bitwise_and,
                        .bin_bitwise_and_assign,
                        .bin_bitwise_or,
                        .bin_bitwise_or_assign,
                        .bin_bitwise_xor,
                        .bin_bitwise_xor_assign,
                        .bin_shl,
                        .bin_shl_assign,
                        .bin_shr,
                        .bin_shr_assign,
                        .bin_u_shr,
                        .bin_u_shr_assign,
                        => break :brk PrimitiveType.mixed, // Can be number or bigint (or an exception)

                        .bin_assign,
                        .bin_comma,
                        => break :brk binary.right.data.knownPrimitive(),

                        else => {},
                    }

                    break :brk PrimitiveType.unknown;
                },

                .e_unary => switch (data.e_unary.op) {
                    .un_void => PrimitiveType.undefined,
                    .un_typeof => PrimitiveType.string,
                    .un_not, .un_delete => PrimitiveType.boolean,
                    .un_pos => PrimitiveType.number, // Cannot be bigint because that throws an exception
                    .un_neg, .un_cpl => switch (data.e_unary.value.data.knownPrimitive()) {
                        .bigint => PrimitiveType.bigint,
                        .unknown, .mixed => PrimitiveType.mixed,
                        else => PrimitiveType.number, // Can be number or bigint
                    },
                    .un_pre_dec, .un_pre_inc, .un_post_dec, .un_post_inc => PrimitiveType.mixed, // Can be number or bigint

                    else => PrimitiveType.unknown,
                },

                .e_inlined_enum => |inlined| inlined.value.data.knownPrimitive(),

                else => PrimitiveType.unknown,
            };
        }

        pub fn mergeKnownPrimitive(lhs: Expr.Data, rhs: Expr.Data) PrimitiveType {
            return lhs.knownPrimitive().merge(rhs.knownPrimitive());
        }

        /// Returns true if the result of the "typeof" operator on this expression is
        /// statically determined and this expression has no side effects (i.e. can be
        /// removed without consequence).
        pub inline fn toTypeof(data: Expr.Data) ?string {
            return @as(Expr.Tag, data).typeof();
        }

        pub fn toNumber(data: Expr.Data) ?f64 {
            return switch (data) {
                .e_null => 0,
                .e_undefined => std.math.nan(f64),
                .e_string => |str| {
                    if (str.next != null) return null;
                    if (!str.isUTF8()) return null;

                    // +'1' => 1
                    return stringToEquivalentNumberValue(str.slice8());
                },
                .e_boolean => @as(f64, if (data.e_boolean.value) 1.0 else 0.0),
                .e_number => data.e_number.value,
                .e_inlined_enum => |inlined| switch (inlined.value.data) {
                    .e_number => |num| num.value,
                    .e_string => |str| {
                        if (str.next != null) return null;
                        if (!str.isUTF8()) return null;

                        // +'1' => 1
                        return stringToEquivalentNumberValue(str.slice8());
                    },
                    else => null,
                },
                else => null,
            };
        }

        pub fn toFiniteNumber(data: Expr.Data) ?f64 {
            return switch (data) {
                .e_boolean => @as(f64, if (data.e_boolean.value) 1.0 else 0.0),
                .e_number => if (std.math.isFinite(data.e_number.value))
                    data.e_number.value
                else
                    null,
                .e_inlined_enum => |inlined| switch (inlined.value.data) {
                    .e_number => |num| if (std.math.isFinite(num.value))
                        num.value
                    else
                        null,
                    else => null,
                },
                else => null,
            };
        }

        pub fn extractNumericValue(data: Expr.Data) ?f64 {
            return switch (data) {
                .e_number => data.e_number.value,
                .e_inlined_enum => |inlined| switch (inlined.value.data) {
                    .e_number => |num| num.value,
                    else => null,
                },
                else => null,
            };
        }

        pub const Equality = struct {
            equal: bool = false,
            ok: bool = false,

            /// This extra flag is unfortunately required for the case of visiting the expression
            /// `require.main === module` (and any combination of !==, ==, !=, either ordering)
            ///
            /// We want to replace this with the dedicated import_meta_main node, which:
            /// - Stops this module from having p.require_ref, allowing conversion to ESM
            /// - Allows us to inline `import.meta.main`'s value, if it is known (bun build --compile)
            is_require_main_and_module: bool = false,

            pub const @"true" = Equality{ .ok = true, .equal = true };
            pub const @"false" = Equality{ .ok = true, .equal = false };
            pub const unknown = Equality{ .ok = false };
        };

        // Returns "equal, ok". If "ok" is false, then nothing is known about the two
        // values. If "ok" is true, the equality or inequality of the two values is
        // stored in "equal".
        pub fn eql(
            left: Expr.Data,
            right: Expr.Data,
            p: anytype,
            comptime kind: enum { loose, strict },
        ) Equality {
            comptime bun.assert(@typeInfo(@TypeOf(p)).Pointer.size == .One); // pass *Parser

            // https://dorey.github.io/JavaScript-Equality-Table/
            switch (left) {
                .e_inlined_enum => |inlined| return inlined.value.data.eql(right, p, kind),

                .e_null, .e_undefined => {
                    const ok = switch (@as(Expr.Tag, right)) {
                        .e_null, .e_undefined => true,
                        else => @as(Expr.Tag, right).isPrimitiveLiteral(),
                    };

                    if (comptime kind == .loose) {
                        return .{
                            .equal = switch (@as(Expr.Tag, right)) {
                                .e_null, .e_undefined => true,
                                else => false,
                            },
                            .ok = ok,
                        };
                    }

                    return .{
                        .equal = @as(Tag, right) == @as(Tag, left),
                        .ok = ok,
                    };
                },
                .e_boolean => |l| {
                    switch (right) {
                        .e_boolean => {
                            return .{
                                .ok = true,
                                .equal = l.value == right.e_boolean.value,
                            };
                        },
                        .e_number => |num| {
                            if (comptime kind == .strict) {
                                // "true === 1" is false
                                // "false === 0" is false
                                return Equality.false;
                            }

                            return .{
                                .ok = true,
                                .equal = if (l.value)
                                    num.value == 1
                                else
                                    num.value == 0,
                            };
                        },
                        .e_null, .e_undefined => {
                            return Equality.false;
                        },
                        else => {},
                    }
                },
                .e_number => |l| {
                    switch (right) {
                        .e_number => |r| {
                            return .{
                                .ok = true,
                                .equal = l.value == r.value,
                            };
                        },
                        .e_inlined_enum => |r| if (r.value.data == .e_number) {
                            return .{
                                .ok = true,
                                .equal = l.value == r.value.data.e_number.value,
                            };
                        },
                        .e_boolean => |r| {
                            if (comptime kind == .loose) {
                                return .{
                                    .ok = true,
                                    // "1 == true" is true
                                    // "0 == false" is true
                                    .equal = if (r.value)
                                        l.value == 1
                                    else
                                        l.value == 0,
                                };
                            }

                            // "1 === true" is false
                            // "0 === false" is false
                            return Equality.false;
                        },
                        .e_null, .e_undefined => {
                            // "(not null or undefined) == undefined" is false
                            return Equality.false;
                        },
                        else => {},
                    }
                },
                .e_big_int => |l| {
                    if (right == .e_big_int) {
                        if (strings.eqlLong(l.value, right.e_big_int.value, true)) {
                            return Equality.true;
                        }

                        // 0x0000n == 0n is true
                        return .{ .ok = false };
                    } else {
                        return .{
                            .ok = switch (right) {
                                .e_null, .e_undefined => true,
                                else => false,
                            },
                            .equal = false,
                        };
                    }
                },
                .e_string => |l| {
                    switch (right) {
                        .e_string => |r| {
                            r.resolveRopeIfNeeded(p.allocator);
                            l.resolveRopeIfNeeded(p.allocator);
                            return .{
                                .ok = true,
                                .equal = r.eql(E.String, l),
                            };
                        },
                        .e_inlined_enum => |inlined| {
                            if (inlined.value.data == .e_string) {
                                const r = inlined.value.data.e_string;

                                r.resolveRopeIfNeeded(p.allocator);
                                l.resolveRopeIfNeeded(p.allocator);

                                return .{
                                    .ok = true,
                                    .equal = r.eql(E.String, l),
                                };
                            }
                        },
                        .e_null, .e_undefined => {
                            return Equality.false;
                        },
                        .e_number => |r| {
                            if (comptime kind == .loose) {
                                if (r.value == 0 and (l.isBlank() or l.eqlComptime("0"))) {
                                    return Equality.true;
                                }

                                if (r.value == 1 and l.eqlComptime("1")) {
                                    return Equality.true;
                                }

                                // the string could still equal 0 or 1 but it could be hex, binary, octal, ...
                                return Equality.unknown;
                            } else {
                                return Equality.false;
                            }
                        },

                        else => {},
                    }
                },

                else => {
                    // Do not need to check left because e_require_main is
                    // always re-ordered to the right side.
                    if (right == .e_require_main) {
                        if (left.as(.e_identifier)) |id| {
                            if (id.ref.eql(p.module_ref)) return .{
                                .ok = true,
                                .equal = true,
                                .is_require_main_and_module = true,
                            };
                        }
                    }
                },
            }

            return Equality.unknown;
        }

        pub fn toJS(this: Data, allocator: std.mem.Allocator, globalObject: *JSC.JSGlobalObject) ToJSError!JSC.JSValue {
            return switch (this) {
                .e_array => |e| e.toJS(allocator, globalObject),
                .e_object => |e| e.toJS(allocator, globalObject),
                .e_string => |e| e.toJS(allocator, globalObject),
                .e_null => JSC.JSValue.null,
                .e_undefined => JSC.JSValue.undefined,
                .e_boolean => |boolean| if (boolean.value)
                    JSC.JSValue.true
                else
                    JSC.JSValue.false,
                .e_number => |e| e.toJS(),
                // .e_big_int => |e| e.toJS(ctx, exception),

                .e_inlined_enum => |inlined| inlined.value.data.toJS(allocator, globalObject),

                .e_identifier,
                .e_import_identifier,
                .e_private_identifier,
                .e_commonjs_export_identifier,
                => error.@"Cannot convert identifier to JS. Try a statically-known value",

                // brk: {
                //     // var node = try allocator.create(Macro.JSNode);
                //     // node.* = Macro.JSNode.initExpr(Expr{ .data = this, .loc = logger.Loc.Empty });
                //     // break :brk JSC.JSValue.c(Macro.JSNode.Class.make(globalObject, node));
                // },

                else => {
                    return error.@"Cannot convert argument type to JS";
                },
            };
        }

        pub const Store = struct {
            const StoreType = NewStore(&.{
                E.Array,
                E.Arrow,
                E.Await,
                E.BigInt,
                E.Binary,
                E.Call,
                E.Class,
                E.Dot,
                E.Function,
                E.If,
                E.Import,
                E.Index,
                E.InlinedEnum,
                E.JSXElement,
                E.New,
                E.Number,
                E.Object,
                E.PrivateIdentifier,
                E.RegExp,
                E.Spread,
                E.String,
                E.Template,
                E.TemplatePart,
                E.Unary,
                E.Yield,
            }, 512);

            pub threadlocal var instance: ?*StoreType = null;
            pub threadlocal var memory_allocator: ?*ASTMemoryAllocator = null;
            pub threadlocal var disable_reset = false;

            pub fn create() void {
                if (instance != null or memory_allocator != null) {
                    return;
                }

                instance = StoreType.init();
            }

            pub fn reset() void {
                if (disable_reset or memory_allocator != null) return;
                instance.?.reset();
            }

            pub fn deinit() void {
                if (instance == null or memory_allocator != null) return;
                instance.?.deinit();
                instance = null;
            }

            pub inline fn assert() void {
                if (comptime Environment.allow_assert) {
                    if (instance == null and memory_allocator == null)
                        bun.unreachablePanic("Store must be init'd", .{});
                }
            }

            pub fn append(comptime T: type, value: T) *T {
                if (memory_allocator) |allocator| {
                    return allocator.append(T, value);
                }

                Disabler.assert();
                return instance.?.append(T, value);
            }
        };

        pub inline fn isStringValue(self: Data) bool {
            return @as(Expr.Tag, self) == .e_string;
        }
    };

    pub fn StoredData(tag: Tag) type {
        const T = std.meta.FieldType(Data, tag);
        return switch (@typeInfo(T)) {
            .Pointer => |ptr| ptr.child,
            else => T,
        };
    }
};

pub const EnumValue = struct {
    loc: logger.Loc,
    ref: Ref,
    name: []const u8,
    value: ?ExprNodeIndex,

    pub fn nameAsEString(enum_value: EnumValue, allocator: std.mem.Allocator) E.String {
        return E.String.initReEncodeUTF8(enum_value.name, allocator);
    }
};

pub const S = struct {
    pub const Block = struct {
        stmts: StmtNodeList,
        close_brace_loc: logger.Loc = logger.Loc.Empty,
    };

    pub const SExpr = struct {
        value: ExprNodeIndex,

        // This is set to true for automatically-generated expressions that should
        // not affect tree shaking. For example, calling a function from the runtime
        // that doesn't have externally-visible side effects.
        does_not_affect_tree_shaking: bool = false,
    };

    pub const Comment = struct { text: string };

    pub const Directive = struct {
        value: []const u8,
    };

    pub const ExportClause = struct { items: []ClauseItem, is_single_line: bool = false };

    pub const Empty = struct {};

    pub const ExportStar = struct {
        namespace_ref: Ref,
        alias: ?G.ExportStarAlias = null,
        import_record_index: u32,
    };

    // This is an "export = value;" statement in TypeScript
    pub const ExportEquals = struct { value: ExprNodeIndex };

    pub const Label = struct { name: LocRef, stmt: StmtNodeIndex };

    // This is a stand-in for a TypeScript type declaration
    pub const TypeScript = struct {};

    pub const Debugger = struct {};

    pub const ExportFrom = struct {
        items: []ClauseItem,
        namespace_ref: Ref,
        import_record_index: u32,
        is_single_line: bool,
    };

    pub const ExportDefault = struct {
        default_name: LocRef, // value may be a SFunction or SClass
        value: StmtOrExpr,

        pub fn canBeMoved(self: *const ExportDefault) bool {
            return switch (self.value) {
                .expr => |e| e.canBeMoved(),
                .stmt => |s| switch (s.data) {
                    .s_class => |class| class.class.canBeMoved(),
                    .s_function => true,
                    else => false,
                },
            };
        }
    };

    pub const Enum = struct {
        name: LocRef,
        arg: Ref,
        values: []EnumValue,
        is_export: bool,
    };

    pub const Namespace = struct {
        name: LocRef,
        arg: Ref,
        stmts: StmtNodeList,
        is_export: bool,
    };

    pub const Function = struct {
        func: G.Fn,
    };

    pub const Class = struct { class: G.Class, is_export: bool = false };

    pub const If = struct {
        test_: ExprNodeIndex,
        yes: StmtNodeIndex,
        no: ?StmtNodeIndex,
    };

    pub const For = struct {
        // May be a SConst, SLet, SVar, or SExpr
        init: ?StmtNodeIndex = null,
        test_: ?ExprNodeIndex = null,
        update: ?ExprNodeIndex = null,
        body: StmtNodeIndex,
    };

    pub const ForIn = struct {
        // May be a SConst, SLet, SVar, or SExpr
        init: StmtNodeIndex,
        value: ExprNodeIndex,
        body: StmtNodeIndex,
    };

    pub const ForOf = struct {
        is_await: bool = false,
        // May be a SConst, SLet, SVar, or SExpr
        init: StmtNodeIndex,
        value: ExprNodeIndex,
        body: StmtNodeIndex,
    };

    pub const DoWhile = struct { body: StmtNodeIndex, test_: ExprNodeIndex };

    pub const While = struct {
        test_: ExprNodeIndex,
        body: StmtNodeIndex,
    };

    pub const With = struct {
        value: ExprNodeIndex,
        body: StmtNodeIndex,
        body_loc: logger.Loc = logger.Loc.Empty,
    };

    pub const Try = struct {
        body_loc: logger.Loc,
        body: StmtNodeList,

        catch_: ?Catch = null,
        finally: ?Finally = null,
    };

    pub const Switch = struct {
        test_: ExprNodeIndex,
        body_loc: logger.Loc,
        cases: []Case,
    };

    // This object represents all of these types of import statements:
    //
    //    import 'path'
    //    import {item1, item2} from 'path'
    //    import * as ns from 'path'
    //    import defaultItem, {item1, item2} from 'path'
    //    import defaultItem, * as ns from 'path'
    //
    // Many parts are optional and can be combined in different ways. The only
    // restriction is that you cannot have both a clause and a star namespace.
    pub const Import = struct {
        // If this is a star import: This is a Ref for the namespace symbol. The Loc
        // for the symbol is StarLoc.
        //
        // Otherwise: This is an auto-generated Ref for the namespace representing
        // the imported file. In this case StarLoc is nil. The NamespaceRef is used
        // when converting this module to a CommonJS module.
        namespace_ref: Ref,
        default_name: ?LocRef = null,
        items: []ClauseItem = &.{},
        star_name_loc: ?logger.Loc = null,
        import_record_index: u32,
        is_single_line: bool = false,
    };

    pub const Return = struct { value: ?ExprNodeIndex = null };
    pub const Throw = struct { value: ExprNodeIndex };

    pub const Local = struct {
        kind: Kind = .k_var,
        decls: G.Decl.List = .{},
        is_export: bool = false,
        // The TypeScript compiler doesn't generate code for "import foo = bar"
        // statements where the import is never used.
        was_ts_import_equals: bool = false,

        was_commonjs_export: bool = false,

        pub fn canMergeWith(this: *const Local, other: *const Local) bool {
            return this.kind == other.kind and this.is_export == other.is_export and
                this.was_commonjs_export == other.was_commonjs_export;
        }

        pub const Kind = enum {
            k_var,
            k_let,
            k_const,
            k_using,
            k_await_using,

            pub fn jsonStringify(self: @This(), writer: anytype) !void {
                return try writer.write(@tagName(self));
            }

            pub fn isUsing(self: Kind) bool {
                return self == .k_using or self == .k_await_using;
            }

            pub fn isReassignable(kind: Kind) bool {
                return kind == .k_var or kind == .k_let;
            }
        };
    };

    pub const Break = struct {
        label: ?LocRef = null,
    };

    pub const Continue = struct {
        label: ?LocRef = null,
    };
};

pub const Catch = struct {
    loc: logger.Loc,
    binding: ?BindingNodeIndex = null,
    body: StmtNodeList,
    body_loc: logger.Loc,
};

pub const Finally = struct {
    loc: logger.Loc,
    stmts: StmtNodeList,
};

pub const Case = struct { loc: logger.Loc, value: ?ExprNodeIndex, body: StmtNodeList };

pub const Op = struct {
    // If you add a new token, remember to add it to "Table" too
    pub const Code = enum {
        // Prefix
        un_pos, // +expr
        un_neg, // -expr
        un_cpl, // ~expr
        un_not, // !expr
        un_void,
        un_typeof,
        un_delete,

        // Prefix update
        un_pre_dec,
        un_pre_inc,

        // Postfix update
        un_post_dec,
        un_post_inc,

        /// Left-associative
        bin_add,
        /// Left-associative
        bin_sub,
        /// Left-associative
        bin_mul,
        /// Left-associative
        bin_div,
        /// Left-associative
        bin_rem,
        /// Left-associative
        bin_pow,
        /// Left-associative
        bin_lt,
        /// Left-associative
        bin_le,
        /// Left-associative
        bin_gt,
        /// Left-associative
        bin_ge,
        /// Left-associative
        bin_in,
        /// Left-associative
        bin_instanceof,
        /// Left-associative
        bin_shl,
        /// Left-associative
        bin_shr,
        /// Left-associative
        bin_u_shr,
        /// Left-associative
        bin_loose_eq,
        /// Left-associative
        bin_loose_ne,
        /// Left-associative
        bin_strict_eq,
        /// Left-associative
        bin_strict_ne,
        /// Left-associative
        bin_nullish_coalescing,
        /// Left-associative
        bin_logical_or,
        /// Left-associative
        bin_logical_and,
        /// Left-associative
        bin_bitwise_or,
        /// Left-associative
        bin_bitwise_and,
        /// Left-associative
        bin_bitwise_xor,

        /// Non-associative
        bin_comma,

        /// Right-associative
        bin_assign,
        /// Right-associative
        bin_add_assign,
        /// Right-associative
        bin_sub_assign,
        /// Right-associative
        bin_mul_assign,
        /// Right-associative
        bin_div_assign,
        /// Right-associative
        bin_rem_assign,
        /// Right-associative
        bin_pow_assign,
        /// Right-associative
        bin_shl_assign,
        /// Right-associative
        bin_shr_assign,
        /// Right-associative
        bin_u_shr_assign,
        /// Right-associative
        bin_bitwise_or_assign,
        /// Right-associative
        bin_bitwise_and_assign,
        /// Right-associative
        bin_bitwise_xor_assign,
        /// Right-associative
        bin_nullish_coalescing_assign,
        /// Right-associative
        bin_logical_or_assign,
        /// Right-associative
        bin_logical_and_assign,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }

        pub fn unaryAssignTarget(code: Op.Code) AssignTarget {
            if (@intFromEnum(code) >=
                @intFromEnum(Op.Code.un_pre_dec) and @intFromEnum(code) <=
                @intFromEnum(Op.Code.un_post_inc))
            {
                return AssignTarget.update;
            }

            return AssignTarget.none;
        }
        pub fn isLeftAssociative(code: Op.Code) bool {
            return @intFromEnum(code) >=
                @intFromEnum(Op.Code.bin_add) and
                @intFromEnum(code) < @intFromEnum(Op.Code.bin_comma) and code != .bin_pow;
        }
        pub fn isRightAssociative(code: Op.Code) bool {
            return @intFromEnum(code) >= @intFromEnum(Op.Code.bin_assign) or code == .bin_pow;
        }
        pub fn binaryAssignTarget(code: Op.Code) AssignTarget {
            if (code == .bin_assign) {
                return AssignTarget.replace;
            }

            if (@intFromEnum(code) > @intFromEnum(Op.Code.bin_assign)) {
                return AssignTarget.update;
            }

            return AssignTarget.none;
        }

        pub fn isPrefix(code: Op.Code) bool {
            return @intFromEnum(code) < @intFromEnum(Op.Code.un_post_dec);
        }
    };

    pub const Level = enum(u6) {
        lowest,
        comma,
        spread,
        yield,
        assign,
        conditional,
        nullish_coalescing,
        logical_or,
        logical_and,
        bitwise_or,
        bitwise_xor,
        bitwise_and,
        equals,
        compare,
        shift,
        add,
        multiply,
        exponentiation,
        prefix,
        postfix,
        new,
        call,
        member,

        pub inline fn lt(self: Level, b: Level) bool {
            return @intFromEnum(self) < @intFromEnum(b);
        }
        pub inline fn gt(self: Level, b: Level) bool {
            return @intFromEnum(self) > @intFromEnum(b);
        }
        pub inline fn gte(self: Level, b: Level) bool {
            return @intFromEnum(self) >= @intFromEnum(b);
        }
        pub inline fn lte(self: Level, b: Level) bool {
            return @intFromEnum(self) <= @intFromEnum(b);
        }
        pub inline fn eql(self: Level, b: Level) bool {
            return @intFromEnum(self) == @intFromEnum(b);
        }

        pub inline fn sub(self: Level, i: anytype) Level {
            return @as(Level, @enumFromInt(@intFromEnum(self) - i));
        }

        pub inline fn addF(self: Level, i: anytype) Level {
            return @as(Level, @enumFromInt(@intFromEnum(self) + i));
        }
    };

    text: string,
    level: Level,
    is_keyword: bool = false,

    pub fn init(triple: anytype) Op {
        return Op{
            .text = triple.@"0",
            .level = triple.@"1",
            .is_keyword = triple.@"2",
        };
    }

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(self.text);
    }

    pub const TableType: std.EnumArray(Op.Code, Op) = undefined;
    pub const Table = brk: {
        var table = std.EnumArray(Op.Code, Op).initUndefined();

        // Prefix
        table.set(Op.Code.un_pos, Op.init(.{ "+", Level.prefix, false }));
        table.set(Op.Code.un_neg, Op.init(.{ "-", Level.prefix, false }));
        table.set(Op.Code.un_cpl, Op.init(.{ "~", Level.prefix, false }));
        table.set(Op.Code.un_not, Op.init(.{ "!", Level.prefix, false }));
        table.set(Op.Code.un_void, Op.init(.{ "void", Level.prefix, true }));
        table.set(Op.Code.un_typeof, Op.init(.{ "typeof", Level.prefix, true }));
        table.set(Op.Code.un_delete, Op.init(.{ "delete", Level.prefix, true }));

        // Prefix update
        table.set(Op.Code.un_pre_dec, Op.init(.{ "--", Level.prefix, false }));
        table.set(Op.Code.un_pre_inc, Op.init(.{ "++", Level.prefix, false }));

        // Postfix update
        table.set(Op.Code.un_post_dec, Op.init(.{ "--", Level.postfix, false }));
        table.set(Op.Code.un_post_inc, Op.init(.{ "++", Level.postfix, false }));

        // Left-associative
        table.set(Op.Code.bin_add, Op.init(.{ "+", Level.add, false }));
        table.set(Op.Code.bin_sub, Op.init(.{ "-", Level.add, false }));
        table.set(Op.Code.bin_mul, Op.init(.{ "*", Level.multiply, false }));
        table.set(Op.Code.bin_div, Op.init(.{ "/", Level.multiply, false }));
        table.set(Op.Code.bin_rem, Op.init(.{ "%", Level.multiply, false }));
        table.set(Op.Code.bin_pow, Op.init(.{ "**", Level.exponentiation, false }));
        table.set(Op.Code.bin_lt, Op.init(.{ "<", Level.compare, false }));
        table.set(Op.Code.bin_le, Op.init(.{ "<=", Level.compare, false }));
        table.set(Op.Code.bin_gt, Op.init(.{ ">", Level.compare, false }));
        table.set(Op.Code.bin_ge, Op.init(.{ ">=", Level.compare, false }));
        table.set(Op.Code.bin_in, Op.init(.{ "in", Level.compare, true }));
        table.set(Op.Code.bin_instanceof, Op.init(.{ "instanceof", Level.compare, true }));
        table.set(Op.Code.bin_shl, Op.init(.{ "<<", Level.shift, false }));
        table.set(Op.Code.bin_shr, Op.init(.{ ">>", Level.shift, false }));
        table.set(Op.Code.bin_u_shr, Op.init(.{ ">>>", Level.shift, false }));
        table.set(Op.Code.bin_loose_eq, Op.init(.{ "==", Level.equals, false }));
        table.set(Op.Code.bin_loose_ne, Op.init(.{ "!=", Level.equals, false }));
        table.set(Op.Code.bin_strict_eq, Op.init(.{ "===", Level.equals, false }));
        table.set(Op.Code.bin_strict_ne, Op.init(.{ "!==", Level.equals, false }));
        table.set(Op.Code.bin_nullish_coalescing, Op.init(.{ "??", Level.nullish_coalescing, false }));
        table.set(Op.Code.bin_logical_or, Op.init(.{ "||", Level.logical_or, false }));
        table.set(Op.Code.bin_logical_and, Op.init(.{ "&&", Level.logical_and, false }));
        table.set(Op.Code.bin_bitwise_or, Op.init(.{ "|", Level.bitwise_or, false }));
        table.set(Op.Code.bin_bitwise_and, Op.init(.{ "&", Level.bitwise_and, false }));
        table.set(Op.Code.bin_bitwise_xor, Op.init(.{ "^", Level.bitwise_xor, false }));

        // Non-associative
        table.set(Op.Code.bin_comma, Op.init(.{ ",", Level.comma, false }));

        // Right-associative
        table.set(Op.Code.bin_assign, Op.init(.{ "=", Level.assign, false }));
        table.set(Op.Code.bin_add_assign, Op.init(.{ "+=", Level.assign, false }));
        table.set(Op.Code.bin_sub_assign, Op.init(.{ "-=", Level.assign, false }));
        table.set(Op.Code.bin_mul_assign, Op.init(.{ "*=", Level.assign, false }));
        table.set(Op.Code.bin_div_assign, Op.init(.{ "/=", Level.assign, false }));
        table.set(Op.Code.bin_rem_assign, Op.init(.{ "%=", Level.assign, false }));
        table.set(Op.Code.bin_pow_assign, Op.init(.{ "**=", Level.assign, false }));
        table.set(Op.Code.bin_shl_assign, Op.init(.{ "<<=", Level.assign, false }));
        table.set(Op.Code.bin_shr_assign, Op.init(.{ ">>=", Level.assign, false }));
        table.set(Op.Code.bin_u_shr_assign, Op.init(.{ ">>>=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_or_assign, Op.init(.{ "|=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_and_assign, Op.init(.{ "&=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_xor_assign, Op.init(.{ "^=", Level.assign, false }));
        table.set(Op.Code.bin_nullish_coalescing_assign, Op.init(.{ "??=", Level.assign, false }));
        table.set(Op.Code.bin_logical_or_assign, Op.init(.{ "||=", Level.assign, false }));
        table.set(Op.Code.bin_logical_and_assign, Op.init(.{ "&&=", Level.assign, false }));

        break :brk table;
    };
};

pub const ArrayBinding = struct {
    binding: BindingNodeIndex,
    default_value: ?ExprNodeIndex = null,
};

pub const Ast = struct {
    pub const TopLevelSymbolToParts = std.ArrayHashMapUnmanaged(Ref, BabyList(u32), Ref.ArrayHashCtx, false);

    approximate_newline_count: usize = 0,
    has_lazy_export: bool = false,
    runtime_imports: Runtime.Imports = .{},

    nested_scope_slot_counts: SlotCounts = SlotCounts{},

    runtime_import_record_id: ?u32 = null,
    needs_runtime: bool = false,
    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    has_top_level_return: bool = false,
    uses_exports_ref: bool = false,
    uses_module_ref: bool = false,
    uses_require_ref: bool = false,
    commonjs_module_exports_assigned_deoptimized: bool = false,

    force_cjs_to_esm: bool = false,
    exports_kind: ExportsKind = ExportsKind.none,

    // This is a list of ES6 features. They are ranges instead of booleans so
    // that they can be used in log messages. Check to see if "Len > 0".
    import_keyword: logger.Range = logger.Range.None, // Does not include TypeScript-specific syntax or "import()"
    export_keyword: logger.Range = logger.Range.None, // Does not include TypeScript-specific syntax
    top_level_await_keyword: logger.Range = logger.Range.None,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    import_records: ImportRecord.List = .{},

    hashbang: string = "",
    directive: ?string = null,
    parts: Part.List = Part.List{},
    // This list may be mutated later, so we should store the capacity
    symbols: Symbol.List = Symbol.List{},
    module_scope: Scope = Scope{},
    char_freq: ?CharFreq = null,
    exports_ref: Ref = Ref.None,
    module_ref: Ref = Ref.None,
    wrapper_ref: Ref = Ref.None,
    require_ref: Ref = Ref.None,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    named_imports: NamedImports = .{},
    named_exports: NamedExports = .{},
    export_star_import_records: []u32 = &([_]u32{}),

    // allocator: std.mem.Allocator,
    top_level_symbols_to_parts: TopLevelSymbolToParts = .{},

    commonjs_named_exports: CommonJSNamedExports = .{},

    redirect_import_record_index: ?u32 = null,

    /// Only populated when bundling
    target: bun.options.Target = .browser,
    // const_values: ConstValuesMap = .{},
    ts_enums: TsEnumsMap = .{},

    /// Not to be confused with `commonjs_named_exports`
    /// This is a list of named exports that may exist in a CommonJS module
    /// We use this with `commonjs_at_runtime` to re-export CommonJS
    has_commonjs_export_names: bool = false,
    import_meta_ref: Ref = Ref.None,

    pub const CommonJSNamedExport = struct {
        loc_ref: LocRef,
        needs_decl: bool = true,
    };
    pub const CommonJSNamedExports = bun.StringArrayHashMapUnmanaged(CommonJSNamedExport);

    pub const NamedImports = std.ArrayHashMapUnmanaged(Ref, NamedImport, RefHashCtx, true);
    pub const NamedExports = bun.StringArrayHashMapUnmanaged(NamedExport);
    pub const ConstValuesMap = std.ArrayHashMapUnmanaged(Ref, Expr, RefHashCtx, false);
    pub const TsEnumsMap = std.ArrayHashMapUnmanaged(Ref, bun.StringHashMapUnmanaged(InlinedEnumValue), RefHashCtx, false);

    pub fn fromParts(parts: []Part) Ast {
        return Ast{
            .parts = Part.List.init(parts),
            .runtime_imports = .{},
        };
    }

    pub fn initTest(parts: []Part) Ast {
        return Ast{
            .parts = Part.List.init(parts),
            .runtime_imports = .{},
        };
    }

    pub const empty = Ast{ .parts = Part.List{}, .runtime_imports = .{} };

    pub fn toJSON(self: *const Ast, _: std.mem.Allocator, stream: anytype) !void {
        const opts = std.json.StringifyOptions{ .whitespace = std.json.StringifyOptions.Whitespace{
            .separator = true,
        } };
        try std.json.stringify(self.parts, opts, stream);
    }

    /// Do not call this if it wasn't globally allocated!
    pub fn deinit(this: *Ast) void {
        // TODO: assert mimalloc-owned memory
        if (this.parts.len > 0) this.parts.deinitWithAllocator(bun.default_allocator);
        if (this.symbols.len > 0) this.symbols.deinitWithAllocator(bun.default_allocator);
        if (this.import_records.len > 0) this.import_records.deinitWithAllocator(bun.default_allocator);
    }
};

/// TLA => Top Level Await
pub const TlaCheck = struct {
    depth: u32 = 0,
    parent: Index.Int = Index.invalid.get(),
    import_record_index: Index.Int = Index.invalid.get(),
};

/// Like Ast but slimmer and for bundling only.
///
/// On Linux, the hottest function in the bundler is:
/// src.multi_array_list.MultiArrayList(src.js_ast.Ast).ensureTotalCapacity
/// https://share.firefox.dev/3NNlRKt
///
/// So we make a slimmer version of Ast for bundling that doesn't allocate as much memory
pub const BundledAst = struct {
    approximate_newline_count: u32 = 0,
    nested_scope_slot_counts: SlotCounts = .{},

    exports_kind: ExportsKind = .none,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    import_records: ImportRecord.List = .{},

    hashbang: string = "",
    parts: Part.List = .{},
    css: ?*bun.css.BundlerStyleSheet = null,
    url_for_css: []const u8 = "",
    symbols: Symbol.List = .{},
    module_scope: Scope = .{},
    char_freq: CharFreq = undefined,
    exports_ref: Ref = Ref.None,
    module_ref: Ref = Ref.None,
    wrapper_ref: Ref = Ref.None,
    require_ref: Ref = Ref.None,
    top_level_await_keyword: logger.Range,
    tla_check: TlaCheck = .{},

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    named_imports: NamedImports = .{},
    named_exports: NamedExports = .{},
    export_star_import_records: []u32 = &.{},

    top_level_symbols_to_parts: TopLevelSymbolToParts = .{},

    commonjs_named_exports: CommonJSNamedExports = .{},

    redirect_import_record_index: u32 = std.math.maxInt(u32),

    /// Only populated when bundling. When --server-components is passed, this
    /// will be .browser when it is a client component, and the server's target
    /// on the server.
    target: bun.options.Target = .browser,

    // const_values: ConstValuesMap = .{},
    ts_enums: Ast.TsEnumsMap = .{},

    flags: BundledAst.Flags = .{},

    pub const NamedImports = Ast.NamedImports;
    pub const NamedExports = Ast.NamedExports;
    pub const TopLevelSymbolToParts = Ast.TopLevelSymbolToParts;
    pub const CommonJSNamedExports = Ast.CommonJSNamedExports;
    pub const ConstValuesMap = Ast.ConstValuesMap;

    pub const Flags = packed struct(u8) {
        // This is a list of CommonJS features. When a file uses CommonJS features,
        // it's not a candidate for "flat bundling" and must be wrapped in its own
        // closure.
        uses_exports_ref: bool = false,
        uses_module_ref: bool = false,
        // uses_require_ref: bool = false,
        uses_export_keyword: bool = false,
        has_char_freq: bool = false,
        force_cjs_to_esm: bool = false,
        has_lazy_export: bool = false,
        commonjs_module_exports_assigned_deoptimized: bool = false,
        has_explicit_use_strict_directive: bool = false,
    };

    pub const empty = BundledAst.init(Ast.empty);

    pub fn toAST(this: *const BundledAst) Ast {
        return .{
            .approximate_newline_count = this.approximate_newline_count,
            .nested_scope_slot_counts = this.nested_scope_slot_counts,

            .exports_kind = this.exports_kind,

            .import_records = this.import_records,

            .hashbang = this.hashbang,
            .parts = this.parts,
            // This list may be mutated later, so we should store the capacity
            .symbols = this.symbols,
            .module_scope = this.module_scope,
            .char_freq = if (this.flags.has_char_freq) this.char_freq else null,
            .exports_ref = this.exports_ref,
            .module_ref = this.module_ref,
            .wrapper_ref = this.wrapper_ref,
            .require_ref = this.require_ref,
            .top_level_await_keyword = this.top_level_await_keyword,

            // These are used when bundling. They are filled in during the parser pass
            // since we already have to traverse the AST then anyway and the parser pass
            // is conveniently fully parallelized.
            .named_imports = this.named_imports,
            .named_exports = this.named_exports,
            .export_star_import_records = this.export_star_import_records,

            .top_level_symbols_to_parts = this.top_level_symbols_to_parts,

            .commonjs_named_exports = this.commonjs_named_exports,

            .redirect_import_record_index = this.redirect_import_record_index,

            .target = this.target,

            // .const_values = this.const_values,
            .ts_enums = this.ts_enums,

            .uses_exports_ref = this.flags.uses_exports_ref,
            .uses_module_ref = this.flags.uses_module_ref,
            // .uses_require_ref = ast.uses_require_ref,
            .export_keyword = .{ .len = if (this.flags.uses_export_keyword) 1 else 0, .loc = .{} },
            .force_cjs_to_esm = this.flags.force_cjs_to_esm,
            .has_lazy_export = this.flags.has_lazy_export,
            .commonjs_module_exports_assigned_deoptimized = this.flags.commonjs_module_exports_assigned_deoptimized,
            .directive = if (this.flags.has_explicit_use_strict_directive) "use strict" else null,
        };
    }

    pub fn init(ast: Ast) BundledAst {
        return .{
            .approximate_newline_count = @as(u32, @truncate(ast.approximate_newline_count)),
            .nested_scope_slot_counts = ast.nested_scope_slot_counts,

            .exports_kind = ast.exports_kind,

            .import_records = ast.import_records,

            .hashbang = ast.hashbang,
            .parts = ast.parts,
            // This list may be mutated later, so we should store the capacity
            .symbols = ast.symbols,
            .module_scope = ast.module_scope,
            .char_freq = ast.char_freq orelse undefined,
            .exports_ref = ast.exports_ref,
            .module_ref = ast.module_ref,
            .wrapper_ref = ast.wrapper_ref,
            .require_ref = ast.require_ref,
            .top_level_await_keyword = ast.top_level_await_keyword,
            // These are used when bundling. They are filled in during the parser pass
            // since we already have to traverse the AST then anyway and the parser pass
            // is conveniently fully parallelized.
            .named_imports = ast.named_imports,
            .named_exports = ast.named_exports,
            .export_star_import_records = ast.export_star_import_records,

            // .allocator = ast.allocator,
            .top_level_symbols_to_parts = ast.top_level_symbols_to_parts,

            .commonjs_named_exports = ast.commonjs_named_exports,

            .redirect_import_record_index = ast.redirect_import_record_index orelse std.math.maxInt(u32),

            .target = ast.target,

            // .const_values = ast.const_values,
            .ts_enums = ast.ts_enums,

            .flags = .{
                .uses_exports_ref = ast.uses_exports_ref,
                .uses_module_ref = ast.uses_module_ref,
                // .uses_require_ref = ast.uses_require_ref,
                .uses_export_keyword = ast.export_keyword.len > 0,
                .has_char_freq = ast.char_freq != null,
                .force_cjs_to_esm = ast.force_cjs_to_esm,
                .has_lazy_export = ast.has_lazy_export,
                .commonjs_module_exports_assigned_deoptimized = ast.commonjs_module_exports_assigned_deoptimized,
                .has_explicit_use_strict_directive = strings.eqlComptime(ast.directive orelse "", "use strict"),
            },
        };
    }

    /// TODO: I don't like having to do this extra allocation. Is there a way to only do this if we know it is imported by a CSS file?
    pub fn addUrlForCss(
        this: *BundledAst,
        allocator: std.mem.Allocator,
        source: *const logger.Source,
        mime_type_: ?[]const u8,
        unique_key: ?[]const u8,
    ) void {
        {
            const mime_type = if (mime_type_) |m| m else MimeType.byExtension(bun.strings.trimLeadingChar(std.fs.path.extension(source.path.text), '.')).value;
            const contents = source.contents;
            // TODO: make this configurable
            const COPY_THRESHOLD = 128 * 1024; // 128kb
            const should_copy = contents.len >= COPY_THRESHOLD and unique_key != null;
            if (should_copy) return;
            this.url_for_css = url_for_css: {

                // Encode as base64
                const encode_len = bun.base64.encodeLen(contents);
                const data_url_prefix_len = "data:".len + mime_type.len + ";base64,".len;
                const total_buffer_len = data_url_prefix_len + encode_len;
                var encoded = allocator.alloc(u8, total_buffer_len) catch bun.outOfMemory();
                _ = std.fmt.bufPrint(encoded[0..data_url_prefix_len], "data:{s};base64,", .{mime_type}) catch unreachable;
                const len = bun.base64.encode(encoded[data_url_prefix_len..], contents);
                break :url_for_css encoded[0 .. data_url_prefix_len + len];
            };
        }
    }
};

pub const Span = struct {
    text: string = "",
    range: logger.Range = .{},
};

/// This is for TypeScript "enum" and "namespace" blocks. Each block can
/// potentially be instantiated multiple times. The exported members of each
/// block are merged into a single namespace while the non-exported code is
/// still scoped to just within that block:
///
///    let x = 1;
///    namespace Foo {
///      let x = 2;
///      export let y = 3;
///    }
///    namespace Foo {
///      console.log(x); // 1
///      console.log(y); // 3
///    }
///
/// Doing this also works inside an enum:
///
///    enum Foo {
///      A = 3,
///      B = A + 1,
///    }
///    enum Foo {
///      C = A + 2,
///    }
///    console.log(Foo.B) // 4
///    console.log(Foo.C) // 5
///
/// This is a form of identifier lookup that works differently than the
/// hierarchical scope-based identifier lookup in JavaScript. Lookup now needs
/// to search sibling scopes in addition to parent scopes. This is accomplished
/// by sharing the map of exported members between all matching sibling scopes.
pub const TSNamespaceScope = struct {
    /// This is specific to this namespace block. It's the argument of the
    /// immediately-invoked function expression that the namespace block is
    /// compiled into:
    ///
    ///   var ns;
    ///   (function (ns2) {
    ///     ns2.x = 123;
    ///   })(ns || (ns = {}));
    ///
    /// This variable is "ns2" in the above example. It's the symbol to use when
    /// generating property accesses off of this namespace when it's in scope.
    arg_ref: Ref,

    /// This is shared between all sibling namespace blocks
    exported_members: *TSNamespaceMemberMap,

    /// This is a lazily-generated map of identifiers that actually represent
    /// property accesses to this namespace's properties. For example:
    ///
    ///   namespace x {
    ///     export let y = 123
    ///   }
    ///   namespace x {
    ///     export let z = y
    ///   }
    ///
    /// This should be compiled into the following code:
    ///
    ///   var x;
    ///   (function(x2) {
    ///     x2.y = 123;
    ///   })(x || (x = {}));
    ///   (function(x3) {
    ///     x3.z = x3.y;
    ///   })(x || (x = {}));
    ///
    /// When we try to find the symbol "y", we instead return one of these lazily
    /// generated proxy symbols that represent the property access "x3.y". This
    /// map is unique per namespace block because "x3" is the argument symbol that
    /// is specific to that particular namespace block.
    property_accesses: bun.StringArrayHashMapUnmanaged(Ref) = .{},

    /// Even though enums are like namespaces and both enums and namespaces allow
    /// implicit references to properties of sibling scopes, they behave like
    /// separate, er, namespaces. Implicit references only work namespace-to-
    /// namespace and enum-to-enum. They do not work enum-to-namespace. And I'm
    /// not sure what's supposed to happen for the namespace-to-enum case because
    /// the compiler crashes: https://github.com/microsoft/TypeScript/issues/46891.
    /// So basically these both work:
    ///
    ///   enum a { b = 1 }
    ///   enum a { c = b }
    ///
    ///   namespace x { export let y = 1 }
    ///   namespace x { export let z = y }
    ///
    /// This doesn't work:
    ///
    ///   enum a { b = 1 }
    ///   namespace a { export let c = b }
    ///
    /// And this crashes the TypeScript compiler:
    ///
    ///   namespace a { export let b = 1 }
    ///   enum a { c = b }
    ///
    /// Therefore we only allow enum/enum and namespace/namespace interactions.
    is_enum_scope: bool,
};

pub const TSNamespaceMemberMap = bun.StringArrayHashMapUnmanaged(TSNamespaceMember);

pub const TSNamespaceMember = struct {
    loc: logger.Loc,
    data: Data,

    pub const Data = union(enum) {
        /// "namespace ns { export let it }"
        property,
        /// "namespace ns { export namespace it {} }"
        namespace: *TSNamespaceMemberMap,
        /// "enum ns { it }"
        enum_number: f64,
        /// "enum ns { it = 'it' }"
        enum_string: *E.String,
        /// "enum ns { it = something() }"
        enum_property: void,

        pub fn isEnum(data: Data) bool {
            return switch (data) {
                inline else => |_, tag| comptime std.mem.startsWith(u8, @tagName(tag), "enum_"),
            };
        }
    };
};

/// Inlined enum values can only be numbers and strings
/// This type special cases an encoding similar to JSValue, where nan-boxing is used
/// to encode both a 64-bit pointer or a 64-bit float using 64 bits.
pub const InlinedEnumValue = packed struct {
    raw_data: u64,

    pub const Decoded = union(enum) {
        string: *E.String,
        number: f64,
    };

    /// See JSCJSValue.h in WebKit for more details
    const double_encode_offset = 1 << 49;
    /// See PureNaN.h in WebKit for more details
    const pure_nan: f64 = @bitCast(@as(u64, 0x7ff8000000000000));

    fn purifyNaN(value: f64) f64 {
        return if (std.math.isNan(value)) pure_nan else value;
    }

    pub fn encode(decoded: Decoded) InlinedEnumValue {
        const encoded: InlinedEnumValue = .{ .raw_data = switch (decoded) {
            .string => |ptr| @as(u48, @truncate(@intFromPtr(ptr))),
            .number => |num| @as(u64, @bitCast(purifyNaN(num))) + double_encode_offset,
        } };
        if (Environment.allow_assert) {
            bun.assert(switch (encoded.decode()) {
                .string => |str| str == decoded.string,
                .number => |num| @as(u64, @bitCast(num)) ==
                    @as(u64, @bitCast(purifyNaN(decoded.number))),
            });
        }
        return encoded;
    }

    pub fn decode(encoded: InlinedEnumValue) Decoded {
        if (encoded.raw_data > 0x0000FFFFFFFFFFFF) {
            return .{ .number = @bitCast(encoded.raw_data - double_encode_offset) };
        } else {
            return .{ .string = @ptrFromInt(encoded.raw_data) };
        }
    }
};

pub const ExportsKind = enum {
    // This file doesn't have any kind of export, so it's impossible to say what
    // kind of file this is. An empty file is in this category, for example.
    none,

    // The exports are stored on "module" and/or "exports". Calling "require()"
    // on this module returns "module.exports". All imports to this module are
    // allowed but may return undefined.
    cjs,

    // All export names are known explicitly. Calling "require()" on this module
    // generates an exports object (stored in "exports") with getters for the
    // export names. Named imports to this module are only allowed if they are
    // in the set of export names.
    esm,

    // Some export names are known explicitly, but others fall back to a dynamic
    // run-time object. This is necessary when using the "export * from" syntax
    // with either a CommonJS module or an external module (i.e. a module whose
    // export names are not known at compile-time).
    //
    // Calling "require()" on this module generates an exports object (stored in
    // "exports") with getters for the export names. All named imports to this
    // module are allowed. Direct named imports reference the corresponding export
    // directly. Other imports go through property accesses on "exports".
    esm_with_dynamic_fallback,

    // Like "esm_with_dynamic_fallback", but the module was originally a CommonJS
    // module.
    esm_with_dynamic_fallback_from_cjs,

    const dynamic = std.EnumSet(ExportsKind).init(.{
        .esm_with_dynamic_fallback = true,
        .esm_with_dynamic_fallback_from_cjs = true,
        .cjs = true,
    });

    const with_dynamic_fallback = std.EnumSet(ExportsKind).init(.{
        .esm_with_dynamic_fallback = true,
        .esm_with_dynamic_fallback_from_cjs = true,
    });

    pub fn isDynamic(self: ExportsKind) bool {
        return dynamic.contains(self);
    }

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }

    pub fn isESMWithDynamicFallback(self: ExportsKind) bool {
        return with_dynamic_fallback.contains(self);
    }
};

pub const DeclaredSymbol = struct {
    ref: Ref,
    is_top_level: bool = false,

    pub const List = struct {
        entries: bun.MultiArrayList(DeclaredSymbol) = .{},

        pub fn refs(this: *const List) []Ref {
            return this.entries.items(.ref);
        }

        pub fn toOwnedSlice(this: *List) List {
            const new = this.*;

            this.* = .{};
            return new;
        }

        pub fn clone(this: *const List, allocator: std.mem.Allocator) !List {
            return List{ .entries = try this.entries.clone(allocator) };
        }

        pub inline fn len(this: List) usize {
            return this.entries.len;
        }

        pub fn append(this: *List, allocator: std.mem.Allocator, entry: DeclaredSymbol) !void {
            try this.ensureUnusedCapacity(allocator, 1);
            this.appendAssumeCapacity(entry);
        }

        pub fn appendList(this: *List, allocator: std.mem.Allocator, other: List) !void {
            try this.ensureUnusedCapacity(allocator, other.len());
            this.appendListAssumeCapacity(other);
        }

        pub fn appendListAssumeCapacity(this: *List, other: List) void {
            this.entries.appendListAssumeCapacity(other.entries);
        }

        pub fn appendAssumeCapacity(this: *List, entry: DeclaredSymbol) void {
            this.entries.appendAssumeCapacity(entry);
        }

        pub fn ensureTotalCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
            try this.entries.ensureTotalCapacity(allocator, count);
        }

        pub fn ensureUnusedCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
            try this.entries.ensureUnusedCapacity(allocator, count);
        }

        pub fn clearRetainingCapacity(this: *List) void {
            this.entries.clearRetainingCapacity();
        }

        pub fn deinit(this: *List, allocator: std.mem.Allocator) void {
            this.entries.deinit(allocator);
        }

        pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !List {
            var entries = bun.MultiArrayList(DeclaredSymbol){};
            try entries.ensureUnusedCapacity(allocator, capacity);
            return List{ .entries = entries };
        }

        pub fn fromSlice(allocator: std.mem.Allocator, entries: []const DeclaredSymbol) !List {
            var this = try List.initCapacity(allocator, entries.len);
            errdefer this.deinit(allocator);
            for (entries) |entry| {
                this.appendAssumeCapacity(entry);
            }

            return this;
        }
    };

    fn forEachTopLevelSymbolWithType(decls: *List, comptime Ctx: type, ctx: Ctx, comptime Fn: fn (Ctx, Ref) void) void {
        var entries = decls.entries.slice();
        const is_top_level = entries.items(.is_top_level);
        const refs = entries.items(.ref);

        // TODO: SIMD
        for (is_top_level, refs) |top, ref| {
            if (top) {
                @call(bun.callmod_inline, Fn, .{ ctx, ref });
            }
        }
    }

    pub fn forEachTopLevelSymbol(decls: *List, ctx: anytype, comptime Fn: anytype) void {
        forEachTopLevelSymbolWithType(decls, @TypeOf(ctx), ctx, Fn);
    }
};

pub const Dependency = struct {
    source_index: Index = Index.invalid,
    part_index: Index.Int = 0,

    pub const List = BabyList(Dependency);
};

pub const ExprList = std.ArrayList(Expr);
pub const StmtList = std.ArrayList(Stmt);
pub const BindingList = std.ArrayList(Binding);

// Each file is made up of multiple parts, and each part consists of one or
// more top-level statements. Parts are used for tree shaking and code
// splitting analysis. Individual parts of a file can be discarded by tree
// shaking and can be assigned to separate chunks (i.e. output files) by code
// splitting.
pub const Part = struct {
    pub const ImportRecordIndices = BabyList(u32);
    pub const List = BabyList(Part);

    stmts: []Stmt = &([_]Stmt{}),
    scopes: []*Scope = &([_]*Scope{}),

    /// Each is an index into the file-level import record list
    import_record_indices: ImportRecordIndices = .{},

    /// All symbols that are declared in this part. Note that a given symbol may
    /// have multiple declarations, and so may end up being declared in multiple
    /// parts (e.g. multiple "var" declarations with the same name). Also note
    /// that this list isn't deduplicated and may contain duplicates.
    declared_symbols: DeclaredSymbol.List = .{},

    /// An estimate of the number of uses of all symbols used within this part.
    symbol_uses: SymbolUseMap = .{},

    /// This tracks property accesses off of imported symbols. We don't know
    /// during parsing if an imported symbol is going to be an inlined enum
    /// value or not. This is only known during linking. So we defer adding
    /// a dependency on these imported symbols until we know whether the
    /// property access is an inlined enum value or not.
    import_symbol_property_uses: SymbolPropertyUseMap = .{},

    /// The indices of the other parts in this file that are needed if this part
    /// is needed.
    dependencies: Dependency.List = .{},

    /// If true, this part can be removed if none of the declared symbols are
    /// used. If the file containing this part is imported, then all parts that
    /// don't have this flag enabled must be included.
    can_be_removed_if_unused: bool = false,

    /// This is used for generated parts that we don't want to be present if they
    /// aren't needed. This enables tree shaking for these parts even if global
    /// tree shaking isn't enabled.
    force_tree_shaking: bool = false,

    /// This is true if this file has been marked as live by the tree shaking
    /// algorithm.
    is_live: bool = false,

    tag: Tag = Tag.none,

    pub const Tag = enum {
        none,
        jsx_import,
        runtime,
        cjs_imports,
        react_fast_refresh,
        dirname_filename,
        bun_test,
        dead_due_to_inlining,
        commonjs_named_export,
        import_to_convert_from_require,
    };

    pub const SymbolUseMap = std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false);
    pub const SymbolPropertyUseMap = std.ArrayHashMapUnmanaged(Ref, bun.StringHashMapUnmanaged(Symbol.Use), RefHashCtx, false);

    pub fn jsonStringify(self: *const Part, writer: anytype) !void {
        return writer.write(self.stmts);
    }
};

pub const Result = union(enum) {
    already_bundled: AlreadyBundled,
    cached: void,
    ast: Ast,

    pub const AlreadyBundled = enum {
        bun,
        bun_cjs,
        bytecode,
        bytecode_cjs,
    };
};

pub const StmtOrExpr = union(enum) {
    stmt: Stmt,
    expr: Expr,

    pub fn toExpr(stmt_or_expr: StmtOrExpr) Expr {
        return switch (stmt_or_expr) {
            .expr => |expr| expr,
            .stmt => |stmt| switch (stmt.data) {
                .s_function => |s| Expr.init(E.Function, .{ .func = s.func }, stmt.loc),
                .s_class => |s| Expr.init(E.Class, s.class, stmt.loc),
                else => Output.panic("Unexpected statement type in default export: .{s}", .{@tagName(stmt.data)}),
            },
        };
    }
};

pub const NamedImport = struct {
    // Parts within this file that use this import
    local_parts_with_uses: BabyList(u32) = BabyList(u32){},

    alias: ?string,
    alias_loc: ?logger.Loc = null,
    namespace_ref: ?Ref,
    import_record_index: u32,

    // If true, the alias refers to the entire export namespace object of a
    // module. This is no longer represented as an alias called "*" because of
    // the upcoming "Arbitrary module namespace identifier names" feature:
    // https://github.com/tc39/ecma262/pull/2154
    alias_is_star: bool = false,

    // It's useful to flag exported imports because if they are in a TypeScript
    // file, we can't tell if they are a type or a value.
    is_exported: bool = false,
};

pub const NamedExport = struct {
    ref: Ref,
    alias_loc: logger.Loc,
};

pub const StrictModeKind = enum(u4) {
    sloppy_mode,
    explicit_strict_mode,
    implicit_strict_mode_import,
    implicit_strict_mode_export,
    implicit_strict_mode_top_level_await,
    implicit_strict_mode_class,
    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};

pub const Scope = struct {
    pub const MemberHashMap = bun.StringHashMapUnmanaged(Member);

    id: usize = 0,
    kind: Kind = Kind.block,
    parent: ?*Scope = null,
    children: BabyList(*Scope) = .{},
    members: MemberHashMap = .{},
    generated: BabyList(Ref) = .{},

    // This is used to store the ref of the label symbol for ScopeLabel scopes.
    label_ref: ?Ref = null,
    label_stmt_is_loop: bool = false,

    // If a scope contains a direct eval() expression, then none of the symbols
    // inside that scope can be renamed. We conservatively assume that the
    // evaluated code might reference anything that it has access to.
    contains_direct_eval: bool = false,

    // This is to help forbid "arguments" inside class body scopes
    forbid_arguments: bool = false,

    strict_mode: StrictModeKind = StrictModeKind.sloppy_mode,

    is_after_const_local_prefix: bool = false,

    // This will be non-null if this is a TypeScript "namespace" or "enum"
    ts_namespace: ?*TSNamespaceScope = null,

    pub const NestedScopeMap = std.AutoArrayHashMap(u32, bun.BabyList(*Scope));

    pub fn getMemberHash(name: []const u8) u64 {
        return bun.StringHashMapContext.hash(.{}, name);
    }

    pub fn getMemberWithHash(this: *const Scope, name: []const u8, hash_value: u64) ?Member {
        const hashed = bun.StringHashMapContext.Prehashed{
            .value = hash_value,
            .input = name,
        };
        return this.members.getAdapted(name, hashed);
    }

    pub fn getOrPutMemberWithHash(
        this: *Scope,
        allocator: std.mem.Allocator,
        name: []const u8,
        hash_value: u64,
    ) !MemberHashMap.GetOrPutResult {
        const hashed = bun.StringHashMapContext.Prehashed{
            .value = hash_value,
            .input = name,
        };
        return this.members.getOrPutContextAdapted(allocator, name, hashed, .{});
    }

    pub fn reset(this: *Scope) void {
        this.children.clearRetainingCapacity();
        this.generated.clearRetainingCapacity();
        this.members.clearRetainingCapacity();
        this.parent = null;
        this.id = 0;
        this.label_ref = null;
        this.label_stmt_is_loop = false;
        this.contains_direct_eval = false;
        this.strict_mode = .sloppy_mode;
        this.kind = .block;
    }

    // Do not make this a packed struct
    // Two hours of debugging time lost to that.
    // It causes a crash due to undefined memory
    pub const Member = struct {
        ref: Ref,
        loc: logger.Loc,

        pub fn eql(a: Member, b: Member) bool {
            return @call(bun.callmod_inline, Ref.eql, .{ a.ref, b.ref }) and a.loc.start == b.loc.start;
        }
    };

    pub const SymbolMergeResult = enum {
        forbidden,
        replace_with_new,
        overwrite_with_new,
        keep_existing,
        become_private_get_set_pair,
        become_private_static_get_set_pair,
    };

    pub fn canMergeSymbols(
        scope: *Scope,
        existing: Symbol.Kind,
        new: Symbol.Kind,
        comptime is_typescript_enabled: bool,
    ) SymbolMergeResult {
        if (existing == .unbound) {
            return .replace_with_new;
        }

        if (comptime is_typescript_enabled) {
            // In TypeScript, imports are allowed to silently collide with symbols within
            // the module. Presumably this is because the imports may be type-only:
            //
            //   import {Foo} from 'bar'
            //   class Foo {}
            //
            if (existing == .import) {
                return .replace_with_new;
            }

            // "enum Foo {} enum Foo {}"
            // "namespace Foo { ... } enum Foo {}"
            if (new == .ts_enum and (existing == .ts_enum or existing == .ts_namespace)) {
                return .replace_with_new;
            }

            // "namespace Foo { ... } namespace Foo { ... }"
            // "function Foo() {} namespace Foo { ... }"
            // "enum Foo {} namespace Foo { ... }"
            if (new == .ts_namespace) {
                switch (existing) {
                    .ts_namespace,
                    .ts_enum,
                    .hoisted_function,
                    .generator_or_async_function,
                    .class,
                    => return .keep_existing,
                    else => {},
                }
            }
        }

        // "var foo; var foo;"
        // "var foo; function foo() {}"
        // "function foo() {} var foo;"
        // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
        if (Symbol.isKindHoistedOrFunction(new) and
            Symbol.isKindHoistedOrFunction(existing) and
            (scope.kind == .entry or scope.kind == .function_body or scope.kind == .function_args or
            (new == existing and Symbol.isKindHoisted(existing))))
        {
            return .replace_with_new;
        }

        // "get #foo() {} set #foo() {}"
        // "set #foo() {} get #foo() {}"
        if ((existing == .private_get and new == .private_set) or
            (existing == .private_set and new == .private_get))
        {
            return .become_private_get_set_pair;
        }
        if ((existing == .private_static_get and new == .private_static_set) or
            (existing == .private_static_set and new == .private_static_get))
        {
            return .become_private_static_get_set_pair;
        }

        // "try {} catch (e) { var e }"
        if (existing == .catch_identifier and new == .hoisted) {
            return .replace_with_new;
        }

        // "function() { var arguments }"
        if (existing == .arguments and new == .hoisted) {
            return .keep_existing;
        }

        // "function() { let arguments }"
        if (existing == .arguments and new != .hoisted) {
            return .overwrite_with_new;
        }

        return .forbidden;
    }

    pub const Kind = enum(u8) {
        block,
        with,
        label,
        class_name,
        class_body,
        catch_binding,

        // The scopes below stop hoisted variables from extending into parent scopes
        entry, // This is a module, TypeScript enum, or TypeScript namespace
        function_args,
        function_body,
        class_static_init,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub fn recursiveSetStrictMode(s: *Scope, kind: StrictModeKind) void {
        if (s.strict_mode == .sloppy_mode) {
            s.strict_mode = kind;
            for (s.children.slice()) |child| {
                child.recursiveSetStrictMode(kind);
            }
        }
    }

    pub inline fn kindStopsHoisting(s: *const Scope) bool {
        return @intFromEnum(s.kind) >= @intFromEnum(Kind.entry);
    }
};

pub fn printmem(comptime format: string, args: anytype) void {
    defer Output.flush();
    Output.initTest();
    Output.print(format, args);
}

pub const Macro = struct {
    const JavaScript = bun.JSC;
    const JSCBase = @import("./bun.js/base.zig");
    const Resolver = @import("./resolver/resolver.zig").Resolver;
    const isPackagePath = @import("./resolver/resolver.zig").isPackagePath;
    const ResolveResult = @import("./resolver/resolver.zig").Result;
    const DotEnv = @import("./env_loader.zig");
    const js = @import("./bun.js/javascript_core_c_api.zig");
    const Zig = @import("./bun.js/bindings/exports.zig");
    const Transpiler = bun.Transpiler;
    const MacroEntryPoint = bun.transpiler.MacroEntryPoint;
    const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
    pub const MacroRemapEntry = @import("./resolver/package_json.zig").MacroImportReplacementMap;

    pub const namespace: string = "macro";
    pub const namespaceWithColon: string = namespace ++ ":";

    pub fn isMacroPath(str: string) bool {
        return strings.hasPrefixComptime(str, namespaceWithColon);
    }

    pub const MacroContext = struct {
        pub const MacroMap = std.AutoArrayHashMap(i32, Macro);

        resolver: *Resolver,
        env: *DotEnv.Loader,
        macros: MacroMap,
        remap: MacroRemap,
        javascript_object: JSC.JSValue = JSC.JSValue.zero,

        pub fn getRemap(this: MacroContext, path: string) ?MacroRemapEntry {
            if (this.remap.entries.len == 0) return null;
            return this.remap.get(path);
        }

        pub fn init(transpiler: *Transpiler) MacroContext {
            return MacroContext{
                .macros = MacroMap.init(default_allocator),
                .resolver = &transpiler.resolver,
                .env = transpiler.env,
                .remap = transpiler.options.macro_remap,
            };
        }

        pub fn call(
            this: *MacroContext,
            import_record_path: string,
            source_dir: string,
            log: *logger.Log,
            source: *const logger.Source,
            import_range: logger.Range,
            caller: Expr,
            function_name: string,
        ) anyerror!Expr {
            Expr.Data.Store.disable_reset = true;
            Stmt.Data.Store.disable_reset = true;
            defer Expr.Data.Store.disable_reset = false;
            defer Stmt.Data.Store.disable_reset = false;
            // const is_package_path = isPackagePath(specifier);
            const import_record_path_without_macro_prefix = if (isMacroPath(import_record_path))
                import_record_path[namespaceWithColon.len..]
            else
                import_record_path;

            bun.assert(!isMacroPath(import_record_path_without_macro_prefix));

            const input_specifier = brk: {
                if (JSC.HardcodedModule.Aliases.get(import_record_path, .bun)) |replacement| {
                    break :brk replacement.path;
                }

                const resolve_result = this.resolver.resolve(source_dir, import_record_path_without_macro_prefix, .stmt) catch |err| {
                    switch (err) {
                        error.ModuleNotFound => {
                            log.addResolveError(
                                source,
                                import_range,
                                log.msgs.allocator,
                                "Macro \"{s}\" not found",
                                .{import_record_path},
                                .stmt,
                                err,
                            ) catch unreachable;
                            return error.MacroNotFound;
                        },
                        else => {
                            log.addRangeErrorFmt(
                                source,
                                import_range,
                                log.msgs.allocator,
                                "{s} resolving macro \"{s}\"",
                                .{ @errorName(err), import_record_path },
                            ) catch unreachable;
                            return err;
                        },
                    }
                };
                break :brk resolve_result.path_pair.primary.text;
            };

            var specifier_buf: [64]u8 = undefined;
            var specifier_buf_len: u32 = 0;
            const hash = MacroEntryPoint.generateID(
                input_specifier,
                function_name,
                &specifier_buf,
                &specifier_buf_len,
            );

            const macro_entry = this.macros.getOrPut(hash) catch unreachable;
            if (!macro_entry.found_existing) {
                macro_entry.value_ptr.* = Macro.init(
                    default_allocator,
                    this.resolver,
                    input_specifier,
                    log,
                    this.env,
                    function_name,
                    specifier_buf[0..specifier_buf_len],
                    hash,
                ) catch |err| {
                    macro_entry.value_ptr.* = Macro{ .resolver = undefined, .disabled = true };
                    return err;
                };
                Output.flush();
            }
            defer Output.flush();

            const macro = macro_entry.value_ptr.*;
            if (macro.disabled) {
                return caller;
            }
            macro.vm.enableMacroMode();
            defer macro.vm.disableMacroMode();

            const Wrapper = struct {
                args: std.meta.ArgsTuple(@TypeOf(Macro.Runner.run)),
                ret: Runner.MacroError!Expr,

                pub fn call(self: *@This()) void {
                    self.ret = @call(.auto, Macro.Runner.run, self.args);
                }
            };
            var wrapper = Wrapper{
                .args = .{
                    macro,
                    log,
                    default_allocator,
                    function_name,
                    caller,
                    source,
                    hash,
                    this.javascript_object,
                },
                .ret = undefined,
            };

            macro.vm.runWithAPILock(Wrapper, &wrapper, Wrapper.call);
            return try wrapper.ret;
            // this.macros.getOrPut(key: K)
        }
    };

    pub const MacroResult = struct {
        import_statements: []S.Import = &[_]S.Import{},
        replacement: Expr,
    };

    resolver: *Resolver,
    vm: *JavaScript.VirtualMachine = undefined,

    resolved: ResolveResult = undefined,
    disabled: bool = false,

    pub fn init(
        _: std.mem.Allocator,
        resolver: *Resolver,
        input_specifier: []const u8,
        log: *logger.Log,
        env: *DotEnv.Loader,
        function_name: string,
        specifier: string,
        hash: i32,
    ) !Macro {
        var vm: *JavaScript.VirtualMachine = if (JavaScript.VirtualMachine.isLoaded())
            JavaScript.VirtualMachine.get()
        else brk: {
            const old_transform_options = resolver.opts.transform_options;
            defer resolver.opts.transform_options = old_transform_options;

            // JSC needs to be initialized if building from CLI
            JSC.initialize(false);

            var _vm = try JavaScript.VirtualMachine.init(.{
                .allocator = default_allocator,
                .args = resolver.opts.transform_options,
                .log = log,
                .is_main_thread = false,
                .env_loader = env,
            });

            _vm.enableMacroMode();
            _vm.eventLoop().ensureWaker();

            try _vm.transpiler.configureDefines();
            break :brk _vm;
        };

        vm.enableMacroMode();

        const loaded_result = try vm.loadMacroEntryPoint(input_specifier, function_name, specifier, hash);

        switch (loaded_result.unwrap(vm.jsc, .leave_unhandled)) {
            .rejected => |result| {
                _ = vm.unhandledRejection(vm.global, result, loaded_result.asValue());
                vm.disableMacroMode();
                return error.MacroLoadError;
            },
            else => {},
        }

        return Macro{
            .vm = vm,
            .resolver = resolver,
        };
    }

    pub const Runner = struct {
        const VisitMap = std.AutoHashMapUnmanaged(JSC.JSValue, Expr);

        threadlocal var args_buf: [3]js.JSObjectRef = undefined;
        threadlocal var exception_holder: Zig.ZigException.Holder = undefined;
        pub const MacroError = error{ MacroFailed, OutOfMemory } || ToJSError || bun.JSError;

        pub const Run = struct {
            caller: Expr,
            function_name: string,
            macro: *const Macro,
            global: *JSC.JSGlobalObject,
            allocator: std.mem.Allocator,
            id: i32,
            log: *logger.Log,
            source: *const logger.Source,
            visited: VisitMap = VisitMap{},
            is_top_level: bool = false,

            pub fn runAsync(
                macro: Macro,
                log: *logger.Log,
                allocator: std.mem.Allocator,
                function_name: string,
                caller: Expr,
                args: []JSC.JSValue,
                source: *const logger.Source,
                id: i32,
            ) MacroError!Expr {
                const macro_callback = macro.vm.macros.get(id) orelse return caller;

                const result = js.JSObjectCallAsFunctionReturnValueHoldingAPILock(
                    macro.vm.global,
                    macro_callback,
                    null,
                    args.len,
                    @as([*]js.JSObjectRef, @ptrCast(args.ptr)),
                );

                var runner = Run{
                    .caller = caller,
                    .function_name = function_name,
                    .macro = &macro,
                    .allocator = allocator,
                    .global = macro.vm.global,
                    .id = id,
                    .log = log,
                    .source = source,
                    .visited = VisitMap{},
                };

                defer runner.visited.deinit(allocator);

                return try runner.run(
                    result,
                );
            }

            pub fn run(
                this: *Run,
                value: JSC.JSValue,
            ) MacroError!Expr {
                return try switch (JSC.ConsoleObject.Formatter.Tag.get(value, this.global).tag) {
                    .Error => this.coerce(value, .Error),
                    .Undefined => this.coerce(value, .Undefined),
                    .Null => this.coerce(value, .Null),
                    .Private => this.coerce(value, .Private),
                    .Boolean => this.coerce(value, .Boolean),
                    .Array => this.coerce(value, .Array),
                    .Object => this.coerce(value, .Object),
                    .toJSON, .JSON => this.coerce(value, .JSON),
                    .Integer => this.coerce(value, .Integer),
                    .Double => this.coerce(value, .Double),
                    .String => this.coerce(value, .String),
                    .Promise => this.coerce(value, .Promise),
                    else => brk: {
                        const name = value.getClassInfoName() orelse "unknown";

                        this.log.addErrorFmt(
                            this.source,
                            this.caller.loc,
                            this.allocator,
                            "cannot coerce {s} ({s}) to Bun's AST. Please return a simpler type",
                            .{ name, @tagName(value.jsType()) },
                        ) catch unreachable;
                        break :brk error.MacroFailed;
                    },
                };
            }

            pub fn coerce(
                this: *Run,
                value: JSC.JSValue,
                comptime tag: JSC.ConsoleObject.Formatter.Tag,
            ) MacroError!Expr {
                switch (comptime tag) {
                    .Error => {
                        _ = this.macro.vm.uncaughtException(this.global, value, false);
                        return this.caller;
                    },
                    .Undefined => if (this.is_top_level)
                        return this.caller
                    else
                        return Expr.init(E.Undefined, E.Undefined{}, this.caller.loc),
                    .Null => return Expr.init(E.Null, E.Null{}, this.caller.loc),
                    .Private => {
                        this.is_top_level = false;
                        const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                        if (_entry.found_existing) {
                            return _entry.value_ptr.*;
                        }

                        var blob_: ?JSC.WebCore.Blob = null;
                        const mime_type: ?MimeType = null;

                        if (value.jsType() == .DOMWrapper) {
                            if (value.as(JSC.WebCore.Response)) |resp| {
                                return this.run(resp.getBlobWithoutCallFrame(this.global));
                            } else if (value.as(JSC.WebCore.Request)) |resp| {
                                return this.run(resp.getBlobWithoutCallFrame(this.global));
                            } else if (value.as(JSC.WebCore.Blob)) |resp| {
                                blob_ = resp.*;
                                blob_.?.allocator = null;
                            } else if (value.as(JSC.ResolveMessage) != null or value.as(JSC.BuildMessage) != null) {
                                _ = this.macro.vm.uncaughtException(this.global, value, false);
                                return error.MacroFailed;
                            }
                        }

                        if (blob_) |*blob| {
                            const out_expr = Expr.fromBlob(
                                blob,
                                this.allocator,
                                mime_type,
                                this.log,
                                this.caller.loc,
                            ) catch {
                                blob.deinit();
                                return error.MacroFailed;
                            };
                            if (out_expr.data == .e_string) {
                                blob.deinit();
                            }

                            return out_expr;
                        }

                        return Expr.init(E.String, E.String.empty, this.caller.loc);
                    },

                    .Boolean => {
                        return Expr{ .data = .{ .e_boolean = .{ .value = value.toBoolean() } }, .loc = this.caller.loc };
                    },
                    JSC.ConsoleObject.Formatter.Tag.Array => {
                        this.is_top_level = false;

                        const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                        if (_entry.found_existing) {
                            switch (_entry.value_ptr.*.data) {
                                .e_object, .e_array => {
                                    this.log.addErrorFmt(this.source, this.caller.loc, this.allocator, "converting circular structure to Bun AST is not implemented yet", .{}) catch unreachable;
                                    return error.MacroFailed;
                                },
                                else => {},
                            }
                            return _entry.value_ptr.*;
                        }

                        var iter = JSC.JSArrayIterator.init(value, this.global);
                        if (iter.len == 0) {
                            const result = Expr.init(
                                E.Array,
                                E.Array{
                                    .items = ExprNodeList.init(&[_]Expr{}),
                                    .was_originally_macro = true,
                                },
                                this.caller.loc,
                            );
                            _entry.value_ptr.* = result;
                            return result;
                        }
                        var array = this.allocator.alloc(Expr, iter.len) catch unreachable;
                        var out = Expr.init(
                            E.Array,
                            E.Array{
                                .items = ExprNodeList.init(array[0..0]),
                                .was_originally_macro = true,
                            },
                            this.caller.loc,
                        );
                        _entry.value_ptr.* = out;

                        errdefer this.allocator.free(array);
                        var i: usize = 0;
                        while (iter.next()) |item| {
                            array[i] = try this.run(item);
                            if (array[i].isMissing())
                                continue;
                            i += 1;
                        }
                        out.data.e_array.items = ExprNodeList.init(array);
                        _entry.value_ptr.* = out;
                        return out;
                    },
                    // TODO: optimize this
                    JSC.ConsoleObject.Formatter.Tag.Object => {
                        this.is_top_level = false;
                        const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                        if (_entry.found_existing) {
                            switch (_entry.value_ptr.*.data) {
                                .e_object, .e_array => {
                                    this.log.addErrorFmt(this.source, this.caller.loc, this.allocator, "converting circular structure to Bun AST is not implemented yet", .{}) catch unreachable;
                                    return error.MacroFailed;
                                },
                                else => {},
                            }
                            return _entry.value_ptr.*;
                        }

                        var object_iter = try JSC.JSPropertyIterator(.{
                            .skip_empty_name = false,
                            .include_value = true,
                        }).init(this.global, value);
                        defer object_iter.deinit();
                        var properties = this.allocator.alloc(G.Property, object_iter.len) catch unreachable;
                        errdefer this.allocator.free(properties);
                        var out = Expr.init(
                            E.Object,
                            E.Object{
                                .properties = BabyList(G.Property).init(properties),
                                .was_originally_macro = true,
                            },
                            this.caller.loc,
                        );
                        _entry.value_ptr.* = out;

                        while (try object_iter.next()) |prop| {
                            properties[object_iter.i] = G.Property{
                                .key = Expr.init(E.String, E.String.init(prop.toOwnedSlice(this.allocator) catch unreachable), this.caller.loc),
                                .value = try this.run(object_iter.value),
                            };
                        }
                        out.data.e_object.properties = BabyList(G.Property).init(properties[0..object_iter.i]);
                        _entry.value_ptr.* = out;
                        return out;
                    },

                    .JSON => {
                        this.is_top_level = false;
                        // if (console_tag.cell == .JSDate) {
                        //     // in the code for printing dates, it never exceeds this amount
                        //     var iso_string_buf = this.allocator.alloc(u8, 36) catch unreachable;
                        //     var str = JSC.ZigString.init("");
                        //     value.jsonStringify(this.global, 0, &str);
                        //     var out_buf: []const u8 = std.fmt.bufPrint(iso_string_buf, "{}", .{str}) catch "";
                        //     if (out_buf.len > 2) {
                        //         // trim the quotes
                        //         out_buf = out_buf[1 .. out_buf.len - 1];
                        //     }
                        //     return Expr.init(E.New, E.New{.target = Expr.init(E.Dot{.target = E}) })
                        // }
                    },

                    .Integer => {
                        return Expr.init(E.Number, E.Number{ .value = @as(f64, @floatFromInt(value.toInt32())) }, this.caller.loc);
                    },
                    .Double => {
                        return Expr.init(E.Number, E.Number{ .value = value.asNumber() }, this.caller.loc);
                    },
                    .String => {
                        var bun_str = value.toBunString(this.global);
                        defer bun_str.deref();

                        // encode into utf16 so the printer escapes the string correctly
                        var utf16_bytes = this.allocator.alloc(u16, bun_str.length()) catch unreachable;
                        const out_slice = utf16_bytes[0 .. (bun_str.encodeInto(std.mem.sliceAsBytes(utf16_bytes), .utf16le) catch 0) / 2];
                        return Expr.init(E.String, E.String.init(out_slice), this.caller.loc);
                    },
                    .Promise => {
                        const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                        if (_entry.found_existing) {
                            return _entry.value_ptr.*;
                        }

                        const promise = value.asAnyPromise() orelse @panic("Unexpected promise type");

                        this.macro.vm.waitForPromise(promise);

                        const promise_result = promise.result(this.macro.vm.jsc);
                        const rejected = promise.status(this.macro.vm.jsc) == .rejected;

                        if (promise_result.isUndefined() and this.is_top_level) {
                            this.is_top_level = false;
                            return this.caller;
                        }

                        if (rejected or promise_result.isError() or promise_result.isAggregateError(this.global) or promise_result.isException(this.global.vm())) {
                            _ = this.macro.vm.unhandledRejection(this.global, promise_result, promise.asValue(this.global));
                            return error.MacroFailed;
                        }
                        this.is_top_level = false;
                        const result = try this.run(promise_result);

                        _entry.value_ptr.* = result;
                        return result;
                    },
                    else => {},
                }

                this.log.addErrorFmt(
                    this.source,
                    this.caller.loc,
                    this.allocator,
                    "cannot coerce {s} to Bun's AST. Please return a simpler type",
                    .{@tagName(value.jsType())},
                ) catch unreachable;
                return error.MacroFailed;
            }
        };

        pub fn run(
            macro: Macro,
            log: *logger.Log,
            allocator: std.mem.Allocator,
            function_name: string,
            caller: Expr,
            source: *const logger.Source,
            id: i32,
            javascript_object: JSC.JSValue,
        ) MacroError!Expr {
            if (comptime Environment.isDebug) Output.prettyln("<r><d>[macro]<r> call <d><b>{s}<r>", .{function_name});

            exception_holder = Zig.ZigException.Holder.init();
            var js_args: []JSC.JSValue = &.{};
            var js_processed_args_len: usize = 0;
            defer {
                for (js_args[0..js_processed_args_len -| @as(usize, @intFromBool(javascript_object != .zero))]) |arg| {
                    arg.unprotect();
                }

                allocator.free(js_args);
            }

            const globalObject = JSC.VirtualMachine.get().global;

            switch (caller.data) {
                .e_call => |call| {
                    const call_args: []Expr = call.args.slice();
                    js_args = try allocator.alloc(JSC.JSValue, call_args.len + @as(usize, @intFromBool(javascript_object != .zero)));
                    js_processed_args_len = js_args.len;

                    for (0.., call_args, js_args[0..call_args.len]) |i, in, *out| {
                        const value = in.toJS(
                            allocator,
                            globalObject,
                        ) catch |e| {
                            // Keeping a separate variable instead of modifying js_args.len
                            // due to allocator.free call in defer
                            js_processed_args_len = i;
                            return e;
                        };
                        value.protect();
                        out.* = value;
                    }
                },
                .e_template => {
                    @panic("TODO: support template literals in macros");
                },
                else => {
                    @panic("Unexpected caller type");
                },
            }

            if (javascript_object != .zero) {
                if (js_args.len == 0) {
                    js_args = try allocator.alloc(JSC.JSValue, 1);
                }

                js_args[js_args.len - 1] = javascript_object;
            }

            const CallFunction = @TypeOf(Run.runAsync);
            const CallArgs = std.meta.ArgsTuple(CallFunction);
            const CallData = struct {
                threadlocal var call_args: CallArgs = undefined;
                threadlocal var result: MacroError!Expr = undefined;
                pub fn callWrapper(args: CallArgs) MacroError!Expr {
                    JSC.markBinding(@src());
                    call_args = args;
                    Bun__startMacro(&call, JSC.VirtualMachine.get().global);
                    return result;
                }

                pub fn call() callconv(.C) void {
                    const call_args_copy = call_args;
                    const local_result = @call(.auto, Run.runAsync, call_args_copy);
                    result = local_result;
                }
            };

            // TODO: can change back to `return CallData.callWrapper(.{`
            // when https://github.com/ziglang/zig/issues/16242 is fixed
            return CallData.callWrapper(CallArgs{
                macro,
                log,
                allocator,
                function_name,
                caller,
                js_args,
                source,
                id,
            });
        }

        extern "C" fn Bun__startMacro(function: *const anyopaque, *anyopaque) void;
    };
};

pub const ASTMemoryAllocator = struct {
    const SFA = std.heap.StackFallbackAllocator(@min(8192, std.mem.page_size));

    stack_allocator: SFA = undefined,
    bump_allocator: std.mem.Allocator = undefined,
    allocator: std.mem.Allocator,
    previous: ?*ASTMemoryAllocator = null,

    pub fn reset(this: *ASTMemoryAllocator) void {
        this.stack_allocator = SFA{
            .buffer = undefined,
            .fallback_allocator = this.allocator,
            .fixed_buffer_allocator = undefined,
        };
        this.bump_allocator = this.stack_allocator.get();
    }

    pub fn push(this: *ASTMemoryAllocator) void {
        Stmt.Data.Store.memory_allocator = this;
        Expr.Data.Store.memory_allocator = this;
    }

    pub fn pop(this: *ASTMemoryAllocator) void {
        const prev = this.previous;
        bun.assert(prev != this);
        Stmt.Data.Store.memory_allocator = prev;
        Expr.Data.Store.memory_allocator = prev;
        this.previous = null;
    }

    pub fn append(this: ASTMemoryAllocator, comptime ValueType: type, value: anytype) *ValueType {
        const ptr = this.bump_allocator.create(ValueType) catch unreachable;
        ptr.* = value;
        return ptr;
    }
};

pub const UseDirective = enum(u2) {
    // TODO: Remove this, and provide `UseDirective.Optional` instead
    none,
    /// "use client"
    client,
    /// "use server"
    server,

    pub const Boundering = enum(u2) {
        client = @intFromEnum(UseDirective.client),
        server = @intFromEnum(UseDirective.server),
    };

    pub const Flags = struct {
        has_any_client: bool = false,
    };

    pub fn isBoundary(this: UseDirective, other: UseDirective) bool {
        if (this == other or other == .none)
            return false;

        return true;
    }

    pub fn boundering(this: UseDirective, other: UseDirective) ?Boundering {
        if (this == other or other == .none)
            return null;
        return @enumFromInt(@intFromEnum(other));
    }

    pub fn parse(contents: []const u8) ?UseDirective {
        const truncated = std.mem.trimLeft(u8, contents, " \t\n\r;");

        if (truncated.len < "'use client';".len)
            return .none;

        const directive_string = truncated[0.."'use client';".len].*;

        const first_quote = directive_string[0];
        const last_quote = directive_string[directive_string.len - 2];
        if (first_quote != last_quote or (first_quote != '"' and first_quote != '\'' and first_quote != '`'))
            return .none;

        const unquoted = directive_string[1 .. directive_string.len - 2];

        if (strings.eqlComptime(unquoted, "use client")) {
            return .client;
        }

        if (strings.eqlComptime(unquoted, "use server")) {
            return .server;
        }

        return null;
    }
};

/// Represents a boundary between client and server code. Every boundary
/// gets bundled twice, once for the desired target, and once to generate
/// a module of "references". Specifically, the generated file takes the
/// canonical Ast as input to derive a wrapper. See `Framework.ServerComponents`
/// for more details about this generated file.
///
/// This is sometimes abbreviated as SCB
pub const ServerComponentBoundary = struct {
    use_directive: UseDirective,

    /// The index of the original file.
    source_index: Index.Int,

    /// Index to the file imported on the opposite platform, which is
    /// generated by the bundler. For client components, this is the
    /// server's code. For server actions, this is the client's code.
    reference_source_index: Index.Int,

    /// When `bake.Framework.ServerComponents.separate_ssr_graph` is enabled this
    /// points to the separated module. When the SSR graph is not separate, this is
    /// equal to `reference_source_index`
    //
    // TODO: Is this used for server actions.
    ssr_source_index: Index.Int,

    /// The requirements for this data structure is to have reasonable lookup
    /// speed, but also being able to pull a `[]const Index.Int` of all
    /// boundaries for iteration.
    pub const List = struct {
        list: std.MultiArrayList(ServerComponentBoundary) = .{},
        /// Used to facilitate fast lookups into `items` by `.source_index`
        map: Map = .{},

        const Map = std.ArrayHashMapUnmanaged(void, void, struct {}, true);

        /// Can only be called on the bundler thread.
        pub fn put(
            m: *List,
            allocator: std.mem.Allocator,
            source_index: Index.Int,
            use_directive: UseDirective,
            reference_source_index: Index.Int,
            ssr_source_index: Index.Int,
        ) !void {
            try m.list.append(allocator, .{
                .source_index = source_index,
                .use_directive = use_directive,
                .reference_source_index = reference_source_index,
                .ssr_source_index = ssr_source_index,
            });
            const gop = try m.map.getOrPutAdapted(
                allocator,
                source_index,
                Adapter{ .list = m.list.slice() },
            );
            bun.assert(!gop.found_existing);
        }

        /// Can only be called on the bundler thread.
        pub fn getIndex(l: *const List, real_source_index: Index.Int) ?usize {
            return l.map.getIndexAdapted(
                real_source_index,
                Adapter{ .list = l.list.slice() },
            );
        }

        /// Use this to improve speed of accessing fields at the cost of
        /// storing more pointers. Invalidated when input is mutated.
        pub fn slice(l: List) Slice {
            return .{ .list = l.list.slice(), .map = l.map };
        }

        pub const Slice = struct {
            list: std.MultiArrayList(ServerComponentBoundary).Slice,
            map: Map,

            pub fn getIndex(l: *const Slice, real_source_index: Index.Int) ?usize {
                return l.map.getIndexAdapted(
                    real_source_index,
                    Adapter{ .list = l.list },
                ) orelse return null;
            }

            pub fn getReferenceSourceIndex(l: *const Slice, real_source_index: Index.Int) ?u32 {
                const i = l.map.getIndexAdapted(
                    real_source_index,
                    Adapter{ .list = l.list },
                ) orelse return null;
                bun.unsafeAssert(l.list.capacity > 0); // optimize MultiArrayList.Slice.items
                return l.list.items(.reference_source_index)[i];
            }

            pub fn bitSet(scbs: Slice, alloc: std.mem.Allocator, input_file_count: usize) !bun.bit_set.DynamicBitSetUnmanaged {
                var scb_bitset = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(alloc, input_file_count);
                for (scbs.list.items(.source_index)) |source_index| {
                    scb_bitset.set(source_index);
                }
                return scb_bitset;
            }
        };

        pub const Adapter = struct {
            list: std.MultiArrayList(ServerComponentBoundary).Slice,

            pub fn hash(_: Adapter, key: Index.Int) u32 {
                return std.hash.uint32(key);
            }

            pub fn eql(adapt: Adapter, a: Index.Int, _: void, b_index: usize) bool {
                bun.unsafeAssert(adapt.list.capacity > 0); // optimize MultiArrayList.Slice.items
                return a == adapt.list.items(.source_index)[b_index];
            }
        };
    };
};

pub const GlobalStoreHandle = struct {
    prev_memory_allocator: ?*ASTMemoryAllocator = null,

    var global_store_ast: ?*ASTMemoryAllocator = null;
    var global_store_threadsafe: std.heap.ThreadSafeAllocator = undefined;

    pub fn get() ?*ASTMemoryAllocator {
        if (global_store_ast == null) {
            var global = bun.default_allocator.create(ASTMemoryAllocator) catch unreachable;
            global.allocator = bun.default_allocator;
            global.bump_allocator = bun.default_allocator;
            global_store_ast = global;
        }

        const prev = Stmt.Data.Store.memory_allocator;
        Stmt.Data.Store.memory_allocator = global_store_ast;
        Expr.Data.Store.memory_allocator = global_store_ast;
        return prev;
    }

    pub fn unget(handle: ?*ASTMemoryAllocator) void {
        Stmt.Data.Store.memory_allocator = handle;
        Expr.Data.Store.memory_allocator = handle;
    }
};

extern fn JSC__jsToNumber(latin1_ptr: [*]const u8, len: usize) f64;

fn stringToEquivalentNumberValue(str: []const u8) f64 {
    // +"" -> 0
    if (str.len == 0) return 0;
    if (!bun.strings.isAllASCII(str))
        return std.math.nan(f64);
    return JSC__jsToNumber(str.ptr, str.len);
}

// test "Binding.init" {
//     var binding = Binding.alloc(
//         std.heap.page_allocator,
//         B.Identifier{ .ref = Ref{ .source_index = 0, .innerIndex() = 10 } },
//         logger.Loc{ .start = 1 },
//     );
//     std.testing.expect(binding.loc.start == 1);
//     std.testing.expect(@as(Binding.Tag, binding.data) == Binding.Tag.b_identifier);

//     printmem("-------Binding:           {d} bits\n", .{@bitSizeOf(Binding)});
//     printmem("B.Identifier:             {d} bits\n", .{@bitSizeOf(B.Identifier)});
//     printmem("B.Array:                  {d} bits\n", .{@bitSizeOf(B.Array)});
//     printmem("B.Property:               {d} bits\n", .{@bitSizeOf(B.Property)});
//     printmem("B.Object:                 {d} bits\n", .{@bitSizeOf(B.Object)});
//     printmem("B.Missing:                {d} bits\n", .{@bitSizeOf(B.Missing)});
//     printmem("-------Binding:           {d} bits\n", .{@bitSizeOf(Binding)});
// }

// test "Stmt.init" {
//     var stmt = Stmt.alloc(
//         std.heap.page_allocator,
//         S.Continue{},
//         logger.Loc{ .start = 1 },
//     );
//     std.testing.expect(stmt.loc.start == 1);
//     std.testing.expect(@as(Stmt.Tag, stmt.data) == Stmt.Tag.s_continue);

//     printmem("-----Stmt       {d} bits\n", .{@bitSizeOf(Stmt)});
//     printmem("StmtNodeList:   {d} bits\n", .{@bitSizeOf(StmtNodeList)});
//     printmem("StmtOrExpr:     {d} bits\n", .{@bitSizeOf(StmtOrExpr)});
//     printmem("S.Block         {d} bits\n", .{@bitSizeOf(S.Block)});
//     printmem("S.Comment       {d} bits\n", .{@bitSizeOf(S.Comment)});
//     printmem("S.Directive     {d} bits\n", .{@bitSizeOf(S.Directive)});
//     printmem("S.ExportClause  {d} bits\n", .{@bitSizeOf(S.ExportClause)});
//     printmem("S.Empty         {d} bits\n", .{@bitSizeOf(S.Empty)});
//     printmem("S.TypeScript    {d} bits\n", .{@bitSizeOf(S.TypeScript)});
//     printmem("S.Debugger      {d} bits\n", .{@bitSizeOf(S.Debugger)});
//     printmem("S.ExportFrom    {d} bits\n", .{@bitSizeOf(S.ExportFrom)});
//     printmem("S.ExportDefault {d} bits\n", .{@bitSizeOf(S.ExportDefault)});
//     printmem("S.Enum          {d} bits\n", .{@bitSizeOf(S.Enum)});
//     printmem("S.Namespace     {d} bits\n", .{@bitSizeOf(S.Namespace)});
//     printmem("S.Function      {d} bits\n", .{@bitSizeOf(S.Function)});
//     printmem("S.Class         {d} bits\n", .{@bitSizeOf(S.Class)});
//     printmem("S.If            {d} bits\n", .{@bitSizeOf(S.If)});
//     printmem("S.For           {d} bits\n", .{@bitSizeOf(S.For)});
//     printmem("S.ForIn         {d} bits\n", .{@bitSizeOf(S.ForIn)});
//     printmem("S.ForOf         {d} bits\n", .{@bitSizeOf(S.ForOf)});
//     printmem("S.DoWhile       {d} bits\n", .{@bitSizeOf(S.DoWhile)});
//     printmem("S.While         {d} bits\n", .{@bitSizeOf(S.While)});
//     printmem("S.With          {d} bits\n", .{@bitSizeOf(S.With)});
//     printmem("S.Try           {d} bits\n", .{@bitSizeOf(S.Try)});
//     printmem("S.Switch        {d} bits\n", .{@bitSizeOf(S.Switch)});
//     printmem("S.Import        {d} bits\n", .{@bitSizeOf(S.Import)});
//     printmem("S.Return        {d} bits\n", .{@bitSizeOf(S.Return)});
//     printmem("S.Throw         {d} bits\n", .{@bitSizeOf(S.Throw)});
//     printmem("S.Local         {d} bits\n", .{@bitSizeOf(S.Local)});
//     printmem("S.Break         {d} bits\n", .{@bitSizeOf(S.Break)});
//     printmem("S.Continue      {d} bits\n", .{@bitSizeOf(S.Continue)});
//     printmem("-----Stmt       {d} bits\n", .{@bitSizeOf(Stmt)});
// }

// test "Expr.init" {
//     var allocator = std.heap.page_allocator;
//     const ident = Expr.init(E.Identifier, E.Identifier{}, logger.Loc{ .start = 100 });
//     var list = [_]Expr{ident};
//     var expr = Expr.init(
//         E.Array,
//         E.Array{ .items = list[0..] },
//         logger.Loc{ .start = 1 },
//     );
//     try std.testing.expect(expr.loc.start == 1);
//     try std.testing.expect(@as(Expr.Tag, expr.data) == Expr.Tag.e_array);
//     try std.testing.expect(expr.data.e_array.items[0].loc.start == 100);

//     printmem("--Ref                      {d} bits\n", .{@bitSizeOf(Ref)});
//     printmem("--LocRef                   {d} bits\n", .{@bitSizeOf(LocRef)});
//     printmem("--logger.Loc               {d} bits\n", .{@bitSizeOf(logger.Loc)});
//     printmem("--logger.Range             {d} bits\n", .{@bitSizeOf(logger.Range)});
//     printmem("----------Expr:            {d} bits\n", .{@bitSizeOf(Expr)});
//     printmem("ExprNodeList:              {d} bits\n", .{@bitSizeOf(ExprNodeList)});
//     printmem("E.Array:                   {d} bits\n", .{@bitSizeOf(E.Array)});

//     printmem("E.Unary:                   {d} bits\n", .{@bitSizeOf(E.Unary)});
//     printmem("E.Binary:                  {d} bits\n", .{@bitSizeOf(E.Binary)});
//     printmem("E.Boolean:                 {d} bits\n", .{@bitSizeOf(E.Boolean)});
//     printmem("E.Super:                   {d} bits\n", .{@bitSizeOf(E.Super)});
//     printmem("E.Null:                    {d} bits\n", .{@bitSizeOf(E.Null)});
//     printmem("E.Undefined:               {d} bits\n", .{@bitSizeOf(E.Undefined)});
//     printmem("E.New:                     {d} bits\n", .{@bitSizeOf(E.New)});
//     printmem("E.NewTarget:               {d} bits\n", .{@bitSizeOf(E.NewTarget)});
//     printmem("E.Function:                {d} bits\n", .{@bitSizeOf(E.Function)});
//     printmem("E.ImportMeta:              {d} bits\n", .{@bitSizeOf(E.ImportMeta)});
//     printmem("E.Call:                    {d} bits\n", .{@bitSizeOf(E.Call)});
//     printmem("E.Dot:                     {d} bits\n", .{@bitSizeOf(E.Dot)});
//     printmem("E.Index:                   {d} bits\n", .{@bitSizeOf(E.Index)});
//     printmem("E.Arrow:                   {d} bits\n", .{@bitSizeOf(E.Arrow)});
//     printmem("E.Identifier:              {d} bits\n", .{@bitSizeOf(E.Identifier)});
//     printmem("E.ImportIdentifier:        {d} bits\n", .{@bitSizeOf(E.ImportIdentifier)});
//     printmem("E.PrivateIdentifier:       {d} bits\n", .{@bitSizeOf(E.PrivateIdentifier)});
//     printmem("E.JSXElement:              {d} bits\n", .{@bitSizeOf(E.JSXElement)});
//     printmem("E.Missing:                 {d} bits\n", .{@bitSizeOf(E.Missing)});
//     printmem("E.Number:                  {d} bits\n", .{@bitSizeOf(E.Number)});
//     printmem("E.BigInt:                  {d} bits\n", .{@bitSizeOf(E.BigInt)});
//     printmem("E.Object:                  {d} bits\n", .{@bitSizeOf(E.Object)});
//     printmem("E.Spread:                  {d} bits\n", .{@bitSizeOf(E.Spread)});
//     printmem("E.String:                  {d} bits\n", .{@bitSizeOf(E.String)});
//     printmem("E.TemplatePart:            {d} bits\n", .{@bitSizeOf(E.TemplatePart)});
//     printmem("E.Template:                {d} bits\n", .{@bitSizeOf(E.Template)});
//     printmem("E.RegExp:                  {d} bits\n", .{@bitSizeOf(E.RegExp)});
//     printmem("E.Await:                   {d} bits\n", .{@bitSizeOf(E.Await)});
//     printmem("E.Yield:                   {d} bits\n", .{@bitSizeOf(E.Yield)});
//     printmem("E.If:                      {d} bits\n", .{@bitSizeOf(E.If)});
//     printmem("E.RequireResolveString: {d} bits\n", .{@bitSizeOf(E.RequireResolveString)});
//     printmem("E.Import:                  {d} bits\n", .{@bitSizeOf(E.Import)});
//     printmem("----------Expr:            {d} bits\n", .{@bitSizeOf(Expr)});
// }

// -- ESBuild bit sizes
// EArray             | 256
// EArrow             | 512
// EAwait             | 192
// EBinary            | 448
// ECall              | 448
// EDot               | 384
// EIdentifier        | 96
// EIf                | 576
// EImport            | 448
// EImportIdentifier  | 96
// EIndex             | 448
// EJSXElement        | 448
// ENew               | 448
// EnumValue          | 384
// EObject            | 256
// EPrivateIdentifier | 64
// ERequire           | 32
// ERequireResolve    | 32
// EString            | 256
// ETemplate          | 640
// EUnary             | 256
// Expr               | 192
// ExprOrStmt         | 128
// EYield             | 128
// Finally            | 256
// Fn                 | 704
// FnBody             | 256
// LocRef             | 96
// NamedExport        | 96
// NamedImport        | 512
// NameMinifier       | 256
// NamespaceAlias     | 192
// opTableEntry       | 256
// Part               | 1088
// Property           | 640
// PropertyBinding    | 512
// Ref                | 64
// SBlock             | 192
// SBreak             | 64
// SClass             | 704
// SComment           | 128
// SContinue          | 64
// Scope              | 704
// ScopeMember        | 96
// SDirective         | 256
// SDoWhile           | 384
// SEnum              | 448
// SExportClause      | 256
// SExportDefault     | 256
// SExportEquals      | 192
// SExportFrom        | 320
// SExportStar        | 192
// SExpr              | 256
// SFor               | 384
// SForIn             | 576
// SForOf             | 640
// SFunction          | 768
// SIf                | 448
// SImport            | 320
// SLabel             | 320
// SLazyExport        | 192
// SLocal             | 256
// SNamespace         | 448
// Span               | 192
// SReturn            | 64
// SSwitch            | 448
// SThrow             | 192
// Stmt               | 192
// STry               | 384
// -- ESBuild bit sizes

const ToJSError = error{
    @"Cannot convert argument type to JS",
    @"Cannot convert identifier to JS. Try a statically-known value",
    MacroError,
    OutOfMemory,
};

const writeAnyToHasher = bun.writeAnyToHasher;
