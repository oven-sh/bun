//! STUB: to be replaced by the port of static_dict_lut.c (BrotliEncoderInitStaticDictionaryLut).

#[derive(Clone, Copy, Default)]
pub(crate) struct DictWord {
    /// The highest bit marks the end of a bucket.
    pub(crate) len: u8,
    pub(crate) transform: u8,
    pub(crate) idx: u16,
}

pub(crate) struct StaticDictionaryLut {
    pub(crate) buckets: Box<[u16]>,
    pub(crate) words: Box<[DictWord]>,
}

/// Built on first use.
pub(crate) fn static_dictionary_lut() -> &'static StaticDictionaryLut {
    static LUT: std::sync::LazyLock<StaticDictionaryLut> =
        std::sync::LazyLock::new(|| StaticDictionaryLut { buckets: Box::new([]), words: Box::new([]) });
    &LUT
}
