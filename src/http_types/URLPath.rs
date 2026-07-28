use bun_core::strings;
use bun_url::PercentEncoding;

// TODO: lifetime — every `&'static [u8]` field below actually borrows from
// either the `parse()` input slice or, when the input was percent-encoded, from
// `_decoded_storage`. Add a
// lifetime param to `URLPath` so the input-borrow case is checked.
#[derive(Default)]
pub struct URLPath {
    pub path: &'static [u8],
    pub pathname: &'static [u8],
    pub query_string: &'static [u8],
    /// Owned backing storage for the slice fields when `parse()` had to
    /// percent-decode. Heap-stable: the slice fields above point into this
    /// allocation, which is never resized and lives exactly as long as `self`.
    /// Owning the decode buffer
    /// per-URLPath removes the use-after-free that a shared growable buffer
    /// would introduce on the next `parse()` call.
    ///
    /// `URLPath` must not be `Clone`: copying the slice fields without this
    /// owner would re-introduce the dangling hazard.
    _decoded_storage: Option<Box<[u8]>>,
    /// `/` bytes in `pathname` that were percent-decoded from the input and
    /// are therefore segment content, not segment separators.
    pub literal_slashes: LiteralSlashes,
}

/// Addresses of the `/` bytes within a decoded path buffer that came from a
/// percent-encoded input byte. Identity is by address, so any sub-slice of the
/// path can be queried. Sorted ascending; empty for un-encoded input.
#[derive(Default)]
pub struct LiteralSlashes(Vec<*const u8>);

impl LiteralSlashes {
    #[inline]
    pub fn is_separator(&self, byte: &u8) -> bool {
        *byte == b'/' && self.0.binary_search(&core::ptr::from_ref(byte)).is_err()
    }

    #[inline]
    pub fn find_separator(&self, s: &[u8]) -> Option<usize> {
        s.iter().position(|b| self.is_separator(b))
    }

    #[inline]
    pub fn contains_any(&self, s: &[u8]) -> bool {
        let range = s.as_ptr_range();
        self.0.iter().any(|p| range.contains(p))
    }
}

impl URLPath {
    /// Take ownership of the percent-decode buffer, if `parse()` had to
    /// allocate one. The slice fields of `self` keep pointing into the
    /// returned allocation — the caller must keep it alive for as long as any
    /// of those slices (or sub-slices of them) are read; dropping it while
    /// they are still in use leaves them dangling.
    #[must_use = "dropping the returned storage dangles the slice fields of this URLPath"]
    pub fn take_decoded_storage(&mut self) -> Option<Box<[u8]>> {
        self._decoded_storage.take()
    }
}

// Design note: a growable shared (e.g. threadlocal) decode buffer cannot work
// here — the next `parse()` may reallocate it and dangle every prior URLPath —
// so instead each URLPath that needs decoding owns its decode buffer in
// `_decoded_storage`. This costs one small allocation only on the
// percent-encoded path, which is the rare case.

