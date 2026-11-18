//! `REPARSE_DATA_BUFFER`: a tag, the length of the data, two unused bytes, and the data.

use super::wide;

pub(crate) const MAX_SIZE: usize = 16 * 1024;

const TAG_MOUNT_POINT: u32 = 0xA000_0003;
const TAG_SYMLINK: u32 = 0xA000_000C;
const TAG_LX_SYMLINK: u32 = 0xA000_001D;
const TAG_APP_EXEC_LINK: u32 = 0x8000_001B;

pub(crate) fn can_be_link(tag: u32) -> bool {
    matches!(
        tag,
        TAG_MOUNT_POINT | TAG_SYMLINK | TAG_LX_SYMLINK | TAG_APP_EXEC_LINK
    )
}

type Unit = [u8; 2];

const fn unit(ascii: u8) -> Unit {
    [ascii, 0]
}

const NUL: Unit = unit(0);
const BACKSLASH: Unit = unit(b'\\');
const NT_PREFIX: [Unit; 4] = [BACKSLASH, unit(b'?'), unit(b'?'), BACKSLASH];

pub(crate) enum LinkTarget<'a> {
    Wide(&'a [Unit]),
    /// `\server\share`, which lacks the first backslash.
    Unc(&'a [Unit]),
    Utf8(&'a [u8]),
}

fn units(wide: &[Unit]) -> impl Iterator<Item = u16> {
    wide.iter().copied().map(u16::from_le_bytes)
}

impl LinkTarget<'_> {
    /// In WTF-8.
    pub(crate) fn len(&self) -> usize {
        match self {
            Self::Wide(wide) => wide::decoded_len(units(wide)),
            Self::Unc(wide) => 1 + wide::decoded_len(units(wide)),
            Self::Utf8(bytes) => bytes.len(),
        }
    }

    /// Returns the length written, or `None` if `buf` is too small.
    pub(crate) fn decode(&self, buf: &mut [u8]) -> Option<usize> {
        match self {
            Self::Wide(wide) => wide::decode(units(wide), buf),
            Self::Unc(wide) => wide::decode([b'\\'.into()].into_iter().chain(units(wide)), buf),
            Self::Utf8(bytes) => {
                buf.get_mut(..bytes.len())?.copy_from_slice(bytes);
                Some(bytes.len())
            }
        }
    }
}

fn has_win32_prefix(path: &[u8]) -> bool {
    matches!(path, [_, b':', ..])
        || matches!(path, [a, b, ..] | [a, b'?', b'?', b, ..]
            if bun_paths::is_sep_any(*a) && bun_paths::is_sep_any(*b))
}

/// `data` starts with the offset and the length of the name in `names`.
fn substitute_name<'a>(data: &[u8], names: &'a [u8]) -> Option<&'a [Unit]> {
    let [offset, len, ..] = data.as_chunks().0 else {
        return None;
    };
    let name = names
        .get(u16::from_le_bytes(*offset).into()..)?
        .get(..u16::from_le_bytes(*len).into())?;
    name.as_chunks().0.split(|&it| it == NUL).next()
}

fn starts_at_drive(name: &[Unit]) -> bool {
    matches!(name, [[letter, 0], [b':', 0], rest @ ..]
        if letter.is_ascii_alphabetic() && matches!(rest, [] | [BACKSLASH, ..]))
}

/// Whether `buffer` has the tag of a symlink or a mount point, but no name.
#[cfg(windows)]
pub(crate) fn lacks_name(buffer: &[u8]) -> bool {
    let name = |names_at: usize| {
        let (_, data) = split(buffer)?;
        substitute_name(data, data.get(names_at..)?)
    };
    match buffer.first_chunk().copied().map(u32::from_le_bytes) {
        Some(TAG_SYMLINK) => name(12).is_none(),
        Some(TAG_MOUNT_POINT) => name(8).is_none(),
        _ => false,
    }
}

