//! Re-export of the canonical lower-tier writer. The runtime copy was a
//! pre-MOVE_DOWN Phase-A draft; `bun_spawn` is the single source of truth.
pub use bun_spawn::static_pipe_writer::{
    IOWriter, Poll, StaticPipeWriter, StaticPipeWriterProcess,
};
