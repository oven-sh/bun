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
    /// The source index of the file `record` points at, by path. An external
    /// file record (`PRINT_PATH_RELATIVE_TO_OUTPUT`) carries that file's
    /// absolute path but never has a source index, even when the same file is
    /// also bundled (as an entry point, say).
    pub(crate) fn get_record(&self, record: &ImportRecord) -> Option<IndexInt> {
        if record
            .flags
            .contains(ImportRecordFlags::PRINT_PATH_RELATIVE_TO_OUTPUT)
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
