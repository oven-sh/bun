//! The bodies of node_path.bind.ts.

use crate::generated_bindgen::node_path::ParsedPath;
use crate::jsc::bindgen::{self, JsHeap, JsLatin1, JsLocal, JsScope};
use crate::jsc::rare_data::PathBuf as RarePathBuf;
use crate::jsc::{JSString, SysErrorJsc as _};
use crate::node::validators::{validate_object, validate_string};
use bun_collections::smallvec::SmallVec;
use bun_core::Utf8Bytes;
use bun_node_path::{
    CHAR_BACKWARD_SLASH, CHAR_FORWARD_SLASH, PathParsed, RelativePosixLatin1,
    basename_posix_latin1, basename_posix_t, basename_windows_t,
    basename_without_suffix_posix_latin1, dirname_posix_latin1, dirname_posix_t, dirname_windows_t,
    extname_posix_latin1, extname_posix_t, extname_windows_t, format_t, is_absolute_posix_t,
    is_absolute_windows_t, is_resolved_posix, is_tidy_posix, join_buf_len, join_posix_t,
    join_windows_t, normalize_buf_len, normalize_posix_latin1, normalize_posix_t,
    normalize_windows_t, parse_posix_latin1, parse_posix_t, parse_windows_t, path_size,
    relative_buf_len, relative_posix_latin1, relative_posix_t, relative_windows_t,
    resolve_absolute_posix_latin1, resolve_buf_len, resolve_posix_t, resolve_windows_t,
    to_namespaced_path_buf_len, to_namespaced_path_windows_t,
};
use bun_paths::MAX_PATH_BYTES;

type Text<'a> = JsLocal<'a, JSString>;
type TextResult<'a> = bindgen::Result<'a, Text<'a>>;

/// Path scratch carved from the per-VM [`RarePathBuf`], which is allocated once.
enum PathScratch<'a> {
    Pooled(&'a mut [u8]),
    Spill(Box<[u8]>),
}

impl PathScratch<'_> {
    const POOL_MAX: usize = 32 * MAX_PATH_BYTES;

    #[inline]
    fn new(heap: &JsHeap<'_>, len: usize) -> Self {
        if len > Self::POOL_MAX {
            return Self::Spill(vec![0; len].into_boxed_slice());
        }
        // SAFETY: the global object is only asked for its VM.
        let pool: &mut RarePathBuf = &mut unsafe { heap.global() }
            .bun_vm()
            .as_mut()
            .rare_data()
            .path_buf;
        Self::Pooled(&mut pool.get(len)[..len])
    }

    #[inline]
    fn slice(&mut self) -> &mut [u8] {
        match self {
            Self::Pooled(slice) => slice,
            Self::Spill(slab) => slab,
        }
    }
}

/// `answer`, which was computed from the Latin-1 characters of operands alone.
#[inline]
fn latin1_answer<'a>(heap: &JsHeap<'a>, answer: &[u8]) -> Option<Text<'a>> {
    (answer.len() <= JSString::MAX_LENGTH).then(|| heap.create_latin1_string(answer))
}

/// With `FLAT_ONLY`, `None` for all but an 8-bit string that is no rope, and nothing is called.
#[inline(always)]
fn latin1_of<'a, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    text: Text<'a>,
) -> bindgen::Result<'a, Option<JsLatin1<'a>>> {
    if FLAT_ONLY {
        Ok(text.flat_latin1())
    } else {
        text.resolved_latin1(heap)
    }
}

/// `$name` answers `$of_latin1` of the operands' Latin-1 characters, or `$of_utf8` where that is `None`.
macro_rules! by_form_of_operands {
    ($name:ident, $of_other:ident, $of_latin1:ident, $of_utf8:ident, <$($generic:ident: $bound:path),*> ($($operand:ident: $type:ty),*) -> $result:ty) => {
        #[inline(always)]
        fn $name<'a, const WINDOWS: bool $(, $generic: $bound)*>(heap: &JsHeap<'a>, $($operand: $type),*) -> bindgen::Result<'a, $result> {
            match $of_latin1::<WINDOWS, true>(heap, $($operand),*) {
                Ok(Some(answer)) => Ok(answer.into_answer()),
                _ => $of_other::<WINDOWS $(, $generic)*>(heap, $($operand),*),
            }
        }

        #[inline(never)]
        fn $of_other<'a, const WINDOWS: bool $(, $generic: $bound)*>(heap: &JsHeap<'a>, $($operand: $type),*) -> bindgen::Result<'a, $result> {
            match $of_latin1::<WINDOWS, false>(heap, $($operand),*)? {
                Some(answer) => Ok(answer.into_answer()),
                None => $of_utf8::<WINDOWS $(, $generic)*>(heap, $($operand),*),
            }
        }
    };
}

