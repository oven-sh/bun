//! Source location for CSS `url()` values and printer errors.

use crate::SourceLocation;

/// A line and column position within a source file.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Location {
    /// The line number, starting from 1.
    pub line: u32,
    /// The column number, starting from 1.
    pub column: u32,
}

impl Location {
    pub fn from_source_location(loc: SourceLocation) -> Location {
        Location {
            line: loc.line + 1,
            column: loc.column,
        }
    }
}
