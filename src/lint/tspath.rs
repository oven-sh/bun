//! Paths as tsc prints them: the part of `internal/tspath/path.go` of typescript-go behind the file name of a diagnostic.

use bun_core::strings;

use crate::scanner::decode_rune_in_string;

const DIRECTORY_SEPARATOR: u8 = b'/';
const URL_SCHEME_SEPARATOR: &[u8] = b"://";

/// The value for the file system of the platform; the reference asks the file system.
pub const USE_CASE_SENSITIVE_FILE_NAMES: bool = !cfg!(any(windows, target_os = "macos"));

/// Determines whether a byte corresponds to `/` or `\`.
fn is_any_directory_separator(char: u8) -> bool {
    char == b'/' || char == b'\\'
}

/// Determines whether a path is an absolute disk path (e.g. starts with `/`, or a dos path like `c:`, `c:\` or `c:/`).
pub fn is_rooted_disk_path(path: &[u8]) -> bool {
    get_encoded_root_length(path) > 0
}

fn has_trailing_directory_separator(path: &[u8]) -> bool {
    path.last().is_some_and(|&b| is_any_directory_separator(b))
}

/// Combines paths. If a path is absolute, it replaces any previous path. Relative paths are not simplified.
pub fn combine_paths(first_path: &[u8], paths: &[&[u8]]) -> Vec<u8> {
    let mut result = normalize_slashes(first_path);
    for &trailing_path in paths {
        if trailing_path.is_empty() {
            continue;
        }
        let trailing_path = normalize_slashes(trailing_path);
        if result.is_empty() || get_root_length(&trailing_path) != 0 {
            // `trailing_path` is absolute.
            result = trailing_path;
        } else {
            if !has_trailing_directory_separator(&result) {
                result.push(DIRECTORY_SEPARATOR);
            }
            result.extend_from_slice(&trailing_path);
        }
    }
    result
}

fn get_path_components(path: &[u8], current_directory: &[u8]) -> Vec<Vec<u8>> {
    let path = combine_paths(current_directory, &[path]);
    path_components(&path, get_root_length(&path))
        .into_iter()
        .map(<[u8]>::to_vec)
        .collect()
}

/// The root, then each name; an absent root is the empty first component.
fn path_components(path: &[u8], root_length: usize) -> Vec<&[u8]> {
    let (root, rest) = path.split_at_checked(root_length).unwrap_or((path, b""));
    let mut components: Vec<&[u8]> = vec![root];
    components.extend(strings::split(rest, b"/"));
    if components.len() > 1 && components.last().is_some_and(|last| last.is_empty()) {
        components.pop();
    }
    components
}

fn is_volume_character(char: u8) -> bool {
    char.is_ascii_alphabetic()
}

fn get_file_url_volume_separator_end(url: &[u8], start: usize) -> Option<usize> {
    match url.get(start..) {
        Some([b':', ..]) => Some(start + 1),
        Some([b'%', b'3', b'a' | b'A', ..]) => Some(start + 3),
        _ => None,
    }
}

/// The length of the root of a path: above 0 for a path on disk, the complement of the length for a URL, 0 for a relative path.
fn get_encoded_root_length(path: &[u8]) -> isize {
    let ln = path.len();
    let Some(&ch0) = path.first() else {
        return 0;
    };

    // POSIX or UNC
    if ch0 == b'/' || ch0 == b'\\' {
        if path.get(1) != Some(&ch0) {
            // POSIX: "/" (or non-normalized "\")
            return 1;
        }

        let offset = 2;
        let rest = path.get(offset..).unwrap_or_default();
        let Some(p1) = strings::index_of_char_usize(rest, ch0) else {
            // UNC: "//server" or "\\server"
            return ln.cast_signed();
        };

        // UNC: "//server/" or "\\server\"
        return (p1 + offset + 1).cast_signed();
    }

    // DOS
    if is_volume_character(ch0) && path.get(1) == Some(&b':') {
        let Some(&ch2) = path.get(2) else {
            // DOS: "c:" (but not "c:d")
            return 2;
        };
        if ch2 == b'/' || ch2 == b'\\' {
            // DOS: "c:/" or "c:\"
            return 3;
        }
    }

    // Untitled paths (e.g., "^/untitled/ts-nul-authority/Untitled-1")
    if ch0 == b'^' && path.get(1) == Some(&b'/') {
        // Untitled: "^/"
        return 2;
    }

    // URL
    if let Some(scheme_end) = strings::index_of(path, URL_SCHEME_SEPARATOR) {
        let authority_start = scheme_end + URL_SCHEME_SEPARATOR.len();
        let after_scheme = path.get(authority_start..).unwrap_or_default();
        if let Some(authority_length) = strings::index_of_char_usize(after_scheme, b'/') {
            // URL: "file:///", "file://server/", "file://server/path"
            let authority_end = authority_start + authority_length;

            // For local "file" URLs, include the leading DOS volume (if present).
            let scheme = path.get(..scheme_end).unwrap_or_default();
            let authority = path.get(authority_start..authority_end).unwrap_or_default();
            if scheme == b"file"
                && (authority.is_empty() || authority == b"localhost")
                && ln > authority_end + 2
                && path
                    .get(authority_end + 1)
                    .is_some_and(|&b| is_volume_character(b))
            {
                if let Some(volume_separator_end) =
                    get_file_url_volume_separator_end(path, authority_end + 2)
                {
                    if volume_separator_end == ln {
                        // URL: "file:///c:", "file://localhost/c:", "file:///c%3a", but not "file:///c:d" or "file:///c%3ad"
                        return !volume_separator_end.cast_signed();
                    }
                    if path.get(volume_separator_end) == Some(&b'/') {
                        // URL: "file:///c:/", "file://localhost/c:/", "file:///c%3a/", "file://localhost/c%3a/"
                        return !(volume_separator_end + 1).cast_signed();
                    }
                }
            }
            // URL: "file://server/", "http://server/"
            return !(authority_end + 1).cast_signed();
        }
        // URL: "file://server", "http://server"
        return !ln.cast_signed();
    }

    // relative
    0
}