pub fn parse(possibly_encoded_pathname_: &[u8]) -> Result<URLPath, bun_url::DecodeError> {
    let mut decoded_pathname: &[u8] = possibly_encoded_pathname_;
    let mut decoded_storage: Option<Box<[u8]>> = None;
    let mut needs_redirect = false;
    let mut query_start: Option<usize> =
        possibly_encoded_pathname_.iter().rposition(|&b| b == b'?');
    let mut literal_slash_offsets: Vec<usize> = Vec::new();

    if strings::index_of_char(decoded_pathname, b'%').is_some() {
        // The in-place decode buffer is capped at 16384 bytes of input.
        let capped = &possibly_encoded_pathname_[..possibly_encoded_pathname_.len().min(16384)];
        let raw_query_start = capped.iter().rposition(|&b| b == b'?');
        let raw_path = &capped[..raw_query_start.unwrap_or(capped.len())];

        let mut buf: Vec<u8> = Vec::with_capacity(capped.len());
        let mut rest = raw_path;
        loop {
            let encoded_slash = rest
                .windows(3)
                .position(|w| w[0] == b'%' && w[1] == b'2' && matches!(w[2], b'F' | b'f'));
            let chunk = &rest[..encoded_slash.unwrap_or(rest.len())];
            PercentEncoding::decode_fault_tolerant::<_, true>(
                &mut buf,
                chunk,
                Some(&mut needs_redirect),
            )?;
            let Some(encoded_slash) = encoded_slash else {
                break;
            };
            literal_slash_offsets.push(buf.len());
            buf.push(b'/');
            rest = &rest[encoded_slash + 3..];
        }
        query_start = None;
        if let Some(q) = raw_query_start {
            query_start = Some(buf.len());
            PercentEncoding::decode_fault_tolerant::<_, true>(
                &mut buf,
                &capped[q..],
                Some(&mut needs_redirect),
            )?;
        }
        // Freeze into a heap-stable Box and park it in `decoded_storage` before
        // borrowing: the slice fields in the returned URLPath borrow from this
        // allocation, and the Box is later moved into that same URLPath, so the
        // borrow is valid for the struct's whole lifetime (Box heap address is
        // stable across moves). NLL releases the local borrow after the last
        // use of `decoded_pathname` in the struct-literal field initialisers,
        // before `_decoded_storage` is moved.
        decoded_storage = Some(buf.into_boxed_slice());
        decoded_pathname = decoded_storage.as_deref().unwrap();
    }

    // The slicing below assumes a non-empty pathname with a leading byte to
    // skip. An empty input (or an input like "%PUBLIC_URL%" that the fault-
    // tolerant decoder consumes entirely) would otherwise index out of bounds.
    if decoded_pathname.is_empty() {
        decoded_pathname = b"/";
        decoded_storage = None;
        query_start = None;
        literal_slash_offsets.clear();
    }

    let mut question_mark_i: i32 = -1;
    let mut period_i: i32 = -1;

    let mut last_slash: i32 = -1;

    let mut i: i32 = i32::try_from(decoded_pathname.len()).expect("int cast") - 1;

    while i >= 0 {
        let idx = usize::try_from(i).expect("int cast");
        let c = decoded_pathname[idx];

        match c {
            b'?' if query_start == Some(idx) => {
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
            b'/' if literal_slash_offsets.binary_search(&idx).is_err() => {
                last_slash = last_slash.max(i);
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

    // `path` is the pathname without the leading byte and without the query
    // string. When the input begins with '?' the end index is 0, so clamp the
    // start to avoid a 1..0 slice.
    let path_end: usize = if question_mark_i < 0 {
        decoded_pathname.len()
    } else {
        usize::try_from(question_mark_i).expect("int cast")
    };
    let mut path: &[u8] = &decoded_pathname[1.min(path_end)..path_end];

    // For a source map (`foo.js.map`), strip the trailing `.map` so the path
    // names the mapped file — but only when an inner extension exists.
    if extname == b"map" && path.len() > b".map".len() {
        let stripped = &path[0..path.len() - b".map".len()];
        if stripped.contains(&b'.') {
            path = stripped;
        }
    }

    // TODO: lifetime — see struct-level note. `extend` launders the borrow
    // to `'static` to match the field type; remove once URLPath gains a
    // proper lifetime parameter for the input-borrow case.
    #[inline(always)]
    fn extend(s: &[u8]) -> &'static [u8] {
        // SAFETY: local fn-item — every call below passes a slice that borrows
        // either the parser's input or `decoded_storage`, both of which are
        // moved into / outlive the returned `URLPath` (self-referential store).
        unsafe { bun_collections::detach_lifetime(s) }
    }

    let literal_slashes = LiteralSlashes(
        literal_slash_offsets
            .iter()
            .map(|&offset| decoded_pathname[offset..].as_ptr())
            .collect(),
    );

    Ok(URLPath {
        literal_slashes,
        extname: extend(if !is_source_map {
            extname
        } else {
            backup_extname
        }),
        is_source_map,
        pathname: extend(decoded_pathname),
        path: extend(if decoded_pathname.len() == 1 {
            b"."
        } else {
            path
        }),
        query_string: extend(if question_mark_i > -1 {
            &decoded_pathname
                [usize::try_from(question_mark_i).expect("int cast")..decoded_pathname.len()]
        } else {
            b""
        }),
        _decoded_storage: decoded_storage,
    })
}
