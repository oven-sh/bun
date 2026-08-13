use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// A request is being encoded into the write buffer. Encoding runs
        /// user JS (parameter `valueOf`/`toString`/`toJSON`), which may
        /// dispatch another query on this connection: while set, that query
        /// is only enqueued, and draining/flushing is left to the encoder.
        const IS_DISPATCHING                  = 1 << 5;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
