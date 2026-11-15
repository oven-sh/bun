use bun_collections::BoundedArray;

pub(crate) type InlineStorage = BoundedArray<u8, 15>;

/// Owned bytes, inline when they are short.
#[derive(Default)]
pub enum Data {
    Owned(Vec<u8>),
    InlineStorage(InlineStorage),
    #[default]
    Empty,
}

impl Data {
    #[inline]
    pub(crate) const fn empty() -> Data {
        Data::Empty
    }

    pub fn create(possibly_inline_bytes: &[u8]) -> Result<Data, bun_alloc::AllocError> {
        if possibly_inline_bytes.is_empty() {
            return Ok(Data::Empty);
        }

        if possibly_inline_bytes.len() <= 15 {
            // BoundedArray has private fields; build via from_slice (capacity is 15).
            let inline_storage =
                InlineStorage::from_slice(possibly_inline_bytes).expect("len <= 15 checked above");
            return Ok(Data::InlineStorage(inline_storage));
        }
        Ok(Data::Owned(possibly_inline_bytes.to_vec()))
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Data::Owned(owned) => owned,
            Data::Empty => b"",
            Data::InlineStorage(inline_storage) => inline_storage.as_slice(),
        }
    }
}
