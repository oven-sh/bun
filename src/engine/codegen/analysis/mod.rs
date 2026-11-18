//! Facts about a function. They hold until the function changes.

mod cfg;
mod dominators;
mod frequency;

pub use cfg::{Cfg, Loop, LoopData};
pub(crate) use dominators::Ancestry;
pub use dominators::Dominators;
pub use frequency::Frequencies;
pub(crate) use frequency::TURNS_OF_A_LOOP;
