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
//
// PORT NOTE: Zig uses two threadlocal fixed `[1024]u8`/`[16384]u8` buffers and
// decodes in-place via `fixedBufferStream`. `bun_url::PercentEncoding` only
// exposes a `Write`-bounded decoder whose trait is crate-private; the sole
// externally-usable impl is `Vec<u8>`. Use a threadlocal `Vec<u8>` as the
// scratch decode target instead — same lifetime contract (slices into it are
// valid until the next `parse()` on this thread), one buffer instead of two.
// PERF(port): was zero-alloc fixed buffers — profile in Phase B.
thread_local! {
    static DECODE_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

pub fn parse(possibly_encoded_pathname_: &[u8]) -> Result<URLPath, bun_core::Error> {
    // TODO(port): narrow error set
    let mut decoded_pathname: &[u8] = possibly_encoded_pathname_;
    let mut needs_redirect = false;

    if strings::index_of_char(decoded_pathname, b'%').is_some() {
        // Zig caps the in-place buffer at 16384; preserve that bound on input.
        let capped = &possibly_encoded_pathname_[..possibly_encoded_pathname_.len().min(16384)];

        // TODO(port): lifetime — Zig returns slices into threadlocal storage from
        // this function. Rust `thread_local!` cannot hand out borrows past
        // `with_borrow_mut()`. We launder the Vec's data pointer into a raw slice
        // with the same single-threaded scratch invariant as Zig: the returned
        // URLPath must not outlive the next call to `parse()` on this thread.
        let (ptr, n) = DECODE_BUF.with_borrow_mut(|buf| -> Result<(*const u8, usize), bun_core::Error> {
            buf.clear();
            buf.reserve(capped.len());
            let n = PercentEncoding::decode_fault_tolerant::<_, true>(
                buf,
                capped,
                Some(&mut needs_redirect),
            )?;
            Ok((buf.as_ptr(), n as usize))
        })?;
        // SAFETY: `ptr` points into the threadlocal `DECODE_BUF` which lives for
        // the thread lifetime; `n <= buf.len()`; not reallocated until next
        // `parse()` call. Same invariant the Zig threadlocal buffers carry.
        decoded_pathname = unsafe { core::slice::from_raw_parts(ptr, n) };
    }

    let mut question_mark_i: i16 = -1;
    let mut period_i: i16 = -1;

    let mut first_segment_end: i16 = i16::MAX;
    let mut last_slash: i16 = -1;

    let mut i: i16 = i16::try_from(decoded_pathname.len()).expect("int cast") - 1;

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
            break 'brk &decoded_pathname
                [usize::try_from(period_i).expect("int cast")..usize::try_from(question_mark_i).expect("int cast")];
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

    let first_segment =
        &decoded_pathname[1..(usize::try_from(first_segment_end).expect("int cast")).min(decoded_pathname.len())];
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
        unsafe { core::mem::transmute::<&[u8], &'static [u8]>(s) }
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
                &decoded_pathname[usize::try_from(question_mark_i).expect("int cast")..decoded_pathname.len()]
            } else {
                b""
            }),
            needs_redirect,
        }
    })
}

// ported from: src/http_types/URLPath.zig
