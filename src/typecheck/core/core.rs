// internal/core/core.go. Go's zero value of a type is its `Default`, and a function that can return its argument returns a `Cow` that borrows it.
use crate::core::compileroptions::CompilerOptions;
use crate::core::scriptkind::ScriptKind;
use crate::core::text::TextPos;
use crate::stringutil::util::{is_line_break, strings, unicode, utf8, utf16};
use crate::tspath::extension::{
    EXTENSION_CJS, EXTENSION_CTS, EXTENSION_JS, EXTENSION_JSON, EXTENSION_JSX, EXTENSION_MJS,
    EXTENSION_MTS, EXTENSION_TS, EXTENSION_TSX, has_ts_file_extension, is_declaration_file_name,
};
use crate::tspath::path::path_is_relative;
use std::borrow::Cow;
use std::collections::BTreeMap;

pub fn filter<'a, T: Copy>(slice: &'a [T], mut f: impl FnMut(T) -> bool) -> Cow<'a, [T]> {
    for (i, &value) in slice.iter().enumerate() {
        if !f(value) {
            let mut result = slice.get(..i).unwrap_or(&[]).to_vec();
            for &value in slice.get(i + 1..).unwrap_or(&[]) {
                if f(value) {
                    result.push(value);
                }
            }
            return Cow::Owned(result);
        }
    }
    Cow::Borrowed(slice)
}

pub fn filter_seq<'a, T: Copy>(
    slice: &'a [T],
    mut f: impl FnMut(T) -> bool + 'a,
) -> impl Iterator<Item = T> + 'a {
    slice.iter().copied().filter(move |&value| f(value))
}

pub fn filter_index<'a, T: Copy>(
    slice: &'a [T],
    mut f: impl FnMut(T, isize, &[T]) -> bool,
) -> Cow<'a, [T]> {
    for (i, &value) in slice.iter().enumerate() {
        if !f(value, i as isize, slice) {
            let mut result = slice.get(..i).unwrap_or(&[]).to_vec();
            for (j, &value) in slice.iter().enumerate().skip(i + 1) {
                if f(value, j as isize, slice) {
                    result.push(value);
                }
            }
            return Cow::Owned(result);
        }
    }
    Cow::Borrowed(slice)
}

pub fn map<T: Copy, U>(slice: &[T], mut f: impl FnMut(T) -> U) -> Vec<U> {
    let mut result = Vec::with_capacity(slice.len());
    for &value in slice {
        result.push(f(value));
    }
    result
}

pub fn try_map<T: Copy, U, E>(
    slice: &[T],
    mut f: impl FnMut(T) -> Result<U, E>,
) -> Result<Vec<U>, E> {
    let mut result = Vec::with_capacity(slice.len());
    for &value in slice {
        result.push(f(value)?);
    }
    Ok(result)
}

pub fn map_index<T: Copy, U>(slice: &[T], mut f: impl FnMut(T, isize) -> U) -> Vec<U> {
    let mut result = Vec::with_capacity(slice.len());
    for (i, &value) in slice.iter().enumerate() {
        result.push(f(value, i as isize));
    }
    result
}

pub fn map_non_nil<T: Copy, U: Default + PartialEq>(
    slice: &[T],
    mut f: impl FnMut(T) -> U,
) -> Vec<U> {
    let mut result = Vec::new();
    for &value in slice {
        let mapped = f(value);
        if mapped != U::default() {
            result.push(mapped);
        }
    }
    result
}

// The callback answers None where upstream's answers `false`.
pub fn map_filtered<T: Copy, U>(slice: &[T], mut f: impl FnMut(T) -> Option<U>) -> Vec<U> {
    let mut result = Vec::new();
    for &value in slice {
        let Some(mapped) = f(value) else {
            continue;
        };
        result.push(mapped);
    }
    result
}

pub fn flat_map<T: Copy, U>(slice: &[T], mut f: impl FnMut(T) -> Vec<U>) -> Vec<U> {
    let mut result = Vec::new();
    for &value in slice {
        let mapped = f(value);
        if !mapped.is_empty() {
            result.extend(mapped);
        }
    }
    result
}

pub fn same_map<'a, T: Copy + PartialEq>(
    slice: &'a [T],
    mut f: impl FnMut(T) -> T,
) -> Cow<'a, [T]> {
    for (i, &value) in slice.iter().enumerate() {
        let mapped = f(value);
        if mapped != value {
            let mut result = Vec::with_capacity(slice.len());
            result.extend_from_slice(slice.get(..i).unwrap_or(&[]));
            result.push(mapped);
            for &value in slice.get(i + 1..).unwrap_or(&[]) {
                result.push(f(value));
            }
            return Cow::Owned(result);
        }
    }
    Cow::Borrowed(slice)
}

pub fn same_map_index<'a, T: Copy + PartialEq>(
    slice: &'a [T],
    mut f: impl FnMut(T, isize) -> T,
) -> Cow<'a, [T]> {
    for (i, &value) in slice.iter().enumerate() {
        let mapped = f(value, i as isize);
        if mapped != value {
            let mut result = Vec::with_capacity(slice.len());
            result.extend_from_slice(slice.get(..i).unwrap_or(&[]));
            result.push(mapped);
            for (j, &value) in slice.iter().enumerate().skip(i + 1) {
                result.push(f(value, j as isize));
            }
            return Cow::Owned(result);
        }
    }
    Cow::Borrowed(slice)
}

// Whether two slices are the same elements in memory: the test for a result that is its argument.
pub fn same<T>(s1: &[T], s2: &[T]) -> bool {
    if s1.len() == s2.len() {
        return s1.is_empty() || std::ptr::eq(s1.as_ptr(), s2.as_ptr());
    }
    false
}

