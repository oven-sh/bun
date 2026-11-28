//! `REPARSE_DATA_BUFFER`: a tag, the data length, two reserved bytes, and the data.

use bun_paths::portable::is_sep;

use super::wtf16;

pub(crate) const MAXIMUM_REPARSE_DATA_BUFFER_SIZE: usize = 16 * 1024;

const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
const IO_REPARSE_TAG_LX_SYMLINK: u32 = 0xA000_001D;
const IO_REPARSE_TAG_APPEXECLINK: u32 = 0x8000_001B;

const HEADER_LEN: usize = 8;
// Relative to the data that follows the header.
const SYMLINK_PATH_BUFFER_OFFSET: usize = 12;
const MOUNT_POINT_PATH_BUFFER_OFFSET: usize = 8;
const LX_SYMLINK_VERSION: u32 = 2;

pub(crate) fn is_link_tag(tag: u32) -> bool {
    matches!(
        tag,
        IO_REPARSE_TAG_MOUNT_POINT
            | IO_REPARSE_TAG_SYMLINK
            | IO_REPARSE_TAG_LX_SYMLINK
            | IO_REPARSE_TAG_APPEXECLINK
    )
}

const fn ascii_to_utf16le(ascii: u8) -> [u8; 2] {
    [ascii, 0]
}

const NUL: [u8; 2] = ascii_to_utf16le(0);
const BACKSLASH: [u8; 2] = ascii_to_utf16le(b'\\');
const QUESTION_MARK: [u8; 2] = ascii_to_utf16le(b'?');
const NT_OBJECT_PREFIX: [[u8; 2]; 4] = [BACKSLASH, QUESTION_MARK, QUESTION_MARK, BACKSLASH];

pub(crate) enum LinkTarget<'a> {
    Utf16(&'a [[u8; 2]]),
    /// `\server\share`: a UNC path without its first backslash.
    Unc(&'a [[u8; 2]]),
    Utf8(&'a [u8]),
}

fn code_units(utf16le: &[[u8; 2]]) -> impl Iterator<Item = u16> {
    utf16le.iter().copied().map(u16::from_le_bytes)
}

impl LinkTarget<'_> {
    /// Length in WTF-8 bytes.
    pub(crate) fn len(&self) -> usize {
        match self {
            Self::Utf16(path) => wtf16::decoded_len(code_units(path)),
            Self::Unc(path) => 1 + wtf16::decoded_len(code_units(path)),
            Self::Utf8(bytes) => bytes.len(),
        }
    }

    /// Returns the length written, or `None` if `buf` is too small.
    pub(crate) fn decode(&self, buf: &mut [u8]) -> Option<usize> {
        match self {
            Self::Utf16(path) => wtf16::decode(code_units(path), buf),
            Self::Unc(path) => {
                wtf16::decode([b'\\'.into()].into_iter().chain(code_units(path)), buf)
            }
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
            if is_sep(*a) && is_sep(*b))
}

/// `data` starts with `SubstituteNameOffset` and `SubstituteNameLength`.
fn parse_substitute_name<'a>(data: &[u8], path_buffer: &'a [u8]) -> Option<&'a [[u8; 2]]> {
    let [offset, len, ..] = data.as_chunks().0 else {
        return None;
    };
    let name = path_buffer
        .get(u16::from_le_bytes(*offset).into()..)?
        .get(..u16::from_le_bytes(*len).into())?;
    name.as_chunks().0.split(|&unit| unit == NUL).next()
}

fn starts_with_drive_letter(name: &[[u8; 2]]) -> bool {
    matches!(name, [[letter, 0], [b':', 0], rest @ ..]
        if letter.is_ascii_alphabetic() && matches!(rest, [] | [BACKSLASH, ..]))
}

/// Whether `buffer` has a symlink or mount point tag but no substitute name.
#[cfg(windows)]
pub(crate) fn is_missing_substitute_name(buffer: &[u8]) -> bool {
    let parse_name = |path_buffer_offset: usize| {
        let (_, data) = split_header(buffer)?;
        parse_substitute_name(data, data.get(path_buffer_offset..)?)
    };
    match buffer.first_chunk().copied().map(u32::from_le_bytes) {
        Some(IO_REPARSE_TAG_SYMLINK) => parse_name(SYMLINK_PATH_BUFFER_OFFSET).is_none(),
        Some(IO_REPARSE_TAG_MOUNT_POINT) => parse_name(MOUNT_POINT_PATH_BUFFER_OFFSET).is_none(),
        _ => false,
    }
}

