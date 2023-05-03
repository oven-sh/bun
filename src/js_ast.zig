const std = @import("std");
const logger = @import("root").bun.logger;
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
const Ref = @import("ast/base.zig").Ref;
const Index = @import("ast/base.zig").Index;
const RefHashCtx = @import("ast/base.zig").RefHashCtx;
const ObjectPool = @import("./pool.zig").ObjectPool;
const ImportRecord = @import("import_record.zig").ImportRecord;
const allocators = @import("allocators.zig");
const JSC = @import("root").bun.JSC;
const HTTP = @import("root").bun.HTTP;
const RefCtx = @import("./ast/base.zig").RefCtx;
const JSONParser = bun.JSON;
const is_bindgen = std.meta.globalOption("bindgen", bool) orelse false;
const ComptimeStringMap = bun.ComptimeStringMap;
const JSPrinter = @import("./js_printer.zig");
const ThreadlocalArena = @import("./mimalloc_arena.zig").Arena;

/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const namespace_export_part_index = 0;

pub fn NewBaseStore(comptime Union: anytype, comptime count: usize) type {
    var max_size = 0;
    var max_align = 1;
    for (Union) |kind| {
        max_size = std.math.max(@sizeOf(kind), max_size);
        max_align = if (@sizeOf(kind) == 0) max_align else std.math.max(@alignOf(kind), max_align);
    }

    const UnionValueType = [max_size]u8;
    const SizeType = std.math.IntFittingRange(0, (count + 1));
    const MaxAlign = max_align;

    return struct {
        const Allocator = std.mem.Allocator;
        const Self = @This();
        pub const WithBase = struct {
            head: Block = Block{},
            store: Self,
        };

        pub const Block = struct {
            used: SizeType = 0,
            items: [count]UnionValueType align(MaxAlign) = undefined,

            pub inline fn isFull(block: *const Block) bool {
                return block.used >= @as(SizeType, count);
            }

            pub fn append(block: *Block, comptime ValueType: type, value: ValueType) *UnionValueType {
                if (comptime Environment.allow_assert) std.debug.assert(block.used < count);
                const index = block.used;
                block.items[index][0..value.len].* = value.*;
                block.used +|= 1;
                return &block.items[index];
            }
        };

        const Overflow = struct {
            const max = 4096 * 3;
            const UsedSize = std.math.IntFittingRange(0, max + 1);
            used: UsedSize = 0,
            allocated: UsedSize = 0,
            allocator: Allocator = default_allocator,
            ptrs: [max]*Block = undefined,

            pub fn tail(this: *Overflow) *Block {
                if (this.ptrs[this.used].isFull()) {
                    this.used +%= 1;
                    if (this.allocated > this.used) {
                        this.ptrs[this.used].used = 0;
                    }
                }

                if (this.allocated <= this.used) {
                    var new_ptrs = this.allocator.alloc(Block, 2) catch unreachable;
                    new_ptrs[0] = Block{};
                    new_ptrs[1] = Block{};
                    this.ptrs[this.allocated] = &new_ptrs[0];
                    this.ptrs[this.allocated + 1] = &new_ptrs[1];
                    this.allocated +%= 2;
                }

                return this.ptrs[this.used];
            }

            pub inline fn slice(this: *Overflow) []*Block {
                return this.ptrs[0..this.used];
            }
        };

        overflow: Overflow = Overflow{},

        pub threadlocal var _self: *Self = undefined;

        pub fn reclaim() []*Block {
            var overflow = &_self.overflow;

            if (overflow.used == 0) {
                if (overflow.allocated == 0 or overflow.ptrs[0].used == 0) {
                    return &.{};
                }
            }

            var to_move = overflow.ptrs[0..overflow.allocated][overflow.used..];

            // This returns the list of maxed out blocks
            var used_list = overflow.slice();

            // The last block may be partially used.
            if (overflow.allocated > overflow.used and to_move.len > 0 and to_move.ptr[0].used > 0) {
                to_move = to_move[1..];
                used_list.len += 1;
            }

            var used = overflow.allocator.dupe(*Block, used_list) catch unreachable;

            for (to_move, overflow.ptrs[0..to_move.len]) |b, *out| {
                b.* = Block{
                    .items = undefined,
                    .used = 0,
                };
                out.* = b;
            }

            overflow.allocated = @truncate(Overflow.UsedSize, to_move.len);
            overflow.used = 0;

            return used;
        }

        /// Reset all AST nodes, allowing the memory to be reused for the next parse.
        /// Only call this when we're done with ALL AST nodes, or you risk
        /// undefined memory bugs.
        ///
        /// Nested parsing should either use the same store, or call
        /// Store.reclaim.
        pub fn reset() void {
            const blocks = _self.overflow.slice();
            for (blocks) |b| {
                if (comptime Environment.isDebug) {
                    // ensure we crash if we use a freed value
                    var bytes = std.mem.asBytes(&b.items);
                    @memset(bytes, undefined, bytes.len);
                }
                b.used = 0;
            }
            _self.overflow.used = 0;
        }

        pub fn init(allocator: std.mem.Allocator) *Self {
            var base = allocator.create(WithBase) catch unreachable;
            base.* = WithBase{ .store = .{ .overflow = Overflow{ .allocator = allocator } } };
            var instance = &base.store;
            instance.overflow.ptrs[0] = &base.head;
            instance.overflow.allocated = 1;

            _self = instance;

            return _self;
        }

        fn deinit() void {
            var sliced = _self.overflow.slice();
            var allocator = _self.overflow.allocator;

            if (sliced.len > 1) {
                var i: usize = 1;
                const end = sliced.len;
                while (i < end) {
                    var ptrs = @ptrCast(*[2]Block, sliced[i]);
                    allocator.free(ptrs);
                    i += 2;
                }
                _self.overflow.allocated = 1;
            }
            var base_store = @fieldParentPtr(WithBase, "store", _self);
            if (_self.overflow.ptrs[0] == &base_store.head) {
                allocator.destroy(base_store);
            }
            _self = undefined;
        }

        pub fn append(comptime Disabler: type, comptime ValueType: type, value: ValueType) *ValueType {
            Disabler.assert();
            return _self._append(ValueType, value);
        }

        inline fn _append(self: *Self, comptime ValueType: type, value: ValueType) *ValueType {
            const bytes = std.mem.asBytes(&value);
            const BytesAsSlice = @TypeOf(bytes);

            var block = self.overflow.tail();

            return @ptrCast(
                *ValueType,
                @alignCast(
                    @alignOf(ValueType),
                    @alignCast(@alignOf(ValueType), block.append(BytesAsSlice, bytes)),
                ),
            );
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

    // The linker doesn't report import/export mismatch errors
    generated,
    // The printer will replace this import with "undefined"

    missing,
    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
};

pub const AssignTarget = enum(u2) {
    none = 0,
    replace = 1, // "a = b"
    update = 2, // "a += b"
    pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
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
        is_key_before_rest,
        has_any_dynamic,
        can_be_inlined,
        can_be_hoisted,
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

        /// Used for Hot Module Reloading's wrapper function
        /// "iife" stands for "immediately invoked function expression"
        print_as_iife,

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

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .type = std.meta.activeTag(self.data), .object = "binding", .value = self.data, .loc = self.loc }, options, writer);
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
                            break :convert Expr.assign(expr, default, wrapper.allocator);
                        } else {
                            break :convert expr;
                        }
                    };
                }

                return Expr.init(E.Array, E.Array{ .items = ExprNodeList.init(exprs), .is_single_line = b.is_single_line }, loc);
            },
            .b_object => |b| {
                var properties = wrapper
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
            else => {
                Global.panic("Interanl error", .{});
            },
        }
    }

    pub const Tag = enum(u5) {
        b_identifier,
        b_array,
        b_property,
        b_object,
        b_missing,

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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
            *B.Property => {
                return Binding{ .loc = loc, .data = B{ .b_property = t } };
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
                var data = allocator.create(B.Identifier) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_identifier = data } };
            },
            B.Array => {
                var data = allocator.create(B.Array) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_array = data } };
            },
            B.Property => {
                var data = allocator.create(B.Property) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_property = data } };
            },
            B.Object => {
                var data = allocator.create(B.Object) catch unreachable;
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

/// B is for Binding!
/// These are the types of bindings that can be used in the AST.
pub const B = union(Binding.Tag) {
    b_identifier: *B.Identifier,
    b_array: *B.Array,
    b_property: *B.Property,
    b_object: *B.Object,
    b_missing: B.Missing,

    pub const Identifier = struct {
        ref: Ref,
    };

    pub const Property = struct {
        flags: Flags.Property.Set = Flags.Property.None,
        key: ExprNodeIndex,
        value: BindingNodeIndex,
        default_value: ?ExprNodeIndex = null,
    };

    pub const Object = struct { properties: []Property, is_single_line: bool = false };

    pub const Array = struct {
        items: []ArrayBinding,
        has_spread: bool = false,
        is_single_line: bool = false,
    };

    pub const Missing = struct {};
};

pub const ClauseItem = struct {
    alias: string = "",
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

pub const CharAndCount = struct {
    char: u8 = 0,
    count: i32 = 0,
    index: usize = 0,

    pub const Array = [64]CharAndCount;

    pub fn lessThan(_: void, a: CharAndCount, b: CharAndCount) bool {
        return a.count > b.count or (a.count == b.count and a.index < b.index);
    }
};

pub const CharFreq = struct {
    const Vector = @Vector(64, i32);
    const Buffer = [64]i32;

    freqs: Buffer align(@alignOf(Vector)) = undefined,

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

    fn scanBig(out: *align(@alignOf(Vector)) Buffer, text: string, delta: i32) void {
        // https://zig.godbolt.org/z/P5dPojWGK
        var freqs = out.*;
        defer out.* = freqs;
        var deltas: [255]i32 = [_]i32{0} ** 255;
        var remain = text;

        std.debug.assert(remain.len >= scan_big_chunk_size);

        const unrolled = remain.len - (remain.len % scan_big_chunk_size);
        var remain_end = remain.ptr + unrolled;
        var unrolled_ptr = remain.ptr;
        remain = remain[unrolled..];

        while (unrolled_ptr != remain_end) : (unrolled_ptr += scan_big_chunk_size) {
            const chunk = unrolled_ptr[0..scan_big_chunk_size].*;
            comptime var i: usize = 0;
            inline while (i < scan_big_chunk_size) : (i += scan_big_chunk_size) {
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

    fn scanSmall(out: *align(@alignOf(Vector)) [64]i32, text: string, delta: i32) void {
        var freqs: [64]i32 = out.*;
        defer out.* = freqs;

        for (text) |c| {
            const i: usize = switch (c) {
                'a'...'z' => @intCast(usize, c) - 'a',
                'A'...'Z' => @intCast(usize, c) - ('A' - 26),
                '0'...'9' => @intCast(usize, c) + (53 - '0'),
                '_' => 62,
                '$' => 63,
                else => continue,
            };
            freqs[i] += delta;
        }
    }

    pub fn include(this: *CharFreq, other: CharFreq) void {
        // https://zig.godbolt.org/z/Mq8eK6K9s
        var left: @Vector(64, i32) = this.freqs;
        defer this.freqs = left;
        const right: @Vector(64, i32) = other.freqs;

        left += right;
    }

    pub fn compile(this: *const CharFreq, allocator: std.mem.Allocator) NameMinifier {
        var array: CharAndCount.Array = brk: {
            var _array: CharAndCount.Array = undefined;
            const freqs = this.freqs;

            for (&_array, NameMinifier.default_tail, &freqs, 0..) |*dest, char, freq, i| {
                dest.* = CharAndCount{
                    .char = char,
                    .index = i,
                    .count = freq,
                };
            }
            break :brk _array;
        };

        std.sort.sort(CharAndCount, &array, {}, CharAndCount.lessThan);

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
        var j = @intCast(usize, @mod(i, 54));
        try name.appendSlice(this.head.items[j .. j + 1]);
        i = @divFloor(i, 54);

        while (i > 0) {
            i -= 1;
            j = @intCast(usize, @mod(i, 64));
            try name.appendSlice(this.tail.items[j .. j + 1]);
            i = @divFloor(i, 64);
        }
    }

    pub fn defaultNumberToMinifiedName(allocator: std.mem.Allocator, _i: isize) !string {
        var i = _i;
        var j = @intCast(usize, @mod(i, 54));
        var name = std.ArrayList(u8).init(allocator);
        try name.appendSlice(default_head[j .. j + 1]);
        i = @divFloor(i, 54);

        while (i > 0) {
            i -= 1;
            j = @intCast(usize, @mod(i, 64));
            try name.appendSlice(default_tail[j .. j + 1]);
            i = @divFloor(i, 64);
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
                                        if (!val.canBeConstValue()) {
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

        // This is used when parsing a pattern that uses default values:
        //
        //   [a = 1] = [];
        //   ({a = 1} = {});
        //
        // It's also used for class fields:
        //
        //   class Foo { a = 1 }
        //
        initializer: ?ExprNodeIndex = null,
        kind: Kind = Kind.normal,
        flags: Flags.Property.Set = Flags.Property.None,

        class_static_block: ?*ClassStaticBlock = null,
        ts_decorators: ExprNodeList = ExprNodeList{},
        // Key is optional for spread
        key: ?ExprNodeIndex = null,

        // This is omitted for class fields
        value: ?ExprNodeIndex = null,

        pub const List = BabyList(Property);

        pub const Kind = enum(u3) {
            normal,
            get,
            set,
            spread,
            class_static_block,

            pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
                return try std.json.stringify(@tagName(self), opts, o);
            }
        };
    };

    pub const FnBody = struct {
        loc: logger.Loc,
        stmts: StmtNodeList,
    };

    pub const Fn = struct {
        name: ?LocRef,
        open_parens_loc: logger.Loc,
        args: []Arg = &([_]Arg{}),
        // This was originally nullable, but doing so I believe caused a miscompilation
        // Specifically, the body was always null.
        body: FnBody = FnBody{ .loc = logger.Loc.Empty, .stmts = &([_]StmtNodeIndex{}) },
        arguments_ref: ?Ref = null,

        flags: Flags.Function.Set = Flags.Function.None,
    };
    pub const Arg = struct {
        ts_decorators: ExprNodeList = ExprNodeList{},
        binding: BindingNodeIndex,
        default: ?ExprNodeIndex = null,

        // "constructor(public x: boolean) {}"
        is_typescript_ctor_field: bool = false,
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

        // An unbound symbol is one that isn't declared in the file it's referenced
        // in. For example, using "window" without declaring it will be unbound.
        unbound,

        // This has special merging behavior. You're allowed to re-declare these
        // symbols more than once in the same scope. These symbols are also hoisted
        // out of the scope they are declared in to the closest containing function
        // or module scope. These are the symbols with this kind:
        //
        // - Function arguments
        // - Function statements
        // - Variables declared using "var"
        //
        hoisted,
        hoisted_function,

        // There's a weird special case where catch variables declared using a simple
        // identifier (i.e. not a binding pattern) block hoisted variables instead of
        // becoming an error:
        //
        //   var e = 0;
        //   try { throw 1 } catch (e) {
        //     print(e) // 1
        //     var e = 2
        //     print(e) // 2
        //   }
        //   print(e) // 0 (since the hoisting stops at the catch block boundary)
        //
        // However, other forms are still a syntax error:
        //
        //   try {} catch (e) { let e }
        //   try {} catch ({e}) { var e }
        //
        // This symbol is for handling this weird special case.
        catch_identifier,

        // Generator and async functions are not hoisted, but still have special
        // properties such as being able to overwrite previous functions with the
        // same name
        generator_or_async_function,

        // This is the special "arguments" variable inside functions
        arguments,

        // Classes can merge with TypeScript namespaces.
        class,

        // A class-private identifier (i.e. "#foo").
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

        // Labels are in their own namespace
        label,

        // TypeScript enums can merge with TypeScript namespaces and other TypeScript
        // enums.
        ts_enum,

        // TypeScript namespaces can merge with classes, functions, TypeScript enums,
        // and other TypeScript namespaces.
        ts_namespace,

        // In TypeScript, imports are allowed to silently collide with symbols within
        // the module. Presumably this is because the imports may be type-only.
        import,

        // Assigning to a "const" symbol will throw a TypeError at runtime
        cconst,

        // This annotates all other symbols that don't have special behavior.
        other,

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }

        pub inline fn isPrivate(kind: Symbol.Kind) bool {
            return @enumToInt(kind) >= @enumToInt(Symbol.Kind.private_field) and @enumToInt(kind) <= @enumToInt(Symbol.Kind.private_static_get_set_pair);
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
        symbols_for_source: NestedList = NestedList{},

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
                                .source_index = @truncate(Ref.Int, i),
                                .inner_index = @truncate(Ref.Int, inner_index),
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
            var symbols_for_source: NestedList = NestedList.init(try allocator.alloc([]Symbol, sourceCount));
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
            for (symbols.symbols_for_source.slice()) |list| {
                for (list.slice()) |*symbol| {
                    if (!symbol.hasLink()) continue;
                    symbol.link = follow(symbols, symbol.link);
                }
            }
        }

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

    pub fn isReactComponentishName(symbol: *const Symbol) bool {
        switch (symbol.kind) {
            .hoisted, .hoisted_function, .cconst, .class, .other => {
                return switch (symbol.original_name[0]) {
                    'A'...'Z' => true,
                    else => false,
                };
            },

            else => {
                return false;
            },
        }
    }
};

pub const OptionalChain = enum(u2) {

    // "a?.b"
    start,

    // "a?.b.c" => ".c" is OptionalChainContinue
    // "(a?.b).c" => ".c" is OptionalChain null
    ccontinue,

    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
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

        pub fn toJS(this: @This(), ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            var stack = std.heap.stackFallback(32 * @sizeOf(ExprNodeList), JSC.getAllocator(ctx));
            var allocator = stack.get();
            var results = allocator.alloc(JSC.C.JSValueRef, this.items.len) catch {
                return JSC.C.JSValueMakeUndefined(ctx);
            };
            defer if (stack.fixed_buffer_allocator.end_index >= stack.fixed_buffer_allocator.buffer.len - 1) allocator.free(results);

            var i: usize = 0;
            const items = this.items.slice();
            while (i < results.len) : (i += 1) {
                results[i] = items[i].toJS(ctx, exception);
            }

            return JSC.C.JSObjectMakeArray(ctx, results.len, results.ptr, exception);
        }
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
        pub fn toJS(this: @This(), ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
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

    pub const CommonJSExportIdentifier = struct {
        ref: Ref = Ref.None,
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

        /// key is the key prop like <ListItem key="foo">
        key: ?ExprNodeIndex = null,

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
        pub fn jsonStringify(_: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(null, opts, o);
        }
    };

    pub const Number = struct {
        value: f64,

        const double_digit = [_]string{ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "100" };
        const neg_double_digit = [_]string{ "-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9", "-11", "-12", "-13", "-14", "-15", "-16", "-17", "-18", "-19", "-20", "-21", "-22", "-23", "-24", "-25", "-26", "-27", "-28", "-29", "-30", "-31", "-32", "-33", "-34", "-35", "-36", "-37", "-38", "-39", "-40", "-41", "-42", "-43", "-44", "-45", "-46", "-47", "-48", "-49", "-50", "-51", "-52", "-53", "-54", "-55", "-56", "-57", "-58", "-59", "-60", "-61", "-62", "-63", "-64", "-65", "-66", "-67", "-68", "-69", "-70", "-71", "-72", "-73", "-74", "-75", "-76", "-77", "-78", "-79", "-80", "-81", "-82", "-83", "-84", "-85", "-86", "-87", "-88", "-89", "-90", "-91", "-92", "-93", "-94", "-95", "-96", "-97", "-98", "-99", "-100" };

        /// String concatenation with numbers is required by the TypeScript compiler for
        /// "constant expression" handling in enums. However, we don't want to introduce
        /// correctness bugs by accidentally stringifying a number differently than how
        /// a real JavaScript VM would do it. So we are conservative and we only do this
        /// when we know it'll be the same result.
        pub fn toStringSafely(this: Number, allocator: std.mem.Allocator) ?string {
            return toStringFromF64Safe(this.value, allocator);
        }

        pub fn toStringFromF64Safe(value: f64, allocator: std.mem.Allocator) ?string {
            if (value == @trunc(value)) {
                const int_value = @floatToInt(i64, value);
                const abs = @intCast(u64, std.math.absInt(int_value) catch return null);
                if (abs < double_digit.len) {
                    return if (value < 0)
                        neg_double_digit[abs]
                    else
                        double_digit[abs];
                }

                if (abs <= std.math.maxInt(i32)) {
                    return std.fmt.allocPrint(allocator, "{d}", .{@intCast(i32, int_value)}) catch return null;
                }
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

            return null;
        }

        pub inline fn toU64(self: Number) u64 {
            @setRuntimeSafety(false);
            return @floatToInt(u64, @max(@trunc(self.value), 0));
        }

        pub inline fn toUsize(self: Number) usize {
            @setRuntimeSafety(false);
            return @floatToInt(usize, @max(@trunc(self.value), 0));
        }

        pub inline fn toU32(self: Number) u32 {
            @setRuntimeSafety(false);
            return @floatToInt(u32, @max(@trunc(self.value), 0));
        }

        pub inline fn toU16(self: Number) u16 {
            @setRuntimeSafety(false);
            return @floatToInt(u16, @max(@trunc(self.value), 0));
        }

        pub fn jsonStringify(self: *const Number, opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }

        pub fn toJS(this: @This(), _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return JSC.JSValue.jsNumber(this.value).asObjectRef();
        }
    };

    pub const BigInt = struct {
        value: string,

        pub var empty = BigInt{ .value = "" };

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }

        pub fn toJS(_: @This(), _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
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
            const OOM = error{OutOfMemory};
            pub fn append(this: *Rope, expr: Expr, allocator: std.mem.Allocator) OOM!*Rope {
                if (this.next) |next| {
                    return try next.append(expr, allocator);
                }

                var rope = try allocator.create(Rope);
                rope.* = .{
                    .head = expr,
                };
                this.next = rope;
                return rope;
            }
        };

        // pub fn toJS(this: Object, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        //     const Creator = struct {
        //         object: Object,
        //         pub fn create(this: *@This(), obj: *JSObject, global: *JSGlobalObject) void {
        //             var iter = this.query.iter();
        //             var str: ZigString = undefined;
        //             while (iter.next(&query_string_values_buf)) |entry| {
        //                 str = ZigString.init(entry.name);

        //                 std.debug.assert(entry.values.len > 0);
        //                 if (entry.values.len > 1) {
        //                     var values = query_string_value_refs_buf[0..entry.values.len];
        //                     for (entry.values) |value, i| {
        //                         values[i] = ZigString.init(value);
        //                     }
        //                     obj.putRecord(global, &str, values.ptr, values.len);
        //                 } else {
        //                     query_string_value_refs_buf[0] = ZigString.init(entry.values[0]);

        //                     obj.putRecord(global, &str, &query_string_value_refs_buf, 1);
        //                 }
        //             }
        //         }
        //     };
        // }

        pub fn get(self: *const Object, key: string) ?Expr {
            return if (asProperty(self, key)) |query| query.expr else @as(?Expr, null);
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
                        .i = @truncate(u32, i),
                    };
                }
            }

            return null;
        }

        pub fn alphabetizeProperties(this: *Object) void {
            std.sort.sort(G.Property, this.properties.slice(), {}, Sorter.isLessThan);
        }

        pub fn packageJSONSort(this: *Object) void {
            std.sort.sort(G.Property, this.properties.slice(), {}, PackageJSONSort.Fields.isLessThan);
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
                    var lhs_key_size: u8 = @enumToInt(Fields.__fake);
                    var rhs_key_size: u8 = @enumToInt(Fields.__fake);

                    if (lhs.key != null and lhs.key.?.data == .e_string) {
                        lhs_key_size = @enumToInt(Map.get(lhs.key.?.data.e_string.data) orelse Fields.__fake);
                    }

                    if (rhs.key != null and rhs.key.?.data == .e_string) {
                        rhs_key_size = @enumToInt(Map.get(rhs.key.?.data.e_string.data) orelse Fields.__fake);
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
        data: []const u8 = "",
        prefer_template: bool = false,

        // A very simple rope implementation
        // We only use this for string folding, so this is kind of overkill
        // We don't need to deal with substrings
        next: ?*String = null,
        end: ?*String = null,
        rope_len: u32 = 0,
        is_utf16: bool = false,

        pub var class = E.String{ .data = "class" };
        pub fn push(this: *String, other: *String) void {
            std.debug.assert(this.isUTF8());
            std.debug.assert(other.isUTF8());

            if (other.rope_len == 0) {
                other.rope_len = @truncate(u32, other.data.len);
            }

            if (this.rope_len == 0) {
                this.rope_len = @truncate(u32, this.data.len);
            }

            this.rope_len += other.rope_len;
            if (this.next == null) {
                this.next = other;
                this.end = other;
            } else {
                this.end.?.next = other;
                this.end = other;
            }
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
                    .data = @ptrCast([*]const u8, value.ptr)[0..value.len],
                    .is_utf16 = true,
                };
            }
            return .{
                .data = value,
            };
        }

        pub fn slice16(this: *const String) []const u16 {
            std.debug.assert(this.is_utf16);
            return @ptrCast([*]const u16, @alignCast(@alignOf(u16), this.data.ptr))[0..this.data.len];
        }

        pub fn resovleRopeIfNeeded(this: *String, allocator: std.mem.Allocator) void {
            if (this.next == null or !this.isUTF8()) return;
            var str = this.next;
            var bytes = std.ArrayList(u8).initCapacity(allocator, this.rope_len) catch unreachable;

            bytes.appendSliceAssumeCapacity(this.data);
            while (str) |strin| {
                bytes.appendSlice(strin.data) catch unreachable;
                str = strin.next;
            }
            this.data = bytes.items;
            this.next = null;
        }

        pub fn slice(this: *String, allocator: std.mem.Allocator) []const u8 {
            this.resovleRopeIfNeeded(allocator);
            return this.string(allocator) catch unreachable;
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

        pub fn javascriptLength(s: *const String) u32 {
            if (s.rope_len > 0) {
                // We only support ascii ropes for now
                return s.rope_len;
            }

            if (s.isUTF8()) {
                return @truncate(u32, bun.simdutf.length.utf16.from.utf8.le(s.data));
            }

            return @truncate(u32, s.slice16().len);
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

        pub fn eqlComptime(s: *const String, comptime value: anytype) bool {
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

        pub fn string(s: *const String, allocator: std.mem.Allocator) !bun.string {
            if (s.isUTF8()) {
                return s.data;
            } else {
                return strings.toUTF8Alloc(allocator, s.slice16());
            }
        }

        pub fn stringCloned(s: *const String, allocator: std.mem.Allocator) !bun.string {
            if (s.isUTF8()) {
                return try allocator.dupe(u8, s.data);
            } else {
                return strings.toUTF8Alloc(allocator, s.slice16());
            }
        }

        pub fn hash(s: *const String) u64 {
            if (s.isBlank()) return 0;

            if (s.isUTF8()) {
                // hash utf-8
                return std.hash.Wyhash.hash(0, s.data);
            } else {
                // hash utf-16
                return std.hash.Wyhash.hash(0, @ptrCast([*]const u8, s.slice16().ptr)[0 .. s.slice16().len * 2]);
            }
        }

        pub fn jsonStringify(s: *const String, options: anytype, writer: anytype) !void {
            var buf = [_]u8{0} ** 4096;
            var i: usize = 0;
            for (s.slice16()) |char| {
                buf[i] = @intCast(u8, char);
                i += 1;
                if (i >= 4096) {
                    break;
                }
            }

            return try std.json.stringify(buf[0..i], options, writer);
        }
    };

    // value is in the Node
    pub const TemplatePart = struct {
        value: ExprNodeIndex,
        tail_loc: logger.Loc,
        tail: E.String,
    };

    pub const Template = struct {
        tag: ?ExprNodeIndex = null,
        head: E.String,
        parts: []TemplatePart = &([_]TemplatePart{}),

        /// "`a${'b'}c`" => "`abc`"
        pub fn fold(
            this: *Template,
            allocator: std.mem.Allocator,
            loc: logger.Loc,
        ) Expr {
            if (this.tag != null or !this.head.isUTF8()) {
                // we only fold utf-8/ascii for now
                return Expr{
                    .data = .{
                        .e_template = this,
                    },
                    .loc = loc,
                };
            }

            if (this.parts.len == 0) {
                return Expr.init(E.String, this.head, loc);
            }

            var parts = std.ArrayList(TemplatePart).initCapacity(allocator, this.parts.len) catch unreachable;
            var head = Expr.init(E.String, this.head, loc);
            for (this.parts) |part_| {
                var part = part_;

                switch (part.value.data) {
                    .e_number => {
                        if (part.value.data.e_number.toStringSafely(allocator)) |s| {
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
                    else => {},
                }

                if (part.value.data == .e_string and part.tail.isUTF8() and part.value.data.e_string.isUTF8()) {
                    if (parts.items.len == 0) {
                        if (part.value.data.e_string.len() > 0) {
                            head.data.e_string.push(part.value.data.e_string);
                        }

                        if (part.tail.len() > 0) {
                            head.data.e_string.push(Expr.init(E.String, part.tail, part.tail_loc).data.e_string);
                        }

                        continue;
                    } else {
                        var prev_part = &parts.items[parts.items.len - 1];

                        if (prev_part.tail.isUTF8()) {
                            if (part.value.data.e_string.len() > 0) {
                                prev_part.tail.push(part.value.data.e_string);
                            }

                            if (part.tail.len() > 0) {
                                prev_part.tail.push(Expr.init(E.String, part.tail, part.tail_loc).data.e_string);
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

                return head;
            }

            return Expr.init(
                E.Template,
                E.Template{
                    .tag = null,
                    .parts = parts.items,
                    .head = head.data.e_string.*,
                },
                loc,
            );
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

        pub fn jsonStringify(self: *const RegExp, opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
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

        /// TODO:
        close_paren_loc: logger.Loc = logger.Loc.Empty,
    };

    pub const Import = struct {
        expr: ExprNodeIndex,
        import_record_index: u32,

        /// Comments inside "import()" expressions have special meaning for Webpack.
        /// Preserving comments inside these expressions makes it possible to use
        /// esbuild as a TypeScript-to-JavaScript frontend for Webpack to improve
        /// performance. We intentionally do not interpret these comments in esbuild
        /// because esbuild is not Webpack. But we do preserve them since doing so is
        /// harmless, easy to maintain, and useful to people. See the Webpack docs for
        /// more info: https://webpack.js.org/api/module-methods/#magic-comments.
        /// TODO:
        leading_interior_comments: []G.Comment = &([_]G.Comment{}),

        pub fn isImportRecordNull(this: *const Import) bool {
            return this.import_record_index == std.math.maxInt(u32);
        }
    };
};

pub const Stmt = struct {
    loc: logger.Loc,
    data: Data,

    pub const Batcher = bun.Batcher(Stmt);

    pub fn assign(a: Expr, b: Expr, allocator: std.mem.Allocator) Stmt {
        return Stmt.alloc(
            S.SExpr,
            S.SExpr{
                .value = Expr.assign(a, b, allocator),
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

    pub fn jsonStringify(self: *const Stmt, options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .type = std.meta.activeTag(self.data), .object = "stmt", .value = self.data, .loc = self.loc }, options, writer);
    }

    pub fn isTypeScript(self: *Stmt) bool {
        return @as(Stmt.Tag, self.data) == .s_type_script;
    }

    pub fn isSuperCall(self: Stmt) bool {
        return self.data == .s_expr and self.data.s_expr.value.data == .e_call and self.data.s_expr.value.data.e_call.target.data == .e_super;
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
        var value = allocator.create(@TypeOf(origData)) catch unreachable;
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

    pub const Tag = enum(u6) {
        s_block,
        s_break,
        s_class,
        s_comment,
        s_continue,
        s_debugger,
        s_directive,
        s_do_while,
        s_empty,
        s_enum,
        s_export_clause,
        s_export_default,
        s_export_equals,
        s_export_from,
        s_export_star,
        s_expr,
        s_for,
        s_for_in,
        s_for_of,
        s_function,
        s_if,
        s_import,
        s_label,
        s_lazy_export,
        s_local,
        s_namespace,
        s_return,
        s_switch,
        s_throw,
        s_try,
        s_type_script,
        s_while,
        s_with,

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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

        s_lazy_export: Expr.Data,

        pub const Store = struct {
            const Union = [_]type{
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
                S.TypeScript,
                S.While,
                S.With,
            };
            const All = NewBaseStore(Union, 128);
            pub threadlocal var memory_allocator: ?*ASTMemoryAllocator = null;

            threadlocal var has_inited = false;
            pub threadlocal var disable_reset = false;
            pub fn create(allocator: std.mem.Allocator) void {
                if (has_inited or memory_allocator != null) {
                    return;
                }

                has_inited = true;
                _ = All.init(allocator);
            }

            pub fn reset() void {
                if (disable_reset or memory_allocator != null) return;
                All.reset();
            }

            pub fn deinit() void {
                if (!has_inited or memory_allocator != null) return;
                All.deinit();
                has_inited = false;
            }

            pub inline fn assert() void {
                if (comptime Environment.allow_assert) {
                    if (!has_inited and memory_allocator == null)
                        bun.unreachablePanic("Store must be init'd", .{});
                }
            }

            pub fn append(comptime ValueType: type, value: anytype) *ValueType {
                if (memory_allocator) |allocator| {
                    return allocator.append(ValueType, value);
                }

                return All.append(Disabler, ValueType, value);
            }

            pub fn toOwnedSlice() []*Store.All.Block {
                if (!has_inited or Store.All._self.overflow.used == 0 or disable_reset) return &[_]*Store.All.Block{};
                return Store.All.reclaim();
            }
        };
    };

    pub fn caresAboutScope(self: *Stmt) bool {
        return switch (self.data) {
            .s_block, .s_empty, .s_debugger, .s_expr, .s_if, .s_for, .s_for_in, .s_for_of, .s_do_while, .s_while, .s_with, .s_try, .s_switch, .s_return, .s_throw, .s_break, .s_continue, .s_directive => {
                return false;
            },

            .s_local => |local| {
                return local.kind != S.Kind.k_var;
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

    pub fn fromBlob(
        blob: *const JSC.WebCore.Blob,
        allocator: std.mem.Allocator,
        mime_type_: ?HTTP.MimeType,
        log: *logger.Log,
        loc: logger.Loc,
    ) !Expr {
        var bytes = blob.sharedView();

        const mime_type = mime_type_ orelse HTTP.MimeType.init(blob.content_type);

        if (mime_type.category == .json) {
            var source = logger.Source.initPathString("fetch.json", bytes);
            var out_expr = JSONParser.ParseJSONForMacro(&source, log, allocator) catch {
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
        if (@ptrToInt(obj.properties.ptr) == 0) return false;

        for (obj.properties.slice()) |prop| {
            if (prop.value == null) continue;
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            const key_str = key.data.e_string;
            if (strings.eqlAnyComptime(key_str.data, names)) return true;
        }

        return false;
    }

    pub fn toJS(this: Expr, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return this.data.toJS(ctx, exception);
    }

    pub fn get(expr: *const Expr, name: string) ?Expr {
        return if (asProperty(expr, name)) |query| query.expr else null;
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
        if (@ptrToInt(obj.properties.ptr) == 0) return null;

        return obj.asProperty(name);
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
        if (array.items.len == 0 or @ptrToInt(array.items.ptr) == 0) return null;

        return ArrayIterator{ .array = array, .index = 0 };
    }

    pub inline fn asString(expr: *const Expr, allocator: std.mem.Allocator) ?string {
        if (std.meta.activeTag(expr.data) != .e_string) return null;
        return expr.data.e_string.string(allocator) catch null;
    }

    pub fn asBool(
        expr: *const Expr,
    ) ?bool {
        if (std.meta.activeTag(expr.data) != .e_boolean) return null;

        return expr.data.e_boolean.value;
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
        std.debug.assert(all.len > 0);
        switch (all.len) {
            1 => {
                return all[0];
            },
            2 => {
                return Expr.joinWithComma(all[0], all[1], allocator);
            },
            else => {
                var i: usize = 1;
                var expr = all[0];
                while (i < all.len) : (i += 1) {
                    expr = Expr.joinWithComma(expr, all[i], allocator);
                }

                return expr;
            },
        }
    }

    pub fn joinAllWithCommaCallback(all: []Expr, comptime Context: type, ctx: Context, callback: (fn (ctx: anytype, expr: anytype) ?Expr), allocator: std.mem.Allocator) ?Expr {
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

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .type = std.meta.activeTag(self.data), .object = "expr", .value = self.data, .loc = self.loc }, options, writer);
    }

    pub fn extractNumericValues(left: Expr.Data, right: Expr.Data) ?[2]f64 {
        if (!(@as(Expr.Tag, left) == .e_number and @as(Expr.Tag, right) == .e_number)) {
            return null;
        }

        return [2]f64{ left.e_number.value, right.e_number.value };
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                        std.debug.assert(@ptrToInt(st.data.ptr) > 0);
                        std.debug.assert(st.data[0] > 0);
                    }
                }
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = brk: {
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                            var item = allocator.create(Type) catch unreachable;
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
                        std.debug.assert(@ptrToInt(st.data.ptr) > 0);
                        std.debug.assert(st.data[0] > 0);
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

            else => {
                @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
            },
        }
    }

    pub fn isPrimitiveLiteral(this: Expr) bool {
        return @as(Tag, this.data).isPrimitiveLiteral();
    }

    pub const Tag = enum(u6) {
        e_array,
        e_unary,
        e_binary,
        e_boolean,
        e_super,
        e_null,
        e_undefined,
        e_new,
        e_function,
        e_new_target,
        e_import_meta,
        e_call,
        e_dot,
        e_index,
        e_arrow,
        e_identifier,
        e_import_identifier,
        e_private_identifier,
        e_jsx_element,
        e_missing,
        e_number,
        e_big_int,
        e_object,
        e_spread,
        e_string,
        e_template_part,
        e_template,
        e_reg_exp,
        e_await,
        e_yield,
        e_if,
        e_require_resolve_string,
        e_import,
        e_this,
        e_class,
        e_require_string,

        e_commonjs_export_identifier,

        // This should never make it to the printer
        inline_identifier,

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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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

    pub fn assign(a: Expr, b: Expr, _: std.mem.Allocator) Expr {
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

            else => {},
        }

        return null;
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

        //  This can be used when the returned type is either one or the other

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

        e_boolean: E.Boolean,
        e_number: E.Number,
        e_big_int: *E.BigInt,
        e_string: *E.String,

        e_require_string: E.RequireString,
        e_require_resolve_string: E.RequireResolveString,

        e_missing: E.Missing,
        e_this: E.This,
        e_super: E.Super,
        e_null: E.Null,
        e_undefined: E.Undefined,
        e_new_target: E.NewTarget,
        e_import_meta: E.ImportMeta,

        // This type should not exist outside of MacroContext
        // If it ends up in JSParser or JSPrinter, it is a bug.
        inline_identifier: i32,

        pub fn clone(this: Expr.Data, allocator: std.mem.Allocator) !Data {
            return switch (this) {
                .e_array => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_array)));
                    item.* = el.*;
                    return .{ .e_array = item };
                },
                .e_unary => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_unary)));
                    item.* = el.*;
                    return .{ .e_unary = item };
                },
                .e_binary => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_binary)));
                    item.* = el.*;
                    return .{ .e_binary = item };
                },
                .e_class => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_class)));
                    item.* = el.*;
                    return .{ .e_class = item };
                },
                .e_new => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_new)));
                    item.* = el.*;
                    return .{ .e_new = item };
                },
                .e_function => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_function)));
                    item.* = el.*;
                    return .{ .e_function = item };
                },
                .e_call => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_call)));
                    item.* = el.*;
                    return .{ .e_call = item };
                },
                .e_dot => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_dot)));
                    item.* = el.*;
                    return .{ .e_dot = item };
                },
                .e_index => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_index)));
                    item.* = el.*;
                    return .{ .e_index = item };
                },
                .e_arrow => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_arrow)));
                    item.* = el.*;
                    return .{ .e_arrow = item };
                },
                .e_jsx_element => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_jsx_element)));
                    item.* = el.*;
                    return .{ .e_jsx_element = item };
                },
                .e_object => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_object)));
                    item.* = el.*;
                    return .{ .e_object = item };
                },
                .e_spread => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_spread)));
                    item.* = el.*;
                    return .{ .e_spread = item };
                },
                .e_template_part => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_template_part)));
                    item.* = el.*;
                    return .{ .e_template_part = item };
                },
                .e_template => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_template)));
                    item.* = el.*;
                    return .{ .e_template = item };
                },
                .e_reg_exp => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_reg_exp)));
                    item.* = el.*;
                    return .{ .e_reg_exp = item };
                },
                .e_await => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_await)));
                    item.* = el.*;
                    return .{ .e_await = item };
                },
                .e_yield => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_yield)));
                    item.* = el.*;
                    return .{ .e_yield = item };
                },
                .e_if => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_if)));
                    item.* = el.*;
                    return .{ .e_if = item };
                },
                .e_import => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_import)));
                    item.* = el.*;
                    return .{ .e_import = item };
                },
                .e_big_int => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_big_int)));
                    item.* = el.*;
                    return .{ .e_big_int = item };
                },
                .e_string => |el| {
                    var item = try allocator.create(std.meta.Child(@TypeOf(this.e_string)));
                    item.* = el.*;
                    return .{ .e_string = item };
                },
                else => this,
            };
        }

        pub fn canBeConstValue(this: Expr.Data) bool {
            return switch (this) {
                .e_number, .e_boolean, .e_null, .e_undefined => true,
                .e_string => |str| str.next == null,
                .e_array => |array| array.was_originally_macro,
                .e_object => |object| object.was_originally_macro,
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
                .e_undefined => std.math.nan_f64,
                .e_boolean => @as(f64, if (data.e_boolean.value) 1.0 else 0.0),
                .e_number => data.e_number.value,
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
                else => null,
            };
        }

        pub const Equality = struct { equal: bool = false, ok: bool = false };

        // Returns "equal, ok". If "ok" is false, then nothing is known about the two
        // values. If "ok" is true, the equality or inequality of the two values is
        // stored in "equal".
        pub fn eql(
            left: Expr.Data,
            right: Expr.Data,
            allocator: std.mem.Allocator,
        ) Equality {
            var equality = Equality{};
            switch (left) {
                .e_null => {
                    equality.equal = @as(Expr.Tag, right) == Expr.Tag.e_null;
                    equality.ok = equality.equal;
                },
                .e_undefined => {
                    equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_undefined;
                    equality.equal = equality.ok;
                },
                .e_boolean => |l| {
                    equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_boolean;
                    equality.equal = equality.ok and l.value == right.e_boolean.value;
                },
                .e_number => |l| {
                    equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_number;
                    equality.equal = equality.ok and l.value == right.e_number.value;
                },
                .e_big_int => |l| {
                    equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_big_int;
                    equality.equal = equality.ok and strings.eql(l.value, right.e_big_int.value);
                },
                .e_string => |l| {
                    equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_string;
                    if (equality.ok) {
                        var r = right.e_string;
                        r.resovleRopeIfNeeded(allocator);
                        l.resovleRopeIfNeeded(allocator);
                        equality.equal = r.eql(E.String, l);
                    }
                },
                else => {},
            }

            return equality;
        }

        pub fn toJS(this: Data, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return switch (this) {
                .e_array => |e| e.toJS(ctx, exception),
                .e_null => |e| e.toJS(ctx, exception),
                .e_undefined => |e| e.toJS(ctx, exception),
                .e_object => |e| e.toJS(ctx, exception),
                .e_boolean => |e| e.toJS(ctx, exception),
                .e_number => |e| e.toJS(ctx, exception),
                .e_big_int => |e| e.toJS(ctx, exception),
                .e_string => |e| e.toJS(ctx, exception),
                else => {
                    return JSC.C.JSValueMakeUndefined(ctx);
                },
            };
        }

        pub const Store = struct {
            const often = 512;
            const medium = 256;
            const rare = 24;

            const All = NewBaseStore(
                &([_]type{
                    E.Array,
                    E.Unary,
                    E.Binary,
                    E.Class,
                    E.New,
                    E.Function,
                    E.Call,
                    E.Dot,
                    E.Index,
                    E.Arrow,
                    E.RegExp,

                    E.PrivateIdentifier,
                    E.JSXElement,
                    E.Number,
                    E.BigInt,
                    E.Object,
                    E.Spread,
                    E.String,
                    E.TemplatePart,
                    E.Template,
                    E.Await,
                    E.Yield,
                    E.If,
                    E.Import,
                }),
                512,
            );

            pub threadlocal var memory_allocator: ?*ASTMemoryAllocator = null;

            threadlocal var has_inited = false;
            pub threadlocal var disable_reset = false;
            pub fn create(allocator: std.mem.Allocator) void {
                if (has_inited or memory_allocator != null) {
                    return;
                }

                has_inited = true;
                _ = All.init(allocator);
            }

            pub fn reset() void {
                if (disable_reset or memory_allocator != null) return;
                All.reset();
            }

            pub fn deinit() void {
                if (!has_inited or memory_allocator != null) return;
                All.deinit();
                has_inited = false;
            }

            pub inline fn assert() void {
                if (comptime Environment.allow_assert) {
                    if (!has_inited and memory_allocator == null)
                        bun.unreachablePanic("Store must be init'd", .{});
                }
            }

            pub fn append(comptime ValueType: type, value: anytype) *ValueType {
                if (memory_allocator) |allocator| {
                    return allocator.append(ValueType, value);
                }

                return All.append(Disabler, ValueType, value);
            }

            pub fn toOwnedSlice() []*Store.All.Block {
                if (!has_inited or Store.All._self.overflow.used == 0 or disable_reset or memory_allocator != null) return &[_]*Store.All.Block{};
                return Store.All.reclaim();
            }
        };

        pub inline fn isStringValue(self: Data) bool {
            return @as(Expr.Tag, self) == .e_string;
        }
    };
};