pub fn some<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> bool {
    for &value in slice {
        if f(value) {
            return true;
        }
    }
    false
}

pub fn every<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> bool {
    for &value in slice {
        if !f(value) {
            return false;
        }
    }
    true
}

pub fn or<'a, T: Copy + 'a>(funcs: &'a [&'a dyn Fn(T) -> bool]) -> impl Fn(T) -> bool + 'a {
    move |input| {
        for f in funcs {
            if f(input) {
                return true;
            }
        }
        false
    }
}

pub fn find<T: Copy + Default>(slice: &[T], mut f: impl FnMut(T) -> bool) -> T {
    for &value in slice {
        if f(value) {
            return value;
        }
    }
    T::default()
}

pub fn find_last<T: Copy + Default>(slice: &[T], mut f: impl FnMut(T) -> bool) -> T {
    for &value in slice.iter().rev() {
        if f(value) {
            return value;
        }
    }
    T::default()
}

pub fn find_index<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> isize {
    for (i, &value) in slice.iter().enumerate() {
        if f(value) {
            return i as isize;
        }
    }
    -1
}

pub fn find_last_index<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> isize {
    for (i, &value) in slice.iter().enumerate().rev() {
        if f(value) {
            return i as isize;
        }
    }
    -1
}

pub fn first_or_nil<T: Copy + Default>(slice: &[T]) -> T {
    slice.first().copied().unwrap_or_default()
}

pub fn last_or_nil<T: Copy + Default>(slice: &[T]) -> T {
    slice.last().copied().unwrap_or_default()
}

// The zero value for an index past the end, and for a negative one, where upstream panics.
pub fn element_or_nil<T: Copy + Default>(slice: &[T], index: isize) -> T {
    usize::try_from(index)
        .ok()
        .and_then(|index| slice.get(index))
        .copied()
        .unwrap_or_default()
}

pub fn first_or_nil_seq<T: Default>(seq: impl IntoIterator<Item = T>) -> T {
    seq.into_iter().next().unwrap_or_default()
}

pub fn first_non_nil<T: Copy, U: Default + PartialEq>(slice: &[T], mut f: impl FnMut(T) -> U) -> U {
    for &value in slice {
        let mapped = f(value);
        if mapped != U::default() {
            return mapped;
        }
    }
    U::default()
}

pub fn first_non_zero<T: Copy + Default + PartialEq>(values: &[T]) -> T {
    let zero = T::default();
    for &value in values {
        if value != zero {
            return value;
        }
    }
    zero
}

pub fn concatenate<'a, T: Copy>(s1: &'a [T], s2: &'a [T]) -> Cow<'a, [T]> {
    if s2.is_empty() {
        return Cow::Borrowed(s1);
    }
    if s1.is_empty() {
        return Cow::Borrowed(s2);
    }
    let mut result = Vec::with_capacity(s1.len() + s2.len());
    result.extend_from_slice(s1);
    result.extend_from_slice(s2);
    Cow::Owned(result)
}

pub fn splice<'a, T: Copy>(
    s1: &'a [T],
    start: isize,
    delete_count: isize,
    items: &[T],
) -> Cow<'a, [T]> {
    let len = s1.len() as isize;
    let mut start = start;
    if start < 0 {
        start = len.saturating_add(start);
    }
    if start < 0 {
        start = 0;
    }
    if start > len {
        start = len;
    }
    let end = start.saturating_add(delete_count.max(0)).min(len);
    if start == end && items.is_empty() {
        return Cow::Borrowed(s1);
    }
    let (start, end) = (start as usize, end as usize);
    let mut result = Vec::with_capacity(start + items.len() + (s1.len() - end));
    result.extend_from_slice(s1.get(..start).unwrap_or(&[]));
    result.extend_from_slice(items);
    result.extend_from_slice(s1.get(end..).unwrap_or(&[]));
    Cow::Owned(result)
}

pub fn count_where<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> isize {
    let mut count = 0;
    for &value in slice {
        if f(value) {
            count += 1;
        }
    }
    count
}

// A copy with one element replaced: an unchanged copy for an index outside the slice, where upstream panics.
pub fn replace_element<T: Copy>(slice: &[T], i: isize, t: T) -> Vec<T> {
    let mut result = slice.to_vec();
    if let Some(element) = usize::try_from(i).ok().and_then(|i| result.get_mut(i)) {
        *element = t;
    }
    result
}

pub fn insert_sorted<T: Copy>(
    slice: Vec<T>,
    element: T,
    mut cmp: impl FnMut(T, T) -> isize,
) -> Vec<T> {
    let mut slice = slice;
    let n = slice.len();
    let (mut i, mut j) = (0, n);
    while i < j {
        let h = (i + j) >> 1;
        if slice.get(h).is_some_and(|&value| cmp(value, element) < 0) {
            i = h + 1;
        } else {
            j = h;
        }
    }
    // slices.BinarySearchFunc compares once more to report whether the element was found.
    if let Some(&value) = slice.get(i) {
        cmp(value, element);
    }
    slice.insert(i.min(n), element);
    slice
}

// MinAllFunc returns all minimum elements from xs according to the comparison function cmp.
pub fn min_all_func<T: Copy>(xs: &[T], mut cmp: impl FnMut(T, T) -> isize) -> Vec<T> {
    let Some((&first, rest)) = xs.split_first() else {
        return Vec::new();
    };

    let mut m = first;
    let mut mins = vec![m];

    for &x in rest {
        let c = cmp(x, m);
        if c < 0 {
            m = x;
            mins.clear();
            mins.push(x);
        } else if c == 0 {
            mins.push(x);
        }
    }

    mins
}

pub fn append_if_unique<T: Copy + PartialEq>(slice: Vec<T>, element: T) -> Vec<T> {
    if slice.contains(&element) {
        return slice;
    }
    let mut slice = slice;
    slice.push(element);
    slice
}

