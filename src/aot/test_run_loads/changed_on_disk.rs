//! The files of a test run that the run itself writes, moves or removes, and the files that it loads once more under a query.

use bun_core::strings::{contains_char, index_of_char_usize, last_index_of_char};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::hir::{File, NodeData};
use bun_sema::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::from_argument;

use crate::diagnostics::range_of_node;

fn node_of_site(hir: &File<'_>, site: &ImportSite) -> NodeData {
    match (
        site.specifier_node.some().or_else(|| site.kind.call()),
        site.kind,
    ) {
        (Some(expression), _) => NodeData::Expr(expression),
        (None, ImportSiteKind::Import(import)) => NodeData::Stmt(hir[import].stmt),
        (None, ImportSiteKind::ExportFrom(export)) => NodeData::Stmt(hir[export].stmt),
        (None, ImportSiteKind::ExportStar(statement)) => NodeData::Stmt(statement),
        (None, ImportSiteKind::ImportEquals(import)) => NodeData::Stmt(hir[import].stmt),
        (None, _) => NodeData::None,
    }
}

/// `import("./a.ts?again")` in code that runs: the offset of the first. `LoadHost::resolve_code` leaves such a name to the loader of a test run, which reads the file
/// once more. Nobody has read the copy, so it may import any name of any file.
/// `import(`./a.ts?fresh=${n}`)`: the path is spelled whatever the query turns out to be, so the copy is a copy of that file: `FilesNamedWithQueries::spelled`.
pub(super) fn names_file_with_query(request: &FinishedFile<'_, '_>) -> FilesNamedWithQueries {
    let &FinishedFile {
        hir,
        analysis,
        atoms,
        ..
    } = request;
    let has_query = |text: Atom| contains_char(atoms.bytes(text), b'?');
    let mut found = FilesNamedWithQueries::default();
    for site in analysis.import_sites.iter() {
        // A file that is folded again may keep the sites of the folding before.
        if (site.kind.call()).is_some_and(|call| analysis.decisions.is_dead_expr(call)) {
            continue;
        }
        for name in analysis.alternatives_of(&site.specifier) {
            let text_with_path = match *name {
                ImportSpecifier::Constant(text) if has_query(text) => Some(text),
                ImportSpecifier::Pattern { prefix, .. } if has_query(prefix) => Some(prefix),
                ImportSpecifier::Pattern { suffix, .. } if has_query(suffix) => None,
                _ => continue,
            };
            let at = range_of_node(hir, node_of_site(hir, site)).0;
            match text_with_path {
                Some(text) => found.spelled.push((text, at)),
                None => found.unspelled_at = Some(found.unspelled_at.map_or(at, |it| it.min(at))),
            }
        }
    }
    found
}

#[derive(Default)]
pub(crate) struct FilesNamedWithQueries {
    /// A text that holds the whole path and the `?` behind it, with the offset of the place.
    pub spelled: Vec<(Atom, u32)>,
    /// The offset of the first place whose path nobody can read.
    pub unspelled_at: Option<u32>,
}

/// As the resolver goes from a name in a TypeScript project to a file. Only a file that the build has read counts: its text says what the copy imports.
pub(super) fn find_file_in_front_of_query(
    files: &Files<'_>,
    importer: FileId,
    text: Atom,
) -> Option<FileId> {
    let text = files.atoms.bytes(text);
    let path = &text[..index_of_char_usize(text, b'?')?];
    if !matches!(path, [b'/', ..] | [b'.', b'/', ..] | [b'.', b'.', b'/', ..]) {
        return None;
    }
    let folder = dirname::<Posix>(files.module(importer).file_name());
    let whole = from_argument(folder, path);
    let with_end = |stem: &[u8], end: &[u8]| files.by_path.get(&[stem, end].concat());
    if let Some(file) = files.by_path.get(&whole) {
        return Some(file);
    }
    const WRITTEN_FOR: [(&[u8], &[&[u8]]); 4] = [
        (b".js", &[b".ts", b".tsx", b".jsx"]),
        (b".jsx", &[b".tsx"]),
        (b".mjs", &[b".mts"]),
        (b".cjs", &[b".cts"]),
    ];
    for (written, ends) in WRITTEN_FOR {
        if let Some(stem) = whole.strip_suffix(written) {
            return ends.iter().find_map(|end| with_end(stem, end));
        }
    }
    const ENDS: [&[u8]; 8] = [
        b".ts", b".tsx", b".mts", b".cts", b".js", b".jsx", b".mjs", b".cjs",
    ];
    let as_file = ENDS.iter().find_map(|end| with_end(&whole, end));
    as_file.or_else(|| {
        let index = [&whole[..], b"/index"].concat();
        ENDS.iter().find_map(|end| with_end(&index, end))
    })
}

/// Paths that a test run writes, moves or removes and that a file spells in part: each begins with `start` and ends with `end`.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct ChangedPaths {
    start: Vec<u8>,
    end: Vec<u8>,
}

