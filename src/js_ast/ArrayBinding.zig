//! Array destructuring binding
//! Represents a binding in an array destructuring pattern

const js_ast = @import("js_ast.zig");
const BindingNodeIndex = js_ast.BindingNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;

/// The binding for this element (can be nested)
binding: BindingNodeIndex,

/// Optional default value expression for this binding
default_value: ?ExprNodeIndex = null,
