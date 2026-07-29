use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// Set once when the connection initiates `socket.close()`; never
        /// cleared. Guards `ref_and_close` against re-entering the close path
        /// from the on_handshake/on_close callbacks that a TLS close
        /// dispatches synchronously.
        const CLOSE_INITIATED                 = 1 << 5;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
