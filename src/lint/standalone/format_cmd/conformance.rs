//! `bun-lint format conformance <fixtures>` and `format oxfmt-fixtures <fixtures>`: the tests of
//! Prettier and of oxfmt, which are run by the crate `bun_format_conformance`. `<fixtures>` is what
//! is in `test/cli/format/{prettier,oxfmt}/bundle.zst`, decompressed, or a directory with the same
//! files: `tests/format` of a checkout of Prettier.

use super::Args;
use bun_format::{FormatError, FormatOptions};
use bun_format_conformance::{Bundle, Failure, Flags, Format};
use std::path::Path;

/// The files below `directory`, by their path from `root`.
fn collect(root: &Path, directory: &Path, files: &mut Vec<(Vec<u8>, Vec<u8>)>) {
    for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if let Ok(contents) = std::fs::read(&path) {
            files.push((path.strip_prefix(root).unwrap_or(&path).as_os_str().as_encoded_bytes().to_vec(), contents));
        }
    }
}

pub(super) fn run(args: &Args, raw: &[String], run: fn(&Bundle<'_>, &Flags<'_>, Format<'_>)) {
    let path = Path::new(args.positional.first().expect("the path of the fixtures"));
    let mut files = Vec::new();
    let bytes = if path.is_dir() { Vec::new() } else { std::fs::read(path).expect("the fixtures") };
    let bundle = match path.is_dir() {
        true => {
            collect(path, path, &mut files);
            let mut bundle = Bundle::default();
            files.iter().for_each(|(path, contents)| bundle.insert(path, contents));
            bundle
        }
        false => Bundle::parse(&bytes).expect("a bundle"),
    };
    let raw: Vec<&[u8]> = raw.iter().map(String::as_bytes).collect();
    let flags = Flags::parse(&raw);
    let embedded_html = flags.languages.is_some_and(|languages| bun_core::strings::split(languages, b",").any(|language| language == b"html"));
    run(&bundle, &flags, &|path, text, options| {
        let options = FormatOptions {
            embedded_html,
            ..options.clone()
        };
        super::format_text_with_cursor(&crate::text(path), text, &options).map_err(|error| match error {
            FormatError::SyntaxError => Failure::SyntaxError,
            _ => Failure::Other,
        })
    });
}
