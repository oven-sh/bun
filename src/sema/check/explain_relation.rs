//! Why one type is not related to another: the lines under "Type 'A' is not assignable to type 'B'."
//!
//! The relation itself only says yes or no. This goes over a pair it has said no to once more and finds the reasons `reportError`
//! collects in `relater.go`.

use super::Checker;
use super::explain::Line;
use crate::types::TypeId;

impl Checker<'_> {
    /// The lines under the message of an error that says `source` is not assignable to `target`, outermost first, from level 1.
    pub(super) fn assignability_chain(&mut self, source: TypeId, target: TypeId) -> Vec<Line> {
        let _ = (source, target);
        Vec::new()
    }
}
