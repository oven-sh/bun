//! The bodies of node_path.bind.ts.

use crate::generated_bindgen::node_path::ParsedPath;
use crate::jsc::bindgen::{self, JsHeap, JsLatin1, JsLocal, JsScope};
use crate::jsc::rare_data::PathBuf as RarePathBuf;
use crate::jsc::{JSString, JSStringView};
use crate::node::validators::{validate_object, validate_string};
use bun_collections::smallvec::SmallVec;
use bun_core::strings::{self, CodeUnits};
use bun_node_path::{
    CHAR_BACKWARD_SLASH, CHAR_FORWARD_SLASH, PathCharCwd, PathParsed, RelativePosixLatin1,
    basename_posix_latin1, basename_posix_t, basename_windows_t,
    basename_without_suffix_posix_latin1, dirname_posix_latin1, dirname_posix_t, dirname_windows_t,
    extname_posix_latin1, extname_posix_t, extname_windows_t, format_t, is_absolute_posix_t,
    is_absolute_windows_t, is_ascii, is_resolved_ascii_posix, is_tidy_ascii_posix, join_buf_len,
    join_posix_t, join_windows_t, normalize_buf_len, normalize_posix_latin1, normalize_posix_t,
    normalize_windows_t, parse_posix_latin1, parse_posix_t, parse_windows_t, path_size,
    relative_buf_len, relative_posix_latin1, relative_posix_t, relative_windows_t,
    resolve_absolute_posix_latin1, resolve_buf_len, resolve_posix_t, resolve_windows_t,
    to_namespaced_path_buf_len, to_namespaced_path_windows_t,
};

type Text<'a> = JsLocal<'a, JSString>;
type TextResult<'a> = bindgen::Result<'a, Text<'a>>;

/// What a string holds its characters in: Latin-1 characters or UTF-16 code units. The functions of `bun_node_path` read
/// either, so an operand is read as it is held and an answer has the code units that Node's has. Nothing goes through
/// UTF-8, which has no unpaired surrogate and counts a length in bytes.
trait Unit: PathCharCwd {
    /// `len` of them from the scratch of the VM.
    fn scratch(pool: &mut RarePathBuf, len: usize) -> &mut [Self];

    /// The characters of each of `texts`. Among UTF-16 code units those of an 8-bit string are copied into `widened`.
    fn operands<'s, S>(texts: &'s [S], widened: &'s mut Widened) -> Operands<'s, Self>
    where
        S: core::ops::Deref<Target = bun_core::String>;

    /// A string of the answer of a function that puts the working directory in front of a path that is not absolute.
    /// At 8 bits the working directory is the bytes the system gave, and the operands are ASCII
    /// ([`reads_working_directory_as_bytes`]), so the answer is UTF-8. At 16 bits the bytes were decoded.
    fn answer_with_working_directory<'a>(heap: &JsHeap<'a>, answer: &[Self]) -> TextResult<'a>;
}

/// The 8-bit operands of a list that has a 16-bit one, as UTF-16 code units.
type Widened = SmallVec<[u16; SHORT]>;

type Operands<'s, T> = SmallVec<[&'s [T]; FEW]>;

impl Unit for u8 {
    #[inline]
    fn scratch(pool: &mut RarePathBuf, len: usize) -> &mut [u8] {
        &mut pool.bytes(len)[..len]
    }

    #[inline]
    fn operands<'s, S>(texts: &'s [S], _: &'s mut Widened) -> Operands<'s, u8>
    where
        S: core::ops::Deref<Target = bun_core::String>,
    {
        texts.iter().map(|text| text.latin1()).collect()
    }

    #[inline]
    fn answer_with_working_directory<'a>(heap: &JsHeap<'a>, answer: &[u8]) -> TextResult<'a> {
        heap.create_utf8_string(answer)
    }
}

impl Unit for u16 {
    #[inline]
    fn scratch(pool: &mut RarePathBuf, len: usize) -> &mut [u16] {
        &mut pool.utf16(len)[..len]
    }

