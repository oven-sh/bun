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

            return Expr.init(
                E.Array,
                E.Array{
                    .items = ExprNodeList.fromOwnedSlice(exprs),
                    .is_single_line = b.is_single_line,
                },
                loc,
            );
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
                    .properties = G.Property.List.fromOwnedSlice(properties),
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const logger = bun.logger;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const G = js_ast.G;
const Ref = js_ast.Ref;