pub fn memoize<T: Clone + Default>(create: impl FnOnce() -> T) -> impl FnMut() -> T {
    let mut create = Some(create);
    let mut value = T::default();
    move || {
        if let Some(create) = create.take() {
            value = create();
        }
        value.clone()
    }
}

// Returns whenTrue if b is true; otherwise, returns whenFalse. IfElse should only be used when branches are either constant or precomputed as both branches will be evaluated regardless as to the value of b.
pub fn if_else<T>(b: bool, when_true: T, when_false: T) -> T {
    if b {
        return when_true;
    }
    when_false
}

// Returns value if value is not the zero value of T; Otherwise, returns defaultValue. OrElse should only be used when defaultValue is constant or precomputed as its argument will be evaluated regardless as to the content of value.
pub fn or_else<T: Default + PartialEq>(value: T, default_value: T) -> T {
    if value != T::default() {
        return value;
    }
    default_value
}

// Returns `a` if `a` is not `nil`; Otherwise, returns `b`. Coalesce is roughly analogous to `??` in JS, except that it non-shortcutting, so it is advised to only use a constant or precomputed value for `b`
pub fn coalesce<T: Default + PartialEq>(a: T, b: T) -> T {
    if a == T::default() { b } else { a }
}

pub type ECMALineStarts = Vec<TextPos>;

pub fn compute_ecma_line_starts(text: &[u8]) -> ECMALineStarts {
    let capacity = usize::try_from(strings::count(text, b"\n")).unwrap_or(0) + 1;
    let mut result = Vec::with_capacity(capacity);
    result.extend(compute_ecma_line_starts_seq(text));
    result
}

pub fn compute_ecma_line_starts_seq(text: &[u8]) -> impl Iterator<Item = TextPos> + '_ {
    let text_pos = |pos: usize| TextPos(i32::try_from(pos).unwrap_or(i32::MAX));
    let mut pos: usize = 0;
    let mut line_start: usize = 0;
    let mut done = false;
    std::iter::from_fn(move || {
        while let Some(&b) = text.get(pos) {
            if u32::from(b) < utf8::RUNE_SELF {
                pos += 1;
                if b == b'\r' && text.get(pos) == Some(&b'\n') {
                    pos += 1;
                }
                if b == b'\r' || b == b'\n' {
                    let start = line_start;
                    line_start = pos;
                    return Some(text_pos(start));
                }
            } else {
                let (ch, size) = utf8::decode_rune_in_string(text.get(pos..).unwrap_or(&[]));
                pos += size.max(1);
                if is_line_break(ch) {
                    let start = line_start;
                    line_start = pos;
                    return Some(text_pos(start));
                }
            }
        }
        if done {
            return None;
        }
        done = true;
        Some(text_pos(line_start))
    })
}

// PositionToLineAndByteOffset returns the 0-based line and byte offset from the start of that line for the given byte position, using the provided line starts. The byte offset is a raw UTF-8 byte offset from the line start, not a UTF-16 code unit count.
pub fn position_to_line_and_byte_offset(
    position: isize,
    line_starts: &[TextPos],
) -> (isize, isize) {
    let after = line_starts.partition_point(|start| start.0 as isize <= position);
    let line = after.saturating_sub(1);
    let line_start = line_starts.get(line).map_or(0, |start| start.0 as isize);
    (line as isize, position.wrapping_sub(line_start))
}

// UTF16Offset represents a character offset measured in UTF-16 code units.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct UTF16Offset(pub isize);

// UTF16Len returns the number of UTF-16 code units needed to represent the given UTF-8 encoded string.
pub fn utf16_len(s: &[u8]) -> UTF16Offset {
    // Fast path: scan for non-ASCII bytes. For ASCII-only strings, each byte is one UTF-16 code unit, so we can return len(s) directly.
    for (i, &b) in s.iter().enumerate() {
        if u32::from(b) >= utf8::RUNE_SELF {
            // Found non-ASCII; count the ASCII prefix, then decode the rest.
            let mut n = i as isize;
            for (_, r) in utf8::range(s.get(i..).unwrap_or(&[])) {
                n += utf16::rune_len(r);
            }
            return UTF16Offset(n);
        }
    }
    UTF16Offset(s.len() as isize)
}

pub fn flatten<T: Copy>(array: &[&[T]]) -> Vec<T> {
    let mut result = Vec::new();
    for sub_array in array {
        result.extend_from_slice(sub_array);
    }
    result
}

pub fn get_script_kind_from_file_name(file_name: &[u8]) -> ScriptKind {
    let dot_pos = strings::last_index(file_name, b".");
    if dot_pos >= 0 {
        let extension = strings::to_lower(strings::slice_from(file_name, dot_pos));
        let extension: &[u8] = &extension;
        if extension == EXTENSION_JS || extension == EXTENSION_CJS || extension == EXTENSION_MJS {
            return ScriptKind::JS;
        }
        if extension == EXTENSION_JSX {
            return ScriptKind::JSX;
        }
        if extension == EXTENSION_TS || extension == EXTENSION_CTS || extension == EXTENSION_MTS {
            return ScriptKind::TS;
        }
        if extension == EXTENSION_TSX {
            return ScriptKind::TSX;
        }
        if extension == EXTENSION_JSON {
            return ScriptKind::JSON;
        }
    }
    ScriptKind::UNKNOWN
}

pub fn get_default_extension_for_script_kind(script_kind: ScriptKind) -> &'static [u8] {
    match script_kind {
        ScriptKind::JS => EXTENSION_JS,
        ScriptKind::JSX => EXTENSION_JSX,
        ScriptKind::TSX => EXTENSION_TSX,
        ScriptKind::JSON => EXTENSION_JSON,
        _ => EXTENSION_TS,
    }
}