    fn operands<'s, S>(texts: &'s [S], widened: &'s mut Widened) -> Operands<'s, u16>
    where
        S: core::ops::Deref<Target = bun_core::String>,
    {
        for text in texts.iter().filter(|text| !text.is_utf16()) {
            let start = widened.len();
            widened.resize(start + text.length(), 0);
            strings::copy_u8_into_u16(&mut widened[start..], text.latin1());
        }
        let mut widened: &'s [u16] = widened;
        texts
            .iter()
            .map(|text| {
                if text.is_utf16() {
                    return text.utf16();
                }
                let (operand, rest) = widened.split_at(text.length());
                widened = rest;
                operand
            })
            .collect()
    }

    #[inline]
    fn answer_with_working_directory<'a>(heap: &JsHeap<'a>, answer: &[u16]) -> TextResult<'a> {
        heap.create_string_of_units(answer)
    }
}

/// Whether the 8-bit functions answer as Node does where the working directory can be put in front of an operand. Its
/// bytes are UTF-8, so every operand has to be ASCII. `path.win32` also compares a length with that of a drive, and
/// looks for the separator behind one at its place. On Windows all of that is in front of the names of the working
/// directory. Elsewhere it can be in the middle of a character, so there the working directory has to be ASCII too.
#[inline]
fn reads_working_directory_as_bytes<const WINDOWS: bool, S>(texts: &[S]) -> bool
where
    S: core::ops::Deref<Target = bun_core::String>,
{
    texts
        .iter()
        .all(|text| !text.is_utf16() && is_ascii(text.latin1()))
        && (cfg!(windows) || !WINDOWS || bun_core::working_directory_is_ascii())
}

/// Path scratch carved from the per-VM [`RarePathBuf`], which is allocated once.
enum PathScratch<'a, T> {
    Pooled(&'a mut [T]),
    Spill(Box<[T]>),
}

impl<T: Unit> PathScratch<'_, T> {
    #[inline]
    fn new(heap: &JsHeap<'_>, len: usize) -> Self {
        if len > RarePathBuf::MAX_BYTES / size_of::<T>() {
            return Self::Spill(vec![T::default(); len].into_boxed_slice());
        }
        // SAFETY: the global object is only asked for its VM.
        let vm = unsafe { heap.global() }.bun_vm();
        // SAFETY: a path function makes one scratch and runs no script while it has it.
        let pool: &mut RarePathBuf = unsafe { vm.rare_data().path_buf.get_mut() };
        Self::Pooled(T::scratch(pool, len))
    }

    #[inline]
    fn slice(&mut self) -> &mut [T] {
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

/// `None` for all but an 8-bit string. With `FLAT_ONLY`, `None` for a rope too, and nothing is called.
/// An answer with a character outside ASCII is held in 16 bits, so only ASCII characters of these become an answer.
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

/// [`latin1_of`], and `None` unless every character is ASCII.
#[inline(always)]
fn ascii_of<'a, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    text: Text<'a>,
) -> bindgen::Result<'a, Option<JsLatin1<'a>>> {
    Ok(latin1_of::<FLAT_ONLY>(heap, text)?.filter(|text| is_ascii(text.characters())))
}

/// `$name` answers `$of_latin1` of the operands' Latin-1 characters where they are, or `$of_other` where that is `None`.
/// `$of_other` resolves a rope, and answers a 16-bit operand from its UTF-16 code units.
macro_rules! by_form_of_operands {
    ($name:ident, $of_other:ident, $of_latin1:ident, ($($operand:ident: $type:ty),*) -> $result:ty) => {
        #[inline(always)]
        fn $name<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, $($operand: $type),*) -> bindgen::Result<'a, $result> {
            match $of_latin1::<WINDOWS, true>(heap, $($operand),*) {
                Ok(Some(answer)) => Ok(answer),
                _ => $of_other::<WINDOWS>(heap, $($operand),*),
            }
        }
    };
}

