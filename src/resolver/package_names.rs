//! What a build asks so that an executable finds its entry points by the names of their packages.

use core::ptr::NonNull;

use bun_ast::{ImportKind, Log};
use bun_paths::is_sep_native;

use crate::compiled_program::{compare_source_paths, normalize_separator, public_path_from_root};
use crate::package_json::Package;
use crate::resolver::{Resolver, TSConfigRef};

/// A file or a folder: where it is on the disk of the build, and where in the executable.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct BuildPaths<'a> {
    pub source_path: &'a [u8],
    pub public_path: &'a [u8],
}

/// `compiled_program::CompiledPackageName`, with positions in the list of entry points that was asked about.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PackageName {
    pub public_path: Vec<u8>,
    pub required: Option<u32>,
    pub imported: Option<u32>,
    pub hides_other_paths: bool,
    pub is_hidden_from_require: bool,
    pub is_hidden_from_import: bool,
}

/// A name that the build asked for from `directory`, and that the "exports" of its package turned away.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RefusedName {
    pub directory: Vec<u8>,
    pub specifier: Vec<u8>,
    pub is_require: bool,
}

/// `compiled_program::CompiledPathAlias`
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PathAlias {
    pub folder: Vec<u8>,
    pub key: Vec<u8>,
    pub target: Vec<u8>,
    pub is_base_url: bool,
}

/// A name that code from disk may ask for and that leads to a file of the program, which need not be an entry point: public paths.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FurtherPackageName {
    pub path: Vec<u8>,
    pub required: Option<Vec<u8>>,
    pub imported: Option<Vec<u8>>,
    pub hides_other_paths: bool,
}

const NODE_MODULES: &[u8] = b"node_modules";

fn native_separator(byte: u8) -> u8 {
    if cfg!(windows) && byte == b'/' {
        b'\\'
    } else {
        byte
    }
}

fn last_component(path: &[u8]) -> &[u8] {
    &path[path
        .iter()
        .rposition(|&byte| is_sep_native(byte))
        .map_or(0, |separator| separator + 1)..]
}

fn parent(path: &[u8]) -> Option<&[u8]> {
    let separator = path.iter().rposition(|&byte| is_sep_native(byte))?;
    (separator > 0).then_some(&path[..separator])
}

/// The name of the package that the file belongs to by its place below the innermost `node_modules`.
fn find_name_of_package(file: &[u8]) -> Option<Vec<u8>> {
    let mut below: [&[u8]; 2] = [b"", b""];
    let mut folder = parent(file)?;
    while last_component(folder) != NODE_MODULES {
        below = [last_component(folder), below[0]];
        folder = parent(folder)?;
    }
    match below {
        [b"", _] => None,
        [scope, b""] if scope.starts_with(b"@") => None,
        [scope, name] if scope.starts_with(b"@") => Some([scope, b"/", name].concat()),
        [name, _] => Some(name.to_vec()),
    }
}

/// What is left of `path` behind `folder`. The compiler writes `C:/a/b.js` where the resolver writes `C:\a\b.js`.
fn strip_folder<'p>(path: &'p [u8], folder: &[u8]) -> Option<&'p [u8]> {
    let (start, rest) = path.split_at_checked(folder.len())?;
    compare_source_paths(start, folder).is_eq().then_some(rest)
}

/// The folder and those above it for as long as both of its paths go up together.
fn with_folders_above<'a>(folder: BuildPaths<'a>) -> impl Iterator<Item = BuildPaths<'a>> {
    core::iter::successors(Some(folder), |folder| {
        if last_component(folder.source_path) != last_component(folder.public_path) {
            return None;
        }
        Some(BuildPaths {
            source_path: parent(folder.source_path)?,
            public_path: parent(folder.public_path)?,
        })
    })
}

