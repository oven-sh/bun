use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// `ref()` was called; `on_data` must not unref the idle connection.
        const KEEP_ALIVE_REQUESTED            = 1 << 5;
        /// maxLifetime expired mid-query; retire at the next drain boundary (#30646).
        const LIFETIME_EXCEEDED               = 1 << 6;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
