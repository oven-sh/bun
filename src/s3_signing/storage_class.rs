#[allow(non_camel_case_types)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub enum StorageClass {
    STANDARD,
    STANDARD_IA,
    INTELLIGENT_TIERING,
    EXPRESS_ONEZONE,
    ONEZONE_IA,
    GLACIER,
    GLACIER_IR,
    REDUCED_REDUNDANCY,
    OUTPOSTS,
    DEEP_ARCHIVE,
    SNOW,
}

impl StorageClass {
    pub fn to_string(self) -> &'static [u8] {
        match self {
            Self::STANDARD => b"STANDARD",
            Self::STANDARD_IA => b"STANDARD_IA",
            Self::INTELLIGENT_TIERING => b"INTELLIGENT_TIERING",
            Self::EXPRESS_ONEZONE => b"EXPRESS_ONEZONE",
            Self::ONEZONE_IA => b"ONEZONE_IA",
            Self::GLACIER => b"GLACIER",
            Self::GLACIER_IR => b"GLACIER_IR",
            Self::REDUCED_REDUNDANCY => b"REDUCED_REDUNDANCY",
            Self::OUTPOSTS => b"OUTPOSTS",
            Self::DEEP_ARCHIVE => b"DEEP_ARCHIVE",
            Self::SNOW => b"SNOW",
        }
    }

    pub const MAP: phf::Map<&'static [u8], StorageClass> = phf::phf_map! {
        b"STANDARD" => StorageClass::STANDARD,
        b"STANDARD_IA" => StorageClass::STANDARD_IA,
        b"INTELLIGENT_TIERING" => StorageClass::INTELLIGENT_TIERING,
        b"EXPRESS_ONEZONE" => StorageClass::EXPRESS_ONEZONE,
        b"ONEZONE_IA" => StorageClass::ONEZONE_IA,
        b"GLACIER" => StorageClass::GLACIER,
        b"GLACIER_IR" => StorageClass::GLACIER_IR,
        b"REDUCED_REDUNDANCY" => StorageClass::REDUCED_REDUNDANCY,
        b"OUTPOSTS" => StorageClass::OUTPOSTS,
        b"DEEP_ARCHIVE" => StorageClass::DEEP_ARCHIVE,
        b"SNOW" => StorageClass::SNOW,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/s3_signing/storage_class.zig (45 lines)
//   confidence: high
//   todos:      0
//   notes:      variant names kept SCREAMING_SNAKE to match Zig + header values; MAP is assoc const (Zig had it nested)
// ──────────────────────────────────────────────────────────────────────────
