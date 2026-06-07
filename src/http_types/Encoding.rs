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
        matches!(self, Encoding::Gzip | Encoding::Deflate)
    }

    pub fn is_compressed(self) -> bool {
        matches!(
            self,
            Encoding::Brotli | Encoding::Gzip | Encoding::Deflate | Encoding::Zstd
        )
    }
}
