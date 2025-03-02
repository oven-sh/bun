//! Union type representing either a statement or an expression
//! Used in contexts where either can appear (like export default)



/// Union representing either a statement or an expression node
pub const StmtOrExpr = union(enum) {
    /// Statement variant
    stmt: Stmt,

    /// Expression variant
    expr: Expr,

    /// Convert to an expression, transforming statements as needed
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


const js_ast = @import("js_ast.zig");
const logger = bun.logger;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const Output = bun.Output;
const bun = @import("root").bun;