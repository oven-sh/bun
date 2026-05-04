#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Encoding {
    Identity,
    Gzip,
    Deflate,
    Brotli,
    Zstd,
    Chunked,
}

impl Encoding {
    pub fn can_use_lib_deflate(self) -> bool {
        match self {
            Encoding::Gzip | Encoding::Deflate => true,
            _ => false,
        }
    }

    pub fn is_compressed(self) -> bool {
        match self {
            Encoding::Brotli | Encoding::Gzip | Encoding::Deflate | Encoding::Zstd => true,
            _ => false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/Encoding.zig (22 lines)
//   confidence: high
//   todos:      0
//   notes:      plain enum + two predicate methods; no FFI/repr constraints in source
// ──────────────────────────────────────────────────────────────────────────