pub fn get_root_length(path: &[u8]) -> usize {
    let root_length = get_encoded_root_length(path);
    if root_length < 0 {
        return (!root_length).cast_unsigned();
    }
    root_length.cast_unsigned()
}

fn get_path_from_path_components(path_components: &[Vec<u8>]) -> Vec<u8> {
    let Some((root, names)) = path_components.split_first() else {
        return Vec::new();
    };

    let mut result = if root.is_empty() {
        Vec::new()
    } else {
        ensure_trailing_directory_separator(root)
    };
    for (i, name) in names.iter().enumerate() {
        if i > 0 {
            result.push(DIRECTORY_SEPARATOR);
        }
        result.extend_from_slice(name);
    }
    result
}

pub fn normalize_slashes(path: &[u8]) -> Vec<u8> {
    path.iter()
        .map(|&b| if b == b'\\' { DIRECTORY_SEPARATOR } else { b })
        .collect()
}

fn reduce_path_components(components: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut components = components.into_iter();
    let Some(root) = components.next() else {
        return Vec::new();
    };
    let mut reduced = vec![root];
    for component in components {
        if component.is_empty() {
            continue;
        }
        if component == b"." {
            continue;
        }
        if component == b".." {
            if reduced.len() > 1 {
                if reduced.last().is_some_and(|last| last != b"..") {
                    reduced.pop();
                    continue;
                }
            } else if reduced.first().is_some_and(|root| !root.is_empty()) {
                continue;
            }
        }
        reduced.push(component);
    }
    reduced
}

/// The absolute form of a file name, with forward slashes and without `.`, `..` and a separator at the end.
pub fn get_normalized_absolute_path(file_name: &[u8], current_directory: &[u8]) -> Vec<u8> {
    let root_length = get_root_length(file_name);
    let file_name = if root_length == 0 && !current_directory.is_empty() {
        combine_paths(current_directory, &[file_name])
    } else {
        // `combine_paths` normalizes slashes, so not necessary in other branch
        normalize_slashes(file_name)
    };
    let root_length = get_root_length(&file_name);

    if let Some(simple_normalized) = simple_normalize_path(&file_name) {
        let length = simple_normalized.len();
        if length > root_length {
            return remove_trailing_directory_separator(&simple_normalized).to_vec();
        }
        if length == root_length && root_length != 0 {
            return ensure_trailing_directory_separator(&simple_normalized);
        }
        return simple_normalized;
    }

    let length = file_name.len();
    let root = file_name.get(..root_length).unwrap_or_default();
    // `normalized` is only initialized once `file_name` is determined to be non-normalized; `changed` is set at the same time.
    let mut changed = false;
    let mut normalized: Vec<u8> = Vec::new();
    let mut index = root_length;
    let mut normalized_up_to = index;
    let mut seen_non_dot_dot_segment = root_length != 0;
    while index < length {
        // At beginning of segment
        let mut segment_start = index;
        while file_name.get(index) == Some(&b'/') {
            index += 1;
        }
        if index > segment_start {
            // Seen superfluous separator
            if !changed {
                let end = root_length.max(segment_start.saturating_sub(1));
                normalized.extend_from_slice(file_name.get(..end).unwrap_or_default());
                changed = true;
            }
            if index == length {
                break;
            }
            segment_start = index;
        }
        // Past any superfluous separators
        let after_first = file_name.get(index + 1..).unwrap_or_default();
        let segment_end = match strings::index_of_char_usize(after_first, b'/') {
            Some(offset) => offset + index + 1,
            None => length,
        };
        let segment = file_name
            .get(segment_start..segment_end)
            .unwrap_or_default();
        if segment == b"." {
            // "." segment (skip)
            if !changed {
                normalized.extend_from_slice(file_name.get(..normalized_up_to).unwrap_or_default());
                changed = true;
            }
        } else if segment == b".." {
            // ".." segment
            if !seen_non_dot_dot_segment {
                if changed {
                    if normalized.len() == root_length {
                        normalized.extend_from_slice(b"..");
                    } else {
                        normalized.extend_from_slice(b"/..");
                    }
                } else {
                    normalized_up_to = index + 2;
                }
            } else if !changed {
                let end = match normalized_up_to.checked_sub(1) {
                    Some(before) => {
                        let head = file_name.get(..before).unwrap_or_default();
                        match strings::last_index_of_char(head, b'/') {
                            Some(last_slash) => root_length.max(last_slash),
                            None => root_length,
                        }
                    }
                    None => normalized_up_to,
                };
                normalized.extend_from_slice(file_name.get(..end).unwrap_or_default());
                changed = true;
                seen_non_dot_dot_segment = (normalized.len() != root_length || root_length != 0)
                    && normalized != b".."
                    && !normalized.ends_with(b"/..");
            } else {
                match strings::last_index_of_char(&normalized, b'/') {
                    Some(last_slash) => normalized.truncate(root_length.max(last_slash)),
                    None => {
                        normalized.clear();
                        normalized.extend_from_slice(root);
                    }
                }
                seen_non_dot_dot_segment = (normalized.len() != root_length || root_length != 0)
                    && normalized != b".."
                    && !normalized.ends_with(b"/..");
            }
        } else if changed {
            if normalized.len() != root_length {
                normalized.push(DIRECTORY_SEPARATOR);
            }
            seen_non_dot_dot_segment = true;
            normalized.extend_from_slice(segment);
        } else {
            seen_non_dot_dot_segment = true;
            normalized_up_to = segment_end;
        }
        index = segment_end + 1;
    }
    if changed {
        return normalized;
    }
    if length > root_length {
        return remove_trailing_directory_separators(&file_name).to_vec();
    }
    if length == root_length {
        return ensure_trailing_directory_separator(&file_name);
    }
    file_name
}

