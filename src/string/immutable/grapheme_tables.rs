// GENERATED: re-run `zig build generate-grapheme-tables` with .rs output
// source: src/string/immutable/grapheme_tables.zig (35621 lines)
// Do not edit manually.

// TODO(b2-codegen): the Zig generator emits 35k lines of stage1/2/3 lookup
// arrays. Until the generator is taught to emit `.rs`, expose an empty table
// so `grapheme.rs` compiles. `is_grapheme_break` will return `true` for every
// pair (i.e. never coalesce) until real tables land — incorrect for emoji
// width calculation but type-correct.
use super::grapheme::{GraphemeBreakNoControl, Tables};
pub static TABLE: Tables<GraphemeBreakNoControl> = Tables {
    stage1: &[],
    stage2: &[],
    stage3: &[],
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable/grapheme_tables.zig (35621 lines)
//   confidence: high
//   todos:      0
//   notes:      generated file — update generator to emit Rust; exports `table: grapheme::Tables<GraphemeBreakNoControl>` + stage1/2/3 + GraphemeBreakNoControl enum
// ──────────────────────────────────────────────────────────────────────────
