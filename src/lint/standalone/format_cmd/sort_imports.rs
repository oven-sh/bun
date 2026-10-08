//! `bun-lint format sort-imports ..`: import sorting on its own.
//!
//! - `text <path>`: the text that is formatted in place of the file.

use super::Args;
use bun_format::sort_imports::{Settings, SortImports};
use bun_lint::language::LanguageOptions;
use std::collections::BTreeMap;
use std::sync::Arc;

/// `--importOrder='["^a", "^b"]' --importOrderSeparation`
pub(super) fn from_flags(flags: &BTreeMap<String, String>) -> Option<Arc<SortImports>> {
    let mut settings = Settings::default();
    for (name, value) in flags {
        settings.set(name.as_bytes(), value.as_bytes());
    }
    settings.compile().unwrap_or_else(|error| panic!("{}", crate::text(&error)))
}

pub(super) fn run(args: &Args) {
    let how = args.options.sort_imports.as_deref();
    match args.positional.first().map(String::as_str) {
        Some("text") => {
            let path = args.positional.get(1).expect("a path");
            let code = std::fs::read(path).expect("the file");
            let sorted = crate::with_file(path, &code, &LanguageOptions::default(), |file| {
                how.and_then(|how| bun_format::sort_imports::sorted_text(file, how))
            });
            print!("{}", crate::text(&sorted.unwrap_or(code)));
        }
        _ => println!("usage: bun-lint format sort-imports text <path> --importOrder=.."),
    }
}
