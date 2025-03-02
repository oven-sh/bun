//! Location reference utility
//! Combines source location with optional reference

const logger = @import("root").bun.logger;
const ast_base = @import("../ast/base.zig");
const Ref = ast_base.Ref;

/// LocRef combines a source location and an optional reference.
/// Used throughout the AST to track both position and symbol reference information.
const LocRef = @This();

/// The source code location
loc: logger.Loc = logger.Loc.Empty,

/// Optional reference to a symbol or other identifier
/// TODO: remove this optional and make Ref a function getter
/// That will make this struct 128 bits instead of 192 bits and we can remove some heap allocations
ref: ?Ref = null,
