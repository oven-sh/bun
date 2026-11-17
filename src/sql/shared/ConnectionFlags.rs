use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u16 {
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// `ref()` was called; `on_data` must not unref the idle connection.
        const KEEP_ALIVE_REQUESTED            = 1 << 5;
        /// PostgreSQL: the socket is not read until the consumer of a COPY TO STDOUT wants more.
        const COPY_OUT_PAUSED                 = 1 << 10;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
