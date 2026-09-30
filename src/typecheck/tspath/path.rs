// internal/tspath/path.go
use crate::stringutil::compare::{
    compare_strings_case_insensitive, equate_string_case_insensitive, get_string_comparer,
    get_string_equality_comparer,
};
use crate::stringutil::util::{strings, unicode, utf8};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Path(pub Vec<u8>);

// Internally, we represent paths as strings with '/' as the directory separator. When we make system calls, we expect the host to correctly handle paths in our specified format.
pub const DIRECTORY_SEPARATOR: u8 = b'/';
const URL_SCHEME_SEPARATOR: &[u8] = b"://";

// Determines whether a byte corresponds to `/` or `\`.
fn is_any_directory_separator(char: u8) -> bool {
    char == b'/' || char == b'\\'
}

// Determines whether a path starts with a URL scheme (e.g. starts with `http://`, `ftp://`, `file://`, etc.).
pub fn is_url(path: &[u8]) -> bool {
    get_encoded_root_length(path) < 0
}

// Determines whether a path is an absolute disk path (e.g. starts with `/`, or a dos path like `c:`, `c:\` or `c:/`).
pub fn is_rooted_disk_path(path: &[u8]) -> bool {
    get_encoded_root_length(path) > 0
}

// Determines whether a path consists only of a path root.
pub fn is_disk_path_root(path: &[u8]) -> bool {
    let root_length = get_encoded_root_length(path);
    root_length > 0 && root_length == path.len() as isize
}

// IsDynamicFileName returns true if the file name represents a dynamic/virtual file that doesn't exist on disk (e.g., untitled files with paths like "^/untitled/...").
pub fn is_dynamic_file_name(file_name: &[u8]) -> bool {
    file_name.starts_with(b"^/")
}

// Determines whether a path starts with an absolute path component (i.e. `/`, `c:/`, `file://`, etc.).
pub fn path_is_absolute(path: &[u8]) -> bool {
    get_encoded_root_length(path) != 0
}

pub fn has_trailing_directory_separator(path: &[u8]) -> bool {
    path.last()
        .is_some_and(|&last| is_any_directory_separator(last))
}

// Combines paths. If a path is absolute, it replaces any previous path. Relative paths are not simplified.
pub fn combine_paths(first_path: &[u8], paths: &[&[u8]]) -> Vec<u8> {
    let first_path = normalize_slashes(first_path);

    let mut size = first_path.len() + paths.len();
    for p in paths {
        size += p.len();
    }
    let mut b: Vec<u8> = Vec::with_capacity(size);

    b.extend_from_slice(&first_path);

    // To provide a way to "set" the path, keep track of the start and then slice.
    let mut start: usize = 0;

    for trailing_path in paths {
        if trailing_path.is_empty() {
            continue;
        }
        let trailing_path = normalize_slashes(trailing_path);
        let result = b.get(start..).unwrap_or(&[]);
        if result.is_empty() || get_root_length(&trailing_path) != 0 {
            // `trailingPath` is absolute.
            start = b.len();
            b.extend_from_slice(&trailing_path);
        } else {
            if !has_trailing_directory_separator(result) {
                b.push(DIRECTORY_SEPARATOR);
            }
            b.extend_from_slice(&trailing_path);
        }
    }
    b.drain(..start.min(b.len()));
    b
}

pub fn get_path_components(path: &[u8], current_directory: &[u8]) -> Vec<Vec<u8>> {
    let path = combine_paths(current_directory, &[path]);
    path_components(&path, get_root_length(&path))
}

fn path_components(path: &[u8], root_length: isize) -> Vec<Vec<u8>> {
    let root = strings::slice_to(path, root_length);
    let mut rest = strings::split(strings::slice_from(path, root_length), b"/");
    if rest.last().is_some_and(|last| last.is_empty()) {
        rest.pop();
    }
    let mut components: Vec<Vec<u8>> = Vec::with_capacity(rest.len() + 1);
    components.push(root.to_vec());
    for component in rest {
        components.push(component.to_vec());
    }
    components
}

pub fn is_volume_character(char: u8) -> bool {
    char.is_ascii_lowercase() || char.is_ascii_uppercase()
}

fn get_file_url_volume_separator_end(url: &[u8], start: isize) -> isize {
    if url.len() as isize <= start {
        return -1;
    }
    let ch0 = strings::byte_at(url, start);
    if ch0 == b':' {
        return start + 1;
    }
    if ch0 == b'%' && url.len() as isize > start + 2 && strings::byte_at(url, start + 1) == b'3' {
        let ch2 = strings::byte_at(url, start + 2);
        if ch2 == b'a' || ch2 == b'A' {
            return start + 3;
        }
    }
    -1
}

// The length of the root of a path, or the bitwise complement of that length when the root is that of a URL.
pub fn get_encoded_root_length(path: &[u8]) -> isize {
    let ln = path.len() as isize;
    if ln == 0 {
        return 0;
    }
    let ch0 = strings::byte_at(path, 0);

    // POSIX or UNC
    if ch0 == b'/' || ch0 == b'\\' {
        if ln == 1 || strings::byte_at(path, 1) != ch0 {
            // POSIX: "/" (or non-normalized "\")
            return 1;
        }

        let offset: isize = 2;
        let p1 = strings::index_byte(strings::slice_from(path, offset), ch0);
        if p1 < 0 {
            // UNC: "//server" or "\\server"
            return ln;
        }

        // UNC: "//server/" or "\\server\"
        return p1 + offset + 1;
    }

    // DOS
    if is_volume_character(ch0) && ln > 1 && strings::byte_at(path, 1) == b':' {
        if ln == 2 {
            // DOS: "c:" (but not "c:d")
            return 2;
        }
        let ch2 = strings::byte_at(path, 2);
        if ch2 == b'/' || ch2 == b'\\' {
            // DOS: "c:/" or "c:\"
            return 3;
        }
    }

    // Untitled paths (e.g., "^/untitled/ts-nul-authority/Untitled-1")
    if ch0 == b'^' && ln > 1 && strings::byte_at(path, 1) == b'/' {
        // Untitled: "^/"
        return 2;
    }

    // URL
    let scheme_end = strings::index(path, URL_SCHEME_SEPARATOR);
    if scheme_end != -1 {
        let authority_start = scheme_end + URL_SCHEME_SEPARATOR.len() as isize;
        let authority_length = strings::index(strings::slice_from(path, authority_start), b"/");
        if authority_length != -1 {
            // URL: "file:///", "file://server/", "file://server/path"
            let authority_end = authority_start + authority_length;

            // For local "file" URLs, include the leading DOS volume (if present). Per https://www.ietf.org/rfc/rfc1738.txt, a host of "" or "localhost" is a special case interpreted as "the machine from which the URL is being interpreted".
            let scheme = strings::slice_to(path, scheme_end);
            let authority = strings::slice(path, authority_start, authority_end);
            if scheme == b"file"
                && (authority.is_empty() || authority == b"localhost")
                && ln > authority_end + 2
                && is_volume_character(strings::byte_at(path, authority_end + 1))
            {
                let volume_separator_end =
                    get_file_url_volume_separator_end(path, authority_end + 2);
                if volume_separator_end != -1 {
                    if volume_separator_end == ln {
                        // URL: "file:///c:", "file://localhost/c:", "file:///c$3a", "file://localhost/c%3a" but not "file:///c:d" or "file:///c%3ad"
                        return !volume_separator_end;
                    }
                    if strings::byte_at(path, volume_separator_end) == b'/' {
                        // URL: "file:///c:/", "file://localhost/c:/", "file:///c%3a/", "file://localhost/c%3a/"
                        return !(volume_separator_end + 1);
                    }
                }
            }
            // URL: "file://server/", "http://server/"
            return !(authority_end + 1);
        }
        // URL: "file://server", "http://server"
        return !ln;
    }

    // relative
    0
}

