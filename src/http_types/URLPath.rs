use bun_core::strings;
use bun_url::PercentEncoding;

#[derive(Default)]
pub struct URLPath {
    pub extname: &'static [u8],
    pub path: &'static [u8],
    pub pathname: &'static [u8],
    pub first_segment: &'static [u8],
    pub query_string: &'static [u8],
    pub needs_redirect: bool,
    /// Treat URLs as non-sourcemap URLS
    /// Then at the very end, we check.
    pub is_source_map: bool,
    _decoded_storage: Option<Box<[u8]>>,
}

impl URLPath {
    #[must_use = "dropping the returned storage dangles the slice fields of this URLPath"]
    pub fn take_decoded_storage(&mut self) -> Option<Box<[u8]>> {
        self._decoded_storage.take()
    }
}

pub fn parse(possibly_encoded_pathname_: &[u8]) -> Result<URLPath, bun_core::Error> {
    // TODO(port): narrow error set
    let mut decoded_pathname: &[u8] = possibly_encoded_pathname_;
    let mut decoded_storage: Option<Box<[u8]>> = None;
    let mut needs_redirect = false;

    if strings::index_of_char(decoded_pathname, b'%').is_some() {
        // Zig caps the in-place buffer at 16384; preserve that bound on input.
        let capped = &possibly_encoded_pathname_[..possibly_encoded_pathname_.len().min(16384)];

        let mut buf: Vec<u8> = Vec::with_capacity(capped.len());
        let n = PercentEncoding::decode_fault_tolerant::<_, true>(
            &mut buf,
            capped,
            Some(&mut needs_redirect),
        )?;
        debug_assert!(n as usize <= buf.len());
        buf.truncate(n as usize);
        decoded_storage = Some(buf.into_boxed_slice());
        decoded_pathname = decoded_storage.as_deref().unwrap();
    }

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

    // TODO(port): lifetime — see struct-level note. `extend` launders the borrow
    // to `'static` to match the field type; remove once URLPath gains a
    // proper lifetime parameter for the input-borrow case.
    #[inline(always)]
    fn extend(s: &[u8]) -> &'static [u8] {
        // SAFETY: local fn-item — every call below passes a slice that borrows
        // either the parser's input or `decoded_storage`, both of which are
        // moved into / outlive the returned `URLPath` (self-referential store).
        unsafe { bun_collections::detach_lifetime(s) }
    }

    Ok(URLPath {
        extname: extend(if !is_source_map {
            extname
        } else {
            backup_extname
        }),
        is_source_map,
        pathname: extend(decoded_pathname),
        first_segment: extend(first_segment),
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
        needs_redirect,
        _decoded_storage: decoded_storage,
    })
}

// ported from: src/http_types/URLPath.zig
