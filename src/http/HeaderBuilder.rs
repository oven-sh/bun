use bun_alloc::AllocError;
use bun_string::StringBuilder;

use crate::headers::{api, Entry, EntryList};

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
        // TODO(port): narrow error set
        self.entries.ensure_total_capacity(self.header_count as usize)?;
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
        // PERF(port): was assume_capacity
        self.entries.append_assume_capacity(Entry { name: name_ptr, value: value_ptr });
    }

    pub fn append_fmt(&mut self, name: impl AsRef<[u8]>, args: core::fmt::Arguments<'_>) {
        let name = name.as_ref();
        let name_ptr = api::StringPointer {
            offset: self.content.len as u32,
            length: name.len() as u32,
        };

        let _ = self.content.append(name);

        // PORT NOTE: reshaped for borrowck — `fmt` returns a borrow into the
        // builder buffer; capture its length, then re-read `content.len`.
        let value_len = self.content.fmt(args).len();

        let value_ptr = api::StringPointer {
            offset: (self.content.len - value_len) as u32,
            length: value_len as u32,
        };

        // PERF(port): was assume_capacity
        self.entries.append_assume_capacity(Entry { name: name_ptr, value: value_ptr });
    }

    pub fn apply(&mut self, client: &mut crate::HTTPClient) {
        client.header_entries = core::mem::take(&mut self.entries);
        // TODO(port): lifetime — header_buf borrows from self.content's allocation; in Zig this
        // is a non-owning slice into the StringBuilder's buffer. Phase B must decide whether
        // HttpClient takes ownership of the buffer or borrows it.
        // SAFETY: content.ptr was set by allocate() and exactly content.len bytes have been written.
        client.header_buf = unsafe {
            core::slice::from_raw_parts(self.content.ptr.unwrap().as_ptr(), self.content.len)
        };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HeaderBuilder.zig (64 lines)
//   confidence: medium
//   todos:      2
//   notes:      EntryList = Headers.Entry.List (likely MultiArrayList/BabyList); apply() ownership of content buffer needs Phase B decision
// ──────────────────────────────────────────────────────────────────────────