pub fn get_root_length(path: &[u8]) -> isize {
    let root_length = get_encoded_root_length(path);
    if root_length < 0 {
        return !root_length;
    }
    root_length
}

pub fn get_directory_path(path: &[u8]) -> Vec<u8> {
    let path = normalize_slashes(path);

    // If the path provided is itself a root, then return it.
    let root_length = get_root_length(&path);
    if root_length == path.len() as isize {
        return path.into_owned();
    }

    // return the leading portion of the path up to the last (non-terminal) directory separator but not including any trailing directory separator.
    let path = remove_trailing_directory_separator(&path);
    strings::slice_to(path, root_length.max(strings::last_index(path, b"/"))).to_vec()
}

impl Path {
    pub fn get_directory_path(&self) -> Path {
        Path(get_directory_path(&self.0))
    }
}

pub fn get_path_from_path_components<S: AsRef<[u8]>>(path_components: &[S]) -> Vec<u8> {
    let Some((root, rest)) = path_components.split_first() else {
        return Vec::new();
    };

    let mut result = root.as_ref().to_vec();
    if !result.is_empty() {
        result = ensure_trailing_directory_separator(&result);
    }

    result.extend_from_slice(&strings::join(rest, b"/"));
    result
}

pub fn normalize_slashes(path: &[u8]) -> Cow<'_, [u8]> {
    strings::replace_all(path, b"\\", b"/")
}

fn reduce_path_components(components: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut components = components.into_iter();
    let Some(first) = components.next() else {
        return Vec::new();
    };
    let mut reduced: Vec<Vec<u8>> = vec![first];
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

// Combines and resolves paths. If a path is absolute, it replaces any previous path. Any `.` and `..` path components are resolved. Trailing directory separators are preserved.
pub fn resolve_path(path: &[u8], paths: &[&[u8]]) -> Vec<u8> {
    if !paths.is_empty() {
        return normalize_path(&combine_paths(path, paths));
    }
    normalize_path(&normalize_slashes(path))
}

pub fn resolve_tripleslash_reference(module_name: &[u8], containing_file: &[u8]) -> Vec<u8> {
    let base_path = get_directory_path(containing_file);
    if is_rooted_disk_path(module_name) {
        return normalize_path(module_name);
    }
    normalize_path(&combine_paths(&base_path, &[module_name]))
}

pub fn get_normalized_path_components(path: &[u8], current_directory: &[u8]) -> Vec<Vec<u8>> {
    let combined = combine_paths(current_directory, &[path]);
    get_normalized_path_components_from_combined(&combined)
}

fn get_normalized_path_components_from_combined(path: &[u8]) -> Vec<Vec<u8>> {
    let root_length = get_root_length(path);
    // Always include the root component (empty string for relative paths).
    let mut components: Vec<Vec<u8>> = Vec::with_capacity(8);
    components.push(strings::slice_to(path, root_length).to_vec());

    let mut i = usize::try_from(root_length).unwrap_or(0);
    while i < path.len() {
        // Skip directory separators (handles consecutive separators and trailing '/').
        while path.get(i) == Some(&b'/') {
            i += 1;
        }
        if i >= path.len() {
            break;
        }

        let start = i;
        while path.get(i).is_some_and(|&b| b != b'/') {
            i += 1;
        }
        let component = path.get(start..i).unwrap_or(&[]);

        if component.is_empty() || component == b"." {
            continue;
        }
        if component == b".." {
            if components.len() > 1 {
                if components.last().is_some_and(|last| last != b"..") {
                    components.pop();
                    continue;
                }
            } else if components.first().is_some_and(|root| !root.is_empty()) {
                // If this is an absolute path, we can't go above the root.
                continue;
            }
        }

        components.push(component.to_vec());
    }

    components
}

pub fn get_normalized_absolute_path_without_root(
    file_name: &[u8],
    current_directory: &[u8],
) -> Vec<u8> {
    let absolute_path = get_normalized_absolute_path(file_name, current_directory);
    let root_length = get_root_length(&absolute_path);
    strings::slice_from(&absolute_path, root_length).to_vec()
}

// Whether a path that is being normalized has seen a segment that a later ".." removes.
fn seen_non_dot_dot_segment(normalized: &[u8], root_length: isize) -> bool {
    (normalized.len() as isize != root_length || root_length != 0)
        && normalized != b".."
        && !normalized.ends_with(b"/..")
}

pub fn get_normalized_absolute_path(file_name: &[u8], current_directory: &[u8]) -> Vec<u8> {
    let mut root_length = get_root_length(file_name);
    let file_name: Cow<'_, [u8]> = if root_length == 0 && !current_directory.is_empty() {
        Cow::Owned(combine_paths(current_directory, &[file_name]))
    } else {
        // CombinePaths normalizes slashes, so not necessary in other branch
        normalize_slashes(file_name)
    };
    let file_name: &[u8] = &file_name;
    root_length = get_root_length(file_name);

    if let Some(simple_normalized) = simple_normalize_path(file_name) {
        let length = simple_normalized.len() as isize;
        if length > root_length {
            return remove_trailing_directory_separator(&simple_normalized).to_vec();
        }
        if length == root_length && root_length != 0 {
            return ensure_trailing_directory_separator(&simple_normalized);
        }
        return simple_normalized.into_owned();
    }

    let length = file_name.len() as isize;
    let root = strings::slice_to(file_name, root_length);
    // `normalized` is only initialized once `fileName` is determined to be non-normalized. `changed` is set at the same time.
    let mut changed = false;
    let mut normalized: Vec<u8> = Vec::new();
    let mut segment_start: isize;
    let mut index = root_length;
    let mut normalized_up_to = index;
    let mut seen_non_dot_dot = root_length != 0;
    while index < length {
        // At beginning of segment
        segment_start = index;
        let mut ch = strings::byte_at(file_name, index);
        while ch == b'/' {
            index += 1;
            if index < length {
                ch = strings::byte_at(file_name, index);
            } else {
                break;
            }
        }
        if index > segment_start {
            // Seen superfluous separator
            if !changed {
                normalized =
                    strings::slice_to(file_name, root_length.max(segment_start - 1)).to_vec();
                changed = true;
            }
            if index == length {
                break;
            }
            segment_start = index;
        }
        // Past any superfluous separators
        let mut segment_end = strings::index_byte(strings::slice_from(file_name, index + 1), b'/');
        if segment_end == -1 {
            segment_end = length;
        } else {
            segment_end += index + 1;
        }
        let segment_length = segment_end - segment_start;
        if segment_length == 1 && strings::byte_at(file_name, index) == b'.' {
            // "." segment (skip)
            if !changed {
                normalized = strings::slice_to(file_name, normalized_up_to).to_vec();
                changed = true;
            }
        } else if segment_length == 2
            && strings::byte_at(file_name, index) == b'.'
            && strings::byte_at(file_name, index + 1) == b'.'
        {
            // ".." segment
            if !seen_non_dot_dot {
                if changed {
                    if normalized.len() as isize == root_length {
                        normalized.extend_from_slice(b"..");
                    } else {
                        normalized.extend_from_slice(b"/..");
                    }
                } else {
                    normalized_up_to = index + 2;
                }
            } else if !changed {
                if normalized_up_to > 0 {
                    let before = strings::slice_to(file_name, normalized_up_to - 1);
                    let last_slash = strings::last_index_byte(before, b'/');
                    normalized = strings::slice_to(file_name, root_length.max(last_slash)).to_vec();
                } else {
                    normalized = strings::slice_to(file_name, normalized_up_to).to_vec();
                }
                changed = true;
                seen_non_dot_dot = seen_non_dot_dot_segment(&normalized, root_length);
            } else {
                let last_slash = strings::last_index_byte(&normalized, b'/');
                if last_slash != -1 {
                    normalized.truncate(usize::try_from(root_length.max(last_slash)).unwrap_or(0));
                } else {
                    normalized = root.to_vec();
                }
                seen_non_dot_dot = seen_non_dot_dot_segment(&normalized, root_length);
            }
        } else if changed {
            if normalized.len() as isize != root_length {
                normalized.push(b'/');
            }
            seen_non_dot_dot = true;
            normalized.extend_from_slice(strings::slice(file_name, segment_start, segment_end));
        } else {
            seen_non_dot_dot = true;
            normalized_up_to = segment_end;
        }
        index = segment_end + 1;
    }
    if changed {
        return normalized;
    }
    if length > root_length {
        return remove_trailing_directory_separators(file_name).to_vec();
    }
    if length == root_length {
        return ensure_trailing_directory_separator(file_name);
    }
    file_name.to_vec()
}

