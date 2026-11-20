//! Reads the packages that a package ships in its own `node_modules`.

use bun_core::strings;
use bun_semver::{SlicedString, Version};
use bun_sys::{self as sys, Dir, EntryKind, O};

use crate::bun_json::{E, ExprData, ParsedJson};
use crate::dependency::is_safe_lockfile_package_name;
use crate::package_installer::alias_is_safe_install_target;

/// The levels of `node_modules` that are read below one bundler.
pub const MAX_DEPTH: usize = 32;
/// The folders that are looked at below one bundler.
pub const MAX_FOLDERS: usize = 1 << 14;

const NODE_MODULES: &[u8] = b"node_modules";

pub struct BundleContents {
    /// Depth first: a folder, then its `node_modules` in the byte order of the folder names.
    pub folders: Box<[ShippedFolder]>,
    /// `MAX_DEPTH` or `MAX_FOLDERS` ended the walk before it had read everything.
    pub truncated: bool,
    /// The first read that failed for another reason than that its entry is absent. The walk
    /// ended there and `folders` is empty: what the package ships is not known.
    pub error: Option<sys::Error>,
}

pub struct ShippedFolder {
    /// From the bundler's folder, with `/`: `node_modules/a/node_modules/@scope/b`.
    pub path: Box<[u8]>,
    folder_name_at: u32,
    /// The `name` in its package.json, or the folder name if a lockfile cannot hold that one.
    pub name: Box<[u8]>,
    /// Trimmed text that `Version::parse_exact` accepts.
    pub version: Box<[u8]>,
    /// Sorted by name, each name once, and none that `optional_dependencies` has.
    pub dependencies: Box<[DeclaredDependency]>,
    /// Sorted by name, each name once.
    pub optional_dependencies: Box<[DeclaredDependency]>,
    /// Index in `BundleContents::folders` of the folder whose `node_modules` holds this one.
    /// `None` in the `node_modules` of the bundler.
    pub parent: Option<u32>,
}

impl ShippedFolder {
    /// `a` or `@scope/b`.
    pub fn folder_name(&self) -> &[u8] {
        &self.path[self.folder_name_at as usize..]
    }
}

pub struct DeclaredDependency {
    /// Passes `alias_is_safe_install_target`.
    pub name: Box<[u8]>,
    /// The value as the package.json has it.
    pub range: Box<[u8]>,
}

/// `dir` is the folder of the bundler. `only_names` are the only folders read from its own
/// `node_modules`, for a folder that no archive made. A folder whose package.json is not JSON with
/// a semver `version` is left out with all that is below it, and no symlink is followed.
///
/// The caller must initialize an AST store on this thread first. It is not reset here.
pub fn read_bundle(dir: &Dir, only_names: Option<&[&[u8]]>) -> BundleContents {
    let mut reader = Reader {
        folders: Vec::new(),
        path: Vec::new(),
        looked_at: 0,
        truncated: false,
    };
    match reader.read_node_modules(dir, None, 0, only_names) {
        Ok(()) => BundleContents {
            folders: reader.folders.into_boxed_slice(),
            truncated: reader.truncated,
            error: None,
        },
        Err(error) => BundleContents {
            folders: Box::default(),
            truncated: false,
            error: Some(error),
        },
    }
}

struct Reader {
    folders: Vec<ShippedFolder>,
    /// Of the package whose `node_modules` is read, with a `/` at its end. Empty for the bundler.
    path: Vec<u8>,
    looked_at: usize,
    truncated: bool,
}

