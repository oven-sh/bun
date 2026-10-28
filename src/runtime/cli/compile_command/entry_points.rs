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
    let root =
        bun_parsers::json::parse_package_json_utf8(&source, &mut log, &arena).unwrap_or_default();
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
    if bun_core::strings::contains_char(absolute_path, 0) {
        return None;
    }
    let absolute_path = bun_core::ZBox::from_bytes(absolute_path);
    match bun_sys::exists_at_type(bun_core::Fd::cwd(), &absolute_path) {
        Ok(bun_sys::ExistsAtType::File) => Some(absolute_path.as_bytes().into()),
        Ok(bun_sys::ExistsAtType::Directory) | Err(_) => None,
    }
}
