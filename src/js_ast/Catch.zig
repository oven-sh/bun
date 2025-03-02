//! Catch clause in try/catch statement

/// Represents a catch clause in a try/catch statement
/// Source location of the catch keyword
loc: logger.Loc,

/// Optional binding for the caught error
binding: ?BindingNodeIndex = null,

/// Body of the catch clause (statements to execute)
body: StmtNodeList,

/// Source location of the body
body_loc: logger.Loc,

const bun = @import("root").bun;
const logger = bun.logger;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const StmtNodeList = js_ast.StmtNodeList;
const js_ast = @import("js_ast.zig");
