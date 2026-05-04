use phf::phf_map;

// PORT NOTE: Zig `enum(u8) { ..., _ }` is non-exhaustive — it can hold any u8
// value, not just the named tags. A plain `#[repr(u8)] enum` cannot express
// that (Rust enums are exhaustive; transmuting an unnamed discriminant is UB).
// Modeled as a transparent u8 newtype with associated consts so the `else`
// arm in `label()` remains reachable, matching Zig control flow.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct EventType(pub u8);

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/EventType.zig (32 lines)
//   confidence: high
//   todos:      0
//   notes:      non-exhaustive enum(u8) → transparent u8 newtype; phf_map keys hardcoded (Zig used .label() at comptime)
// ──────────────────────────────────────────────────────────────────────────