/// `$of_other` of one path: `$of_units` of its UTF-16 code units. An 8-bit string is answered by `$of_latin1`, which
/// shares its characters with the answer, or by `$of_units` of its Latin-1 characters where that is `None`.
macro_rules! of_one_path {
    ($of_other:ident, $of_latin1:ident, $of_units:ident -> $result:ty) => {
        #[inline(never)]
        fn $of_other<'a, const WINDOWS: bool>(
            heap: &JsHeap<'a>,
            path: Text<'a>,
        ) -> bindgen::Result<'a, $result> {
            let view = path.view(heap)?;
            if view.is_utf16() {
                return $of_units::<WINDOWS, u16>(heap, view.utf16());
            }
            match $of_latin1::<WINDOWS, false>(heap, path)? {
                Some(answer) => Ok(answer),
                None => $of_units::<WINDOWS, u8>(heap, view.latin1()),
            }
        }
    };
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

/// [`part`], or `None` if one of the characters is outside ASCII. SAFETY: that of [`part`].
#[inline(always)]
unsafe fn ascii_part<'a>(
    heap: &JsHeap<'a>,
    text: &JsLatin1<'a>,
    range: core::ops::Range<usize>,
) -> Option<Text<'a>> {
    // SAFETY: forwarded.
    unsafe {
        is_ascii(text.characters().get_unchecked(range.clone())).then(|| part(heap, text, range))
    }
}

/// `slice`, which a function of `bun_node_path` answered for `text.characters()`, or `None` if one of the characters is outside ASCII.
#[inline(always)]
fn ascii_slice<'a>(heap: &JsHeap<'a>, text: &JsLatin1<'a>, slice: &[u8]) -> Option<Text<'a>> {
    is_ascii(slice).then(|| text.part(heap, slice))
}

#[inline(always)]
fn basename_t<'p, const WINDOWS: bool, T: Unit>(path: &'p [T], suffix: Option<&[T]>) -> &'p [T] {
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
        return Ok(if WINDOWS {
            ascii_slice(heap, &text, basename_windows_t(text.characters(), None))
        } else {
            // SAFETY: the range is of these characters.
            unsafe { ascii_part(heap, &text, basename_posix_latin1(text.characters())) }
        });
    };
    // A suffix with a character outside ASCII is looked for by `basename_of_units`.
    let Some(suffix) = ascii_of::<FLAT_ONLY>(heap, suffix)? else {
        return Ok(None);
    };
    let (characters, suffix) = (text.characters(), suffix.characters());
    if WINDOWS {
        return Ok(ascii_slice(
            heap,
            &text,
            basename_windows_t(characters, Some(suffix)),
        ));
    }
    // SAFETY: the ranges are of these characters.
    Ok(unsafe {
        ascii_part(
            heap,
            &text,
            if suffix.is_empty() || suffix.len() > characters.len() {
                basename_posix_latin1(characters)
            } else {
                basename_without_suffix_posix_latin1(characters, suffix)
            },
        )
    })
}

#[cold]
#[inline(never)]
fn basename_of_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    path: &[T],
    suffix: Option<&[T]>,
) -> TextResult<'a> {
    heap.create_string_of_units(basename_t::<WINDOWS, T>(path, suffix))
}

#[inline(never)]
fn basename_of_other<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
    suffix: Option<Text<'a>>,
) -> TextResult<'a> {
    let path_view = path.view(heap)?;
    let suffix_view = match suffix {
        Some(suffix) => Some(suffix.view(heap)?),
        None => None,
    };
    // Node looks for no suffix that is empty or longer than the path.
    let suffix_view = suffix_view
        .as_deref()
        .filter(|suffix| !suffix.is_empty() && suffix.length() <= path_view.length());
    let suffix_is_utf16 = suffix_view.is_some_and(bun_core::String::is_utf16);
    if !path_view.is_utf16() && !suffix_is_utf16 {
        return match basename_of_latin1::<WINDOWS, false>(heap, path, suffix)? {
            Some(answer) => Ok(answer),
            None => basename_of_units::<WINDOWS, u8>(
                heap,
                path_view.latin1(),
                suffix_view.map(bun_core::String::latin1),
            ),
        };
    }
    match suffix_view {
        None => basename_of_units::<WINDOWS, u16>(heap, path_view.utf16(), None),
        Some(suffix) if path_view.is_utf16() && suffix_is_utf16 => {
            basename_of_units::<WINDOWS, u16>(heap, path_view.utf16(), Some(suffix.utf16()))
        }
        // One of the two is an 8-bit string.
        Some(suffix) => {
            let texts: [&bun_core::String; 2] = [&path_view, suffix];
            let mut widened = Widened::new();
            let operands = u16::operands(&texts, &mut widened);
            basename_of_units::<WINDOWS, u16>(heap, operands[0], Some(operands[1]))
        }
    }
}
by_form_of_operands!(basename, basename_of_other, basename_of_latin1, (path: Text<'a>, suffix: Option<Text<'a>>) -> Text<'a>);

#[inline(always)]
fn dirname_of_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    if WINDOWS {
        return Ok(ascii_slice(
            heap,
            &text,
            dirname_windows_t(text.characters()),
        ));
    }
    Ok(match dirname_posix_latin1(text.characters()) {
        // SAFETY: the range is of these characters.
        Ok(end) => unsafe { ascii_part(heap, &text, 0..end) },
        Err(literal) => Some(heap.create_latin1_string(literal)),
    })
}

