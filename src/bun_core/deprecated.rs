// ──────────────────────────────────────────────────────────────────────────
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

// Plain storage for a buffered reader. The only
// in-tree consumer (`pack_command::BufferedFileReader`) supplies its own read shim
// over `bun_sys::read`, so this stays a bare struct: no reader trait, no methods.
// (The dedicated stdin instance lives at `output::BufferedStdin`.)
pub struct BufferedReader<const BUFFER_SIZE: usize, R> {
    pub unbuffered_reader: R,
    pub buf: [u8; BUFFER_SIZE],
    pub start: usize,
    pub end: usize,
}


