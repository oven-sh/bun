use bun_sema::program::FileId;
use bun_threading::Guarded;
use rustc_hash::FxHashMap;

use super::CheckerTypeId;

const SHARDS: usize = 64;

type LeastFiles = FxHashMap<(CheckerTypeId, bool), FileId>;

/// The least file of a project that has said what the fields of a type hold and whose visit is committed, by the type and by whether the file is checked.
/// `MemoEntry::said_by` says the same of the files under one set of tables. The link takes what the least file says and drops the rest, under whichever tables it stands.
pub struct SaidTypes {
    shards: [Guarded<LeastFiles>; SHARDS],
}

impl Default for SaidTypes {
    fn default() -> SaidTypes {
        SaidTypes {
            shards: core::array::from_fn(|_| Guarded::new(LeastFiles::default())),
        }
    }
}

impl SaidTypes {
    fn shard(&self, ty: CheckerTypeId) -> &Guarded<LeastFiles> {
        &self.shards[ty.0 as usize % SHARDS]
    }

    pub(in crate::lower) fn find(&self, ty: CheckerTypeId, is_checked: bool) -> Option<FileId> {
        self.shard(ty).lock().get(&(ty, is_checked)).copied()
    }

    /// `said`: `Fragment::said_types`.
    pub fn note_commit(&self, file: FileId, is_checked: bool, said: &[CheckerTypeId]) {
        for &ty in said {
            let mut least_files = self.shard(ty).lock();
            let least = least_files.entry((ty, is_checked)).or_insert(file);
            *least = file.min(*least);
        }
    }
}
