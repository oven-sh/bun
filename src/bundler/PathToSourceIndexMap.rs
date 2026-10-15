use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_collections::StringHashMap;

use crate::IndexStringMap::IndexInt;

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    pub(crate) map: Map,
}

pub type Map = StringHashMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    /// The module `record` was resolved to: its `source_index`, or for a record
    /// the dev server left without one, the module registered under the path
    /// that import resolution gave the record. A record that import resolution
    /// did not point at a module (external, failed, waiting for a plugin) has
    /// none, whatever its path text is.
    pub(crate) fn module_of_record(&self, record: &ImportRecord) -> Option<IndexInt> {
        if record.source_index.is_valid() {
            return Some(record.source_index.get());
        }
        if !record
            .flags
            .contains(ImportRecordFlags::PATH_IS_RESOLVED_MODULE)
        {
            return None;
        }
        self.get(record.path.text)
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<IndexInt> {
        self.map.get(text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(
        &mut self,
        text: &[u8],
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map.put(text, value)
    }

    pub(crate) fn get_or_put(
        &mut self,
        text: impl AsRef<[u8]>,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.map.get_or_put(text.as_ref())
    }

    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.map.remove(text.as_ref()).is_some()
    }
}