/// What `resolve` and `relative` answer: on Windows also an error, which is not thrown.
trait Resolved<'a>: Sized {
    fn from_text(text: Text<'a>) -> Self;
    fn from_error(heap: &JsHeap<'a>, error: bun_sys::Error) -> Self;
}
impl<'a> Resolved<'a> for JsLocal<'a> {
    #[inline(always)]
    fn from_text(text: Text<'a>) -> Self {
        text.as_value()
    }
    #[cold]
    fn from_error(heap: &JsHeap<'a>, error: bun_sys::Error) -> Self {
        // SAFETY: making the error runs no JavaScript.
        JsLocal::new(heap, error.to_js(unsafe { heap.global() }))
    }
}
impl<'a> Resolved<'a> for Text<'a> {
    #[inline(always)]
    fn from_text(text: Text<'a>) -> Self {
        text
    }
    fn from_error(_: &JsHeap<'a>, _: bun_sys::Error) -> Self {
        unreachable!("the working directory of path.posix is the one that Bun keeps")
    }
}

trait IntoAnswer<T> {
    fn into_answer(self) -> T;
}
impl<'a, R: Resolved<'a>> IntoAnswer<R> for Text<'a> {
    #[inline(always)]
    fn into_answer(self) -> R {
        R::from_text(self)
    }
}
impl<'a> IntoAnswer<ParsedPath<'a>> for ParsedPath<'a> {
    #[inline(always)]
    fn into_answer(self) -> Self {
        self
    }
}

// ───────────────────────────── parts of one path ─────────────────────────────

/// The characters `range` of `text`. SAFETY: `range` is what a function of `bun_node_path` answered for `text.characters()`.
#[inline(always)]
unsafe fn part<'a>(
    heap: &JsHeap<'a>,
    text: &JsLatin1<'a>,
    range: core::ops::Range<usize>,
) -> Text<'a> {
    // SAFETY: forwarded.
    unsafe { text.substring_unchecked(heap, range.start, range.end) }
}

#[inline(always)]
fn basename_t<'p, const WINDOWS: bool>(path: &'p [u8], suffix: Option<&[u8]>) -> &'p [u8] {
    if WINDOWS {
        basename_windows_t(path, suffix)
    } else {
        basename_posix_t(path, suffix)
    }
}

#[inline(always)]
fn basename_of_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
    suffix: Option<Text<'a>>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    let Some(suffix) = suffix else {
        return Ok(Some(if WINDOWS {
            text.part(heap, basename_windows_t(text.characters(), None))
        } else {
            // SAFETY: the range is of these characters.
            unsafe { part(heap, &text, basename_posix_latin1(text.characters())) }
        }));
    };
    // A suffix whose UTF-8 is longer than that of the path is not looked for. Of an ASCII suffix that is its length.
    let Some(suffix) =
        latin1_of::<FLAT_ONLY>(heap, suffix)?.filter(|suffix| suffix.characters().is_ascii())
    else {
        return Ok(None);
    };
    let (characters, suffix) = (text.characters(), suffix.characters());
    if WINDOWS {
        return Ok(Some(
            text.part(heap, basename_windows_t(characters, Some(suffix))),
        ));
    }
    // SAFETY: the ranges are of these characters.
    Ok(Some(unsafe {
        part(
            heap,
            &text,
            if suffix.is_empty() || suffix.len() > characters.len() {
                basename_posix_latin1(characters)
            } else {
                basename_without_suffix_posix_latin1(characters, suffix)
            },
        )
    }))
}

#[cold]
#[inline(never)]
fn basename_of_utf8<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
    suffix: Option<Text<'a>>,
) -> TextResult<'a> {
    let path = path.view(heap)?;
    let suffix = match suffix {
        Some(suffix) => Some(suffix.view(heap)?),
        None => None,
    };
    let path_utf8 = path.to_utf8();
    let suffix_utf8 = suffix
        .as_ref()
        .filter(|suffix| !suffix.is_empty() && suffix.length() <= path.length())
        .map(|suffix| suffix.to_utf8());
    let suffix_utf8 = suffix_utf8.as_ref().map(Utf8Bytes::slice);
    heap.create_utf8_string(basename_t::<WINDOWS>(path_utf8.slice(), suffix_utf8))
}
by_form_of_operands!(basename, basename_of_other, basename_of_latin1, basename_of_utf8, <>(path: Text<'a>, suffix: Option<Text<'a>>) -> Text<'a>);

#[inline(always)]
fn dirname_of_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    if WINDOWS {
        return Ok(Some(text.part(heap, dirname_windows_t(text.characters()))));
    }
    Ok(Some(match dirname_posix_latin1(text.characters()) {
        // SAFETY: the range is of these characters.
        Ok(end) => unsafe { part(heap, &text, 0..end) },
        Err(literal) => heap.create_latin1_string(literal),
    }))
}

