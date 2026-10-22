#[path = "mod.rs"]
pub mod builtins;
#[rustfmt::skip]
#[path = "generated.rs"]
mod generated;
#[path = "../ir/type_constants.rs"]
mod type_constants;

pub use generated::{entries, enums};

pub mod ir {
    pub mod generated {
        pub use crate::entries::*;
        pub use crate::enums::*;
    }

    pub use generated::{ContentsSlot, Opcode, WellKnownSymbol};
}
