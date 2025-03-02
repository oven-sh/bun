//! Switch case representation
//! Represents a case clause in a switch statement

const js_ast = @import("js_ast.zig");
const bun = @import("root").bun;
const logger = bun.logger;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const StmtNodeList = js_ast.StmtNodeList;

/// The source location of this case clause
loc: logger.Loc,

/// The value expression for this case (null for "default:" case)
value: ?ExprNodeIndex,

/// The list of statement indices that belong to this case body
body: StmtNodeList,