fn end_with_slash(path: &mut Vec<u8>) {
    if !path.ends_with(b"/") {
        path.push(b'/');
    }
}

/// `start` goes on behind its end, so what stands behind its last slash is kept as it is.
pub(super) fn write_whole_start(folder: &[u8], start: &[u8]) -> Vec<u8> {
    let (head, name) = match last_index_of_char(start, b'/') {
        Some(slash) => (&start[..slash.max(1)], &start[slash + 1..]),
        None => (&b"."[..], start),
    };
    let mut whole = from_argument(folder, head);
    end_with_slash(&mut whole);
    whole.extend_from_slice(name);
    whole
}

/// The compiled files at `whole` paths, and those whose names begin and end as one of `in_part` says.
fn find_files_at(
    files: &Files<'_>,
    whole: &[Vec<u8>],
    in_part: &mut Vec<ChangedPaths>,
) -> Vec<FileId> {
    let at_paths = whole.iter().filter_map(|path| files.by_path.get(path));
    let at_paths: Vec<FileId> = at_paths.collect();
    if at_paths.is_empty() && in_part.is_empty() {
        return Vec::new();
    }
    in_part.shared_sort_unstable();
    in_part.dedup();
    let names = files.compiled_files().iter();
    let mut names: Vec<(&[u8], FileId)> = names
        .map(|&file| (files.module(file).file_name(), file))
        .collect();
    names.shared_sort_unstable();
    let mut found: Vec<FileId> = Vec::new();
    // What an import attribute makes of a file has the name of the file, and `by_path` holds one file a path.
    for &file in &at_paths {
        let path = files.module(file).file_name();
        let first = names.partition_point(|&(name, _)| name < path);
        let with_name = names[first..].iter().take_while(|(name, _)| *name == path);
        found.extend(with_name.map(|&(_, file)| file));
    }
    for paths in in_part.iter() {
        let (start, end) = (&paths.start[..], &paths.end[..]);
        let first = names.partition_point(|&(name, _)| name < start);
        let with_start = (names[first..].iter()).take_while(|(name, _)| name.starts_with(start));
        let with_end = with_start
            .filter(|(name, _)| name.len() >= start.len() + end.len() && name.ends_with(end));
        found.extend(with_end.map(|&(_, file)| file));
    }
    found
}

/// What the files of a run spell to calls that write, move or remove what is there.
#[derive(Default)]
pub(super) struct ChangedOnDisk {
    whole_paths: Vec<Vec<u8>>,
    paths_in_part: Vec<ChangedPaths>,
}

impl ChangedOnDisk {
    /// `bun test` reads a file when something first loads it, so it runs what the tests have written there by then.
    /// A path of which the file spells nothing counts for nothing: a test writes where it likes, mostly into a folder of its own.
    /// `working_directory`: in the format of the checker.
    pub(super) fn look_at_changed_paths(
        &mut self,
        files: &Files<'_>,
        working_directory: &[u8],
        file: FileId,
    ) {
        let analysis = files.analysis(file);
        let text_of = |atom: Atom| files.atoms.bytes(atom);
        for changed in analysis.paths_of_changed_files {
            // A file that is folded again may keep the paths of the folding before.
            if analysis.decisions.is_dead_expr(changed.operand) {
                continue;
            }
            let starts_at_own_folder = analysis.is_path_from_own_directory(changed.operand)
                || analysis.find_resolved_form(changed.operand).is_some();
            let folder = match starts_at_own_folder {
                true => dirname::<Posix>(files.module(file).file_name()),
                false => working_directory,
            };
            for alternative in analysis.alternatives_of(&changed.path) {
                match *alternative {
                    ImportSpecifier::Constant(path) => {
                        // Nothing lies at the empty path: `createWriteStream("", { fd })`. Joined to a folder it would be the folder.
                        if text_of(path).is_empty() {
                            continue;
                        }
                        let whole = from_argument(folder, text_of(path));
                        if changed.reaches_below {
                            let mut start = whole.clone();
                            end_with_slash(&mut start);
                            let end = Vec::new();
                            self.paths_in_part.push(ChangedPaths { start, end });
                        }
                        self.whole_paths.push(whole);
                    }
                    ImportSpecifier::Pattern { prefix, suffix } => {
                        let start = write_whole_start(folder, text_of(prefix));
                        let end = match changed.reaches_below {
                            true => Vec::new(),
                            false => text_of(suffix).to_vec(),
                        };
                        self.paths_in_part.push(ChangedPaths { start, end });
                    }
                    ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {}
                }
            }
        }
    }

    /// The compiled files there. Ascending, each once.
    pub(super) fn find_files(mut self, files: &Files<'_>) -> Vec<FileId> {
        let mut found = find_files_at(files, &self.whole_paths, &mut self.paths_in_part);
        found.shared_sort_unstable();
        found.dedup();
        found
    }
}
