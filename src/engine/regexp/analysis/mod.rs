//! What can be known about a pattern before it meets a subject.

mod backtracking;
mod frequency;
mod inside;
mod next;
mod prefix;
mod scan;
mod turns;

pub(crate) use backtracking::decide_backtracking;
pub(crate) use frequency::Frequencies;
pub(crate) use inside::{Landmark, find_landmark};
pub(crate) use next::Next;
pub(crate) use prefix::Prefixes;
pub(crate) use scan::plan_scan;
