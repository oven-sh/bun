use bitflags::bitflags;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ConnectionFlags: u8 {
        const IS_READY_FOR_QUERY              = 1 << 0;
        const IS_PROCESSING_DATA              = 1 << 1;
        const USE_UNNAMED_PREPARED_STATEMENTS = 1 << 2;
        const WAITING_TO_PREPARE              = 1 << 3;
        const HAS_BACKPRESSURE                = 1 << 4;
        /// MySQL only: a LOCAL INFILE request was answered with the empty packet
        /// that ends the file transfer, so the next packet is the server's
        /// terminal OK/ERR for the query that triggered it.
        const AWAITING_LOCAL_INFILE_RESULT    = 1 << 5;
    }
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self::empty()
    }
}
