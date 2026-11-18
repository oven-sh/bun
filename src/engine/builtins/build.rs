//! Cuts `js/*.js` into functions. See `js.rs` for what a file looks like.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::fmt::Write;
use std::path::PathBuf;
use std::{env, fs};

fn snake_case(name: &str) -> String {
    let mut out = String::new();
    for character in name.chars() {
        if character.is_ascii_uppercase() && !out.is_empty() {
            out.push('_');
        }
        out.push(character.to_ascii_lowercase());
    }
    out
}

#[derive(Default)]
struct Annotations<'a> {
    intrinsic: Option<&'a str>,
    name: Option<&'a str>,
    visibility: Option<&'a str>,
    is_private: bool,
    is_constructor: bool,
    is_always_inlined: bool,
}

impl<'a> Annotations<'a> {
    fn add(&mut self, annotation: &'a str) {
        match annotation.split_once(' ') {
            Some(("intrinsic", value)) => self.intrinsic = Some(value),
            Some(("name", value)) => self.name = Some(value),
            Some(("visibility", value)) => self.visibility = Some(value),
            None if annotation == "private" => self.is_private = true,
            None if annotation == "constructor" => self.is_constructor = true,
            None if annotation == "alwaysInline" => self.is_always_inlined = true,
            _ => panic!("unknown annotation @{annotation}"),
        }
    }
}

struct Header<'a> {
    is_async: bool,
    is_generator: bool,
    name: &'a str,
    /// What is between the parentheses.
    parameters: &'a str,
}

fn parse_header(line: &str) -> Option<Header<'_>> {
    let after_async = line.strip_prefix("async ");
    let rest = after_async.unwrap_or(line).strip_prefix("function")?;
    let after_star = rest.strip_prefix('*');
    let (name, rest) = after_star.unwrap_or(rest).split_once('(').expect(line);
    Some(Header {
        is_async: after_async.is_some(),
        is_generator: after_star.is_some(),
        name: name.trim(),
        parameters: rest.strip_suffix(") {").expect(line),
    })
}

fn parameter_names(parameters: &str) -> Vec<&str> {
    let declared = parameters.split("/*").next().unwrap();
    let names: Vec<&str> = (declared.split(',').map(str::trim))
        .filter(|name| !name.is_empty())
        .collect();
    let is_name = |name: &str| name.bytes().all(|it| it.is_ascii_alphanumeric());
    assert!(
        (names.iter()).all(|name| is_name(name.trim_start_matches("..."))),
        "{parameters}"
    );
    names
}

fn main() {
    println!("cargo:rerun-if-changed=js");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let mut files: Vec<PathBuf> = fs::read_dir(manifest.join("js"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|it| it == "js"))
        .collect();
    files.sort();

    let (mut ids, mut sources, mut slots) = (String::new(), String::new(), String::new());
    let mut count = 0;
    for file in files {
        let module = snake_case(file.file_stem().unwrap().to_str().unwrap());
        writeln!(ids, "pub(crate) mod {module} {{ use super::BuiltinId;").unwrap();
        let source = fs::read_to_string(&file).unwrap();
        let mut lines = source.lines();
        let mut annotations = Annotations::default();
        while let Some(line) = lines.next() {
            if let Some(annotation) = line.strip_prefix("// @") {
                annotations.add(annotation);
            }
            let Some(header) = parse_header(line) else {
                continue;
            };
            let Header {
                is_async,
                is_generator,
                name,
                ..
            } = header;
            let parameters = parameter_names(header.parameters);
            let prefix = format!(
                "({}function{} ",
                if is_async { "async " } else { "" },
                if is_generator { "*" } else { "" }
            );
            let mut text = format!("{prefix}({}) {{", parameters.join(", "));
            for line in lines.by_ref() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.starts_with("//") {
                    text.push('\n');
                    text.push_str(trimmed);
                }
                if line == "}" {
                    break;
                }
            }
            text.push(')');
            assert!(text.is_ascii(), "{name}");

            let annotations = std::mem::take(&mut annotations);
            let is_hidden = annotations.is_private || is_async;
            writeln!(
                sources,
                "BuiltinSource {{ name: {:?}, text: {text:?}, parameters_start: {}, length: {}, \
                 is_async: {is_async}, is_generator: {is_generator}, is_constructor: {}, is_always_inlined: {}, \
                 visibility: Visibility::{}, intrinsic: Intrinsic::{} }},",
                annotations.name.unwrap_or(name),
                prefix.len(),
                parameters.iter().filter(|it| !it.starts_with("...")).count(),
                annotations.is_constructor,
                annotations.is_always_inlined,
                (annotations.visibility).unwrap_or(if is_hidden { "Private" } else { "Public" }),
                annotations.intrinsic.unwrap_or("None"),
            )
            .unwrap();
            writeln!(
                ids,
                "pub(crate) const r#{name}: BuiltinId = BuiltinId({count});"
            )
            .unwrap();
            if annotations.is_private {
                let slot = format!("private_{}", snake_case(name));
                writeln!(
                    slots,
                    "RealmSlot::{slot} => cx.global().init_{slot}(function(cx, {module}::r#{name})),"
                )
                .unwrap();
            }
            count += 1;
        }
        writeln!(ids, "}}").unwrap();
    }
    let out = format!(
        "{ids}static SOURCES: [BuiltinSource; {count}] = [{sources}];\n\
         pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {{ \
         match slot {{ {slots} _ => return false }} true }}"
    );
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("js.rs"), out).unwrap();
}
