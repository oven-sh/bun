//! Finally clause in try/catch/finally statement

/// Source location of the finally keyword
loc: logger.Loc,

/// Statements to execute in the finally block
stmts: StmtNodeList,

const logger = bun.logger;
const StmtNodeList = js_ast.StmtNodeList;
const js_ast = @import("js_ast.zig");
const bun = @import("root").bun;