#[cold]
#[inline(never)]
fn dirname_of_utf8<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let path = path.view(heap)?;
    let utf8 = path.to_utf8();
    heap.create_utf8_string(if WINDOWS {
        dirname_windows_t(utf8.slice())
    } else {
        dirname_posix_t(utf8.slice())
    })
}
by_form_of_operands!(dirname, dirname_of_other, dirname_of_latin1, dirname_of_utf8, <>(path: Text<'a>) -> Text<'a>);

#[inline(always)]
fn extname_of_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    Ok(Some(if WINDOWS {
        text.part(heap, extname_windows_t(text.characters()))
    } else {
        // SAFETY: the range is of these characters.
        unsafe { part(heap, &text, extname_posix_latin1(text.characters())) }
    }))
}

#[cold]
#[inline(never)]
fn extname_of_utf8<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let path = path.view(heap)?;
    let utf8 = path.to_utf8();
    heap.create_utf8_string(if WINDOWS {
        extname_windows_t(utf8.slice())
    } else {
        extname_posix_t(utf8.slice())
    })
}
by_form_of_operands!(extname, extname_of_other, extname_of_latin1, extname_of_utf8, <>(path: Text<'a>) -> Text<'a>);

#[inline(always)]
fn is_absolute<const WINDOWS: bool>(path: Text<'_>) -> bool {
    let Some(text) = path.flat_latin1() else {
        return is_absolute_by_first_characters::<WINDOWS>(path);
    };
    if WINDOWS {
        is_absolute_windows_t(text.characters())
    } else {
        is_absolute_posix_t(text.characters())
    }
}

#[cold]
#[inline(never)]
fn is_absolute_by_first_characters<const WINDOWS: bool>(path: Text<'_>) -> bool {
    let mut first = [0u16; 3];
    let count = path.first_characters(&mut first);
    if WINDOWS {
        is_absolute_windows_t(&first[..count])
    } else {
        is_absolute_posix_t(&first[..count])
    }
}

#[inline(always)]
fn parse_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<ParsedPath<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    if !WINDOWS {
        let parsed = parse_posix_latin1(text.characters());
        // SAFETY: the ranges are of these characters.
        return Ok(Some(unsafe {
            if parsed.ext.is_empty() {
                let [root, dir, base, ext] = text
                    .substrings_unchecked(heap, [parsed.root, parsed.dir, parsed.base, parsed.ext]);
                ParsedPath {
                    root,
                    dir,
                    base,
                    ext,
                    name: base,
                }
            } else {
                let [root, dir, base, ext, name] = text.substrings_unchecked(
                    heap,
                    [
                        parsed.root,
                        parsed.dir,
                        parsed.base,
                        parsed.ext,
                        parsed.name,
                    ],
                );
                ParsedPath {
                    root,
                    dir,
                    base,
                    ext,
                    name,
                }
            }
        }));
    }
    let parsed = parse_windows_t(text.characters());
    let base = text.part(heap, parsed.base);
    Ok(Some(ParsedPath {
        root: text.part(heap, parsed.root),
        dir: text.part(heap, parsed.dir),
        base,
        ext: text.part(heap, parsed.ext),
        name: if parsed.ext.is_empty() {
            base
        } else {
            text.part(heap, parsed.name)
        },
    }))
}

#[cold]
#[inline(never)]
fn parse_utf8<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, ParsedPath<'a>> {
    let path = path.view(heap)?;
    let utf8 = path.to_utf8();
    let parsed = if WINDOWS {
        parse_windows_t(utf8.slice())
    } else {
        parse_posix_t(utf8.slice())
    };
    Ok(ParsedPath {
        root: heap.create_utf8_string(parsed.root)?,
        dir: heap.create_utf8_string(parsed.dir)?,
        base: heap.create_utf8_string(parsed.base)?,
        ext: heap.create_utf8_string(parsed.ext)?,
        name: heap.create_utf8_string(parsed.name)?,
    })
}
by_form_of_operands!(parse, parse_other, parse_latin1, parse_utf8, <>(path: Text<'a>) -> ParsedPath<'a>);

// ───────────────────────────── paths that are made ─────────────────────────────

/// As long a path as is put together on the stack.
const SHORT: usize = 512;

type JoinedBuffer = core::mem::MaybeUninit<[u8; SHORT]>;

/// Room for what a path that is [`SHORT`] is normalized to.
type NormalizedBuffer = [core::mem::MaybeUninit<u8>; SHORT + 2];

#[inline(always)]
fn normalized_buffer() -> NormalizedBuffer {
    [const { core::mem::MaybeUninit::uninit() }; SHORT + 2]
}

/// Paths with a '/' between them, put together from the last to the first.
struct Joined<'b> {
    /// Not in here, so that `start` stays in a register while the buffer is passed to `memcpy`.
    buffer: &'b mut JoinedBuffer,
    /// From here on the buffer is written.
    start: usize,
}