fn simple_normalize_path(path: &[u8]) -> Option<Vec<u8>> {
    // Most paths don't require normalization
    if !has_relative_path_segment(path) {
        return Some(path.to_vec());
    }
    // Some paths only require cleanup of `/./` or leading `./`
    let simplified = strings::replace_owned(path, b"/./", b"/");
    let trimmed = simplified.strip_prefix(b"./").unwrap_or(&simplified);
    // If we trimmed a leading "./" and the path now starts with "/", we changed the meaning
    if trimmed != path
        && !has_relative_path_segment(trimmed)
        && !(trimmed != simplified.as_slice() && trimmed.starts_with(b"/"))
    {
        return Some(trimmed.to_vec());
    }
    None
}

/// Reports whether `p` contains ".", "..", "./", "../", "/.", "/..", "//", "/./", or "/../".
fn has_relative_path_segment(p: &[u8]) -> bool {
    if p == b"." || p == b".." {
        return true;
    }

    // Leading "./" OR "../"
    if p.starts_with(b"./") || p.starts_with(b"../") {
        return true;
    }

    // Trailing "/." OR "/.."
    if p.ends_with(b"/.") || p.ends_with(b"/..") {
        return true;
    }

    // Now look for any `//` or `/./` or `/../`
    let mut prev_slash = false;
    // Length of current segment since last slash.
    let mut seg_len: usize = 0;
    // Consecutive dots at start of the current segment; `None`: not only dots.
    let mut dot_count: Option<usize> = Some(0);
    for &c in p {
        if c == b'/' {
            // "//"
            if prev_slash {
                return true;
            }
            // "/./" or "/../"
            if (seg_len == 1 && dot_count == Some(1)) || (seg_len == 2 && dot_count == Some(2)) {
                return true;
            }
            prev_slash = true;
            seg_len = 0;
            dot_count = Some(0);
            continue;
        }

        dot_count = if c == b'.' {
            dot_count.map(|count| count + 1)
        } else {
            None
        };
        seg_len += 1;
        prev_slash = false;
    }

    // Trailing "/." or "/.."
    (seg_len == 1 && dot_count == Some(1)) || (seg_len == 2 && dot_count == Some(2))
}

fn remove_trailing_directory_separator(path: &[u8]) -> &[u8] {
    match path.split_last() {
        Some((&last, rest)) if is_any_directory_separator(last) => rest,
        _ => path,
    }
}

fn remove_trailing_directory_separators(mut path: &[u8]) -> &[u8] {
    while has_trailing_directory_separator(path) {
        path = remove_trailing_directory_separator(path);
    }
    path
}

fn ensure_trailing_directory_separator(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    if !has_trailing_directory_separator(&path) {
        path.push(DIRECTORY_SEPARATOR);
    }
    path
}

