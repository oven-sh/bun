// GENERATED: re-run scripts/generate-perf-trace-events.sh with .rs output
// (source: src/perf/generated_perf_trace_events.zig — defines #[repr(i32)] enum PerfEvent)
// TODO(port): teach the generator to emit Rust; do not hand-maintain this file.

// TODO(b1): stub until generator emits real variants
#[repr(i32)]
#[derive(Clone, Copy, Debug)]
pub enum PerfEvent {
    _Stub = 0,
}

impl From<PerfEvent> for &'static str {
    fn from(_: PerfEvent) -> &'static str {
        "_Stub"
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/perf/generated_perf_trace_events.zig (62 lines)
//   confidence: high
//   todos:      1
//   notes:      generated file — update scripts/generate-perf-trace-events.sh to emit a #[repr(i32)] enum PerfEvent
// ──────────────────────────────────────────────────────────────────────────
