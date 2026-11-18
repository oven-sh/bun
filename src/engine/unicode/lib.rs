//! Unicode character data: identifier classes, case mapping, properties.

#![forbid(unsafe_code)]

mod case;
mod identifier;
mod ignore_case;
mod property;
#[rustfmt::skip]
mod tables;
mod white_space;

pub use case::{to_lower_case, to_upper_case};
pub use identifier::{is_id_continue, is_id_start, is_identifier_part, is_identifier_start};
pub use ignore_case::IgnoreCase;
pub use property::{Property, PropertyRanges, PropertyStrings};
pub use white_space::{is_line_terminator, is_str_white_space, is_white_space};

pub const MAX_CODE_POINT: u32 = 0x10_ffff;