fn get_path_components_relative_to(
    from: &[u8],
    to: &[u8],
    options: ComparePathsOptions<'_>,
) -> Vec<Vec<u8>> {
    let from_components =
        reduce_path_components(get_path_components(from, options.current_directory));
    let to_components = reduce_path_components(get_path_components(to, options.current_directory));

    let mut start = 0;
    let string_equaler = options.get_equality_comparer();
    for (from_component, to_component) in from_components.iter().zip(&to_components) {
        if start == 0 {
            if !equate_string_case_insensitive(from_component, to_component) {
                break;
            }
        } else if !string_equaler(from_component, to_component) {
            break;
        }
        start += 1;
    }

    if start == 0 {
        return to_components;
    }

    let num_dot_dot_slashes = from_components.len() - start;
    let mut result: Vec<Vec<u8>> = vec![Vec::new()];
    // Add all the relative components until we hit a common directory.
    result.extend((0..num_dot_dot_slashes).map(|_| b"..".to_vec()));
    // Now add all the remaining components of the "to" path.
    result.extend(to_components.into_iter().skip(start));
    result
}

/// The name that a diagnostic prints: relative to the current directory when both are on one disk root.
pub fn convert_to_relative_path(
    absolute_or_relative_path: &[u8],
    options: ComparePathsOptions<'_>,
) -> Vec<u8> {
    if !is_rooted_disk_path(absolute_or_relative_path) {
        return absolute_or_relative_path.to_vec();
    }

    get_relative_path_to_directory_or_url(
        options.current_directory,
        absolute_or_relative_path,
        false,
        options,
    )
}

fn get_relative_path_to_directory_or_url(
    directory_path_or_url: &[u8],
    relative_or_absolute_path: &[u8],
    is_absolute_path_an_url: bool,
    options: ComparePathsOptions<'_>,
) -> Vec<u8> {
    let mut path_components =
        get_path_components_relative_to(directory_path_or_url, relative_or_absolute_path, options);

    if let Some(first_component) = path_components.first_mut() {
        if is_absolute_path_an_url && is_rooted_disk_path(first_component) {
            let prefix: &[u8] = if first_component.first() == Some(&DIRECTORY_SEPARATOR) {
                b"file://"
            } else {
                b"file:///"
            };
            *first_component = [prefix, first_component.as_slice()].concat();
        }
    }

    get_path_from_path_components(&path_components)
}

#[derive(Clone, Copy)]
pub struct ComparePathsOptions<'a> {
    pub use_case_sensitive_file_names: bool,
    pub current_directory: &'a [u8],
}

impl ComparePathsOptions<'_> {
    fn get_equality_comparer(self) -> fn(&[u8], &[u8]) -> bool {
        get_string_equality_comparer(!self.use_case_sensitive_file_names)
    }
}

/// `EquateStringCaseInsensitive` of `internal/stringutil/compare.go`: equal under simple Unicode case folding, as `strings.EqualFold` of Go.
fn equate_string_case_insensitive(a: &[u8], b: &[u8]) -> bool {
    let (mut a, mut b) = (a, b);
    loop {
        let (ar, a_size) = decode_rune_in_string(a);
        let (br, b_size) = decode_rune_in_string(b);
        if a_size == 0 || b_size == 0 {
            return a_size == b_size;
        }
        if ar != br && simple_fold_key(ar) != simple_fold_key(br) {
            return false;
        }
        a = a.get(a_size..).unwrap_or_default();
        b = b.get(b_size..).unwrap_or_default();
    }
}

fn equate_string_case_sensitive(a: &[u8], b: &[u8]) -> bool {
    a == b
}

fn get_string_equality_comparer(ignore_case: bool) -> fn(&[u8], &[u8]) -> bool {
    if ignore_case {
        equate_string_case_insensitive
    } else {
        equate_string_case_sensitive
    }
}

/// The smallest of the code points that `unicode.SimpleFold` of Go reaches from `r`: the same for two code points that differ only in case.
fn simple_fold_key(r: char) -> u32 {
    if r.is_ascii() {
        return u32::from(r.to_ascii_uppercase());
    }
    let r = u32::from(r);
    let i = SIMPLE_FOLD.partition_point(|&(_, hi, _, _)| hi < r);
    match SIMPLE_FOLD.get(i) {
        Some(&(lo, _, stride, key)) if lo <= r && (r - lo).is_multiple_of(stride) => key + (r - lo),
        _ => r,
    }
}

