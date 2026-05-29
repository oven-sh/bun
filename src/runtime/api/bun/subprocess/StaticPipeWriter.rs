//! Re-export of the canonical lower-tier writer; `bun_spawn` is the single
//! source of truth.
pub use bun_spawn::static_pipe_writer::{
    IOWriter, Poll, StaticPipeWriter, StaticPipeWriterProcess,
};