// None is upstream's `false`: the path needs the full normalization.
fn simple_normalize_path(path: &[u8]) -> Option<Cow<'_, [u8]>> {
    // Most paths don't require normalization
    if !has_relative_path_segment(path) {
        return Some(Cow::Borrowed(path));
    }
    // Some paths only require cleanup of `/./` or leading `./`
    let simplified = strings::replace_all(path, b"/./", b"/");
    let trimmed = strings::trim_prefix(&simplified, b"./");
    if trimmed != path
        && !has_relative_path_segment(trimmed)
        && !(trimmed != &*simplified && trimmed.starts_with(b"/"))
    {
        // If we trimmed a leading "./" and the path now starts with "/", we changed the meaning
        return Some(Cow::Owned(trimmed.to_vec()));
    }
    None
}

// hasRelativePathSegment reports whether p contains ".", "..", "./", "../", "/.", "/..", "//", "/./", or "/../".
fn has_relative_path_segment(p: &[u8]) -> bool {
    let n = p.len();
    if n == 0 {
        return false;
    }

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
    // length of current segment since last slash
    let mut seg_len = 0;
    // consecutive dots at start of the current segment; -1 => not only dots
    let mut dot_count = 0;

    for &c in p {
        if c == b'/' {
            // "//"
            if prev_slash {
                return true;
            }
            // "/./" or "/../"
            if (seg_len == 1 && dot_count == 1) || (seg_len == 2 && dot_count == 2) {
                return true;
            }
            prev_slash = true;
            seg_len = 0;
            dot_count = 0;
            continue;
        }

        if c == b'.' {
            if dot_count >= 0 {
                dot_count += 1;
            }
        } else {
            dot_count = -1;
        }
        seg_len += 1;
        prev_slash = false;
    }

    // Trailing "/." or "/.."
    (seg_len == 1 && dot_count == 1) || (seg_len == 2 && dot_count == 2)
}

pub fn normalize_path(path: &[u8]) -> Vec<u8> {
    let path = normalize_slashes(path);
    if let Some(normalized) = simple_normalize_path(&path) {
        return normalized.into_owned();
    }
    let normalized = get_normalized_absolute_path(&path, b"");
    if !normalized.is_empty() && has_trailing_directory_separator(&path) {
        return ensure_trailing_directory_separator(&normalized);
    }
    normalized
}

pub fn get_canonical_file_name(
    file_name: &[u8],
    use_case_sensitive_file_names: bool,
) -> Cow<'_, [u8]> {
    if use_case_sensitive_file_names {
        return Cow::Borrowed(file_name);
    }
    to_file_name_lower_case(file_name)
}

// TrimFilePathPrefix removes prefix from the start of path, honoring useCaseSensitiveFileNames the same way GetCanonicalFileName does. It returns the remainder of path and true if path starts with prefix; otherwise it returns path unchanged and false. This must not slice path using len(prefix): case-folding can change a string's UTF-8 byte length without changing its rune count.
pub fn trim_file_path_prefix<'a>(
    path: &'a [u8],
    prefix: &[u8],
    use_case_sensitive_file_names: bool,
) -> (&'a [u8], bool) {
    if use_case_sensitive_file_names {
        return strings::cut_prefix(path, prefix);
    }
    let canonical_prefix = get_canonical_file_name(prefix, false);
    if !get_canonical_file_name(path, false).starts_with(&canonical_prefix) {
        return (path, false);
    }
    (
        trim_rune_count(path, utf8::rune_count_in_string(&canonical_prefix)),
        true,
    )
}

