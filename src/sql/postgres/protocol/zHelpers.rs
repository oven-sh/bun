pub fn z_count(slice: &[u8]) -> usize {
    if !slice.is_empty() { slice.len() + 1 } else { 0 }
}

pub fn z_field_count(prefix: &[u8], slice: &[u8]) -> usize {
    if !slice.is_empty() {
        return z_count(prefix) + z_count(slice);
    }

    z_count(prefix)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/zHelpers.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      pure helper fns; no cross-crate deps
// ──────────────────────────────────────────────────────────────────────────
