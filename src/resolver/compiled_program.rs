use core::cmp::Ordering;
use std::sync::OnceLock;

use bun_options_types::standalone_path::is_bun_standalone_file_path;
use bun_paths::is_sep_native;
use bun_paths::resolve_path::Platform;

use crate::package_json::Package;
use crate::resolver::Resolver;

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

impl CompiledEntryPoint {
    /// Whether the compiled module is `name` below `root`. The paths of an executable for Windows are written with either separator.
    pub fn is_below(&self, root: &[u8], name: &[u8]) -> bool {
        let has_drive = root.get(1) == Some(&b':');
        let is_separator = |byte: u8| byte == b'/' || (has_drive && byte == b'\\');
        let is_same = |(&left, &right): (&u8, &u8)| {
            left == right || (is_separator(left) && is_separator(right))
        };
        let path = self.module_path;
        path.len() == root.len() + name.len()
            && path.iter().zip(root.iter().chain(name)).all(is_same)
    }
}

/// A name that leads to an entry point and is not the path of its file: the name of a package, a key of its `exports`, a folder whose `package.json` names its main file, or what the program writes where it starts a Worker.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CompiledPackageName {
    /// The public path that the name would have as a file: `<folder>/node_modules/<name>`. That of a folder ends in `/`.
    pub path: &'static [u8],
    /// Indices into `entry_points`: what `require` finds under the name, and what `import` finds.
    pub required: Option<u32>,
    pub imported: Option<u32>,
    /// The name is that of a package with `exports`: below it only what is written down is found.
    pub hides_other_paths: bool,
}

pub struct CompiledProgram {
    /// Every image of the executable, one behind the other. The first is that of the program the process starts with.
    pub image: &'static [u8],
    /// Where `image` begins.
    pub backing_file: Option<ImageFile>,
    /// Ascending by `file_index`.
    pub entry_points: Box<[CompiledEntryPoint]>,
    pub preserves_source_paths: bool,
    /// Indices into `entry_points`, ascending by `compare_source_paths`.
    source_path_order: Box<[u32]>,
    /// Ascending by `path`.
    package_names: Box<[CompiledPackageName]>,
    /// By entry point: the image of the program that begins there, a part of `image`. Empty: `image` is one image, of one program with all entry points.
    images: Box<[&'static [u8]]>,
    /// An index into `entry_points`, where the process does not start with the first program.
    start: Option<usize>,
    module_lookup: OnceLock<ModuleLookup>,
    /// What every path that the executable answers for outside of its own root begins with; found by the graph at the first question.
    pub common_start_of_source_paths: OnceLock<Option<Box<[u8]>>>,
}

/// Answers the public path of the module compiled at that path, in memory that is never freed.
pub type ModuleLookup = fn(&[u8]) -> Option<&'static [u8]>;

/// A `ModuleLookup`, or one among the entry points.
type Lookup<'a> = &'a dyn Fn(&[u8]) -> Option<&'static [u8]>;

/// What `bun run` tries for a path that names no file as spelled.
#[derive(Copy, Clone)]
pub struct ExtensionSearch<'a> {
    pub extensions: &'a [Box<[u8]>],
    pub extra_extensions: &'a [Box<[u8]>],
    /// The TypeScript extensions that a written extension of a path also stands for.
    pub rewritten_extensions: &'a dyn Fn(&[u8], &[u8]) -> &'static [&'static [u8]],
}

#[derive(Copy, Clone)]
pub struct HowNamed {
    /// The specifier was written as the name of a directory, like `./a/`.
    pub names_directory: bool,
    pub is_require: bool,
}

/// What an executable answers for a bare specifier.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PackageLookup {
    Found(&'static [u8]),
    /// The package has `exports`, which do not list the name. `bun run` looks no further.
    Hidden,
    Unknown,
}

/// In a public path, a `..` that leaves the root directory of the build.
const PARENT_OF_ROOT: &[u8] = b"_.._";

fn is_relative_specifier(specifier: &[u8]) -> bool {
    let after_dots = specifier
        .strip_prefix(b"..")
        .or_else(|| specifier.strip_prefix(b"."));
    after_dots.is_some_and(|rest| rest.first().is_none_or(|&byte| is_sep_native(byte)))
}

/// Whether the path that `bun run` joins below `node_modules` ends in a separator: of those at the end of a specifier the join keeps the host's own.
fn names_directory_below_node_modules(specifier: &[u8], host: Platform) -> bool {
    specifier.last() == Some(&host.separator())
}

/// The name of the package whose `exports` `bun run` reads for the specifier.
fn find_name_of_package_with_exports(specifier: &[u8]) -> Option<&[u8]> {
    let name = Package::parse_name(specifier)?;
    let is_name =
        !name.starts_with(b".") && bun_core::strings::index_of_any(name, b"\\%").is_none();
    is_name.then_some(name)
}

fn split_path(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    let path = bun_paths::string_paths::without_nt_prefix::<u8>(path);
    // `bun run` takes a backslash for a separator on every host.
    path.split(|&byte| bun_paths::is_sep_any(byte))
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
    let mut segments = split_path(base).peekable();
    let root = root.strip_suffix(b"/").unwrap_or(root);
    let (above_root, name_of_root) =
        root.split_at(bun_core::strings::last_index_of_char(root, b'/')? + 1);
    for segment in bun_core::strings::split(above_root.strip_suffix(b"/")?, b"/") {
        if segments.next() != Some(segment) {
            return None;
        }
    }
    let mut kept = Vec::new();
    // A program that goes up from a path in the root, with `..` in a URL or in `path.join()`, names what lies beside the root.
    if segments.next_if_eq(&name_of_root).is_none() {
        kept.push(PARENT_OF_ROOT);
    }
    push_segments(&mut kept, segments.chain(split_path(written)));
    Some(kept)
}

/// The public path a file would have, without a trailing `/`.
pub(crate) fn join_public_path(
    public_root: &[u8],
    source_dir: &[u8],
    specifier: &[u8],
) -> Option<Vec<u8>> {
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
    lookup: Lookup<'_>,
) -> Option<&'static [u8]> {
    let mut extensions = search.extensions.iter().chain(search.extra_extensions);
    extensions.find_map(|extension| lookup(&[stem, &extension[..]].concat()))
}

