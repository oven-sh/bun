//! What a build asks so that an executable finds its entry points by the names of their packages.

use core::ptr::NonNull;

use bun_ast::{ImportKind, Log};
use bun_paths::is_sep_native;

use crate::compiled_program::{compare_source_paths, normalize_separator};
use crate::resolver::Resolver;

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
}

const NODE_MODULES: &[u8] = b"node_modules";

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

    /// The names that lead to one of `entry_points` from one of `folders`, the folders of the compiled files. Each name once.
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
        if packages.is_empty() {
            return Vec::new();
        }
        let mut places: Vec<BuildPaths<'_>> = folders
            .iter()
            .copied()
            .flat_map(with_folders_above)
            .collect();
        places.retain(|place| last_component(place.source_path) != NODE_MODULES);
        places.sort_unstable();
        places.dedup();

        // A name that leads nowhere is no error of the build.
        let mut unread_log = Log::default();
        let log_of_build = core::mem::replace(&mut self.log, NonNull::from(&mut unread_log));
        // A bundler takes `module` where it can. `bun run`, whose answers these are, takes `main`.
        let prefers_module_field = core::mem::replace(&mut self.prefer_module_field, false);
        let mut names = Vec::new();
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
