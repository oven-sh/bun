use bun_alloc::AllocError;
use bun_core::StringBuilder;

use crate::headers::{Entry, EntryList, api};

#[derive(Default)]
pub struct HeaderBuilder {
    pub content: StringBuilder,
    pub header_count: u64,
    pub entries: EntryList,
}

impl HeaderBuilder {
    pub fn count(&mut self, name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) {
        self.header_count += 1;
        self.content.count(name.as_ref());
        self.content.count(value.as_ref());
    }

    pub fn allocate(&mut self) -> Result<(), AllocError> {
        self.content.allocate()?;
        self.entries
            .ensure_total_capacity(self.header_count as usize)?;
        Ok(())
    }

    pub fn append(&mut self, name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) {
        let name = name.as_ref();
        let value = value.as_ref();
        let name_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: name.len() as u32,
        };

        let _ = self.content.append(name);

        let value_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: value.len() as u32,
        };
        let _ = self.content.append(value);
        self.entries.append_assume_capacity(Entry {
            name: name_ptr,
            value: value_ptr,
        });
    }

    /// Append a header whose value is `prefix ++ value` (raw bytes).
    ///
    /// This exists because `append_fmt` would route through `core::fmt`/`BStr`
    /// Display, which is lossy for non-UTF-8 bytes (U+FFFD replacement) and
    /// would desync the byte length pre-reserved by `count`.
    pub fn append_bytes_value(&mut self, name: impl AsRef<[u8]>, prefix: &[u8], value: &[u8]) {
        let name = name.as_ref();
        let name_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: name.len() as u32,
        };
        let _ = self.content.append(name);

        let value_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: (prefix.len() + value.len()) as u32,
        };
        let _ = self.content.append(prefix);
        let _ = self.content.append(value);
        self.entries.append_assume_capacity(Entry {
            name: name_ptr,
            value: value_ptr,
        });
    }

    pub fn append_fmt(&mut self, name: impl AsRef<[u8]>, args: core::fmt::Arguments<'_>) {
        let name = name.as_ref();
        let name_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: name.len() as u32,
        };

        let _ = self.content.append(name);

        // Note: reshaped for borrowck — `fmt` returns a borrow into the
        // builder buffer; capture its length, then re-read `content.len`.
        let value_len = self.content.fmt(args).len();

        let value_ptr = api::StringPointer {
            offset: (self.content.len - value_len) as u32,
            length: value_len as u32,
        };

        self.entries.append_assume_capacity(Entry {
            name: name_ptr,
            value: value_ptr,
        });
    }

    pub fn apply(&mut self, client: &mut crate::HTTPClient) {
        client.header_entries = core::mem::take(&mut self.entries);
        // header_buf is a non-owning slice into self.content's
        // allocation; the builder's owner must
        // keep `self.content` alive for as long as the client uses the slice.
        // SAFETY: content.ptr was set by allocate() and exactly content.len bytes have been written.
        // Cannot use `written_slice()` here — the borrow must outlive `&self` (`HTTPClient<'a>`
        // holds it past this call); the lifetime is intentionally unbound.
        client.header_buf =
            unsafe { bun_core::ffi::slice(self.content.ptr.unwrap().as_ptr(), self.content.len) };
    }
}
