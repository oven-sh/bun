//! Import/export clause utility
//! Represents a named item in an import or export clause

const bun = @import("root").bun;
const logger = bun.logger;
const string = bun.string;
const LocRef = @import("LocRef.zig");

/// ClauseItem represents an item in an import or export clause.
/// It tracks the alias and original name of a symbol being imported or exported.
const ClauseItem = @This();

/// The alias name for this import/export
alias: string,

/// The source location of the alias
alias_loc: logger.Loc = logger.Loc.Empty,

/// The original name with its location and reference
name: LocRef,

/// This is the original name of the symbol stored in "Name". It's needed for
/// "SExportClause" statements such as this:
///
///   export {foo as bar} from 'path'
///
/// In this case both "foo" and "bar" are aliases because it's a re-export.
/// We need to preserve both aliases in case the symbol is renamed. In this
/// example, "foo" is "OriginalName" and "bar" is "Alias".
original_name: string = "",

/// Default alias name constant
pub const default_alias: string = "default";
