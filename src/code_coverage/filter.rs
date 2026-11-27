use core::cell::LazyCell;
use core::ops::Deref;
use std::sync::OnceLock;

use bun_ast::{Loader, LoaderHashTable};
use bun_collections::StringSet;
use bun_core::fmt::quote;
use bun_core::{strings, warn};
use bun_glob::{BunGlobWalker, Prepared, walk};
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_paths::Path;
use bun_paths::portable::has_dot_dot;
use bun_sys::Fd;

use crate::files::{can_be_on_disk, is_file};

pub struct Project {
    pub root: &'static [u8],
    pub loaders: LoaderHashTable,
    pub suffixes_of_test_files: &'static [&'static [u8]],
    pub preloads: Vec<Box<[u8]>>,
    /// The module for this query does not have the code of the file.
    pub is_generated_for: fn(query: &[u8], by_extension: Loader) -> bool,
}

/// Which files the report is about.
pub(crate) struct Filter {
    project: Project,
    /// With their real paths. On Windows the working directory keeps junctions and `subst` drives.
    root_and_parents: Vec<[Path; 2]>,
    skips_test_files: bool,
    includes: Vec<Pattern>,
    ignores: Vec<Pattern>,
    /// `--changed`. Workers do not have them.
    pub(crate) changed_files: OnceLock<StringSet>,
}

pub(crate) struct Pattern {
    written: Box<[u8]>,
    /// The real path of what it starts with. `None`: `glob` is for the way from the root, which can lead out of it.
    start: Option<Path>,
    /// Empty if `start` is a file.
    glob: Prepared<Box<[u8]>>,
    /// If `glob` ends in a name, which can be that of a folder.
    inside: Option<Prepared<Vec<u8>>>,
}

pub(crate) enum Selection {
    Only(Pattern),
    AllBut(Pattern),
}

pub(crate) fn real_path(path: &[u8]) -> Option<Path> {
    if !can_be_on_disk(path) {
        return None;
    }
    let mut buffer = bun_paths::path_buffer_pool::get();
    Some(Path::from(
        bun_sys::realpath(&Path::from(path), &mut buffer).ok()?,
    ))
}

fn real_path_or_same(path: &[u8]) -> Path {
    real_path(path).unwrap_or_else(|| Path::from(path))
}

/// Of the file that the system opens for `name`.
pub(crate) fn absolute_path(name: &[u8]) -> Path {
    if !has_dot_dot(name) {
        return Path::resolve(&[bun_core::top_level_dir(), name]);
    }
    // `link/..` is not where the link is.
    let folder = real_path_or_same(bun_core::top_level_dir());
    let normal = Path::resolve(&[&folder, name]);
    let real = match bun_paths::is_absolute(name) {
        true => real_path(name),
        false => real_path(&Path::from_parts(&[&folder, name])),
    };
    (real.filter(|it| it.as_bytes() != real_path_or_same(&normal).as_bytes())).unwrap_or(normal)
}

/// The path of what a plugin loads has the query.
fn split_at_query(path: &[u8]) -> Option<(&[u8], &[u8])> {
    Some(path.split_at(strings::index_of_char_usize(path, b'?')?))
}

pub(crate) fn without_query(path: &[u8]) -> &[u8] {
    (split_at_query(path).filter(|_| !is_file(path))).map_or(path, |it| it.0)
}

impl Pattern {
    /// The name of what exists is no glob: `app/[id]`.
    fn of_entry(written: &[u8], root: &[u8]) -> Pattern {
        let (start, rest) = bun_paths::ancestors(written)
            .find_map(|it| {
                Some((
                    real_path(&Path::resolve(&[root, it]))?,
                    &written[it.len()..],
                ))
            })
            .unzip();
        let is_folder = |it: &Path| bun_sys::directory_exists_at(Fd::cwd(), it).unwrap_or(false);
        let rest = rest.map(|it| it.strip_prefix(&[bun_paths::SEP]).unwrap_or(it));
        let glob: &[u8] = match rest.map_or(written, |it| strings::trim_left(it, b"/")) {
            b"" if start.as_ref().is_none_or(is_folder) => b"**",
            // Where it is written it does not negate.
            glob @ [b'!', next, ..] if start.is_some() && *next != b'(' => &[b"\\", glob].concat(),
            glob => glob,
        };
        let [star, slash] = b"*/".map(|it| strings::last_index_of_char(glob, it));
        Pattern {
            written: written.into(),
            start,
            glob: Prepared::new(glob.into()),
            inside: (star <= slash)
                .then(|| Prepared::new([strings::trim_right(glob, b"/"), b"/**"].concat())),
        }
    }

    /// `None` if `written` does not negate.
    fn negated_by(written: &[u8], root: &[u8]) -> Option<Pattern> {
        let pattern = Pattern::of_entry(written.strip_prefix(b"!")?, root);
        // `!(a)` is a glob for all but `a`.
        (pattern.start.is_some() || !pattern.written.starts_with(b"(")).then_some(pattern)
    }

