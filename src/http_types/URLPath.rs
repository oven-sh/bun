use bun_core::strings;
use bun_url::PercentEncoding;

// TODO(port): lifetime — every `&'static [u8]` field below actually borrows from
// either the `parse()` input slice or, when the input was percent-encoded, from
// `_decoded_storage`. Zig has no lifetimes so this is implicit there. Phase B
// should add a lifetime param to `URLPath` so the input-borrow case is checked.
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
    /// Owned backing storage for the slice fields when `parse()` had to
    /// percent-decode. Heap-stable: the slice fields above point into this
    /// allocation, which is never resized and lives exactly as long as `self`.
    /// Replaces the Zig threadlocal scratch buffers — owning the decode buffer
    /// per-URLPath removes the use-after-free that a shared growable buffer
    /// would introduce on the next `parse()` call.
    ///
    /// `URLPath` must not be `Clone`: copying the slice fields without this
    /// owner would re-introduce the dangling hazard.
    _decoded_storage: Option<Box<[u8]>>,
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

// PORT NOTE: Zig uses two threadlocal fixed `[1024]u8`/`[16384]u8` buffers and
// decodes in-place via `fixedBufferStream`, then returns slices into that
// threadlocal storage. A growable shared buffer cannot uphold that contract in
// Rust (the next `parse()` may reallocate it and dangle every prior URLPath),
// so instead each URLPath that needs decoding owns its decode buffer in
// `_decoded_storage`. This costs one small allocation only on the
// percent-encoded path, which is the rare case.
// PERF(port): was zero-alloc fixed buffers — profile in Phase B.

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
    // to `'static` to match the Phase-A field type; remove once URLPath gains a
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