/// The folders and those above them, but for `node_modules` folders. A folder comes after those above it.
fn list_places<'a>(folders: &[BuildPaths<'a>]) -> Vec<BuildPaths<'a>> {
    let mut places: Vec<BuildPaths<'a>> = folders
        .iter()
        .copied()
        .flat_map(with_folders_above)
        .collect();
    places.retain(|place| last_component(place.source_path) != NODE_MODULES);
    places.sort_unstable();
    places.dedup();
    places
}

fn is_inside_node_modules(folder: &[u8]) -> bool {
    folder
        .split(|&byte| is_sep_native(byte))
        .any(|component| component == NODE_MODULES)
}

/// `path` as a specifier relative to `folder`. Both are absolute.
fn to_relative_specifier(folder: &[u8], path: &[u8]) -> Option<Vec<u8>> {
    let relative = bun_paths::resolve_path::relative_alloc(folder, path).ok()?;
    if bun_paths::is_absolute(&relative) {
        return None;
    }
    let with_slash = |&byte: &u8| if is_sep_native(byte) { b'/' } else { byte };
    let relative: Vec<u8> = relative.iter().map(with_slash).collect();
    match relative.starts_with(b"../") || relative == b".." {
        true => Some(relative),
        false => Some([b"./", &relative[..]].concat()),
    }
}