impl<'b> Joined<'b> {
    #[inline(always)]
    fn new(buffer: &'b mut JoinedBuffer) -> Self {
        Self {
            buffer,
            start: SHORT,
        }
    }

    /// Whether there was room for it.
    #[inline(always)]
    fn prepend(&mut self, part: &[u8]) -> bool {
        let is_first = self.start == SHORT;
        if part.len() + usize::from(!is_first) > self.start {
            return false;
        }
        let buffer = self.buffer.as_mut_ptr().cast::<u8>();
        // SAFETY: there is room in front of `start`.
        unsafe {
            if !is_first {
                self.start -= 1;
                buffer.add(self.start).write(CHAR_FORWARD_SLASH);
            }
            self.start -= part.len();
            buffer
                .add(self.start)
                .copy_from_nonoverlapping(part.as_ptr(), part.len());
        }
        true
    }

    #[inline(always)]
    fn characters(&self) -> &[u8] {
        // SAFETY: written from `start` on.
        unsafe {
            core::slice::from_raw_parts(
                self.buffer.as_ptr().cast::<u8>().add(self.start),
                SHORT - self.start,
            )
        }
    }
}

/// As many operands as are looked at without a list on the heap.
const FEW: usize = 8;

type Parts<'p> = [core::mem::MaybeUninit<&'p [u8]>; FEW];

/// SAFETY: All of `parts` are written.
#[inline(always)]
unsafe fn written<'s, 'p>(parts: &'s [core::mem::MaybeUninit<&'p [u8]>]) -> &'s [&'p [u8]] {
    // SAFETY: forwarded.
    unsafe { &*(core::ptr::from_ref(parts) as *const [&'p [u8]]) }
}

#[inline(always)]
fn normalize_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    if !WINDOWS {
        if is_tidy_posix(text.characters()) {
            return Ok(Some(path));
        }
        if text.characters().len() <= SHORT {
            return Ok(Some(normalize_short_posix(heap, text.characters())));
        }
    }
    Ok(normalize_untidy::<WINDOWS>(heap, text))
}

/// `path` is [`SHORT`].
#[inline(never)]
fn normalize_short_posix<'a>(heap: &JsHeap<'a>, path: &[u8]) -> Text<'a> {
    heap.create_latin1_string(normalize_posix_latin1(path, &mut normalized_buffer()))
}

#[inline(never)]
fn normalize_untidy<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    text: JsLatin1<'a>,
) -> Option<Text<'a>> {
    let characters = text.characters();
    let mut scratch = PathScratch::new(heap, normalize_buf_len(characters));
    let answer = if WINDOWS {
        normalize_windows_t(characters, scratch.slice())
    } else {
        normalize_posix_t(characters, scratch.slice())
    };
    if answer == characters {
        return Some(text.string());
    }
    latin1_answer(heap, answer)
}

#[cold]
#[inline(never)]
fn normalize_utf8<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a> {
    let path = path.view(heap)?;
    let utf8 = path.to_utf8();
    let mut scratch = PathScratch::new(heap, normalize_buf_len(utf8.slice()));
    heap.create_utf8_string(if WINDOWS {
        normalize_windows_t(utf8.slice(), scratch.slice())
    } else {
        normalize_posix_t(utf8.slice(), scratch.slice())
    })
}
by_form_of_operands!(normalize, normalize_other, normalize_latin1, normalize_utf8, <>(path: Text<'a>) -> Text<'a>);

#[inline(always)]
fn join_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    paths: &'a [Text<'a>],
) -> bindgen::Result<'a, Option<Text<'a>>> {
    if WINDOWS {
        return join_windows_latin1::<FLAT_ONLY>(heap, paths);
    }
    let mut buffer = JoinedBuffer::uninit();
    let mut joined = Joined::new(&mut buffer);
    let mut only = None;
    for &path in paths.iter().rev() {
        let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
            return Ok(None);
        };
        if text.characters().is_empty() {
            continue;
        }
        only = if joined.start == SHORT {
            Some(path)
        } else {
            None
        };
        if !joined.prepend(text.characters()) {
            return Ok(None);
        }
    }
    let joined = joined.characters();
    if !is_tidy_posix(joined) {
        return Ok(Some(normalize_short_posix(heap, joined)));
    }
    Ok(Some(match only {
        Some(only) => only,
        None => heap.create_latin1_string(joined),
    }))
}

