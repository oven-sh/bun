//! STUB: to be replaced by the port of dictionary_hash.c (BrotliEncoderInitDictionaryHash).

pub(crate) struct DictionaryHash {
    pub(crate) words: Box<[u16]>,
    pub(crate) lengths: Box<[u8]>,
}

/// Built on first use.
pub(crate) fn dictionary_hash() -> &'static DictionaryHash {
    static HASH: std::sync::LazyLock<DictionaryHash> =
        std::sync::LazyLock::new(|| DictionaryHash { words: Box::new([]), lengths: Box::new([]) });
    &HASH
}
