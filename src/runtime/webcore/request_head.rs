//! The copy of a uWS request head that outlives the server dispatch, for `Request.url`/`.headers`.

use core::ptr::NonNull;

use bun_core::strings;
use bun_picohttp::Header as PicoHeader;
use bun_uws::Request as UwsRequest;

use crate::webcore::FetchHeaders;
use crate::webcore::response::HeadersRef;

/// One allocation written by `uws_req_copy_head` (libuwsockets.cpp): the `u32` index below, then the wire bytes.
#[repr(transparent)]
pub(crate) struct RequestHeadSnapshot(NonNull<u8>);

const U32: usize = core::mem::size_of::<u32>();
/// Index words. A view is an (offset into the wire bytes, length) pair of words.
const SIZE_WORD: usize = 0;
const COUNT_WORD: usize = 1;
const TARGET_VIEW: usize = 2;
const FIRST_FIELD_VIEW: usize = 4;
/// Name view, then value view.
const WORDS_PER_FIELD: usize = 4;

impl RequestHeadSnapshot {
    pub(crate) fn capture(req: &UwsRequest) -> Self {
        let size = req.copy_head(&mut []);
        let mut bytes = Box::<[u8]>::new_uninit_slice(size);
        let written = req.copy_head(&mut bytes);
        debug_assert_eq!(written, size);
        // SAFETY: the head did not change between the two calls, so the second
        // one filled all `size` bytes.
        let bytes: &mut [u8] = Box::leak(unsafe { bytes.assume_init() });
        Self(NonNull::from(bytes).cast::<u8>())
    }

    /// Hands the allocation to a raw slot. [`Self::from_raw`] takes it back.
    pub(crate) fn into_raw(self) -> NonNull<u8> {
        core::mem::ManuallyDrop::new(self).0
    }

    /// Safety: `ptr` comes from [`Self::into_raw`] and is taken back only once.
    pub(crate) unsafe fn from_raw(ptr: NonNull<u8>) -> Self {
        Self(ptr)
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
        self.size()
    }

    fn size(&self) -> usize {
        // SAFETY: the allocation starts with its own size, written by `uws_req_copy_head`.
        let word = unsafe {
            self.0
                .as_ptr()
                .add(SIZE_WORD * U32)
                .cast::<[u8; U32]>()
                .read()
        };
        u32::from_ne_bytes(word) as usize
    }

    fn bytes(&self) -> &[u8] {
        // SAFETY: `self.0` is the live `size()`-byte allocation `capture` leaked.
        unsafe { core::slice::from_raw_parts(self.0.as_ptr(), self.size()) }
    }

    fn word(&self, i: usize) -> usize {
        let at = i * U32;
        u32::from_ne_bytes(self.bytes()[at..at + U32].try_into().unwrap()) as usize
    }

    fn view(&self, i: usize) -> &[u8] {
        let index_words = FIRST_FIELD_VIEW + WORDS_PER_FIELD * self.word(COUNT_WORD);
        let wire = &self.bytes()[U32 * index_words..];
        let (offset, len) = (self.word(i), self.word(i + 1));
        &wire[offset..offset + len]
    }
}

impl Drop for RequestHeadSnapshot {
    fn drop(&mut self) {
        let size = self.size();
        // SAFETY: reassembles the `Box<[u8]>` that `capture` leaked; this is its one owner.
        drop(unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(self.0.as_ptr(), size)) });
    }
}
