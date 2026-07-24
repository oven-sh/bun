use std::borrow::Cow;
use std::ops::Range;

use bun_core::strings;
use bun_url::PercentEncoding;

/// Parsed components of a request path (`/foo/bar.js?x=1`).
///
/// The struct holds one backing buffer plus `u32` offset ranges into it; every
/// accessor returns a sub-slice of that buffer, so nothing can dangle and the
/// struct is safely `Clone`/`Send`. The buffer borrows the `parse()` input in
/// the common case and is only owned when the input needed percent-decoding.
#[derive(Clone, Default)]
pub struct URLPath<'a> {
    buffer: Cow<'a, [u8]>,
    extname: Range<u32>,
    path: Range<u32>,
    first_segment: Range<u32>,
    query_string: Range<u32>,
    pub needs_redirect: bool,
    /// Treat URLs as non-sourcemap URLS
    /// Then at the very end, we check.
    pub is_source_map: bool,
}

impl<'a> URLPath<'a> {
    #[inline]
    fn slice(&self, r: &Range<u32>) -> &[u8] {
        &self.buffer[r.start as usize..r.end as usize]
    }

    /// The full (possibly percent-decoded) pathname, including the leading byte
    /// and the query string.
    #[inline]
    pub fn pathname(&self) -> &[u8] {
        &self.buffer
    }

    /// Pathname without the leading byte and without the query string. Returns
    /// `b"."` for a single-byte pathname.
    #[inline]
    pub fn path(&self) -> &[u8] {
        if self.buffer.len() == 1 {
            b"."
        } else {
            self.slice(&self.path)
        }
    }

    /// File extension without the leading dot. For `foo.js.map` this is `js`
    /// and [`Self::is_source_map`] is set instead.
    #[inline]
    pub fn extname(&self) -> &[u8] {
        self.slice(&self.extname)
    }

    /// First `/`-delimited segment, without the leading byte.
    #[inline]
    pub fn first_segment(&self) -> &[u8] {
        self.slice(&self.first_segment)
    }

    /// Query string including the leading `?`, or empty.
    #[inline]
    pub fn query_string(&self) -> &[u8] {
        self.slice(&self.query_string)
    }

    /// Consume `self` and return the percent-decode buffer if `parse()` had to
    /// allocate one (i.e. the input contained `%`). Returns `None` when the
    /// buffer is a borrow of the `parse()` input.
    #[inline]
    pub fn into_owned_buffer(self) -> Option<Vec<u8>> {
        match self.buffer {
            Cow::Owned(v) => Some(v),
            Cow::Borrowed(_) => None,
        }
    }
}

pub fn parse(input: &[u8]) -> Result<URLPath<'_>, bun_url::DecodeError> {
    let mut needs_redirect = false;

    let buffer: Cow<'_, [u8]> = if strings::index_of_char(input, b'%').is_some() {
        // The in-place decode buffer is capped at 16384 bytes of input.
        let capped = &input[..input.len().min(16384)];
        let mut buf: Vec<u8> = Vec::with_capacity(capped.len());
        let n = PercentEncoding::decode_fault_tolerant::<_, true>(
            &mut buf,
            capped,
            Some(&mut needs_redirect),
        )?;
        debug_assert!(n as usize <= buf.len());
        buf.truncate(n as usize);
        if buf.is_empty() {
            Cow::Borrowed(&b"/"[..])
        } else {
            Cow::Owned(buf)
        }
    } else if input.is_empty() {
        Cow::Borrowed(&b"/"[..])
    } else {
        Cow::Borrowed(input)
    };

    let bytes: &[u8] = &buffer;
    let len = bytes.len();
    debug_assert!(len <= u32::MAX as usize);

    let mut question_mark: Option<usize> = None;
    let mut period: Option<usize> = None;
    let mut first_segment_end: Option<usize> = None;
    let mut last_slash: Option<usize> = None;

    for (i, &c) in bytes.iter().enumerate().rev() {
        match c {
            b'?' => {
                if question_mark.is_none() {
                    question_mark = Some(i);
                    // Any `.` or `/` already seen sits to the right of this `?`
                    // (descending scan), i.e. inside the query string; discard.
                    period = None;
                    last_slash = None;
                }
            }
            b'.' => {
                if period.is_none() {
                    period = Some(i);
                }
            }
            b'/' => {
                if last_slash.is_none() {
                    last_slash = Some(i);
                }
                if i > 0 {
                    first_segment_end = Some(i);
                }
            }
            _ => {}
        }
    }

    if let (Some(s), Some(p)) = (last_slash, period) {
        if s > p {
            period = None;
        }
    }

    // .js.map
    //    ^
    let mut extname = match period {
        Some(p) => p + 1..question_mark.unwrap_or(len),
        None => 0..0,
    };

    // `path` is the pathname without the leading byte and without the query
    // string. When the input begins with `?` the end index is 0, so clamp the
    // start to avoid a 1..0 range.
    let path_end = question_mark.unwrap_or(len);
    let mut path = 1.min(path_end)..path_end;

    let seg_end = first_segment_end.unwrap_or(len);
    let first_segment = 1.min(seg_end)..seg_end;

    let is_source_map = bytes[extname.clone()] == *b"map";
    if is_source_map && path.len() > b".map".len() {
        let search = &bytes[path.start..path.end - b".map".len()];
        if let Some(j) = search.iter().rposition(|&b| b == b'.') {
            let dot = path.start + j;
            extname = dot + 1..path.end - b".map".len();
            path = path.start..path.end - b".map".len();
        }
    }

    let query_string = question_mark.map_or(0..0, |q| q..len);

    #[inline(always)]
    fn to_u32(r: Range<usize>) -> Range<u32> {
        r.start as u32..r.end as u32
    }

    Ok(URLPath {
        buffer,
        extname: to_u32(extname),
        path: to_u32(path),
        first_segment: to_u32(first_segment),
        query_string: to_u32(query_string),
        needs_redirect,
        is_source_map,
    })
}