#[inline(always)]
fn join_windows_latin1<'a, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    paths: &'a [Text<'a>],
) -> bindgen::Result<'a, Option<Text<'a>>> {
    if paths.len() > FEW {
        return Ok(None);
    }
    let mut parts: Parts<'_> = [const { core::mem::MaybeUninit::uninit() }; FEW];
    let mut count = 0;
    for &path in paths {
        let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
            return Ok(None);
        };
        if !text.characters().is_empty() {
            parts[count].write(text.characters());
            count += 1;
        }
    }
    // SAFETY: the first `count` are written.
    Ok(join_windows_parts(heap, unsafe {
        written(&parts[..count])
    }))
}

#[inline(never)]
fn join_windows_parts<'a>(heap: &JsHeap<'a>, parts: &[&[u8]]) -> Option<Text<'a>> {
    let buf_len = join_buf_len(true, parts);
    let mut scratch = PathScratch::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    latin1_answer(heap, join_windows_t(parts, buf, buf2))
}

#[cold]
#[inline(never)]
fn join_utf8<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, paths: &'a [Text<'a>]) -> TextResult<'a> {
    let mut views: SmallVec<[crate::jsc::JSStringView<'a>; FEW]> =
        SmallVec::with_capacity(paths.len());
    for path in paths {
        let view = path.view(heap)?;
        if !view.is_empty() {
            views.push(view);
        }
    }
    let owned: SmallVec<[Utf8Bytes<'_>; FEW]> = views.iter().map(|view| view.to_utf8()).collect();
    let parts: SmallVec<[&[u8]; FEW]> = owned.iter().map(Utf8Bytes::slice).collect();
    let buf_len = join_buf_len(WINDOWS, &parts);
    let mut scratch = PathScratch::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    heap.create_utf8_string(if WINDOWS {
        join_windows_t(&parts, buf, buf2)
    } else {
        join_posix_t(&parts, buf, buf2)
    })
}
by_form_of_operands!(join, join_other, join_latin1, join_utf8, <>(paths: &'a [Text<'a>]) -> Text<'a>);

/// # Safety
/// `rhs_ptr[..rhs_len]` must be a valid readable slice. Called only from C++.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Node__Path_joinWTF(
    lhs: &bun_core::String,
    rhs_ptr: *const u8,
    rhs_len: usize,
) -> bun_core::String {
    // SAFETY: caller passes a valid slice from C++.
    let rhs = unsafe { bun_core::ffi::slice(rhs_ptr, rhs_len) };
    let lhs = lhs.to_utf8();
    let paths: [&[u8]; 2] = [lhs.slice(), rhs];
    let buf_len = join_buf_len::<u8>(cfg!(windows), &paths);
    let mut fixed = [0u8; path_size::<u8>() * 2];
    let mut spill = Vec::new();
    // Fall back to the heap when the joined path is too long for the stack buffer.
    let scratch: &mut [u8] = if buf_len * 2 <= fixed.len() {
        &mut fixed
    } else {
        spill.resize(buf_len * 2, 0);
        &mut spill
    };
    let (buf, buf2) = scratch.split_at_mut(buf_len);
    #[cfg(windows)]
    let joined = join_windows_t::<u8>(&paths, buf, buf2);
    #[cfg(not(windows))]
    let joined = join_posix_t::<u8>(&paths, buf, buf2);
    bun_core::String::clone_utf8(joined)
}

#[inline(always)]
fn relative_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    if WINDOWS {
        return Ok(None);
    }
    let (Some(from), Some(to)) = (
        latin1_of::<FLAT_ONLY>(heap, from)?,
        latin1_of::<FLAT_ONLY>(heap, to)?,
    ) else {
        return Ok(None);
    };
    if !is_resolved_posix(from.characters()) || !is_resolved_posix(to.characters()) {
        return Ok(relative_of_untidy_posix(heap, from, to));
    }
    let target = to.characters();
    let answer = relative_posix_latin1(from.characters(), target);
    if answer.ups == 0 {
        // SAFETY: the range is of these characters.
        return Ok(Some(unsafe { part(heap, &to, answer.rest..target.len()) }));
    }
    Ok(relative_upwards(heap, answer.ups, &target[answer.rest..]))
}

