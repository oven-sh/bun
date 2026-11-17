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

/// Each `<script` outside an HTML comment counts, also in a string or in prose: a stray one can add an import.
fn scripts_before_end_tag<'a>(part: &'a [u8], each: &mut impl FnMut(&'a [u8])) {
    // A script runs to the end of the part, and so does a stray `<script` before it: the part gives twice its text in full.
    let mut in_full = part.len() * 2;
    // An attribute value can have a `<script`. The open tag then ends after the next one, and the part gives its text once to find that end.
    let mut past_next = part.len();
    let comments_end = strings::last_index_of(part, b"-->");
    let mut next = next_script(part, 0, comments_end);
    while let Some(at) = next {
        let start = at + b"<script".len();
        let rest = &part[start..];
        next = next_script(part, start, comments_end);
        let until_next = &part[start..next.unwrap_or(part.len())];
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

/// The index of the next `<script` in `part` from `from` that is not in an HTML comment. `comments_end` is where the last `-->` is.
fn next_script(part: &[u8], mut from: usize, comments_end: Option<usize>) -> Option<usize> {
    loop {
        let at = from + strings::index_of(&part[from..], b"<script")?;
        let Some(open) = strings::index_of(&part[from..at], b"<!--") else {
            return Some(at);
        };
        let body = from + open + b"<!--".len();
        // A comment that does not end is text.
        if comments_end.is_none_or(|end| end < body) {
            return Some(at);
        }
        from = body + strings::index_of(&part[body..], b"-->")? + b"-->".len();
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
    // The file loader keeps a byte order mark.
    let text = contents
        .strip_prefix(&strings::BOM::UTF8_BYTES)
        .unwrap_or(contents);
    let code = text.trim_ascii_start().strip_prefix(b"---")?;
    Some(&code[..strings::index_of(code, b"\n---")?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scripts<'a>(path: &str, contents: &'a str) -> Vec<&'a str> {
        let mut found = Vec::new();
        for_each(path.as_bytes(), contents.as_bytes(), |code| {
            found.push(core::str::from_utf8(code).unwrap())
        });
        found
    }

    #[test]
    fn takes_each_script_in_full() {
        let rows = [
            (
                "comment",
                "<!-- put the <script> first -->\n<script>\n  import './a';\n</script>\n",
                "\n  import './a';\n",
            ),
            // The strays use up what the part gives in full before the script.
            (
                "comments before a string",
                "<!-- one <script> -->\n<!-- two <script> -->\n<script>\n  const tag = \"<script>\";\n  import './a';\n  export const text = \"a script longer than the text before it\";\n</script>\n",
                "\n  const tag = \"<script>\";\n  import './a';\n  export const text = \"a script longer than the text before it\";\n",
            ),
            (
                "quotes",
                "<script generics='T extends Record<string, number>'>\n  import './a';\n</script>\n",
                "\n  import './a';\n",
            ),
            (
                "string",
                "<script>\n  const tag = \"<script>\";\n  import './a';\n</script>\n",
                "\n  const tag = \"<script>\";\n  import './a';\n",
            ),
            (
                "attribute",
                "<script data-example=\"<script\" >\n  import './a';\n</script>\n",
                "\n  import './a';\n",
            ),
            (
                "second",
                "<script module>\n  export const one = 1;\n</script>\n<script>\n  import './a';\n</script>\n",
                "\n  import './a';\n",
            ),
        ];
        for (row, contents, script) in rows {
            assert!(
                scripts("C.svelte", contents).contains(&script),
                "{row}: {:?}",
                scripts("C.svelte", contents)
            );
        }
    }

    #[test]
    fn takes_astro_frontmatter() {
        assert_eq!(
            scripts("C.astro", "---\r\nimport './a';\r\n---\r\n<p></p>\r\n"),
            ["\r\nimport './a';\r"]
        );
        assert_eq!(
            scripts("C.astro", "\u{FEFF}\n---\nimport './a';\n---\n<p></p>\n"),
            ["\nimport './a';"]
        );
        assert_eq!(
            scripts(
                "C.astro",
                "---\n// --- not the end ---\nimport './a';\n---\n"
            ),
            ["\n// --- not the end ---\nimport './a';"]
        );
        assert!(scripts("C.svelte", "---\nimport './a';\n---\n").is_empty());
    }

    #[test]
    fn has_scripts_only_in_text() {
        assert!(has_scripts(b"C.svelte", b"<script>import './a';</script>"));
        assert!(!has_scripts(b"C.svelte", b"<SCRIPT>import './a';</SCRIPT>"));
        assert!(!has_scripts(b"c.dat", b"\0<script>import './a';</script>"));
        assert!(!has_scripts(b"c.dat", b"import './a';"));
    }

    // Each `<script` that does not end is one more script to try.
    #[test]
    fn gives_each_byte_four_times_at_most() {
        for (line, count) in [
            ("<script>x\n", 10_000),
            ("<script a=\"\n", 40_000),
            ("<!-- <script> -->\n", 10_000),
        ] {
            let contents = line.repeat(count);
            let given: usize = scripts("C.svelte", &contents)
                .iter()
                .map(|code| code.len())
                .sum();
            assert!(given <= 4 * contents.len(), "{line:?}: {given}");
        }
    }
}
