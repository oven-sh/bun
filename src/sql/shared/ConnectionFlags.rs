use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/shared/ConnectionFlags.zig (7 lines)
//   confidence: high
//   todos:      0
//   notes:      packed struct of bools → bitflags!; Zig field defaults (all false) → Default::empty()
// ──────────────────────────────────────────────────────────────────────────
