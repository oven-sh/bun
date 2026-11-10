use bun_core::strings;
use bun_sema::atom::Interner;
use bun_sema::hir::ModuleName;
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;

const DECLARATIONS_AND_JAVASCRIPT: [(&[u8], &[u8]); 3] = [
    (b".d.ts", b".js"),
    (b".d.mts", b".mjs"),
    (b".d.cts", b".cjs"),
];
const SOURCES_AND_JAVASCRIPT: [(&[u8], &[u8], &[u8]); 4] = [
    (b".tsx", b".d.ts", b".js"),
    (b".ts", b".d.ts", b".js"),
    (b".mts", b".d.mts", b".mjs"),
    (b".cts", b".d.cts", b".cjs"),
];

pub fn name_imported_files(
    path: &[u8],
    text: &[u8],
    is_written: &dyn Fn(&[u8]) -> bool,
) -> Vec<u8> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let file = bun_sema_parser::summarize_as(
        Dialect::default(),
        session.arena(),
        path,
        Some(ScriptKind::Ts),
        text,
        &atoms,
        false,
        true,
    );
    let imports = file.specifier_uses.iter().map(|it| it.pos as usize);
    let augmented = (file.modules.iter())
        .filter(|it| matches!(it.name, ModuleName::String(_)))
        .map(|it| it.name_pos as usize);
    let mut literals: Vec<usize> = imports.chain(augmented).collect();
    literals.sort_unstable();
    literals.dedup();
    let directory = &path[..strings::last_index_of_char(path, b'/').unwrap_or(0)];
    let mut named = Vec::with_capacity(text.len() + literals.len() * 3);
    let mut copied = 0;
    for start in literals {
        let Some(specifier) = string_literal_at(text, start) else {
            continue;
        };
        let Some(file_name) = file_name_of(directory, specifier, is_written) else {
            continue;
        };
        named.extend_from_slice(&text[copied..=start]);
        named.extend_from_slice(&file_name);
        copied = start + 1 + specifier.len();
    }
    named.extend_from_slice(&text[copied..]);
    named
}

fn string_literal_at(text: &[u8], start: usize) -> Option<&[u8]> {
    let quote = *text.get(start).filter(|it| matches!(it, b'"' | b'\''))?;
    let rest = &text[start + 1..];
    let length = rest
        .iter()
        .position(|&byte| matches!(byte, b'\\' | b'\n') || byte == quote)?;
    (rest[length] == quote).then_some(&rest[..length])
}

fn file_name_of(
    directory: &[u8],
    specifier: &[u8],
    is_written: &dyn Fn(&[u8]) -> bool,
) -> Option<Vec<u8>> {
    if !matches!(
        specifier,
        b"." | b".." | [b'.', b'/', ..] | [b'.', b'.', b'/', ..]
    ) {
        return None;
    }
    let target = resolve(directory, specifier)?;
    for (source, declarations, javascript) in SOURCES_AND_JAVASCRIPT {
        if let Some(stem) = target.strip_suffix(source)
            && !stem.ends_with(b".d")
            && is_written(&[stem, declarations].concat())
        {
            let kept = &specifier[..specifier.len() - source.len()];
            return Some([kept, javascript].concat());
        }
    }
    for (declarations, javascript) in DECLARATIONS_AND_JAVASCRIPT {
        if !target.is_empty() && is_written(&[&target[..], declarations].concat()) {
            return Some([specifier, javascript].concat());
        }
    }
    let kept = specifier.strip_suffix(b"/").unwrap_or(specifier);
    let separator: &[u8] = if target.is_empty() { b"" } else { b"/" };
    for (declarations, javascript) in DECLARATIONS_AND_JAVASCRIPT {
        if is_written(&[&target[..], separator, b"index", declarations].concat()) {
            return Some([kept, b"/index", javascript].concat());
        }
    }
    None
}

fn resolve(directory: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
    let mut parts: Vec<&[u8]> = strings::split(directory, b"/")
        .filter(|part| !part.is_empty())
        .collect();
    for part in strings::split(specifier, b"/") {
        match part {
            b"" | b"." => {}
            b".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join(&b"/"[..]))
}

#[cfg(test)]
mod tests {
    use bstr::BStr;

    use super::name_imported_files;

    const WRITTEN: [&[u8]; 6] = [
        b"index.d.ts",
        b"area.d.ts",
        b"tools/index.d.ts",
        b"tools/ruler.d.ts",
        b"node.d.mts",
        b"old.d.cts",
    ];

    fn named(path: &[u8], text: &str) -> String {
        let is_written = |path: &[u8]| WRITTEN.contains(&path);
        BStr::new(&name_imported_files(path, text.as_bytes(), &is_written)).to_string()
    }

    #[test]
    fn every_kind_of_import_names_its_file() {
        assert_eq!(
            named(
                b"index.d.ts",
                r#"import { area } from "./area";
import type { Ruler } from './tools/ruler';
import "./tools";
import old = require("./old");
export * from "./tools/";
export { node } from "./node";
export declare const start: import("./area").Area;
declare module "./area" {
    interface Area {}
}
"#
            ),
            r#"import { area } from "./area.js";
import type { Ruler } from './tools/ruler.js';
import "./tools/index.js";
import old = require("./old.cjs");
export * from "./tools/index.js";
export { node } from "./node.mjs";
export declare const start: import("./area.js").Area;
declare module "./area.js" {
    interface Area {}
}
"#
        );
    }

    #[test]
    fn a_folder_is_left_and_entered() {
        assert_eq!(
            named(
                b"tools/ruler.d.ts",
                "export * from \"..\";\nexport * from \".\";\nexport * from \"../area\";\nexport * from \"./index\";\n"
            ),
            "export * from \"../index.js\";\nexport * from \"./index.js\";\nexport * from \"../area.js\";\nexport * from \"./index.js\";\n"
        );
    }

    #[test]
    fn the_extension_of_a_source_file_is_replaced() {
        assert_eq!(
            named(
                b"index.d.ts",
                "export * from \"./area.ts\";\nexport * from \"./node.mts\";\n"
            ),
            "export * from \"./area.js\";\nexport * from \"./node.mjs\";\n"
        );
    }

    #[test]
    fn what_is_not_a_written_file_stays() {
        let text = "import \"./area.js\";\nimport \"./gone\";\nimport \"../outside\";\nimport \"area\";\nimport \"./data.json\";\nexport declare const text = \"./area\";\n";
        assert_eq!(named(b"index.d.ts", text), text);
    }
}
