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

    pub fn initReturnExpr(allocator: std.mem.Allocator, expr: Expr) !FnBody {
        return .{
            .stmts = try allocator.dupe(Stmt, &.{Stmt.alloc(S.Return, .{
                .value = expr,
            }, expr.loc)}),
            .loc = expr.loc,
        };
    }
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const logger = bun.logger;
const TypeScript = bun.js_parser.TypeScript;

const js_ast = bun.ast;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const LocRef = js_ast.LocRef;
const Ref = js_ast.Ref;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const StmtNodeList = js_ast.StmtNodeList;
