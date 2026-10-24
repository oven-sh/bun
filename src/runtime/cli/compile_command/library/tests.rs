use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use super::package_files::{is_document, subpath_of, valid_package_name};
use super::*;

static PROJECT_COUNT: AtomicU32 = AtomicU32::new(0);

struct TemporaryProject {
    directory: PathBuf,
}

impl TemporaryProject {
    fn new(files: &[(&str, &str)]) -> TemporaryProject {
        let number = PROJECT_COUNT.fetch_add(1, Ordering::Relaxed);
        let name = format!("bun-compile-library-{}-{number}", std::process::id());
        let project = TemporaryProject {
            directory: std::env::temp_dir().join(name),
        };
        let _ = std::fs::remove_dir_all(&project.directory);
        std::fs::create_dir_all(&project.directory).expect("project directory");
        for (relative_path, contents) in files {
            let path = PathBuf::from(project.path(relative_path));
            std::fs::create_dir_all(path.parent().expect("parent")).expect("directory");
            std::fs::write(path, contents).expect("file");
        }
        project
    }

    fn path(&self, relative_path: &str) -> String {
        let mut path = self.directory.clone();
        path.extend(relative_path.split('/').filter(|part| !part.is_empty()));
        path.into_os_string().into_string().expect("UTF-8 path")
    }

    fn paths(&self, relative_paths: &[&str]) -> Vec<String> {
        relative_paths.iter().map(|path| self.path(path)).collect()
    }

    fn find_entry_points(&self, outdir: &str) -> Result<Vec<String>, LibraryError> {
        let found = find_default_library_entry_points(self.path("").as_bytes(), outdir.as_bytes())?;
        Ok(found.iter().map(|path| text(path)).collect())
    }

    fn find_external_packages(
        &self,
        outdir: &str,
        entry_points: &[&str],
    ) -> Result<Vec<String>, LibraryError> {
        let entry_points: Vec<Box<[u8]>> = entry_points
            .iter()
            .map(|path| path.as_bytes().into())
            .collect();
        let working_directory = self.path("");
        let found = find_external_packages(
            working_directory.as_bytes(),
            outdir.as_bytes(),
            &entry_points,
        )?;
        Ok(found.iter().map(|name| text(name)).collect())
    }
}