#[cold]
#[inline(never)]
fn dirname_of_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    path: &[T],
) -> TextResult<'a> {
    heap.create_string_of_units(if WINDOWS {
        dirname_windows_t(path)
    } else {
        dirname_posix_t(path)
    })
}
of_one_path!(dirname_of_other, dirname_of_latin1, dirname_of_units -> Text<'a>);
by_form_of_operands!(dirname, dirname_of_other, dirname_of_latin1, (path: Text<'a>) -> Text<'a>);

#[inline(always)]
fn extname_of_latin1<'a, const WINDOWS: bool, const FLAT_ONLY: bool>(
    heap: &JsHeap<'a>,
    path: Text<'a>,
) -> bindgen::Result<'a, Option<Text<'a>>> {
    let Some(text) = latin1_of::<FLAT_ONLY>(heap, path)? else {
        return Ok(None);
    };
    Ok(if WINDOWS {
        ascii_slice(heap, &text, extname_windows_t(text.characters()))
    } else {
        // SAFETY: the range is of these characters.
        unsafe { ascii_part(heap, &text, extname_posix_latin1(text.characters())) }
    })
}

#[cold]
#[inline(never)]
fn extname_of_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    path: &[T],
) -> TextResult<'a> {
    heap.create_string_of_units(if WINDOWS {
        extname_windows_t(path)
    } else {
        extname_posix_t(path)
    })
}
of_one_path!(extname_of_other, extname_of_latin1, extname_of_units -> Text<'a>);
by_form_of_operands!(extname, extname_of_other, extname_of_latin1, (path: Text<'a>) -> Text<'a>);

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
    let Some(text) = ascii_of::<FLAT_ONLY>(heap, path)? else {
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
fn parse_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    path: &[T],
) -> bindgen::Result<'a, ParsedPath<'a>> {
    let parsed = if WINDOWS {
        parse_windows_t(path)
    } else {
        parse_posix_t(path)
    };
    Ok(ParsedPath {
        root: heap.create_string_of_units(parsed.root)?,
        dir: heap.create_string_of_units(parsed.dir)?,
        base: heap.create_string_of_units(parsed.base)?,
        ext: heap.create_string_of_units(parsed.ext)?,
        name: heap.create_string_of_units(parsed.name)?,
    })
}
of_one_path!(parse_other, parse_latin1, parse_units -> ParsedPath<'a>);
by_form_of_operands!(parse, parse_other, parse_latin1, (path: Text<'a>) -> ParsedPath<'a>);

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
    if !WINDOWS && is_tidy_ascii_posix(text.characters()) {
        return Ok(Some(path));
    }
    if !is_ascii(text.characters()) {
        return Ok(None);
    }
    if !WINDOWS && text.characters().len() <= SHORT {
        return Ok(Some(normalize_short_posix(heap, text.characters())));
    }
    Ok(normalize_untidy::<WINDOWS>(heap, text))
}

/// `path` is [`SHORT`] and ASCII.
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
fn normalize_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    path: &[T],
) -> TextResult<'a> {
    let mut scratch = PathScratch::<T>::new(heap, normalize_buf_len(path));
    heap.create_string_of_units(if WINDOWS {
        normalize_windows_t(path, scratch.slice())
    } else {
        normalize_posix_t(path, scratch.slice())
    })
}
of_one_path!(normalize_other, normalize_latin1, normalize_units -> Text<'a>);
by_form_of_operands!(normalize, normalize_other, normalize_latin1, (path: Text<'a>) -> Text<'a>);

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
    if !is_tidy_ascii_posix(joined) {
        return Ok(is_ascii(joined).then(|| normalize_short_posix(heap, joined)));
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
        let Some(text) = ascii_of::<FLAT_ONLY>(heap, path)? else {
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
fn join_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    views: &[JSStringView<'a>],
) -> TextResult<'a> {
    let mut widened = Widened::new();
    let parts = T::operands(views, &mut widened);
    let buf_len = join_buf_len(WINDOWS, &parts);
    let mut scratch = PathScratch::<T>::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    heap.create_string_of_units(if WINDOWS {
        join_windows_t(&parts, buf, buf2)
    } else {
        join_posix_t(&parts, buf, buf2)
    })
}

#[inline(never)]
fn join_other<'a, const WINDOWS: bool>(heap: &JsHeap<'a>, paths: &'a [Text<'a>]) -> TextResult<'a> {
    let mut views: SmallVec<[JSStringView<'a>; FEW]> = SmallVec::with_capacity(paths.len());
    for path in paths {
        let view = path.view(heap)?;
        if !view.is_empty() {
            views.push(view);
        }
    }
    if views.iter().any(|view| view.is_utf16()) {
        return join_units::<WINDOWS, u16>(heap, &views);
    }
    match join_latin1::<WINDOWS, false>(heap, paths)? {
        Some(answer) => Ok(answer),
        None => join_units::<WINDOWS, u8>(heap, &views),
    }
}
by_form_of_operands!(join, join_other, join_latin1, (paths: &'a [Text<'a>]) -> Text<'a>);

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
    debug_assert!(rhs.is_ascii());
    let rhs = bun_core::StringView::from_bytes(rhs);
    let texts: [&bun_core::String; 2] = [lhs, &rhs];
    if lhs.is_utf16() {
        join_wtf::<u16>(&texts)
    } else {
        join_wtf::<u8>(&texts)
    }
}

fn join_wtf<T: Unit>(texts: &[&bun_core::String; 2]) -> bun_core::String {
    let mut widened = Widened::new();
    let paths = T::operands(texts, &mut widened);
    let buf_len = join_buf_len(cfg!(windows), &paths);
    let mut scratch = vec![T::default(); buf_len * 2];
    let (buf, buf2) = scratch.split_at_mut(buf_len);
    #[cfg(windows)]
    let joined = join_windows_t(&paths, buf, buf2);
    #[cfg(not(windows))]
    let joined = join_posix_t(&paths, buf, buf2);
    match T::units(joined) {
        CodeUnits::U8(latin1) => bun_core::String::clone_latin1(latin1),
        CodeUnits::U16(utf16) => bun_core::String::clone_utf16(utf16),
    }
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
    if !is_resolved_ascii_posix(from.characters()) || !is_resolved_ascii_posix(to.characters()) {
        if !is_ascii(from.characters()) || !is_ascii(to.characters()) {
            return Ok(None);
        }
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

/// `from` and `to` are ASCII.
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
    latin1_answer(heap, relative_posix_t(from, to, buf, from_buf, tmp_buf))
}

#[inline(never)]
fn relative_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    views: &[JSStringView<'a>; 2],
) -> TextResult<'a> {
    let mut widened = Widened::new();
    let operands = T::operands(views, &mut widened);
    let (from, to) = (operands[0], operands[1]);
    let buf_len = relative_buf_len(from, to);
    let mut scratch = PathScratch::<T>::new(heap, buf_len * 3);
    let (buf, rest) = scratch.slice().split_at_mut(buf_len);
    let (from_buf, tmp_buf) = rest.split_at_mut(buf_len);
    T::answer_with_working_directory(
        heap,
        if WINDOWS {
            relative_windows_t(from, to, buf, from_buf, tmp_buf)
        } else {
            relative_posix_t(from, to, buf, from_buf, tmp_buf)
        },
    )
}

#[inline(never)]
fn relative_other<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> TextResult<'a> {
    let views = [from.view(heap)?, to.view(heap)?];
    if !views.iter().any(|view| view.is_utf16()) {
        if let Some(answer) = relative_latin1::<WINDOWS, false>(heap, from, to)? {
            return Ok(answer);
        }
    }
    if views.iter().all(|view| view.is_empty()) {
        return Ok(from);
    }
    if reads_working_directory_as_bytes::<WINDOWS, _>(&views) {
        relative_units::<WINDOWS, u8>(heap, &views)
    } else {
        relative_units::<WINDOWS, u16>(heap, &views)
    }
}
by_form_of_operands!(relative, relative_other, relative_latin1, (from: Text<'a>, to: Text<'a>) -> Text<'a>);

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
        if is_absolute && joined.start == SHORT && is_resolved_ascii_posix(part) {
            return Ok(Some(path));
        }
        if !joined.prepend(part) {
            return Ok(None);
        }
        if is_absolute {
            return Ok(resolve_joined_posix(heap, joined.characters()));
        }
    }
    // `process.cwd()` itself is kept as a string.
    if matches!(joined.characters(), b"" | b"." | b"./") {
        return Ok(None);
    }
    #[cfg(not(windows))]
    {
        let working_directory = bun_node_path::posix_working_directory();
        if is_absolute_posix_t(working_directory) && joined.prepend(working_directory) {
            return Ok(resolve_joined_posix(heap, joined.characters()));
        }
    }
    Ok(None)
}

