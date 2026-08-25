//! The copy of a uWS request head that outlives the server dispatch, for `Request.url`/`.headers`.

use bun_core::strings;
use bun_picohttp::Header as PicoHeader;
use bun_uws::Request as UwsRequest;

use crate::webcore::FetchHeaders;
use crate::webcore::response::HeadersRef;

/// Written by `uws_req_copy_head` (libuwsockets.cpp): the `u32` index below, then the wire bytes.
pub(crate) struct RequestHeadSnapshot {
    bytes: Box<[u8]>,
}

const U32: usize = core::mem::size_of::<u32>();
/// Index words. A view is an (offset into the wire bytes, length) pair of words.
const COUNT_WORD: usize = 0;
const TARGET_VIEW: usize = 1;
const FIRST_FIELD_VIEW: usize = 3;
/// Name view, then value view.
const WORDS_PER_FIELD: usize = 4;

impl RequestHeadSnapshot {
    pub(crate) fn capture(req: &UwsRequest) -> Self {
        let size = req.copy_head(&mut []);
        let mut bytes = Box::<[u8]>::new_uninit_slice(size);
        let written = req.copy_head(&mut bytes);
        debug_assert_eq!(written, size);
        Self {
            // SAFETY: the head did not change between the two calls, so the
            // second one filled all `size` bytes.
            bytes: unsafe { bytes.assume_init() },
        }
    }

    /// The request target from the request line (path and query).
    pub(crate) fn target(&self) -> &[u8] {
        self.view(TARGET_VIEW)
    }

    /// Header fields in wire order. Names keep their wire casing.
    pub(crate) fn headers(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        (0..self.word(COUNT_WORD)).map(move |i| {
            let name = FIRST_FIELD_VIEW + WORDS_PER_FIELD * i;
            (self.view(name), self.view(name + 2))
        })
    }

    /// The first field named `lowercase_name`, ASCII case-insensitive.
    pub(crate) fn header(&self, lowercase_name: &[u8]) -> Option<&[u8]> {
        self.headers()
            .find(|(name, _)| {
                strings::eql_case_insensitive_ascii_check_length(name, lowercase_name)
            })
            .map(|(_, value)| value)
    }

    pub(crate) fn to_fetch_headers(&self) -> HeadersRef {
        let list: Vec<PicoHeader> = self
            .headers()
            .map(|(name, value)| PicoHeader::new(name, value))
            .collect();
        // SAFETY: C++ allocates a new FetchHeaders with refcount 1 and copies
        // every name and value before returning; never null.
        unsafe { HeadersRef::adopt(FetchHeaders::create_from_pico_headers(&list)) }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.bytes.len()
    }

    fn word(&self, i: usize) -> usize {
        let at = i * U32;
        u32::from_ne_bytes(self.bytes[at..at + U32].try_into().unwrap()) as usize
    }

    fn view(&self, i: usize) -> &[u8] {
        let index_words = FIRST_FIELD_VIEW + WORDS_PER_FIELD * self.word(COUNT_WORD);
        let wire = &self.bytes[U32 * index_words..];
        let (offset, len) = (self.word(i), self.word(i + 1));
        &wire[offset..offset + len]
    }
}