/// Simple case folding of Unicode 15.0.0, the edition of the Go release that the reference requires: each `(lo, hi, stride, key)` folds `lo..=hi`, every `stride`-th code point, to the run that starts at `key`.
#[rustfmt::skip]
static SIMPLE_FOLD: [(u32, u32, u32, u32); 209] = [
    (0x00E0, 0x00F6, 1, 0x00C0), (0x00F8, 0x00FE, 1, 0x00D8), (0x0101, 0x012F, 2, 0x0100),
    (0x0133, 0x0137, 2, 0x0132), (0x013A, 0x0148, 2, 0x0139), (0x014B, 0x0177, 2, 0x014A),
    (0x0178, 0x0178, 1, 0x00FF), (0x017A, 0x017E, 2, 0x0179), (0x017F, 0x017F, 1, 0x0053),
    (0x0183, 0x0185, 2, 0x0182), (0x0188, 0x0188, 1, 0x0187), (0x018C, 0x018C, 1, 0x018B),
    (0x0192, 0x0192, 1, 0x0191), (0x0199, 0x0199, 1, 0x0198), (0x01A1, 0x01A5, 2, 0x01A0),
    (0x01A8, 0x01A8, 1, 0x01A7), (0x01AD, 0x01AD, 1, 0x01AC), (0x01B0, 0x01B0, 1, 0x01AF),
    (0x01B4, 0x01B6, 2, 0x01B3), (0x01B9, 0x01B9, 1, 0x01B8), (0x01BD, 0x01BD, 1, 0x01BC),
    (0x01C5, 0x01C5, 1, 0x01C4), (0x01C6, 0x01C6, 1, 0x01C4), (0x01C8, 0x01C8, 1, 0x01C7),
    (0x01C9, 0x01C9, 1, 0x01C7), (0x01CB, 0x01CB, 1, 0x01CA), (0x01CC, 0x01CC, 1, 0x01CA),
    (0x01CE, 0x01DC, 2, 0x01CD), (0x01DD, 0x01DD, 1, 0x018E), (0x01DF, 0x01EF, 2, 0x01DE),
    (0x01F2, 0x01F2, 1, 0x01F1), (0x01F3, 0x01F3, 1, 0x01F1), (0x01F5, 0x01F5, 1, 0x01F4),
    (0x01F6, 0x01F6, 1, 0x0195), (0x01F7, 0x01F7, 1, 0x01BF), (0x01F9, 0x021F, 2, 0x01F8),
    (0x0220, 0x0220, 1, 0x019E), (0x0223, 0x0233, 2, 0x0222), (0x023C, 0x023C, 1, 0x023B),
    (0x023D, 0x023D, 1, 0x019A), (0x0242, 0x0242, 1, 0x0241), (0x0243, 0x0243, 1, 0x0180),
    (0x0247, 0x024F, 2, 0x0246), (0x0253, 0x0253, 1, 0x0181), (0x0254, 0x0254, 1, 0x0186),
    (0x0256, 0x0257, 1, 0x0189), (0x0259, 0x0259, 1, 0x018F), (0x025B, 0x025B, 1, 0x0190),
    (0x0260, 0x0260, 1, 0x0193), (0x0263, 0x0263, 1, 0x0194), (0x0268, 0x0268, 1, 0x0197),
    (0x0269, 0x0269, 1, 0x0196), (0x026F, 0x026F, 1, 0x019C), (0x0272, 0x0272, 1, 0x019D),
    (0x0275, 0x0275, 1, 0x019F), (0x0280, 0x0280, 1, 0x01A6), (0x0283, 0x0283, 1, 0x01A9),
    (0x0288, 0x0288, 1, 0x01AE), (0x0289, 0x0289, 1, 0x0244), (0x028A, 0x028B, 1, 0x01B1),
    (0x028C, 0x028C, 1, 0x0245), (0x0292, 0x0292, 1, 0x01B7), (0x0371, 0x0373, 2, 0x0370),
    (0x0377, 0x0377, 1, 0x0376), (0x0399, 0x0399, 1, 0x0345), (0x039C, 0x039C, 1, 0x00B5),
    (0x03AC, 0x03AC, 1, 0x0386), (0x03AD, 0x03AF, 1, 0x0388), (0x03B1, 0x03B8, 1, 0x0391),
    (0x03B9, 0x03B9, 1, 0x0345), (0x03BA, 0x03BB, 1, 0x039A), (0x03BC, 0x03BC, 1, 0x00B5),
    (0x03BD, 0x03C1, 1, 0x039D), (0x03C2, 0x03C2, 1, 0x03A3), (0x03C3, 0x03CB, 1, 0x03A3),
    (0x03CC, 0x03CC, 1, 0x038C), (0x03CD, 0x03CE, 1, 0x038E), (0x03D0, 0x03D0, 1, 0x0392),
    (0x03D1, 0x03D1, 1, 0x0398), (0x03D5, 0x03D5, 1, 0x03A6), (0x03D6, 0x03D6, 1, 0x03A0),
    (0x03D7, 0x03D7, 1, 0x03CF), (0x03D9, 0x03EF, 2, 0x03D8), (0x03F0, 0x03F0, 1, 0x039A),
    (0x03F1, 0x03F1, 1, 0x03A1), (0x03F3, 0x03F3, 1, 0x037F), (0x03F4, 0x03F4, 1, 0x0398),
    (0x03F5, 0x03F5, 1, 0x0395), (0x03F8, 0x03F8, 1, 0x03F7), (0x03F9, 0x03F9, 1, 0x03F2),
    (0x03FB, 0x03FB, 1, 0x03FA), (0x03FD, 0x03FF, 1, 0x037B), (0x0430, 0x044F, 1, 0x0410),
    (0x0450, 0x045F, 1, 0x0400), (0x0461, 0x0481, 2, 0x0460), (0x048B, 0x04BF, 2, 0x048A),
    (0x04C2, 0x04CE, 2, 0x04C1), (0x04CF, 0x04CF, 1, 0x04C0), (0x04D1, 0x052F, 2, 0x04D0),
    (0x0561, 0x0586, 1, 0x0531), (0x13F8, 0x13FD, 1, 0x13F0), (0x1C80, 0x1C80, 1, 0x0412),
    (0x1C81, 0x1C81, 1, 0x0414), (0x1C82, 0x1C82, 1, 0x041E), (0x1C83, 0x1C84, 1, 0x0421),
    (0x1C85, 0x1C85, 1, 0x0422), (0x1C86, 0x1C86, 1, 0x042A), (0x1C87, 0x1C87, 1, 0x0462),
    (0x1C90, 0x1CBA, 1, 0x10D0), (0x1CBD, 0x1CBF, 1, 0x10FD), (0x1E01, 0x1E95, 2, 0x1E00),
    (0x1E9B, 0x1E9B, 1, 0x1E60), (0x1E9E, 0x1E9E, 1, 0x00DF), (0x1EA1, 0x1EFF, 2, 0x1EA0),
    (0x1F08, 0x1F0F, 1, 0x1F00), (0x1F18, 0x1F1D, 1, 0x1F10), (0x1F28, 0x1F2F, 1, 0x1F20),
    (0x1F38, 0x1F3F, 1, 0x1F30), (0x1F48, 0x1F4D, 1, 0x1F40), (0x1F59, 0x1F5F, 2, 0x1F51),
    (0x1F68, 0x1F6F, 1, 0x1F60), (0x1F88, 0x1F8F, 1, 0x1F80), (0x1F98, 0x1F9F, 1, 0x1F90),
    (0x1FA8, 0x1FAF, 1, 0x1FA0), (0x1FB8, 0x1FB9, 1, 0x1FB0), (0x1FBA, 0x1FBB, 1, 0x1F70),
    (0x1FBC, 0x1FBC, 1, 0x1FB3), (0x1FBE, 0x1FBE, 1, 0x0345), (0x1FC8, 0x1FCB, 1, 0x1F72),
    (0x1FCC, 0x1FCC, 1, 0x1FC3), (0x1FD8, 0x1FD9, 1, 0x1FD0), (0x1FDA, 0x1FDB, 1, 0x1F76),
    (0x1FE8, 0x1FE9, 1, 0x1FE0), (0x1FEA, 0x1FEB, 1, 0x1F7A), (0x1FEC, 0x1FEC, 1, 0x1FE5),
    (0x1FF8, 0x1FF9, 1, 0x1F78), (0x1FFA, 0x1FFB, 1, 0x1F7C), (0x1FFC, 0x1FFC, 1, 0x1FF3),
    (0x2126, 0x2126, 1, 0x03A9), (0x212A, 0x212A, 1, 0x004B), (0x212B, 0x212B, 1, 0x00C5),
    (0x214E, 0x214E, 1, 0x2132), (0x2170, 0x217F, 1, 0x2160), (0x2184, 0x2184, 1, 0x2183),
    (0x24D0, 0x24E9, 1, 0x24B6), (0x2C30, 0x2C5F, 1, 0x2C00), (0x2C61, 0x2C61, 1, 0x2C60),
    (0x2C62, 0x2C62, 1, 0x026B), (0x2C63, 0x2C63, 1, 0x1D7D), (0x2C64, 0x2C64, 1, 0x027D),
    (0x2C65, 0x2C65, 1, 0x023A), (0x2C66, 0x2C66, 1, 0x023E), (0x2C68, 0x2C6C, 2, 0x2C67),
    (0x2C6D, 0x2C6D, 1, 0x0251), (0x2C6E, 0x2C6E, 1, 0x0271), (0x2C6F, 0x2C6F, 1, 0x0250),
    (0x2C70, 0x2C70, 1, 0x0252), (0x2C73, 0x2C73, 1, 0x2C72), (0x2C76, 0x2C76, 1, 0x2C75),
    (0x2C7E, 0x2C7F, 1, 0x023F), (0x2C81, 0x2CE3, 2, 0x2C80), (0x2CEC, 0x2CEE, 2, 0x2CEB),
    (0x2CF3, 0x2CF3, 1, 0x2CF2), (0x2D00, 0x2D25, 1, 0x10A0), (0x2D27, 0x2D27, 1, 0x10C7),
    (0x2D2D, 0x2D2D, 1, 0x10CD), (0xA641, 0xA649, 2, 0xA640), (0xA64A, 0xA64A, 1, 0x1C88),
    (0xA64B, 0xA64B, 1, 0x1C88), (0xA64D, 0xA66D, 2, 0xA64C), (0xA681, 0xA69B, 2, 0xA680),
    (0xA723, 0xA72F, 2, 0xA722), (0xA733, 0xA76F, 2, 0xA732), (0xA77A, 0xA77C, 2, 0xA779),
    (0xA77D, 0xA77D, 1, 0x1D79), (0xA77F, 0xA787, 2, 0xA77E), (0xA78C, 0xA78C, 1, 0xA78B),
    (0xA78D, 0xA78D, 1, 0x0265), (0xA791, 0xA793, 2, 0xA790), (0xA797, 0xA7A9, 2, 0xA796),
    (0xA7AA, 0xA7AA, 1, 0x0266), (0xA7AB, 0xA7AB, 1, 0x025C), (0xA7AC, 0xA7AC, 1, 0x0261),
    (0xA7AD, 0xA7AD, 1, 0x026C), (0xA7AE, 0xA7AE, 1, 0x026A), (0xA7B0, 0xA7B0, 1, 0x029E),
    (0xA7B1, 0xA7B1, 1, 0x0287), (0xA7B2, 0xA7B2, 1, 0x029D), (0xA7B5, 0xA7C3, 2, 0xA7B4),
    (0xA7C4, 0xA7C4, 1, 0xA794), (0xA7C5, 0xA7C5, 1, 0x0282), (0xA7C6, 0xA7C6, 1, 0x1D8E),
    (0xA7C8, 0xA7CA, 2, 0xA7C7), (0xA7D1, 0xA7D1, 1, 0xA7D0), (0xA7D7, 0xA7D9, 2, 0xA7D6),
    (0xA7F6, 0xA7F6, 1, 0xA7F5), (0xAB53, 0xAB53, 1, 0xA7B3), (0xAB70, 0xABBF, 1, 0x13A0),
    (0xFF41, 0xFF5A, 1, 0xFF21), (0x10428, 0x1044F, 1, 0x10400), (0x104D8, 0x104FB, 1, 0x104B0),
    (0x10597, 0x105A1, 1, 0x10570), (0x105A3, 0x105B1, 1, 0x1057C), (0x105B3, 0x105B9, 1, 0x1058C),
    (0x105BB, 0x105BC, 1, 0x10594), (0x10CC0, 0x10CF2, 1, 0x10C80), (0x118C0, 0x118DF, 1, 0x118A0),
    (0x16E60, 0x16E7F, 1, 0x16E40), (0x1E922, 0x1E943, 1, 0x1E900),
];