/// `joined` is absolute and [`SHORT`]. `None` if one of its characters, or bytes of the working directory, is outside ASCII.
#[inline(always)]
fn resolve_joined_posix<'a>(heap: &JsHeap<'a>, joined: &[u8]) -> Option<Text<'a>> {
    if is_resolved_ascii_posix(joined) {
        return Some(heap.create_latin1_string(joined));
    }
    is_ascii(joined).then(|| resolve_untidy_posix(heap, joined))
}

/// `joined` is absolute, [`SHORT`] and ASCII.
#[inline(never)]
fn resolve_untidy_posix<'a>(heap: &JsHeap<'a>, joined: &[u8]) -> Text<'a> {
    heap.create_latin1_string(resolve_absolute_posix_latin1(
        joined,
        &mut normalized_buffer(),
    ))
}

#[inline(never)]
fn resolve_units<'a, const WINDOWS: bool, T: Unit>(
    heap: &JsHeap<'a>,
    views: &[JSStringView<'a>],
) -> TextResult<'a> {
    let mut widened = Widened::new();
    let parts = T::operands(views, &mut widened);
    let buf_len = resolve_buf_len(WINDOWS, &parts);
    let mut scratch = PathScratch::<T>::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    T::answer_with_working_directory(
        heap,
        if WINDOWS {
            resolve_windows_t(&parts, buf, buf2)
        } else {
            resolve_posix_t(&parts, buf, buf2)
        },
    )
}

