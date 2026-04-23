//! `bun test --parallel`: process-pool coordinator and worker.
//!
//! The coordinator lazily spawns up to N `bun test --test-worker --isolate`
//! processes (starting with one, adding another whenever every live worker
//! has been busy for ≥`scale_up_after_ms`), hands out one file at a time over
//! stdin, and reads per-test events back over fd 3. Per-test status lines are
//! streamed to the coordinator the moment a test finishes; worker stdout and
//! stderr are buffered and flushed atomically before each result line so
//! console output never interleaves across files. Output is identical to
//! serial: workers are an implementation detail and never named.
//!
//! Thin facade re-exporting the entry points from `parallel/`.

pub const runAsCoordinator = runner.runAsCoordinator;
pub const runAsWorker = runner.runAsWorker;
pub const workerEmitTestDone = runner.workerEmitTestDone;
pub const Worker = @import("./parallel/Worker.zig");

const runner = @import("./parallel/runner.zig");