test "Byte size of Expr" {
    try std.io.getStdErr().writeAll(comptime std.fmt.comptimePrint("\n\nByte Size {d}\n\n", .{@sizeOf(Expr.Data)}));
}

pub const EnumValue = struct {
    loc: logger.Loc,
    ref: Ref,
    name: E.String,
    value: ?ExprNodeIndex,
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
        value: []const u16,
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
                .expr => |e| switch (e.data) {
                    .e_class => |class| class.canBeMoved(),
                    .e_arrow, .e_function => true,
                    else => e.canBeConstValue(),
                },
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
        items: []ClauseItem = &([_]ClauseItem{}),
        star_name_loc: ?logger.Loc = null,
        import_record_index: u32,
        is_single_line: bool = false,
    };

    pub const Return = struct { value: ?ExprNodeIndex = null };
    pub const Throw = struct { value: ExprNodeIndex };

    pub const Local = struct {
        kind: Kind = Kind.k_var,
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

        pub const Kind = enum(u2) {
            k_var,
            k_let,
            k_const,
            pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
                return try std.json.stringify(@tagName(self), opts, o);
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
        un_pos,
        un_neg,
        un_cpl,
        un_not,
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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }

        pub fn unaryAssignTarget(code: Op.Code) AssignTarget {
            if (@enumToInt(code) >=
                @enumToInt(Op.Code.un_pre_dec) and @enumToInt(code) <=
                @enumToInt(Op.Code.un_post_inc))
            {
                return AssignTarget.update;
            }

            return AssignTarget.none;
        }
        pub fn isLeftAssociative(code: Op.Code) bool {
            return @enumToInt(code) >=
                @enumToInt(Op.Code.bin_add) and
                @enumToInt(code) < @enumToInt(Op.Code.bin_comma) and code != .bin_pow;
        }
        pub fn isRightAssociative(code: Op.Code) bool {
            return @enumToInt(code) >= @enumToInt(Op.Code.bin_assign) or code == .bin_pow;
        }
        pub fn binaryAssignTarget(code: Op.Code) AssignTarget {
            if (code == .bin_assign) {
                return AssignTarget.replace;
            }

            if (@enumToInt(code) > @enumToInt(Op.Code.bin_assign)) {
                return AssignTarget.update;
            }

            return AssignTarget.none;
        }

        pub fn isPrefix(code: Op.Code) bool {
            return @enumToInt(code) < @enumToInt(Op.Code.un_post_dec);
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
            return @enumToInt(self) < @enumToInt(b);
        }
        pub inline fn gt(self: Level, b: Level) bool {
            return @enumToInt(self) > @enumToInt(b);
        }
        pub inline fn gte(self: Level, b: Level) bool {
            return @enumToInt(self) >= @enumToInt(b);
        }
        pub inline fn lte(self: Level, b: Level) bool {
            return @enumToInt(self) <= @enumToInt(b);
        }
        pub inline fn eql(self: Level, b: Level) bool {
            return @enumToInt(self) == @enumToInt(b);
        }

        pub inline fn sub(self: Level, i: anytype) Level {
            return @intToEnum(Level, @enumToInt(self) - i);
        }

        pub inline fn addF(self: Level, i: anytype) Level {
            return @intToEnum(Level, @enumToInt(self) + i);
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

    pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(self.text, opts, o);
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
    externals: []u32 = &[_]u32{},
    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    has_top_level_return: bool = false,
    uses_exports_ref: bool = false,
    uses_module_ref: bool = false,
    uses_require_ref: bool = false,

    force_cjs_to_esm: bool = false,
    exports_kind: ExportsKind = ExportsKind.none,

    bundle_export_ref: ?Ref = null,

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
    url_for_css: ?string = null,
    parts: Part.List = Part.List{},
    // This list may be mutated later, so we should store the capacity
    symbols: Symbol.List = Symbol.List{},
    module_scope: Scope = Scope{},
    char_freq: ?CharFreq = null,
    exports_ref: Ref = Ref.None,
    module_ref: Ref = Ref.None,
    wrapper_ref: Ref = Ref.None,
    require_ref: Ref = Ref.None,

    bun_plugin: BunPlugin = .{},

    bundle_namespace_ref: ?Ref = null,

    prepend_part: ?Part = null,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    named_imports: NamedImports = NamedImports.init(bun.failing_allocator),
    named_exports: NamedExports = NamedExports.init(bun.failing_allocator),
    export_star_import_records: []u32 = &([_]u32{}),

    allocator: std.mem.Allocator,
    top_level_symbols_to_parts: TopLevelSymbolToParts = .{},

    commonjs_named_exports: CommonJSNamedExports = .{},

    redirect_import_record_index: ?u32 = null,

    /// Only populated when bundling
    target: bun.options.Target = .browser,

    const_values: ConstValuesMap = .{},

    pub const CommonJSNamedExport = struct {
        loc_ref: LocRef,
        needs_decl: bool = true,
    };
    pub const CommonJSNamedExports = bun.StringArrayHashMapUnmanaged(CommonJSNamedExport);

    pub const NamedImports = std.ArrayHashMap(Ref, NamedImport, RefHashCtx, true);
    pub const NamedExports = bun.StringArrayHashMap(NamedExport);
    pub const ConstValuesMap = std.ArrayHashMapUnmanaged(Ref, Expr, RefHashCtx, false);

    pub fn initTest(parts: []Part) Ast {
        return Ast{
            .parts = Part.List.init(parts),
            .allocator = bun.default_allocator,
            .runtime_imports = .{},
        };
    }

    pub const empty = Ast{ .parts = Part.List{}, .runtime_imports = .{}, .allocator = bun.default_allocator };

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
        if (this.externals.len > 0) bun.default_allocator.free(this.externals);
        if (this.symbols.len > 0) this.symbols.deinitWithAllocator(bun.default_allocator);
        if (this.import_records.len > 0) this.import_records.deinitWithAllocator(bun.default_allocator);
    }
};

