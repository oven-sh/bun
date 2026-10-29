//! The metafile of a build with `--aot`, in the format of `linker_context::metafile_builder`.
//!
//! Nothing is bundled, so there is one output, the executable. Its "bytes" are those of the compiled program in it, and the
//! "bytesInOutput" of an input are those of the machine code of its functions.

use std::io::Write;

use bun_aot::module_list::{
    DataType, ImportTarget, ModuleFormat, ModuleImport, ModuleImportKind, ModuleInput, ModuleList,
};
use bun_ast::ImportKind;
use bun_core::fmt::format_json_string_utf8;

use crate::bundle_v2::write_metafile_output;
use crate::linker_context::metafile_builder::generate_markdown;
use crate::options::OutputKind;

pub struct MetafileOutput<'a> {
    pub file_name: &'a [u8],
    pub byte_count: u64,
}

/// Where `Bun.build` writes a metafile. An empty path: nowhere.
pub struct MetafileFiles<'a> {
    pub output_directory: &'a [u8],
    pub json_path: &'a [u8],
    pub markdown_path: &'a [u8],
}

pub fn write_metafile(modules: &ModuleList, output: &MetafileOutput<'_>) -> Vec<u8> {
    let mut json = b"{\n  \"inputs\": {".to_vec();
    for (index, input) in modules.inputs.iter().enumerate() {
        json.extend_from_slice(if index == 0 { b"\n    " } else { b",\n    " });
        write_input(&mut json, modules, input);
    }
    json.extend_from_slice(b"\n  },\n  \"outputs\": {\n    ");
    write_string(&mut json, &[b"./", output.file_name].concat());
    let _ = write!(json, ": {{\n      \"bytes\": {}", output.byte_count);

    json.extend_from_slice(b",\n      \"inputs\": {");
    for (index, input) in modules.inputs.iter().enumerate() {
        json.extend_from_slice(if index == 0 {
            b"\n        "
        } else {
            b",\n        "
        });
        write_string(&mut json, &input.path);
        let _ = write!(
            json,
            ": {{\n          \"bytesInOutput\": {}\n        }}",
            input.code_byte_count
        );
    }
    json.extend_from_slice(b"\n      },\n      \"imports\": [\n      ],\n      \"exports\": [");
    for (index, name) in modules.exports.iter().enumerate() {
        json.extend_from_slice(if index == 0 {
            b"\n        "
        } else {
            b",\n        "
        });
        write_string(&mut json, name);
    }
    if !modules.exports.is_empty() {
        json.extend_from_slice(b"\n      ");
    }
    json.push(b']');
    if let Some(entry_point) = modules.entry_point {
        json.extend_from_slice(b",\n      \"entryPoint\": ");
        write_string(&mut json, &modules.inputs[entry_point as usize].path);
    }
    json.extend_from_slice(b"\n    }\n  }\n}\n");
    json
}

/// Writes the files that the build asks for, and answers the markdown where it asks for that.
pub fn write_metafile_files(json: &[u8], files: &MetafileFiles<'_>) -> Option<Box<[u8]>> {
    let markdown = match files.markdown_path.is_empty() {
        true => None,
        false => match generate_markdown(json) {
            Ok(markdown) => Some(markdown),
            Err(error) => {
                bun_core::warn!("Failed to generate metafile markdown: {}", error);
                None
            }
        },
    };
    // An executable is the only artifact of its build, as without `--aot`.
    let mut artifacts = Vec::new();
    let directory = files.output_directory;
    if !files.json_path.is_empty() {
        let kind = OutputKind::MetafileJson;
        let _ = write_metafile_output(&mut artifacts, directory, files.json_path, json, kind);
    }
    if let Some(markdown) = &markdown {
        let kind = OutputKind::MetafileMarkdown;
        let path = files.markdown_path;
        let _ = write_metafile_output(&mut artifacts, directory, path, markdown, kind);
    }
    markdown
}

fn write_input(json: &mut Vec<u8>, modules: &ModuleList, input: &ModuleInput) {
    write_string(json, &input.path);
    let _ = write!(json, ": {{\n      \"bytes\": {}", input.byte_count);
    json.extend_from_slice(b",\n      \"imports\": [");
    for (index, import) in input.imports.iter().enumerate() {
        if index > 0 {
            json.push(b',');
        }
        write_import(json, modules, import);
    }
    json.extend_from_slice(b"\n      ]");
    if let Some(format) = input.format {
        json.extend_from_slice(b",\n      \"format\": \"");
        json.extend_from_slice(match format {
            ModuleFormat::Esm => b"esm",
            ModuleFormat::Cjs => b"cjs",
            ModuleFormat::Json => b"json",
            ModuleFormat::Css => b"css",
        });
        json.push(b'"');
    }
    json.extend_from_slice(b"\n    }");
}

