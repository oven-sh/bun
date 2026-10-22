#[path = "mod.rs"]
pub mod builtins;
#[allow(dead_code, unreachable_pub)]
#[rustfmt::skip]
#[path = "../ir/generated/entries.rs"]
pub mod entries;
#[allow(dead_code, unreachable_pub)]
#[rustfmt::skip]
#[path = "../ir/generated/enums.rs"]
pub mod enums;
#[path = "../ir/type_constants.rs"]
mod type_constants;

pub mod ir {
    pub mod generated {
        pub use crate::entries::*;
        pub use crate::enums::*;
    }

    pub use generated::{ContentsSlot, Opcode, WellKnownSymbol};
}
