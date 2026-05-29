use phf::phf_map;

#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct EventType(pub u8);

#[allow(non_upper_case_globals)]
impl EventType {
    pub const Event: Self = Self(0);
    pub const MessageEvent: Self = Self(1);
    pub const CloseEvent: Self = Self(2);
    pub const ErrorEvent: Self = Self(3);
    pub const OpenEvent: Self = Self(4);
    pub const unknown: Self = Self(254);

    pub const MAP: phf::Map<&'static [u8], EventType> = phf_map! {
        b"event" => EventType::Event,
        b"message" => EventType::MessageEvent,
        b"close" => EventType::CloseEvent,
        b"error" => EventType::ErrorEvent,
        b"open" => EventType::OpenEvent,
    };

    pub fn label(self) -> &'static [u8] {
        match self {
            Self::Event => b"event",
            Self::MessageEvent => b"message",
            Self::CloseEvent => b"close",
            Self::ErrorEvent => b"error",
            Self::OpenEvent => b"open",
            _ => b"event",
        }
    }
}

// ported from: src/jsc/EventType.zig
