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
    pub const fn to_string(self) -> &'static str {
        match self {
            Self::STANDARD => "STANDARD",
            Self::STANDARD_IA => "STANDARD_IA",
            Self::INTELLIGENT_TIERING => "INTELLIGENT_TIERING",
            Self::EXPRESS_ONEZONE => "EXPRESS_ONEZONE",
            Self::ONEZONE_IA => "ONEZONE_IA",
            Self::GLACIER => "GLACIER",
            Self::GLACIER_IR => "GLACIER_IR",
            Self::REDUCED_REDUNDANCY => "REDUCED_REDUNDANCY",
            Self::OUTPOSTS => "OUTPOSTS",
            Self::DEEP_ARCHIVE => "DEEP_ARCHIVE",
            Self::SNOW => "SNOW",
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

// ported from: src/s3_signing/storage_class.zig
