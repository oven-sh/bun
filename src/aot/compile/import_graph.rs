use crate::load::sources::parsed_source;
use crate::options::{FileBelowFileLeftToLoader, LoadsBelowFilesLeftToLoader};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema_driver::host::to_native;
use rustc_hash::FxHashMap;

pub(crate) struct ImportGraph {
    file_of_path: FxHashMap<Vec<u8>, u32>,
    referrers: Vec<Vec<u32>>,
    entry_points: Vec<u32>,
    /// `Module::code_edges`
    loads: Vec<Vec<u32>>,
    /// `FileBelowFileLeftToLoader::loads_unknown_files`
    loads_unknown_files: Vec<bool>,
    /// A site of some file spells a specifier that finds the file. Any other file is there because a computed name may find it.
    is_named: Vec<bool>,
}

fn loads_unknown_files(files: &Files<'_>, file: FileId) -> bool {
    let Some(compiled) = files.module(file).compiled else {
        return false;
    };
    let analysis = &compiled.analysis;
    // Nobody has read the file to its end.
    files.hir(file).ran_out_of_stack
        || parsed_source(files, file).is_none_or(|it| it.builtins.loads_unknown_modules())
        || analysis.import_sites.iter().any(|site| {
            matches!(
                site.kind,
                ImportSiteKind::ImportCall(_)
                    | ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
            ) && analysis
                .alternatives_of(&site.specifier)
                .contains(&ImportSpecifier::Unknown)
        })
}

impl ImportGraph {
    pub(crate) fn of(files: &Files<'_>) -> ImportGraph {
        let file_count = files.modules.len();
        let mut file_of_path = FxHashMap::default();
        let mut referrers: Vec<Vec<u32>> = vec![Vec::new(); file_count];
        let mut loads: Vec<Vec<u32>> = Vec::with_capacity(file_count);
        let mut unknown = Vec::with_capacity(file_count);
        let mut is_named = vec![false; file_count];
        for index in 0..file_count {
            let file = FileId(index as u32);
            let module = files.module(file);
            file_of_path.insert(to_native(module.file_name()).to_vec(), index as u32);
            for target in module.edges.iter().chain(module.code_edges) {
                referrers[target.idx()].push(index as u32);
            }
            let loaded = module.code_edges.iter();
            loads.push(loaded.map(|target| target.idx() as u32).collect());
            unknown.push(loads_unknown_files(files, file));
            let answers = module
                .compiled
                .map_or(&[][..], |compiled| compiled.code_answers);
            let implied = module
                .compiled
                .map_or(&[][..], |compiled| compiled.implied_answers);
            for answer in answers.iter().chain(implied) {
                if let &CodeAnswer::File(target) = answer {
                    is_named[target.idx()] = true;
                }
            }
        }
        let entry_points = files.entry_points().iter().map(|file| file.idx() as u32);
        ImportGraph {
            file_of_path,
            referrers,
            entry_points: entry_points.collect(),
            loads,
            loads_unknown_files: unknown,
            is_named,
        }
    }

    pub(crate) fn holds_files_that_no_site_spells(files: &Files<'_>) -> bool {
        (0..files.modules.len() as u32).any(|index| {
            let compiled = files.module(FileId(index)).compiled;
            let answers = compiled.map_or(&[][..], |compiled| compiled.code_answers);
            (answers.iter()).any(|answer| matches!(answer, CodeAnswer::Computed(_)))
        })
    }

    /// Whether nothing but a computed name finds the file: `import(name)`, `require("./rules/" + name)`.
    pub(crate) fn is_found_by_computed_names_alone(&self, path: &[u8]) -> bool {
        let Some(&file) = self.file_of_path.get(path) else {
            return false;
        };
        !self.is_named[file as usize] && !self.entry_points.contains(&file)
    }

    pub(crate) fn find_entry_points_that_reach<'p>(
        &self,
        paths: impl Iterator<Item = &'p [u8]>,
    ) -> Option<Vec<u32>> {
        let mut reaches = vec![false; self.referrers.len()];
        let mut pending: Vec<u32> = Vec::new();
        for path in paths {
            // A file outside the graph refuses no entry point. Its error stays, and stops the next build.
            let Some(&file) = self.file_of_path.get(path) else {
                continue;
            };
            if !core::mem::replace(&mut reaches[file as usize], true) {
                pending.push(file);
            }
        }
        while let Some(file) = pending.pop() {
            for &referrer in &self.referrers[file as usize] {
                if !core::mem::replace(&mut reaches[referrer as usize], true) {
                    pending.push(referrer);
                }
            }
        }
        let positions = (0u32..).zip(&self.entry_points);
        let reaching = positions.filter(|&(_, &file)| reaches[file as usize]);
        Some(reaching.map(|(position, _)| position).collect())
    }

    /// `left`: `LoadOptions::left_to_loader`, as far as this compile has read them.
    pub(crate) fn find_loads_below(&self, left: &[Vec<u8>]) -> LoadsBelowFilesLeftToLoader {
        const NOWHERE: u32 = u32::MAX;
        let mut place_of = vec![NOWHERE; self.loads.len()];
        let mut found: Vec<u32> = Vec::new();
        let mut find = |file: u32, found: &mut Vec<u32>| {
            if place_of[file as usize] == NOWHERE {
                place_of[file as usize] = found.len() as u32;
                found.push(file);
            }
            place_of[file as usize]
        };
        for path in left {
            if let Some(&file) = self.file_of_path.get(&path[..]) {
                find(file, &mut found);
            }
        }
        let left_count = found.len();
        let mut loads_of_found: Vec<Vec<u32>> = Vec::new();
        while let Some(&file) = found.get(loads_of_found.len()) {
            let loads = self.loads[file as usize].iter();
            loads_of_found.push(loads.map(|&loaded| find(loaded, &mut found)).collect());
        }
        let mut paths: Vec<&[u8]> = vec![&[]; found.len()];
        for (path, &file) in &self.file_of_path {
            if let Some(place) = paths.get_mut(place_of[file as usize] as usize) {
                *place = path;
            }
        }
        let files = found.iter().zip(paths).zip(loads_of_found);
        LoadsBelowFilesLeftToLoader {
            files: files
                .map(|((&file, path), loads)| FileBelowFileLeftToLoader {
                    path: path.to_vec(),
                    loads,
                    loads_unknown_files: self.loads_unknown_files[file as usize],
                })
                .collect(),
            left_count,
        }
    }
}