// trimRuneCount returns the suffix of s after skipping up to runeCount runes, clamping to the end of s if it has fewer runes than runeCount.
fn trim_rune_count(s: &[u8], rune_count: isize) -> &[u8] {
    let mut i: usize = 0;
    for _ in 0..rune_count {
        if i >= s.len() {
            break;
        }
        let (_, size) = utf8::decode_rune_in_string(s.get(i..).unwrap_or(&[]));
        i += size.max(1);
    }
    s.get(i..).unwrap_or(&[])
}

// We convert the file names to lower case as key for file name on case insensitive file system. While doing so we need to handle special characters (eg \u0130) to ensure that we dont convert it to lower case: its lowercase form has its own upper case form, so a fileName with its lowercase form can exist along side it.
pub fn to_file_name_lower_case(file_name: &[u8]) -> Cow<'_, [u8]> {
    const I_WITH_DOT: u32 = 0x130;

    let mut ascii = true;
    let mut needs_lower = false;
    for &c in file_name {
        if c >= 0x80 {
            ascii = false;
            break;
        }
        if c.is_ascii_uppercase() {
            needs_lower = true;
        }
    }
    if ascii {
        if !needs_lower {
            return Cow::Borrowed(file_name);
        }
        return Cow::Owned(file_name.to_ascii_lowercase());
    }

    strings::map(
        |r| {
            if r == I_WITH_DOT {
                r
            } else {
                unicode::to_lower(r)
            }
        },
        file_name,
    )
}

pub fn to_path(file_name: &[u8], base_path: &[u8], use_case_sensitive_file_names: bool) -> Path {
    let non_canonicalized_path = if is_rooted_disk_path(file_name) {
        normalize_path(file_name)
    } else {
        get_normalized_absolute_path(file_name, base_path)
    };
    Path(
        get_canonical_file_name(&non_canonicalized_path, use_case_sensitive_file_names)
            .into_owned(),
    )
}

pub fn remove_trailing_directory_separator(path: &[u8]) -> &[u8] {
    if has_trailing_directory_separator(path) {
        return path.get(..path.len() - 1).unwrap_or(&[]);
    }
    path
}

impl Path {
    pub fn remove_trailing_directory_separator(&self) -> Path {
        Path(remove_trailing_directory_separator(&self.0).to_vec())
    }
}

pub fn remove_trailing_directory_separators(path: &[u8]) -> &[u8] {
    let mut path = path;
    while has_trailing_directory_separator(path) {
        path = remove_trailing_directory_separator(path);
    }
    path
}

pub fn ensure_trailing_directory_separator(path: &[u8]) -> Vec<u8> {
    let mut result = path.to_vec();
    if !has_trailing_directory_separator(path) {
        result.push(b'/');
    }

    result
}

impl Path {
    pub fn ensure_trailing_directory_separator(&self) -> Path {
        Path(ensure_trailing_directory_separator(&self.0))
    }
}

pub fn get_path_components_relative_to(
    from: &[u8],
    to: &[u8],
    options: ComparePathsOptions<'_>,
) -> Vec<Vec<u8>> {
    let from_components =
        reduce_path_components(get_path_components(from, options.current_directory));
    let to_components = reduce_path_components(get_path_components(to, options.current_directory));

    let mut start: usize = 0;
    let max_common_components = from_components.len().min(to_components.len());
    let string_equaler = options.get_equality_comparer();
    while start < max_common_components {
        let (Some(from_component), Some(to_component)) =
            (from_components.get(start), to_components.get(start))
        else {
            break;
        };
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
    let mut result: Vec<Vec<u8>> =
        Vec::with_capacity(1 + num_dot_dot_slashes + to_components.len() - start);

    result.push(Vec::new());
    // Add all the relative components until we hit a common directory.
    for _ in 0..num_dot_dot_slashes {
        result.push(b"..".to_vec());
    }
    // Now add all the remaining components of the "to" path.
    result.extend(to_components.into_iter().skip(start));

    result
}

// Err is upstream's panic with its message.
pub fn get_relative_path_from_directory(
    from_directory: &[u8],
    to: &[u8],
    options: ComparePathsOptions<'_>,
) -> Result<Vec<u8>, &'static str> {
    if (get_root_length(from_directory) > 0) != (get_root_length(to) > 0) {
        return Err("paths must either both be absolute or both be relative");
    }
    let path_components = get_path_components_relative_to(from_directory, to, options);
    Ok(get_path_from_path_components(&path_components))
}

// Err is upstream's panic: see get_relative_path_from_directory.
pub fn get_relative_path_from_file(
    from: &[u8],
    to: &[u8],
    options: ComparePathsOptions<'_>,
) -> Result<Vec<u8>, &'static str> {
    let relative = get_relative_path_from_directory(&get_directory_path(from), to, options)?;
    Ok(ensure_path_is_non_module_name(&relative))
}

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

pub fn get_relative_path_to_directory_or_url(
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
            first_component.splice(0..0, prefix.iter().copied());
        }
    }

    get_path_from_path_components(&path_components)
}

// Gets the portion of a path following the last (non-terminal) separator (`/`). Semantics align with NodeJS's `path.basename` except that we support URL's as well.
pub fn get_base_file_name(path: &[u8]) -> Vec<u8> {
    let path = normalize_slashes(path);

    // if the path provided is itself the root, then it has no file name.
    let root_length = get_root_length(&path);
    if root_length == path.len() as isize {
        return Vec::new();
    }

    // return the trailing portion of the path starting after the last (non-terminal) directory separator but not including any trailing directory separator.
    let path = remove_trailing_directory_separator(&path);
    let start = get_root_length(path).max(strings::last_index_byte(path, DIRECTORY_SEPARATOR) + 1);
    strings::slice_from(path, start).to_vec()
}

// Gets the file extension for a path. If extensions are provided, gets the file extension for a path, provided it is one of the provided extensions.
pub fn get_any_extension_from_path(
    path: &[u8],
    extensions: &[&[u8]],
    ignore_case: bool,
) -> Vec<u8> {
    // Retrieves any string from the final "." onwards from a base file name. Unlike extensionFromPath, which throws an exception on unrecognized extensions.
    if !extensions.is_empty() {
        return get_any_extension_from_path_worker(
            remove_trailing_directory_separator(path),
            extensions,
            get_string_equality_comparer(ignore_case),
        )
        .to_vec();
    }

    let base_file_name = get_base_file_name(path);
    let extension_index = strings::last_index_byte(&base_file_name, b'.');
    if extension_index >= 0 {
        return strings::slice_from(&base_file_name, extension_index).to_vec();
    }
    Vec::new()
}

pub fn get_longest_extension_from_path<'a>(
    path: &'a [u8],
    extensions: &[&[u8]],
    ignore_case: bool,
) -> &'a [u8] {
    let path = remove_trailing_directory_separator(path);
    let comparer = get_string_equality_comparer(ignore_case);
    let mut longest: &[u8] = b"";
    for extension in extensions {
        if extension.len() > longest.len() {
            let matched = try_get_extension_from_path(path, extension, comparer);
            if !matched.is_empty() {
                longest = matched;
            }
        }
    }
    longest
}