impl Reader {
    fn read_node_modules(
        &mut self,
        package: &Dir,
        parent: Option<u32>,
        depth: usize,
        only_names: Option<&[&[u8]]>,
    ) -> sys::Maybe<()> {
        let Some(node_modules) = open_folder(package, NODE_MODULES)? else {
            return Ok(());
        };
        if depth == MAX_DEPTH {
            self.truncated = true;
            return Ok(());
        }
        let mut names: Vec<Vec<u8>> = match only_names {
            Some(names) => names
                .iter()
                .filter(|name| is_folder_name(name))
                .map(|name| name.to_vec())
                .collect(),
            None => folder_names(&node_modules)?,
        };
        // The order in which a directory lists its entries is not defined.
        names.sort_unstable();
        names.dedup();

        let package_path_len = self.path.len();
        self.path.extend_from_slice(NODE_MODULES);
        self.path.push(b'/');
        let folder_name_at = self.path.len();
        for name in &names {
            if self.looked_at == MAX_FOLDERS {
                self.truncated = true;
                break;
            }
            self.looked_at += 1;
            let Some(folder) = open_folder(&node_modules, name)? else {
                continue;
            };
            let Some(manifest) = read_manifest(&folder, name)? else {
                continue;
            };
            self.path.extend_from_slice(name);
            // `MAX_FOLDERS` and `MAX_DEPTH` keep both far below `u32::MAX`.
            let index = self.folders.len() as u32;
            self.folders.push(ShippedFolder {
                path: self.path.as_slice().into(),
                folder_name_at: folder_name_at as u32,
                name: manifest.name,
                version: manifest.version,
                dependencies: manifest.dependencies,
                optional_dependencies: manifest.optional_dependencies,
                parent,
            });
            self.path.push(b'/');
            self.read_node_modules(&folder, Some(index), depth + 1, None)?;
            self.path.truncate(folder_name_at);
        }
        self.path.truncate(package_path_len);
        Ok(())
    }
}

/// `name` or `@scope/name`, as a path below `node_modules` and as a key in bun.lock.
fn is_folder_name(name: &[u8]) -> bool {
    alias_is_safe_install_target(name) && is_safe_lockfile_package_name(name)
}

fn folder_names(node_modules: &Dir) -> sys::Maybe<Vec<Vec<u8>>> {
    let mut names: Vec<Vec<u8>> = Vec::new();
    each_folder(node_modules, |name| {
        if name[0] != b'@' {
            if is_folder_name(name) {
                names.push(name.to_vec());
            }
            return Ok(());
        }
        let Some(scope) = open_real_subdir(node_modules, name)? else {
            return Ok(());
        };
        each_folder(&scope, |unscoped| {
            let mut scoped = Vec::with_capacity(name.len() + 1 + unscoped.len());
            scoped.extend_from_slice(name);
            scoped.push(b'/');
            scoped.extend_from_slice(unscoped);
            if is_folder_name(&scoped) {
                names.push(scoped);
            }
            Ok(())
        })
    })?;
    Ok(names)
}

/// An entry whose kind the listing does not know is passed on: `open_folder` opens real folders
/// only.
fn each_folder(dir: &Dir, mut each: impl FnMut(&[u8]) -> sys::Maybe<()>) -> sys::Maybe<()> {
    let mut entries = sys::iterate_dir(dir.fd());
    while let Some(entry) = entries.next()? {
        let name = entry.name.slice_u8();
        if matches!(name.first(), None | Some(b'.')) {
            continue;
        }
        if matches!(entry.kind, EntryKind::Directory | EntryKind::Unknown) {
            each(name)?;
        }
    }
    Ok(())
}

/// `name` or `@scope/name` below `dir`. `None`: no real folder is there.
fn open_folder(dir: &Dir, alias: &[u8]) -> sys::Maybe<Option<Dir>> {
    match strings::split_once_char(alias, b'/') {
        Some((scope, name)) if alias.first() == Some(&b'@') => {
            match open_real_subdir(dir, scope)? {
                Some(scope_dir) => open_real_subdir(&scope_dir, name),
                None => Ok(None),
            }
        }
        _ => open_real_subdir(dir, alias),
    }
}

fn open_real_subdir(dir: &Dir, name: &[u8]) -> sys::Maybe<Option<Dir>> {
    if kind_of(dir, name)? != Some(EntryKind::Directory) {
        return Ok(None);
    }
    unless_absent(dir.open_at_with(name, O::RDONLY | O::CLOEXEC | O::NOFOLLOW))
}

