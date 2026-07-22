use crate::SourceLocation;

/// A line and column position within a source file (1-based line), used by
/// `Url` values and printer error locations.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Location {
    /// The line number, starting from 1.
    pub(crate) line: u32,
    /// The column number, starting from 1.
    pub(crate) column: u32,
}

impl Location {
    pub(crate) fn from_source_location(loc: SourceLocation) -> Location {
        Location {
            line: loc.line + 1,
            column: loc.column,
        }
    }
}
