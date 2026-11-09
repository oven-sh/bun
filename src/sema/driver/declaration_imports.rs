use bun_core::strings;
use bun_sema::atom::Interner;
use bun_sema::hir::{FileKind, ModuleName};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Dialect, ScriptKind, join};
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

/// Calls `imported` with each written declaration file that a specifier of `text` names.
pub fn name_imported_files(
    path: &[u8],
    text: &[u8],
    is_written: &dyn Fn(&[u8]) -> bool,
    imported: &mut dyn FnMut(&[u8]),
) -> Vec<u8> {
    let literals = specifier_literals(path, text);
    let directory = &path[..strings::last_index_of_char(path, b'/').unwrap_or(0)];
    let mut named = Vec::with_capacity(text.len() + literals.len() * 3);
    let mut copied = 0;
    for start in literals {
        let Some(specifier) = string_literal_at(text, start) else {
            continue;
        };
        let Some((file_name, declarations)) = file_name_of(directory, specifier, is_written) else {
            continue;
        };
        imported(&declarations);
        named.extend_from_slice(&text[copied..=start]);
        named.extend_from_slice(&file_name);
        copied = start + 1 + specifier.len();
    }
    named.extend_from_slice(&text[copied..]);
    named
}

/// The JSON modules of the package that `text`, the declaration file of `file`, names with a relative specifier.
pub fn json_modules_named_in(files: &Files<'_>, file: FileId, text: &[u8]) -> Vec<FileId> {
    if !strings::contains(text, b".json") {
        return Vec::new();
    }
    let importer = files.module(file);
    let source = importer.file_name();
    let directory = &source[..strings::last_index_of_char(source, b'/').unwrap_or(0)];
    let mut named: Vec<FileId> = Vec::new();
    for specifier in json_specifiers(source, text) {
        let Some(json) = files.by_path.get(&join(directory, specifier)) else {
            continue;
        };
        // The specifier can be one that `file` imports, and that resolves to another file, such as `data.d.json.ts`.
        let imported = files.atoms.lookup(specifier);
        let mut imports = importer.imports.iter();
        let is_another_file = imports.any(|(&(it, _), &to)| Some(it) == imported && to != json);
        let module = files.module(json);
        if !is_another_file
            && module.hir.kind == FileKind::Json
            && !module.is_from_external_library
            && !named.contains(&json)
        {
            named.push(json);
        }
    }
    named
}

fn json_specifiers<'a>(path: &[u8], text: &'a [u8]) -> Vec<&'a [u8]> {
    (specifier_literals(path, text).into_iter())
        .filter_map(|start| string_literal_at(text, start))
        .filter(|specifier| is_relative(specifier) && specifier.ends_with(b".json"))
        .collect()
}

/// Where each string literal that names a module starts in `text`, a declaration file.
fn specifier_literals(path: &[u8], text: &[u8]) -> Vec<usize> {
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
    literals
}

fn is_relative(specifier: &[u8]) -> bool {
    matches!(
        specifier,
        b"." | b".." | [b'.', b'/', ..] | [b'.', b'.', b'/', ..]
    )
}

fn string_literal_at(text: &[u8], start: usize) -> Option<&[u8]> {
    let quote = *text.get(start).filter(|it| matches!(it, b'"' | b'\''))?;
    let rest = &text[start + 1..];
    let length = rest
        .iter()
        .position(|&byte| matches!(byte, b'\\' | b'\n') || byte == quote)?;
    (rest[length] == quote).then_some(&rest[..length])
}

/// The name that `specifier` gets, and the written declaration file that it names.
fn file_name_of(
    directory: &[u8],
    specifier: &[u8],
    is_written: &dyn Fn(&[u8]) -> bool,
) -> Option<(Vec<u8>, Vec<u8>)> {
    if !is_relative(specifier) {
        return None;
    }
    let target = resolve(directory, specifier)?;
    let written = |declarations: Vec<u8>| is_written(&declarations).then_some(declarations);
    for (source, declarations, javascript) in SOURCES_AND_JAVASCRIPT {
        if let Some(stem) = target.strip_suffix(source)
            && !stem.ends_with(b".d")
            && let Some(declarations) = written([stem, declarations].concat())
        {
            let kept = &specifier[..specifier.len() - source.len()];
            return Some(([kept, javascript].concat(), declarations));
        }
    }
    for (declarations, javascript) in DECLARATIONS_AND_JAVASCRIPT {
        if !target.is_empty()
            && let Some(declarations) = written([&target[..], declarations].concat())
        {
            return Some(([specifier, javascript].concat(), declarations));
        }
    }
    let kept = specifier.strip_suffix(b"/").unwrap_or(specifier);
    let separator: &[u8] = if target.is_empty() { b"" } else { b"/" };
    for (declarations, javascript) in DECLARATIONS_AND_JAVASCRIPT {
        let index = [&target[..], separator, b"index", declarations].concat();
        if let Some(declarations) = written(index) {
            return Some(([kept, b"/index", javascript].concat(), declarations));
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

    use super::{json_specifiers, name_imported_files};

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
        let named = name_imported_files(path, text.as_bytes(), &is_written, &mut |_| {});
        BStr::new(&named).to_string()
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

    #[test]
    fn a_json_file_is_named_after_its_declaration_file() {
        let is_written =
            |path: &[u8]| [&b"tools/data.json.d.cts"[..], b"other.json.d.cts"].contains(&path);
        let text = "import data from \"./tools/data.json\";\nexport type Data = typeof import(\"./tools/data.json\");\nimport \"./gone.json\";\n";
        let mut imported: Vec<Vec<u8>> = Vec::new();
        let named = name_imported_files(b"index.d.ts", text.as_bytes(), &is_written, &mut |it| {
            imported.push(it.to_vec());
        });
        assert_eq!(
            BStr::new(&named).to_string(),
            "import data from \"./tools/data.json.cjs\";\nexport type Data = typeof import(\"./tools/data.json.cjs\");\nimport \"./gone.json\";\n"
        );
        // Once for each specifier. Nothing names other.json.d.cts.
        assert_eq!(
            imported,
            [b"tools/data.json.d.cts", b"tools/data.json.d.cts"]
        );
    }

    #[test]
    fn only_a_relative_specifier_that_ends_in_json_can_name_a_json_module() {
        let text = r#"import data from "./data.json";
export { name } from '../shared/data.json';
export declare const list: typeof import("./list.json");
import old = require("./old.json");
/** Reads "./comment.json". */
export type Path = "./type.json";
import bare from "bare.json";
import rooted from "/rooted.json";
import config from "./config.jsonc";
import folder from "./data.json/index";
import escaped from "./\u0065scaped.json";
"#;
        let found = json_specifiers(b"/src/index.ts", text.as_bytes());
        let found: Vec<&BStr> = found.into_iter().map(BStr::new).collect();
        assert_eq!(
            found,
            [
                "./data.json",
                "../shared/data.json",
                "./list.json",
                "./old.json"
            ]
        );
    }
}
