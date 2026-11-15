use bun_sema::check::aot::TypeIdentity;
use bun_sema::program::FileId;
use bun_threading::Guarded;
use rustc_hash::FxHashMap;

use super::CheckerTypeId;
use super::layouts::ObjectTypeKey;

const SHARDS: usize = 64;

type LeastFiles = FxHashMap<(CheckerTypeId, bool), FileId>;

/// The names that the layout of an object type has, and the type.
pub(in crate::lower) type SaidKey = (TypeIdentity, ObjectTypeKey);

type LeastFilesOfKeys = FxHashMap<SaidKey, FileId>;

pub struct SaidTypes {
    shards: [Guarded<LeastFiles>; SHARDS],
    /// The link takes one definition of each, that of the least file.
    keys: [Guarded<LeastFilesOfKeys>; SHARDS],
}

impl Default for SaidTypes {
    fn default() -> SaidTypes {
        SaidTypes {
            shards: core::array::from_fn(|_| Guarded::new(LeastFiles::default())),
            keys: core::array::from_fn(|_| Guarded::new(LeastFilesOfKeys::default())),
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

    fn shard_of_key(&self, (names, _): &SaidKey) -> &Guarded<LeastFilesOfKeys> {
        &self.keys[names.0[0] as usize % SHARDS]
    }

    pub(in crate::lower) fn find_key(&self, key: &SaidKey) -> Option<FileId> {
        self.shard_of_key(key).lock().get(key).copied()
    }

    /// Call when the checker's types get new numbers.
    pub fn forget(&self) {
        for shard in &self.shards {
            *shard.lock() = LeastFiles::default();
        }
        for shard in &self.keys {
            *shard.lock() = LeastFilesOfKeys::default();
        }
    }

    pub fn note_commit(
        &self,
        file: FileId,
        is_checked: bool,
        said: &[CheckerTypeId],
        said_keys: &[(TypeIdentity, ObjectTypeKey)],
    ) {
        for key in said_keys {
            let mut least_files = self.shard_of_key(key).lock();
            let least = least_files.entry(*key).or_insert(file);
            *least = file.min(*least);
        }
        for &ty in said {
            let mut least_files = self.shard(ty).lock();
            let least = least_files.entry((ty, is_checked)).or_insert(file);
            *least = file.min(*least);
        }
    }
}
