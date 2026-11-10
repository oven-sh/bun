use crate::cli::script_or_command::{
    LAUNCHER_SUFFIXES, is_runnable_file, nearest_package_json, read_package_json,
};

const INDEX_FILES: [&[u8]; 4] = [b"index.ts", b"index.tsx", b"index.mts", b"index.js"];

pub(super) struct DefaultEntryPoint {
    pub(super) path: Box<[u8]>,
    pub(super) executable_name: Box<[u8]>,
}

pub(super) enum NamedEntryPoint {
    /// A path, a source file in the working directory, or a name that no installed package has.
    AsWritten,
    Executable(DefaultEntryPoint),
    /// An installed package that provides no executable of that name. The resolver finds what `import` loads.
    Library {
        executable_names: Vec<Vec<u8>>,
    },
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
    ExecutableOutsidePackage {
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
            Self::ExecutableOutsidePackage {
                package_json,
                written,
            } => write(&[
                b"\"bin\" in ",
                package_json,
                b" is \"",
                written,
                b"\", which is outside the package",
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

/// `bun compile rollup`: `written` names an executable that an installed package provides, as in `bun run rollup`.
pub(super) fn find_installed_executable(
    working_directory: &[u8],
    written: &[u8],
) -> Result<NamedEntryPoint, EntryPointError> {
    if !bun_core::strings::is_npm_package_name(written)
        || names_source_file(working_directory, written)
    {
        return Ok(NamedEntryPoint::AsWritten);
    }
    let executable_name = strip_scope(written);
    let is_scoped = executable_name.len() != written.len();
    let mut ancestor = Some(working_directory);
    while let Some(directory) = ancestor {
        let node_modules = join(directory, b"node_modules");
        let package = find_package_executable(&join(&node_modules, written), executable_name)?;
        let linked_path = match package {
            PackageExecutable::Found(_) => None,
            _ if is_scoped => None,
            _ => find_linked_executable(&node_modules, executable_name)?,
        };
        match (package, linked_path) {
            (PackageExecutable::Found(path), _) | (_, Some(path)) => {
                return Ok(NamedEntryPoint::Executable(DefaultEntryPoint {
                    path,
                    executable_name: executable_name.into(),
                }));
            }
            // As for an import, the nearest package of that name hides those further up.
            (PackageExecutable::NotProvided { executable_names }, None) => {
                return Ok(NamedEntryPoint::Library { executable_names });
            }
            (PackageExecutable::NoPackage, None) => ancestor = bun_paths::dirname(directory),
        }
    }
    Ok(NamedEntryPoint::AsWritten)
}

enum PackageExecutable {
    NoPackage,
    /// `executable_names`: what `"bin"` has instead.
    NotProvided {
        executable_names: Vec<Vec<u8>>,
    },
    Found(Box<[u8]>),
}

/// An earlier `bun compile rollup` wrote `./rollup`, which is not source.
fn names_source_file(working_directory: &[u8], name: &[u8]) -> bool {
    is_runnable_file(name, working_directory)
        && !is_native_executable(&join(working_directory, name))
}

fn is_native_executable(path: &[u8]) -> bool {
    use bun_exe_format::image::ExecutableFormat;
    let mut magic = [0u8; ExecutableFormat::MAGIC_SIZE];
    ExecutableFormat::from_magic(read_start(path, &mut magic)).is_some()
}

/// The first bytes of the file, at most as many as `buffer` holds. Nothing if it can't be read.
fn read_start<'a>(path: &[u8], buffer: &'a mut [u8]) -> &'a [u8] {
    // Otherwise opening a named pipe waits for a writer.
    let without_waiting = if cfg!(unix) { bun_sys::O::NONBLOCK } else { 0 };
    let flags = bun_sys::O::RDONLY | without_waiting;
    let length = bun_sys::File::openat(bun_core::Fd::cwd(), path, flags, 0)
        .and_then(|file| file.read_all(buffer))
        .unwrap_or(0);
    &buffer[..length]
}

/// A command-line tool such as `node_modules/rollup/dist/bin/rollup`: nothing in its name says that it is code.
pub(super) fn is_script_without_extension(working_directory: &[u8], written: &[u8]) -> bool {
    let path = join(working_directory, written);
    bun_paths::extension(&path).is_empty() && (has_script_shebang(&path) || is_named_by_bin(&path))
}

/// `#!/usr/bin/env node`, `#!/usr/local/bin/bun run`
fn has_script_shebang(path: &[u8]) -> bool {
    let mut buffer = [0u8; 256];
    let Some(start) = read_start(path, &mut buffer).strip_prefix(b"#!") else {
        return false;
    };
    let line_length = bun_core::strings::index_of_char_usize(start, b'\n').unwrap_or(start.len());
    start[..line_length]
        .split(u8::is_ascii_whitespace)
        .any(|word| matches!(bun_paths::basename(word), b"node" | b"nodejs" | b"bun"))
}

fn is_named_by_bin(path: &[u8]) -> bool {
    let Some((directory, package_json, contents)) =
        bun_paths::dirname(path).and_then(nearest_package_json)
    else {
        return false;
    };
    let executables = parse_manifest(directory, &package_json, &contents).executables;
    executables.iter().any(|it| join(directory, &it.1) == path)
}

fn find_package_executable(
    package_directory: &[u8],
    executable_name: &[u8],
) -> Result<PackageExecutable, EntryPointError> {
    let package_json = join(package_directory, b"package.json");
    let Some(contents) = read_package_json(&package_json) else {
        return Ok(PackageExecutable::NoPackage);
    };
    let mut executables = parse_manifest(package_directory, &package_json, &contents).executables;
    let Some(index) = executables.iter().position(|it| it.0 == executable_name) else {
        let executable_names = executables.into_iter().map(|it| it.0).collect();
        return Ok(PackageExecutable::NotProvided { executable_names });
    };
    let (_, written) = executables.swap_remove(index);
    if is_outside(package_directory, &join(package_directory, &written)) {
        return Err(EntryPointError::ExecutableOutsidePackage {
            package_json,
            written,
        });
    }
    match find_file(package_directory, &written) {
        Some(path) => Ok(PackageExecutable::Found(path)),
        None => Err(EntryPointError::NamedFileMissing {
            field: PackageField::Bin,
            package_json,
            written,
        }),
    }
}

/// A link in `node_modules/.bin` leads to the file. Windows and pnpm put a launcher there instead, so the package whose
/// `"bin"` has the name is searched for.
fn find_linked_executable(
    node_modules: &[u8],
    executable_name: &[u8],
) -> Result<Option<Box<[u8]>>, EntryPointError> {
    let bin_directory = join(node_modules, b".bin");
    let launcher = (LAUNCHER_SUFFIXES.iter())
        .find_map(|suffix| find_file(&bin_directory, &[executable_name, *suffix].concat()));
    let Some(launcher) = launcher else {
        return Ok(None);
    };
    if is_symbolic_link(&launcher) {
        return Ok(Some(launcher));
    }
    for package in installed_packages(node_modules) {
        let found = find_package_executable(&join(node_modules, &package), executable_name)?;
        if let PackageExecutable::Found(path) = found {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn is_symbolic_link(path: &[u8]) -> bool {
    let path = bun_core::ZBox::from_bytes(path);
    bun_sys::lstat(&path).is_ok_and(|found| {
        bun_sys::kind_from_mode(found.st_mode as _) == bun_sys::EntryKind::SymLink
    })
}

/// `name` and `@scope/name`, sorted: the order of a directory's entries differs between file systems.
fn installed_packages(node_modules: &[u8]) -> Vec<Vec<u8>> {
    let mut packages = Vec::new();
    for name in directory_entries(node_modules) {
        match name.first() {
            None | Some(b'.') => {}
            Some(b'@') => packages.extend(
                (directory_entries(&join(node_modules, &name)).iter())
                    .map(|unscoped_name| [&name[..], b"/", &unscoped_name[..]].concat()),
            ),
            Some(_) => packages.push(name),
        }
    }
    packages.sort_unstable();
    packages
}

fn directory_entries(path: &[u8]) -> Vec<Vec<u8>> {
    let mut names = Vec::new();
    let Ok(directory) = bun_sys::Dir::open(path) else {
        return names;
    };
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Ok(Some(entry)) = entries.next() {
        names.push(entry.name.slice_u8().to_vec());
    }
    names
}

fn is_outside(directory: &[u8], path: &[u8]) -> bool {
    use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
    is_parent_or_equal(directory, path) == ParentEqual::Unrelated
}

fn join(directory: &[u8], path: &[u8]) -> Vec<u8> {
    use bun_paths::platform::Auto;
    bun_paths::resolve_path::join_abs_string::<Auto>(directory, &[path]).to_vec()
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
