use bun_alloc::AllocError;
use bun_core::StringBuilder;
use bun_core::string::string_builder::Counting;

use crate::headers::{Entry, EntryList};

/// Counts what is appended to the [`HeaderBuilder`] that `allocate` returns.
#[derive(Default)]
pub struct HeaderCounter {
    pub content: StringBuilder<Counting>,
    pub header_count: usize,
}

pub struct HeaderBuilder {
    pub content: StringBuilder,
    pub entries: EntryList,
}

impl HeaderCounter {
    pub fn count(&mut self, name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) {
        self.header_count += 1;
        self.content.count(name.as_ref());
        self.content.count(value.as_ref());
    }

    /// Counts for [`HeaderBuilder::append_bytes_value`].
    pub fn count_bytes_value(&mut self, name: impl AsRef<[u8]>, prefix: &[u8], value: &[u8]) {
        self.count(name, prefix);
        self.content.count(value);
    }

    pub fn allocate(self) -> Result<HeaderBuilder, AllocError> {
        let mut entries = EntryList::default();
        entries.ensure_total_capacity(self.header_count)?;
        Ok(HeaderBuilder {
            content: self.content.allocate(),
            entries,
        })
    }
}

impl HeaderBuilder {
    pub fn from_pairs(pairs: &[(&[u8], &[u8])]) -> Result<Self, AllocError> {
        let mut headers = HeaderCounter::default();
        for &(name, value) in pairs {
            headers.count(name, value);
        }
        let mut headers = headers.allocate()?;
        for &(name, value) in pairs {
            headers.append(name, value);
        }
        Ok(headers)
    }

    pub fn append(&mut self, name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) {
        self.entries.append_assume_capacity(Entry {
            name: self.content.append_count(name.as_ref()),
            value: self.content.append_count(value.as_ref()),
        });
    }

    /// Append a header whose value is `prefix ++ value` (raw bytes).
    ///
    /// This exists because formatting would route through `core::fmt`/`BStr`
    /// Display, which is lossy for non-UTF-8 bytes (U+FFFD replacement) and
    /// would desync the byte length pre-reserved by `count`.
    pub fn append_bytes_value(&mut self, name: impl AsRef<[u8]>, prefix: &[u8], value: &[u8]) {
        self.entries.append_assume_capacity(Entry {
            name: self.content.append_count(name.as_ref()),
            value: self.content.add_concat(&[prefix, value]),
        });
    }
}
