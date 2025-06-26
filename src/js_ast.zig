/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const namespace_export_part_index = 0;

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

        pub const Item = ArrayBinding;
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

pub const EnumValue = struct {
    loc: logger.Loc,
    ref: Ref,
    name: []const u8,
    value: ?ExprNodeIndex,

    pub fn nameAsEString(enum_value: EnumValue, allocator: std.mem.Allocator) E.String {
        return E.String.initReEncodeUTF8(enum_value.name, allocator);
    }
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

pub const ArrayBinding = struct {
    binding: BindingNodeIndex,
    default_value: ?ExprNodeIndex = null,
};

/// TLA => Top Level Await
pub const TlaCheck = struct {
    depth: u32 = 0,
    parent: Index.Int = Index.invalid.get(),
    import_record_index: Index.Int = Index.invalid.get(),
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
pub const InlinedEnumValue = struct {
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

    pub fn isDynamic(self: ExportsKind) bool {
        return switch (self) {
            .cjs, .esm_with_dynamic_fallback, .esm_with_dynamic_fallback_from_cjs => true,
            .none, .esm => false,
        };
    }

    pub fn isESMWithDynamicFallback(self: ExportsKind) bool {
        return switch (self) {
            .none, .cjs, .esm => false,
            .esm_with_dynamic_fallback, .esm_with_dynamic_fallback_from_cjs => true,
        };
    }

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
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

pub fn printmem(comptime format: string, args: anytype) void {
    defer Output.flush();
    Output.initTest();
    Output.print(format, args);
}

pub const ToJSError = error{
    @"Cannot convert argument type to JS",
    @"Cannot convert identifier to JS. Try a statically-known value",
    MacroError,
    OutOfMemory,
    JSError,
};

/// Say you need to allocate a bunch of tiny arrays
/// You could just do separate allocations for each, but that is slow
/// With std.ArrayList, pointers invalidate on resize and that means it will crash.
/// So a better idea is to batch up your allocations into one larger allocation
/// and then just make all the arrays point to different parts of the larger allocation
pub fn NewBatcher(comptime Type: type) type {
    return struct {
        head: []Type,

        pub fn init(allocator: std.mem.Allocator, count: usize) !@This() {
            const all = try allocator.alloc(Type, count);
            return @This(){ .head = all };
        }

        pub fn done(this: *@This()) void {
            bun.assert(this.head.len == 0); // count to init() was too large, overallocation
        }

        pub fn eat(this: *@This(), value: Type) *Type {
            return @as(*Type, @ptrCast(&this.head.eat1(value).ptr));
        }

        pub fn eat1(this: *@This(), value: Type) []Type {
            var prev = this.head[0..1];
            prev[0] = value;
            this.head = this.head[1..];
            return prev;
        }

        pub fn next(this: *@This(), values: anytype) []Type {
            this.head[0..values.len].* = values;
            const prev = this.head[0..values.len];
            this.head = this.head[values.len..];
            return prev;
        }
    };
}

// @sortImports

pub const ASTMemoryAllocator = @import("ast/ASTMemoryAllocator.zig");
pub const Ast = @import("ast/Ast.zig");
pub const Binding = @import("ast/Binding.zig");
pub const BindingNodeIndex = Binding;
pub const BundledAst = @import("ast/BundledAst.zig");
pub const E = @import("ast/E.zig");
pub const Expr = @import("ast/Expr.zig");
pub const ExprNodeIndex = Expr;
pub const G = @import("ast/G.zig");
pub const Macro = @import("ast/Macro.zig");
pub const Op = @import("ast/Op.zig");
pub const S = @import("ast/S.zig");
pub const Scope = @import("ast/Scope.zig");
pub const ServerComponentBoundary = @import("ast/ServerComponentBoundary.zig");
pub const Stmt = @import("ast/Stmt.zig");
pub const StmtNodeIndex = Stmt;
pub const Symbol = @import("ast/Symbol.zig");
const std = @import("std");
pub const NewStore = @import("ast/NewStore.zig").NewStore;
const TypeScript = @import("./js_parser.zig").TypeScript;
pub const UseDirective = @import("ast/UseDirective.zig").UseDirective;

pub const CharFreq = @import("ast/CharFreq.zig");
const char_freq_count = CharFreq.char_freq_count;

pub const Index = @import("ast/base.zig").Index;
pub const Ref = @import("ast/base.zig").Ref;
pub const RefHashCtx = @import("ast/base.zig").RefHashCtx;

const bun = @import("bun");
pub const BabyList = bun.BabyList;
const Environment = bun.Environment;
const Output = bun.Output;
const logger = bun.logger;
const string = bun.string;
const strings = bun.strings;
const writeAnyToHasher = bun.writeAnyToHasher;
