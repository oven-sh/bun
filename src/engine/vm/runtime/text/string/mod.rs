//! The methods of `String.prototype`, once their arguments have been converted.

mod convert;
mod join;
mod joiner;
mod repeat;
mod replace;
mod search;
mod slice;
mod splice;
mod split;

pub use joiner::{JoinableNumber, StringJoiner};
pub use repeat::PadSide;
pub use replace::ReplaceMode;
pub use slice::TrimSides;
pub use splice::StringSplicer;

#[derive(Default)]
pub(super) struct State {
    splits: split::SplitCache,
    lower_case: convert::CaseCache,
    upper_case: convert::CaseCache,
    spaces: repeat::Spaces,
}

impl State {
    pub(super) fn clear_caches(&self) {
        self.splits.clear();
        self.lower_case.clear();
        self.upper_case.clear();
        self.spaces.clear();
    }
}