/// Of `name` itself, not of what a link there leads to. `None`: nothing is there.
fn kind_of(dir: &Dir, name: &[u8]) -> sys::Maybe<Option<EntryKind>> {
    Ok(unless_absent(lstat(dir, name))?.map(|st| sys::kind_from_mode(st.st_mode as sys::Mode)))
}

/// Only an entry that is absent is one that the package does not ship.
fn unless_absent<T>(result: sys::Maybe<T>) -> sys::Maybe<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(err) if matches!(err.get_errno(), sys::E::ENOENT | sys::E::ENOTDIR) => Ok(None),
        Err(err) => Err(err),
    }
}

#[cfg(not(windows))]
fn lstat(dir: &Dir, name: &[u8]) -> sys::Maybe<sys::Stat> {
    sys::lstatat(dir.fd(), &bun_core::ZBox::from_bytes(name))
}

// `sys::lstatat` fstats the opened reparse point, which reports junctions as directories.
#[cfg(windows)]
fn lstat(dir: &Dir, name: &[u8]) -> sys::Maybe<sys::Stat> {
    let mut dir_buf = bun_paths::path_buffer_pool::get();
    let dir_path = dir.get_fd_path(&mut dir_buf)?;
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let path = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Auto>(
        &mut path_buf[..],
        &[&*dir_path, name],
    );
    sys::lstat(path)
}

struct Manifest {
    name: Box<[u8]>,
    version: Box<[u8]>,
    dependencies: Box<[DeclaredDependency]>,
    optional_dependencies: Box<[DeclaredDependency]>,
}

/// `None`: the folder is not a package that a lockfile can record.
fn read_manifest(folder: &Dir, folder_name: &[u8]) -> sys::Maybe<Option<Manifest>> {
    let contents = match crate::git_runner::read_package_json_in(folder) {
        Ok(contents) => contents,
        // A package.json that is a link or a folder is content of the package, not a failed read.
        Err(err) => {
            return match kind_of(folder, b"package.json")? {
                Some(EntryKind::File) => Err(err),
                _ => Ok(None),
            };
        }
    };
    Ok(parse_manifest(&contents, folder_name))
}

fn parse_manifest(contents: &[u8], folder_name: &[u8]) -> Option<Manifest> {
    let source = bun_ast::Source::init_path_string("package.json", contents);
    // Its locations borrow `contents`.
    let mut log = bun_ast::Log::init();
    let parsed = ParsedJson::parse_package_json(&source, &mut log).ok()?;
    let ExprData::EObjectJSON(root) = &parsed.root.data else {
        return None;
    };
    let root = root.get();

    let version = strings::trim(root.get(b"version")?.as_str()?, &strings::WHITESPACE_CHARS);
    Version::parse_exact(SlicedString::init(version, version))?;
    let name = match root.get(b"name").and_then(E::JsonValue::as_str) {
        Some(name) if is_safe_lockfile_package_name(name) => name,
        _ => folder_name,
    };
    let optional_dependencies = declared(root.get(b"optionalDependencies"), &[]);
    let dependencies = declared(root.get(b"dependencies"), &optional_dependencies);
    Some(Manifest {
        name: name.into(),
        version: version.into(),
        dependencies,
        optional_dependencies,
    })
}

/// `overriding` is sorted by name, and a row with one of its names is left out.
fn declared(
    group: Option<&E::JsonValue>,
    overriding: &[DeclaredDependency],
) -> Box<[DeclaredDependency]> {
    let Some(group) = group.and_then(E::JsonValue::as_object) else {
        return Box::default();
    };
    let mut rows: Vec<DeclaredDependency> = Vec::new();
    for property in group.properties() {
        let name = property.key.slice();
        let Some(range) = property.value.as_str() else {
            continue;
        };
        if !alias_is_safe_install_target(name)
            || overriding
                .binary_search_by(|row| (*row.name).cmp(name))
                .is_ok()
        {
            continue;
        }
        rows.push(DeclaredDependency {
            name: name.into(),
            range: range.into(),
        });
    }
    // The last of the rows with one name is the one that JSON.parse keeps.
    rows.reverse();
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    rows.dedup_by(|row, kept| row.name == kept.name);
    rows.into_boxed_slice()
}