impl Drop for TemporaryProject {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn message(error: &LibraryError) -> String {
    let mut out = Vec::new();
    error.write_message(&mut out);
    text(&out)
}

#[test]
fn typescript_files_named_by_exports() {
    let project = TemporaryProject::new(&[
        (
            "package.json",
            r#"{
                "module": "lib/start.ts",
                "exports": {
                    ".": { "bun": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js" },
                    "./more": "./src/extra.ts",
                    "./where": { "browser": ["./src/missing.ts", "./src/browser.tsx"], "default": "./src/index.ts" },
                    "./types": "./src/types.d.ts",
                    "./built": "./dist/built.ts",
                    "./package.json": "./package.json"
                }
            }"#,
        ),
        ("lib/start.ts", ""),
        ("src/index.ts", ""),
        ("src/extra.ts", ""),
        ("src/browser.tsx", ""),
        ("src/types.d.ts", ""),
        ("dist/built.ts", ""),
        ("dist/index.js", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["src/index.ts", "src/extra.ts", "src/browser.tsx"]))
    );
}

#[test]
fn exports_that_is_one_path() {
    let project = TemporaryProject::new(&[
        ("package.json", r#"{ "exports": "./src/extra.ts" }"#),
        ("index.ts", ""),
        ("src/extra.ts", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["src/extra.ts"]))
    );
}

#[test]
fn typescript_module_precedes_index_files() {
    let project = TemporaryProject::new(&[
        ("package.json", r#"{ "module": "lib/start.ts" }"#),
        ("lib/start.ts", ""),
        ("index.ts", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["lib/start.ts"]))
    );
}

#[test]
fn typescript_index_file_precedes_javascript_main() {
    let project = TemporaryProject::new(&[
        ("package.json", r#"{ "main": "lib/main.js" }"#),
        ("lib/main.js", ""),
        ("src/index.ts", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["src/index.ts"]))
    );
}

#[test]
fn main_inside_outdir_is_not_a_source() {
    let project = TemporaryProject::new(&[
        ("package.json", r#"{ "main": "dist/index.js" }"#),
        ("dist/index.js", ""),
        ("index.js", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["index.js"]))
    );
}

#[test]
fn javascript_main_precedes_javascript_index_files() {
    let project = TemporaryProject::new(&[
        ("package.json", r#"{ "main": "lib/main.js" }"#),
        ("lib/main.js", ""),
        ("index.js", ""),
    ]);
    assert_eq!(
        project.find_entry_points("dist"),
        Ok(project.paths(&["lib/main.js"]))
    );
}

#[test]
fn no_entry_point() {
    let project = TemporaryProject::new(&[("package.json", r#"{ "main": "dist/index.js" }"#)]);
    let error = project.find_entry_points("dist").unwrap_err();
    assert_eq!(
        error,
        LibraryError::NoEntryPoint {
            directory: project.path("").into_bytes(),
        }
    );
    assert_eq!(
        message(&error),
        format!(
            "No entry point. There is no \"exports\", \"module\" or \"main\" in package.json that \
             is a source file, and no index.ts, index.tsx, index.mts or index.js in {} or in its \
             src folder",
            project.path("")
        )
    );
}

#[test]
fn outdir_that_holds_the_project() {
    let project = TemporaryProject::new(&[("package.json", "{}"), ("src/index.ts", "")]);
    for outdir in [".", "..", "./"] {
        let error = project.find_entry_points(outdir).unwrap_err();
        assert!(
            matches!(error, LibraryError::OutdirHoldsProject { .. }),
            "{outdir}: {error:?}"
        );
        assert_eq!(
            project.find_external_packages(outdir, &["src/index.ts"]),
            Err(error)
        );
    }
    assert_eq!(
        message(&project.find_entry_points(".").unwrap_err()),
        format!(
            "--library writes a package.json into --outdir, so --outdir can't be the project \
             folder ({}). Use a folder inside it, such as --outdir=dist",
            project.path("")
        )
    );
}

#[test]
fn entry_point_inside_outdir() {
    let project = TemporaryProject::new(&[("package.json", "{}"), ("src/index.ts", "")]);
    let error = project
        .find_external_packages("src", &["src/index.ts"])
        .unwrap_err();
    assert_eq!(
        message(&error),
        "the entry point src/index.ts is inside --outdir, where it would be overwritten. Choose \
         another --outdir"
    );
}

#[test]
fn unparsable_package_json() {
    let project = TemporaryProject::new(&[("package.json", "{"), ("index.ts", "")]);
    let error = LibraryError::UnparsablePackageJson {
        path: project.path("package.json").into_bytes(),
    };
    assert_eq!(
        message(&error),
        format!("{} could not be parsed", project.path("package.json"))
    );
    assert_eq!(project.find_external_packages("dist", &[]), Err(error));
}

#[test]
fn installed_dependencies_are_external() {
    let project = TemporaryProject::new(&[(
        "package.json",
        r#"{
            "dependencies": { "dep": "1", "@scope/dep": "1" },
            "devDependencies": { "dev": "1" },
            "optionalDependencies": { "optional": "1" },
            "peerDependencies": { "peer": "1" }
        }"#,
    )]);
    assert_eq!(
        project.find_external_packages("dist", &["index.ts"]),
        Ok(["dep", "@scope/dep", "peer", "optional"]
            .map(str::to_owned)
            .to_vec())
    );
}

#[test]
fn subpaths() {
    for (javascript, subpath) in [
        ("index.js", "."),
        ("extra.js", "./extra"),
        ("tools/index.js", "./tools"),
        ("tools/hammer.js", "./tools/hammer"),
        ("reindex.js", "./reindex"),
    ] {
        assert_eq!(text(&subpath_of(javascript.as_bytes())), subpath);
    }
}

#[test]
fn package_names_from_folders() {
    for (folder, name) in [
        ("shapes", "shapes"),
        ("My Shapes!", "my-shapes-"),
        ("_.-private", "private"),
        ("...", "package"),
        ("", "package"),
    ] {
        assert_eq!(text(&valid_package_name(folder.as_bytes())), name);
    }
    assert_eq!(valid_package_name(&[b'a'; 300]).len(), 214);
}

#[test]
fn documents() {
    for name in ["README", "readme.md", "LICENSE", "License.txt", "LICENCE"] {
        assert!(is_document(name.as_bytes()), "{name}");
    }
    for name in ["READMES", "NOTES.md", "LICENSES", "READ", ""] {
        assert!(!is_document(name.as_bytes()), "{name}");
    }
}

#[cfg(not(windows))]
mod written_files {
    use bun_ast::{Loader, Log};
    use bun_bundler::options::{OutputFile, OutputKind};

    use super::super::declarations::declaration_path;
    use super::super::package_files::{PackageRequest, write_package_json};
    use super::*;
    use crate::cli::check_command::DeclarationFile;

    fn javascript(kind: OutputKind, source: &'static str, dest_path: &str) -> OutputFile {
        OutputFile {
            loader: Loader::Js,
            output_kind: kind,
            src_path: bun_paths::fs::Path::init(source.as_bytes()),
            dest_path: dest_path.as_bytes().into(),
            ..OutputFile::zero_value()
        }
    }

    fn declarations(sources: &[&str]) -> Vec<DeclarationFile> {
        sources
            .iter()
            .map(|source| DeclarationFile {
                source: source.as_bytes().to_vec(),
                text: b"export {};\n".to_vec(),
            })
            .collect()
    }

    fn dest_paths(output_files: &[OutputFile]) -> Vec<String> {
        output_files
            .iter()
            .map(|file| text(&file.dest_path))
            .collect()
    }

    struct Written {
        package_json: Vec<u8>,
        warnings: Vec<String>,
    }

    impl Written {
        fn string_at(&self, keys: &[&str]) -> Option<String> {
            bun_ast::initialize_store();
            let arena = Arena::new();
            let source =
                bun_ast::Source::init_path_string(&b"package.json"[..], &self.package_json[..]);
            let mut log = Log::init();
            let mut value =
                bun_parsers::json::parse_package_json_utf8(&source, &mut log, &arena).ok()?;
            for key in keys {
                value = value.get(key.as_bytes())?;
            }
            Some(text(value.as_utf8_string_literal()?))
        }

        fn keys_at(&self, keys: &[&str]) -> Vec<String> {
            bun_ast::initialize_store();
            let arena = Arena::new();
            let source =
                bun_ast::Source::init_path_string(&b"package.json"[..], &self.package_json[..]);
            let mut log = Log::init();
            let mut value = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &arena)
                .expect("valid JSON");
            for key in keys {
                value = value.get(key.as_bytes()).expect("member");
            }
            let mut found = Vec::new();
            value.for_each_property(|key, _, _| found.push(text(key)));
            found
        }
    }

    fn write(package_json: Option<&str>, is_commonjs: bool, sources: &[&'static str]) -> Written {
        let project = Project {
            directory: b"/project".to_vec(),
            package_json: package_json.map(|contents| PackageJsonFile {
                path: b"/project/package.json".to_vec(),
                contents: contents.as_bytes().to_vec(),
            }),
        };
        let mut output_files: Vec<OutputFile> = sources
            .iter()
            .map(|&source| {
                let relative = source.strip_prefix("/project/src/").expect("in src");
                let stem = relative.strip_suffix(".ts").expect("TypeScript");
                javascript(OutputKind::EntryPoint, source, &format!("./{stem}.js"))
            })
            .collect();
        add_declaration_files(
            declarations(sources),
            b"/project/src",
            true,
            &mut output_files,
        )
        .expect("inside the root directory");
        let mut log = Log::init();
        let request = PackageRequest {
            project: &project,
            outdir: b"/project/dist",
            outdir_as_written: b"dist",
            root_directory: b"/project/src",
            entry_point_kind: OutputKind::EntryPoint,
            is_commonjs,
            compiler_options: &Vec::new(),
        };
        let package_json = write_package_json(&request, &output_files, &mut log).expect("written");
        Written {
            package_json,
            warnings: log.msgs.iter().map(|msg| text(&msg.data.text)).collect(),
        }
    }

    #[test]
    fn declaration_paths() {
        for (source, path) in [
            ("/project/src/index.ts", Some("index.d.ts")),
            ("/project/src/view.tsx", Some("view.d.ts")),
            ("/project/src/tools/index.mts", Some("tools/index.d.mts")),
            ("/project/src/old.cjs", Some("old.d.cts")),
            ("/project/src/..hidden.js", Some("..hidden.d.ts")),
            ("/project/src/data.json", None),
            ("/project/shared/util.ts", None),
        ] {
            let found = declaration_path(b"/project/src", source.as_bytes());
            assert_eq!(found.as_deref().map(text).as_deref(), path, "{source}");
        }
    }

    #[test]
    fn bundle_has_declarations_of_every_source() {
        let mut output_files = vec![javascript(
            OutputKind::EntryPoint,
            "/project/src/index.ts",
            "./index.js",
        )];
        let sources = ["/project/src/area.ts", "/project/src/index.ts"];
        let added = add_declaration_files(
            declarations(&sources),
            b"/project/src",
            true,
            &mut output_files,
        );
        assert_eq!(added, Ok(()));
        assert_eq!(
            dest_paths(&output_files),
            ["./index.js", "area.d.ts", "index.d.ts"]
        );
        assert!(!is_declaration_file(&output_files[0]));
        assert!(is_declaration_file(&output_files[1]));
    }

    #[test]
    fn transpiled_files_have_their_own_declarations_only() {
        let mut output_files = vec![javascript(
            OutputKind::Chunk,
            "/project/src/index.ts",
            "index.js",
        )];
        let sources = ["/project/src/area.ts", "/project/src/index.ts"];
        let added = add_declaration_files(
            declarations(&sources),
            b"/project/src",
            false,
            &mut output_files,
        );
        assert_eq!(added, Ok(()));
        assert_eq!(dest_paths(&output_files), ["index.js", "index.d.ts"]);
    }

    #[test]
    fn source_outside_the_root_directory() {
        let mut output_files = Vec::new();
        let error = add_declaration_files(
            declarations(&["/project/shared/util.ts"]),
            b"/project/src",
            true,
            &mut output_files,
        )
        .unwrap_err();
        let mut message = Vec::new();
        error.write_message(&mut message);
        assert_eq!(
            text(&message),
            "cannot write a declaration file for /project/shared/util.ts because it is outside \
             the root directory /project/src. Pass --root to change it"
        );
        assert!(output_files.is_empty());
    }

    #[test]
    fn package_without_a_package_json() {
        let written = write(None, false, &["/project/src/index.ts"]);
        assert_eq!(written.warnings, [""; 0]);
        let members: [(&[&str], &str); 9] = [
            (&["name"], "project"),
            (&["version"], "0.0.0"),
            (&["type"], "module"),
            (&["main"], "./index.js"),
            (&["module"], "./index.js"),
            (&["types"], "./index.d.ts"),
            (&["exports", ".", "types"], "./index.d.ts"),
            (&["exports", ".", "default"], "./index.js"),
            (&["exports", "./package.json"], "./package.json"),
        ];
        for (keys, value) in members {
            assert_eq!(written.string_at(keys).as_deref(), Some(value), "{keys:?}");
        }
        assert!(written.package_json.ends_with(b"}\n"));
    }

    #[test]
    fn commonjs_package() {
        let written = write(None, true, &["/project/src/index.ts"]);
        assert_eq!(written.string_at(&["type"]).as_deref(), Some("commonjs"));
        assert_eq!(written.string_at(&["main"]).as_deref(), Some("./index.js"));
        assert_eq!(written.string_at(&["module"]), None);
    }

    #[test]
    fn fields_of_the_project() {
        let written = write(
            Some(
                r#"{
                    "name": "@acme/shapes",
                    "version": "1.2.3",
                    "private": true,
                    "type": "commonjs",
                    "main": "dist/index.js",
                    "files": ["dist"],
                    "scripts": { "build": "bun compile --library" },
                    "sideEffects": false,
                    "dependencies": { "left-pad": "^1.3.0" },
                    "devDependencies": { "typescript": "^5" }
                }"#,
            ),
            false,
            &["/project/src/index.ts"],
        );
        assert_eq!(
            written.keys_at(&[]),
            [
                "name",
                "version",
                "type",
                "main",
                "module",
                "types",
                "exports",
                "files",
                "sideEffects",
                "dependencies"
            ]
        );
        assert_eq!(
            written.string_at(&["name"]).as_deref(),
            Some("@acme/shapes")
        );
        assert_eq!(written.string_at(&["type"]).as_deref(), Some("module"));
        assert_eq!(
            written.string_at(&["dependencies", "left-pad"]).as_deref(),
            Some("^1.3.0")
        );
    }

    #[test]
    fn one_export_for_each_entry_point() {
        let written = write(
            None,
            false,
            &[
                "/project/src/index.ts",
                "/project/src/extra.ts",
                "/project/src/tools/index.ts",
            ],
        );
        assert_eq!(
            written.keys_at(&["exports"]),
            [".", "./extra", "./tools", "./package.json"]
        );
        assert_eq!(
            written
                .string_at(&["exports", "./tools", "types"])
                .as_deref(),
            Some("./tools/index.d.ts")
        );
        assert_eq!(written.string_at(&["main"]).as_deref(), Some("./index.js"));
    }

    #[test]
    fn authored_exports_keep_their_names_and_conditions() {
        let written = write(
            Some(
                r#"{
                    "exports": {
                        ".": { "bun": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
                        "./more": "./src/extra.ts",
                        "./where": { "browser": "./src/browser.ts", "worker": { "import": "./lib/worker.mjs", "require": "./lib/worker.cjs" }, "default": "./src/server.ts" },
                        "./style.css": "./style.css",
                        "./package.json": "./package.json"
                    }
                }"#,
            ),
            false,
            &[
                "/project/src/index.ts",
                "/project/src/extra.ts",
                "/project/src/browser.ts",
                "/project/src/server.ts",
            ],
        );
        assert_eq!(
            written.warnings,
            [
                "dist/package.json has no \"require\" condition for \".\", because this build doesn't write ./dist/index.cjs",
                "dist/package.json is missing 2 conditions for \"./where\" (the first is \"worker\" > \"import\"), because this build doesn't write ./lib/worker.mjs",
                "dist/package.json has no \"./style.css\" export, because no entry point builds it",
            ]
        );
        assert_eq!(
            written.keys_at(&["exports"]),
            [".", "./more", "./where", "./package.json"]
        );
        assert_eq!(written.keys_at(&["exports", "."]), ["types", "default"]);
        assert_eq!(
            written
                .string_at(&["exports", "./more", "default"])
                .as_deref(),
            Some("./extra.js")
        );
        assert_eq!(
            written.keys_at(&["exports", "./where"]),
            ["browser", "default"]
        );
        assert_eq!(
            written
                .string_at(&["exports", "./where", "browser", "types"])
                .as_deref(),
            Some("./browser.d.ts")
        );
        assert_eq!(
            written
                .string_at(&["exports", "./where", "default", "default"])
                .as_deref(),
            Some("./server.js")
        );
        assert_eq!(written.string_at(&["main"]).as_deref(), Some("./index.js"));
    }

    #[test]
    fn executables_that_are_built() {
        let written = write(
            Some(
                r#"{
                    "name": "shapes",
                    "bin": { "shapes": "./src/cli.ts", "built": "dist/cli.js", "other": "./bin/other.js" }
                }"#,
            ),
            false,
            &["/project/src/index.ts", "/project/src/cli.ts"],
        );
        assert_eq!(
            written.warnings,
            [
                "dist/package.json has no \"other\" bin, because ./bin/other.js is not an entry point"
            ]
        );
        assert_eq!(written.keys_at(&["bin"]), ["shapes", "built"]);
        assert_eq!(
            written.string_at(&["bin", "shapes"]).as_deref(),
            Some("./cli.js")
        );
        assert_eq!(
            written.string_at(&["bin", "built"]).as_deref(),
            Some("./cli.js")
        );
    }

    #[test]
    fn executable_that_is_not_built() {
        let written = write(
            Some(r#"{ "name": "@acme/shapes", "bin": "./src/cli.ts" }"#),
            false,
            &["/project/src/index.ts"],
        );
        assert_eq!(
            written.warnings,
            ["dist/package.json has no \"shapes\" bin, because ./src/cli.ts is not an entry point"]
        );
        assert_eq!(written.string_at(&["bin"]), None);
    }
}
