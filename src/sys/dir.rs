use crate::Fd;

pub struct Dir {
    pub fd: Fd,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/dir.zig (6 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial struct wrapping an Fd; same-crate import
// ──────────────────────────────────────────────────────────────────────────