    fn inside_of_root(written: &[u8], root: &[u8]) -> Pattern {
        let mut pattern = Pattern::of_entry(written, root);
        (pattern.start).get_or_insert_with(|| real_path_or_same(root));
        pattern
    }

    fn matches(
        &self,
        relative: &dyn Deref<Target = Path>,
        real: &dyn Deref<Target = Path>,
    ) -> bool {
        let rest = match &self.start {
            Some(start) => bun_paths::strip_prefix(real, start),
            None => Some(relative.as_bytes()),
        };
        rest.is_some_and(|rest| {
            self.glob.r#match(rest).matches()
                || (self.inside.as_ref()).is_some_and(|it| it.r#match(rest).matches())
        })
    }

    pub(crate) fn find_files(&self) -> Vec<Box<[u8]>> {
        let Some(start) = &self.start else {
            return Vec::new();
        };
        let glob = self.glob.pattern();
        if glob.is_empty() {
            return Vec::from_iter(is_file(start).then(|| start.as_bytes().into()));
        }
        let globs = core::iter::once(glob).chain(self.inside.as_ref().map(Prepared::pattern));
        // On Windows the walker takes it for a separator.
        let globs = globs.filter(|it| !strings::contains_char(it, b'\\'));
        let mut files: Vec<_> = globs.flat_map(|it| find_files(start, it)).collect();
        // It takes `{a/b,c}` apart at the slash.
        if files.is_empty() && strings::contains_any(glob, b"{(\\") {
            files = find_files(start, b"**");
        }
        files.retain(|it| self.matches(&start, &&Path::from(it)));
        files
    }
}

fn find_files(folder: &[u8], glob: &[u8]) -> Vec<Box<[u8]>> {
    let (dot, absolute, only_files) = (true, true, true);
    let walker = BunGlobWalker::init_with_cwd(
        glob,
        folder,
        dot,
        absolute,
        false,
        false,
        only_files,
        Some(|name| name == b"node_modules" || name == b".git"),
    );
    let mut files = Vec::new();
    let Ok(Ok(mut walker)) = walker else {
        return files;
    };
    let mut matches = walk::Iterator::new(&mut walker);
    if let Ok(Err(error)) = matches.init() {
        warn_about_unread(folder, &error);
        return files;
    }
    while let Ok(Some(found)) = matches.next().map(Result::transpose) {
        match found {
            Ok(file) => files.push(file),
            Err(error) => warn_about_unread(&error.path, &error),
        }
    }
    files
}

pub(crate) fn warn_about_unread(path: &[u8], error: &bun_sys::Error) {
    warn!(
        "Failed to read {} ({}). It is not in the coverage report.",
        quote(path),
        bstr::BStr::new(error.name()),
    );
}

impl Filter {
    pub(crate) fn new(options: &CodeCoverageOptions, project: Project) -> Filter {
        let mut includes = Vec::new();
        let mut ignores: Vec<_> = (options.ignore_patterns.iter())
            .map(|it| Pattern {
                written: it.clone(),
                start: None,
                glob: Prepared::new(it.clone()),
                inside: None,
            })
            .collect();
        for entry in &options.include_patterns {
            match Pattern::negated_by(entry, project.root) {
                Some(pattern) => ignores.push(pattern),
                None => includes.push(Pattern::inside_of_root(entry, project.root)),
            }
        }
        if includes.is_empty() && !options.include_patterns.is_empty() {
            includes.push(Pattern::inside_of_root(b".", project.root));
        }
        let mut filter = Filter {
            root_and_parents: (bun_paths::ancestors(project.root))
                .map(|it| [Path::from(it), real_path_or_same(it)])
                .collect(),
            project,
            skips_test_files: options.skip_test_files,
            includes,
            ignores,
            changed_files: OnceLock::new(),
        };
        filter.project.preloads = (filter.project.preloads.iter())
            .map(|it| filter.by_way_of_root(it).as_bytes().into())
            .collect();
        filter
    }

    pub(crate) fn root(&self) -> &'static [u8] {
        self.project.root
    }

    fn respell(&self, path: &[u8], choose: fn(&[Path; 2]) -> &Path) -> Path {
        let found = self.root_and_parents.iter().find_map(|both| {
            let rest = (both.iter()).find_map(|it| bun_paths::strip_prefix(path, it))?;
            Some((choose(both), rest))
        });
        let Some((folder, rest)) = found else {
            return Path::from(path);
        };
        let mut path = Path::from(folder);
        path.push_trailing_sep();
        path.extend_from_slice(rest);
        path
    }

    /// What the other methods take.
    pub(crate) fn by_way_of_root(&self, path: &[u8]) -> Path {
        self.respell(path, |[written, _]| written)
    }

    pub(crate) fn without_link_to_root(&self, path: &[u8]) -> Path {
        self.respell(path, |[_, real]| real)
    }

    pub(crate) fn name_of(&self, path: &[u8]) -> Path {
        // `namespace:../../a` is not `a`.
        if !bun_paths::is_absolute(path) && has_dot_dot(path) {
            return Path::from(path);
        }
        let root = self.project.root;
        Path::relative(root, &Path::resolve(&[root, path]))
    }

