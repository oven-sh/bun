// Selects between a WASM stub and an `Instant`-backed timer via cfg-gated
// definitions of `Timer`.

#[cfg(target_family = "wasm")]
pub struct Timer;

#[cfg(target_family = "wasm")]
impl Timer {
    pub fn start() -> Result<Self, bun_core::Error> {
        Ok(Self)
    }

    // Tracing is never enabled in WASM; keep the fn signatures and trap at
    // runtime instead of using `compile_error!` (which fires unconditionally).
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

// Non-WASM: wrap `std::time::Instant` behind a small monotonic-timer surface
// (`start`/`read`/`lap`/`reset`, ns as u64).
#[cfg(not(target_family = "wasm"))]
pub struct Timer {
    started: std::time::Instant,
}

#[cfg(not(target_family = "wasm"))]
impl Timer {
    pub fn start() -> Result<Self, bun_core::Error> {
        // Infallible here, but kept fallible to match the `Result` signature
        // callers already handle.
        Ok(Self {
            started: std::time::Instant::now(),
        })
    }

    pub fn read(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_nanos()).expect("int cast")
    }

    pub fn reset(&mut self) {
        self.started = std::time::Instant::now();
    }
}
