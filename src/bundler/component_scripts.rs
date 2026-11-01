//! Finds the scripts of a component: a file of markup and `<script>` blocks that a plugin compiles, such as `.svelte` or `.vue`.

use bun_core::strings;

/// True if `contents` is text that can have a script.
pub(crate) fn has_scripts(path: &[u8], contents: &[u8]) -> bool {
    let is_binary = strings::contains_char(&contents[..contents.len().min(8192)], 0);
    !is_binary && (strings::contains(contents, b"<script") || frontmatter(path, contents).is_some())
}

/// Passes `each` the code of every script of a component.
pub(crate) fn for_each<'a>(path: &[u8], contents: &'a [u8], mut each: impl FnMut(&'a [u8])) {
    if let Some(code) = frontmatter(path, contents) {
        each(code);
    }
    // A script ends at the next `</script`, so each part between two of them is searched by itself.
    let mut rest = contents;
    while !rest.is_empty() {
        let end = strings::index_of(rest, b"</script").unwrap_or(rest.len());
        scripts_before_end_tag(&rest[..end], &mut each);
        rest = &rest[(end + b"</script".len()).min(rest.len())..];
    }
}

/// Each `<script` counts, also in a string, in a comment or in prose: a stray one can add an import.
fn scripts_before_end_tag<'a>(part: &'a [u8], each: &mut impl FnMut(&'a [u8])) {
    // A script runs to the end of the part, and so does a stray `<script` before it: the part gives twice its text in full.
    let mut in_full = part.len() * 2;
    // An attribute value can have a `<script`. The open tag then ends after the next one, and the part gives its text once to find that end.
    let mut past_next = part.len();
    let mut next = strings::index_of(part, b"<script");
    let mut rest = part;
    while let Some(at) = next {
        rest = &rest[at + b"<script".len()..];
        next = strings::index_of(rest, b"<script");
        let until_next = &rest[..next.unwrap_or(rest.len())];
        if let Some(tag_end) = end_of_open_tag(until_next) {
            let to_end = &rest[tag_end + 1..];
            // After that, a script ends at the next `<script`, so the parser gets each byte four times at most for each language.
            if to_end.len() <= in_full {
                in_full -= to_end.len();
                each(to_end);
            } else {
                each(&until_next[tag_end + 1..]);
            }
        } else if next.is_some() && rest.len() <= past_next {
            past_next -= rest.len();
            if let Some(tag_end) = end_of_open_tag(rest) {
                each(&rest[tag_end + 1..]);
            }
        }
    }
}

/// The index of the `>` that ends an open tag. An attribute value can have a `>` between quotes.
fn end_of_open_tag(tag: &[u8]) -> Option<usize> {
    let mut at = 0;
    loop {
        at += strings::index_of_any(&tag[at..], b">\"'")?;
        if tag[at] == b'>' {
            return Some(at);
        }
        at += 2 + strings::index_of_char_usize(&tag[at + 1..], tag[at])?;
    }
}

/// The code between the `---` lines at the top of an Astro component.
fn frontmatter<'a>(path: &[u8], contents: &'a [u8]) -> Option<&'a [u8]> {
    if !path.ends_with(b".astro") {
        return None;
    }
    let code = contents.trim_ascii_start().strip_prefix(b"---")?;
    Some(&code[..strings::index_of(code, b"\n---")?])
}
