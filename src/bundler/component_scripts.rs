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

/// Each `<script` counts, also in a string, in a comment or in prose. One more can add an import, and never hides one.
fn scripts_before_end_tag<'a>(part: &'a [u8], each: &mut impl FnMut(&'a [u8])) {
    let mut is_first = true;
    let mut next = strings::index_of(part, b"<script");
    let mut rest = part;
    while let Some(at) = next {
        rest = &rest[at + b"<script".len()..];
        next = strings::index_of(rest, b"<script");
        let until_next = &rest[..next.unwrap_or(rest.len())];
        if let Some(tag_end) = end_of_open_tag(until_next) {
            // The first script gets all of the part. A later one ends at the next `<script`, so the parser gets each byte twice at most for each language.
            each(if is_first {
                &rest[tag_end + 1..]
            } else {
                &until_next[tag_end + 1..]
            });
            is_first = false;
        }
    }
}

/// The index of the `>` that ends an open tag. An attribute value can have a `>` between quotes.
fn end_of_open_tag(tag: &[u8]) -> Option<usize> {
    let mut quote = None;
    for (at, &byte) in tag.iter().enumerate() {
        match quote {
            Some(open) if open == byte => quote = None,
            Some(_) => {}
            None if byte == b'>' => return Some(at),
            None if byte == b'"' || byte == b'\'' => quote = Some(byte),
            None => {}
        }
    }
    None
}

/// The code between the `---` lines at the top of an Astro component.
fn frontmatter<'a>(path: &[u8], contents: &'a [u8]) -> Option<&'a [u8]> {
    if !path.ends_with(b".astro") {
        return None;
    }
    let code = contents.trim_ascii_start().strip_prefix(b"---")?;
    Some(&code[..strings::index_of(code, b"\n---")?])
}