fn get_any_extension_from_path_worker<'a>(
    path: &'a [u8],
    extensions: &[&[u8]],
    string_equality_comparer: fn(&[u8], &[u8]) -> bool,
) -> &'a [u8] {
    for extension in extensions {
        let result = try_get_extension_from_path(path, extension, string_equality_comparer);
        if !result.is_empty() {
            return result;
        }
    }
    b""
}

fn try_get_extension_from_path<'a>(
    path: &'a [u8],
    extension: &[u8],
    string_equality_comparer: fn(&[u8], &[u8]) -> bool,
) -> &'a [u8] {
    let mut dotted: Vec<u8> = Vec::new();
    let extension = if extension.starts_with(b".") {
        extension
    } else {
        dotted.push(b'.');
        dotted.extend_from_slice(extension);
        &dotted
    };
    if path.len() >= extension.len() {
        let path_extension = path.get(path.len() - extension.len()..).unwrap_or(&[]);
        if path_extension.first() == Some(&b'.')
            && string_equality_comparer(path_extension, extension)
        {
            return path_extension;
        }
    }
    b""
}

pub fn path_is_relative(path: &[u8]) -> bool {
    // True if path is ".", "..", or starts with "./", "../", ".\\", or "..\\".

    if path == b"." || path == b".." {
        return true;
    }

    if let [b'.', b'/' | b'\\', ..] = path {
        return true;
    }

    if let [b'.', b'.', b'/' | b'\\', ..] = path {
        return true;
    }

    false
}

// EnsurePathIsNonModuleName ensures a path is either absolute (prefixed with `/` or `c:`) or dot-relative (prefixed with `./` or `../`) so as not to be confused with an unprefixed module name.
pub fn ensure_path_is_non_module_name(path: &[u8]) -> Vec<u8> {
    if !path_is_absolute(path) && !path_is_relative(path) {
        let mut result = Vec::with_capacity(path.len() + 2);
        result.extend_from_slice(b"./");
        result.extend_from_slice(path);
        return result;
    }
    path.to_vec()
}

pub fn is_external_module_name_relative(module_name: &[u8]) -> bool {
    // TypeScript 1.0 spec (April 2014): 11.2.1 An external module name is "relative" if the first term is "." or "..". Update: We also consider a path like `C:\foo.ts` "relative" because we do not search for it in `node_modules` or treat it as an ambient module.
    path_is_relative(module_name) || is_rooted_disk_path(module_name)
}

#[derive(Clone, Copy, Default, Debug)]
pub struct ComparePathsOptions<'a> {
    pub use_case_sensitive_file_names: bool,
    pub current_directory: &'a [u8],
}

impl ComparePathsOptions<'_> {
    pub fn get_comparer(self) -> fn(&[u8], &[u8]) -> isize {
        get_string_comparer(!self.use_case_sensitive_file_names)
    }

    fn get_equality_comparer(self) -> fn(&[u8], &[u8]) -> bool {
        get_string_equality_comparer(!self.use_case_sensitive_file_names)
    }
}

pub fn compare_paths(a: &[u8], b: &[u8], options: ComparePathsOptions<'_>) -> isize {
    let a = combine_paths(options.current_directory, &[a]);
    let b = combine_paths(options.current_directory, &[b]);

    if a == b {
        return 0;
    }
    if a.is_empty() {
        return -1;
    }
    if b.is_empty() {
        return 1;
    }

    // NOTE: Performance optimization - shortcut if the root segments differ as there would be no need to perform path reduction.
    let a_root = strings::slice_to(&a, get_root_length(&a));
    let b_root = strings::slice_to(&b, get_root_length(&b));
    let result = compare_strings_case_insensitive(a_root, b_root);
    if result != 0 {
        return result;
    }

    // NOTE: Performance optimization - shortcut if there are no relative path segments in the non-root portion of the path
    let a_rest = a.get(a_root.len()..).unwrap_or(&[]);
    let b_rest = b.get(b_root.len()..).unwrap_or(&[]);
    if !has_relative_path_segment(a_rest) && !has_relative_path_segment(b_rest) {
        return options.get_comparer()(a_rest, b_rest);
    }

    // The path contains a relative path segment. Normalize the paths and perform a slower component by component comparison.
    let a_components = reduce_path_components(get_path_components(&a, b""));
    let b_components = reduce_path_components(get_path_components(&b, b""));
    for (a_component, b_component) in a_components.iter().zip(b_components.iter()).skip(1) {
        let result = options.get_comparer()(a_component, b_component);
        if result != 0 {
            return result;
        }
    }
    let (a_length, b_length) = (a_components.len(), b_components.len());
    isize::from(a_length > b_length) - isize::from(a_length < b_length)
}

pub fn compare_paths_case_sensitive(a: &[u8], b: &[u8], current_directory: &[u8]) -> isize {
    compare_paths(
        a,
        b,
        ComparePathsOptions {
            use_case_sensitive_file_names: true,
            current_directory,
        },
    )
}

pub fn compare_paths_case_insensitive(a: &[u8], b: &[u8], current_directory: &[u8]) -> isize {
    compare_paths(
        a,
        b,
        ComparePathsOptions {
            use_case_sensitive_file_names: false,
            current_directory,
        },
    )
}

pub fn contains_path(parent: &[u8], child: &[u8], options: ComparePathsOptions<'_>) -> bool {
    let parent = combine_paths(options.current_directory, &[parent]);
    let child = combine_paths(options.current_directory, &[child]);
    if parent.is_empty() || child.is_empty() {
        return false;
    }
    if parent == child {
        return true;
    }
    let parent_components = reduce_path_components(get_path_components(&parent, b""));
    let child_components = reduce_path_components(get_path_components(&child, b""));
    if child_components.len() < parent_components.len() {
        return false;
    }

    let component_comparer = options.get_equality_comparer();
    for (i, (parent_component, child_component)) in parent_components
        .iter()
        .zip(child_components.iter())
        .enumerate()
    {
        let comparer = if i == 0 {
            equate_string_case_insensitive
        } else {
            component_comparer
        };
        if !comparer(parent_component, child_component) {
            return false;
        }
    }

    true
}

impl Path {
    // ContainsPath checks whether child is contained within or equal to p. Since Path values are already rooted, reduced, and case-canonicalized, this is a simple string prefix check.
    pub fn contains_path(&self, child: &Path) -> bool {
        let (p, child) = (&self.0, &child.0);
        if p.is_empty() {
            return false;
        }
        p == child
            || child.len() > p.len()
                && child.starts_with(p)
                && (p.last() == Some(&b'/') || child.get(p.len()) == Some(&b'/'))
    }
}