#[inline(never)]
fn resolve_other<'a, const WINDOWS: bool>(
    heap: &JsHeap<'a>,
    paths: &'a [JsLocal<'a>],
) -> TextResult<'a> {
    // SAFETY: it is passed to what throws, after which this returns, and to what reads the cached working directory.
    let global = unsafe { heap.global() };
    // From the last to the first that is absolute.
    let mut views: SmallVec<[JSStringView<'a>; FEW]> = SmallVec::new();
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
    if !views.iter().any(|view| view.is_utf16()) {
        if let Some(answer) = resolve_latin1::<WINDOWS, false>(heap, paths)? {
            return Ok(answer);
        }
    }

    #[cfg(unix)]
    if !WINDOWS
        && match &views[..] {
            [] => true,
            [only] => only.eq_ascii(b".") || only.eq_ascii(b"./"),
            _ => false,
        }
    {
        // `process.cwd()`, which throws when `getcwd` fails (for example, a deleted working directory).
        let cwd = crate::jsc::call_zero_is_throw(global, || Process__getCachedCwd(global))?;
        let Some(cwd) = JsLocal::new(heap, cwd).as_string() else {
            unreachable!("process.cwd() is a string");
        };
        return Ok(cwd);
    }

    views.reverse();
    if reads_working_directory_as_bytes::<WINDOWS, _>(&views) {
        resolve_units::<WINDOWS, u8>(heap, &views)
    } else {
        resolve_units::<WINDOWS, u16>(heap, &views)
    }
}
by_form_of_operands!(resolve, resolve_other, resolve_latin1, (paths: &'a [JsLocal<'a>]) -> Text<'a>);

