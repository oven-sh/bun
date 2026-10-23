use core::cmp::Ordering;
use std::sync::OnceLock;

use bun_options_types::standalone_path::is_bun_standalone_file_path;
use bun_paths::is_sep_native;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ImageFile {
    /// A `HANDLE` on Windows.
    pub descriptor: isize,
    pub offset: i64,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CompiledEntryPoint {
    pub file_index: u32,
    pub module_id: u32,
    pub source_path: &'static [u8],
    /// The key of the compiled module, which frames, `import.meta.path` and `Bun.main` show.
    pub module_path: &'static [u8],
}

/// A name that leads to an entry point and is not the path of its file: the name of a package, or a key of its `exports`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CompiledPackageName {
    /// The public path that the name would have as a file: `<folder>/node_modules/<name>`.
    pub path: &'static [u8],
    /// Indices into `entry_points`: what `require` finds under the name, and what `import` finds.
    pub required: Option<u32>,
    pub imported: Option<u32>,
    /// The name is that of a package with `exports`: below it only what is written down is found.
    pub hides_other_paths: bool,
}

pub struct CompiledProgram {
    pub image: &'static [u8],
    pub backing_file: Option<ImageFile>,
    /// Ascending by `file_index`.
    pub entry_points: Box<[CompiledEntryPoint]>,
    pub preserves_source_paths: bool,
    /// Indices into `entry_points`, ascending by `compare_source_paths`.
    source_path_order: Box<[u32]>,
    /// Ascending by `path`.
    package_names: Box<[CompiledPackageName]>,
    module_lookup: OnceLock<ModuleLookup>,
    /// What every path that the executable answers for outside of its own root begins with; found by the graph at the first question.
    pub common_start_of_source_paths: OnceLock<Option<Box<[u8]>>>,
}

/// Answers the public path of the module compiled at that path, in memory that is never freed.
pub type ModuleLookup = fn(&[u8]) -> Option<&'static [u8]>;

/// What `bun run` tries for a path that names no file as spelled.
#[derive(Copy, Clone)]
pub struct ExtensionSearch<'a> {
    pub extensions: &'a [Box<[u8]>],
    pub extra_extensions: &'a [Box<[u8]>],
    /// The TypeScript extensions that a written extension of a path also stands for.
    pub rewritten_extensions: &'a dyn Fn(&[u8], &[u8]) -> &'static [&'static [u8]],
}

/// In a public path, a `..` that leaves the root directory of the build.
const PARENT_OF_ROOT: &[u8] = b"_.._";

fn is_relative_specifier(specifier: &[u8]) -> bool {
    let after_dots = specifier
        .strip_prefix(b"..")
        .or_else(|| specifier.strip_prefix(b"."));
    after_dots.is_some_and(|rest| rest.first().is_none_or(|&byte| is_sep_native(byte)))
}

fn split_path(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    let path = bun_paths::string_paths::without_nt_prefix::<u8>(path);
    path.split(|&byte| is_sep_native(byte))
}

/// `..` removes the segment before it. Where there is none it stays, as `PARENT_OF_ROOT`.
fn push_segments<'p>(kept: &mut Vec<&'p [u8]>, segments: impl Iterator<Item = &'p [u8]>) {
    for segment in segments {
        match segment {
            b"" | b"." => {}
            b".." => match kept.last() {
                Some(&last) if last != PARENT_OF_ROOT => {
                    kept.pop();
                }
                Some(_) | None => kept.push(PARENT_OF_ROOT),
            },
            _ => kept.push(segment),
        }
    }
}

fn segments_below_public_root<'p>(
    root: &[u8],
    base: &'p [u8],
    written: &'p [u8],
) -> Option<Vec<&'p [u8]>> {
    let mut segments = split_path(base);
    let root_segments = bun_core::strings::split(root.strip_suffix(b"/").unwrap_or(root), b"/");
    for root_segment in root_segments {
        if segments.next() != Some(root_segment) {
            return None;
        }
    }
    let mut kept = Vec::new();
    push_segments(&mut kept, segments.chain(split_path(written)));
    Some(kept)
}

/// The public path a file would have, without a trailing `/`.
fn join_public_path(public_root: &[u8], source_dir: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
    let (base, written): (&[u8], &[u8]) = if is_relative_specifier(specifier) {
        (source_dir, specifier)
    } else {
        (specifier, b"")
    };
    if !is_bun_standalone_file_path(base) {
        return None;
    }
    let kept = segments_below_public_root(public_root, base, written)?;
    let path = [public_root, &kept.join(&b"/"[..])].concat();
    Some(path.strip_suffix(b"/").unwrap_or(&path).to_vec())
}

