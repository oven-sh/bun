//! The debug id of a bundle: `bun build` writes it into the file (`//# debugId=<id>`) and into its map (`"debugId"`).

use bun_core::strings::{self, PathByte};
use bun_core::{Utf8Bytes, fmt};
use core::fmt::{Display, Formatter};

pub(crate) struct Check<'a> {
    pub(crate) file_id: &'a [u8],
    pub(crate) source_filename: &'a [u8],
}

impl Check<'_> {
    /// Dashes and the case of letters do not count: a UUID is written with or without them.
    pub(crate) fn is_id_of_file(&self, map_id: &[u8]) -> bool {
        fn digits(id: &[u8]) -> impl Iterator<Item = u8> + '_ {
            id.iter()
                .filter(|unit| **unit != b'-')
                .map(u8::to_ascii_lowercase)
        }
        digits(self.file_id).eq(digits(map_id))
    }

    #[cold]
    pub(crate) fn warn(&self, map_id: &[u8]) {
        let map_path = [self.source_filename, b".map"].concat();
        bun_core::warn!(
            "Ignoring sourcemap {}: its debugId {} is not the debugId {} that {} had when it was last loaded",
            fmt::EscapeControlChars(fmt::quote(&map_path)),
            Shown(map_id),
            Shown(self.file_id),
            fmt::EscapeControlChars(fmt::quote(self.source_filename)),
        );
        bun_core::note!(
            "positions in this file stay unmapped until Bun loads it again beside a map with the same debugId"
        );
        // `note!` does not flush, and a Worker can end with no other flush.
        bun_core::output::flush();
        crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
    }
}

struct Shown<'a>(&'a [u8]);

impl Shown<'_> {
    const MAX: usize = 64;
}

impl Display for Shown<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> core::fmt::Result {
        let shown = &self.0[..self.0.len().min(Self::MAX)];
        write!(f, "{}", fmt::EscapeControlChars(fmt::quote(shown)))?;
        if shown.len() < self.0.len() {
            f.write_str("...")?;
        }
        Ok(())
    }
}

/// The id on the `//# debugId=` line of a `// @bun` file: the last line, or the line above a last `//# sourceMappingURL=` line.
pub(crate) fn of_file(source: &bun_core::String) -> Option<Utf8Bytes<'_>> {
    let id = if source.is_8bit() {
        Utf8Bytes::Borrowed(value_of_id_line(source.latin1())?)
    } else {
        Utf8Bytes::Owned(strings::to_utf8_alloc(value_of_id_line(source.utf16())?))
    };
    // An id is one run of ASCII with no blank and no quote: V8 reads the value of a magic comment this way.
    let is_id = !id.is_empty()
        && id
            .iter()
            .all(|unit| unit.is_ascii_graphic() && !matches!(*unit, b'"' | b'\''));
    is_id.then_some(id)
}

fn value_of_id_line<T: PathByte>(text: &[T]) -> Option<&[T]> {
    // Text that does not start as the file does is not the file: for a replaced `Module.wrapper` the loader swaps the first line of a CommonJS file and cuts its end.
    let first_line = match strip_prefix(text, b"#!") {
        Some(_) => &text[T::index_of_unit(text, T::from_u8(b'\n'))? + 1..],
        None => text,
    };
    strip_prefix(first_line, b"// @bun")?;

    let (above, last) = split_last_line(text);
    let line = match strip_prefix(last, b"//# sourceMappingURL=") {
        Some(_) => split_last_line(above).1,
        None => last,
    };
    let mut value = strip_prefix(line, b"//# debugId=")?;
    let blank = [T::from_u8(b' '), T::from_u8(b'\t')];
    while let [first, rest @ ..] = value {
        if !blank.contains(first) {
            break;
        }
        value = rest;
    }
    Some(value)
}

fn split_last_line<T: PathByte>(mut text: &[T]) -> (&[T], &[T]) {
    let blank = (*b"\n\r \t").map(T::from_u8);
    while let [rest @ .., last] = text {
        if !blank.contains(last) {
            break;
        }
        text = rest;
    }
    match strings::last_index_of_char_t(text, T::from_u8(b'\n')) {
        Some(line_end) => (&text[..line_end], &text[line_end + 1..]),
        None => (&text[..0], text),
    }
}

fn strip_prefix<'a, T: PathByte>(text: &'a [T], prefix: &[u8]) -> Option<&'a [T]> {
    let (start, rest) = text.split_at_checked(prefix.len())?;
    start
        .iter()
        .zip(prefix)
        .all(|(unit, byte)| *unit == T::from_u8(*byte))
        .then_some(rest)
}
