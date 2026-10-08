//! `.editorconfig`, as far as Prettier reads it: the package `editorconfig`, and Prettier's
//! `editorConfigToPrettier`.

use crate::{fs, paths};
use bun_core::strings;
use bun_lint::linter::Glob;

/// `[*.js]` and what follows it.
struct Section {
    glob: Glob,
    /// In lower case.
    properties: Vec<(Vec<u8>, Vec<u8>)>,
}

/// An `.editorconfig`.
pub(crate) struct File {
    /// What the patterns are relative to.
    directory: Vec<u8>,
    /// `root = true`: the files above it do not count.
    pub(crate) is_root: bool,
    sections: Vec<Section>,
}

/// A pattern as one for a path from the directory of the file: `buildFullGlob`.
fn full_glob(pattern: &[u8]) -> Vec<u8> {
    match strings::index_of_char_usize(pattern, b'/') {
        None => [b"**/", pattern].concat(),
        Some(0) => pattern[1..].to_vec(),
        Some(_) => pattern.to_vec(),
    }
}

impl File {
    fn parse(directory: &[u8], text: &[u8]) -> File {
        let mut file = File {
            directory: directory.to_vec(),
            is_root: false,
            sections: Vec::new(),
        };
        for line in strings::split(strings::without_utf8_bom(text), b"\n") {
            let line = line.trim_ascii();
            match line {
                [] | [b'#' | b';', ..] => {}
                [b'[', pattern @ .., b']'] => file.sections.push(Section {
                    glob: Glob::new(&full_glob(pattern)),
                    properties: Vec::new(),
                }),
                line => {
                    let Some(equals) = strings::index_of_any(line, b"=:") else {
                        continue;
                    };
                    let key = line[..equals].trim_ascii().to_ascii_lowercase();
                    let value = line[equals + 1..].trim_ascii().to_ascii_lowercase();
                    match file.sections.last_mut() {
                        Some(section) => section.properties.push((key, value)),
                        None => file.is_root |= key == b"root" && value == b"true",
                    }
                }
            }
        }
        file
    }

    /// The `.editorconfig` in `directory`, if there is one.
    pub(crate) fn read(directory: &[u8]) -> Option<File> {
        Some(File::parse(directory, &fs::read(&paths::join(directory, b".editorconfig")).ok()?))
    }
}

/// The options of Prettier that `files` have for the file at `path`. `files`: from the farthest to
/// the nearest.
pub(crate) fn options_for<'f>(files: impl Iterator<Item = &'f File>, path: &[u8]) -> Vec<(&'static [u8], Vec<u8>)> {
    let mut properties: Vec<(&[u8], &[u8])> = Vec::new();
    for file in files {
        let Some(relative) = paths::inside(&file.directory, path) else {
            continue;
        };
        for section in file.sections.iter().filter(|it| it.glob.matches(relative)) {
            for (key, value) in &section.properties {
                properties.retain(|it| it.0 != &key[..]);
                properties.push((key, value));
            }
        }
    }
    let get = |key: &[u8]| properties.iter().find(|it| it.0 == key).map(|it| it.1).filter(|value| *value != b"unset");
    let is_positive = |value: &&[u8]| bun_core::fmt::parse_decimal::<u32>(value).is_some_and(|n| n > 0);
    // `processMatches`
    let indent_style = get(b"indent_style");
    let mut indent_size = get(b"indent_size");
    let mut tab_width = get(b"tab_width");
    if indent_style == Some(b"tab") && indent_size.is_none() {
        indent_size = Some(b"tab");
    }
    if tab_width.is_none() && indent_size != Some(b"tab") {
        tab_width = indent_size;
    }
    if indent_size == Some(b"tab") && tab_width.is_some() {
        indent_size = tab_width;
    }

    let mut options: Vec<(&'static [u8], Vec<u8>)> = Vec::new();
    let use_tabs = match (indent_style, indent_size) {
        (Some(b"space"), _) => Some(false),
        (Some(b"tab"), _) | (_, Some(b"tab")) => Some(true),
        _ => None,
    };
    if let Some(use_tabs) = use_tabs {
        options.push((b"useTabs", if use_tabs { b"true".to_vec() } else { b"false".to_vec() }));
    }
    if let Some(size) = indent_size.filter(|size| use_tabs == Some(false) && is_positive(size)) {
        options.push((b"tabWidth", size.to_vec()));
    } else if let Some(width) = tab_width.filter(is_positive) {
        options.push((b"tabWidth", width.to_vec()));
    }
    match get(b"max_line_length") {
        Some(b"off") => options.push((b"printWidth", b"65535".to_vec())),
        Some(length) if is_positive(&length) => options.push((b"printWidth", length.to_vec())),
        _ => {}
    }
    match get(b"quote_type") {
        Some(b"single") => options.push((b"singleQuote", b"true".to_vec())),
        Some(b"double") => options.push((b"singleQuote", b"false".to_vec())),
        _ => {}
    }
    if let Some(end @ (b"lf" | b"crlf" | b"cr")) = get(b"end_of_line") {
        options.push((b"endOfLine", end.to_vec()));
    }
    options
}