/// The tag and the data.
fn split(buffer: &[u8]) -> Option<(u32, &[u8])> {
    let (&[tag @ .., l0, l1, _, _], data) = buffer.split_first_chunk::<8>()?;
    let data = data.get(..u16::from_le_bytes([l0, l1]).into())?;
    Some((u32::from_le_bytes(tag), data))
}

/// `None` if the reparse point is not a link.
pub(crate) fn link_target(buffer: &[u8]) -> Option<LinkTarget<'_>> {
    let (tag, data) = split(buffer)?;
    match tag {
        TAG_SYMLINK => {
            let name = substitute_name(data, data.get(12..)?)?;
            Some(match name.strip_prefix(&NT_PREFIX) {
                Some(path) if starts_at_drive(path) => LinkTarget::Wide(path),
                Some(
                    [
                        [b'U' | b'u', 0],
                        [b'N' | b'n', 0],
                        [b'C' | b'c', 0],
                        path @ ..,
                    ],
                ) if path.first() == Some(&BACKSLASH) => LinkTarget::Unc(path),
                _ => LinkTarget::Wide(name),
            })
        }
        // One that names a volume is where the volume is mounted.
        TAG_MOUNT_POINT => substitute_name(data, data.get(8..)?)?
            .strip_prefix(&NT_PREFIX)
            .filter(|path| starts_at_drive(path))
            .map(LinkTarget::Wide),
        TAG_APP_EXEC_LINK => {
            let (count, strings) = data.split_first_chunk()?;
            let mut strings = strings.as_chunks().0.split(|&it| it == NUL);
            let (package, entry, path) = (strings.next()?, strings.next()?, strings.next()?);
            (u32::from_le_bytes(*count) >= 3
                && !package.is_empty()
                && !entry.is_empty()
                && path.len() > 2
                && starts_at_drive(path))
            .then_some(LinkTarget::Wide(path))
        }
        TAG_LX_SYMLINK => data
            .strip_prefix(&2u32.to_le_bytes())
            .map(bun_core::slice_to_nul)
            .filter(|path| !has_win32_prefix(path))
            .map(LinkTarget::Utf8),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum JunctionError {
    TargetIsRelative,
    TooLong,
}

/// `target` is `X:\…` or starts with `\\?\`.
pub(crate) fn junction(target: &[u16]) -> Result<Vec<u8>, JunctionError> {
    let is_separator = |&it: &u16| bun_paths::is_sep_any_t(it);
    let target = match (target.strip_prefix(bun_core::w!("\\\\?\\")), target) {
        (Some(verbatim), _) => verbatim,
        (None, [letter, 0x3A, separator, ..])
            if bun_paths::resolve_path::is_drive_letter_t(*letter) && is_separator(separator) =>
        {
            target
        }
        _ => return Err(JunctionError::TargetIsRelative),
    };

    let mut name: Vec<Unit> = Vec::with_capacity(target.len() + 1);
    for &it in target {
        if !is_separator(&it) {
            name.push(it.to_le_bytes());
        } else if name.last() != Some(&BACKSLASH) {
            name.push(BACKSLASH);
        }
    }
    let substitute = [&NT_PREFIX[..], &name].concat();
    if name.len() == 2 {
        name.push(BACKSLASH);
    }
    let names = [&substitute[..], &[NUL], &name, &[NUL]].concat();

    let data_len = 8 + size_of_val(&*names);
    if 8 + data_len > MAX_SIZE {
        return Err(JunctionError::TooLong);
    }
    let substitute_len = size_of_val(&*substitute);
    let print_len = size_of_val(&*name);
    let fields = [
        data_len,
        0,
        0,
        substitute_len,
        substitute_len + 2,
        print_len,
    ]
    .map(|it| (it as u16).to_le_bytes());
    Ok([
        &TAG_MOUNT_POINT.to_le_bytes()[..],
        fields.as_flattened(),
        names.as_flattened(),
    ]
    .concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    fn buffer(tag: u32, data: &[u8]) -> Vec<u8> {
        let len = (data.len() as u16).to_le_bytes();
        [&tag.to_le_bytes()[..], &len, &[0, 0], data].concat()
    }

    fn named(tag: u32, name: &str) -> Vec<u8> {
        let (print, name) = (wide("print"), wide(name));
        let fields = [print.len(), name.len(), 0, print.len()].map(|it| (it as u16).to_le_bytes());
        let flags: &[u8] = if tag == TAG_SYMLINK { &[0; 4] } else { &[] };
        buffer(tag, &[fields.as_flattened(), flags, &print, &name].concat())
    }

    fn app(count: u32, strings: &str) -> Vec<u8> {
        let data = [&count.to_le_bytes()[..], &wide(strings)].concat();
        buffer(TAG_APP_EXEC_LINK, &data)
    }

    fn target(buffer: &[u8]) -> Option<Vec<u8>> {
        let target = link_target(buffer)?;
        assert!(can_be_link(u32::from_le_bytes(*buffer.first_chunk()?)));
        let mut text = vec![0; target.len()];
        assert_eq!(target.decode(&mut text), Some(text.len()));
        Some(text)
    }

    #[test]
    fn reads_link_targets() {
        for (buffer, expected) in [
            (named(TAG_SYMLINK, "..\\é"), Some("..\\é")),
            (named(TAG_SYMLINK, "\\??\\C:\\a"), Some("C:\\a")),
            (named(TAG_SYMLINK, "\\??\\c:"), Some("c:")),
            (named(TAG_SYMLINK, "\\??\\C:a"), Some("\\??\\C:a")),
            (named(TAG_SYMLINK, "\\??\\unc\\s\\t"), Some("\\\\s\\t")),
            (named(TAG_SYMLINK, "\\??\\UNC"), Some("\\??\\UNC")),
            (named(TAG_SYMLINK, "\\??\\NUL"), Some("\\??\\NUL")),
            (named(TAG_SYMLINK, "a\0"), Some("a")),
            (named(TAG_SYMLINK, ""), Some("")),
            (named(TAG_MOUNT_POINT, "\\??\\C:\\a\\"), Some("C:\\a\\")),
            (app(3, "p\0e\0C:\\a.exe\x000\0"), Some("C:\\a.exe")),
            (app(2, "p\0e\0C:\\a.exe\0"), None),
            (app(3, "p\0\0C:\\a.exe\0"), None),
            (app(3, "p\0e\0a.exe\0"), None),
            (app(3, "p\0e\0C:\0"), None),
            (buffer(TAG_LX_SYMLINK, b"\x02\0\0\0../a"), Some("../a")),
            (buffer(TAG_LX_SYMLINK, b"\x01\0\0\0../a"), None),
            (named(0x8000_0023, "a"), None),
        ] {
            assert_eq!(target(&buffer).as_deref(), expected.map(str::as_bytes));
        }
    }

    #[test]
    fn builds_junctions() {
        let build = |target: &str| junction(&target.encode_utf16().collect::<Vec<_>>());
        let expected = [
            &[3, 0, 0, 0xA0, 36, 0, 0, 0, 0, 0, 16, 0, 18, 0, 8, 0][..],
            &wide("\\??\\C:\\a\0C:\\a\0"),
        ];
        assert_eq!(build("C:/a").unwrap(), expected.concat());
        for (given, names) in [
            ("C://a\\\\b/", "\\??\\C:\\a\\b\\\0C:\\a\\b\\\0"),
            ("C:\\", "\\??\\C:\\\0C:\\\0"),
            ("\\\\?\\C:", "\\??\\C:\0C:\\\0"),
            ("\\\\?\\UNC\\s\\t", "\\??\\UNC\\s\\t\0UNC\\s\\t\0"),
        ] {
            assert_eq!(build(given).unwrap()[16..], wide(names));
        }
        for relative in ["", "a", "C:", "C:a", "\\a", "\\\\s\\t", "1:\\a"] {
            assert_eq!(build(relative), Err(JunctionError::TargetIsRelative));
        }
    }
}
