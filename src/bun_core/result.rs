/// Zig: `pub fn Result(comptime T: type, comptime E: type) type { return union(enum) { ok: T, err: E, ... } }`
pub enum Result<T, E> {
    Ok(T),
    Err(E),
}

impl<T, E> Result<T, E> {
    #[inline]
    pub fn as_err(&self) -> Option<&E> {
        if let Result::Err(e) = self {
            return Some(e);
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/result.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      Generic union(enum) → Rust enum; as_err returns Option<&E> (borrow) to avoid Clone bound — Phase B may want Option<E> with E: Copy if callers need owned.
// ──────────────────────────────────────────────────────────────────────────