// EnsureScriptKindFromFileName is like GetScriptKindFromFileName, but defaults to ScriptKindTS when the file name has no recognized extension (e.g. files included with allowNonTsExtensions), so the result is always safe to hand to the parser.
pub fn ensure_script_kind_from_file_name(file_name: &[u8]) -> ScriptKind {
    let kind = get_script_kind_from_file_name(file_name);
    if kind != ScriptKind::UNKNOWN {
        return kind;
    }
    ScriptKind::TS
}

// Given a name and a list of names that are *not* equal to the name, return a spelling suggestion if there is one that is close enough. Names less than length 3 only check for case-insensitive equality. Find the candidate with the smallest Levenshtein distance, except for candidates with no name, whose length differs from the target name by more than 0.34 of the length of the name, or whose levenshtein distance is more than 0.4 of the length of the name (0.4 allows 1 substitution/transposition for every 5 characters, and 1 insertion/deletion at 3 characters).
pub fn get_spelling_suggestion_exported<T: Copy + Default, N: AsRef<[u8]>>(
    name: &[u8],
    candidates: impl IntoIterator<Item = T>,
    get_name: impl FnMut(T) -> N,
    compare: impl FnMut(T, T) -> isize,
) -> T {
    get_spelling_suggestion(name, candidates, get_name, compare, 0)
}

pub fn get_spelling_suggestion_with_max_candidate_count<T: Copy + Default, N: AsRef<[u8]>>(
    name: &[u8],
    candidates: impl IntoIterator<Item = T>,
    get_name: impl FnMut(T) -> N,
    compare: impl FnMut(T, T) -> isize,
    max_candidates: isize,
) -> T {
    get_spelling_suggestion(name, candidates, get_name, compare, max_candidates)
}

fn get_spelling_suggestion<T: Copy + Default, N: AsRef<[u8]>>(
    name: &[u8],
    candidates: impl IntoIterator<Item = T>,
    mut get_name: impl FnMut(T) -> N,
    mut compare: impl FnMut(T, T) -> isize,
    max_candidates: isize,
) -> T {
    let rune_name = utf8::runes(name);
    let rune_count = rune_name.len() as isize;
    let maximum_length_difference = ((rune_count as f64 * 0.34) as isize).max(2);
    // If the best result is worse than this, don't bother.
    let mut best_distance = (rune_count as f64 * 0.4).floor() + 0.9;
    let mut buffers = LevenshteinBuffers::default();
    let mut best_candidate = T::default();
    let mut has_best = false;
    let mut checked_candidates: isize = 0;
    for candidate in candidates {
        checked_candidates += 1;
        if max_candidates > 0 && checked_candidates > max_candidates {
            return T::default();
        }
        let candidate_name = get_name(candidate);
        let candidate_name = candidate_name.as_ref();
        let candidate_len = candidate_name.len() as isize;
        let max_len = candidate_len.max(rune_count);
        let min_len = candidate_len.min(rune_count);
        if !candidate_name.is_empty() && max_len - min_len <= maximum_length_difference {
            if candidate_name == name {
                continue;
            }
            // Only consider candidates less than 3 characters long when they differ by case. Otherwise, don't bother, since a user would usually notice differences of a 2-character name.
            if candidate_len < 3 && !strings::equal_fold(candidate_name, name) {
                continue;
            }
            let candidate_runes = utf8::runes(candidate_name);
            let distance =
                levenshtein_with_max(&mut buffers, &rune_name, &candidate_runes, best_distance);
            // A distance above the best one is upstream's failed assertion: `levenshteinWithMax` returns -1 instead.
            if distance < 0.0 || distance > best_distance {
                continue;
            }
            if distance < best_distance {
                best_distance = distance;
                best_candidate = candidate;
                has_best = true;
            } else if !has_best || compare(candidate, best_candidate) < 0 {
                best_candidate = candidate;
                has_best = true;
            }
        }
    }
    best_candidate
}

pub fn get_spelling_suggestion_for_strings<'a>(
    name: &[u8],
    candidates: impl IntoIterator<Item = &'a [u8]>,
) -> &'a [u8] {
    get_spelling_suggestion_exported(name, candidates, identity, strings::compare)
}

#[derive(Default)]
struct LevenshteinBuffers {
    previous: Vec<f64>,
    current: Vec<f64>,
}

fn levenshtein_with_max(
    buffers: &mut LevenshteinBuffers,
    s1: &[u32],
    s2: &[u32],
    max_value: f64,
) -> f64 {
    let buffer_size = s2.len() + 1;
    buffers.previous.clear();
    buffers.previous.resize(buffer_size, 0.0);
    buffers.current.clear();
    buffers.current.resize(buffer_size, 0.0);

    let previous = &mut buffers.previous;
    let current = &mut buffers.current;

    let big = max_value + 0.01;
    for (i, value) in previous.iter_mut().enumerate() {
        *value = i as f64;
    }
    for (i, &c1) in s1.iter().enumerate() {
        let i = i + 1;
        let min_j = ((i as f64 - max_value).ceil() as isize).max(1) as usize;
        let max_j = ((max_value + i as f64).floor() as isize).min(s2.len() as isize);
        let mut col_min = i as f64;
        if let Some(first) = current.first_mut() {
            *first = col_min;
        }
        for value in current.iter_mut().take(min_j).skip(1) {
            *value = big;
        }
        let mut j = min_j;
        while j as isize <= max_j {
            let c2 = s2.get(j - 1).copied().unwrap_or(0);
            let diagonal = previous.get(j - 1).copied().unwrap_or(big);
            let substitution_distance = if unicode::to_lower(c1) == unicode::to_lower(c2) {
                diagonal + 0.1
            } else {
                diagonal + 2.0
            };
            let dist = if c1 == c2 {
                diagonal
            } else {
                let above = previous.get(j).copied().unwrap_or(big) + 1.0;
                let left = current.get(j - 1).copied().unwrap_or(big) + 1.0;
                above.min(left.min(substitution_distance))
            };
            if let Some(value) = current.get_mut(j) {
                *value = dist;
            }
            col_min = col_min.min(dist);
            j += 1;
        }
        let filled = usize::try_from(max_j + 1).unwrap_or(0).max(min_j);
        for value in current.iter_mut().skip(filled) {
            *value = big;
        }
        if col_min > max_value {
            // Give up -- everything in this column is > max and it can't get better in future columns.
            return -1.0;
        }
        std::mem::swap(previous, current);
    }
    let res = previous.get(s2.len()).copied().unwrap_or(big);
    if res > max_value {
        return -1.0;
    }
    res
}