pub const Span = struct {
    text: string = "",
    range: logger.Range = .{},
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

    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
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
            var new = this.*;

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
                @call(.always_inline, Fn, .{ ctx, ref });
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

    // Each is an index into the file-level import record list
    import_record_indices: ImportRecordIndices = .{},

    // All symbols that are declared in this part. Note that a given symbol may
    // have multiple declarations, and so may end up being declared in multiple
    // parts (e.g. multiple "var" declarations with the same name). Also note
    // that this list isn't deduplicated and may contain duplicates.
    declared_symbols: DeclaredSymbol.List = .{},

    // An estimate of the number of uses of all symbols used within this part.
    symbol_uses: SymbolUseMap = SymbolUseMap{},

    // The indices of the other parts in this file that are needed if this part
    // is needed.
    dependencies: Dependency.List = .{},

    // If true, this part can be removed if none of the declared symbols are
    // used. If the file containing this part is imported, then all parts that
    // don't have this flag enabled must be included.
    can_be_removed_if_unused: bool = false,

    // This is used for generated parts that we don't want to be present if they
    // aren't needed. This enables tree shaking for these parts even if global
    // tree shaking isn't enabled.
    force_tree_shaking: bool = false,

    // This is true if this file has been marked as live by the tree shaking
    // algorithm.
    is_live: bool = false,

    tag: Tag = Tag.none,

    valid_in_development: if (bun.Environment.allow_assert) bool else void = bun.DebugOnlyDefault(true),

    pub const Tag = enum {
        none,
        jsx_import,
        runtime,
        cjs_imports,
        react_fast_refresh,
        dirname_filename,
        bun_plugin,
        bun_test,
        dead_due_to_inlining,
        commonjs_named_export,
    };

    pub const SymbolUseMap = std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false);
    pub fn jsonStringify(self: *const Part, options: std.json.StringifyOptions, writer: anytype) !void {
        return std.json.stringify(self.stmts, options, writer);
    }
};

