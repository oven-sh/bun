use super::sasl::SASL;

pub enum AuthenticationState {
    Pending,
    None,
    Ok,
    Sasl(SASL),
    Md5,
}

impl AuthenticationState {
    pub fn zero(&mut self) {
        // PORT NOTE: Zig explicitly called sasl.deinit() before reassigning;
        // in Rust, assigning into *self drops the previous variant (and thus
        // SASL's Drop impl) automatically.
        *self = AuthenticationState::None;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/AuthenticationState.zig (19 lines)
//   confidence: high
//   todos:      0
//   notes:      union(enum) → Rust enum; zero() relies on Drop for SASL cleanup
// ──────────────────────────────────────────────────────────────────────────
