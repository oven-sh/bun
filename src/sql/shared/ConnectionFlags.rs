use bun_core::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u16 {
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// `ref()` was called; `on_data` must not unref the idle connection.
        const KEEP_ALIVE_REQUESTED            = 1 << 5;
        /// The handshake finished during this read; `onconnect` runs at the end of it.
        const ON_CONNECT_PENDING              = 1 << 6;
        /// PostgreSQL: a CancelRequest can still arrive, so nothing it could stop is written.
        const CANCEL_IN_FLIGHT                = 1 << 9;
        /// PostgreSQL: the socket is not read until the consumer of a COPY TO STDOUT wants more.
        const COPY_OUT_PAUSED                 = 1 << 10;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
