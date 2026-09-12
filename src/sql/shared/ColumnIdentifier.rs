use super::data::Data;

pub enum ColumnIdentifier {
    Name(Data),
    Index(u32),
    Duplicate,
}

impl ColumnIdentifier {
    pub(crate) fn init(name: Data) -> Result<Self, bun_alloc::AllocError> {
        if name.slice().is_empty() {
            return Ok(Self::Name(Data::Empty));
        }
        if let Some(index) = parse_index(name.slice()) {
            return Ok(Self::Index(index));
        }

        let owned = name.to_owned()?;
        let owned = match bstr::ByteSlice::to_str_lossy(owned.as_slice()) {
            std::borrow::Cow::Owned(replaced) => replaced.into_bytes(),
            std::borrow::Cow::Borrowed(_) => owned,
        };
        Ok(Self::Name(Data::Owned(owned)))
    }
}

/// Mirrors JSC's `parseIndex`: a property key is an array index only when it is
/// the canonical decimal spelling of an integer below `u32::MAX`. `"0"` and
/// `"10"` are indices; `"00"`, `"007"`, `"2024_01"` and `"4294967295"` are
/// names. Row objects store `Index` columns via `putDirectIndex` and `Name`
/// columns as Structure properties, so this must classify exactly as JSC does:
/// indexing `"007"` would surface the column as `"7"` and make
/// `dedupe_columns` drop it when a real `"7"` column is also selected.
/// Hand-rolled because `parse_unsigned` accepts `_` digit separators.
fn parse_index(name: &[u8]) -> Option<u32> {
    let (&first, rest) = name.split_first()?;
    if !first.is_ascii_digit() || (first == b'0' && !rest.is_empty()) {
        return None;
    }
    // Bounding the length keeps the accumulator from overflowing.
    if name.len() > "4294967295".len() {
        return None;
    }
    let mut value = u64::from(first - b'0');
    for &byte in rest {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + u64::from(byte - b'0');
    }
    let index = u32::try_from(value).ok()?;
    (index < u32::MAX).then_some(index)
}

// `deinit` dropped: the only work was `name.deinit()`, which Rust handles via
// `Data: Drop` when the `Name` variant is dropped.