pub fn identity<T>(t: T) -> T {
    t
}

// Err is upstream's panic, with the message it is given: an element is the zero value.
pub fn check_each_defined<'a, T: Copy + Default + PartialEq>(
    s: &'a [T],
    msg: &'static str,
) -> Result<&'a [T], &'static str> {
    for &value in s {
        if value == T::default() {
            return Err(msg);
        }
    }
    Ok(s)
}

// The index of `pattern` at or after `start_index`, -1 without one, and for a start outside the string, where upstream panics.
pub fn index_after(s: &[u8], pattern: &[u8], start_index: isize) -> isize {
    if start_index < 0 || start_index > s.len() as isize {
        return -1;
    }
    let matched = strings::index(strings::slice_from(s, start_index), pattern);
    if matched == -1 {
        return -1;
    }
    matched + start_index
}

pub fn should_rewrite_module_specifier(
    specifier: &[u8],
    compiler_options: &CompilerOptions,
) -> bool {
    compiler_options
        .rewrite_relative_import_extensions
        .is_true()
        && path_is_relative(specifier)
        && !is_declaration_file_name(specifier)
        && has_ts_file_extension(specifier)
}

pub fn single_element_slice<T: Copy + Default + PartialEq>(element: T) -> Vec<T> {
    if element == T::default() {
        return Vec::new();
    }
    vec![element]
}

// The sequences one after another: a None stands for upstream's nil sequence.
pub fn concatenate_seq<T, I: IntoIterator<Item = T>>(
    seqs: impl IntoIterator<Item = Option<I>>,
) -> impl Iterator<Item = T> {
    seqs.into_iter().flatten().flatten()
}

// Enumerate returns a sequence of (index, value) pairs from the input sequence.
pub fn enumerate<T>(seq: impl IntoIterator<Item = T>) -> impl Iterator<Item = (isize, T)> {
    seq.into_iter().enumerate().map(|(i, v)| (i as isize, v))
}

// UnorderedEqual returns true if s1 and s2 contain the same elements, regardless of order.
pub fn unordered_equal<T: Copy + Ord>(s1: &[T], s2: &[T]) -> bool {
    if s1.len() != s2.len() {
        return false;
    }
    let mut counts: BTreeMap<T, isize> = BTreeMap::new();
    for &v in s1 {
        *counts.entry(v).or_default() += 1;
    }
    for &v in s2 {
        let count = counts.entry(v).or_default();
        *count -= 1;
        if *count < 0 {
            return false;
        }
    }
    true
}

pub fn deduplicate<'a, T: Copy + PartialEq>(slice: &'a [T]) -> Cow<'a, [T]> {
    if slice.len() > 1 {
        for (i, value) in slice.iter().enumerate() {
            if slice.get(..i).is_some_and(|seen| seen.contains(value)) {
                let mut result = slice.get(..i).unwrap_or(&[]).to_vec();
                for &value in slice.get(i + 1..).unwrap_or(&[]) {
                    if !result.contains(&value) {
                        result.push(value);
                    }
                }
                return Cow::Owned(result);
            }
        }
    }
    Cow::Borrowed(slice)
}

pub fn deduplicate_sorted<T: Copy>(
    slice: Vec<T>,
    mut is_equal: impl FnMut(T, T) -> bool,
) -> Vec<T> {
    let mut slice = slice;
    slice.dedup_by(|next, last| is_equal(*last, *next));
    slice
}

