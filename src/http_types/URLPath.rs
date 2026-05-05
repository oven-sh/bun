use core::cell::RefCell;

use bun_string::strings;
use bun_url::PercentEncoding;

// TODO(port): lifetime — every `&'static [u8]` field below actually borrows from
// either the `parse()` input slice or from the threadlocal scratch buffers. Zig
// has no lifetimes so this is implicit there. Phase B should either add a
// lifetime param to `URLPath` or restructure `parse()` to own the decoded buffer.
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
}

impl URLPath {
    pub fn is_root(&self, asset_prefix: &[u8]) -> bool {
        let without = self.path_without_asset_prefix(asset_prefix);
        if without.len() == 1 && without[0] == b'.' {
            return true;
        }
        without == b"index"
    }

    // TODO: use a real URL parser
    // this treats a URL like /_next/ identically to /
    pub fn path_without_asset_prefix(&self, asset_prefix: &[u8]) -> &[u8] {
        if asset_prefix.is_empty() {
            return self.path;
        }
        let leading_slash_offset: usize = if asset_prefix[0] == b'/' { 1 } else { 0 };
        let base = self.path;
        let origin = &asset_prefix[leading_slash_offset..];

        let out = if base.len() >= origin.len() && &base[0..origin.len()] == origin {
            &base[origin.len()..]
        } else {
            base
        };
        if self.is_source_map && out.ends_with(b".map") {
            return &out[0..out.len() - 4];
        }

        out
    }
}

// optimization: very few long strings will be URL-encoded
// we're allocating virtual memory here, so if we never use it, it won't be allocated
// and even when they're, they're probably rarely going to be > 1024 chars long
// so we can have a big and little one and almost always use the little one
thread_local! {
    static TEMP_PATH_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
    static BIG_TEMP_PATH_BUF: RefCell<[u8; 16384]> = const { RefCell::new([0u8; 16384]) };
}

pub fn parse(possibly_encoded_pathname_: &[u8]) -> Result<URLPath, bun_core::Error> {
    // TODO(b1): body gated — PercentEncoding::decode_fault_tolerant signature
    // mismatch (W: bun_io::Write bound + arg arity) vs Phase-A draft. Un-gate in B-2.
    #[cfg(any())]
    {
    // TODO(port): narrow error set
    let mut decoded_pathname: &[u8] = possibly_encoded_pathname_;
    let mut needs_redirect = false;

    if strings::index_of_char(decoded_pathname, b'%').is_some() {
        // https://github.com/ziglang/zig/issues/14148
        // TODO(port): lifetime — Zig returns slices into threadlocal storage from
        // this function. Rust `thread_local!` cannot hand out borrows past `with()`.
        // SAFETY: single-threaded per-thread scratch; the returned URLPath must not
        // outlive the next call to `parse()` on this thread (same invariant as Zig).
        let possibly_encoded_pathname: &mut [u8] = unsafe {
            match decoded_pathname.len() {
                0..=1024 => TEMP_PATH_BUF.with(|b| {
                    core::slice::from_raw_parts_mut(b.borrow_mut().as_mut_ptr(), 1024)
                }),
                _ => BIG_TEMP_PATH_BUF.with(|b| {
                    core::slice::from_raw_parts_mut(b.borrow_mut().as_mut_ptr(), 16384)
                }),
            }
        };
        let possibly_encoded_pathname = &mut possibly_encoded_pathname[0..possibly_encoded_pathname_
            .len()
            .min(possibly_encoded_pathname.len())];

        possibly_encoded_pathname
            .copy_from_slice(&possibly_encoded_pathname_[0..possibly_encoded_pathname.len()]);
        let clone = &possibly_encoded_pathname[0..possibly_encoded_pathname.len()];

        // TODO(port): std.io.fixedBufferStream(possibly_encoded_pathname).writer() —
        // PercentEncoding::decode_fault_tolerant in Rust should take
        // `&mut impl bun_io::Write`; passing the mutable slice directly here and
        // relying on the returned byte count.
        let n = PercentEncoding::decode_fault_tolerant(
            possibly_encoded_pathname,
            clone,
            &mut needs_redirect,
            true,
        )?;
        // PORT NOTE: reshaped for borrowck — re-slice from the buffer, not the &mut.
        decoded_pathname = unsafe {
            // SAFETY: same buffer as `possibly_encoded_pathname`, n <= len.
            core::slice::from_raw_parts(possibly_encoded_pathname.as_ptr(), n)
        };
    }

    let mut question_mark_i: i16 = -1;
    let mut period_i: i16 = -1;

    let mut first_segment_end: i16 = i16::MAX;
    let mut last_slash: i16 = -1;

    let mut i: i16 = i16::try_from(decoded_pathname.len()).unwrap() - 1;

    while i >= 0 {
        let c = decoded_pathname[usize::try_from(i).unwrap()];

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
            break 'brk &decoded_pathname
                [usize::try_from(period_i).unwrap()..usize::try_from(question_mark_i).unwrap()];
        } else if period_i > -1 {
            period_i += 1;
            break 'brk &decoded_pathname[usize::try_from(period_i).unwrap()..];
        } else {
            break 'brk &[];
        }
    };

    let mut path: &[u8] = if question_mark_i < 0 {
        &decoded_pathname[1..]
    } else {
        &decoded_pathname[1..usize::try_from(question_mark_i).unwrap()]
    };

    let first_segment =
        &decoded_pathname[1..(usize::try_from(first_segment_end).unwrap()).min(decoded_pathname.len())];
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
    // to `'static` to match the Phase-A field type; remove once URLPath gains a
    // proper lifetime or owned storage.
    #[inline(always)]
    unsafe fn extend(s: &[u8]) -> &'static [u8] {
        // SAFETY: caller upholds that `s` outlives all uses of the returned URLPath
        // (points into threadlocal scratch or the caller's input slice).
        core::mem::transmute::<&[u8], &'static [u8]>(s)
    }

    // SAFETY: every slice passed to `extend` below borrows either the caller's
    // input or the threadlocal scratch buffer; see TODO(port) above. Laundering
    // to 'static is a Phase-A placeholder until URLPath grows a real lifetime.
    Ok(unsafe {
        URLPath {
            extname: extend(if !is_source_map { extname } else { backup_extname }),
            is_source_map,
            pathname: extend(decoded_pathname),
            first_segment: extend(first_segment),
            path: extend(if decoded_pathname.len() == 1 {
                b"."
            } else {
                path
            }),
            query_string: extend(if question_mark_i > -1 {
                &decoded_pathname[usize::try_from(question_mark_i).unwrap()..decoded_pathname.len()]
            } else {
                b""
            }),
            needs_redirect,
        }
    })
    } // end #[cfg(any())]
    let _ = possibly_encoded_pathname_;
    todo!("b1-stub: URLPath::parse")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/URLPath.zig (150 lines)
//   confidence: medium
//   todos:      4
//   notes:      &'static [u8] fields are a placeholder; struct borrows from input/threadlocal scratch — Phase B must pick a real lifetime/ownership story. decode_fault_tolerant writer arg needs bun_io::Write shape.
// ──────────────────────────────────────────────────────────────────────────