fn write_import(json: &mut Vec<u8>, modules: &ModuleList, import: &ModuleImport) {
    let path = match &import.target {
        ImportTarget::Input(input) => &modules.inputs[*input as usize].path,
        ImportTarget::External(path) => path,
    };
    json.extend_from_slice(b"\n        {\n          \"path\": ");
    write_string(json, path);
    json.extend_from_slice(b",\n          \"kind\": \"");
    json.extend_from_slice(import_kind(import.kind).label());
    json.push(b'"');
    if !import.original.is_empty() && import.original != *path {
        json.extend_from_slice(b",\n          \"original\": ");
        write_string(json, &import.original);
    }
    if matches!(import.target, ImportTarget::External(_)) {
        json.extend_from_slice(b",\n          \"external\": true");
    }
    if let Some(data_type) = import.data_type {
        json.extend_from_slice(b",\n          \"with\": { \"type\": \"");
        json.extend_from_slice(match data_type {
            DataType::Json => b"json",
            DataType::Toml => b"toml",
            DataType::Text => b"text",
        });
        json.extend_from_slice(b"\" }");
    }
    json.extend_from_slice(b"\n        }");
}

fn import_kind(kind: ModuleImportKind) -> ImportKind {
    match kind {
        ModuleImportKind::ImportStatement => ImportKind::Stmt,
        ModuleImportKind::RequireCall => ImportKind::Require,
        ModuleImportKind::DynamicImport => ImportKind::Dynamic,
        ModuleImportKind::RequireResolve => ImportKind::RequireResolve,
        ModuleImportKind::HtmlManifest => ImportKind::HtmlManifest,
    }
}

fn write_string(json: &mut Vec<u8>, text: &[u8]) {
    let _ = write!(
        json,
        "{}",
        format_json_string_utf8(text, Default::default())
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(path: &str, imports: Vec<ModuleImport>) -> ModuleInput {
        ModuleInput {
            path: path.as_bytes().to_vec(),
            byte_count: 10,
            format: Some(ModuleFormat::Esm),
            imports,
            code_byte_count: 64,
        }
    }

    #[test]
    fn program_without_imports() {
        let modules = ModuleList {
            inputs: vec![input("a.ts", Vec::new())],
            entry_point: Some(0),
            exports: Vec::new(),
        };
        let output = MetafileOutput {
            file_name: b"a",
            byte_count: 4096,
        };
        let expected = r#"{
  "inputs": {
    "a.ts": {
      "bytes": 10,
      "imports": [
      ],
      "format": "esm"
    }
  },
  "outputs": {
    "./a": {
      "bytes": 4096,
      "inputs": {
        "a.ts": {
          "bytesInOutput": 64
        }
      },
      "imports": [
      ],
      "exports": [],
      "entryPoint": "a.ts"
    }
  }
}
"#;
        assert_eq!(
            bstr::BStr::new(&write_metafile(&modules, &output)),
            bstr::BStr::new(expected)
        );
    }

    #[test]
    fn members_of_an_import() {
        let imports = vec![
            ModuleImport {
                target: ImportTarget::Input(1),
                kind: ModuleImportKind::ImportStatement,
                original: b"./\"b\".json".to_vec(),
                data_type: Some(DataType::Json),
            },
            ModuleImport {
                target: ImportTarget::External(b"fs".to_vec()),
                kind: ModuleImportKind::RequireCall,
                original: b"fs".to_vec(),
                data_type: None,
            },
        ];
        let modules = ModuleList {
            inputs: vec![input("a.ts", imports), input("\"b\".json", Vec::new())],
            entry_point: Some(0),
            exports: vec![b"first".to_vec(), b"second".to_vec()],
        };
        let output = MetafileOutput {
            file_name: b"a",
            byte_count: 4096,
        };
        let json = write_metafile(&modules, &output);
        let contains = |text: &str| bun_core::strings::contains(&json, text.as_bytes());
        assert!(contains(
            r#"        {
          "path": "\"b\".json",
          "kind": "import-statement",
          "original": "./\"b\".json",
          "with": { "type": "json" }
        },
        {
          "path": "fs",
          "kind": "require-call",
          "external": true
        }
      ]"#
        ));
        assert!(contains(
            "\"exports\": [\n        \"first\",\n        \"second\"\n      ],"
        ));
        assert!(generate_markdown(&json).is_ok());
    }
}