/// `names` and the names that the program itself writes for `entry_points`: the public path that each would have as a file, and the file that it leads to.
pub fn add_written_names(
    mut names: Vec<PackageName>,
    written: &[BuildPaths<'_>],
    entry_points: &[BuildPaths<'_>],
) -> Vec<PackageName> {
    for name in written {
        let is_named = |entry_point: &BuildPaths<'_>| {
            compare_source_paths(entry_point.source_path, name.source_path).is_eq()
        };
        let Some(position) = entry_points.iter().position(is_named) else {
            continue;
        };
        let public_path = name.public_path.iter().copied();
        names.push(PackageName {
            public_path: public_path.map(normalize_separator).collect(),
            required: Some(position as u32),
            imported: Some(position as u32),
            hides_other_paths: false,
            is_hidden_from_require: false,
            is_hidden_from_import: false,
        });
    }
    names.sort_by(|a, b| a.public_path.cmp(&b.public_path));
    names.dedup_by(|later, earlier| later.public_path == earlier.public_path);
    names
}

/// `names` and `hidden`, each name once.
pub fn add_hidden_names(mut names: Vec<PackageName>, hidden: Vec<PackageName>) -> Vec<PackageName> {
    names.extend(hidden);
    names.sort_by(|a, b| a.public_path.cmp(&b.public_path));
    names.dedup_by(|later, earlier| {
        let is_same = later.public_path == earlier.public_path;
        earlier.is_hidden_from_require |= is_same && later.is_hidden_from_require;
        earlier.is_hidden_from_import |= is_same && later.is_hidden_from_import;
        is_same
    });
    names
}

impl Resolver<'_> {
    fn find_entry_point_named(
        &mut self,
        folder: &[u8],
        specifier: &'static [u8],
        kind: ImportKind,
        entry_points: &[BuildPaths<'_>],
    ) -> Option<u32> {
        let found = self.resolve(folder, specifier, kind).ok()?;
        let path = found.path_pair.primary.text();
        let position = entry_points
            .iter()
            .position(|entry_point| compare_source_paths(entry_point.source_path, path).is_eq());
        position.map(|index| index as u32)
    }

    /// What code from disk finds by the name of a package of the program, and by the name of the program itself, wherever that code lies: names below the root directory.
    pub fn find_further_package_names(
        &mut self,
        files: &[BuildPaths<'_>],
        root: BuildPaths<'_>,
    ) -> Vec<FurtherPackageName> {
        let mut public_paths: Vec<(&[u8], &[u8])> = files
            .iter()
            .map(|file| (file.source_path, file.public_path))
            .collect();
        public_paths.sort_unstable_by(|a, b| compare_source_paths(a.0, b.0));
        let mut packages: Vec<Vec<u8>> = files
            .iter()
            .filter_map(|file| find_name_of_package(file.source_path))
            .collect();
        packages.sort_unstable();
        packages.dedup();
        // The build may spell the root directory with forward slashes, and `parent()` goes by those of the host.
        let folder: Vec<u8> = root
            .source_path
            .iter()
            .map(|&byte| native_separator(byte))
            .collect();
        let folder = bun_paths::strings::without_trailing_slash(&folder);
        let public_root = bun_paths::strings::without_trailing_slash(root.public_path);
        let mut unread_log = Log::default();
        let log_of_build = core::mem::replace(&mut self.log, NonNull::from(&mut unread_log));
        let prefers_module_field = core::mem::replace(&mut self.prefer_module_field, false);
        let mut names = Vec::new();
        let separator = &[bun_paths::SEP][..];
        let written_subpaths = |resolver: &mut Self, directory: &[u8]| {
            let manifest = resolver
                .read_dir_info_ignore_error(directory)
                .and_then(|directory| directory.package_json());
            let exports = manifest.and_then(|manifest| manifest.exports.as_ref());
            exports.map(|exports| -> Vec<Vec<u8>> {
                let subpaths = exports.written_subpaths().into_iter();
                subpaths.map(<[u8]>::to_vec).collect()
            })
        };
        let add = |resolver: &mut Self,
                   names: &mut Vec<FurtherPackageName>,
                   name: &[u8],
                   specifier: &[u8],
                   hides_other_paths: bool| {
            // The resolver keeps what it is asked for.
            let store = &resolver.fs_ref().dirname_store;
            let Ok(specifier) = store.append_parts(&[specifier]) else {
                return;
            };
            let mut find = |kind: ImportKind| {
                let found = resolver.resolve(folder, specifier, kind).ok()?;
                let path = found.path_pair.primary.text();
                let position = public_paths
                    .binary_search_by(|file| compare_source_paths(file.0, path))
                    .ok()?;
                Some(public_paths[position].1.to_vec())
            };
            let required = find(ImportKind::Require);
            let imported = find(ImportKind::Dynamic);
            if required.is_some() || imported.is_some() || hides_other_paths {
                names.push(FurtherPackageName {
                    path: [public_root, b"/node_modules/", name].concat(),
                    required,
                    imported,
                    hides_other_paths,
                });
            }
        };
        for package in &packages {
            let directory = [folder, separator, NODE_MODULES, separator, package].concat();
            let subpaths = written_subpaths(self, &directory);
            add(self, &mut names, package, package, subpaths.is_some());
            for subpath in subpaths.iter().flatten() {
                let name = [&package[..], &subpath[..]].concat();
                add(self, &mut names, &name, &name, false);
            }
        }
        // `import "my-app"`, from a plug-in that lies outside the program's package.
        let mut own_folder = Some(folder);
        while let Some(place) = own_folder {
            let manifest = self
                .read_dir_info_ignore_error(place)
                .and_then(|directory| directory.package_json());
            if let Some(manifest) = manifest {
                let own = manifest.name.to_vec();
                if !own.is_empty() {
                    let subpaths = written_subpaths(self, place);
                    match subpaths.is_some() {
                        true => add(self, &mut names, &own, &own, true),
                        false => {
                            let main = [place, separator, b"."].concat();
                            add(self, &mut names, &own, &main, false);
                        }
                    }
                    for subpath in subpaths.iter().flatten() {
                        let name = [&own[..], &subpath[..]].concat();
                        add(self, &mut names, &name, &name, false);
                    }
                }
                break;
            }
            own_folder = parent(place);
        }
        self.log = log_of_build;
        self.prefer_module_field = prefers_module_field;
        names.sort_by(|a, b| a.path.cmp(&b.path));
        names.dedup_by(|later, earlier| later.path == earlier.path);
        names
    }

    /// "paths" and "baseUrl" of each tsconfig.json that applies in one of `folders`, the folders of the compiled files.
    /// Not for a folder inside `node_modules`: many packages ship a tsconfig.json, none can rely on it where Node runs them, and a record for each adds up.
    pub fn find_path_aliases(&mut self, folders: &[BuildPaths<'_>]) -> Vec<PathAlias> {
        let mut places = list_places(folders);
        places.retain(|place| !is_inside_node_modules(place.source_path));
        let configured: Vec<(BuildPaths<'_>, TSConfigRef)> = places
            .iter()
            .filter_map(|&place| {
                let directory = self.read_dir_info_ignore_error(place.source_path)?;
                Some((place, self.enclosing_tsconfig_json(&directory)?))
            })
            .collect();
        let mut aliases: Vec<PathAlias> = Vec::new();
        for (place, tsconfig) in &configured {
            let is_below_same_tsconfig = parent(place.source_path).is_some_and(|above| {
                let position = configured.binary_search_by(|it| it.0.source_path.cmp(above));
                position.is_ok_and(|position| {
                    core::ptr::eq(&raw const *configured[position].1, &raw const **tsconfig)
                })
            });
            if is_below_same_tsconfig {
                continue;
            }
            let folder: Vec<u8> = place
                .public_path
                .iter()
                .copied()
                .map(normalize_separator)
                .collect();
            let count_before = aliases.len();
            let base_url = match tsconfig.has_base_url() {
                true => &tsconfig.base_url,
                false => &tsconfig.base_url_for_paths,
            };
            let mut add = |resolver: &Self, key: &[u8], target: &[u8], is_base_url: bool| {
                let mut buffer = bun_paths::path_buffer_pool::get();
                let parts: [&[u8]; 2] = [base_url, target];
                let target = resolver.fs_ref().abs_buf_checked(&parts, &mut buffer[..]);
                let target = target.and_then(|it| to_relative_specifier(place.source_path, it));
                aliases.extend(target.map(|target| PathAlias {
                    folder: folder.clone(),
                    key: key.to_vec(),
                    target,
                    is_base_url,
                }));
            };
            let paths = tsconfig.paths.keys().iter().zip(tsconfig.paths.values());
            for (key, targets) in paths {
                for target in targets.iter() {
                    if !self.is_type_only_tsconfig_path(target) {
                        add(self, key, target, false);
                    }
                }
            }
            if tsconfig.has_base_url() {
                add(self, b"*", b"*", true);
            }
            // Below a folder with aliases, a tsconfig.json without any hides them.
            let hides_aliases = aliases.len() == count_before
                && aliases
                    .iter()
                    .any(|alias| folder.starts_with(&alias.folder));
            if hides_aliases {
                aliases.push(PathAlias {
                    folder,
                    key: Vec::new(),
                    target: Vec::new(),
                    is_base_url: false,
                });
            }
        }
        aliases
    }

    /// The names that lead to one of `entry_points` from one of `folders`, the folders of the compiled files, and each folder above an entry point whose `package.json` names its main file. Each name once.
    pub fn find_package_names(
        &mut self,
        entry_points: &[BuildPaths<'_>],
        folders: &[BuildPaths<'_>],
    ) -> Vec<PackageName> {
        let files = entry_points.iter();
        let mut packages: Vec<Vec<u8>> = files
            .filter_map(|file| find_name_of_package(file.source_path))
            .collect();
        packages.sort_unstable();
        packages.dedup();
        let places = list_places(folders);

        // A name that leads nowhere is no error of the build.
        let mut unread_log = Log::default();
        let log_of_build = core::mem::replace(&mut self.log, NonNull::from(&mut unread_log));
        // A bundler takes `module` where it can. `bun run`, whose answers these are, takes `main`.
        let prefers_module_field = core::mem::replace(&mut self.prefer_module_field, false);
        let mut names = Vec::new();
        // Only a folder above an entry point can lead to one.
        let mut folders_of_entry_points: Vec<BuildPaths<'_>> = entry_points
            .iter()
            .filter_map(|file| {
                Some(BuildPaths {
                    source_path: parent(file.source_path)?,
                    public_path: parent(file.public_path)?,
                })
            })
            .flat_map(with_folders_above)
            .collect();
        folders_of_entry_points.sort_unstable();
        folders_of_entry_points.dedup();
        for place in &folders_of_entry_points {
            let names_main_file = self
                .read_dir_info_ignore_error(place.source_path)
                .and_then(|directory| directory.package_json())
                .is_some_and(|manifest| {
                    let mut names = self.opts.main_fields.iter();
                    names.any(|name| manifest.main_field(name).is_some())
                });
            if !names_main_file {
                continue;
            }
            let folder = place.source_path;
            names.push(PackageName {
                public_path: [place.public_path, b"/"]
                    .concat()
                    .into_iter()
                    .map(normalize_separator)
                    .collect(),
                required: self.find_entry_point_named(
                    folder,
                    b"./",
                    ImportKind::Require,
                    entry_points,
                ),
                imported: self.find_entry_point_named(
                    folder,
                    b"./",
                    ImportKind::Dynamic,
                    entry_points,
                ),
                hides_other_paths: false,
                is_hidden_from_require: false,
                is_hidden_from_import: false,
            });
        }
        for (place, package) in places
            .iter()
            .flat_map(|place| packages.iter().map(move |package| (place, &package[..])))
        {
            let separator = &[bun_paths::SEP][..];
            let directory = [
                place.source_path,
                separator,
                NODE_MODULES,
                separator,
                package,
            ]
            .concat();
            let Some(directory) = self.read_dir_info_ignore_error(&directory) else {
                continue;
            };
            let exports = directory
                .package_json()
                .and_then(|manifest| manifest.exports.as_ref());
            let real_directory = match directory.abs_real_path {
                b"" => directory.abs_path,
                real_path => real_path,
            };
            let mut subpaths = vec![Vec::new()];
            if let Some(exports) = exports {
                subpaths.extend(exports.written_subpaths().into_iter().map(<[u8]>::to_vec));
                let real_directory = bun_paths::strings::without_trailing_slash(real_directory);
                let inside = entry_points
                    .iter()
                    .filter_map(|file| strip_folder(file.source_path, real_directory));
                for path in
                    inside.filter(|path| path.first().is_some_and(|&byte| is_sep_native(byte)))
                {
                    let path: Vec<u8> = path
                        .iter()
                        .map(|&byte| if is_sep_native(byte) { b'/' } else { byte })
                        .collect();
                    subpaths.extend(exports.subpaths_by_pattern(&path));
                    subpaths.push(path);
                }
                subpaths.sort_unstable();
                subpaths.dedup();
            }
            for subpath in &subpaths {
                // The resolver keeps what it is asked for.
                let store = &self.fs_ref().dirname_store;
                let Ok(specifier) = store.append_parts(&[package, &subpath[..]]) else {
                    continue;
                };
                let folder = place.source_path;
                let required = self.find_entry_point_named(
                    folder,
                    specifier,
                    ImportKind::Require,
                    entry_points,
                );
                let imported = self.find_entry_point_named(
                    folder,
                    specifier,
                    ImportKind::Dynamic,
                    entry_points,
                );
                let hides_other_paths = subpath.is_empty() && exports.is_some();
                if required.is_some() || imported.is_some() || hides_other_paths {
                    names.push(PackageName {
                        // The run time joins what it looks for with forward slashes.
                        public_path: [place.public_path, b"/node_modules/", specifier]
                            .concat()
                            .into_iter()
                            .map(normalize_separator)
                            .collect(),
                        required,
                        imported,
                        hides_other_paths,
                        is_hidden_from_require: false,
                        is_hidden_from_import: false,
                    });
                }
            }
        }
        self.log = log_of_build;
        self.prefer_module_field = prefers_module_field;
        names.sort_by(|a, b| a.public_path.cmp(&b.public_path));
        names.dedup_by(|later, earlier| later.public_path == earlier.public_path);
        names
    }

    /// `refused`, each under the public path that it would have as a file: below the `node_modules` that holds its package.
    pub fn find_hidden_names(
        &mut self,
        refused: &[RefusedName],
        root: BuildPaths<'_>,
    ) -> Vec<PackageName> {
        let root_directory: Vec<u8> = root
            .source_path
            .iter()
            .map(|&byte| native_separator(byte))
            .collect();
        let root_directory = bun_paths::strings::without_trailing_slash(&root_directory);
        let separator = &[bun_paths::SEP][..];
        let mut unread_log = Log::default();
        let log_of_build = core::mem::replace(&mut self.log, NonNull::from(&mut unread_log));
        let mut names = Vec::new();
        for name in refused {
            let Some(package) = Package::parse_name(&name.specifier) else {
                continue;
            };
            let directory = bun_paths::strings::without_trailing_slash(&name.directory);
            let place = core::iter::successors(Some(directory), |folder| parent(folder))
                .filter(|folder| last_component(folder) != NODE_MODULES)
                .find(|&folder| {
                    let installed = [folder, separator, NODE_MODULES, separator, package].concat();
                    self.read_dir_info_ignore_error(&installed).is_some()
                });
            let Some(relative) = place.and_then(|it| to_relative_specifier(root_directory, it))
            else {
                continue;
            };
            let place = public_path_from_root(root.public_path, &relative);
            names.push(PackageName {
                public_path: [&place[..], b"/node_modules/", &name.specifier]
                    .concat()
                    .into_iter()
                    .map(normalize_separator)
                    .collect(),
                required: None,
                imported: None,
                hides_other_paths: false,
                is_hidden_from_require: name.is_require,
                is_hidden_from_import: !name.is_require,
            });
        }
        self.log = log_of_build;
        names
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn name_of_the_package_of_a_file() {
        for (file, name) in [
            (
                &b"/app/node_modules/driver/lib/entry.js"[..],
                Some(&b"driver"[..]),
            ),
            (b"/app/node_modules/driver/entry.js", Some(b"driver")),
            (
                b"/app/node_modules/@scope/driver/main.cjs",
                Some(b"@scope/driver"),
            ),
            (
                b"/app/node_modules/@scope/driver/lib/deep/main.cjs",
                Some(b"@scope/driver"),
            ),
            (
                b"/app/node_modules/orm/node_modules/driver/a.js",
                Some(b"driver"),
            ),
            (
                b"/app/node_modules/.bun/driver@1.0.0/node_modules/driver/a.js",
                Some(b"driver"),
            ),
            (b"/app/plugins/a.js", None),
            (b"/app/node_modules/single.js", None),
            (b"/app/node_modules/@scope/single.js", None),
            (b"/a.js", None),
        ] {
            assert_eq!(
                find_name_of_package(file).as_deref(),
                name,
                "{}",
                String::from_utf8_lossy(file)
            );
        }
    }

    #[test]
    fn path_as_relative_specifier() {
        let relative = |folder, path| to_relative_specifier(folder, path).unwrap();
        assert_eq!(relative(b"/app", b"/app/aliased/*"), b"./aliased/*");
        assert_eq!(
            relative(b"/app/web", b"/app/shared/*.ts"),
            b"../shared/*.ts"
        );
        assert_eq!(relative(b"/app", b"/app"), b"./");
    }

    #[test]
    fn folders_above_go_up_together() {
        let above = |source_path, public_path| {
            let folder = BuildPaths {
                source_path,
                public_path,
            };
            with_folders_above(folder)
                .map(|it| it.public_path.to_vec())
                .collect::<Vec<_>>()
        };
        let expected: [&[u8]; 3] = [
            b"/$bunfs/root/lib/deep",
            b"/$bunfs/root/lib",
            b"/$bunfs/root",
        ];
        assert_eq!(
            above(b"/work/app/lib/deep", b"/$bunfs/root/lib/deep"),
            expected
        );
        let outside: [&[u8]; 3] = [
            b"/$bunfs/root/_.._/shared/lib",
            b"/$bunfs/root/_.._/shared",
            b"/$bunfs/root/_.._",
        ];
        assert_eq!(
            above(b"/work/shared/lib", b"/$bunfs/root/_.._/shared/lib"),
            outside
        );
    }
}
