pub struct SourceMap {
    // TODO(port): []const u8 struct field in CSS (arena crate) — using raw slice ptr per PORTING.md; revisit ownership in Phase B
    pub project_root: *const [u8],
    pub inner: SourceMapInner,
}

pub struct SourceMapInner {
    // PERF(port): ArrayListUnmanaged in CSS arena crate — using Vec<T>; may need bun_alloc::ArenaVec<'bump, T> in Phase B
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

// ported from: src/css/sourcemap.zig