/// Returns the tag and the data.
fn split_header(buffer: &[u8]) -> Option<(u32, &[u8])> {
    let (&[tag @ .., len_low, len_high, _, _], data) = buffer.split_first_chunk::<HEADER_LEN>()?;
    let data = data.get(..u16::from_le_bytes([len_low, len_high]).into())?;
    Some((u32::from_le_bytes(tag), data))
}

/// `None` if the reparse point is not a link.
pub(crate) fn parse_link_target(buffer: &[u8]) -> Option<LinkTarget<'_>> {
    let (tag, data) = split_header(buffer)?;
    match tag {
        IO_REPARSE_TAG_SYMLINK => {
            let name = parse_substitute_name(data, data.get(SYMLINK_PATH_BUFFER_OFFSET..)?)?;
            Some(match name.strip_prefix(&NT_OBJECT_PREFIX) {
                Some(path) if starts_with_drive_letter(path) => LinkTarget::Utf16(path),
                Some(
                    [
                        [b'U' | b'u', 0],
                        [b'N' | b'n', 0],
                        [b'C' | b'c', 0],
                        path @ ..,
                    ],
                ) if path.first() == Some(&BACKSLASH) => LinkTarget::Unc(path),
                _ => LinkTarget::Utf16(name),
            })
        }
        // A mount point whose target is a volume name is a mounted volume, not a link.
        IO_REPARSE_TAG_MOUNT_POINT => {
            parse_substitute_name(data, data.get(MOUNT_POINT_PATH_BUFFER_OFFSET..)?)?
                .strip_prefix(&NT_OBJECT_PREFIX)
                .filter(|path| starts_with_drive_letter(path))
                .map(LinkTarget::Utf16)
        }
        IO_REPARSE_TAG_APPEXECLINK => {
            let (string_count, strings) = data.split_first_chunk()?;
            let mut strings = strings.as_chunks().0.split(|&unit| unit == NUL);
            let package = strings.next()?;
            let entry_point = strings.next()?;
            let path = strings.next()?;
            (u32::from_le_bytes(*string_count) >= 3
                && !package.is_empty()
                && !entry_point.is_empty()
                && path.len() > 2
                && starts_with_drive_letter(path))
            .then_some(LinkTarget::Utf16(path))
        }
        IO_REPARSE_TAG_LX_SYMLINK => data
            .strip_prefix(&LX_SYMLINK_VERSION.to_le_bytes())
            .map(bun_core::slice_to_nul)
            .filter(|path| !has_win32_prefix(path))
            .map(LinkTarget::Utf8),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum JunctionError {
    RelativeTarget,
    TooLong,
}

/// `target` is `X:\…` or starts with `\\?\`.
pub(crate) fn encode_junction(target: &[u16]) -> Result<Vec<u8>, JunctionError> {
    const COLON: u16 = b':' as u16;
    let target = match (target.strip_prefix(bun_core::w!("\\\\?\\")), target) {
        (Some(verbatim), _) => verbatim,
        (None, [letter, COLON, separator, ..])
            if u8::try_from(*letter).is_ok_and(|byte| byte.is_ascii_alphabetic())
                && is_sep(*separator) =>
        {
            target
        }
        _ => return Err(JunctionError::RelativeTarget),
    };

    let mut print_name: Vec<[u8; 2]> = Vec::with_capacity(target.len() + 1);
    for &unit in target {
        if !is_sep(unit) {
            print_name.push(unit.to_le_bytes());
        } else if print_name.last() != Some(&BACKSLASH) {
            print_name.push(BACKSLASH);
        }
    }
    let substitute_name = [&NT_OBJECT_PREFIX[..], &print_name].concat();
    if print_name.len() == 2 {
        print_name.push(BACKSLASH);
    }
    let path_buffer = [&substitute_name[..], &[NUL], &print_name, &[NUL]].concat();

    let data_len = MOUNT_POINT_PATH_BUFFER_OFFSET + size_of_val(&*path_buffer);
    if HEADER_LEN + data_len > MAXIMUM_REPARSE_DATA_BUFFER_SIZE {
        return Err(JunctionError::TooLong);
    }
    let substitute_name_len = size_of_val(&*substitute_name);
    let print_name_len = size_of_val(&*print_name);
    // Data length, reserved, then the offset and length of each name.
    let fields = [
        data_len,
        0,
        0,
        substitute_name_len,
        substitute_name_len + 2,
        print_name_len,
    ]
    .map(|field| (field as u16).to_le_bytes());
    Ok([
        &IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes()[..],
        fields.as_flattened(),
        path_buffer.as_flattened(),
    ]
    .concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    fn encode_buffer(tag: u32, data: &[u8]) -> Vec<u8> {
        let len = (data.len() as u16).to_le_bytes();
        [&tag.to_le_bytes()[..], &len, &[0, 0], data].concat()
    }

    fn encode_link(tag: u32, substitute_name: &str) -> Vec<u8> {
        let print_name = to_utf16le("print");
        let substitute_name = to_utf16le(substitute_name);
        let fields = [print_name.len(), substitute_name.len(), 0, print_name.len()]
            .map(|field| (field as u16).to_le_bytes());
        let flags: &[u8] = if tag == IO_REPARSE_TAG_SYMLINK {
            &[0; 4]
        } else {
            &[]
        };
        let data = [fields.as_flattened(), flags, &print_name, &substitute_name].concat();
        encode_buffer(tag, &data)
    }

    fn encode_app_exec_link(string_count: u32, strings: &str) -> Vec<u8> {
        let data = [&string_count.to_le_bytes()[..], &to_utf16le(strings)].concat();
        encode_buffer(IO_REPARSE_TAG_APPEXECLINK, &data)
    }

    fn decode_target(buffer: &[u8]) -> Option<Vec<u8>> {
        let target = parse_link_target(buffer)?;
        assert!(is_link_tag(u32::from_le_bytes(*buffer.first_chunk()?)));
        let mut text = vec![0; target.len()];
        assert_eq!(target.decode(&mut text), Some(text.len()));
        Some(text)
    }

    #[test]
    fn parses_link_targets() {
        let symlink = |name| encode_link(IO_REPARSE_TAG_SYMLINK, name);
        let mount_point = |name| encode_link(IO_REPARSE_TAG_MOUNT_POINT, name);
        let lx_symlink = |data: &[u8]| encode_buffer(IO_REPARSE_TAG_LX_SYMLINK, data);
        for (buffer, expected) in [
            (symlink("..\\é"), Some("..\\é")),
            (symlink("\\??\\C:\\a"), Some("C:\\a")),
            (symlink("\\??\\c:"), Some("c:")),
            (symlink("\\??\\C:a"), Some("\\??\\C:a")),
            (symlink("\\??\\unc\\s\\t"), Some("\\\\s\\t")),
            (symlink("\\??\\UNC"), Some("\\??\\UNC")),
            (symlink("\\??\\NUL"), Some("\\??\\NUL")),
            (symlink("a\0"), Some("a")),
            (symlink(""), Some("")),
            (mount_point("\\??\\C:\\a\\"), Some("C:\\a\\")),
            (
                encode_app_exec_link(3, "p\0e\0C:\\a.exe\x000\0"),
                Some("C:\\a.exe"),
            ),
            (encode_app_exec_link(2, "p\0e\0C:\\a.exe\0"), None),
            (encode_app_exec_link(3, "p\0\0C:\\a.exe\0"), None),
            (encode_app_exec_link(3, "p\0e\0a.exe\0"), None),
            (encode_app_exec_link(3, "p\0e\0C:\0"), None),
            (lx_symlink(b"\x02\0\0\0../a"), Some("../a")),
            (lx_symlink(b"\x01\0\0\0../a"), None),
            (encode_link(0x8000_0023, "a"), None),
        ] {
            assert_eq!(
                decode_target(&buffer).as_deref(),
                expected.map(str::as_bytes)
            );
        }
    }

    #[test]
    fn encodes_junctions() {
        let encode = |target: &str| encode_junction(&target.encode_utf16().collect::<Vec<_>>());
        let expected = [
            &[3, 0, 0, 0xA0, 36, 0, 0, 0, 0, 0, 16, 0, 18, 0, 8, 0][..],
            &to_utf16le("\\??\\C:\\a\0C:\\a\0"),
        ];
        assert_eq!(encode("C:/a").unwrap(), expected.concat());
        for (target, path_buffer) in [
            ("C://a\\\\b/", "\\??\\C:\\a\\b\\\0C:\\a\\b\\\0"),
            ("C:\\", "\\??\\C:\\\0C:\\\0"),
            ("\\\\?\\C:", "\\??\\C:\0C:\\\0"),
            ("\\\\?\\UNC\\s\\t", "\\??\\UNC\\s\\t\0UNC\\s\\t\0"),
        ] {
            assert_eq!(encode(target).unwrap()[16..], to_utf16le(path_buffer));
        }
        for relative in ["", "a", "C:", "C:a", "\\a", "\\\\s\\t", "1:\\a"] {
            assert_eq!(encode(relative), Err(JunctionError::RelativeTarget));
        }
    }
}
