use bun_core::strings;
use bun_url::PercentEncoding;

/// Byte range into [`URLPath::backing`]. `start == end == 0` is the empty
/// sentinel produced by `Default` (valid against any backing, including
/// `None`).
#[derive(Clone, Copy, Default)]
struct Span {
    start: usize,
    end: usize,
}

/// Parsed request path. Fully owned: `parse()` copies (or percent-decodes)
/// the input into `backing`, and every component is stored as a byte range
/// into that single allocation — no borrowed or lifetime-erased slices, so
/// the struct can be stored anywhere without a use-after-free surface.
#[derive(Default)]
pub struct URLPath {
    extname: Span,
    path: Span,
    pathname: Span,
    first_segment: Span,
    query_string: Span,
    /// `true` when the normalized `path` is the literal `"."` (root), which
    /// is not a subslice of `backing`.
    path_is_dot: bool,
    pub needs_redirect: bool,
    /// Treat URLs as non-sourcemap URLS
    /// Then at the very end, we check.
    pub is_source_map: bool,
    /// Owned backing bytes for every span above. `None` only for
    /// `URLPath::default()` (all spans empty).
    backing: Option<Box<[u8]>>,
}

impl URLPath {
    #[inline]
    fn slice(&self, s: Span) -> &[u8] {
        match &self.backing {
            Some(b) => &b[s.start..s.end],
            None => &[],
        }
    }

    /// File extension of the (possibly sourcemap-stripped) path, without the
    /// leading dot. Empty when there is none.
    #[inline]
    pub fn extname(&self) -> &[u8] {
        self.slice(self.extname)
    }

    /// Normalized path: pathname without the leading `/` and without the
    /// query string; `"."` for the root path.
    #[inline]
    pub fn path(&self) -> &[u8] {
        if self.path_is_dot {
            return b".";
        }
        self.slice(self.path)
    }

    /// The full (decoded) pathname, including the query string if present.
    #[inline]
    pub fn pathname(&self) -> &[u8] {
        self.slice(self.pathname)
    }

    /// First path segment (between the leading `/` and the next `/`).
    #[inline]
    pub fn first_segment(&self) -> &[u8] {
        self.slice(self.first_segment)
    }

    /// The query string, starting at `?`. Empty when there is none.
    #[inline]
    pub fn query_string(&self) -> &[u8] {
        self.slice(self.query_string)
    }

    /// Take ownership of the backing allocation. The spans stored in `self`
    /// were computed against exactly these bytes, so slices previously read
    /// through the accessors remain valid against the returned `Box` (heap
    /// address is stable across the move). After this call the accessors on
    /// `self` all return empty slices.
    #[must_use = "dropping the returned storage frees the bytes previously returned by this URLPath's accessors"]
    pub fn take_backing(&mut self) -> Option<Box<[u8]>> {
        self.backing.take()
    }
}

/// Offset range of `sub` within `parent`. `sub` must be a subslice of
/// `parent` (always the case in `parse` below — every component is sliced
/// out of the single `decoded_pathname` buffer).
#[inline]
fn span_of(parent: &[u8], sub: &[u8]) -> Span {
    debug_assert!(
        sub.is_empty() || {
            let p = parent.as_ptr() as usize;
            let s = sub.as_ptr() as usize;
            s >= p && s + sub.len() <= p + parent.len()
        }
    );
    if sub.is_empty() {
        return Span::default();
    }
    let start = sub.as_ptr() as usize - parent.as_ptr() as usize;
    Span {
        start,
        end: start + sub.len(),
    }
}

pub fn parse(possibly_encoded_pathname_: &[u8]) -> Result<URLPath, bun_url::DecodeError> {
    let mut needs_redirect = false;

    // Own the bytes up front: either a percent-decoded copy or a plain copy
    // of the input. All spans below index into this one allocation.
    let backing: Box<[u8]> = if strings::index_of_char(possibly_encoded_pathname_, b'%').is_some() {
        // The in-place decode buffer is capped at 16384 bytes of input.
        let capped = &possibly_encoded_pathname_[..possibly_encoded_pathname_.len().min(16384)];

        let mut buf: Vec<u8> = Vec::with_capacity(capped.len());
        let n = PercentEncoding::decode_fault_tolerant::<_, true>(
            &mut buf,
            capped,
            Some(&mut needs_redirect),
        )?;
        debug_assert!(n as usize <= buf.len());
        buf.truncate(n as usize);
        buf.into_boxed_slice()
    } else {
        Box::from(possibly_encoded_pathname_)
    };
    let decoded_pathname: &[u8] = &backing;

    let mut question_mark_i: i32 = -1;
    let mut period_i: i32 = -1;

    let mut first_segment_end: i32 = i32::MAX;
    let mut last_slash: i32 = -1;

    let mut i: i32 = i32::try_from(decoded_pathname.len()).expect("int cast") - 1;

    while i >= 0 {
        let c = decoded_pathname[usize::try_from(i).expect("int cast")];

        match c {
            b'?' => {
                question_mark_i = question_mark_i.max(i);
                if question_mark_i < period_i {
                    period_i = -1;
                }

                if last_slash > question_mark_i {
                    last_slash = -1;
                }
            }
            b'.' => {
                period_i = period_i.max(i);
            }
            b'/' => {
                last_slash = last_slash.max(i);

                if i > 0 {
                    first_segment_end = first_segment_end.min(i);
                }
            }
            _ => {}
        }

        i -= 1;
    }

    if last_slash > period_i {
        period_i = -1;
    }

    // .js.map
    //    ^
    let extname: &[u8] = 'brk: {
        if question_mark_i > -1 && period_i > -1 {
            period_i += 1;
            break 'brk &decoded_pathname[usize::try_from(period_i).expect("int cast")
                ..usize::try_from(question_mark_i).expect("int cast")];
        } else if period_i > -1 {
            period_i += 1;
            break 'brk &decoded_pathname[usize::try_from(period_i).expect("int cast")..];
        } else {
            break 'brk &[];
        }
    };

    let mut path: &[u8] = if question_mark_i < 0 {
        &decoded_pathname[1..]
    } else {
        &decoded_pathname[1..usize::try_from(question_mark_i).expect("int cast")]
    };

    let first_segment = &decoded_pathname
        [1..(usize::try_from(first_segment_end).expect("int cast")).min(decoded_pathname.len())];
    let is_source_map = extname == b"map";
    let mut backup_extname: &[u8] = extname;
    if is_source_map && path.len() > b".map".len() {
        if let Some(j) = path[0..path.len() - b".map".len()]
            .iter()
            .rposition(|&b| b == b'.')
        {
            backup_extname = &path[j + 1..];
            backup_extname = &backup_extname[0..backup_extname.len() - b".map".len()];
            path = &path[0..j + backup_extname.len() + 1];
        }
    }

    let path_is_dot = decoded_pathname.len() == 1;
    Ok(URLPath {
        extname: span_of(
            decoded_pathname,
            if !is_source_map {
                extname
            } else {
                backup_extname
            },
        ),
        is_source_map,
        pathname: span_of(decoded_pathname, decoded_pathname),
        first_segment: span_of(decoded_pathname, first_segment),
        path_is_dot,
        path: if path_is_dot {
            Span::default()
        } else {
            span_of(decoded_pathname, path)
        },
        query_string: span_of(
            decoded_pathname,
            if question_mark_i > -1 {
                &decoded_pathname
                    [usize::try_from(question_mark_i).expect("int cast")..decoded_pathname.len()]
            } else {
                b""
            },
        ),
        needs_redirect,
        backing: Some(backing),
    })
}
