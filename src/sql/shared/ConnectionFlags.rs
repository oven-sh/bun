use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// JS called `ref()` on the connection and has not called `unref()`:
        /// keep the event loop alive while the connection is open even when it
        /// is idle (no query running, nothing buffered). The dedicated LISTEN
        /// connection relies on this so a subscribed-only process stays alive
        /// between notifications. Cleared by `unref()`; the close/failure
        /// paths release the poll ref unconditionally.
        const KEEP_ALIVE_REQUESTED            = 1 << 5;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
