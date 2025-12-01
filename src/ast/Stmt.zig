loc: logger.Loc,
data: Data,

pub const Batcher = NewBatcher(Stmt);

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

        /// create || reset
        pub fn begin() void {
            if (memory_allocator != null) return;
            if (instance == null) {
                create();
                return;
            }

            if (!disable_reset)
                instance.?.reset();
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
    const T = @FieldType(Data, tag);
    return switch (@typeInfo(T)) {
        .pointer => |ptr| ptr.child,
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const logger = bun.logger;

const js_ast = bun.ast;
const ASTMemoryAllocator = js_ast.ASTMemoryAllocator;
const Expr = js_ast.Expr;
const NewBatcher = js_ast.NewBatcher;
const NewStore = js_ast.NewStore;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