/// Where to search from for what a module in `source_dir`, a directory of public paths, names outside the executable, when `base` stands for the root directory of the build: the directory itself, then each of its parents below the root.
pub fn directories_of_importer(public_root: &[u8], source_dir: &[u8], base: &[u8]) -> Vec<Vec<u8>> {
    use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
    let mut segments = segments_below_public_root(public_root, source_dir, b"").unwrap_or_default();
    for segment in segments
        .iter_mut()
        .filter(|segment| **segment == PARENT_OF_ROOT)
    {
        *segment = b"..";
    }
    let join = |count: usize| {
        let mut buffer = bun_paths::path_buffer_pool::get();
        let relative = segments[..count].join(&b"/"[..]);
        let parts = [&relative[..]];
        let joined = join_abs_string_buf_checked::<platform::Auto>(base, &mut buffer[..], &parts);
        joined.map(<[u8]>::to_vec)
    };
    (1..=segments.len()).rev().filter_map(join).collect()
}

fn find_with_extensions(
    stem: &[u8],
    search: &ExtensionSearch<'_>,
    lookup: ModuleLookup,
) -> Option<&'static [u8]> {
    let mut extensions = search.extensions.iter().chain(search.extra_extensions);
    extensions.find_map(|extension| lookup(&[stem, &extension[..]].concat()))
}

fn find_file(
    path: &[u8],
    search: &ExtensionSearch<'_>,
    lookup: ModuleLookup,
) -> Option<&'static [u8]> {
    let found = lookup(path).or_else(|| find_with_extensions(path, search, lookup));
    if found.is_some() {
        return found;
    }
    let name_start = bun_core::strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
    let dot = name_start + bun_core::strings::last_index_of_char(&path[name_start..], b'.')?;
    let (stem, extension) = path.split_at(dot);
    let mut rewritten = (search.rewritten_extensions)(extension, path).iter();
    rewritten.find_map(|&extension| lookup(&[stem, extension].concat()))
}

/// The order of `bun run`: the file as spelled, with each extension, with a TypeScript extension in place of the written one, then the index file of the directory.
fn find_file_or_index(
    path: &[u8],
    search: &ExtensionSearch<'_>,
    lookup: ModuleLookup,
) -> Option<&'static [u8]> {
    find_file(path, search, lookup)
        .or_else(|| find_with_extensions(&[path, b"/index"].concat(), search, lookup))
}

#[inline]
fn normalize_separator(byte: u8) -> u8 {
    if cfg!(windows) && byte == b'\\' {
        b'/'
    } else {
        byte
    }
}

pub fn compare_source_paths(a: &[u8], b: &[u8]) -> Ordering {
    if cfg!(windows) {
        return a
            .iter()
            .copied()
            .map(normalize_separator)
            .cmp(b.iter().copied().map(normalize_separator));
    }
    a.cmp(b)
}

fn is_in_directory(path: &[u8], directory: &[u8]) -> bool {
    path.len() > directory.len()
        && normalize_separator(path[directory.len()]) == b'/'
        && compare_source_paths(&path[..directory.len()], directory).is_eq()
}

/// Whether `path` sorts before every path in `directory`.
fn sorts_before_directory_contents(path: &[u8], directory: &[u8]) -> bool {
    match compare_source_paths(&path[..path.len().min(directory.len())], directory) {
        Ordering::Less => true,
        Ordering::Greater => false,
        Ordering::Equal => path
            .get(directory.len())
            .is_none_or(|&byte| normalize_separator(byte) < b'/'),
    }
}

impl CompiledProgram {
    pub fn new(
        image: &'static [u8],
        backing_file: Option<ImageFile>,
        entry_points: Box<[CompiledEntryPoint]>,
        source_path_order: Box<[u32]>,
        preserves_source_paths: bool,
    ) -> CompiledProgram {
        debug_assert!(entry_points.is_sorted_by_key(|entry_point| entry_point.file_index));
        debug_assert!(
            source_path_order
                .iter()
                .all(|&index| (index as usize) < entry_points.len())
        );
        CompiledProgram {
            image,
            backing_file,
            entry_points,
            preserves_source_paths,
            source_path_order,
            package_names: Box::new([]),
            module_lookup: OnceLock::new(),
            common_start_of_source_paths: OnceLock::new(),
        }
    }

    pub fn with_package_names(
        mut self,
        package_names: Box<[CompiledPackageName]>,
    ) -> CompiledProgram {
        debug_assert!(package_names.is_sorted_by_key(|name| name.path));
        let mut indices = package_names
            .iter()
            .flat_map(|name| [name.required, name.imported])
            .flatten();
        debug_assert!(indices.all(|index| (index as usize) < self.entry_points.len()));
        self.package_names = package_names;
        self
    }

