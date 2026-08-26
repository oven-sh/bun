/// Monotonic timer over `std::time::Instant` (`start`/`read`/`reset`, ns as u64).
pub struct Timer {
    started: std::time::Instant,
}

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