fn find_file(
    path: &[u8],
    names_directory: bool,
    search: &ExtensionSearch<'_>,
    lookup: Lookup<'_>,
) -> Option<&'static [u8]> {
    let with_extension = || match names_directory {
        true => None,
        false => find_with_extensions(path, search, lookup),
    };
    let found = lookup(path).or_else(with_extension);
    if found.is_some() {
        return found;
    }
    let name_start = path
        .iter()
        .rposition(|&byte| normalize_separator(byte) == b'/')
        .map_or(0, |separator| separator + 1);
    let dot = name_start + bun_core::strings::last_index_of_char(&path[name_start..], b'.')?;
    let (stem, extension) = path.split_at(dot);
    let mut rewritten = (search.rewritten_extensions)(extension, path).iter();
    rewritten.find_map(|&extension| lookup(&[stem, extension].concat()))
}

#[inline]
pub(crate) fn normalize_separator(byte: u8) -> u8 {
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
            images: Box::new([]),
            start: None,
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

    pub fn with_images(mut self, images: Box<[&'static [u8]]>) -> CompiledProgram {
        debug_assert!(images.is_empty() || images.len() == self.entry_points.len());
        self.images = images;
        self
    }

    /// The process starts with the program that begins at this entry point.
    pub fn start_at(&mut self, entry_point: usize) {
        debug_assert!(entry_point < self.images.len());
        self.start = Some(entry_point);
    }

    /// One for each program.
    pub fn images(&self) -> impl Iterator<Item = &'static [u8]> {
        let only = self.images.is_empty().then_some(self.image);
        only.into_iter().chain(self.images.iter().copied())
    }

    /// Of the program that the process starts with.
    pub fn first_image(&self) -> &'static [u8] {
        if let Some(start) = self.start {
            return self.images[start];
        }
        let mut images = self.images.iter();
        let first = images.find(|image| core::ptr::eq(image.as_ptr(), self.image.as_ptr()));
        first.copied().unwrap_or(self.image)
    }

    /// Of the program that begins at the entry point with this key. A global that begins elsewhere runs the first program.
    pub fn image_beginning_at(&self, module_path: &[u8]) -> &'static [u8] {
        let mut entry_points = self.entry_points.iter().zip(&self.images);
        let found = entry_points.find(|(entry_point, _)| {
            entry_point.module_path == module_path || entry_point.source_path == module_path
        });
        found.map_or_else(|| self.first_image(), |(_, image)| *image)
    }

    pub fn set_module_lookup(&self, lookup: ModuleLookup) {
        let is_first = self.module_lookup.set(lookup).is_ok();
        debug_assert!(is_first);
    }

    pub fn entry_point_by_module_path(&self, path: &[u8]) -> Option<&CompiledEntryPoint> {
        self.entry_points
            .iter()
            .find(|entry_point| compare_source_paths(entry_point.module_path, path).is_eq())
    }

    /// The public path of the compiled module that `specifier` names when imported from `source_dir`.
    pub fn resolve_module(
        &self,
        public_root: &[u8],
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        let lookup = self.module_lookup.get()?;
        self.resolve_module_among(
            lookup,
            public_root,
            source_dir,
            specifier,
            is_require,
            search,
        )
    }

    fn resolve_module_among(
        &self,
        lookup: Lookup<'_>,
        public_root: &[u8],
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        if self.preserves_source_paths {
            return None;
        }
        let path = join_public_path(public_root, source_dir, specifier)?;
        let how = HowNamed {
            names_directory: Resolver::import_path_names_directory(specifier),
            is_require,
        };
        self.find_file_or_directory(&path, how, search, lookup)
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

    /// The order of `bun run`: the file as spelled, with each extension, with a TypeScript extension in place of the written one, then the directory: the main file that its `package.json` names, then its index file. No extension is added to a name that was written as that of a directory, like `./a/`.
    fn find_file_or_directory(
        &self,
        path: &[u8],
        how: HowNamed,
        search: &ExtensionSearch<'_>,
        lookup: Lookup<'_>,
    ) -> Option<&'static [u8]> {
        if let Some(file) = find_file(path, how.names_directory, search, lookup) {
            return Some(file);
        }
        if let Some(listed) = self.find_package_name(&[path, b"/"].concat(), how.is_require) {
            return listed;
        }
        // A program that runs in place has the paths of the host.
        let index: &[u8] = match cfg!(windows) && bun_core::strings::contains_char(path, b'\\') {
            true => b"\\index",
            false => b"/index",
        };
        find_with_extensions(&[path, index].concat(), search, lookup)
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
    ) -> PackageLookup {
        let Some(lookup) = self.module_lookup.get() else {
            return PackageLookup::Unknown;
        };
        self.resolve_package_among(
            lookup,
            public_root,
            source_dir,
            specifier,
            is_require,
            search,
        )
    }

    fn resolve_package_among(
        &self,
        lookup: Lookup<'_>,
        public_root: &[u8],
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> PackageLookup {
        use PackageLookup::{Found, Hidden, Unknown};
        if self.preserves_source_paths
            || specifier.is_empty()
            || !bun_paths::is_package_path(specifier)
            || !is_bun_standalone_file_path(source_dir)
        {
            return Unknown;
        }
        let how = HowNamed {
            names_directory: names_directory_below_node_modules(specifier, Platform::AUTO),
            is_require,
        };
        let package = find_name_of_package_with_exports(specifier);
        let Some(mut folders) = segments_below_public_root(public_root, source_dir, b"") else {
            return Unknown;
        };
        let count_levels = |entry: &CompiledEntryPoint| {
            let segments = segments_below_public_root(public_root, entry.module_path, b"");
            let is_above = |segment: &&&[u8]| **segment == PARENT_OF_ROOT;
            segments.map_or(0, |segments| segments.iter().take_while(is_above).count())
        };
        let levels_above_root = self
            .entry_points
            .iter()
            .map(count_levels)
            .max()
            .unwrap_or(0);
        loop {
            if folders.last() != Some(&&b"node_modules"[..]) {
                let mut segments = folders.clone();
                segments.push(b"node_modules");
                let node_modules = [public_root, &segments.join(&b"/"[..]), b"/"].concat();
                if let Some(package) = package
                    && self.hides_other_paths(&[&node_modules[..], package].concat())
                {
                    // A key of `exports` is compared as it is written, and none is written down with a separator at its end.
                    let listed = match specifier.ends_with(b"/") {
                        true => None,
                        false => self.find_package_name(
                            &[&node_modules[..], specifier].concat(),
                            is_require,
                        ),
                    };
                    return match listed {
                        Some(Some(found)) => Found(found),
                        Some(None) => Unknown,
                        None if &specifier[package.len()..] == b"/package.json" => Unknown,
                        None => Hidden,
                    };
                }
                push_segments(&mut segments, split_path(specifier));
                let path = [public_root, &segments.join(&b"/"[..])].concat();
                let folder = match how.names_directory {
                    true => self.find_package_name(&[&path[..], b"/"].concat(), is_require),
                    false => None,
                };
                if let Some(listed) = folder.or_else(|| self.find_package_name(&path, is_require)) {
                    return listed.map_or(Unknown, Found);
                }
                if let Some(found) = self.find_file_or_directory(&path, how, search, lookup) {
                    return Found(found);
                }
            }
            // Above the root directory of the build there are as many folders as an entry point lies above it.
            push_segments(&mut folders, core::iter::once(&b".."[..]));
            if folders.len() > levels_above_root && folders.last() == Some(&PARENT_OF_ROOT) {
                return Unknown;
            }
        }
    }

    /// In a program that runs in place: the compiled module at `path`, an absolute path, found as `bun run` finds a file.
    pub fn resolve_module_at_source_path(
        &self,
        path: &[u8],
        how: HowNamed,
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        if !self.preserves_source_paths {
            return None;
        }
        self.find_file_or_directory(path, how, search, self.module_lookup.get()?)
    }

    /// The entry point that a Worker starts from when it is given `specifier`, whichever program of the executable begins there. It is found as `bun run` finds the file from the root directory of the build: a name without `./` in front leads to a package, else to a file.
    pub fn resolve_entry_point(
        &self,
        public_root: &[u8],
        specifier: &[u8],
        search: &ExtensionSearch<'_>,
    ) -> Option<&CompiledEntryPoint> {
        let lookup = |path: &[u8]| {
            let entry_point = self.entry_point_by_module_path(path)?;
            Some(entry_point.module_path)
        };
        let find_file = |specifier: &[u8]| {
            let names_directory = Resolver::import_path_names_directory(specifier);
            let path = join_public_path(public_root, public_root, specifier)?;
            match self.find_package_name(&path, false) {
                Some(listed) if !names_directory => listed,
                _ => self.resolve_module_among(
                    &lookup,
                    public_root,
                    public_root,
                    specifier,
                    false,
                    search,
                ),
            }
        };
        let package =
            self.resolve_package_among(&lookup, public_root, public_root, specifier, false, search);
        let module = match package {
            PackageLookup::Found(module) => Some(module),
            PackageLookup::Hidden => None,
            PackageLookup::Unknown if bun_paths::is_package_path(specifier) => {
                find_file(&[b"./", specifier].concat())
            }
            PackageLookup::Unknown => find_file(specifier),
        };
        self.entry_point_by_module_path(module?)
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

#[cfg(test)]
mod tests {
    use bun_sema_standalone as _;

    use super::*;

    fn program(source_path_order: [u32; 3]) -> CompiledProgram {
        let entry_points: [(u32, &[u8]); 3] =
            [(12, b"/a/c/d.ts"), (11, b"/ab/e.ts"), (10, b"/a/b.ts")];
        let entry_points = (0..).zip(entry_points).map(|(file_index, entry_point)| {
            let (module_id, source_path) = entry_point;
            CompiledEntryPoint {
                file_index,
                module_id,
                source_path,
                module_path: source_path,
            }
        });
        let order = Box::new(source_path_order);
        CompiledProgram::new(b"image", None, entry_points.collect(), order, false)
    }

    fn source_paths_in(program: &CompiledProgram, directory: &[u8]) -> Vec<&'static [u8]> {
        let entry_points = program.entry_points_in_directory(directory);
        entry_points.map(|entry| entry.source_path).collect()
    }

    #[test]
    fn entry_point_is_found_below_root_under_either_separator_of_windows() {
        let is_below = |module_path: &'static [u8], root: &[u8], name: &[u8]| {
            let entry_point = CompiledEntryPoint {
                file_index: 0,
                module_id: 0,
                source_path: b"",
                module_path,
            };
            entry_point.is_below(root, name)
        };
        let windows = b"B:/~BUN/root/";
        for path in [
            &br"B:\~BUN\root\folder\second.js"[..],
            b"B:/~BUN/root/folder/second.js",
        ] {
            assert!(is_below(path, windows, b"folder/second.js"));
            assert!(is_below(path, windows, br"folder\second.js"));
            assert!(!is_below(path, windows, b"second.js"));
            assert!(!is_below(path, windows, b"folder/second.j"));
            assert!(!is_below(path, windows, b"folder/second.js/"));
            assert!(!is_below(path, windows, b"folder_second.js"));
        }
        assert!(is_below(br"B:\~BUN\root\p0.ts", windows, b"p0.ts"));
        assert!(!is_below(br"B:\~BUN\other\p0.ts", windows, b"p0.ts"));
        assert!(!is_below(br"B:\~BUN\root\", windows, b"p0.ts"));

        let posix = b"/$bunfs/root/";
        assert!(is_below(
            b"/$bunfs/root/folder/second.js",
            posix,
            b"folder/second.js"
        ));
        assert!(!is_below(
            b"/$bunfs/root/folder/second.js",
            posix,
            b"second.js"
        ));
        // There a backslash is a character of a name.
        assert!(is_below(br"/$bunfs/root/a\b.js", posix, br"a\b.js"));
        assert!(!is_below(br"/$bunfs/root/a\b.js", posix, b"a/b.js"));
    }

    #[test]
    fn entry_point_lookup() {
        let program = program([2, 0, 1]);
        let id = |found: Option<&CompiledEntryPoint>| found.map(|entry| entry.module_id);
        for (path, module_id) in [
            (&b"/a/b.ts"[..], Some(10)),
            (b"/ab/e.ts", Some(11)),
            (b"/a/c/d.ts", Some(12)),
            (b"/a/c", None),
            (b"/a/b.tsx", None),
            (b"", None),
        ] {
            assert_eq!(id(program.entry_point_by_source_path(path)), module_id);
        }
        for (index, module_id) in [(0, Some(12)), (2, Some(10)), (3, None)] {
            assert_eq!(id(program.entry_point_by_file_index(index)), module_id);
        }
    }

    #[test]
    fn directory_lookup() {
        let program = program([2, 0, 1]);
        let in_directory = |directory: &[u8]| source_paths_in(&program, directory);
        assert_eq!(in_directory(b"/a"), [&b"/a/b.ts"[..], b"/a/c/d.ts"]);
        assert_eq!(in_directory(b"/a/c"), [b"/a/c/d.ts"]);
        assert_eq!(in_directory(b"/ab"), [b"/ab/e.ts"]);
        assert_eq!(in_directory(b"").len(), 3);
        for directory in [&b"/a/b.ts"[..], b"/a/", b"/aa", b"/b", b"/"] {
            assert!(in_directory(directory).is_empty());
        }
    }

    #[test]
    fn non_permutation_order() {
        let program = program([1, 1, 1]);
        assert!(program.entry_point_by_source_path(b"/ab/e.ts").is_some());
        assert!(program.entry_point_by_source_path(b"/a/b.ts").is_none());
        assert!(source_paths_in(&program, b"/a").is_empty());
    }

    #[test]
    fn separator_comparison() {
        assert_eq!(compare_source_paths(b"a\\b", b"a/b").is_eq(), cfg!(windows));
        assert!(compare_source_paths(b"/a", b"/a/b").is_lt());
        assert!(compare_source_paths(b"/a/b", b"/a.b").is_gt());
    }

    #[cfg(not(windows))]
    mod module_resolution {
        use super::*;

        const ROOT: &[u8] = b"/$bunfs/root/";
        const MODULES: [&[u8]; 10] = [
            b"/$bunfs/root/lib.cjs",
            b"/$bunfs/root/both.ts",
            b"/$bunfs/root/both.js",
            b"/$bunfs/root/typed.ts",
            b"/$bunfs/root/module.mts",
            b"/$bunfs/root/index.js",
            b"/$bunfs/root/plugins/index.ts",
            b"/$bunfs/root/plugins/first.js",
            b"/$bunfs/root/_.._/shared/util.js",
            b"/$bunfs/root/plugins.js",
        ];

        fn find_module(path: &[u8]) -> Option<&'static [u8]> {
            MODULES.into_iter().find(|&module| module == path)
        }

        fn rewrite(extension: &[u8], _path: &[u8]) -> &'static [&'static [u8]] {
            match extension {
                b".js" => &[b".ts", b".tsx", b".mts"],
                b".mjs" => &[b".mts"],
                _ => &[],
            }
        }

        fn resolve_in(
            program: &CompiledProgram,
            source_dir: &[u8],
            specifier: &[u8],
        ) -> Option<&'static [u8]> {
            let extensions = [&b".ts"[..], b".js", b".cjs"].map(Box::<[u8]>::from);
            let search = ExtensionSearch {
                extensions: &extensions,
                extra_extensions: &[],
                rewritten_extensions: &rewrite,
            };
            program.resolve_module(ROOT, source_dir, specifier, true, &search)
        }

        fn program_with_lookup(preserves_source_paths: bool) -> CompiledProgram {
            let program = CompiledProgram::new(
                b"image",
                None,
                Box::new([]),
                Box::new([]),
                preserves_source_paths,
            );
            program.set_module_lookup(find_module);
            program
        }

        fn resolve(source_dir: &[u8], specifier: &[u8]) -> Option<&'static [u8]> {
            resolve_in(&program_with_lookup(false), source_dir, specifier)
        }

        #[test]
        fn path_as_spelled() {
            assert_eq!(resolve(ROOT, b"./lib.cjs"), Some(MODULES[0]));
            assert_eq!(resolve(b"/$bunfs/root", b"./lib.cjs"), Some(MODULES[0]));
            assert_eq!(
                resolve(b"/$bunfs/root/plugins/", b"../lib.cjs"),
                Some(MODULES[0])
            );
            assert_eq!(resolve(ROOT, b"./plugins/../lib.cjs"), Some(MODULES[0]));
            assert_eq!(resolve(ROOT, b"./plugins//./first.js"), Some(MODULES[7]));
            assert_eq!(
                resolve(b"/elsewhere/", b"/$bunfs/root/lib.cjs"),
                Some(MODULES[0])
            );
            assert_eq!(
                resolve(ROOT, b"/$bunfs/root/plugins/../lib.cjs"),
                Some(MODULES[0])
            );
            assert_eq!(resolve(ROOT, b"./lib.cjs/"), Some(MODULES[0]));
        }

        #[test]
        fn path_on_disk_names_no_module() {
            assert_eq!(resolve(b"/project/app/", b"./lib.cjs"), None);
            assert_eq!(resolve(ROOT, b"/project/app/lib.cjs"), None);
            assert_eq!(
                resolve(b"/elsewhere/", b"/project/app/../app/plugins"),
                None
            );
            assert_eq!(resolve(b"/", b"./lib.cjs"), None);
        }

        #[test]
        fn entry_point_is_found_by_module_path() {
            let entry_points: [(u32, &[u8], &[u8]); 2] = [
                (0, b"/project/lib/a.ts", b"/$bunfs/root/_.._/lib/a.ts"),
                (1, b"/project/app/x/b.ts", b"/$bunfs/root/x/b.ts"),
            ];
            let entry_points =
                entry_points.map(
                    |(file_index, source_path, module_path)| CompiledEntryPoint {
                        file_index,
                        module_id: file_index,
                        source_path,
                        module_path,
                    },
                );
            let order = Box::new([1, 0]);
            let entry_points = Box::new(entry_points);
            let program = CompiledProgram::new(b"image", None, entry_points, order, false);
            let found = program.entry_point_by_module_path(b"/$bunfs/root/x/b.ts");
            assert_eq!(found.map(|entry_point| entry_point.file_index), Some(1));
            assert_eq!(
                program.entry_point_by_module_path(b"/$bunfs/root/x/b.js"),
                None
            );
        }

        #[test]
        fn extensions_in_order() {
            assert_eq!(resolve(ROOT, b"./lib"), Some(MODULES[0]));
            assert_eq!(resolve(ROOT, b"./both"), Some(MODULES[1]));
            assert_eq!(resolve(ROOT, b"./both.js"), Some(MODULES[2]));
        }

        #[test]
        fn written_javascript_extension_names_typescript_file() {
            assert_eq!(resolve(ROOT, b"./typed.js"), Some(MODULES[3]));
            assert_eq!(resolve(ROOT, b"./module.js"), Some(MODULES[4]));
            assert_eq!(resolve(ROOT, b"./module.mjs"), Some(MODULES[4]));
            assert_eq!(resolve(ROOT, b"./typed.mjs"), None);
            assert_eq!(resolve(ROOT, b"./lib.js"), None);
        }

        #[test]
        fn index_file_of_directory() {
            assert_eq!(resolve(ROOT, b"./plugins"), Some(MODULES[9]));
            for directory in [
                &b"./plugins/"[..],
                b"./plugins//",
                b"./plugins/.",
                b"./plugins/./",
                b"./plugins/first/..",
                b"/$bunfs/root/plugins/",
            ] {
                assert_eq!(resolve(ROOT, directory), Some(MODULES[6]));
            }
            assert_eq!(resolve(ROOT, b"./plugins\\"), Some(MODULES[6]));
            assert_eq!(resolve(ROOT, b"./plugins\\first.js"), Some(MODULES[7]));
            assert_eq!(resolve(ROOT, b"./typed/"), None);
            assert_eq!(resolve(ROOT, b"./typed.js/"), Some(MODULES[3]));
            assert_eq!(resolve(b"/$bunfs/root/plugins/", b"."), Some(MODULES[6]));
            assert_eq!(resolve(b"/$bunfs/root/plugins/", b".."), Some(MODULES[5]));
            assert_eq!(resolve(ROOT, b"./"), Some(MODULES[5]));
        }

        #[test]
        fn path_above_root_directory() {
            assert_eq!(resolve(ROOT, b"../shared/util.js"), Some(MODULES[8]));
            assert_eq!(
                resolve(b"/$bunfs/root/plugins/", b"../../shared/util"),
                Some(MODULES[8])
            );
            assert_eq!(
                resolve(b"/$bunfs/root/_.._/shared/", b"./util.js"),
                Some(MODULES[8])
            );
            assert_eq!(
                resolve(b"/$bunfs/root/_.._/other/", b"../shared/util.js"),
                Some(MODULES[8])
            );
            assert_eq!(
                resolve(b"/$bunfs/root/_.._/shared/", b"../../shared/util.js"),
                None
            );
        }

        #[test]
        #[cfg(not(windows))]
        fn importer_directories_are_deepest_first() {
            let directories = |source_dir| directories_of_importer(ROOT, source_dir, b"/work/");
            assert!(directories(ROOT).is_empty());
            assert!(directories(b"/elsewhere/lib/").is_empty());
            assert_eq!(directories(b"/$bunfs/root/lib/"), [b"/work/lib".to_vec()]);
            let nested = [b"/work/lib/deep".to_vec(), b"/work/lib".to_vec()];
            assert_eq!(directories(b"/$bunfs/root/lib/deep/"), nested);
            let above = [b"/shared".to_vec(), b"/".to_vec()];
            assert_eq!(directories(b"/$bunfs/root/_.._/shared/"), above);
        }

        #[test]
        fn misses() {
            assert_eq!(resolve(ROOT, b"./absent.js"), None);
            assert_eq!(resolve(ROOT, b"lib.cjs"), None);
            assert_eq!(resolve(ROOT, b".lib.cjs"), None);
            assert_eq!(resolve(ROOT, b"/project/lib.cjs"), None);
            assert_eq!(resolve(b"project/app/", b"./lib.cjs"), None);
            assert_eq!(resolve(b"/$bunfs/other/", b"./lib.cjs"), None);
        }

        mod package_names {
            use super::*;
            use PackageLookup::{Found, Hidden, Unknown};

            const FILES: [&[u8]; 9] = [
                b"/$bunfs/root/main.js",
                b"/$bunfs/root/node_modules/driver/lib/entry.js",
                b"/$bunfs/root/node_modules/driver/lib/extra.js",
                b"/$bunfs/root/node_modules/both/es.mjs",
                b"/$bunfs/root/node_modules/both/common.cjs",
                b"/$bunfs/root/node_modules/orm/node_modules/driver/own.js",
                b"/$bunfs/root/node_modules/@scope/closed/lib/feature.js",
                b"/$bunfs/root/node_modules/@scope/closed/lib/inner.js",
                b"/$bunfs/root/node_modules/orm/index.js",
            ];

            fn find_file(path: &[u8]) -> Option<&'static [u8]> {
                FILES.into_iter().find(|&file| file == path)
            }

            fn program(preserves_source_paths: bool) -> CompiledProgram {
                let entry_points = (0..).zip(FILES).map(|(index, path)| CompiledEntryPoint {
                    file_index: index,
                    module_id: index,
                    source_path: path,
                    module_path: path,
                });
                let order = (0..FILES.len() as u32).collect();
                let names: [(&[u8], Option<u32>, Option<u32>, bool); 7] = [
                    (b"/$bunfs/root/node_modules/@scope/closed", None, None, true),
                    (
                        b"/$bunfs/root/node_modules/@scope/closed/feature",
                        Some(6),
                        Some(6),
                        false,
                    ),
                    (b"/$bunfs/root/node_modules/both", Some(4), Some(3), true),
                    (b"/$bunfs/root/node_modules/driver", Some(1), Some(1), false),
                    (b"/$bunfs/root/node_modules/driver/", Some(2), None, false),
                    (b"/$bunfs/root/node_modules/orm/", None, None, false),
                    (
                        b"/$bunfs/root/node_modules/orm/node_modules/driver",
                        Some(5),
                        None,
                        false,
                    ),
                ];
                let names = names.map(|(path, required, imported, hides_other_paths)| {
                    CompiledPackageName {
                        path,
                        required,
                        imported,
                        hides_other_paths,
                    }
                });
                let program = CompiledProgram::new(
                    b"image",
                    None,
                    entry_points.collect(),
                    order,
                    preserves_source_paths,
                )
                .with_package_names(Box::new(names));
                program.set_module_lookup(find_file);
                program
            }

            fn find_in(
                program: &CompiledProgram,
                source_dir: &[u8],
                specifier: &[u8],
                is_require: bool,
            ) -> PackageLookup {
                let extensions = [&b".js"[..], b".cjs"].map(Box::<[u8]>::from);
                let search = ExtensionSearch {
                    extensions: &extensions,
                    extra_extensions: &[],
                    rewritten_extensions: &rewrite,
                };
                program.resolve_package(ROOT, source_dir, specifier, is_require, &search)
            }

            fn require(source_dir: &[u8], specifier: &[u8]) -> PackageLookup {
                find_in(&program(false), source_dir, specifier, true)
            }

            #[test]
            fn name_of_package_leads_to_its_main_file() {
                assert_eq!(require(ROOT, b"driver"), Found(FILES[1]));
                assert_eq!(
                    require(b"/$bunfs/root/lib/deep/", b"driver"),
                    Found(FILES[1])
                );
                assert_eq!(
                    require(b"/$bunfs/root/node_modules/both/", b"driver"),
                    Found(FILES[1])
                );
            }

            #[test]
            fn nearest_folder_wins() {
                assert_eq!(
                    require(b"/$bunfs/root/node_modules/orm/lib/", b"driver"),
                    Found(FILES[5])
                );
                let program = program(false);
                let imported = find_in(
                    &program,
                    b"/$bunfs/root/node_modules/orm/lib/",
                    b"driver",
                    false,
                );
                assert_eq!(imported, Unknown);
            }

            #[test]
            fn kind_of_load_chooses() {
                let program = program(false);
                assert_eq!(find_in(&program, ROOT, b"both", true), Found(FILES[4]));
                assert_eq!(find_in(&program, ROOT, b"both", false), Found(FILES[3]));
            }

            #[test]
            fn path_below_package_is_a_path() {
                assert_eq!(require(ROOT, b"driver/lib/extra"), Found(FILES[2]));
                assert_eq!(require(ROOT, b"driver/lib/extra.js"), Found(FILES[2]));
                assert_eq!(require(ROOT, b"driver/lib/../lib/extra"), Found(FILES[2]));
                assert_eq!(require(ROOT, b"driver/lib/extra/."), Found(FILES[2]));
                assert_eq!(require(ROOT, b"driver/lib/extra.js/"), Found(FILES[2]));
                let directory = [&b"driver/lib/extra"[..], &[bun_paths::SEP]].concat();
                assert_eq!(require(ROOT, &directory), Unknown);
                assert_eq!(
                    require(ROOT, b"driver/../@scope/closed/lib/inner"),
                    Found(FILES[7])
                );
            }

            #[test]
            fn folder_leads_to_the_main_file_that_was_written_down() {
                let program = program(false);
                let load = |specifier: &[u8], is_require| {
                    let extensions = [&b".js"[..]].map(Box::<[u8]>::from);
                    let search = ExtensionSearch {
                        extensions: &extensions,
                        extra_extensions: &[],
                        rewritten_extensions: &rewrite,
                    };
                    program.resolve_module(ROOT, ROOT, specifier, is_require, &search)
                };
                assert_eq!(load(b"./node_modules/driver", true), Some(FILES[2]));
                assert_eq!(load(b"./node_modules/driver/", true), Some(FILES[2]));
                assert_eq!(load(b"./node_modules/driver", false), None);
                assert_eq!(load(b"./node_modules/orm", true), None);
                assert_eq!(load(b"./node_modules/orm/index", true), Some(FILES[8]));
                let directory = [&b"driver"[..], &[bun_paths::SEP]].concat();
                assert_eq!(require(ROOT, &directory), Found(FILES[2]));
                assert_eq!(require(ROOT, b"driver"), Found(FILES[1]));
            }

            #[test]
            fn package_with_exports_has_only_its_written_names() {
                assert_eq!(require(ROOT, b"@scope/closed/feature"), Found(FILES[6]));
                assert_eq!(require(ROOT, b"@scope/closed"), Unknown);
                assert_eq!(require(ROOT, b"@scope/closed/package.json"), Unknown);
                assert_eq!(require(ROOT, b"@scope"), Unknown);
                for hidden in [
                    &b"@scope/closed/feature/"[..],
                    b"@scope/closed/feature\\",
                    b"@scope/closed/feature/.",
                    b"@scope/closed//feature",
                    b"@scope/closed/./feature",
                    b"@scope/closed/lib/../feature",
                    b"@scope/closed/lib/inner.js",
                    b"@scope/closed/lib/feature",
                    b"@scope/closed/",
                    b"both/",
                    b"both/common.cjs",
                ] {
                    assert_eq!(
                        require(ROOT, hidden),
                        Hidden,
                        "{}",
                        String::from_utf8_lossy(hidden)
                    );
                }
            }

            #[test]
            fn name_with_a_backslash_is_a_path() {
                assert_eq!(require(ROOT, b"both\\common.cjs"), Found(FILES[4]));
                assert_eq!(require(ROOT, b"@scope\\closed/lib/inner"), Found(FILES[7]));
            }

            #[test]
            fn directory_is_named_where_the_join_keeps_the_separator() {
                use bun_paths::resolve_path::{join_abs_string_buf, platform};
                let mut buffer = [0u8; 256];
                for specifier in [
                    &b"driver/lib"[..],
                    b"driver/lib/",
                    b"driver/lib\\",
                    b"driver/lib//",
                    b"driver/lib/\\",
                    b"driver/lib\\/",
                    b"driver/lib/.",
                    b"driver/lib/./",
                    b"driver/",
                    b"driver\\",
                ] {
                    let parts = [&b"node_modules"[..], specifier];
                    let on_windows =
                        join_abs_string_buf::<platform::Windows>(b"C:\\app", &mut buffer, &parts)
                            .ends_with(b"\\");
                    assert_eq!(
                        names_directory_below_node_modules(specifier, Platform::Windows),
                        on_windows,
                        "{}",
                        String::from_utf8_lossy(specifier)
                    );
                    #[cfg(not(windows))]
                    assert_eq!(
                        names_directory_below_node_modules(specifier, Platform::Posix),
                        join_abs_string_buf::<platform::Loose>(b"/app", &mut buffer, &parts)
                            .ends_with(b"/"),
                        "{}",
                        String::from_utf8_lossy(specifier)
                    );
                }
            }

            #[test]
            fn misses() {
                assert_eq!(require(ROOT, b"absent"), Unknown);
                assert_eq!(require(ROOT, b"driver/absent"), Unknown);
                assert_eq!(require(ROOT, b"./driver"), Unknown);
                assert_eq!(require(ROOT, b"/$bunfs/root/node_modules/driver"), Unknown);
                assert_eq!(require(ROOT, b""), Unknown);
                assert_eq!(require(b"/project/app/", b"driver"), Unknown);
                assert_eq!(require(b"/$bunfs/root/_.._/shared/", b"driver"), Unknown);
                assert_eq!(find_in(&program(true), ROOT, b"driver", true), Unknown);
            }
        }

        #[test]
        fn program_in_place_has_no_embedded_paths() {
            assert_eq!(
                resolve_in(&program_with_lookup(true), ROOT, b"./lib.cjs"),
                None
            );
        }

        #[test]
        fn program_without_lookup_resolves_nothing() {
            let program = CompiledProgram::new(b"image", None, Box::new([]), Box::new([]), false);
            assert_eq!(resolve_in(&program, ROOT, b"./lib.cjs"), None);
        }
    }
}
