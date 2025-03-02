//! Global/Generic components (G namespace)
//! Defines the G namespace which contains various JavaScript AST structures
//! like declarations, classes, functions, and properties.

/// The G namespace contains global/generic components used throughout the AST
/// A variable declaration (let x = y)
pub const Decl = struct {
    binding: BindingNodeIndex,
    value: ?ExprNodeIndex = null,

    pub const List = BabyList(Decl);
};

/// Represents a namespace alias in import statements
pub const NamespaceAlias = struct {
    namespace_ref: Ref,
    alias: string,

    was_originally_property_access: bool = false,

    import_record_index: u32 = std.math.maxInt(u32),
};

/// Represents an export * as alias structure
pub const ExportStarAlias = struct {
    loc: logger.Loc,

    // Although this alias name starts off as being the same as the statement's
    // namespace symbol, it may diverge if the namespace symbol name is minified.
    // The original alias name is preserved here to avoid this scenario.
    original_name: string,
};

/// A class declaration or expression
pub const Class = struct {
    class_keyword: logger.Range = logger.Range.None,
    ts_decorators: ExprNodeList = ExprNodeList{},
    class_name: ?LocRef = null,
    extends: ?ExprNodeIndex = null,
    body_loc: logger.Loc = logger.Loc.Empty,
    close_brace_loc: logger.Loc = logger.Loc.Empty,
    properties: []Property = &([_]Property{}),
    has_decorators: bool = false,

    /// Determines if a class definition can be moved in the source
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

// Named Comment to avoid shadowing the standard library Comment
/// Represents a JavaScript comment
pub const Comment = struct { loc: logger.Loc, text: string };

/// A static block in a class
pub const ClassStaticBlock = struct {
    stmts: BabyList(Stmt) = .{},
    loc: logger.Loc,
};

/// A property in an object or class
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

    /// Create a deep clone of the property
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

    /// Kind of property (normal, getter, setter, etc.)
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

/// The body of a function
pub const FnBody = struct {
    loc: logger.Loc,
    stmts: StmtNodeList,
};

/// A function declaration or expression
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

    /// Create a deep clone of the function
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

/// A function argument
pub const Arg = struct {
    ts_decorators: ExprNodeList = ExprNodeList{},
    binding: BindingNodeIndex,
    default: ?ExprNodeIndex = null,

    // "constructor(public x: boolean) {}"
    is_typescript_ctor_field: bool = false,

    ts_metadata: TypeScript.Metadata = .m_none,

    /// Create a deep clone of the argument
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

const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;
const string = bun.string;

const js_ast = @import("js_ast.zig");
const TypeScript = @import("../js_parser.zig").TypeScript;
const BabyList = bun.BabyList;
const Flags = js_ast.Flags;
const Ref = js_ast.Ref;
const Expr = js_ast.Expr;
const Stmt = js_ast.Stmt;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const LocRef = js_ast.LocRef;