pub const Result = union(enum) {
    already_bundled: void,
    ast: Ast,
};

pub const StmtOrExpr = union(enum) {
    stmt: StmtNodeIndex,
    expr: ExprNodeIndex,
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
    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
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
            return @call(.always_inline, Ref.eql, .{ a.ref, b.ref }) and a.loc.start == b.loc.start;
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
                    .ts_namespace, .hoisted_function, .generator_or_async_function, .ts_enum, .class => {
                        return .keep_existing;
                    },
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

        // The scopes below stop hoisted variables from extending into parent scopes
        entry, // This is a module, TypeScript enum, or TypeScript namespace
        function_args,
        function_body,
        class_static_init,

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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
        return @enumToInt(s.kind) >= @enumToInt(Kind.entry);
    }
};

pub fn printmem(comptime format: string, args: anytype) void {
    defer Output.flush();
    Output.initTest();
    Output.print(format, args);
}

pub const BunPlugin = struct {
    ref: Ref = Ref.None,
    hoisted_stmts: std.ArrayListUnmanaged(Stmt) = .{},
};

pub const Macro = struct {
    const JavaScript = @import("root").bun.JSC;
    const JSCBase = @import("./bun.js/base.zig");
    const Resolver = @import("./resolver/resolver.zig").Resolver;
    const isPackagePath = @import("./resolver/resolver.zig").isPackagePath;
    const ResolveResult = @import("./resolver/resolver.zig").Result;
    const DotEnv = @import("./env_loader.zig");
    const js = @import("./bun.js/javascript_core_c_api.zig");
    const Zig = @import("./bun.js/bindings/exports.zig");
    const Bundler = bun.Bundler;
    const MacroEntryPoint = bun.bundler.MacroEntryPoint;
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

        pub fn init(bundler: *Bundler) MacroContext {
            return MacroContext{
                .macros = MacroMap.init(default_allocator),
                .resolver = &bundler.resolver,
                .env = bundler.env,
                .remap = bundler.options.macro_remap,
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
            args: []Expr,
            function_name: string,
            comptime Visitor: type,
            visitor: Visitor,
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

            std.debug.assert(!isMacroPath(import_record_path_without_macro_prefix));

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

            var specifier_buf: [64]u8 = undefined;
            var specifier_buf_len: u32 = 0;
            const hash = MacroEntryPoint.generateID(
                resolve_result.path_pair.primary.text,
                function_name,
                &specifier_buf,
                &specifier_buf_len,
            );

            var macro_entry = this.macros.getOrPut(hash) catch unreachable;
            if (!macro_entry.found_existing) {
                macro_entry.value_ptr.* = Macro.init(
                    default_allocator,
                    this.resolver,
                    resolve_result,
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
            return try Macro.Runner.run(
                macro,
                log,
                default_allocator,
                function_name,
                caller,
                args,
                source,
                hash,
                comptime Visitor,
                visitor,
                this.javascript_object,
            );
            // this.macros.getOrPut(key: K)
        }
    };

    pub const MacroResult = struct {
        import_statements: []S.Import = &[_]S.Import{},
        replacement: Expr,
    };

    pub const JSNode = struct {
        loc: logger.Loc,
        data: Data,
        visited: bool = false,

        pub const Class = JSCBase.NewClass(
            JSNode,
            .{
                .name = "JSNode",
                .read_only = true,
            },
            .{
                .toString = .{
                    .rfn = JSBindings.toString,
                },

                // .getAt = .{
                //     .rfn = JSBindings.getAt,
                // },
                // .valueAt = .{
                //     .rfn = JSBindings.valueAt,
                // },
                // .toNumber = .{
                //     .rfn = toNumber,
                // },
                .get = .{
                    .rfn = JSBindings.get,
                    .ro = true,
                },
            },
            .{
                .tag = .{
                    .get = JSBindings.getTag,
                    .ro = true,
                },

                .tagName = .{
                    .get = JSBindings.getTagName,
                    .ro = true,
                },
                .position = .{
                    .get = JSBindings.getPosition,
                    .ro = true,
                },
                .value = .{
                    .get = JSBindings.getValue,
                    .ro = true,
                },
                .arguments = .{
                    .get = JSBindings.getCallArgs,
                    .ro = true,
                },
                .properties = .{
                    .get = JSBindings.getProperties,
                    .ro = true,
                },
                .propertyNodes = .{
                    .get = JSBindings.getPropertyNodes,
                    .ro = true,
                },

                .namespace = .{
                    .get = JSBindings.getModuleNamespace,
                    .ro = true,
                },
            },
        );

        pub fn makeFromExpr(ctx: js.JSContextRef, allocator: std.mem.Allocator, expr: Expr) js.JSObjectRef {
            var ptr = allocator.create(JSNode) catch unreachable;
            ptr.* = JSNode.initExpr(expr);
            // If we look at JSObjectMake, we can see that all it does with the ctx value is lookup what the global object is
            // so it's safe to just avoid that and do it here like this:
            return JSNode.Class.make(ctx, ptr);
        }

        pub fn updateSymbolsMap(this: *const JSNode, comptime Visitor: type, visitor: Visitor) void {
            switch (this.data) {
                Tag.fragment => |frag| {
                    for (frag) |child| {
                        if (child.data == .inline_inject) {
                            child.updateSymbolsMap(Visitor, visitor);
                        }
                    }
                },
                Tag.inline_inject => |inject| {
                    for (inject) |child| {
                        child.updateSymbolsMap(Visitor, visitor);
                    }
                },

                Tag.s_import => |import| {
                    visitor.visitImport(import.*);
                },

                else => {},
            }
        }

        pub const JSBindings = struct {
            const getAllocator = JSCBase.getAllocator;

            threadlocal var temporary_call_args_array: [256]js.JSValueRef = undefined;
            pub fn getCallArgs(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                const args = this.data.callArgs();

                switch (args.len) {
                    0 => return js.JSObjectMakeArray(ctx, 0, null, exception),
                    1...255 => {
                        var slice = temporary_call_args_array[0..args.len];
                        for (slice, 0..) |_, i| {
                            var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                            node.* = JSNode.initExpr(args.ptr[i]);
                            slice[i] = JSNode.Class.make(ctx, node);
                        }
                        return js.JSObjectMakeArray(ctx, args.len, slice.ptr, exception);
                    },
                    else => {
                        Output.prettyErrorln("are you for real? {d} args to your call expression? that has to be a bug.\n", .{args.len});
                        Output.flush();
                        return js.JSObjectMakeArray(ctx, 0, null, exception);
                    },
                }
            }

            pub fn getProperties(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                if (this.data != .e_object) {
                    return js.JSObjectMake(ctx, null, null);
                }

                var lazy = getAllocator(ctx).create(LazyPropertiesObject) catch unreachable;
                lazy.* = LazyPropertiesObject{ .node = this.* };
                return LazyPropertiesObject.Class.make(ctx, lazy);
            }

            pub fn getPropertyNodes(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                const args: []G.Property = if (this.data == .e_object) this.data.e_object.properties.slice() else &[_]G.Property{};

                switch (args.len) {
                    0 => return js.JSObjectMakeArray(ctx, 0, null, exception),
                    1...255 => {
                        var slice = temporary_call_args_array[0..args.len];
                        for (slice, 0..) |_, i| {
                            var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                            node.* = JSNode{ .data = .{ .g_property = &args[i] }, .loc = this.loc };
                            slice[i] = JSNode.Class.make(ctx, node);
                        }
                        return js.JSObjectMakeArray(ctx, args.len, slice.ptr, exception);
                    },
                    else => {
                        return js.JSObjectMakeArray(ctx, 0, null, exception);
                    },
                }
            }

            pub fn getModuleNamespace(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                if (this.data != .s_import) return js.JSValueMakeUndefined(ctx);

                var module_namespace = getAllocator(ctx).create(ModuleNamespace) catch unreachable;
                module_namespace.* = ModuleNamespace{ .import_data = this.data.s_import.* };
                return ModuleNamespace.Class.make(ctx, module_namespace);
            }

            fn toNumberValue(_: *JSNode, number: E.Number) js.JSValueRef {
                return JSC.JSValue.jsNumberFromDouble(number.value).asRef();
            }

            fn toStringValue(_: *JSNode, ctx: js.JSContextRef, str: E.String) js.JSObjectRef {
                if (str.isBlank()) {
                    return JSC.ZigString.init("").toValue(ctx.ptr()).asRef();
                }

                if (str.isUTF8()) {
                    return JSC.ZigString.init(str.data).toValue(ctx.ptr()).asRef();
                } else {
                    return js.JSValueMakeString(ctx, js.JSStringCreateWithCharactersNoCopy(str.slice16().ptr, str.slice16().len));
                }
            }

            threadlocal var regex_value_array: [2]js.JSValueRef = undefined;

            fn toRegexValue(_: *JSNode, ctx: js.JSContextRef, regex: *E.RegExp, exception: js.ExceptionRef) js.JSObjectRef {
                if (regex.value.len == 0) {
                    return js.JSObjectMakeRegExp(ctx, 0, null, exception);
                }

                regex_value_array[0] = JSC.ZigString.init(regex.pattern()).toValue(ctx.ptr()).asRef();
                regex_value_array[1] = JSC.ZigString.init(regex.flags()).toValue(ctx.ptr()).asRef();

                return js.JSObjectMakeRegExp(ctx, 2, &regex_value_array, exception);
            }

            fn toArrayValue(_: *JSNode, ctx: js.JSContextRef, array: E.Array, exception: js.ExceptionRef) js.JSObjectRef {
                const items = array.slice();

                if (items.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                for (items, 0..) |expr, i| {
                    var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                    node.* = JSNode.initExpr(expr);
                    temporary_call_args_array[i] = JSNode.Class.make(ctx, node);
                }

                return js.JSObjectMakeArray(ctx, items.len, &temporary_call_args_array, exception);
            }

            fn toArrayPrimitive(_: *JSNode, ctx: js.JSContextRef, array: E.Array, exception: js.ExceptionRef) js.JSObjectRef {
                const items = array.slice();
                if (items.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                var node: JSNode = undefined;
                for (items, 0..) |expr, i| {
                    node = JSNode.initExpr(expr);
                    temporary_call_args_array[i] = toPrimitive(&node, ctx, exception);
                }

                return js.JSObjectMakeArray(ctx, items.len, temporary_call_args_array[0..items.len].ptr, exception);
            }

            fn toObjectValue(this: *JSNode, ctx: js.JSContextRef, obj: E.Object, exception: js.ExceptionRef) js.JSObjectRef {
                if (obj.properties.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                var object_properties_array: [64]js.JSObjectRef = undefined;

                var did_allocate = false;
                var properties_list = if (obj.properties.len < object_properties_array.len)
                    object_properties_array[0..obj.properties.len]
                else brk: {
                    did_allocate = true;
                    break :brk getAllocator(ctx).alloc(js.JSObjectRef, obj.properties.len) catch unreachable;
                };

                defer if (did_allocate) getAllocator(ctx).free(properties_list);

                for (obj.properties.slice(), 0..) |_, i| {
                    var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                    node.* = JSNode{
                        .data = .{
                            .g_property = &obj.properties.ptr[i],
                        },
                        .loc = this.loc,
                    };
                    properties_list[i] = JSNode.Class.make(ctx, node);
                }

                return js.JSObjectMakeArray(ctx, properties_list.len, properties_list.ptr, exception);
            }

            fn toObjectPrimitive(this: *JSNode, ctx: js.JSContextRef, _: E.Object, _: js.ExceptionRef) js.JSObjectRef {
                var lazy = getAllocator(ctx).create(LazyPropertiesObject) catch unreachable;
                lazy.* = LazyPropertiesObject{ .node = this.* };
                return LazyPropertiesObject.Class.make(ctx, lazy);
            }

            fn toPropertyPrimitive(_: *JSNode, ctx: js.JSContextRef, prop: G.Property, exception: js.ExceptionRef) js.JSObjectRef {
                var entries: [3]js.JSValueRef = undefined;

                entries[0] = js.JSValueMakeUndefined(ctx);
                entries[1] = entries[0];
                entries[2] = entries[0];

                var other: JSNode = undefined;

                if (prop.key) |key| {
                    other = JSNode.initExpr(key);
                    entries[0] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                if (prop.value) |value| {
                    other = JSNode.initExpr(value);
                    entries[1] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                if (prop.initializer) |value| {
                    other = JSNode.initExpr(value);
                    entries[2] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                const out = js.JSObjectMakeArray(ctx, 3, &entries, exception);
                return out;
            }

            pub fn toString(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: []const js.JSValueRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                switch (this.data) {
                    .e_string => |str| {
                        return toStringValue(this, ctx, str.*);
                    },
                    .e_template => |template| {
                        const str = template.head;

                        if (str.isBlank()) {
                            return JSC.ZigString.init("").toValue(ctx.ptr()).asRef();
                        }

                        if (str.isUTF8()) {
                            return JSC.ZigString.init(str.data).toValue(ctx.ptr()).asRef();
                        } else {
                            return js.JSValueMakeString(ctx, js.JSStringCreateWithCharactersNoCopy(str.slice16().ptr, str.slice16().len));
                        }
                    },
                    // .e_number => |number| {

                    // },
                    else => {
                        return JSC.ZigString.init("").toValue(ctx.ptr()).asRef();
                    },
                }
            }

            fn toPrimitive(
                this: *JSNode,
                ctx: js.JSContextRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                return @call(.always_inline, toPrimitiveAllowRecursion, .{ this, ctx, exception, false });
            }

            fn toPrimitiveWithRecursion(
                this: *JSNode,
                ctx: js.JSContextRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                return @call(.always_inline, toPrimitiveAllowRecursion, .{ this, ctx, exception, true });
            }

            fn toPrimitiveAllowRecursion(this: *JSNode, ctx: js.JSContextRef, exception: js.ExceptionRef, comptime _: bool) js.JSValueRef {
                switch (this.data) {
                    .e_string => |str| {
                        return JSBindings.toStringValue(this, ctx, str.*);
                    },
                    .e_template => |template| {
                        return JSBindings.toStringValue(this, ctx, template.head);
                        // return JSBindings.toTemplatePrimitive(this, ctx, template.*);
                    },
                    .e_number => |number| {
                        return JSBindings.toNumberValue(this, number);
                    },
                    .e_reg_exp => |regex| {
                        return JSBindings.toRegexValue(this, ctx, regex, exception);
                    },
                    .e_object => |object| {
                        return JSBindings.toObjectPrimitive(this, ctx, object.*, exception);
                    },
                    .e_array => |array| {
                        return JSBindings.toArrayPrimitive(this, ctx, array.*, exception);
                    },

                    // Returns an Entry
                    // [string, number | regex | object | string | null | undefined]
                    .g_property => |property| {
                        return JSBindings.toPropertyPrimitive(this, ctx, property.*, exception);
                    },
                    .e_null => {
                        return js.JSValueMakeNull(ctx);
                    },
                    else => {
                        return js.JSValueMakeUndefined(ctx);
                    },
                }
            }

            fn toValue(this: *JSNode, ctx: js.JSContextRef, exception: js.ExceptionRef) js.JSObjectRef {
                switch (this.data) {
                    .e_await => |aw| {
                        return JSNode.makeFromExpr(ctx, getAllocator(ctx), aw.value);
                    },
                    .e_yield => |yi| {
                        return JSNode.makeFromExpr(ctx, getAllocator(ctx), yi.value orelse return null);
                    },
                    .e_spread => |spread| {
                        return JSNode.makeFromExpr(ctx, getAllocator(ctx), spread.value);
                    },
                    .e_reg_exp => |reg| {
                        return JSC.ZigString.toRef(reg.value, ctx.ptr());
                    },

                    .e_array => |array| {
                        return toArrayValue(this, ctx, array.*, exception);
                    },
                    .e_object => |obj| {
                        return toObjectValue(this, ctx, obj.*, exception);
                    },
                    else => {
                        return null;
                    },
                }
            }

            pub fn getValue(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                _: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return toValue(this, ctx, exception) orelse return thisObject;
            }

            pub fn get(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return toPrimitiveWithRecursion(this, ctx, exception) orelse return js.JSValueMakeUndefined(ctx);
            }

            pub fn getTag(
                this: *JSNode,
                _: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.JSValue.jsNumberFromU16(@intCast(u16, @enumToInt(std.meta.activeTag(this.data)))).asRef();
            }
            pub fn getTagName(
                this: *JSNode,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.ZigString.init(@tagName(this.data)).toValue(ctx.ptr()).asRef();
            }
            pub fn getPosition(
                this: *JSNode,
                _: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.JSValue.jsNumberFromInt32(this.loc.start).asRef();
            }
        };

        pub fn initExpr(this: Expr) JSNode {
            switch (this.data) {
                .e_array => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_array = value } };
                },
                .e_unary => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_unary = value } };
                },
                .e_binary => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_binary = value } };
                },
                .e_function => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_function = value } };
                },
                .e_new_target => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_new_target = value } };
                },
                .e_import_meta => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import_meta = value } };
                },
                .e_call => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_call = value } };
                },
                .e_dot => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_dot = value } };
                },
                .e_index => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_index = value } };
                },
                .e_arrow => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_arrow = value } };
                },
                .e_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_identifier = value } };
                },
                .e_import_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import_identifier = value } };
                },
                .e_private_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_private_identifier = value } };
                },
                .e_jsx_element => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_jsx_element = value } };
                },
                .e_big_int => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_big_int = value } };
                },
                .e_object => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_object = value } };
                },
                .e_spread => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_spread = value } };
                },
                .e_string => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_string = value } };
                },
                .e_template_part => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_template_part = value } };
                },
                .e_template => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_template = value } };
                },
                .e_reg_exp => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_reg_exp = value } };
                },
                .e_await => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_await = value } };
                },
                .e_yield => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_yield = value } };
                },
                .e_if => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_if = value } };
                },
                .e_require_resolve_string => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_require_resolve_string = value } };
                },
                .e_import => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import = value } };
                },
                .e_this => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_this = value } };
                },
                .e_class => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_class = value } };
                },
                .e_require_string => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_require_string = value } };
                },
                .e_missing => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_missing = value } };
                },
                .e_boolean => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_boolean = value } };
                },
                .e_super => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_super = value } };
                },
                .e_null => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_null = value } };
                },
                .e_number => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_number = value } };
                },
                .e_undefined => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_undefined = value } };
                },
                .inline_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .inline_identifier = value } };
                },
                else => {
                    if (comptime Environment.isDebug) {
                        Output.prettyWarnln("initExpr fail: {s}", .{@tagName(this.data)});
                    }
                    return JSNode{ .loc = this.loc, .data = .{ .e_missing = .{} } };
                },
            }
        }

        pub fn toExpr(this: JSNode) Expr {
            switch (this.data) {
                .e_array => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_array = value } };
                },
                .e_unary => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_unary = value } };
                },
                .e_binary => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_binary = value } };
                },
                .e_function => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_function = value } };
                },
                .e_new_target => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_new_target = value } };
                },
                .e_import_meta => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import_meta = value } };
                },
                .e_call => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_call = value } };
                },
                .e_dot => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_dot = value } };
                },
                .e_index => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_index = value } };
                },
                .e_arrow => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_arrow = value } };
                },
                .e_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_identifier = value } };
                },
                .e_import_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import_identifier = value } };
                },
                .e_private_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_private_identifier = value } };
                },
                .e_jsx_element => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_jsx_element = value } };
                },
                .e_big_int => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_big_int = value } };
                },
                .e_object => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_object = value } };
                },
                .e_spread => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_spread = value } };
                },
                .e_string => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_string = value } };
                },
                .e_template_part => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_template_part = value } };
                },
                .e_template => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_template = value } };
                },
                .e_reg_exp => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_reg_exp = value } };
                },
                .e_await => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_await = value } };
                },
                .e_yield => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_yield = value } };
                },
                .e_if => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_if = value } };
                },
                .e_require_resolve_string => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_require_resolve_string = value } };
                },
                .e_import => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import = value } };
                },
                .e_this => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_this = value } };
                },
                .e_class => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_class = value } };
                },
                .e_require_string => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_require_string = value } };
                },
                .e_missing => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_missing = value } };
                },
                .e_boolean => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_boolean = value } };
                },
                .e_super => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_super = value } };
                },
                .e_null => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_null = value } };
                },
                .e_number => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_number = value } };
                },
                .e_undefined => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_undefined = value } };
                },
                .inline_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .inline_identifier = value } };
                },
                .fragment => |fragment| {
                    if (fragment.len == 0) return Expr{ .loc = this.loc, .data = .{ .e_missing = E.Missing{} } };

                    var left = toExpr(fragment[0]);

                    if (fragment.len == 1) return left;

                    for (fragment[1..]) |item| {
                        const right = toExpr(item);
                        left = Expr.joinWithComma(left, right, default_allocator);
                    }

                    return left;
                },
                else => {
                    return Expr{ .loc = this.loc, .data = .{ .e_missing = .{} } };
                },
            }
        }

        // S.Import but with the path
        pub const ImportData = struct {
            import: S.Import,
            path: string,
        };

        pub const Data = union(Tag) {
            inline_false: void,
            inline_true: void,
            e_boolean: E.Boolean,
            fragment: []JSNode,

            e_super: E.Super,
            e_null: E.Null,
            e_number: E.Number,
            e_undefined: E.Undefined,
            e_new_target: E.NewTarget,
            e_import_meta: E.ImportMeta,
            e_missing: E.Missing,
            e_this: E.This,

            e_array: *E.Array,
            e_unary: *E.Unary,
            e_binary: *E.Binary,
            e_function: *E.Function,

            e_call: *E.Call,
            e_dot: *E.Dot,
            e_index: *E.Index,
            e_arrow: *E.Arrow,

            e_identifier: E.Identifier,
            e_import_identifier: E.ImportIdentifier,
            e_private_identifier: E.PrivateIdentifier,

            e_jsx_element: *E.JSXElement,

            e_big_int: *E.BigInt,
            e_object: *E.Object,
            e_spread: *E.Spread,
            e_string: *E.String,
            e_template_part: *E.TemplatePart,
            e_template: *E.Template,

            e_await: *E.Await,
            e_yield: *E.Yield,
            e_if: *E.If,

            e_import: *E.Import,

            e_class: *E.Class,

            s_import: *ImportData,
            s_block: *S.Block,

            e_reg_exp: *E.RegExp,
            e_require_resolve_string: E.RequireResolveString,
            e_require_string: E.RequireString,

            g_property: *G.Property,

            inline_inject: []JSNode,
            inline_identifier: i32,

            pub fn callArgs(this: Data) ExprNodeList {
                if (this == .e_call)
                    return this.e_call.args
                else
                    return ExprNodeList{};
            }

            pub fn booleanValue(this: Data) bool {
                return switch (this) {
                    .inline_false => false,
                    .inline_true => true,
                    .e_boolean => this.e_boolean.value,
                };
            }
        };
        pub const Tag = enum(u8) {
            e_array,
            e_unary,
            e_binary,
            e_function,
            e_new_target,
            e_import_meta,
            e_call,
            e_dot,
            e_index,
            e_arrow,
            e_identifier,
            e_import_identifier,
            e_private_identifier,
            e_jsx_element,
            e_big_int,
            e_object,
            e_spread,
            e_string,
            e_template_part,
            e_template,
            e_reg_exp,
            e_await,
            e_yield,
            e_if,
            e_require_resolve_string,
            e_import,
            e_this,
            e_class,
            e_require_string,
            s_import,
            s_block,

            g_property,

            e_missing,
            e_boolean,
            e_super,
            e_null,
            e_number,
            e_undefined,

            inline_true,
            inline_false,
            inline_inject,
            inline_identifier,

            fragment,

            pub const ids: std.EnumArray(Tag, Expr.Data) = brk: {
                var list = std.EnumArray(Tag, Expr.Data).initFill(Expr.Data{ .e_number = E.Number{ .value = 0.0 } });
                const fields: []const std.builtin.Type.EnumField = @typeInfo(Tag).Enum.fields;
                for (fields) |field| {
                    list.set(@intToEnum(Tag, field.value), Expr.Data{ .e_number = E.Number{ .value = @intToFloat(f64, field.value) } });
                }

                break :brk list;
            };

            pub const names = ComptimeStringMap(Tag, .{
                .{ "array", Tag.e_array },
                .{ "unary", Tag.e_unary },
                .{ "binary", Tag.e_binary },
                .{ "bool", Tag.e_boolean },
                .{ "super", Tag.e_super },
                .{ "null", Tag.e_null },
                .{ "undefined", Tag.e_undefined },
                .{ "function", Tag.e_function },
                .{ "new_target", Tag.e_new_target },
                .{ "import-meta", Tag.e_import_meta },
                .{ "call", Tag.e_call },
                .{ "dot", Tag.e_dot },
                .{ "index", Tag.e_index },
                .{ "arrow", Tag.e_arrow },
                .{ "import-id", Tag.e_import_identifier },
                .{ "private-id", Tag.e_private_identifier },
                .{ "jsx", Tag.e_jsx_element },
                .{ "missing", Tag.e_missing },
                .{ "number", Tag.e_number },
                .{ "bigint", Tag.e_big_int },
                .{ "object", Tag.e_object },
                .{ "spread", Tag.e_spread },
                .{ "string", Tag.e_string },
                .{ "template-part", Tag.e_template_part },
                .{ "template", Tag.e_template },
                .{ "regex", Tag.e_reg_exp },
                .{ "await", Tag.e_await },
                .{ "yield", Tag.e_yield },
                .{ "if", Tag.e_if },
                .{ "dynamic", Tag.e_import },
                .{ "this", Tag.e_this },
                .{ "class", Tag.e_class },
                .{ "require", Tag.e_require_string },
                .{ "import", Tag.s_import },
                .{ "property", Tag.g_property },
                .{ "block", Tag.s_block },
                .{ "true", Tag.inline_true },
                .{ "false", Tag.inline_false },
                .{ "inject", Tag.inline_inject },

                .{ "id", Tag.inline_identifier },
            });

            pub const as_expr_tag: std.EnumArray(Tag, Expr.Tag) = brk: {
                var list = std.EnumArray(Tag, Expr.Tag).initFill(Expr.Tag.e_missing);
                list.set(Tag.e_array, Expr.Tag.e_array);
                list.set(Tag.e_unary, Expr.Tag.e_unary);
                list.set(Tag.e_binary, Expr.Tag.e_binary);
                list.set(Tag.e_boolean, Expr.Tag.e_boolean);
                list.set(Tag.e_super, Expr.Tag.e_super);
                list.set(Tag.e_null, Expr.Tag.e_null);
                list.set(Tag.e_undefined, Expr.Tag.e_undefined);
                list.set(Tag.e_function, Expr.Tag.e_function);
                list.set(Tag.e_new_target, Expr.Tag.e_new_target);
                list.set(Tag.e_import_meta, Expr.Tag.e_import_meta);
                list.set(Tag.e_call, Expr.Tag.e_call);
                list.set(Tag.e_dot, Expr.Tag.e_dot);
                list.set(Tag.e_index, Expr.Tag.e_index);
                list.set(Tag.e_arrow, Expr.Tag.e_arrow);
                list.set(Tag.e_identifier, Expr.Tag.e_identifier);
                list.set(Tag.e_import_identifier, Expr.Tag.e_import_identifier);
                list.set(Tag.e_private_identifier, Expr.Tag.e_private_identifier);
                list.set(Tag.e_jsx_element, Expr.Tag.e_jsx_element);
                list.set(Tag.e_missing, Expr.Tag.e_missing);
                list.set(Tag.e_number, Expr.Tag.e_number);
                list.set(Tag.e_big_int, Expr.Tag.e_big_int);
                list.set(Tag.e_object, Expr.Tag.e_object);
                list.set(Tag.e_spread, Expr.Tag.e_spread);
                list.set(Tag.e_string, Expr.Tag.e_string);
                list.set(Tag.e_template_part, Expr.Tag.e_template_part);
                list.set(Tag.e_template, Expr.Tag.e_template);
                list.set(Tag.e_reg_exp, Expr.Tag.e_reg_exp);
                list.set(Tag.e_await, Expr.Tag.e_await);
                list.set(Tag.e_yield, Expr.Tag.e_yield);
                list.set(Tag.e_if, Expr.Tag.e_if);
                list.set(Tag.e_require_resolve_string, Expr.Tag.e_require_resolve_string);
                list.set(Tag.e_import, Expr.Tag.e_import);
                list.set(Tag.e_this, Expr.Tag.e_this);
                list.set(Tag.e_class, Expr.Tag.e_class);
                list.set(Tag.e_require_string, Expr.Tag.e_require_string);
                break :brk list;
            };

            pub const to_expr_tag: std.EnumArray(Expr.Tag, Tag) = brk: {
                var list = std.EnumArray(Expr.Tag, Tag).initFill(Tag.wip);
                list.set(Expr.Tag.e_array, Tag.e_array);
                list.set(Expr.Tag.e_unary, Tag.e_unary);
                list.set(Expr.Tag.e_binary, Tag.e_binary);
                list.set(Expr.Tag.e_boolean, Tag.e_boolean);
                list.set(Expr.Tag.e_super, Tag.e_super);
                list.set(Expr.Tag.e_null, Tag.e_null);
                list.set(Expr.Tag.e_undefined, Tag.e_undefined);
                list.set(Expr.Tag.e_function, Tag.e_function);
                list.set(Expr.Tag.e_new_target, Tag.e_new_target);
                list.set(Expr.Tag.e_import_meta, Tag.e_import_meta);
                list.set(Expr.Tag.e_call, Tag.e_call);
                list.set(Expr.Tag.e_dot, Tag.e_dot);
                list.set(Expr.Tag.e_index, Tag.e_index);
                list.set(Expr.Tag.e_arrow, Tag.e_arrow);
                list.set(Expr.Tag.e_identifier, Tag.e_identifier);
                list.set(Expr.Tag.e_import_identifier, Tag.e_import_identifier);
                list.set(Expr.Tag.e_private_identifier, Tag.e_private_identifier);
                list.set(Expr.Tag.e_jsx_element, Tag.e_jsx_element);
                list.set(Expr.Tag.e_missing, Tag.e_missing);
                list.set(Expr.Tag.e_number, Tag.e_number);
                list.set(Expr.Tag.e_big_int, Tag.e_big_int);
                list.set(Expr.Tag.e_object, Tag.e_object);
                list.set(Expr.Tag.e_spread, Tag.e_spread);
                list.set(Expr.Tag.e_string, Tag.e_string);
                list.set(Expr.Tag.e_template_part, Tag.e_template_part);
                list.set(Expr.Tag.e_template, Tag.e_template);
                list.set(Expr.Tag.e_reg_exp, Tag.e_reg_exp);
                list.set(Expr.Tag.e_await, Tag.e_await);
                list.set(Expr.Tag.e_yield, Tag.e_yield);
                list.set(Expr.Tag.e_if, Tag.e_if);
                list.set(Expr.Tag.e_require_resolve_string, Tag.e_require_resolve_string);
                list.set(Expr.Tag.e_import, Tag.e_import);
                list.set(Expr.Tag.e_this, Tag.e_this);
                list.set(Expr.Tag.e_class, Tag.e_class);
                list.set(Expr.Tag.e_require_string, Tag.e_require_string);
                break :brk list;
            };

            pub const Validator = struct {
                pub const List = std.EnumArray(JSNode.Tag, bool);
                fn NewList(comptime valid_tags: anytype) List {
                    return comptime brk: {
                        var list = List.initFill(false);
                        for (std.meta.fieldNames(@TypeOf(valid_tags))) |index| {
                            const name = @tagName(@field(valid_tags, index));

                            if (!@hasField(JSNode.Tag, name)) {
                                @compileError(
                                    "JSNode.Tag does not have a \"" ++ name ++ "\" field. Valid fields are " ++ std.fmt.comptimePrint(
                                        "{s}",
                                        .{
                                            std.meta.fieldNames(@TypeOf(valid_tags)),
                                        },
                                    ),
                                );
                            }
                            list.set(@field(JSNode.Tag, name), true);
                        }

                        break :brk list;
                    };
                }

                pub const valid_object_tags = Tag.Validator.NewList(.{
                    .g_property,
                    .e_spread,
                    .e_identifier,
                    .e_import_identifier,
                    .e_index,
                    .e_call,
                    .e_private_identifier,
                    .e_dot,
                    .e_unary,
                    .e_binary,
                });

                pub const valid_inject_tags = Tag.Validator.NewList(.{
                    .s_import,
                });
            };

            pub const max_tag: u8 = brk: {
                const Enum: std.builtin.Type.Enum = @typeInfo(Tag).Enum;
                var max_value: u8 = 0;
                for (Enum.fields) |field| {
                    max_value = std.math.max(@as(u8, field.value), max_value);
                }
                break :brk max_value;
            };

            pub const min_tag: u8 = brk: {
                const Enum: std.builtin.Type.Enum = @typeInfo(Tag).Enum;
                var min: u8 = 255;
                for (Enum.fields) |field| {
                    min = std.math.min(@as(u8, field.value), min);
                }
                break :brk min;
            };
        };

        pub const JSNodeList = std.ArrayListUnmanaged(JSNode);

        pub fn NewJSXWriter(comptime P: type) type {
            return struct {
                const JSXWriter = @This();
                p: *P,
                bun_jsx_ref: Ref,
                log: *logger.Log,
                args: ExprList,
                bun_identifier: *E.Identifier,
                allocator: std.mem.Allocator,
                parent_tag: Tag = Tag.e_missing,

                pub fn initWriter(p: *P, bun_identifier: *E.Identifier) JSXWriter {
                    return JSXWriter{
                        .p = p,
                        .log = p.log,
                        .bun_jsx_ref = p.bun_jsx_ref,
                        .args = ExprList.init(p.allocator),
                        .allocator = p.allocator,
                        .bun_identifier = bun_identifier,
                    };
                }

                fn hasPropertyNamed(props: []G.Property, comptime name: string) bool {
                    return indexOfPropertyByName(props, name) != null;
                }

                fn indexOfPropertyByName(props: []G.Property, comptime name: string) ?u32 {
                    for (props, 0..) |prop, i| {
                        const key = prop.key orelse continue;
                        if (key.data != .e_string or !key.data.e_string.isUTF8()) continue;
                        if (strings.eqlComptime(key.data.e_string.data, name)) return @intCast(u32, i);
                    }

                    return null;
                }

                fn propertyValueNamed(props: []G.Property, comptime name: string) ?Expr {
                    for (props) |prop| {
                        const key = prop.key orelse continue;
                        if (key.data != .e_string or !key.data.e_string.isUTF8()) continue;
                        if (strings.eqlComptime(key.data.e_string.data, name)) return prop.value;
                    }

                    return null;
                }

                pub fn writeNodeType(self: *JSXWriter, tag: JSNode.Tag, props: []G.Property, children: []Expr, loc: logger.Loc) bool {
                    switch (tag) {

                        // <bool value={foo} />
                        // intended for dynamic values
                        Tag.e_boolean => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_boolean) });
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<bool> should have a \"value\" prop") catch unreachable;
                                self.args.append(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = loc }) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = loc };

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" shouldn't be a string") catch unreachable;
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = value.loc });
                                },
                                .e_boolean => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = value.loc });
                                },
                                // null and undefined literals are coerced to false
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = false } }, .loc = value.loc });
                                },
                                .e_number => {
                                    // Numbers are cooerced to booleans
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = value.data.e_number.value > 0.0 } }, .loc = value.loc });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" should be a bool, jsx element, number, identifier, index, call, private identifier, or dot") catch unreachable;
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = false } }, .loc = value.loc });
                                },
                            }

                            return true;
                        },
                        // <number value={1.0} />
                        Tag.e_number => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_number) });
                            const invalid_value = Expr{ .data = .{ .e_number = .{ .value = 0.0 } }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<number> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.log.addError(self.p.source, loc, "<number> should not be a string.") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                .e_boolean => {
                                    // Booleans are cooerced to numbers
                                    self.args.appendAssumeCapacity(
                                        Expr{
                                            .data = .{
                                                .e_number = E.Number{
                                                    .value = @intToFloat(f64, @boolToInt(value.data.e_boolean.value)),
                                                },
                                            },
                                            .loc = value.loc,
                                        },
                                    );
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null and undefined literals are coerced to 0
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_number = .{ .value = 0 } }, .loc = value.loc });
                                },
                                // <number>123</number>
                                .e_number => {
                                    // Numbers are cooerced to booleans
                                    self.args.appendAssumeCapacity(value);
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<number value> should be a number, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.e_big_int => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_big_int) });
                            const invalid_value = Expr{ .data = .{ .e_big_int = &E.BigInt.empty }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<big-int> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => |str| {
                                    self.args.appendAssumeCapacity(Expr.init(E.BigInt, E.BigInt{ .value = std.mem.trimRight(u8, str.data, "n") }, value.loc));
                                },
                                .e_big_int => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null and undefined literals are coerced to 0
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_big_int = &E.BigInt.empty }, .loc = value.loc });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" should be a BigInt, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.e_array => {
                            self.args.ensureUnusedCapacity(2 + children.len) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_array) });
                            const children_count = @truncate(u16, children.len);
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = E.Number{ .value = @intToFloat(f64, children_count) } } });

                            var old_parent = self.parent_tag;
                            self.parent_tag = Tag.e_array;
                            defer self.parent_tag = old_parent;
                            for (children) |child| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    // TODO: handle when simplification changes the expr type
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited_expr = self.p.visitExpr(child);
                                        switch (visited_expr.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElement(el.*)) return false;
                                            },
                                            .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited_expr) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, visited_expr.loc, "<array> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = visited_expr.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<array> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        Tag.e_object => {
                            self.args.ensureUnusedCapacity(2 + children.len) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_object) });
                            const children_count = @truncate(u16, children.len);
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = E.Number{ .value = @intToFloat(f64, children_count) } } });

                            var old_parent = self.parent_tag;
                            self.parent_tag = Tag.e_object;
                            defer self.parent_tag = old_parent;

                            for (children) |child| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_object_tags)) return false;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited = self.p.visitExpr(child);
                                        switch (visited.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_object_tags)) return false;
                                            },
                                            .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, child.loc, "<object> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<object> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },

                        Tag.g_property => {
                            const name_property = propertyValueNamed(props, "name");
                            const value_property = propertyValueNamed(props, "value");
                            const init_property = propertyValueNamed(props, "init");

                            var old_parent = self.parent_tag;
                            if (old_parent != .e_object) {
                                self.args.append(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.g_property) }) catch unreachable;
                            }

                            self.parent_tag = Tag.g_property;
                            defer self.parent_tag = old_parent;

                            if (value_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "value should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            } else {
                                self.args.append(Expr{ .data = comptime Tag.ids.get(.e_undefined), .loc = loc }) catch unreachable;
                            }

                            if (init_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },

                                    .e_template, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "init should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            } else {
                                self.args.append(Expr{ .data = comptime Tag.ids.get(.e_undefined), .loc = loc }) catch unreachable;
                            }

                            if (name_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    .e_string => {
                                        self.args.append(prop) catch unreachable;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "should only contain other jsx elements or a string") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        Tag.e_string => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_string) });
                            const invalid_value = Expr{ .data = .{ .e_string = &E.String.empty }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<string> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null is cooerced to "null"
                                .e_null => {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = &E.String.null } });
                                },
                                // undefined is cooerced to "undefined"
                                .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = &E.String.undefined } });
                                },
                                .e_boolean => |boolean| {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = if (boolean.value) &E.String.true else &E.String.false } });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<string value> should be a string, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }
                        },
                        Tag.e_reg_exp => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_reg_exp) });
                            const invalid_value = Expr{ .data = .{ .e_reg_exp = &E.RegExp.empty }, .loc = loc };

                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<regex> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };

                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_string => |str| {
                                    self.args.appendAssumeCapacity(Expr.init(E.RegExp, E.RegExp{ .value = str.data }, value.loc));
                                },
                                .e_reg_exp => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing, .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<regex value> should be a string, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.inline_inject => {

                            // For <inject>, immediate children must be JSX types or arrays
                            if (props.len > 0) {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "<inject> does not accept props",
                                ) catch unreachable;
                            }

                            var count: usize = children.len;
                            for (children) |c| {
                                count += switch (c.data) {
                                    .e_jsx_element => if (c.data.e_jsx_element.tag != null) 1 else brk: {
                                        break :brk c.data.e_jsx_element.children.len;
                                    },
                                    else => 1,
                                };
                            }
                            self.args.ensureUnusedCapacity(2 + count) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.inline_inject) });
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = .{ .value = @intToFloat(f64, @intCast(u32, children.len)) } } });

                            const old_parent_tag = self.parent_tag;
                            self.parent_tag = Tag.inline_inject;
                            defer self.parent_tag = old_parent_tag;

                            for (children) |child| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_inject_tags)) return false;
                                    },
                                    else => {
                                        self.args.append(self.p.visitExpr(child)) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },

                        Tag.inline_identifier => {
                            // id only accepts "to" and it must be a int32
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.inline_identifier) });

                            if (propertyValueNamed(props, "to")) |prop| {
                                switch (prop.data) {
                                    .e_number, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(self.p.visitExpr(prop));
                                    },
                                    else => {
                                        self.log.addError(
                                            self.p.source,
                                            prop.loc,
                                            "\"to\" prop must be a number",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(prop);
                                    },
                                }
                            } else {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "\"to\" prop is required",
                                ) catch unreachable;
                                self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = .{ .value = 0 } } });
                            }

                            return true;
                        },

                        Tag.s_import => {
                            var p = self.p;
                            const default_property_ = propertyValueNamed(props, "default");
                            const path_property = propertyValueNamed(props, "path") orelse {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "<import> must have a path",
                                ) catch unreachable;
                                return false;
                            };
                            const namespace_ = propertyValueNamed(props, "namespace");

                            const items_count: u32 = 1 +
                                @intCast(u32, @boolToInt(namespace_ != null));

                            self.args.ensureUnusedCapacity(items_count) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.s_import) });

                            switch (path_property.data) {
                                .e_string => {
                                    self.args.appendAssumeCapacity(path_property);
                                },
                                .e_jsx_element => {
                                    self.log.addError(
                                        self.p.source,
                                        path_property.loc,
                                        "import path cannot be JSX",
                                    ) catch unreachable;
                                    return false;
                                },
                                .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(p.visitExpr(path_property));
                                },
                                else => {
                                    self.log.addError(
                                        self.p.source,
                                        path_property.loc,
                                        "import path must be a string or identifier",
                                    ) catch unreachable;
                                    self.args.appendAssumeCapacity(path_property);
                                },
                            }

                            if (namespace_) |namespace_expr| {
                                switch (namespace_expr.data) {
                                    .e_string => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "import * as is not supported in macros yet",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(p.visitExpr(namespace_expr));
                                        return false;
                                    },
                                    .e_jsx_element => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "namespace cannot be JSX",
                                        ) catch unreachable;
                                        return false;
                                    },

                                    .e_object, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(p.visitExpr(namespace_expr));
                                    },

                                    else => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "namespace must be an object shaped like {\"fromName\": \"toName\"}",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(namespace_expr);
                                    },
                                }
                            } else {
                                self.args.appendAssumeCapacity(Expr{
                                    .loc = loc,
                                    .data = .{
                                        .e_null = E.Null{},
                                    },
                                });
                            }

                            if (default_property_) |default| {
                                switch (default.data) {
                                    .e_string => {
                                        self.args.appendAssumeCapacity(default);
                                    },
                                    .e_jsx_element => {
                                        self.log.addError(
                                            self.p.source,
                                            default.loc,
                                            "default import cannot be JSX",
                                        ) catch unreachable;
                                        return false;
                                    },
                                    .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(p.visitExpr(default));
                                    },
                                    else => {
                                        self.log.addError(self.p.source, default.loc, "default import must be a string or identifier") catch unreachable;
                                        self.args.appendAssumeCapacity(default);
                                    },
                                }
                            } else {
                                self.args.appendAssumeCapacity(Expr{
                                    .loc = loc,
                                    .data = .{
                                        .e_null = E.Null{},
                                    },
                                });
                            }

                            return true;
                        },
                        Tag.fragment => {
                            self.args.ensureUnusedCapacity(children.len + 2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.fragment) });
                            self.args.appendAssumeCapacity(Expr{
                                .loc = loc,
                                .data = .{
                                    .e_number = E.Number{
                                        .value = @intToFloat(f64, children.len),
                                    },
                                },
                            });

                            for (children) |child| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },

                                    .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited = self.p.visitExpr(child);
                                        switch (visited.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElement(el.*)) return false;
                                            },
                                            .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, child.loc, "<> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        // Tag.e_jsx_element => unreachable,
                        // Tag.e_identifier => {
                        //     // self.args.ensureUnusedCapacity(2) catch unreachable;
                        //     Global.notimpl();
                        // },
                        // Tag.e_import_identifier => {
                        //     Global.notimpl();
                        // },
                        // Tag.e_private_identifier => {
                        //     Global.notimpl();
                        // },

                        // Tag.e_unary => {

                        // },
                        // Tag.e_binary => {},

                        // Tag.e_function => {},
                        // Tag.e_new_target => {},
                        // Tag.e_import_meta => {},
                        // Tag.e_call => {},
                        // Tag.e_dot => {},
                        // Tag.e_index => {},
                        // Tag.e_arrow => {},

                        // Tag.e_spread => {},

                        // Tag.e_template_part => {},
                        // Tag.e_template => {},
                        // Tag.e_regex => {},
                        // Tag.e_await => {},
                        // Tag.e_yield => {},
                        // Tag.e_if => {},
                        // Tag.e_import => {},

                        // Tag.e_class => {},
                        // Tag.e_require_string => {},
                        // Tag.s_import => {},

                        // Tag.s_block => {},

                        // The valueless ones
                        Tag.e_super, Tag.e_null, Tag.e_undefined, Tag.e_missing, Tag.inline_true, Tag.inline_false, Tag.e_this => {
                            self.args.append(Expr{ .loc = loc, .data = Tag.ids.get(tag) }) catch unreachable;
                        },
                        else => Global.panic("Tag \"{s}\" is not implemented yet.", .{@tagName(tag)}),
                    }

                    return true;
                }

                pub fn writeFunctionCall(self: *JSXWriter, element: E.JSXElement) Expr {
                    if (element.tag) |tag_expr| {
                        switch (tag_expr.data) {
                            .e_string => {
                                self.p.recordUsage(self.bun_jsx_ref);
                                _ = self.writeElement(element);
                                var call_args = ExprNodeList.one(
                                    self.allocator,
                                    Expr.init(
                                        E.Array,
                                        E.Array{ .items = ExprNodeList.fromList(self.args) },
                                        tag_expr.loc,
                                    ),
                                ) catch unreachable;

                                return Expr.init(
                                    E.Call,
                                    E.Call{
                                        .target = Expr{
                                            .data = .{
                                                .e_identifier = self.bun_identifier.*,
                                            },
                                            .loc = tag_expr.loc,
                                        },
                                        .can_be_unwrapped_if_unused = true,
                                        .args = call_args,
                                    },
                                    tag_expr.loc,
                                );
                            },
                            else => Global.panic("Not implemented yet top-level jsx element: {s}", .{@tagName(tag_expr.data)}),
                        }
                    } else {
                        const loc = logger.Loc.Empty;
                        self.p.recordUsage(self.bun_jsx_ref);
                        _ = self.writeNodeType(JSNode.Tag.fragment, element.properties.slice(), element.children.slice(), loc);
                        var call_args = ExprNodeList.one(
                            self.allocator,
                            Expr.init(E.Array, E.Array{ .items = ExprNodeList.init(self.args.items) }, loc),
                        ) catch unreachable;

                        return Expr.init(
                            E.Call,
                            E.Call{
                                .target = Expr{
                                    .data = .{
                                        .e_identifier = self.bun_identifier.*,
                                    },
                                    .loc = loc,
                                },
                                .can_be_unwrapped_if_unused = true,
                                .args = call_args,
                            },
                            loc,
                        );
                    }

                    return Expr{ .data = .{ .e_missing = .{} }, .loc = logger.Loc.Empty };
                }

                fn writeElementWithValidTagList(self: *JSXWriter, element: E.JSXElement, comptime valid_tags: Tag.Validator.List) bool {
                    const tag_expr = element.tag orelse return false;
                    if (tag_expr.data != .e_string) return false;
                    const str = tag_expr.data.e_string;
                    var p = self.p;

                    const node_type: JSNode.Tag = JSNode.Tag.names.get(str.data) orelse {
                        self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{
                            str.string(self.p.allocator) catch unreachable,
                        }) catch unreachable;
                        return false;
                    };

                    if (!valid_tags.get(node_type)) {
                        self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid here", .{str.data}) catch unreachable;
                    }

                    return self.writeNodeType(node_type, element.properties.slice(), element.children.slice(), tag_expr.loc);
                }

                pub fn writeElement(self: *JSXWriter, element: E.JSXElement) bool {
                    const tag_expr = element.tag orelse return false;
                    if (tag_expr.data != .e_string) return false;
                    const str = tag_expr.data.e_string;
                    var p = self.p;

                    const node_type: JSNode.Tag = JSNode.Tag.names.get(str.data) orelse {
                        self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{
                            str.string(self.p.allocator) catch unreachable,
                        }) catch unreachable;
                        return false;
                    };

                    return self.writeNodeType(node_type, element.properties.slice(), element.children.slice(), tag_expr.loc);
                }
            };
        }

        pub const SymbolMap = struct {
            pub fn generateImportHash(name: string, path: string) i32 {
                var hasher = std.hash.Wyhash.init(8);
                hasher.update(path);
                hasher.update("#");
                hasher.update(name);
                return @bitCast(i32, @truncate(u32, hasher.final()));
            }
        };

        pub const Writer = struct {
            log: *logger.Log,
            exception: JSCBase.ExceptionValueRef = null,
            ctx: js.JSContextRef,
            errored: bool = false,
            allocator: std.mem.Allocator,
            loc: logger.Loc,
            args_value: JSC.JSValue,
            args_i: u32 = 0,
            args_len: u32 = 0,

            inject: std.ArrayList(JSNode),

            pub inline fn eatArg(this: *Writer) ?JSC.JSValue {
                if (this.args_i >= this.args_len) return null;
                const i = this.args_i;

                this.args_i += 1;
                return JSC.JSObject.getIndex(this.args_value, this.ctx.ptr(), i);
            }

            pub inline fn peekArg(this: *Writer) ?JSC.JSValue {
                if (this.args_i >= this.args_len) return null;
                return JSC.JSObject.getIndex(this.args_value, this.ctx.ptr(), this.args_i);
            }

            pub inline fn nextJSValue(this: *Writer) ?JSC.JSValue {
                return this.eatArg();
            }

            pub const TagOrJSNode = union(TagOrNodeType) {
                tag: JSNode.Tag,
                node: JSNode,
                invalid: void,

                pub const TagOrNodeType = enum {
                    tag,
                    node,
                    invalid,
                };

                pub fn fromJSValueRefNoValidate(ctx: js.JSContextRef, value: js.JSValueRef) TagOrJSNode {
                    switch (js.JSValueGetType(ctx, value)) {
                        js.JSType.kJSTypeNumber => {
                            const tag_int = @floatToInt(u8, JSC.JSValue.fromRef(value).asNumber());
                            if (tag_int < Tag.min_tag or tag_int > Tag.max_tag) {
                                return TagOrJSNode{ .invalid = {} };
                            }
                            return TagOrJSNode{ .tag = @intToEnum(JSNode.Tag, tag_int) };
                        },
                        js.JSType.kJSTypeObject => {
                            if (JSCBase.GetJSPrivateData(JSNode, value)) |node| {
                                return TagOrJSNode{ .node = node.* };
                            }

                            return TagOrJSNode{ .invalid = {} };
                        },
                        else => {
                            return TagOrJSNode{ .invalid = {} };
                        },
                    }
                }

                pub fn fromJSValueRef(writer: *Writer, ctx: js.JSContextRef, value: js.JSValueRef) TagOrJSNode {
                    switch (js.JSValueGetType(ctx, value)) {
                        js.JSType.kJSTypeNumber => {
                            const tag_int = @floatToInt(u8, JSC.JSValue.fromRef(value).asNumber());
                            if (tag_int < Tag.min_tag or tag_int > Tag.max_tag) {
                                throwTypeError(ctx, "Node type has invalid value", writer.exception);
                                writer.errored = true;
                                return TagOrJSNode{ .invalid = {} };
                            }
                            return TagOrJSNode{ .tag = @intToEnum(JSNode.Tag, tag_int) };
                        },
                        js.JSType.kJSTypeObject => {
                            if (JSCBase.GetJSPrivateData(JSNode, value)) |node| {
                                return TagOrJSNode{ .node = node.* };
                            }

                            return TagOrJSNode{ .invalid = {} };
                        },
                        else => {
                            throwTypeError(writer.ctx, "Invalid bun AST", writer.exception);
                            return TagOrJSNode{ .invalid = {} };
                        },
                    }
                }

                pub fn fromJSValue(writer: *Writer, value: JSC.JSValue) TagOrJSNode {
                    return fromJSValueRef(writer, writer.ctx, value.asRef());
                }
            };

            fn writeProperty(writer: *Writer, property: *G.Property) bool {

                // Property is
                // value
                // initializer
                // if property value is an e.spread, then key is skipped
                // key

                // value is first
                var expect_key = true;
                switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                    TagOrJSNode.tag => |tag| {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                        property.value = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                        property.flags.setPresent(.is_spread, expr.data == .e_spread);
                        expect_key = property.value == null or !property.flags.contains(.is_spread);
                    },
                    TagOrJSNode.node => |node| {
                        const expr = node.toExpr();
                        property.value = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                        property.flags.setPresent(.is_spread, expr.data == .e_spread);
                        expect_key = property.value == null or !property.flags.contains(.is_spread);
                    },
                    TagOrJSNode.invalid => {
                        return false;
                    },
                }

                switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                    TagOrJSNode.tag => |tag| {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                        property.initializer = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                    },
                    TagOrJSNode.node => |node| {
                        const expr = node.toExpr();
                        property.initializer = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                    },
                    TagOrJSNode.invalid => {
                        return false;
                    },
                }

                if (expect_key) {
                    var next_arg = writer.peekArg() orelse return false;
                    // its okay for property keys to literally be strings
                    // <property name="foo">
                    if (next_arg.isString()) {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_string = &E.String.empty } };
                        if (!writer.writeFromJSWithTagInExpr(JSNode.Tag.e_string, &expr)) return false;
                        property.key = expr;
                    } else {
                        switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                            TagOrJSNode.tag => |tag| {
                                var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };
                                if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                                property.key = expr;
                            },
                            TagOrJSNode.node => |node| {
                                property.key = node.toExpr();
                            },
                            TagOrJSNode.invalid => {
                                return false;
                            },
                        }
                    }
                }

                return true;
            }

            fn writeFromJSWithTagInNode(writer: *Writer, tag: JSNode.Tag) bool {
                switch (tag) {
                    .s_import => {
                        const path_arg = writer.eatArg() orelse return false;
                        // path should be a plain old JS string
                        if (!path_arg.isString()) {
                            throwTypeError(writer.ctx, "Import path must be a string", writer.exception);
                            return false;
                        }

                        var path_zig_string = JSC.ZigString.Empty;
                        path_arg.toZigString(&path_zig_string, writer.ctx.ptr());
                        const import_path = path_zig_string.trimmedSlice();

                        if (import_path.len == 0) {
                            throwTypeError(writer.ctx, "Import path must be a non-empty string", writer.exception);
                            return false;
                        }

                        var import = ImportData{
                            .import = S.Import{
                                .namespace_ref = Ref.None,
                                .import_record_index = std.math.maxInt(u32),
                            },
                            .path = import_path,
                        };
                        var import_namespace_arg = writer.eatArg() orelse return false;
                        var import_default_arg = writer.eatArg() orelse return false;

                        const has_default = import_default_arg.isString();

                        var import_default_name_string = JSC.ZigString.Empty;
                        if (has_default) import_default_arg.toZigString(&import_default_name_string, writer.ctx.ptr());

                        const import_default_name = import_default_name_string.slice();

                        var import_item_i: u32 = 0;

                        // TODO: verify it's safe to reuse the memory here
                        if (!import_namespace_arg.isNull()) {
                            if (import_namespace_arg.isObject()) {
                                throwTypeError(writer.ctx, "Import namespace should be an object where the keys are import names and the values are aliases.", writer.exception);
                                return false;
                            }

                            const JSLexer = bun.js_lexer;

                            var array_iter = JSC.JSPropertyIterator(.{
                                .skip_empty_name = true,
                                .include_value = true,
                            }).init(writer.ctx, import_namespace_arg.asObjectRef());
                            defer array_iter.deinit();

                            import.import.items = writer.allocator.alloc(
                                ClauseItem,
                                @intCast(u32, @boolToInt(has_default)) + array_iter.len,
                            ) catch return false;

                            while (array_iter.next()) |name| {
                                const property_value = array_iter.value;

                                if (!property_value.isString()) {
                                    return false;
                                }

                                var property_value_zig_string = JSC.ZigString.Empty;
                                property_value.toZigString(&property_value_zig_string, writer.ctx.ptr());

                                const alias = property_value_zig_string.slice();

                                if (!JSLexer.isIdentifier(alias)) throwTypeError(writer.ctx, "import alias must be an identifier", writer.exception);

                                import.import.items[import_item_i] = ClauseItem{
                                    .alias = name.toOwnedSlice(writer.allocator) catch return false,
                                    .original_name = alias,
                                    .name = .{ .loc = writer.loc, .ref = Ref.None },
                                    .alias_loc = writer.loc,
                                };

                                import_item_i += 1;
                            }
                        } else {
                            import.import.items = writer.allocator.alloc(
                                ClauseItem,
                                @intCast(u32, @boolToInt(has_default)),
                            ) catch return false;
                        }

                        if (has_default) {
                            import.import.items[import_item_i] = ClauseItem{
                                .alias = ClauseItem.default_alias,
                                .name = .{ .loc = writer.loc, .ref = Ref.None },
                                .original_name = import_default_name,
                                .alias_loc = writer.loc,
                            };
                            import_item_i += 1;
                        }

                        import.import.items = import.import.items[0..import_item_i];

                        var import_ = writer.allocator.create(ImportData) catch return false;
                        import_.* = import;
                        writer.inject.append(JSNode{ .data = .{ .s_import = import_ }, .loc = writer.loc }) catch unreachable;
                        return true;
                    },
                    else => {
                        return false;
                    },
                }
            }

            fn writeFromJSWithTagInExpr(writer: *Writer, tag: JSNode.Tag, expr: *Expr) bool {
                switch (tag) {
                    .e_array => {
                        // var e_array: E.Array = E.Array{ .items = writer.allocator.alloc(E.Array, args.len) catch return false };
                        var count = (writer.nextJSValue() orelse return false).toU32();
                        var i: @TypeOf(count) = 0;
                        var items = ExprList.initCapacity(writer.allocator, count) catch unreachable;

                        while (i < count) {
                            var nextArg = writer.eatArg() orelse return false;
                            if (js.JSValueIsArray(writer.ctx, nextArg.asRef())) {
                                const extras = @truncate(u32, nextArg.getLengthOfArray(writer.ctx.ptr()));
                                count += std.math.max(@truncate(@TypeOf(count), extras), 1) - 1;
                                items.ensureUnusedCapacity(extras) catch unreachable;
                                items.expandToCapacity();
                                var new_writer = writer.*;
                                new_writer.args_i = 0;
                                new_writer.args_len = extras;
                                new_writer.args_value = nextArg;

                                while (new_writer.nextJSValue()) |value| {
                                    defer i += 1;
                                    switch (TagOrJSNode.fromJSValue(&new_writer, value)) {
                                        TagOrJSNode.tag => |tag_| {
                                            if (!new_writer.writeFromJSWithTagInExpr(
                                                tag_,
                                                &items.items[i],
                                            )) return false;
                                        },
                                        TagOrJSNode.node => |node_| {
                                            const node: JSNode = node_;
                                            switch (node.data) {
                                                JSNode.Tag.s_import => return false,
                                                else => {
                                                    items.items[i] = node.toExpr();
                                                },
                                            }
                                        },
                                        TagOrJSNode.invalid => {
                                            return false;
                                        },
                                    }
                                }
                            } else {
                                defer i += 1;

                                switch (TagOrJSNode.fromJSValue(writer, nextArg)) {
                                    TagOrJSNode.tag => |tag_| {
                                        if (!writer.writeFromJSWithTagInExpr(tag_, &items.items[i])) return false;
                                    },
                                    TagOrJSNode.node => |node_| {
                                        const node: JSNode = node_;
                                        switch (node.data) {
                                            JSNode.Tag.s_import => return false,
                                            else => {
                                                items.items[i] = node.toExpr();
                                            },
                                        }
                                    },
                                    TagOrJSNode.invalid => {
                                        return false;
                                    },
                                }
                            }
                        }
                        items.items = items.items[0..i];
                        expr.* = Expr.init(E.Array, E.Array{ .items = ExprNodeList.fromList(items) }, writer.loc);
                        return true;
                    },
                    .e_boolean => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{
                            .value = JSC.JSValue.toBoolean(writer.nextJSValue() orelse return false),
                        } } };
                        return true;
                    },
                    .inline_true => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{ .value = true } } };
                        return true;
                    },
                    .inline_false => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{ .value = false } } };
                        return true;
                    },
                    .e_null => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };
                        return true;
                    },
                    .e_undefined => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_undefined = E.Undefined{} } };
                        return true;
                    },
                    .e_number => {
                        expr.* = Expr{
                            .loc = writer.loc,
                            .data = .{
                                .e_number = .{
                                    .value = JSC.JSValue.asNumber(writer.nextJSValue() orelse return false),
                                },
                            },
                        };
                        return true;
                    },
                    .e_string => {
                        var str = (writer.nextJSValue() orelse return false).toSlice(writer.ctx.ptr(), writer.allocator);
                        if (str.len == 0) {
                            expr.* = Expr{
                                .loc = writer.loc,
                                .data = .{
                                    .e_string = &E.String.empty,
                                },
                            };
                        } else {
                            expr.* = Expr.init(E.String, E.String.init(
                                (str.cloneIfNeeded(writer.allocator) catch unreachable).slice(),
                            ), writer.loc);
                        }
                        return true;
                    },
                    .e_reg_exp => {
                        var jsstring = js.JSValueToStringCopy(writer.ctx, (writer.eatArg() orelse return false).asRef(), writer.exception);
                        defer js.JSStringRelease(jsstring);

                        const len = js.JSStringGetLength(jsstring);
                        var str = writer.allocator.alloc(u8, len + 1) catch unreachable;
                        const outlen = js.JSStringGetUTF8CString(jsstring, str.ptr, len + 1);
                        expr.* = Expr.init(E.RegExp, E.RegExp{ .value = str[0..outlen] }, writer.loc);
                        return true;
                    },
                    .e_object => {
                        const len = (writer.nextJSValue() orelse return false).toU32();

                        var properties = writer.allocator.alloc(G.Property, len) catch return false;
                        var property_i: u32 = 0;

                        while (property_i < properties.len) : (property_i += 1) {
                            switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                                TagOrJSNode.tag => |tag_| {
                                    if (tag_ != JSNode.Tag.g_property) return false;

                                    if (!writer.writeProperty(
                                        &properties[property_i],
                                    )) return false;
                                },
                                TagOrJSNode.node => |node_| {
                                    const node: JSNode = node_;
                                    switch (node.data) {
                                        .g_property => |property| {
                                            properties[property_i] = property.*;
                                        },
                                        else => {
                                            return false;
                                        },
                                    }
                                },
                                TagOrJSNode.invalid => {
                                    return false;
                                },
                            }
                        }

                        return true;
                    },
                    .inline_identifier => {
                        const to = (writer.nextJSValue() orelse return false).toInt32();
                        expr.* = Expr{ .data = .{ .inline_identifier = to }, .loc = writer.loc };
                        return true;
                    },

                    else => {
                        return false;
                    },

                    // .e_call => {},

                    // .e_dot => {},
                    // .e_index => {},
                    // .e_identifier => {},
                    // .e_import_identifier => {},

                    // .e_spread => {},

                    // .e_template_part => {},
                    // .e_template => {},

                    // .e_await => {},
                    // .e_yield => {},
                    // .e_if => {},
                    // .e_import => {},
                    // .e_this => {},
                    // .e_class => {},
                    // s_import => {},
                }

                return false;
            }

            pub fn writeFromJS(writer: *Writer) ?JSNode {
                switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, (writer.eatArg() orelse return null).asRef())) {
                    TagOrJSNode.tag => |tag| {
                        if (tag == Tag.inline_inject) {
                            const count: u32 = (writer.eatArg() orelse return null).toU32();
                            var i: u32 = 0;
                            while (i < count) : (i += 1) {
                                const next_value = (writer.eatArg() orelse return null);
                                const next_value_ref = next_value.asRef();
                                if (js.JSValueIsArray(writer.ctx, next_value_ref)) {
                                    var iter = JSC.JSArrayIterator.init(next_value, writer.ctx.ptr());
                                    while (iter.next()) |current_value| {
                                        switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, current_value.asRef())) {
                                            .node => |node| {
                                                if (node.data != .s_import) {
                                                    throwTypeError(writer.ctx, "inject must only contain imports", writer.exception);
                                                    return null;
                                                }
                                                writer.inject.append(node) catch unreachable;
                                            },
                                            .tag => |t| {
                                                if (!writer.writeFromJSWithTagInNode(t)) return null;
                                            },
                                            .invalid => {
                                                return null;
                                            },
                                        }
                                    }
                                    i += 1;
                                    continue;
                                } else {
                                    switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, next_value_ref)) {
                                        .tag => |tag2| {
                                            if (!writer.writeFromJSWithTagInNode(tag2)) return null;
                                        },
                                        TagOrJSNode.node => |node| {
                                            writer.inject.append(node) catch unreachable;
                                        },
                                        TagOrJSNode.invalid => {
                                            return null;
                                        },
                                    }
                                }
                            }
                            return JSNode{ .data = .{ .inline_inject = writer.inject.toOwnedSlice() catch @panic("TODO") }, .loc = writer.loc };
                        }

                        if (tag == Tag.s_import) {
                            if (!writer.writeFromJSWithTagInNode(tag)) return null;
                            return writer.inject.items[0];
                        }

                        if (tag == Tag.fragment) {
                            const count: u32 = (writer.eatArg() orelse return null).toU32();
                            // collapse single-item fragments
                            switch (count) {
                                0 => {
                                    return JSNode{ .data = .{ .fragment = &[_]JSNode{} }, .loc = writer.loc };
                                },

                                1 => {
                                    var _node = writer.writeFromJS() orelse return null;
                                    while (true) {
                                        switch (_node.data) {
                                            .fragment => |fragment| {
                                                if (fragment.len == 1) {
                                                    _node = fragment[0];
                                                    continue;
                                                }

                                                return _node;
                                            },
                                            else => {
                                                return _node;
                                            },
                                        }
                                    }
                                },
                                else => {},
                            }

                            var i: u32 = 0;
                            var fragment = std.ArrayList(JSNode).initCapacity(writer.allocator, count) catch return null;
                            while (i < count) : (i += 1) {
                                const node = writer.writeFromJS() orelse return null;
                                fragment.append(node) catch unreachable;
                            }

                            return JSNode{ .data = .{ .fragment = fragment.toOwnedSlice() catch @panic("TODO") }, .loc = writer.loc };
                        }

                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return null;
                        return JSNode.initExpr(expr);
                    },
                    TagOrJSNode.node => |node| {
                        return node;
                    },
                    TagOrJSNode.invalid => {
                        return null;
                    },
                }
            }
        };

        // pub fn isInstanceOf(
        //     ctx: js.JSContextRef,
        //     obj: js.JSObjectRef,
        //     value: js.JSValueRef,
        //     exception: js.ExceptionRef,
        // ) bool {
        //     js.JSValueToNumber(ctx, value, exception);
        // }

        fn throwTypeError(ctx: js.JSContextRef, comptime msg: string, exception: js.ExceptionRef) void {
            JSCBase.JSError(JSCBase.getAllocator(ctx), msg, .{}, ctx, exception);
        }

        pub const BunJSXCallbackFunction = JSCBase.NewClass(
            void,
            .{ .name = "bunJSX" },
            .{
                .call = .{
                    .rfn = createFromJavaScript,
                    .ro = true,
                },
                .isNodeType = .{
                    .rfn = isNodeType,
                    .ro = true,
                },
            },
            .{},
        );

        pub fn isNodeType(
            _: void,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            if (arguments.len != 2) {
                throwTypeError(ctx, "bunJSX.isNodeType() requires 2 arguments", exception);
                return null;
            }

            const TagOrNodeType = Writer.TagOrJSNode.TagOrNodeType;

            const left = Writer.TagOrJSNode.fromJSValueRefNoValidate(ctx, arguments[0]);
            const right = Writer.TagOrJSNode.fromJSValueRefNoValidate(ctx, arguments[1]);

            if (left == TagOrNodeType.invalid or right == TagOrNodeType.invalid) {
                return js.JSValueMakeBoolean(ctx, false);
            }

            if (left == TagOrNodeType.node and right == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, left.node.data) == @as(Tag, right.node.data));
            }

            if (left == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, left.node.data) == right.tag);
            }

            if (right == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, right.node.data) == left.tag);
            }

            unreachable;
        }

        pub fn createFromJavaScript(
            _: void,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            if (arguments.len != 1 or !js.JSValueIsArray(ctx, arguments[0])) {
                throwTypeError(ctx, "bunJSX requires one array argument", exception);
                return null;
            }

            js.JSValueProtect(ctx, arguments[0]);
            defer Output.flush();
            const args_value = JSC.JSValue.fromRef(arguments[0]);
            var writer = Writer{
                .inject = std.ArrayList(JSNode).init(JSCBase.getAllocator(ctx)),
                .log = JavaScript.VirtualMachine.get().log,
                .ctx = ctx,
                .loc = logger.Loc.Empty,
                .allocator = JSCBase.getAllocator(ctx),
                .exception = exception,
                .args_value = args_value,
                .args_len = @truncate(u32, args_value.getLengthOfArray(ctx.ptr())),
                .args_i = 0,
                .errored = false,
            };

            if (writer.writeFromJS()) |node| {
                var ptr = writer.allocator.create(JSNode) catch unreachable;
                ptr.* = node;
                var result = JSNode.Class.make(ctx, ptr);
                js.JSValueProtect(ctx, result);
                return result;
            }

            return null;
        }
    };

    pub const LazyPropertiesObject = struct {
        node: JSNode,

        pub const Class = JSCBase.NewClass(
            LazyPropertiesObject,
            .{
                .name = "LazyPropertiesObject",
                .read_only = true,
            },
            .{
                .getProperty = .{
                    .rfn = &getProperty,
                },
                .hasProperty = .{
                    .rfn = &hasProperty,
                },
                .getPropertyNames = .{
                    .rfn = &getPropertyNames,
                },
            },
            .{},
        );

        pub fn getProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return null;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.node.data.e_object.properties.slice();
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];
            var value_node: JSNode = undefined;

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.data;

                if (strings.eql(property_slice, str)) {
                    const value = property.value orelse return js.JSValueMakeUndefined(ctx);
                    value_node = JSNode.initExpr(value);
                    return JSNode.JSBindings.toPrimitive(&value_node, ctx, exception);
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        pub fn hasProperty(
            _: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
        ) callconv(.C) bool {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return false;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.node.data.e_object.properties.slice();
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.data;

                if (strings.eql(property_slice, str)) return true;
            }

            return false;
        }

        pub fn getPropertyNames(
            _: js.JSContextRef,
            thisObject: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return;

            const properties = this.node.data.e_object.properties.slice();

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.data;
                js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreate(str.ptr, str.len));
            }
        }
    };

    pub const ModuleNamespace = struct {
        import_data: JSNode.ImportData,

        pub const Class = JSCBase.NewClass(
            ModuleNamespace,
            .{
                .name = "ModuleNamespace",
                .read_only = true,
            },
            .{
                .getProperty = .{
                    .rfn = &getProperty,
                },
                .hasProperty = .{
                    .rfn = &hasProperty,
                },
                .getPropertyNames = .{
                    .rfn = &getPropertyNames,
                },
            },
            .{},
        );

        pub fn getProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
            _: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return null;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.import_data.import.items;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];

            for (properties) |property| {
                if (strings.eql(property.original_name, property_slice)) {
                    return JSC.JSValue.jsNumberFromInt32(JSNode.SymbolMap.generateImportHash(property.original_name, this.import_data.path)).asRef();
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        pub fn hasProperty(
            _: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
        ) callconv(.C) bool {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return false;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.import_data.import.items;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];

            for (properties) |property| {
                if (strings.eql(property.original_name, property_slice)) return true;
            }

            return false;
        }

        pub fn getPropertyNames(
            _: js.JSContextRef,
            thisObject: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return;

            const items = this.import_data.import.items;

            for (items) |clause| {
                const str = clause.original_name;
                js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreateStatic(str.ptr, str.len));
            }
        }
    };

    resolver: *Resolver,
    vm: *JavaScript.VirtualMachine = undefined,

    resolved: ResolveResult = undefined,
    disabled: bool = false,

    pub fn init(
        _: std.mem.Allocator,
        resolver: *Resolver,
        resolved: ResolveResult,
        log: *logger.Log,
        env: *DotEnv.Loader,
        function_name: string,
        specifier: string,
        hash: i32,
    ) !Macro {
        const path = resolved.path_pair.primary;

        var vm: *JavaScript.VirtualMachine = if (JavaScript.VirtualMachine.isLoaded())
            JavaScript.VirtualMachine.get()
        else brk: {
            var old_transform_options = resolver.opts.transform_options;
            resolver.opts.transform_options.node_modules_bundle_path = null;
            resolver.opts.transform_options.node_modules_bundle_path_server = null;
            defer resolver.opts.transform_options = old_transform_options;
            var _vm = try JavaScript.VirtualMachine.init(default_allocator, resolver.opts.transform_options, null, log, env);

            _vm.enableMacroMode();
            _vm.eventLoop().ensureWaker();

            try _vm.bundler.configureDefines();
            break :brk _vm;
        };

        vm.enableMacroMode();

        var loaded_result = try vm.loadMacroEntryPoint(path.text, function_name, specifier, hash);

        if (loaded_result.status(vm.global.vm()) == JSC.JSPromise.Status.Rejected) {
            vm.runErrorHandler(loaded_result.result(vm.global.vm()), null);
            vm.disableMacroMode();
            return error.MacroLoadError;
        }

        // We don't need to do anything with the result.
        // We just want to make sure the promise is finished.
        _ = loaded_result.result(vm.global.vm());

        return Macro{
            .vm = vm,
            .resolved = resolved,
            .resolver = resolver,
        };
    }

    pub const Runner = struct {
        const VisitMap = std.AutoHashMapUnmanaged(JSC.JSValue, Expr);

        threadlocal var args_buf: [3]js.JSObjectRef = undefined;
        threadlocal var expr_nodes_buf: [1]JSNode = undefined;
        threadlocal var exception_holder: Zig.ZigException.Holder = undefined;
        pub const MacroError = error{MacroFailed};

        pub fn NewRun(comptime Visitor: type) type {
            return struct {
                const Run = @This();
                caller: Expr,
                function_name: string,
                macro: *const Macro,
                global: *JSC.JSGlobalObject,
                allocator: std.mem.Allocator,
                id: i32,
                log: *logger.Log,
                source: *const logger.Source,
                visited: VisitMap = VisitMap{},
                visitor: Visitor,
                is_top_level: bool = false,

                pub fn runAsync(
                    macro: Macro,
                    log: *logger.Log,
                    allocator: std.mem.Allocator,
                    function_name: string,
                    caller: Expr,
                    args_count: usize,
                    source: *const logger.Source,
                    id: i32,
                    visitor: Visitor,
                ) MacroError!Expr {
                    if (comptime is_bindgen) return undefined;
                    var macro_callback = macro.vm.macros.get(id) orelse return caller;

                    var result = js.JSObjectCallAsFunctionReturnValueHoldingAPILock(
                        macro.vm.global,
                        macro_callback,
                        null,
                        args_count,
                        &args_buf,
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
                        .visitor = visitor,
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
                    return try switch (JSC.ZigConsoleClient.Formatter.Tag.get(value, this.global).tag) {
                        .Error => this.coerce(value, .Error),
                        .Undefined => this.coerce(value, .Undefined),
                        .Null => this.coerce(value, .Null),
                        .Private => this.coerce(value, .Private),
                        .Boolean => this.coerce(value, .Boolean),
                        .Array => this.coerce(value, .Array),
                        .Object => this.coerce(value, .Object),
                        .JSON => this.coerce(value, .JSON),
                        .Integer => this.coerce(value, .Integer),
                        .Double => this.coerce(value, .Double),
                        .String => this.coerce(value, .String),
                        .Promise => this.coerce(value, .Promise),
                        else => brk: {
                            this.log.addErrorFmt(
                                this.source,
                                this.caller.loc,
                                this.allocator,
                                "cannot coerce {s} to Bun's AST. Please return a valid macro using the JSX syntax",
                                .{@tagName(value.jsType())},
                            ) catch unreachable;
                            break :brk error.MacroFailed;
                        },
                    };
                }

                pub fn coerce(
                    this: *Run,
                    value: JSC.JSValue,
                    comptime tag: JSC.ZigConsoleClient.Formatter.Tag,
                ) MacroError!Expr {
                    switch (comptime tag) {
                        .Error => {
                            this.macro.vm.runErrorHandler(value, null);
                            return this.caller;
                        },
                        .Undefined => if (this.is_top_level)
                            return this.caller
                        else
                            return Expr.init(E.Undefined, E.Undefined{}, this.caller.loc),
                        .Null => return Expr.init(E.Null, E.Null{}, this.caller.loc),
                        .Private => {
                            this.is_top_level = false;
                            var _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                            if (_entry.found_existing) {
                                return _entry.value_ptr.*;
                            }

                            var blob_: ?JSC.WebCore.Blob = null;
                            var mime_type: ?HTTP.MimeType = null;

                            if (value.jsType() == .DOMWrapper) {
                                if (value.as(JSC.WebCore.Response)) |resp| {
                                    mime_type = HTTP.MimeType.init(resp.mimeType(null));
                                    blob_ = resp.body.use();
                                } else if (value.as(JSC.WebCore.Request)) |resp| {
                                    mime_type = HTTP.MimeType.init(resp.mimeType());
                                    blob_ = resp.body.value.use();
                                } else if (value.as(JSC.WebCore.Blob)) |resp| {
                                    blob_ = resp.*;
                                    blob_.?.allocator = null;
                                }
                            } else {
                                var private_data = JSCBase.JSPrivateDataPtr.from(JSC.C.JSObjectGetPrivate(value.asObjectRef()).?);

                                switch (private_data.tag()) {
                                    .JSNode => {
                                        var node = private_data.as(JSNode);
                                        _entry.value_ptr.* = node.toExpr();
                                        node.visited = true;
                                        node.updateSymbolsMap(Visitor, this.visitor);
                                        return _entry.value_ptr.*;
                                    },
                                    .ResolveError, .BuildError => {
                                        this.macro.vm.runErrorHandler(value, null);
                                        return error.MacroFailed;
                                    },

                                    else => {},
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
                        JSC.ZigConsoleClient.Formatter.Tag.Array => {
                            this.is_top_level = false;

                            var _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
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
                        JSC.ZigConsoleClient.Formatter.Tag.Object => {
                            this.is_top_level = false;
                            var _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
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

                            var object = value.asObjectRef();
                            var object_iter = JSC.JSPropertyIterator(.{
                                .skip_empty_name = false,
                                .include_value = true,
                            }).init(this.global, object);
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

                            while (object_iter.next()) |prop| {
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
                            return Expr.init(E.Number, E.Number{ .value = @intToFloat(f64, value.toInt32()) }, this.caller.loc);
                        },
                        .Double => {
                            return Expr.init(E.Number, E.Number{ .value = value.asNumber() }, this.caller.loc);
                        },
                        .String => {
                            var sliced = value.toSlice(this.global, this.allocator).cloneIfNeeded(this.allocator) catch unreachable;
                            return Expr.init(E.String, E.String.init(sliced.slice()), this.caller.loc);
                        },
                        .Promise => {
                            var _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                            if (_entry.found_existing) {
                                return _entry.value_ptr.*;
                            }

                            var promise_result = JSC.JSValue.zero;
                            var rejected = false;
                            if (value.asAnyPromise()) |promise| {
                                this.macro.vm.waitForPromise(promise);
                                promise_result = promise.result(this.global.vm());
                                rejected = promise.status(this.global.vm()) == .Rejected;
                            } else {
                                @panic("Unexpected promise type");
                            }

                            if (promise_result.isUndefined() and this.is_top_level) {
                                this.is_top_level = false;
                                return this.caller;
                            }

                            if (rejected or promise_result.isError() or promise_result.isAggregateError(this.global) or promise_result.isException(this.global.vm())) {
                                this.macro.vm.runErrorHandler(promise_result, null);
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
                        "cannot coerce {s} to Bun's AST. Please return a valid macro using the JSX syntax",
                        .{@tagName(value.jsType())},
                    ) catch unreachable;
                    return error.MacroFailed;
                }
            };
        }

        pub fn run(
            macro: Macro,
            log: *logger.Log,
            allocator: std.mem.Allocator,
            function_name: string,
            caller: Expr,
            _: []Expr,
            source: *const logger.Source,
            id: i32,
            comptime Visitor: type,
            visitor: Visitor,
            javascript_object: JSC.JSValue,
        ) MacroError!Expr {
            if (comptime Environment.isDebug) Output.prettyln("<r><d>[macro]<r> call <d><b>{s}<r>", .{function_name});

            exception_holder = Zig.ZigException.Holder.init();
            expr_nodes_buf[0] = JSNode.initExpr(caller);
            args_buf[0] = JSNode.Class.make(
                macro.vm.global,
                &expr_nodes_buf[0],
            );
            args_buf[1] = if (javascript_object.isEmpty()) null else javascript_object.asObjectRef();
            args_buf[2] = null;
            const Run = NewRun(Visitor);

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

            return CallData.callWrapper(.{
                macro,
                log,
                allocator,
                function_name,
                caller,
                2 + @as(usize, @boolToInt(!javascript_object.isEmpty())),
                source,
                id,
                visitor,
            });
        }

        extern "C" fn Bun__startMacro(function: *const anyopaque, *anyopaque) void;
    };
};

pub const ASTMemoryAllocator = struct {
    stack_allocator: std.heap.StackFallbackAllocator(8096) = undefined,
    bump_allocator: std.mem.Allocator = undefined,
    allocator: std.mem.Allocator,
    previous: ?*ASTMemoryAllocator = null,

    pub fn reset(this: *ASTMemoryAllocator) void {
        this.stack_allocator.fallback_allocator = this.allocator;
        this.bump_allocator = this.stack_allocator.get();
    }

    pub fn push(this: *ASTMemoryAllocator) void {
        Stmt.Data.Store.memory_allocator = this;
        Expr.Data.Store.memory_allocator = this;
    }

    pub fn pop(this: *ASTMemoryAllocator) void {
        var prev = this.previous;
        std.debug.assert(prev != this);
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

pub const UseDirective = enum {
    none,
    @"use client",
    @"use server",

    pub const Flags = struct {
        is_client: bool = false,
        is_server: bool = false,
    };

    pub fn isBoundary(this: UseDirective, other: UseDirective) bool {
        if (this == other or other == .none)
            return false;

        return true;
    }

    pub fn boundering(this: UseDirective, other: UseDirective) ?UseDirective {
        if (this == other or other == .none)
            return null;

        return other;
    }

    pub const EntryPoint = struct {
        source_index: Index.Int,
        use_directive: UseDirective,
    };

    pub const List = std.MultiArrayList(UseDirective.EntryPoint);

    // TODO: remove this, add an onModuleDirective() callback to the parser
    pub fn parse(contents: []const u8) UseDirective {
        const truncated = std.mem.trimLeft(u8, contents, " \t\n\r;");

        if (truncated.len < "'use client';".len)
            return .none;

        const directive_string = truncated[0.."'use client';".len].*;

        const first_quote = directive_string[0];
        const last_quote = directive_string[directive_string.len - 2];
        if (first_quote != last_quote or (first_quote != '"' and first_quote != '\'' and first_quote != '`'))
            return .none;

        const unquoted = directive_string[1 .. directive_string.len - 2];

        if (strings.eqlComptime(
            unquoted,
            "use client",
        )) {
            return .@"use client";
        }

        if (strings.eqlComptime(
            unquoted,
            "use server",
        )) {
            return .@"use server";
        }

        return .none;
    }

    pub fn target(this: UseDirective, default: bun.options.Target) bun.options.Target {
        return switch (this) {
            .none => default,
            .@"use client" => .browser,
            .@"use server" => .bun,
        };
    }
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

        var prev = Stmt.Data.Store.memory_allocator;
        Stmt.Data.Store.memory_allocator = global_store_ast;
        Expr.Data.Store.memory_allocator = global_store_ast;
        return prev;
    }

    pub fn unget(handle: ?*ASTMemoryAllocator) void {
        Stmt.Data.Store.memory_allocator = handle;
        Expr.Data.Store.memory_allocator = handle;
    }
};

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