pub fn file_extension_is(path: &[u8], extension: &[u8]) -> bool {
    path.len() > extension.len() && path.ends_with(extension)
}

// Calls `callback` on `directory` and every ancestor directory it has, returning the first defined result. Stops at global cache location. A callback answers Some to stop with that result: None is what upstream returns with `stop` false.
pub fn for_each_ancestor_directory_stopping_at_global_cache<T>(
    global_cache_location: &[u8],
    directory: &[u8],
    mut callback: impl FnMut(&[u8]) -> Option<T>,
) -> Option<T> {
    for_each_ancestor_directory(directory, |ancestor_directory| {
        let result = callback(ancestor_directory);
        if result.is_some() || ancestor_directory == global_cache_location {
            return Some(result);
        }
        None
    })
    .flatten()
}

// None is upstream's `ok` false: no call of the callback asked to stop.
pub fn for_each_ancestor_directory<T>(
    directory: &[u8],
    mut callback: impl FnMut(&[u8]) -> Option<T>,
) -> Option<T> {
    let mut directory = directory.to_vec();
    loop {
        if let Some(result) = callback(&directory) {
            return Some(result);
        }

        let parent_path = get_directory_path(&directory);
        if parent_path == directory {
            return None;
        }

        directory = parent_path;
    }
}

pub fn for_each_ancestor_directory_path<T>(
    directory: &Path,
    mut callback: impl FnMut(&Path) -> Option<T>,
) -> Option<T> {
    for_each_ancestor_directory(&directory.0, |directory| {
        callback(&Path(directory.to_vec()))
    })
}

pub fn has_extension(file_name: &[u8]) -> bool {
    strings::contains(&get_base_file_name(file_name), b".")
}

// The volume in lower case, the rest of the path, and whether the path starts with a volume.
pub fn split_volume_path(path: &[u8]) -> (Vec<u8>, &[u8], bool) {
    if let [volume, b':', rest @ ..] = path {
        if is_volume_character(*volume) {
            return (vec![volume.to_ascii_lowercase(), b':'], rest, true);
        }
    }
    (Vec::new(), path, false)
}

// GetCommonParents returns the smallest set of directories that are parents of all paths with at least `minComponents` directory components. Any path that has fewer than `minComponents` directory components will be returned in the second return value. Err is upstream's panic with its message.
pub fn get_common_parents(
    paths: &[&[u8]],
    min_components: isize,
    get_path_components: impl Fn(&[u8], &[u8]) -> Vec<Vec<u8>>,
    options: ComparePathsOptions<'_>,
) -> Result<(Vec<Vec<u8>>, BTreeSet<Vec<u8>>), &'static str> {
    if min_components < 1 {
        return Err("minComponents must be at least 1");
    }
    let mut ignored: BTreeSet<Vec<u8>> = BTreeSet::new();
    if paths.is_empty() {
        return Ok((Vec::new(), ignored));
    }
    if let [path] = paths {
        let components =
            reduce_path_components(get_path_components(path, options.current_directory));
        if (components.len() as isize) < min_components {
            ignored.insert(path.to_vec());
            return Ok((Vec::new(), ignored));
        }
        return Ok((vec![path.to_vec()], ignored));
    }

    let mut path_components: Vec<Vec<Vec<u8>>> = Vec::with_capacity(paths.len());
    for path in paths {
        let components =
            reduce_path_components(get_path_components(path, options.current_directory));
        if (components.len() as isize) < min_components {
            ignored.insert(path.to_vec());
        } else {
            path_components.push(components);
        }
    }

    let results = get_common_parents_worker(&path_components, min_components, options);
    let result_paths = results
        .iter()
        .map(|comps| get_path_from_path_components(comps))
        .collect();

    Ok((result_paths, ignored))
}

fn get_common_parents_worker(
    component_groups: &[Vec<Vec<u8>>],
    min_components: isize,
    options: ComparePathsOptions<'_>,
) -> Vec<Vec<Vec<u8>>> {
    let Some((first_group, other_groups)) = component_groups.split_first() else {
        return Vec::new();
    };
    // Determine the maximum depth we can consider
    let mut max_depth = first_group.len();
    for comps in other_groups {
        max_depth = max_depth.min(comps.len());
    }

    let equality = options.get_equality_comparer();
    for (last_common_index, candidate) in first_group.iter().enumerate().take(max_depth) {
        for comps in other_groups {
            let same = comps
                .get(last_common_index)
                .is_some_and(|other| equality(candidate, other));
            if same {
                continue;
            }
            // divergence
            if (last_common_index as isize) < min_components {
                // Not enough components, we need to fan out
                let mut ordered_groups: Vec<Path> = Vec::new();
                let mut new_groups: BTreeMap<Path, (Vec<Vec<u8>>, Vec<Vec<Vec<u8>>>)> =
                    BTreeMap::new();
                for g in component_groups {
                    let component = g.get(last_common_index).map_or(&[][..], Vec::as_slice);
                    let key = to_path(
                        component,
                        options.current_directory,
                        options.use_case_sensitive_file_names,
                    );
                    if !new_groups.contains_key(&key) {
                        ordered_groups.push(key.clone());
                    }
                    let head = g.get(..last_common_index + 1).unwrap_or(&[]).to_vec();
                    let tail = g.get(last_common_index + 1..).unwrap_or(&[]).to_vec();
                    let group = new_groups.entry(key).or_default();
                    group.0 = head;
                    group.1.push(tail);
                }
                ordered_groups.sort();
                let mut result: Vec<Vec<Vec<u8>>> = Vec::with_capacity(new_groups.len());
                for key in &ordered_groups {
                    let Some((head, tails)) = new_groups.get(key) else {
                        continue;
                    };
                    let sub_results = get_common_parents_worker(
                        tails,
                        min_components - (last_common_index as isize + 1),
                        options,
                    );
                    for sr in sub_results {
                        let mut parent = head.clone();
                        parent.extend(sr);
                        result.push(parent);
                    }
                }
                return result;
            }
            return vec![first_group.get(..last_common_index).unwrap_or(&[]).to_vec()];
        }
    }

    vec![first_group.get(..max_depth).unwrap_or(&[]).to_vec()]
}

pub fn starts_with_directory(
    file_name: &[u8],
    directory_name: &[u8],
    use_case_sensitive_file_names: bool,
) -> bool {
    if directory_name.is_empty() {
        return false;
    }

    let canonical_file_name = get_canonical_file_name(file_name, use_case_sensitive_file_names);
    let canonical_directory_name =
        get_canonical_file_name(directory_name, use_case_sensitive_file_names);
    let canonical_directory_name = strings::trim_suffix(&canonical_directory_name, b"/");
    let canonical_directory_name = strings::trim_suffix(canonical_directory_name, b"\\");

    match canonical_file_name.strip_prefix(canonical_directory_name) {
        Some(rest) => matches!(rest.first(), Some(b'/' | b'\\')),
        None => false,
    }
}