// CompareBooleans treats true as greater than false.
pub fn compare_booleans(a: bool, b: bool) -> isize {
    if a && !b {
        return 1;
    } else if !a && b {
        return -1;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::ordered_map::{MapEntry, OrderedMap, new_ordered_map_from_list};
    use crate::core::compileroptions::*;
    use crate::core::languagevariant::LanguageVariant;
    use crate::core::tristate::Tristate;
    use crate::stringutil::util::strings::split;

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

    fn b(value: bool) -> &'static str {
        if value { "1" } else { "0" }
    }

    fn int(field: &[u8]) -> i32 {
        std::str::from_utf8(field).unwrap().parse().unwrap()
    }

    fn ints(field: &[u8]) -> Vec<i32> {
        split(field, b",").into_iter().map(int).collect()
    }

    fn list(items: &[Vec<u8>]) -> String {
        let hs: Vec<String> = items.iter().map(|item| h(item)).collect();
        hs.join(",")
    }

    fn guarded(result: Result<&'static [u8], &'static str>) -> String {
        match result {
            Ok(text) => h(text),
            Err(_) => String::from("PANIC"),
        }
    }

    fn type_roots(options: &CompilerOptions, current_directory: &[u8]) -> String {
        match options.get_effective_type_roots(current_directory) {
            Ok((roots, from_config)) => format!("{} {}", list(&roots), b(from_config)),
            Err(_) => String::from("PANIC"),
        }
    }

    fn options_line(a: u8, c: u8) -> String {
        let (a, c) = (Tristate(a), Tristate(c));
        let o = CompilerOptions {
            strict: a,
            allow_js: a,
            check_js: c,
            isolated_modules: a,
            verbatim_module_syntax: c,
            preserve_const_enums: c,
            incremental: a,
            composite: c,
            declaration: a,
            declaration_map: c,
            allow_importing_ts_extensions: a,
            rewrite_relative_import_extensions: c,
            resolve_package_json_exports: a,
            resolve_package_json_imports: c,
            resolve_json_module: a,
            use_define_for_class_fields: c,
            ..CompilerOptions::default()
        };
        [
            o.get_strict_option_value(c),
            o.get_allow_js(),
            o.get_isolated_modules(),
            o.should_preserve_const_enums(),
            o.is_incremental(),
            o.get_emit_declarations(),
            o.get_are_declaration_maps_enabled(),
            o.get_allow_importing_ts_extensions(),
            o.allow_importing_ts_extensions_from(b"a.d.ts"),
            o.allow_importing_ts_extensions_from(b"a.ts"),
            o.get_resolve_package_json_exports(),
            o.get_resolve_package_json_imports(),
            o.get_resolve_json_module(),
            o.get_emit_standard_class_fields(),
            o.get_use_define_for_class_fields(),
            should_rewrite_module_specifier(b"./a.ts", &o),
            should_rewrite_module_specifier(b"./a.d.ts", &o),
            should_rewrite_module_specifier(b"a.ts", &o),
            should_rewrite_module_specifier(b"../a.js", &o),
        ]
        .iter()
        .map(|&flag| b(flag))
        .collect()
    }

    fn misc_line() -> String {
        let some_paths = || {
            Some(new_ordered_map_from_list(vec![MapEntry {
                key: b"a/*".to_vec(),
                value: vec![b"b/*".to_vec()],
            }]))
        };
        let types = |types: &[&[u8]]| CompilerOptions {
            types: Some(types.iter().map(|name| name.to_vec()).collect()),
            ..CompilerOptions::default()
        };
        let none = CompilerOptions::default();
        let empty_paths = CompilerOptions {
            paths: Some(OrderedMap::default()),
            ..CompilerOptions::default()
        };
        let with_paths = CompilerOptions {
            paths: some_paths(),
            ..CompilerOptions::default()
        };
        let with_base = CompilerOptions {
            paths: some_paths(),
            paths_base_path: b"/base".to_vec(),
            ..CompilerOptions::default()
        };
        let config = |path: &[u8], roots: Option<&[&[u8]]>| CompilerOptions {
            config_file_path: path.to_vec(),
            type_roots: roots.map(|roots| roots.iter().map(|root| root.to_vec()).collect()),
            ..CompilerOptions::default()
        };
        [
            String::from(b(none.uses_wildcard_types())),
            String::from(b(types(&[]).uses_wildcard_types())),
            String::from(b(types(&[b"node", b"*"]).uses_wildcard_types())),
            h(none.get_paths_base_path(b"/cwd")),
            h(empty_paths.get_paths_base_path(b"/cwd")),
            h(with_paths.get_paths_base_path(b"/cwd")),
            h(with_base.get_paths_base_path(b"/cwd")),
            type_roots(&none, b""),
            type_roots(&none, b"/a/b"),
            type_roots(&config(b"c:/x/y/tsconfig.json", None), b""),
            type_roots(&config(b"", Some(&[])), b""),
            type_roots(&config(b"/p/tsconfig.json", Some(&[b"./types"])), b"/q"),
        ]
        .join(" ")
    }

    fn grid_digest(targets: &[i32], modules: &[i32], resolutions: &[i32]) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for &target in targets {
            for &module in modules {
                for &resolution in resolutions {
                    for detection in 0..=3 {
                        let o = CompilerOptions {
                            target: ScriptTarget(target),
                            module: ModuleKind(module),
                            module_resolution: ModuleResolutionKind(resolution),
                            module_detection: ModuleDetectionKind(detection),
                            ..CompilerOptions::default()
                        };
                        let line = format!(
                            "{target} {module} {resolution} {detection}: {} {} {} {} {}{}{}{}\n",
                            o.get_emit_script_target().0,
                            o.get_emit_module_kind().0,
                            o.get_module_resolution_kind().0,
                            o.get_emit_module_detection_kind().0,
                            b(o.get_resolve_json_module()),
                            b(o.has_json_module_emit_enabled()),
                            b(o.get_emit_standard_class_fields()),
                            b(o.get_use_define_for_class_fields()),
                        );
                        for byte in line.bytes() {
                            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
                        }
                    }
                }
            }
        }
        format!("{hash:016x}")
    }

    // Replays upstream's Go code: each line is a question, named by its first word and its arguments, and the answer.
    #[test]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/core.tsv");
        let (mut targets, mut modules, mut resolutions) = (Vec::new(), Vec::new(), Vec::new());
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let (label, want, _) = strings::cut(line, b"\t");
            let f = split(label, b" ");
            let got: String = match f[0] {
                b"K" => {
                    let name = unhex(f[1]);
                    let kind = get_script_kind_from_file_name(&name);
                    format!(
                        "{} {} {} {}",
                        kind.0,
                        ensure_script_kind_from_file_name(&name).0,
                        h(get_default_extension_for_script_kind(kind)),
                        h(&kind.string())
                    )
                }
                b"stringer" => {
                    let i = int(f[1]);
                    [
                        h(&ScriptKind(i).string()),
                        h(&LanguageVariant(i).string()),
                        h(get_default_extension_for_script_kind(ScriptKind(i))),
                        guarded(JsxEmit(i).string()),
                        guarded(ModuleResolutionKind(i).string()),
                        h(NewLineKind(i).get_new_line_character()),
                    ]
                    .join(" ")
                }
                b"tristate" => {
                    let t = Tristate(int(f[1]) as u8);
                    format!(
                        "{} {}{}{}{}{} {} {}",
                        h(&t.string()),
                        b(t.is_true()),
                        b(t.is_true_or_unknown()),
                        b(t.is_false()),
                        b(t.is_false_or_unknown()),
                        b(t.is_unknown()),
                        t.default_if_unknown(Tristate::TRUE).0,
                        h(t.marshal_json())
                    )
                }
                b"kind" => {
                    let m = ModuleKind(int(f[1]));
                    format!(
                        "{} {} {}{}",
                        h(&m.string()),
                        h(&ScriptTarget(m.0).string()),
                        b(m.is_non_node_esm()),
                        b(m.supports_import_attributes())
                    )
                }
                b"newline" => get_new_line_kind(&unhex(f[1])).0.to_string(),
                b"lines" => {
                    let text = unhex(f[1]);
                    let starts = compute_ecma_line_starts(&text);
                    let parts: Vec<String> = starts.iter().map(|s| s.0.to_string()).collect();
                    let length = text.len() as isize;
                    let positions: Vec<String> = [0, 1, 3, length / 2, length, length + 5]
                        .iter()
                        .map(|&position| {
                            let (line, offset) =
                                position_to_line_and_byte_offset(position, &starts);
                            format!("{line}:{offset}")
                        })
                        .collect();
                    format!(
                        "{} {} {}",
                        parts.join(","),
                        utf16_len(&text).0,
                        positions.join(",")
                    )
                }
                b"spell" => {
                    let name = unhex(f[2]);
                    let candidates: Vec<Vec<u8>> =
                        split(f[3], b",").into_iter().map(unhex).collect();
                    let got = get_spelling_suggestion_with_max_candidate_count(
                        &name,
                        candidates.iter().map(Vec::as_slice),
                        identity,
                        strings::compare,
                        int(f[1]) as isize,
                    );
                    h(got)
                }
                b"indexafter" => {
                    index_after(&unhex(f[1]), &unhex(f[2]), int(f[3]) as isize).to_string()
                }
                b"options" => options_line(int(f[1]) as u8, int(f[2]) as u8),
                b"jsx" => {
                    let o = CompilerOptions {
                        jsx: JsxEmit(int(f[1])),
                        ..CompilerOptions::default()
                    };
                    String::from(b(o.get_jsx_transform_enabled()))
                }
                b"misc" => misc_line(),
                b"grid" => match f[1] {
                    b"targets" => {
                        targets = ints(want);
                        continue;
                    }
                    b"modules" => {
                        modules = ints(want);
                        continue;
                    }
                    b"resolutions" => {
                        resolutions = ints(want);
                        continue;
                    }
                    _ => grid_digest(&targets, &modules, &resolutions),
                },
                other => panic!("unknown vector {other:?}"),
            };
            assert_eq!(
                got.as_bytes(),
                want,
                "{}",
                std::str::from_utf8(label).unwrap()
            );
            checked += 1;
        }
        assert_eq!(checked, 151);
        assert_eq!(
            (targets.len(), modules.len(), resolutions.len()),
            (15, 14, 6)
        );
    }

    #[test]
    fn a_result_that_is_its_argument_borrows_it() {
        let xs = [1, 2, 3, 4];
        assert!(same(&filter(&xs, |x| x > 0), &xs));
        assert_eq!(&*filter(&xs, |x| x % 2 == 0), &[2, 4]);
        assert!(!same(&filter(&xs, |x| x < 4), &xs));
        assert_eq!(
            &*filter_index(&xs, |x, i, all| x > 1 && (i as usize) < all.len() - 1),
            &[2, 3]
        );
        assert!(same(&filter_index(&xs, |_, _, _| true), &xs));
        assert!(same(&same_map(&xs, |x| x), &xs));
        assert_eq!(
            &*same_map(&xs, |x| if x == 3 { 30 } else { x }),
            &[1, 2, 30, 4]
        );
        assert!(same(&same_map_index(&xs, |x, _| x), &xs));
        assert_eq!(
            &*same_map_index(&xs, |x, i| x + i as i32 / 2),
            &[1, 2, 4, 5]
        );
        let empty: [i32; 0] = [];
        assert!(same(&concatenate(&xs, &empty), &xs));
        assert!(same(&concatenate(&empty, &xs), &xs));
        assert_eq!(&*concatenate(&xs[..1], &xs[2..]), &[1, 3, 4]);
        assert!(same(&splice(&xs, 2, 0, &[]), &xs));
        assert_eq!(&*splice(&xs, 1, 2, &[9]), &[1, 9, 4]);
        assert_eq!(&*splice(&xs, -1, 5, &[]), &[1, 2, 3]);
        assert_eq!(&*splice(&xs, -9, -1, &[0]), &[0, 1, 2, 3, 4]);
        assert_eq!(&*splice(&xs, 9, 1, &[5]), &[1, 2, 3, 4, 5]);
        assert!(same(&deduplicate(&xs), &xs));
        assert_eq!(&*deduplicate(&[1, 2, 1, 3, 2]), &[1, 2, 3]);
        assert!(same(&empty, &[]) && !same(&xs[..2], &xs[1..3]) && !same(&xs, &xs[..3]));
    }

    #[test]
    fn slice_helpers() {
        let xs = [3, 1, 4, 1, 5];
        assert_eq!(
            filter_seq(&xs, |x| x > 2).collect::<Vec<i32>>(),
            vec![3, 4, 5]
        );
        assert_eq!(map(&xs, |x| x * 2), vec![6, 2, 8, 2, 10]);
        assert_eq!(
            try_map(&xs, |x| if x < 9 { Ok(x) } else { Err(x) }),
            Ok(xs.to_vec())
        );
        assert_eq!(try_map(&xs, |x| if x < 4 { Ok(x) } else { Err(x) }), Err(4));
        assert_eq!(map_index(&xs, |x, i| x + i as i32), vec![3, 2, 6, 4, 9]);
        assert_eq!(map_non_nil(&xs, |x| x - 1), vec![2, 3, 4]);
        assert_eq!(map_filtered(&xs, |x| (x > 1).then_some(x)), vec![3, 4, 5]);
        assert_eq!(
            flat_map(&xs, |x| vec![x; (x % 3) as usize]),
            vec![1, 4, 1, 5, 5]
        );
        assert!(some(&xs, |x| x == 4) && !some(&xs, |x| x == 9));
        assert!(every(&xs, |x| x > 0) && !every(&xs, |x| x > 1));
        let (small, big) = (|x: i32| x < 2, |x: i32| x > 4);
        let funcs: [&dyn Fn(i32) -> bool; 2] = [&small, &big];
        let small_or_big = or(&funcs);
        assert!(small_or_big(1) && small_or_big(5) && !small_or_big(3));
        assert_eq!((find(&xs, |x| x > 3), find(&xs, |x| x > 9)), (4, 0));
        assert_eq!(
            (find_last(&xs, |x| x < 4), find_last(&xs, |x| x > 9)),
            (1, 0)
        );
        assert_eq!(
            (find_index(&xs, |x| x == 1), find_index(&xs, |x| x == 9)),
            (1, -1)
        );
        assert_eq!(
            (
                find_last_index(&xs, |x| x == 1),
                find_last_index(&xs, |x| x == 9)
            ),
            (3, -1)
        );
        assert_eq!(
            (
                first_or_nil(&xs),
                last_or_nil(&xs),
                first_or_nil::<i32>(&[])
            ),
            (3, 5, 0)
        );
        assert_eq!(
            (
                element_or_nil(&xs, 2),
                element_or_nil(&xs, 5),
                element_or_nil(&xs, -1)
            ),
            (4, 0, 0)
        );
        assert_eq!(
            (first_or_nil_seq(xs), first_or_nil_seq(Vec::<i32>::new())),
            (3, 0)
        );
        assert_eq!(first_non_nil(&xs, |x| if x > 3 { x * 10 } else { 0 }), 40);
        assert_eq!(
            (
                first_non_zero(&[0, 0, 7, 8]),
                first_non_zero::<i32>(&[0, 0])
            ),
            (7, 0)
        );
        assert_eq!(
            (count_where(&xs, |x| x == 1), count_where(&xs, |x| x > 9)),
            (2, 0)
        );
        assert_eq!(replace_element(&xs, 1, 9), vec![3, 9, 4, 1, 5]);
        assert_eq!(replace_element(&xs, 7, 9), xs.to_vec());
        let compare = |a: i32, b: i32| (a - b) as isize;
        assert_eq!(insert_sorted(vec![1, 3, 5], 4, compare), vec![1, 3, 4, 5]);
        assert_eq!(insert_sorted(vec![1, 3, 5], 9, compare), vec![1, 3, 5, 9]);
        assert_eq!(insert_sorted(Vec::new(), 2, compare), vec![2]);
        assert_eq!(min_all_func(&xs, compare), vec![1, 1]);
        assert_eq!(min_all_func(&[], compare), Vec::<i32>::new());
        assert_eq!(append_if_unique(vec![1, 2], 2), vec![1, 2]);
        assert_eq!(append_if_unique(vec![1, 2], 3), vec![1, 2, 3]);
        assert_eq!(flatten(&[&xs[..2], &[], &xs[3..]]), vec![3, 1, 1, 5]);
        assert_eq!(single_element_slice(0), Vec::<i32>::new());
        assert_eq!(single_element_slice(7), vec![7]);
        assert_eq!(check_each_defined(&xs, "nil"), Ok(&xs[..]));
        assert_eq!(check_each_defined(&[1, 0], "nil"), Err("nil"));
        assert!(unordered_equal(&xs, &[1, 1, 3, 4, 5]) && !unordered_equal(&xs, &[1, 3, 3, 4, 5]));
        assert!(!unordered_equal(&xs, &xs[1..]));
        assert_eq!(
            deduplicate_sorted(vec![1, 1, 2, 3, 3, 3, 1], |a, b| a == b),
            vec![1, 2, 3, 1]
        );
        assert_eq!(
            deduplicate_sorted(Vec::<i32>::new(), |a, b| a == b),
            Vec::<i32>::new()
        );
        assert_eq!(
            (compare_booleans(true, false), compare_booleans(false, true)),
            (1, -1)
        );
        assert_eq!(
            (compare_booleans(true, true), compare_booleans(false, false)),
            (0, 0)
        );
        assert_eq!((if_else(true, 1, 2), if_else(false, 1, 2)), (1, 2));
        assert_eq!(
            (or_else(0, 5), or_else(3, 5), or_else(&b""[..], b"x")),
            (5, 3, &b"x"[..])
        );
        assert_eq!((coalesce(0, 5), coalesce(3, 5)), (5, 3));
        assert_eq!(identity(7), 7);
        let seqs = [Some(vec![1, 2]), None, Some(vec![3])];
        assert_eq!(concatenate_seq(seqs).collect::<Vec<i32>>(), vec![1, 2, 3]);
        assert_eq!(enumerate(xs).last(), Some((4, 5)));
        let mut calls = 0;
        let mut memoized = memoize(|| {
            calls += 1;
            41 + calls
        });
        assert_eq!((memoized(), memoized()), (42, 42));
        assert!(std::ptr::eq(
            empty_compiler_options(),
            empty_compiler_options()
        ));
    }
}