fn format<'a, const WINDOWS: bool>(
    cx: &mut JsScope<'a>,
    path_object: JsLocal<'a>,
) -> TextResult<'a> {
    let separator = if WINDOWS {
        CHAR_BACKWARD_SLASH
    } else {
        CHAR_FORWARD_SLASH
    };
    format_with_separator(cx, path_object, separator)
}

fn format_with_separator<'a>(
    cx: &mut JsScope<'a>,
    path_object: JsLocal<'a>,
    separator: u8,
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
        // Each is kept while the next one is read, which can run a getter.
        let mut members: [bun_core::String; 5] = Default::default();
        for (member, name) in members
            .iter_mut()
            .zip(["root", "dir", "base", "name", "ext"])
        {
            if let Some(value) = path_object.get_truthy(global, name)? {
                *member = value.to_bun_string(global)?;
            }
        }
        members
    };
    let members = members.each_ref();
    if members.iter().any(|member| member.is_utf16()) {
        format_units::<u16>(&cx.heap, &members, separator)
    } else {
        format_units::<u8>(&cx.heap, &members, separator)
    }
}

#[inline(never)]
fn format_units<'a, T: Unit>(
    heap: &JsHeap<'a>,
    members: &[&bun_core::String; 5],
    separator: u8,
) -> TextResult<'a> {
    let mut widened = Widened::new();
    let operands = T::operands(members, &mut widened);
    let [root, dir, base, name, ext] = operands[..] else {
        unreachable!("a path object has five members");
    };
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
        .max(path_size::<T>());
    let mut scratch = PathScratch::<T>::new(heap, buf_len);
    heap.create_string_of_units(format_t(
        &PathParsed {
            root,
            dir,
            base,
            ext,
            name,
        },
        T::from_u8(separator),
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
    relative::<false>(heap, from, to)
}

#[inline(always)]
pub(crate) fn relative_win32<'a>(
    heap: &JsHeap<'a>,
    from: Text<'a>,
    to: Text<'a>,
) -> TextResult<'a> {
    relative::<true>(heap, from, to)
}

#[inline(always)]
pub(crate) fn resolve_posix<'a>(heap: &JsHeap<'a>, paths: &'a [JsLocal<'a>]) -> TextResult<'a> {
    resolve::<false>(heap, paths)
}

#[inline(always)]
pub(crate) fn resolve_win32<'a>(heap: &JsHeap<'a>, paths: &'a [JsLocal<'a>]) -> TextResult<'a> {
    resolve::<true>(heap, paths)
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
    let view = [text.view(heap)?];
    if view[0].is_empty() {
        return Ok(path);
    }
    if reads_working_directory_as_bytes::<true, _>(&view) {
        to_namespaced_path_units::<u8>(heap, &view)
    } else {
        to_namespaced_path_units::<u16>(heap, &view)
    }
    .map(JsLocal::as_value)
}

#[inline(never)]
fn to_namespaced_path_units<'a, T: Unit>(
    heap: &JsHeap<'a>,
    view: &[JSStringView<'a>; 1],
) -> TextResult<'a> {
    let mut widened = Widened::new();
    let path = T::operands(view, &mut widened)[0];
    let buf_len = to_namespaced_path_buf_len(path);
    let mut scratch = PathScratch::<T>::new(heap, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    T::answer_with_working_directory(heap, to_namespaced_path_windows_t(path, buf, buf2))
}