    pub(crate) fn select(&self, written: &[u8]) -> Selection {
        match Pattern::negated_by(written, self.project.root) {
            Some(pattern) => Selection::AllBut(pattern),
            None => Selection::Only(Pattern::inside_of_root(written, self.project.root)),
        }
    }

    pub(crate) fn is_in(&self, selection: &Selection, path: &[u8]) -> bool {
        match selection {
            Selection::Only(it) => self.matches_any(core::slice::from_ref(it), path),
            Selection::AllBut(it) => !self.matches_any(core::slice::from_ref(it), path),
        }
    }

    pub(crate) fn inside_of_root<'a>(&self, path: &'a [u8]) -> Option<&'a [u8]> {
        bun_paths::strip_prefix(path, self.project.root)
    }

    pub(crate) fn loader_by_extension(&self, path: &[u8]) -> Loader {
        let loader = self.project.loaders.get(bun_paths::extension(path));
        loader.copied().unwrap_or(Loader::File)
    }

    pub(crate) fn is_dependency(&self, path: &[u8]) -> bool {
        let mut components = bun_paths::components(self.inside_of_root(path).unwrap_or(path));
        components.any(|it| it == b"node_modules")
    }

    pub(crate) fn is_source_file(&self, path: &[u8]) -> bool {
        if path.starts_with(b"data:") || path.starts_with(b"blob:") || self.is_dependency(path) {
            return false;
        }
        if let Some((file, query)) = split_at_query(path)
            && (self.project.is_generated_for)(query, self.loader_by_extension(file))
        {
            return false;
        }
        let loader = self.loader_by_extension(path);
        let stem = &path[..path.len() - bun_paths::extension(path).len()];
        let is_test_file = (self.project.suffixes_of_test_files.iter())
            .any(|it| stem.ends_with(it))
            || (self.project.preloads.iter())
                .any(|it| bun_paths::strip_prefix(path, it) == Some(b""));
        // A plugin can make code of a file of a kind that Bun does not know.
        (loader.is_javascript_like() || loader == Loader::File)
            && !(self.skips_test_files && is_test_file)
    }

    fn matches_any(&self, patterns: &[Pattern], path: &[u8]) -> bool {
        let relative = LazyCell::new(|| self.name_of(path));
        let real =
            LazyCell::new(|| real_path(path).unwrap_or_else(|| self.without_link_to_root(path)));
        patterns.iter().any(|it| it.matches(&relative, &real))
            || split_at_query(path).is_some_and(|it| self.matches_any(patterns, it.0))
    }

    pub(crate) fn is_ignored(&self, path: &[u8]) -> bool {
        self.matches_any(&self.ignores, path)
    }

    pub(crate) fn is_included(&self, path: &[u8]) -> bool {
        match self.includes.is_empty() {
            true => !bun_paths::is_absolute(path) || self.inside_of_root(path).is_some(),
            false => self.matches_any(&self.includes, path),
        }
    }

    pub(crate) fn is_unchanged(&self, path: &[u8]) -> bool {
        self.changed_files.get().is_some_and(|changed| {
            !changed.contains(path)
                && !changed.contains(&real_path_or_same(path))
                && split_at_query(path).is_none_or(|it| self.is_unchanged(it.0))
        })
    }

    /// The files that are reported even though they are not among `loaded`.
    pub(crate) fn find_others<'a>(
        &self,
        loaded: impl Iterator<Item = &'a [u8]>,
        reports_directory: &[u8],
    ) -> Vec<Path> {
        let mut others = Vec::new();
        if self.includes.is_empty() {
            return others;
        }
        let mut seen = StringSet::new();
        for path in loaded {
            let file = real_path(path).or_else(|| real_path(split_at_query(path)?.0));
            bun_core::handle_oom(file.map_or(Ok(()), |it| seen.insert(&it)));
        }
        let reports = real_path_or_same(&Path::resolve(&[self.project.root, reports_directory]));
        let is_among_reports = |it: &[u8]| bun_paths::strip_prefix(it, &reports).is_some();
        for pattern in &self.includes {
            // An HTML report has scripts.
            let skips_reports = !(pattern.start.as_ref()).is_some_and(|it| is_among_reports(it));
            let files = pattern.find_files();
            if files.is_empty() {
                let pattern = quote(&pattern.written);
                warn!("No file matches the coverage include pattern {}", pattern);
            }
            for path in files {
                if seen.contains(&path)
                    || skips_reports && is_among_reports(&path)
                    || !self.loader_by_extension(&path).is_javascript_like()
                    || bun_sema::resolve::is_declaration_file_name(&path)
                    || real_path(&path).is_none_or(|it| *it.as_bytes() != *path)
                {
                    continue;
                }
                bun_core::handle_oom(seen.insert(&path));
                let path = self.by_way_of_root(&path);
                if self.is_source_file(&path) && !self.is_ignored(&path) {
                    others.push(path);
                }
            }
        }
        others
    }
}
