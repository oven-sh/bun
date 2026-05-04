use bun_collections::StringHashMap;
use bun_fs::Path as FsPath;
use bun_js_parser::index::Int as IndexInt;

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    pub map: Map,
}

pub type Map = StringHashMap<IndexInt>;

// TODO(port): GetOrPutResult shape depends on bun_collections::StringHashMap entry API
pub type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    pub fn get_path(&self, path: &FsPath) -> Option<IndexInt> {
        self.get(&path.text)
    }

    pub fn get(&self, text: &[u8]) -> Option<IndexInt> {
        self.map.get(text).copied()
    }

    pub fn put_path(&mut self, path: &FsPath, value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        self.map.put(&path.text, value)
    }

    pub fn put(&mut self, text: &[u8], value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        self.map.put(text, value)
    }

    pub fn get_or_put_path(&mut self, path: &FsPath) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        self.get_or_put(&path.text)
    }

    pub fn get_or_put(&mut self, text: &[u8]) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        self.map.get_or_put(text)
    }

    pub fn remove(&mut self, text: &[u8]) -> bool {
        self.map.remove(text)
    }

    pub fn remove_path(&mut self, path: &FsPath) -> bool {
        self.remove(&path.text)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/PathToSourceIndexMap.zig (46 lines)
//   confidence: medium
//   todos:      1
//   notes:      dropped allocator params (StringHashMapUnmanaged→StringHashMap); keys are arena-borrowed bytes per Zig doc comment; GetOrPutResult API needs bun_collections support
// ──────────────────────────────────────────────────────────────────────────
