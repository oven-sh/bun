use crate::cli::script_or_command::{nearest_package_json, read_package_json};

const INDEX_FILES: [&[u8]; 4] = [b"index.ts", b"index.tsx", b"index.mts", b"index.js"];

pub(super) struct DefaultEntryPoint {
    pub(super) path: Box<[u8]>,
    pub(super) executable_name: Box<[u8]>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum EntryPointError {
    NoProject {
        directory: Vec<u8>,
    },
    NoEntryPointNamed {
        package_json: Vec<u8>,
    },
    NamedFileMissing {
        field: PackageField,
        package_json: Vec<u8>,
        written: Vec<u8>,
    },
    SeveralExecutables {
        package_json: Vec<u8>,
        package_name: Vec<u8>,
        // (executable name, path as written)
        entries: Vec<(Vec<u8>, Vec<u8>)>,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(super) enum PackageField {
    Bin,
    Module,
    Main,
}

impl PackageField {
    pub(super) fn name(self) -> &'static [u8] {
        match self {
            PackageField::Bin => b"bin",
            PackageField::Module => b"module",
            PackageField::Main => b"main",
        }
    }
}

impl EntryPointError {
    pub(super) fn write_message(&self, out: &mut Vec<u8>) {
        let mut write = |parts: &[&[u8]]| out.extend_from_slice(&parts.concat());
        let index_files = index_file_list();
        match self {
            Self::NoProject { directory } => write(&[
                b"No entry point. There is no package.json and no ",
                &index_files,
                b" in ",
                directory,
            ]),
            Self::NoEntryPointNamed { package_json } => write(&[
                b"No entry point. ",
                package_json,
                b" has no \"bin\", \"module\" or \"main\", and there is no ",
                &index_files,
                b" next to it",
            ]),
            Self::NamedFileMissing {
                field,
                package_json,
                written,
            } => write(&[
                b"\"",
                field.name(),
                b"\" in ",
                package_json,
                b" is \"",
                written,
                b"\", which is not a file",
            ]),
            Self::SeveralExecutables {
                package_json,
                package_name,
                entries,
            } => {
                write(&[
                    b"\"bin\" in ",
                    package_json,
                    b" has ",
                    entries.len().to_string().as_bytes(),
                    b" entries, and none is named \"",
                    package_name,
                    b"\". Choose one:",
                ]);
                for (name, written) in entries {
                    write(&[b"\n  bun compile ", written, b" --outfile ", name]);
                }
            }
        }
    }
}

fn index_file_list() -> Vec<u8> {
    let [first_files @ .., last_file] = &INDEX_FILES;
    [&first_files.join(&b", "[..])[..], b" or ", *last_file].concat()
}

pub(super) fn find_default_entry_point(
    working_directory: &[u8],
) -> Result<DefaultEntryPoint, EntryPointError> {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::join_abs_string;
    let package_json = join_abs_string::<Auto>(working_directory, &[b"package.json"]).to_vec();
    if let Some(contents) = read_package_json(&package_json) {
        return find_package_entry_point(working_directory, package_json, &contents);
    }
    if let Some(path) = find_index_file(working_directory) {
        return Ok(DefaultEntryPoint {
            path,
            executable_name: bun_paths::basename(working_directory).into(),
        });
    }
    match bun_paths::dirname(working_directory).and_then(nearest_package_json) {
        Some((directory, package_json, contents)) => {
            find_package_entry_point(directory, package_json, &contents)
        }
        None => Err(EntryPointError::NoProject {
            directory: working_directory.to_vec(),
        }),
    }
}

fn find_package_entry_point(
    directory: &[u8],
    package_json: Vec<u8>,
    contents: &[u8],
) -> Result<DefaultEntryPoint, EntryPointError> {
    let manifest = parse_manifest(directory, &package_json, contents);
    let package_name = manifest.name;
    let mut executables = manifest.executables;
    let executable = match executables.len() {
        0 | 1 => executables.pop(),
        _ => {
            let Some(index) = executables.iter().position(|it| it.0 == package_name) else {
                return Err(EntryPointError::SeveralExecutables {
                    package_json,
                    package_name,
                    entries: executables,
                });
            };
            Some(executables.swap_remove(index))
        }
    };
    let (field, executable_name, written) = match (executable, manifest.module, manifest.main) {
        (Some((name, written)), ..) => (PackageField::Bin, name, written),
        (None, Some(written), _) => (PackageField::Module, package_name, written),
        (None, None, Some(written)) => (PackageField::Main, package_name, written),
        (None, None, None) => {
            return match find_index_file(directory) {
                Some(path) => Ok(DefaultEntryPoint {
                    path,
                    executable_name: package_name.into(),
                }),
                None => Err(EntryPointError::NoEntryPointNamed { package_json }),
            };
        }
    };
    match find_file(directory, &written) {
        Some(path) => Ok(DefaultEntryPoint {
            path,
            executable_name: executable_name.into(),
        }),
        None => Err(EntryPointError::NamedFileMissing {
            field,
            package_json,
            written,
        }),
    }
}

struct PackageManifest {
    name: Vec<u8>,
    // (executable name, path as written)
    executables: Vec<(Vec<u8>, Vec<u8>)>,
    module: Option<Vec<u8>>,
    main: Option<Vec<u8>>,
}

fn parse_manifest(directory: &[u8], package_json: &[u8], contents: &[u8]) -> PackageManifest {
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(package_json, contents);
    let (mut log, arena) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    let root = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &arena)
        .unwrap_or_default();
    let string_member = |name: &[u8]| -> Option<Vec<u8>> {
        Some(root.get(name)?.as_utf8_string_literal()?.to_vec())
    };
    let written_name = string_member(b"name").unwrap_or_default();
    let name = match strip_scope(&written_name) {
        b"" => bun_paths::basename(directory),
        unscoped_name => unscoped_name,
    }
    .to_vec();
    let mut executables = Vec::new();
    if let Some(bin) = root.get(PackageField::Bin.name()) {
        match bin.as_utf8_string_literal() {
            Some(written) => executables.push((name.clone(), written.to_vec())),
            None => bin.for_each_property(|key, _, value| {
                if let Some(written) = value.as_utf8_string_literal() {
                    executables.push((bun_paths::basename(key).to_vec(), written.to_vec()));
                }
            }),
        }
    }
    PackageManifest {
        name,
        executables,
        module: string_member(PackageField::Module.name()),
        main: string_member(PackageField::Main.name()),
    }
}

fn strip_scope(package_name: &[u8]) -> &[u8] {
    let after_last_slash = package_name.rsplit(|&byte| byte == b'/').next();
    after_last_slash.unwrap_or(package_name)
}

fn find_index_file(directory: &[u8]) -> Option<Box<[u8]>> {
    INDEX_FILES
        .iter()
        .find_map(|name| find_file(directory, name))
}

fn find_file(directory: &[u8], path: &[u8]) -> Option<Box<[u8]>> {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::join_abs_string_checked;
    let absolute_path = join_abs_string_checked::<Auto>(directory, &[path])?;
    if absolute_path.contains(&0) {
        return None;
    }
    let absolute_path = bun_core::ZBox::from_bytes(absolute_path);
    match bun_sys::exists_at_type(bun_core::Fd::cwd(), &absolute_path) {
        Ok(bun_sys::ExistsAtType::File) => Some(absolute_path.as_bytes().into()),
        Ok(bun_sys::ExistsAtType::Directory) | Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    type Found = Result<(String, String), EntryPointError>;

    static PROJECT_COUNT: AtomicU32 = AtomicU32::new(0);

    struct Project {
        directory: PathBuf,
    }

    impl Project {
        fn new(files: &[(&str, &str)]) -> Project {
            let number = PROJECT_COUNT.fetch_add(1, Ordering::Relaxed);
            let name = format!("bun-compile-entry-points-{}-{number}", std::process::id());
            let project = Project {
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

        fn with_package_json(package_json: &str) -> Project {
            Project::new(&[
                ("package.json", package_json),
                ("index.ts", ""),
                ("src/cli.ts", ""),
            ])
        }

        fn path(&self, relative_path: &str) -> String {
            let mut path = self.directory.clone();
            path.extend(relative_path.split('/').filter(|part| !part.is_empty()));
            path.into_os_string().into_string().expect("UTF-8 path")
        }

        fn name(&self) -> &str {
            let name = self.directory.file_name().expect("directory name");
            name.to_str().expect("UTF-8 name")
        }

        fn find_in(&self, folder: &str) -> Found {
            let found = find_default_entry_point(self.path(folder).as_bytes())?;
            Ok((text(&found.path), text(&found.executable_name)))
        }

        fn find(&self) -> Found {
            self.find_in("")
        }

        fn found(&self, relative_path: &str, executable_name: &str) -> Found {
            Ok((self.path(relative_path), executable_name.to_owned()))
        }

        fn missing(&self, field: PackageField, written: &str) -> Found {
            Err(EntryPointError::NamedFileMissing {
                field,
                package_json: self.path("package.json").into_bytes(),
                written: written.as_bytes().to_vec(),
            })
        }
    }

    impl Drop for Project {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }

    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    fn message(error: &EntryPointError) -> String {
        let mut out = Vec::new();
        error.write_message(&mut out);
        text(&out)
    }

    fn assert_finds(package_json: &str, entry_point: &str, executable_name: &str) {
        let project = Project::with_package_json(package_json);
        assert_eq!(
            project.find(),
            project.found(entry_point, executable_name),
            "{package_json}"
        );
    }

    #[test]
    fn bin_string_precedes_module() {
        assert_finds(
            r#"{ "name": "tool", "bin": "./src/cli.ts", "module": "./index.ts" }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn single_bin_member() {
        assert_finds(
            r#"{ "name": "tool", "bin": { "other-name": "src/cli.ts" }, "main": "./index.ts" }"#,
            "src/cli.ts",
            "other-name",
        );
    }

    #[test]
    fn bin_matches_package_name() {
        assert_finds(
            r#"{ "name": "tool", "bin": { "helper": "./index.ts", "tool": "./src/cli.ts" } }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn module_precedes_main() {
        assert_finds(
            r#"{ "name": "tool", "module": "src/cli.ts", "main": "index.ts" }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn main_precedes_index_file() {
        assert_finds(
            r#"{ "name": "tool", "main": "src/cli.ts" }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn package_index_file() {
        assert_finds(r#"{ "name": "tool" }"#, "index.ts", "tool");
    }

    #[test]
    fn scoped_package_name() {
        assert_finds(
            r#"{ "name": "@scope/tool", "bin": "./src/cli.ts" }"#,
            "src/cli.ts",
            "tool",
        );
        assert_finds(
            r#"{ "name": "@scope/tool", "bin": { "helper": "index.ts", "tool": "src/cli.ts" } }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn missing_package_name() {
        for name in [
            "",
            r#""name": "","#,
            r#""name": 1,"#,
            r#""name": "@scope/","#,
        ] {
            let package_json = format!(r#"{{ {name} "main": "src/cli.ts" }}"#);
            let project = Project::with_package_json(&package_json);
            assert_eq!(
                project.find(),
                project.found("src/cli.ts", project.name()),
                "{package_json}"
            );
        }
    }

    #[test]
    fn unusable_bin() {
        for bin in [
            "{}",
            "1",
            "null",
            r#"["index.ts"]"#,
            r#"{ "a": 1, "b": null }"#,
        ] {
            assert_finds(
                &format!(r#"{{ "name": "tool", "bin": {bin}, "module": "src/cli.ts" }}"#),
                "src/cli.ts",
                "tool",
            );
        }
    }

    #[test]
    fn non_string_bin_members() {
        assert_finds(
            r#"{ "name": "tool", "bin": { "a": 1, "b": "src/cli.ts" } }"#,
            "src/cli.ts",
            "b",
        );
    }

    #[test]
    fn bin_key_with_separator() {
        assert_finds(
            r#"{ "name": "tool", "bin": { "nested/other-name": "src/cli.ts" } }"#,
            "src/cli.ts",
            "other-name",
        );
    }

    #[test]
    fn non_string_module() {
        assert_finds(
            r#"{ "name": "tool", "module": ["index.ts"], "main": "src/cli.ts" }"#,
            "src/cli.ts",
            "tool",
        );
    }

    #[test]
    fn non_string_main() {
        assert_finds(r#"{ "name": "tool", "main": {} }"#, "index.ts", "tool");
    }

    #[test]
    fn unusable_package_json() {
        for package_json in ["[]", "{", "", "1"] {
            let project = Project::with_package_json(package_json);
            assert_eq!(
                project.find(),
                project.found("index.ts", project.name()),
                "{package_json}"
            );
        }
    }

    #[test]
    fn index_file_alone() {
        for file in ["index.ts", "index.tsx", "index.mts", "index.js"] {
            let project = Project::new(&[(file, "")]);
            assert_eq!(project.find(), project.found(file, project.name()));
        }
    }

    #[test]
    fn index_file_order() {
        let project = Project::new(&[("index.js", ""), ("index.mts", ""), ("index.tsx", "")]);
        assert_eq!(project.find(), project.found("index.tsx", project.name()));
    }

    #[test]
    fn package_json_directory() {
        let project = Project::new(&[("package.json/notes.txt", ""), ("index.ts", "")]);
        assert_eq!(project.find(), project.found("index.ts", project.name()));
    }

    #[test]
    fn index_file_under_package() {
        let project = Project::new(&[
            ("package.json", r#"{ "main": "main.ts" }"#),
            ("main.ts", ""),
            ("scratch/index.ts", ""),
        ]);
        assert_eq!(
            project.find_in("scratch"),
            project.found("scratch/index.ts", "scratch")
        );
    }

    #[test]
    fn package_subfolder() {
        let project = Project::new(&[
            (
                "package.json",
                r#"{ "name": "tool", "module": "src/cli.ts" }"#,
            ),
            ("src/cli.ts", ""),
            ("src/commands/run.ts", ""),
        ]);
        assert_eq!(
            project.find_in("src/commands"),
            project.found("src/cli.ts", "tool")
        );
    }

    #[test]
    fn no_project() {
        let project = Project::new(&[]);
        let directory = project.path("");
        let error = project.find().unwrap_err();
        assert_eq!(
            message(&error),
            format!(
                "No entry point. There is no package.json and no index.ts, index.tsx, index.mts \
                 or index.js in {directory}"
            )
        );
        assert_eq!(
            error,
            EntryPointError::NoProject {
                directory: directory.into_bytes(),
            }
        );
    }

    #[test]
    fn no_entry_point_named() {
        let project = Project::new(&[("package.json", r#"{ "name": "tool" }"#)]);
        let package_json = project.path("package.json");
        let error = project.find().unwrap_err();
        assert_eq!(
            message(&error),
            format!(
                "No entry point. {package_json} has no \"bin\", \"module\" or \"main\", and there \
                 is no index.ts, index.tsx, index.mts or index.js next to it"
            )
        );
        assert_eq!(
            error,
            EntryPointError::NoEntryPointNamed {
                package_json: package_json.into_bytes(),
            }
        );
    }

    #[test]
    fn missing_bin_file() {
        let project = Project::with_package_json(
            r#"{ "name": "tool", "bin": "./dist/cli.js", "module": "index.ts" }"#,
        );
        assert_eq!(
            project.find(),
            project.missing(PackageField::Bin, "./dist/cli.js")
        );
        assert_eq!(
            message(&project.find().unwrap_err()),
            format!(
                r#""bin" in {} is "./dist/cli.js", which is not a file"#,
                project.path("package.json")
            )
        );
    }

    #[test]
    fn missing_module_file() {
        let project = Project::with_package_json(r#"{ "module": "dist.js", "main": "index.ts" }"#);
        assert_eq!(
            project.find(),
            project.missing(PackageField::Module, "dist.js")
        );
        assert_eq!(
            message(&project.find().unwrap_err()),
            format!(
                r#""module" in {} is "dist.js", which is not a file"#,
                project.path("package.json")
            )
        );
    }

    #[test]
    fn missing_main_file() {
        let project = Project::with_package_json(r#"{ "main": "dist.js" }"#);
        assert_eq!(
            project.find(),
            project.missing(PackageField::Main, "dist.js")
        );
        assert_eq!(
            message(&project.find().unwrap_err()),
            format!(
                r#""main" in {} is "dist.js", which is not a file"#,
                project.path("package.json")
            )
        );
    }

    #[test]
    fn named_directory() {
        let project = Project::with_package_json(r#"{ "bin": "src", "main": "index.ts" }"#);
        assert_eq!(project.find(), project.missing(PackageField::Bin, "src"));
    }

    #[test]
    fn unrepresentable_path() {
        let oversized = "a".repeat(8192);
        let project = Project::with_package_json(&format!(r#"{{ "main": "{oversized}" }}"#));
        assert_eq!(
            project.find(),
            project.missing(PackageField::Main, &oversized)
        );

        let project = Project::with_package_json(r#"{ "main": "src/cli.ts\u0000.map" }"#);
        assert_eq!(
            project.find(),
            project.missing(PackageField::Main, "src/cli.ts\0.map")
        );
    }

    #[test]
    fn several_executables() {
        let project = Project::new(&[
            (
                "package.json",
                r#"{ "name": "tool", "bin": { "b": "./b.ts", "a": "./a.ts", "c": 1 } }"#,
            ),
            ("a.ts", ""),
            ("b.ts", ""),
        ]);
        let package_json = project.path("package.json");
        let error = project.find().unwrap_err();
        assert_eq!(
            message(&error),
            format!(
                "\"bin\" in {package_json} has 2 entries, and none is named \"tool\". Choose one:\n\
                 \x20 bun compile ./b.ts --outfile b\n\
                 \x20 bun compile ./a.ts --outfile a"
            )
        );
        assert_eq!(
            error,
            EntryPointError::SeveralExecutables {
                package_json: package_json.into_bytes(),
                package_name: b"tool".to_vec(),
                entries: vec![
                    (b"b".to_vec(), b"./b.ts".to_vec()),
                    (b"a".to_vec(), b"./a.ts".to_vec()),
                ],
            }
        );
    }
}