#[cfg(test)]
mod tests {
    use bun_core::BStr;

    use super::*;

    #[track_caller]
    fn assert_bytes(got: &[u8], expected: &str) {
        assert_eq!(BStr::new(got), BStr::new(expected.as_bytes()));
    }

    #[test]
    fn a_root_is_on_disk_untitled_or_a_url() {
        // The path, the length of its root, and whether the root is one of a disk.
        let cases: [(&str, usize, bool); 21] = [
            ("/a", 1, true),
            ("\\a", 1, true),
            ("c:", 2, true),
            ("c:/a", 3, true),
            ("c:a", 0, false),
            ("//server/share", 9, true),
            ("//server", 8, true),
            ("^/untitled/a.ts", 2, true),
            ("^", 0, false),
            ("a/b", 0, false),
            ("", 0, false),
            ("file:///a", 8, false),
            ("file:///c:/a", 11, false),
            ("file:///c%3a/a", 13, false),
            ("file:///c:", 10, false),
            ("file://localhost/c:/a", 20, false),
            ("file://server/a", 14, false),
            ("http://server/a", 14, false),
            ("http://server", 13, false),
            ("a://b/c.ts", 3, true),
            ("c:d://x/y", 8, false),
        ];
        for (path, root_length, rooted_disk_path) in cases {
            assert_eq!(get_root_length(path.as_bytes()), root_length, "{path}");
            assert_eq!(
                is_rooted_disk_path(path.as_bytes()),
                rooted_disk_path,
                "{path}"
            );
        }
    }

