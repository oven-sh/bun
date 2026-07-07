pub struct SourceMap {
    // Arena-owned `[]const u8` erased to a raw slice pointer per PORTING.md
    // §Allocators (AST crates); becomes `&'bump [u8]` once the CSS crate
    // threads the arena lifetime.
    pub project_root: *const [u8],
    pub inner: SourceMapInner,
}

pub struct SourceMapInner {
    // PERF: using Vec<T>; may want bun_alloc::ArenaVec<'bump, T> if hot
    // The `*const [u8]` elements of `sources`/`sources_content`/`names` are
    // arena-owned slices erased to raw pointers per PORTING.md §Allocators
    // (AST crates) — never dereferenced after the arena resets; they become
    // `&'bump [u8]` once the CSS crate threads the arena lifetime.
    pub sources: Vec<*const [u8]>,
    pub sources_content: Vec<*const [u8]>,
    pub names: Vec<*const [u8]>,
    pub mapping_lines: Vec<MappingLine>,
}

pub struct MappingLine {
    pub mappings: Vec<LineMapping>,
    pub last_column: u32,
    pub is_sorted: bool,
}

pub struct LineMapping {
    pub generated_column: u32,
    pub original: Option<OriginalLocation>,
}

pub struct OriginalLocation {
    pub original_line: u32,
    pub original_column: u32,
    pub source: u32,
    pub name: Option<u32>,
}
