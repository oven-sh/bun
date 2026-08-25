//! An owned copy of an HTTP/1 request head (target and header fields), taken
//! when the uWS request a `Bun.serve` `Request` reads `url`/`headers` from is
//! about to leave the stack. Parsing into a `FetchHeaders` waits for the first
//! read, so a request nobody reads costs one allocation and one memcpy.

use bun_core::strings;
use bun_picohttp::Header as PicoHeader;
use bun_uws::Request as UwsRequest;

use crate::webcore::FetchHeaders;
use crate::webcore::response::HeadersRef;

/// Filled by `uws_req_copy_head` (src/uws_sys/libuwsockets.cpp), native-endian:
///
/// ```text
/// u32 count                   header fields
/// u32 target[2]               offset, length
/// u32 field[count][4]         name offset, name length, value offset, value length
/// u8  block[]                 the wire bytes; offsets are relative to it
/// ```
pub(crate) struct RequestHeadSnapshot {
    bytes: Box<[u8]>,
}

const U32: usize = core::mem::size_of::<u32>();

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
        self.view(1)
    }

    /// Header fields in wire order. Names keep their wire casing.
    pub(crate) fn headers(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        (0..self.u32(0)).map(move |i| (self.view(3 + 4 * i), self.view(5 + 4 * i)))
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

    fn u32(&self, i: usize) -> usize {
        let at = i * U32;
        u32::from_ne_bytes(self.bytes[at..at + U32].try_into().unwrap()) as usize
    }

    /// The bytes of the (offset, length) pair stored at index words `i` and `i + 1`.
    fn view(&self, i: usize) -> &[u8] {
        let block = &self.bytes[U32 * (3 + 4 * self.u32(0))..];
        let (offset, len) = (self.u32(i), self.u32(i + 1));
        &block[offset..offset + len]
    }
}
