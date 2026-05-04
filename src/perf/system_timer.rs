// Zig's `fn NewTimer() type { ... }` is a comptime type-returning fn that
// selects between a WASM stub and `std.time.Timer`. In Rust we collapse the
// type-fn + `pub const Timer = NewTimer();` into cfg-gated definitions of
// `Timer` directly.

#[cfg(target_family = "wasm")]
pub struct Timer;

#[cfg(target_family = "wasm")]
impl Timer {
    pub fn start() -> Result<Self, bun_core::Error> {
        Ok(Self)
    }

    // TODO(port): Zig used `@compileError` here, which fires lazily only if the
    // fn is referenced. Rust's `compile_error!` fires unconditionally, so we
    // keep the fn signatures for structural parity and trap at runtime instead.
    pub fn read(&self) -> u64 {
        unreachable!("FeatureFlags.tracing should be disabled in WASM");
    }

    pub fn lap(&mut self) -> u64 {
        unreachable!("FeatureFlags.tracing should be disabled in WASM");
    }

    pub fn reset(&mut self) -> u64 {
        unreachable!("FeatureFlags.tracing should be disabled in WASM");
    }
}

// Non-WASM: Zig used `std.time.Timer` directly. Rust has no identical type, so
// wrap `std::time::Instant` with the same method surface (`start`/`read`/`lap`/
// `reset`, ns as u64).
#[cfg(not(target_family = "wasm"))]
pub struct Timer {
    started: std::time::Instant,
}

#[cfg(not(target_family = "wasm"))]
impl Timer {
    pub fn start() -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Self { started: std::time::Instant::now() })
    }

    pub fn read(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_nanos()).unwrap()
    }

    pub fn lap(&mut self) -> u64 {
        let now = std::time::Instant::now();
        let ns = u64::try_from(now.duration_since(self.started).as_nanos()).unwrap();
        self.started = now;
        ns
    }

    pub fn reset(&mut self) {
        self.started = std::time::Instant::now();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/perf/system_timer.zig (27 lines)
//   confidence: medium
//   todos:      2
//   notes:      Zig's lazy @compileError on WASM stubs mapped to unreachable!(); non-WASM reimplements std.time.Timer over std::time::Instant
// ──────────────────────────────────────────────────────────────────────────