    pub fn set_module_lookup(&self, lookup: ModuleLookup) {
        let is_first = self.module_lookup.set(lookup).is_ok();
        debug_assert!(is_first);
    }

    pub fn entry_point_by_module_path(&self, path: &[u8]) -> Option<&CompiledEntryPoint> {
        self.entry_points
            .iter()
            .find(|entry_point| entry_point.module_path == path)
    }

    /// The public path of the compiled module that `specifier` names when imported from `source_dir`.
    pub fn resolve_module(
        &self,
        public_root: &[u8],
        source_dir: &[u8],
        specifier: &[u8],
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        if self.preserves_source_paths {
            return None;
        }
        let lookup = *self.module_lookup.get()?;
        let path = join_public_path(public_root, source_dir, specifier)?;
        find_file_or_index(&path, search, lookup)
    }

    /// `Some(None)`: the build wrote the name down, and loaded that way it leads to no entry point.
    fn find_package_name(&self, path: &[u8], is_require: bool) -> Option<Option<&'static [u8]>> {
        let position = self
            .package_names
            .binary_search_by_key(&path, |name| name.path)
            .ok()?;
        let name = &self.package_names[position];
        let entry_point = if is_require {
            name.required
        } else {
            name.imported
        };
        Some(entry_point.map(|index| self.entry_points[index as usize].module_path))
    }

    fn hides_other_paths(&self, package: &[u8]) -> bool {
        let position = self
            .package_names
            .binary_search_by_key(&package, |name| name.path);
        position.is_ok_and(|position| self.package_names[position].hides_other_paths)
    }

    /// The public path of the compiled module that a bare `specifier` names when loaded from `source_dir`.
    pub fn resolve_package(
        &self,
        public_root: &[u8],
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        if self.preserves_source_paths
            || specifier.is_empty()
            || !bun_paths::is_package_path(specifier)
            || !is_bun_standalone_file_path(source_dir)
        {
            return None;
        }
        let lookup = *self.module_lookup.get()?;
        let mut folders = segments_below_public_root(public_root, source_dir, b"")?;
        loop {
            if folders.last() != Some(&&b"node_modules"[..]) {
                let mut segments = folders.clone();
                push_segments(
                    &mut segments,
                    [&b"node_modules"[..]]
                        .into_iter()
                        .chain(split_path(specifier)),
                );
                let path = [public_root, &segments.join(&b"/"[..])].concat();
                if let Some(listed) = self.find_package_name(&path, is_require) {
                    return listed;
                }
                let name_length = if specifier.starts_with(b"@") { 2 } else { 1 };
                let package = segments
                    .get(..folders.len() + 1 + name_length)?
                    .join(&b"/"[..]);
                if self.hides_other_paths(&[public_root, &package[..]].concat()) {
                    return None;
                }
                if let Some(found) = find_file_or_index(&path, search, lookup) {
                    return Some(found);
                }
            }
            // The folder above the root directory of the build is no folder of the root directory.
            if folders.pop().is_none_or(|folder| folder == PARENT_OF_ROOT) {
                return None;
            }
        }
    }

    /// In a program that runs in place: the compiled module at `path`, an absolute path, found as `bun run` finds a file.
    pub fn resolve_module_at_source_path(
        &self,
        path: &[u8],
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        if !self.preserves_source_paths {
            return None;
        }
        find_file_or_index(path, search, *self.module_lookup.get()?)
    }

    pub fn entry_point_by_source_path(&self, path: &[u8]) -> Option<&CompiledEntryPoint> {
        let position = self
            .source_path_order
            .binary_search_by(|&index| {
                compare_source_paths(self.entry_points[index as usize].source_path, path)
            })
            .ok()?;
        Some(&self.entry_points[self.source_path_order[position] as usize])
    }

    pub fn entry_point_by_file_index(&self, file_index: u32) -> Option<&CompiledEntryPoint> {
        let position = self
            .entry_points
            .binary_search_by_key(&file_index, |entry_point| entry_point.file_index)
            .ok()?;
        Some(&self.entry_points[position])
    }

    /// The entry points at any depth under `directory` (no trailing separator), ascending by source path.
    pub fn entry_points_in_directory<'s>(
        &'s self,
        directory: &[u8],
    ) -> impl Iterator<Item = &'s CompiledEntryPoint> {
        let start = self.source_path_order.partition_point(|&index| {
            sorts_before_directory_contents(
                self.entry_points[index as usize].source_path,
                directory,
            )
        });
        self.source_path_order[start..]
            .iter()
            .map(move |&index| &self.entry_points[index as usize])
            .take_while(move |entry_point| is_in_directory(entry_point.source_path, directory))
    }
}
