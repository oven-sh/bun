use bun_core::strings;
use bun_url::PercentEncoding;

pub struct URLPath<'a> {
    pub path: &'a [u8],
    pub query_string: &'a [u8],
}

const MAX_ENCODED_LEN: usize = 16384;

/// `None` if nothing is percent-encoded.
pub fn decode(possibly_encoded_pathname: &[u8]) -> Result<Option<Vec<u8>>, bun_url::DecodeError> {
    if !strings::contains_char(possibly_encoded_pathname, b'%') {
        return Ok(None);
    }
    let capped = &possibly_encoded_pathname[..possibly_encoded_pathname.len().min(MAX_ENCODED_LEN)];

    let mut buf: Vec<u8> = Vec::with_capacity(capped.len());
    PercentEncoding::decode_fault_tolerant::<_, true>(&mut buf, capped)?;
    Ok(Some(buf))
}

pub fn parse(decoded_pathname: &[u8]) -> URLPath<'_> {
    let mut question_mark_i: i32 = -1;
    let mut period_i: i32 = -1;

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
        if strings::contains_char(stripped, b'.') {
            path = stripped;
        }
    }

    URLPath {
        path: if decoded_pathname.len() == 1 {
            b"."
        } else {
            path
        },
        query_string: &decoded_pathname[path_end..],
    }
}