    #[test]
    fn an_absolute_name_is_normalized_as_the_reference_normalizes_it() {
        // The file name, the current directory, the result.
        let cases: [(&str, &str, &str); 20] = [
            ("a/..", "/proj", "/proj"),
            ("/a/b/", "/proj", "/a/b"),
            ("/", "/proj", "/"),
            ("c:", "/proj", "c:/"),
            ("//server", "/proj", "//server/"),
            ("//server/share/", "/proj", "//server/share"),
            ("..", "", ".."),
            ("a/../..", "", ".."),
            ("../a/..", "", ".."),
            ("./a", "", "a"),
            (".", "", ""),
            ("", "/proj", "/proj"),
            ("a//b/./c/", "", "a/b/c"),
            ("/a/.../b", "", "/a/.../b"),
            ("a.ts", "proj", "proj/a.ts"),
            ("^/a/../../x.ts", "/proj", "^/x.ts"),
            ("http://h/a/../b.ts", "/proj", "http://h/b.ts"),
            ("file:///c:/a/../../b.ts", "/proj", "file:///c:/b.ts"),
            ("a://b/c.ts", "/proj", "a:/b/c.ts"),
            ("..\\..\\..\\a.ts", "C:\\proj\\sub", "C:/a.ts"),
        ];
        for (file_name, current_directory, expected) in cases {
            assert_bytes(
                &get_normalized_absolute_path(file_name.as_bytes(), current_directory.as_bytes()),
                expected,
            );
        }
    }

