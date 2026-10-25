use bun_sema::program::{FileId, Files};
use bun_sema_driver::host::to_native;
use rustc_hash::FxHashMap;

pub(crate) struct ImportGraph {
    file_of_path: FxHashMap<Vec<u8>, u32>,
    referrers: Vec<Vec<u32>>,
    entry_points: Vec<u32>,
}

impl ImportGraph {
    pub(crate) fn of(files: &Files<'_>) -> ImportGraph {
        let file_count = files.modules.len();
        let mut file_of_path = FxHashMap::default();
        let mut referrers: Vec<Vec<u32>> = vec![Vec::new(); file_count];
        for index in 0..file_count {
            let file = FileId(index as u32);
            let module = files.module(file);
            file_of_path.insert(to_native(module.file_name()).to_vec(), index as u32);
            for target in module.edges.iter().chain(module.code_edges) {
                referrers[target.idx()].push(index as u32);
            }
        }
        let entry_points = files.entry_points().iter().map(|file| file.idx() as u32);
        ImportGraph {
            file_of_path,
            referrers,
            entry_points: entry_points.collect(),
        }
    }

    pub(crate) fn find_entry_points_that_reach<'p>(
        &self,
        paths: impl Iterator<Item = &'p [u8]>,
    ) -> Option<Vec<u32>> {
        let mut reaches = vec![false; self.referrers.len()];
        let mut pending: Vec<u32> = Vec::new();
        for path in paths {
            let file = *self.file_of_path.get(path)?;
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
}