/// ".." `ups` times, at least once, with slashes between them, and then `rest`.
#[inline(always)]
fn relative_upwards<'a>(heap: &JsHeap<'a>, ups: usize, rest: &[u8]) -> Option<Text<'a>> {
    let length = ups * 3 - 1 + rest.len();
    if length > JSString::MAX_LENGTH {
        return None;
    }
    // SAFETY: two characters, three for each further "..", and the rest.
    Some(unsafe {
        heap.create_latin1_string_with(length, |mut at| {
            at.copy_from_nonoverlapping(b"..".as_ptr(), 2);
            at = at.add(2);
            for _ in 1..ups {
                at.copy_from_nonoverlapping(b"/..".as_ptr(), 3);
                at = at.add(3);
            }
            at.copy_from_nonoverlapping(rest.as_ptr(), rest.len());
        })
    })
}

#[inline(never)]
fn relative_of_untidy_posix<'a>(
    heap: &JsHeap<'a>,
    from: JsLatin1<'a>,
    to: JsLatin1<'a>,
) -> Option<Text<'a>> {
    let (from_characters, to_characters) = (from.characters(), to.characters());
    if !is_absolute_posix_t(from_characters)
        || !is_absolute_posix_t(to_characters)
        || from_characters.len() > SHORT
        || to_characters.len() > SHORT
    {
        return relative_of_absolute_posix(heap, from, to);
    }
    let (mut from_buffer, mut to_buffer) = (normalized_buffer(), normalized_buffer());
    let from = resolve_absolute_posix_latin1(from_characters, &mut from_buffer);
    let to = resolve_absolute_posix_latin1(to_characters, &mut to_buffer);
    let RelativePosixLatin1 { ups, rest } = relative_posix_latin1(from, to);
    if ups == 0 {
        return Some(heap.create_latin1_string(&to[rest..]));
    }
    relative_upwards(heap, ups, &to[rest..])
}

/// `None` where the working directory, whose characters are UTF-8, completes one of the paths.
#[inline(never)]
fn relative_of_absolute_posix<'a>(
    heap: &JsHeap<'a>,
    from: JsLatin1<'a>,
    to: JsLatin1<'a>,
) -> Option<Text<'a>> {
    let (from, to) = (from.characters(), to.characters());
    if !is_absolute_posix_t(from) || !is_absolute_posix_t(to) {
        return None;
    }
    let buf_len = relative_buf_len(from, to);
    let mut scratch = PathScratch::new(heap, buf_len * 3);
    let (buf, rest) = scratch.slice().split_at_mut(buf_len);
    let (from_buf, tmp_buf) = rest.split_at_mut(buf_len);
    latin1_answer(
        heap,
        relative_posix_t(from, to, buf, from_buf, tmp_buf).ok()?,
    )
}

#[inline(never)]
fn relative_utf8<'a, const WINDOWS: bool, R: Resolved<'a>>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> bindgen::Result<'a, R> {
    let from_view = from.view(heap)?;
    let to_view = to.view(heap)?;
    if from_view.is_empty() && to_view.is_empty() {
        return Ok(R::from_text(from));
    }
    let (from, to) = (from_view.to_utf8(), to_view.to_utf8());
    let (from, to) = (from.slice(), to.slice());
    let buf_len = relative_buf_len(from, to);
    let mut scratch = PathScratch::new(heap, buf_len * 3);
    let (buf, rest) = scratch.slice().split_at_mut(buf_len);
    let (from_buf, tmp_buf) = rest.split_at_mut(buf_len);
    match if WINDOWS {
        relative_windows_t(from, to, buf, from_buf, tmp_buf)
    } else {
        relative_posix_t(from, to, buf, from_buf, tmp_buf)
    } {
        Ok(answer) => heap.create_utf8_string(answer).map(R::from_text),
        Err(error) => Ok(R::from_error(heap, error)),
    }
}
by_form_of_operands!(relative, relative_other, relative_latin1, relative_utf8, <R: Resolved<'a>>(from: Text<'a>, to: Text<'a>) -> R);

#[cfg(unix)]
unsafe extern "C" {
    safe fn Process__getCachedCwd(global: &crate::jsc::JSGlobalObject) -> crate::jsc::JSValue;
}

/// `None` unless the paths that count are 8-bit strings and [`SHORT`] together.
#[inline(always)]
fn resolve_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    paths: &'a [JsLocal<'a>],
) -> bindgen::Result<'a, Option<Text<'a>>> {
    if WINDOWS {
        return Ok(None);
    }
    let mut buffer = JoinedBuffer::uninit();
    let mut joined = Joined::new(&mut buffer);
    for path in paths.iter().rev() {
        let Some(path) = path.as_string() else {
            return Ok(None);
        };
        let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
            return Ok(None);
        };
        let part = text.characters();
        if part.is_empty() {
            continue;
        }
        let is_absolute = part[0] == CHAR_FORWARD_SLASH;
        if is_absolute && joined.start == SHORT && is_resolved_posix(part) {
            return Ok(Some(path));
        }
        if !joined.prepend(part) {
            return Ok(None);
        }
        if is_absolute {
            return Ok(Some(resolve_joined_posix(heap, joined.characters())));
        }
    }
    // `process.cwd()` itself is kept as a string.
    if matches!(joined.characters(), b"" | b"." | b"./") {
        return Ok(None);
    }
    #[cfg(not(windows))]
    {
        let working_directory = bun_node_path::posix_working_directory();
        if working_directory.is_ascii()
            && is_absolute_posix_t(working_directory)
            && joined.prepend(working_directory)
        {
            return Ok(Some(resolve_joined_posix(heap, joined.characters())));
        }
    }
    Ok(None)
}

