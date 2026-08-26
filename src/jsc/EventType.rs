// This type can hold any u8 value, not just the named tags. A plain
// `#[repr(u8)] enum` cannot express that (Rust enums are exhaustive;
// transmuting an unnamed discriminant is UB). Modeled as a transparent u8
// newtype with associated consts so the fallback arm in `label()` remains
// reachable.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct EventType(pub u8);

bun_core::comptime_string_map! {
    pub static MAP: EventType = {
        b"event" => EventType::Event,
        b"message" => EventType::MessageEvent,
        b"close" => EventType::CloseEvent,
        b"error" => EventType::ErrorEvent,
        b"open" => EventType::OpenEvent,
    };
}

#[allow(non_upper_case_globals)]
impl EventType {
    pub(crate) const Event: Self = Self(0);
    pub(crate) const MessageEvent: Self = Self(1);
    pub(crate) const CloseEvent: Self = Self(2);
    pub(crate) const ErrorEvent: Self = Self(3);
    pub(crate) const OpenEvent: Self = Self(4);
    pub(crate) const unknown: Self = Self(254);

    /// The map type is a zero-sized handle, so this is the same map as the
    /// module-level `MAP` static.
    pub(crate) const MAP: __ComptimeStringMap_MAP = __ComptimeStringMap_MAP(());

    pub(crate) fn label(self) -> &'static [u8] {
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
