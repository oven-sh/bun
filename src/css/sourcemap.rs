pub use crate::css_parser as css;
pub use crate::values as css_values;
pub use crate::css_parser::Error;

pub struct SourceMap {
    // TODO(port): []const u8 struct field in CSS (arena crate) — using raw slice ptr per PORTING.md; revisit ownership in Phase B
    pub project_root: *const [u8],
    pub inner: SourceMapInner,
}

pub struct SourceMapInner {
    // PERF(port): ArrayListUnmanaged in CSS arena crate — using Vec<T>; may need bumpalo::collections::Vec<'bump, T> in Phase B
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/sourcemap.zig (29 lines)
//   confidence: medium
//   todos:      1
//   notes:      pure data structs; []const u8 fields mapped to *const [u8] (CSS arena), ArrayList→Vec (may need bumpalo)
// ──────────────────────────────────────────────────────────────────────────
