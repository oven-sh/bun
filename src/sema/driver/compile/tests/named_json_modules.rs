use super::support::{from_bun_check, with_program};
use crate::declaration_imports::json_modules_named_in;
use bstr::BString;
use bun_sema::hir::{FileKind, ResolutionMode};
use bun_sema::program::{FileId, Files};

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let absolute = format!("/project/{path}");
    let found = files.by_path.get(absolute.as_bytes());
    found.unwrap_or_else(|| panic!("{absolute} is not in the program"))
}

fn names_of(files: &Files<'_>, list: &[FileId]) -> Vec<BString> {
    let names = list.iter().map(|file| files.module(*file).file_name());
    let relative = names.map(|name| name.strip_prefix(b"/project/").unwrap_or(name));
    relative.map(BString::from).collect()
}

fn named(files: &Files<'_>, importer: &str, text: &str) -> Vec<BString> {
    let importer = file_at(files, importer);
    names_of(
        files,
        &json_modules_named_in(files, importer, text.as_bytes()),
    )
}

fn tsconfig(more: &str) -> String {
    format!(
        r#"{{ "compilerOptions": {{
            "strict": true, "noLib": true, "types": [],
            "moduleResolution": "bundler", "resolveJsonModule": true, "allowArbitraryExtensions": true{more}
        }} }}"#
    )
}

const DATA: &str = r#"{ "name": "x", "size": 3 }"#;
const IMPORTS_DATA: &str =
    "import data from \"./data.json\";\nexport const size: number = data.size;\n";

/// The modes that `importer` has `specifier` under, and the file of each.
fn imports_of(
    files: &Files<'_>,
    importer: &str,
    specifier: &str,
) -> Vec<(ResolutionMode, BString)> {
    let importer = files.module(file_at(files, importer));
    let atom = files.atoms.lookup(specifier.as_bytes());
    let modes = [
        ResolutionMode::None,
        ResolutionMode::Import,
        ResolutionMode::Require,
    ];
    let found = modes.into_iter().filter_map(|mode| {
        let file = *importer.imports.get(&(atom?, mode))?;
        Some((mode, names_of(files, &[file]).remove(0)))
    });
    found.collect()
}

#[test]
fn a_json_module_is_named_once_by_its_path() {
    let config = tsconfig(r#", "module": "preserve""#);
    let files = [
        ("tsconfig.json", config.as_str()),
        ("index.ts", IMPORTS_DATA),
        ("data.json", DATA),
        (
            "folder/above.ts",
            "import data from \"../data.json\";\nexport const size: number = data.size;\n",
        ),
        ("does-not-import-it.ts", "export const one = 1;\n"),
    ];
    let three_times = "import data from \"./data.json\";\nexport { size } from './data.json';\nexport type Data = typeof import(\"./data.json\");\nimport \"./gone.json\";\n";
    let (index, above, not_an_importer, no_json) = from_bun_check(&files, |files| {
        (
            named(files, "index.ts", three_times),
            named(
                files,
                "folder/above.ts",
                "import data from \"../data.json\";\n",
            ),
            named(
                files,
                "does-not-import-it.ts",
                "export declare const take: (data: typeof import(\"./data.json\")) => void;\n",
            ),
            named(files, "index.ts", "export declare const size: number;\n"),
        )
    });
    assert_eq!(index, ["data.json"]);
    assert_eq!(above, ["data.json"]);
    assert_eq!(not_an_importer, ["data.json"]);
    assert_eq!(no_json, [""; 0]);
}

/// `./declared.json` is `declared.d.json.ts` for the importer. The alias makes `declared.json` a file of the program.
#[test]
fn an_import_that_is_another_file_does_not_name_the_json_module() {
    let plain = "import data from \"./declared.json\";\nimport raw from \"@json/declared\";\nexport const name: string = data.name;\nexport const size: number = raw.size;\n";
    let required = "import data = require(\"./declared.json\");\nimport raw = require(\"@json/declared\");\nexport const name: string = data.default.name;\nexport const size: number = raw.size;\n";
    let paths = r#", "paths": { "@json/*": ["./*.json"] }"#;
    let without_package_json =
        r#""resolvePackageJsonExports": false, "resolvePackageJsonImports": false"#;
    let cases = [
        (
            ResolutionMode::Import,
            format!(r#", "module": "preserve"{paths}"#),
            plain,
        ),
        (
            ResolutionMode::Require,
            format!(r#", "module": "preserve"{paths}"#),
            required,
        ),
        (
            ResolutionMode::None,
            format!(r#", "module": "esnext", {without_package_json}{paths}"#),
            plain,
        ),
    ];
    let text =
        "import data from \"./declared.json\";\nexport declare function declared(): typeof data;\n";
    for (mode, options, importer) in cases {
        let config = tsconfig(&options);
        let files = [
            ("tsconfig.json", config.as_str()),
            ("index.ts", importer),
            ("declared.json", DATA),
            (
                "declared.d.json.ts",
                "declare const data: { readonly name: string };\nexport default data;\n",
            ),
        ];
        let (imports, kind, found) = from_bun_check(&files, |files| {
            (
                imports_of(files, "index.ts", "./declared.json"),
                files.module(file_at(files, "declared.json")).hir.kind,
                named(files, "index.ts", text),
            )
        });
        // The fixture is what it says: the import is under this mode alone, and it is the declaration file.
        assert_eq!(
            imports,
            [(mode, BString::from("declared.d.json.ts"))],
            "{mode:?}"
        );
        assert_eq!(kind, FileKind::Json, "{mode:?}");
        assert_eq!(found, [""; 0], "{mode:?}");
    }
}

#[test]
fn a_json_module_of_an_installed_package_is_not_named() {
    let config = tsconfig(r#", "module": "preserve""#);
    let files = [
        ("tsconfig.json", config.as_str()),
        (
            "index.ts",
            "import data from \"./node_modules/dep/data.json\";\nexport const size: number = data.size;\n",
        ),
        ("node_modules/dep/data.json", DATA),
    ];
    let text = "import data from \"./node_modules/dep/data.json\";\nexport declare function installed(): typeof data;\n";
    let (is_external, kind, found) = from_bun_check(&files, |files| {
        let json = files.module(file_at(files, "node_modules/dep/data.json"));
        (
            json.is_from_external_library,
            json.hir.kind,
            named(files, "index.ts", text),
        )
    });
    assert!(is_external);
    assert_eq!(kind, FileKind::Json);
    assert_eq!(found, [""; 0]);
}

/// In a compile build a JSON file is a module made from data, not a JSON module.
#[test]
fn a_file_named_json_that_is_not_a_json_module_is_not_named() {
    let config = tsconfig(r#", "module": "preserve""#);
    let files = [
        ("tsconfig.json", config.as_str()),
        ("index.ts", IMPORTS_DATA),
        ("data.json", DATA),
    ];
    let text = "import data from \"./data.json\";\nexport declare function get(): typeof data;\n";
    with_program(&files, &["./index.ts"], 1, |program| {
        let files = program.files();
        let json = files.module(program.file("data.json"));
        assert_eq!(json.hir.kind, FileKind::Tsx);
        assert!(!json.is_from_external_library);
        assert_eq!(imports_of(files, "index.ts", "./data.json").len(), 1);
        assert_eq!(named(files, "index.ts", text), [""; 0]);
    });
}
