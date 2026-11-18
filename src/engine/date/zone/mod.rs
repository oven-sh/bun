mod annual;
mod data;
mod id;
mod name;
mod rules;
mod system;
mod table;

use bun_icu::Buffer;

pub use id::TimeZoneId;
pub use rules::{LocalOffsets, ZoneRules};
pub(crate) use rules::{Offset, Side};
pub use system::set_time_zone_override;
pub(crate) use system::{system_time_zone, time_zone_generation};

use crate::format::{gmt_offset, iso_offset};

/// A time zone identifier (ECMA-262, 21.4.1.19).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum TimeZone {
    Named(TimeZoneId),
    /// Less than a day ahead of UTC or behind it.
    Offset {
        minutes: i16,
    },
}

impl TimeZone {
    /// The name, or FormatOffsetTimeZoneIdentifier.
    pub fn identifier(self) -> Identifier {
        match self {
            TimeZone::Named(id) => Identifier::Name(id.identifier()),
            TimeZone::Offset { minutes } => Identifier::Offset(iso_offset(minutes.into())),
        }
    }

    pub fn icu_id(self) -> Buffer<u16> {
        match self {
            TimeZone::Named(id) => id::widen(id.in_icu().identifier()),
            TimeZone::Offset { minutes } => {
                Buffer::from_slice(&gmt_offset(minutes.into()).map(u16::from))
            }
        }
    }

    /// TimeZoneEquals.
    pub fn is_same_zone(self, other: TimeZone) -> bool {
        match (self, other) {
            (TimeZone::Named(one), TimeZone::Named(other)) => {
                one == other || one.primary() == other.primary()
            }
            _ => self == other,
        }
    }
}

pub enum Identifier {
    Name(&'static str),
    Offset([u8; 6]),
}

impl core::ops::Deref for Identifier {
    type Target = str;

    fn deref(&self) -> &str {
        match self {
            Identifier::Name(name) => name,
            Identifier::Offset(ascii) => str::from_utf8(ascii).unwrap_or_default(),
        }
    }
}