/// `joined` is absolute and [`SHORT`].
#[inline(always)]
fn resolve_joined_posix<'a>(heap: &JsHeap<'a>, joined: &[u8]) -> Text<'a> {
    if is_resolved_posix(joined) {
        return heap.create_latin1_string(joined);
    }
    resolve_untidy_posix(heap, joined)
}

#[inline(never)]
fn resolve_untidy_posix<'a>(heap: &JsHeap<'a>, joined: &[u8]) -> Text<'a> {
    heap.create_latin1_string(resolve_absolute_posix_latin1(
        joined,
        &mut normalized_buffer(),
    ))
}

#[inline(never)]
fn resolve_utf8<'a, const WINDOWS: bool, R: Resolved<'a>>(
    heap: &JsHeap<'a>,
    paths: &'a [JsLocal<'a>],
) -> bindgen::Result<'a, R> {
    // SAFETY: it is passed to what throws, after which this returns, and to what reads the cached working directory.
    let global = unsafe { heap.global() };
    // From the last to the first that is absolute.
    let mut views: SmallVec<[crate::jsc::JSStringView<'a>; FEW]> = SmallVec::new();
    for (index, path) in paths.iter().enumerate().rev() {
        validate_string(global, path.to_js(), format_args!("paths[{}]", index))?;
        let Some(path) = path.as_string() else {
            unreachable!("a String object arrives as a string");
        };
        let view = path.view(heap)?;
        if view.is_empty() {
            continue;
        }
        let is_absolute = !WINDOWS && view.char_at(0) == u16::from(CHAR_FORWARD_SLASH);
        views.push(view);
        if is_absolute {
            break;
        }
    }
    let owned: SmallVec<[Utf8Bytes<'_>; FEW]> = views.iter().map(|view| view.to_utf8()).collect();
    let parts: SmallVec<[&[u8]; FEW]> = owned.iter().rev().map(Utf8Bytes::slice).collect();

    #[cfg(unix)]
    if !WINDOWS
        && (parts.is_empty() || (parts.len() == 1 && (parts[0] == b"." || parts[0] == b"./")))
    {
        // `process.cwd()`, which throws when `getcwd` fails (for example, a deleted working directory).
        let cwd = crate::jsc::call_zero_is_throw(global, || Process__getCachedCwd(global))?;
        let Some(cwd) = JsLocal::new(heap, cwd).as_string() else {
            unreachable!("process.cwd() is a string");
        };
        return Ok(R::from_text(cwd));
    }

    let buf_len = resolve_buf_len(WINDOWS, &parts);
    let mut scratch = PathScratch::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    match if WINDOWS {
        resolve_windows_t(&parts, buf, buf2)
    } else {
        resolve_posix_t(&parts, buf, buf2)
    } {
        Ok(answer) => heap.create_utf8_string(answer).map(R::from_text),
        Err(error) => Ok(R::from_error(heap, error)),
    }
}
by_form_of_operands!(resolve, resolve_other, resolve_latin1, resolve_utf8, <R: Resolved<'a>>(paths: &'a [JsLocal<'a>]) -> R);

fn format<'a, const WINDOWS: bool>(
    cx: &mut JsScope<'a>,
    path_object: JsLocal<'a>,
) -> TextResult<'a> {
    let path_object = path_object.to_js();
    let members = {
        let global = cx.global();
        validate_object(
            global,
            path_object,
            format_args!("pathObject"),
            Default::default(),
        )?;
        let mut members: [Option<Utf8Bytes<'static>>; 5] = Default::default();
        for (member, name) in members
            .iter_mut()
            .zip(["root", "dir", "base", "name", "ext"])
        {
            if let Some(value) = path_object.get_truthy(global, name)? {
                *member = Some(value.to_utf8(global)?);
            }
        }
        members
    };
    let [root, dir, base, name, ext] = members.each_ref().map(|member| match member {
        Some(utf8) => utf8.slice(),
        None => &[],
    });
    // One more for the separator.
    let buf_len =
        (1 + (if dir.is_empty() {
            root.len()
        } else {
            dir.len()
        }) + (if base.is_empty() {
            name.len() + ext.len() + 1
        } else {
            base.len()
        }))
        .max(path_size::<u8>());
    let heap = &cx.heap;
    let mut scratch = PathScratch::new(heap, buf_len);
    heap.create_utf8_string(format_t(
        &PathParsed {
            root,
            dir,
            base,
            ext,
            name,
        },
        if WINDOWS {
            CHAR_BACKWARD_SLASH
        } else {
            CHAR_FORWARD_SLASH
        },
        scratch.slice(),
    ))
}

// ───────────────────────────── what node_path.bind.ts names ─────────────────────────────

macro_rules! on_both_platforms {
    ($( $posix:ident, $win32:ident = $body:ident($($parameter:ident: $type:ty),*) -> $result:ty; )*) => {$(
        #[inline(always)]
        pub(crate) fn $posix<'a>($($parameter: $type),*) -> $result {
            $body::<false>($($parameter),*)
        }
        #[inline(always)]
        pub(crate) fn $win32<'a>($($parameter: $type),*) -> $result {
            $body::<true>($($parameter),*)
        }
    )*};
}
on_both_platforms! {
    basename_posix, basename_win32 = basename(heap: &JsHeap<'a>, path: Text<'a>, ext: Option<Text<'a>>) -> TextResult<'a>;
    dirname_posix, dirname_win32 = dirname(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    extname_posix, extname_win32 = extname(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    format_posix, format_win32 = format(cx: &mut JsScope<'a>, path_object: JsLocal<'a>) -> TextResult<'a>;
    is_absolute_posix, is_absolute_win32 = is_absolute(path: Text<'a>) -> bool;
    join_posix, join_win32 = join(heap: &JsHeap<'a>, paths: &'a [Text<'a>]) -> TextResult<'a>;
    normalize_posix, normalize_win32 = normalize(heap: &JsHeap<'a>, path: Text<'a>) -> TextResult<'a>;
    parse_posix, parse_win32 = parse(heap: &JsHeap<'a>, path: Text<'a>) -> bindgen::Result<'a, ParsedPath<'a>>;
}

#[inline(always)]
pub(crate) fn relative_posix<'a>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> TextResult<'a> {
    relative::<false, _>(heap, from, to)
}

#[inline(always)]
pub(crate) fn relative_win32<'a>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    relative::<true, _>(heap, from, to)
}

#[inline(always)]
pub(crate) fn resolve_posix<'a>(heap: &JsHeap<'a>, paths: &'a [JsLocal<'a>]) -> TextResult<'a> {
    resolve::<false, _>(heap, paths)
}

#[inline(always)]
pub(crate) fn resolve_win32<'a>(
    heap: &JsHeap<'a>,
    paths: &'a [JsLocal<'a>],
) -> bindgen::Result<'a, JsLocal<'a>> {
    resolve::<true, _>(heap, paths)
}

#[inline(always)]
pub(crate) fn to_namespaced_path_posix<'a>(_: &JsHeap<'a>, path: JsLocal<'a>) -> JsLocal<'a> {
    path
}

/// Based on Node v21.6.1 path.win32.toNamespacedPath: https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L624
pub(crate) fn to_namespaced_path_win32<'a>(
    cx: &mut JsScope<'a>,
    path: JsLocal<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    if !path.to_js().is_string() {
        return Ok(path);
    }
    let text = path.to_js().to_js_string(cx.global())?.to_js();
    let heap = &cx.heap;
    let Some(text) = JsLocal::new(heap, text).as_string() else {
        unreachable!("ToString gives a string");
    };
    let view = text.view(heap)?;
    if view.is_empty() {
        return Ok(path);
    }
    let utf8 = view.to_utf8();
    let buf_len = to_namespaced_path_buf_len(utf8.slice());
    let mut scratch = PathScratch::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    match to_namespaced_path_windows_t(utf8.slice(), buf, buf2) {
        Ok(answer) => heap.create_utf8_string(answer).map(JsLocal::as_value),
        Err(error) => Ok(<JsLocal<'a> as Resolved<'a>>::from_error(heap, error)),
    }
}
