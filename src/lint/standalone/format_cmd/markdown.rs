//! `bun-lint format markdown ..`: for looking at and measuring how Markdown is read and formatted.
//!
//! - `tree <file>`: the syntax tree of a file. With `--mdx`, the text is MDX.
//! - `html <bundle> [--on=flag,flag]`: for each text its name, a tab, and a hash of what `Bun.markdown.html` makes of it.
//!   With `--show`, the HTML. With `--iterations=n`, nothing is printed: for measuring.
//! - `bench <bundle> [--iterations=n]`: formats each text, prints nothing.
//! - `format <bundle>`: a bundle of the formatted texts.
//! - `parse <bundle> [--iterations=n]`: only makes the syntax tree of each text.
//!
//! A bundle: before each text a line with U+001E and its name.

use super::Args;
use crate::host::{self, error_line, output, output_line};
use std::hash::{Hash as _, Hasher as _};

fn for_each_text(paths: &[String], mut then: impl FnMut(&str, &[u8])) {
    for path in paths {
        let Ok(bundle) = host::read(path) else {
            return error_line!("cannot read {path}");
        };
        for entry in bun_core::strings::split(&bundle, b"\x1E").skip(1) {
            let (name, text) =
                bun_core::strings::split_once_char(entry, b'\n').unwrap_or((entry, b""));
            then(&crate::text(name), text);
        }
    }
}

pub(super) fn run(args: &Args) {
    let paths = args.positional.get(1..).unwrap_or_default();
    let is_mdx = args.flag("mdx").is_some();
    match args.positional.first().map(String::as_str) {
        Some("tree") => {
            for path in paths {
                let Ok(text) = host::read(path) else {
                    return error_line!("cannot read {path}");
                };
                let mut tree = Vec::new();
                if is_mdx {
                    bun_format::markdown::dump_mdx_ast(&text, &mut tree);
                } else {
                    bun_format::markdown::dump_ast(&text, &mut tree);
                }
                output!("{}", crate::text(&tree));
            }
        }
        Some("html") => {
            let on: Vec<&str> = args
                .flag("on")
                .map(|it| host::split(it, ",").collect())
                .unwrap_or_default();
            if let Some(iterations) = args.flag("iterations").and_then(|it| it.parse().ok()) {
                let mut len = 0;
                for _ in 0..iterations {
                    for_each_text(paths, |_, text| {
                        len += bun_format::markdown::render_to_html(text, &on)
                            .map_or(0, |it| it.len());
                    });
                }
                return output_line!("{len} bytes of HTML");
            }
            for_each_text(paths, |name, text| {
                let html = bun_format::markdown::render_to_html(text, &on).unwrap_or_default();
                if args.flag("show").is_some() {
                    return output_line!("\u{1E}{name}\n{}", crate::text(&html));
                }
                let mut hasher = std::hash::DefaultHasher::new();
                html.hash(&mut hasher);
                output_line!("{name}\t{:016x}", hasher.finish());
            });
        }
        Some("format") => for_each_text(paths, |name, text| {
            let path = if name.ends_with(".mdx") {
                "a.mdx"
            } else {
                "a.md"
            };
            match super::format_text(path, text, &args.options) {
                Ok(out) => output!("\u{1E}{name}\n{}", crate::text(&out)),
                Err(_) => output_line!("\u{1E}{name}\nerror"),
            }
        }),
        Some("parse") => {
            let iterations = args
                .flag("iterations")
                .and_then(|it| it.parse().ok())
                .unwrap_or(1);
            let mut scratch = Default::default();
            let mut nodes = 0;
            for _ in 0..iterations {
                for_each_text(paths, |_, text| {
                    nodes += bun_format::markdown::count_nodes(text, &mut scratch);
                });
            }
            output_line!("{nodes} nodes");
        }
        Some("bench") => {
            let iterations = args
                .flag("iterations")
                .and_then(|it| it.parse().ok())
                .unwrap_or(1);
            let (mut len, mut errors) = (0, 0);
            for _ in 0..iterations {
                for_each_text(paths, |_, text| {
                    match super::format_text("a.md", text, &args.options) {
                        Ok(out) => len += out.len(),
                        Err(_) => errors += 1,
                    }
                });
            }
            output_line!("{len} bytes, {errors} errors");
        }
        _ => error_line!("usage: bun-lint format markdown tree|html|format|bench|parse <paths..>"),
    }
}
