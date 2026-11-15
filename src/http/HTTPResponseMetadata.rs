use core::mem::MaybeUninit;

use bun_picohttp::{Header, HeaderList, Response};

/// Cloned response metadata (headers + url + status). Ownership transfers to
/// the user once the headers phase completes.
pub struct HTTPResponseMetadata {
    /// Points into the spare capacity of `buf`.
    headers: Box<[Header<'static>]>,
    /// The status text, then the URL. Not a `Box`: moving one asserts unique access.
    buf: Vec<u8>,
    status_text_len: usize,
    status_code: u32,
}

impl HTTPResponseMetadata {
    pub(crate) fn new(response: &Response<'_>, url: &[u8]) -> Self {
        let headers = response.headers.list.iter();
        let headers_len: usize = (headers.clone())
            .map(|header| header.name().len() + header.value().len())
            .sum();
        let mut buf = Vec::with_capacity(response.status.len() + url.len() + headers_len);
        buf.extend_from_slice(response.status);
        buf.extend_from_slice(url);
        // SAFETY: `buf` is not written to again, moving it does not move its bytes, and `headers()`
        // shortens the lifetime to that of `&self`.
        let mut spare: &'static mut [MaybeUninit<u8>] =
            unsafe { &mut *core::ptr::from_mut(buf.spare_capacity_mut()) };
        let mut copy = |bytes: &[u8]| -> &'static [u8] {
            let slot = spare
                .split_off_mut(..bytes.len())
                .expect("in `headers_len`");
            slot.write_copy_of_slice(bytes)
        };
        Self {
            headers: headers
                .map(|header| Header::new(copy(header.name()), copy(header.value())))
                .collect(),
            buf,
            status_text_len: response.status.len(),
            status_code: response.status_code,
        }
    }

    #[inline]
    pub fn status_code(&self) -> u32 {
        self.status_code
    }
    #[inline]
    pub fn status_text(&self) -> &[u8] {
        &self.buf[..self.status_text_len]
    }
    pub fn url(&self) -> &[u8] {
        &self.buf[self.status_text_len..]
    }
    pub fn headers(&self) -> HeaderList<'_> {
        HeaderList {
            list: &self.headers,
        }
    }
    #[inline]
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        self.headers().get(name)
    }
    #[inline]
    pub fn header_if_other_is_absent(&self, name: &[u8], other: &[u8]) -> Option<&[u8]> {
        self.headers().get_if_other_is_absent(name, other)
    }
}