pub fn compare_number_of_directory_separators(path1: &[u8], path2: &[u8]) -> isize {
    let (count1, count2) = (strings::count(path1, b"/"), strings::count(path2, b"/"));
    isize::from(count1 > count2) - isize::from(count1 < count2)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::tspath::extension::*;

    fn unhex(s: &[u8]) -> Vec<u8> {
        let digit = |b: u8| (b as char).to_digit(16).unwrap() as u8;
        s.as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
            .collect()
    }

    fn h(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            out.push_str(&format!("{b:02x}"));
        }
        out
    }

    fn b(value: bool) -> String {
        String::from(if value { "1" } else { "0" })
    }

    fn list<S: AsRef<[u8]>>(items: &[S]) -> String {
        let hs: Vec<String> = items.iter().map(|item| h(item.as_ref())).collect();
        hs.join(",")
    }

    fn fnv(hash: &mut u64, line: &str) {
        for byte in line.bytes() {
            *hash = (*hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn ancestors(p: &[u8]) -> Vec<Vec<u8>> {
        let mut seen: Vec<Vec<u8>> = Vec::new();
        for_each_ancestor_directory(p, |dir| {
            seen.push(dir.to_vec());
            if seen.len() >= 50 { Some(()) } else { None }
        });
        seen
    }

    // The answers of every one-argument function for a path, in the order in which the vectors were printed.
    pub(crate) fn one(p: &[u8]) -> String {
        let path = Path(p.to_vec());
        let (volume, rest, ok) = split_volume_path(p);
        let exts: [&[u8]; 3] = [b"ts", b".JS", b".d.ts"];
        let change: [&[u8]; 2] = [b".ts", b".JS"];
        let f = [
            b(is_url(p)),
            b(is_rooted_disk_path(p)),
            b(is_disk_path_root(p)),
            b(is_dynamic_file_name(p)),
            b(path_is_absolute(p)),
            b(has_trailing_directory_separator(p)),
            get_encoded_root_length(p).to_string(),
            get_root_length(p).to_string(),
            h(&get_directory_path(p)),
            h(&normalize_slashes(p)),
            h(&normalize_path(p)),
            h(&get_base_file_name(p)),
            h(&get_any_extension_from_path(p, &[], false)),
            h(remove_trailing_directory_separator(p)),
            h(remove_trailing_directory_separators(p)),
            h(&ensure_trailing_directory_separator(p)),
            b(path_is_relative(p)),
            h(&ensure_path_is_non_module_name(p)),
            b(is_external_module_name_relative(p)),
            h(&to_file_name_lower_case(p)),
            b(has_extension(p)),
            h(&volume),
            h(rest),
            b(ok),
            list(&get_path_components(p, b"")),
            list(&get_normalized_path_components(p, b"")),
            h(&get_path_from_path_components(&get_path_components(p, b""))),
            h(&resolve_path(p, &[])),
            h(&get_normalized_absolute_path(p, b"")),
            list(&ancestors(p)),
            h(&path.get_directory_path().0),
            h(&path.remove_trailing_directory_separator().0),
            h(&path.ensure_trailing_directory_separator().0),
            b(extension_is_ts(p)),
            h(remove_file_extension(p)),
            h(remove_any_file_extension(p)),
            h(crate::tspath::extension::try_get_extension_from_path(p)),
            h(try_extract_ts_extension(p)),
            b(has_ts_file_extension(p)),
            b(has_implementation_ts_file_extension(p)),
            b(has_js_file_extension(p)),
            b(has_json_file_extension(p)),
            b(is_declaration_file_name(p)),
            h(&get_declaration_file_extension(p)),
            h(&get_declaration_emit_extension_for_path(p)),
            h(&change_extension(p, b".js")),
            h(&change_extension(p, b"mjs")),
            h(&change_extension(p, b"")),
            h(&change_full_extension(p, b".js")),
            h(&change_full_extension(p, b"cjs")),
            list(&get_possible_original_input_extension_for_extension(p)),
            b(file_extension_is_one_of(p, &[b".ts", b".tsx"])),
            b(extension_is_one_of(p, &[b".ts", b".js"])),
            h(&change_any_extension(p, b".x", &change, true)),
            h(&change_any_extension(p, b".x", &change, false)),
            h(&get_any_extension_from_path(p, &exts, true)),
            h(&get_any_extension_from_path(p, &exts, false)),
            h(get_longest_extension_from_path(
                p,
                &[b".ts", b".d.ts", b"json"],
                true,
            )),
        ];
        f.join("|")
    }

    fn guarded(result: Result<Vec<u8>, &'static str>) -> String {
        match result {
            Ok(path) => h(&path),
            Err(_) => String::from("PANIC"),
        }
    }

    // The answers of every function of two paths, in the order in which the vectors were printed.
    pub(crate) fn two(a: &[u8], c: &[u8]) -> String {
        let cs = ComparePathsOptions {
            use_case_sensitive_file_names: true,
            current_directory: b"",
        };
        let ci = ComparePathsOptions::default();
        let base = ComparePathsOptions {
            use_case_sensitive_file_names: false,
            current_directory: b"/base",
        };
        let mut visited: Vec<Vec<u8>> = Vec::new();
        for_each_ancestor_directory_stopping_at_global_cache(c, a, |dir| {
            visited.push(dir.to_vec());
            if visited.len() >= 50 { Some(()) } else { None }
        });
        let (rest_cs, ok_cs) = trim_file_path_prefix(a, c, true);
        let (rest_ci, ok_ci) = trim_file_path_prefix(a, c, false);
        let relative_to = ComparePathsOptions {
            use_case_sensitive_file_names: false,
            current_directory: c,
        };
        let f = [
            h(&combine_paths(a, &[c])),
            h(&resolve_path(a, &[c])),
            h(&get_normalized_absolute_path(a, c)),
            h(&get_normalized_absolute_path_without_root(a, c)),
            list(&get_path_components(a, c)),
            list(&get_normalized_path_components(a, c)),
            h(&resolve_tripleslash_reference(a, c)),
            h(&to_path(a, c, true).0),
            h(&to_path(a, c, false).0),
            compare_paths(a, c, cs).to_string(),
            compare_paths(a, c, ci).to_string(),
            compare_paths_case_sensitive(a, c, b"/base").to_string(),
            compare_paths_case_insensitive(a, c, b"/base").to_string(),
            b(contains_path(a, c, cs)),
            b(contains_path(a, c, ci)),
            b(contains_path(a, c, base)),
            guarded(get_relative_path_from_directory(a, c, cs)),
            guarded(get_relative_path_from_directory(a, c, ci)),
            guarded(get_relative_path_from_file(a, c, ci)),
            h(&convert_to_relative_path(a, relative_to)),
            h(&get_relative_path_to_directory_or_url(a, c, false, ci)),
            h(&get_relative_path_to_directory_or_url(a, c, true, ci)),
            b(starts_with_directory(a, c, true)),
            b(starts_with_directory(a, c, false)),
            h(rest_cs),
            b(ok_cs),
            h(rest_ci),
            b(ok_ci),
            b(file_extension_is(a, c)),
            compare_number_of_directory_separators(a, c).to_string(),
            b(Path(a.to_vec()).contains_path(&Path(c.to_vec()))),
            h(&get_any_extension_from_path(a, &[c], true)),
            list(&visited),
            list(&get_path_components_relative_to(a, c, ci)),
        ];
        f.join("|")
    }

    fn common_parents(paths: &[&[u8]], min_components: isize, case_sensitive: bool) -> String {
        let options = ComparePathsOptions {
            use_case_sensitive_file_names: case_sensitive,
            current_directory: b"",
        };
        match get_common_parents(paths, min_components, get_path_components, options) {
            Ok((parents, ignored)) => {
                let ignored: Vec<Vec<u8>> = ignored.into_iter().collect();
                format!("{};{}", list(&parents), list(&ignored))
            }
            Err(_) => String::from("PANIC"),
        }
    }

    // Replays upstream's Go code: S is a path and D1 the digest of the `one` lines of all paths, I is an input and D the digest of the `two` lines of every ordered pair of inputs, 3 is three paths with CombinePaths and ResolvePath, P is GetCommonParents.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/path.tsv");
        let mut singles: u64 = 0xcbf2_9ce4_8422_2325;
        let mut inputs: Vec<Vec<u8>> = Vec::new();
        let (mut paths, mut explicit) = (0, 0);
        for line in strings::split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = strings::split(line, b"\t");
            let shown = std::str::from_utf8(line).unwrap();
            let want = std::str::from_utf8(f[f.len() - 1]).unwrap();
            match f[0] {
                b"S" => {
                    let p = unhex(f[1]);
                    fnv(&mut singles, &format!("1\t{}\t{}\n", h(&p), one(&p)));
                    paths += 1;
                }
                b"D1" => assert_eq!(format!("{singles:016x}"), want, "one-argument functions"),
                b"I" => inputs.push(unhex(f[1])),
                b"D" => {
                    let mut pairs: u64 = 0xcbf2_9ce4_8422_2325;
                    for a in &inputs {
                        for c in &inputs {
                            fnv(
                                &mut pairs,
                                &format!("2\t{}\t{}\t{}\n", h(a), h(c), two(a, c)),
                            );
                        }
                    }
                    assert_eq!(format!("{pairs:016x}"), want, "two-argument functions");
                }
                b"3" => {
                    let (p0, p1, p2) = (unhex(f[1]), unhex(f[2]), unhex(f[3]));
                    let got = format!(
                        "{}|{}",
                        h(&combine_paths(&p0, &[&p1, &p2])),
                        h(&resolve_path(&p0, &[&p1, &p2]))
                    );
                    assert_eq!(got, want, "{shown}");
                    explicit += 1;
                }
                b"P" => {
                    let min: isize = std::str::from_utf8(f[1]).unwrap().parse().unwrap();
                    let owned: Vec<Vec<u8>> = strings::split(f[3], b",")
                        .into_iter()
                        .filter(|item| !item.is_empty())
                        .map(unhex)
                        .collect();
                    let borrowed: Vec<&[u8]> = owned.iter().map(Vec::as_slice).collect();
                    assert_eq!(
                        common_parents(&borrowed, min, f[2] == b"1"),
                        want,
                        "{shown}"
                    );
                    explicit += 1;
                }
                other => panic!("unknown vector {other:?}"),
            }
        }
        assert_eq!((paths, inputs.len(), explicit), (418, 43, 45));
    }

    // Upstream appends each sub-result to a head that shares storage with a path's components, and answers /a/b/c, /a/b/c, /f/g/h, /f/g/h here.
    #[test]
    fn common_parents_do_not_share_storage() {
        let paths: [&[u8]; 4] = [b"/a/b/c", b"/a/d/e", b"/f/g/h", b"/f/i/j"];
        let options = ComparePathsOptions::default();
        let (parents, ignored) =
            get_common_parents(&paths, 3, get_path_components, options).unwrap();
        assert_eq!(parents, paths);
        assert!(ignored.is_empty());
    }

    // The examples of upstream's comments.
    #[test]
    fn documented_examples() {
        assert_eq!(
            combine_paths(b"path", &[b"to", b"file.ext"]),
            b"path/to/file.ext"
        );
        assert_eq!(
            combine_paths(b"/path", &[b"/to", b"file.ext"]),
            b"/to/file.ext"
        );
        assert_eq!(
            combine_paths(b"c:/path", &[b"c:/to", b"file.ext"]),
            b"c:/to/file.ext"
        );
        assert_eq!(
            resolve_path(b"/path", &[b"dir", b"..", b"to", b"file.ext"]),
            b"/path/to/file.ext"
        );
        assert_eq!(
            resolve_path(b"/path", &[b"to", b"file.ext/"]),
            b"/path/to/file.ext/"
        );
        assert_eq!(get_base_file_name(b"/path/to/file.ext"), b"file.ext");
        assert_eq!(get_base_file_name(b"c:/path/to/"), b"to");
        assert_eq!(get_base_file_name(b"http://typescriptlang.org"), b"");
        assert_eq!(
            get_any_extension_from_path(b"/path/to/file.ext/", &[], false),
            b".ext"
        );
        assert_eq!(
            get_any_extension_from_path(b"/path/to.ext/file", &[], false),
            b""
        );
        assert_eq!(
            get_any_extension_from_path(b"/path/to/file.js", &[b".ext", b".js"], true),
            b".js"
        );
        assert_eq!(get_encoded_root_length(b"file:///c:/x"), !11);
        assert!(path_is_absolute(b"file:///path/to/file.ext") && !path_is_absolute(b"./path"));
        assert_eq!(
            change_any_extension(b"/path/to/file.ext", b".js", &[b".ext", b".ts"], false),
            b"/path/to/file.js"
        );
        assert_eq!(change_full_extension(b"file.d.ts", b".js"), b"file.js");
        let relative =
            get_relative_path_from_directory(b"/a", b"b", ComparePathsOptions::default());
        assert_eq!(
            relative,
            Err("paths must either both be absolute or both be relative")
        );
    }
}