    #[test]
    fn a_name_is_printed_relative_to_the_current_directory_as_the_reference_prints_it() {
        // The path, the current directory, whether file names are case sensitive, the result.
        let cases: [(&str, &str, bool, &str); 24] = [
            ("/.src/a.ts", "", false, "/.src/a.ts"),
            ("/a/../b.ts", "", false, "/b.ts"),
            ("/a/b.ts/", "", true, "/a/b.ts"),
            ("relative/../a.ts", "/proj", true, "relative/../a.ts"),
            ("/proj/a.ts", "proj", true, "/proj/a.ts"),
            ("C:/proj/a.ts", "c:/proj", true, "a.ts"),
            ("c:/a.ts", "/proj", true, "c:/a.ts"),
            ("/a.ts", "c:/proj", true, "/a.ts"),
            ("//server/share/a.ts", "//Server/share", true, "a.ts"),
            (
                "//server/share/a.ts",
                "//server/Share",
                true,
                "../share/a.ts",
            ),
            ("//server/share/a.ts", "//server/Share", false, "a.ts"),
            ("/\u{e9}/proj/a.ts", "/\u{c9}/proj", false, "a.ts"),
            (
                "/\u{e9}/proj/a.ts",
                "/\u{c9}/proj",
                true,
                "../../\u{e9}/proj/a.ts",
            ),
            ("/\u{212a}/a.ts", "/k", false, "a.ts"),
            ("/\u{1e9e}/a.ts", "/\u{df}", false, "a.ts"),
            ("/\u{3c2}/a.ts", "/\u{3a3}", false, "a.ts"),
            ("/\u{10428}/a.ts", "/\u{10400}", false, "a.ts"),
            ("/\u{131}/a.ts", "/I", false, "../\u{131}/a.ts"),
            ("/\u{130}/a.ts", "/i", false, "../\u{130}/a.ts"),
            ("^/untitled/a/../b.ts", "/proj", true, "^/untitled/b.ts"),
            ("^/a/b.ts", "^/a", true, "b.ts"),
            ("file:///proj/a.ts", "/proj", true, "file:///proj/a.ts"),
            ("http://h/a/../b.ts", "/proj", true, "http://h/a/../b.ts"),
            ("/proj/sub/../a.ts", "/proj/sub", true, "../a.ts"),
        ];
        for (path, current_directory, use_case_sensitive_file_names, expected) in cases {
            let options = ComparePathsOptions {
                use_case_sensitive_file_names,
                current_directory: current_directory.as_bytes(),
            };
            assert_bytes(
                &convert_to_relative_path(path.as_bytes(), options),
                expected,
            );
        }
        // Two bytes that are no valid UTF-8 fold to one replacement character, as in Go.
        let insensitive = ComparePathsOptions {
            use_case_sensitive_file_names: false,
            current_directory: b"/\xFE",
        };
        assert_bytes(
            &convert_to_relative_path(b"/\xFF/a.ts", insensitive),
            "a.ts",
        );
    }

    #[test]
    fn case_is_folded_as_go_folds_it() {
        let equal: [(&str, &str); 12] = [
            ("k", "\u{212a}"),
            ("K", "\u{212a}"),
            ("s", "\u{17f}"),
            ("\u{df}", "\u{1e9e}"),
            ("\u{3c3}", "\u{3c2}"),
            ("\u{1c4}", "\u{1c6}"),
            ("\u{1c5}", "\u{1c6}"),
            ("\u{e5}", "\u{212b}"),
            ("\u{3d1}", "\u{3f4}"),
            ("\u{b5}", "\u{39c}"),
            ("\u{10400}", "\u{10428}"),
            ("", ""),
        ];
        for (a, b) in equal {
            assert!(
                equate_string_case_insensitive(a.as_bytes(), b.as_bytes()),
                "{a} {b}"
            );
            assert!(
                equate_string_case_insensitive(b.as_bytes(), a.as_bytes()),
                "{b} {a}"
            );
        }
        let different: [(&str, &str); 8] = [
            ("\u{df}", "ss"),
            ("\u{130}", "i"),
            ("\u{131}", "I"),
            ("\u{131}", "i"),
            ("a", ""),
            ("ab", "a"),
            ("[", "{"),
            ("@", "`"),
        ];
        for (a, b) in different {
            assert!(
                !equate_string_case_insensitive(a.as_bytes(), b.as_bytes()),
                "{a} {b}"
            );
            assert!(
                !equate_string_case_insensitive(b.as_bytes(), a.as_bytes()),
                "{b} {a}"
            );
        }
        // Every run of the table lies above ASCII, behind the run before it, and has a stride.
        let mut end = 0x7F;
        for (lo, hi, stride, key) in SIMPLE_FOLD {
            assert!(end < lo && lo <= hi && key < lo, "{lo:X}");
            assert!(stride == 1 || (stride == 2 && (hi - lo) % 2 == 0), "{lo:X}");
            end = hi;
        }
    }
}
