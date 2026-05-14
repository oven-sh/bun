# uucode Integration for Grapheme Breaking

## What This Is

This directory contains Bun's integration with the [uucode](https://github.com/jacobsandlund/uucode) Unicode library (vendored at `src/unicode/uucode_lib/`). It generates the lookup tables that power Bun's grapheme cluster breaking — including GB9c (Indic Conjunct Break) support.

The runtime code lives in `src/bun_core/string/immutable/grapheme.rs`. This directory only contains **build-time** code for regenerating tables.

## Architecture

```
src/unicode/uucode_lib/    ← Vendored uucode library (MIT, don't modify)
src/unicode/uucode/        ← THIS DIRECTORY: build-time integration
  ├── uucode_config.rs     ← Configures which uucode fields to generate
  ├── grapheme_gen.rs      ← Generator binary: queries uucode → writes tables
  ├── lut.rs               ← 3-level lookup table generator
  └── CLAUDE.md            ← You are here

src/bun_core/string/immutable/  ← Runtime code (no uucode dependency)
  ├── grapheme.rs          ← Grapheme break API + precomputed decision table
  ├── grapheme_tables.rs   ← PRE-GENERATED property tables (committed)
  └── visible.rs           ← String width calculation (uses grapheme.rs)
```

## How It Works

### Runtime (zero uucode dependency)

`grapheme.rs` does two table lookups per codepoint pair, with no branching:

1. **Property lookup**: `grapheme_tables.rs` maps codepoint → `Properties` (width, grapheme_break enum, emoji_vs_base) via a 3-level lookup table (~100KB)
2. **Break decision**: A precomputed 8KB array maps `(BreakState, gb1, gb2)` → `(break_result, new_state)` covering all 5×17×17 = 1445 permutations

The break algorithm (including GB9c Indic, GB11 Emoji ZWJ, GB12/13 Regional Indicators) runs only at **build time** to populate this array. At runtime it's a single array index.

### Key Types

- `GraphemeBreakNoControl` — a `#[repr(u8)]` enum with 17 values (the "no control" variant strips CR/LF/Control since Bun handles those externally)
- `BreakState` — an enum with 5 states: `default`, `regional_indicator`, `extended_pictographic`, `indic_conjunct_break_consonant`, `indic_conjunct_break_linker`
- `Properties` — bitpacked struct with `width: u2`, `grapheme_break: GraphemeBreakNoControl`, `emoji_vs_base: bool`

### Table Generation (build-time only)

`grapheme_gen.rs` is compiled as a standalone binary that:

1. Initializes uucode (which parses the UCD data in `src/unicode/uucode_lib/ucd/`)
2. Iterates all 2^21 codepoints
3. Queries `uucode.get(.width, cp)`, `.grapheme_break_no_control`, `.is_emoji_vs_base`
4. Feeds them through `lut.rs`'s 3-level table generator
5. Writes the generated tables source to stdout

## How to Regenerate Tables

Run the table generator when updating the vendored uucode (e.g., for a new Unicode version). The generated file is committed at `src/bun_core/string/immutable/grapheme_tables.rs`.

**Normal builds never run the generator** — they just compile the committed `grapheme_tables.rs`.

## How to Update Unicode Version

Use the update script:

```bash
# From a local directory:
./scripts/update-uucode.sh /path/to/uucode-0.2.0-xxxxx/

# From a URL:
./scripts/update-uucode.sh https://deps.files.ghostty.org/uucode-xxxxx.tar.gz

# Default:
./scripts/update-uucode.sh
```

The script handles everything: copies the source, regenerates tables, and prints next steps.

Manual steps if needed:

1. Update `src/unicode/uucode_lib/` with the new uucode release (which includes new UCD data)
2. Run the table generator
3. Verify: `bun bd test test/js/bun/util/stringWidth.test.ts`
4. Commit the updated `src/unicode/uucode_lib/` and `src/bun_core/string/immutable/grapheme_tables.rs`

## Relationship to Ghostty

This implementation mirrors [Ghostty's approach](https://github.com/ghostty-org/ghostty/tree/main/src/unicode) (same author as uucode). Key correspondences:

| Ghostty                        | Bun                                                |
| ------------------------------ | -------------------------------------------------- |
| `src/unicode/grapheme.zig`     | `src/bun_core/string/immutable/grapheme.rs`        |
| `src/unicode/lut.zig`          | `src/unicode/uucode/lut.rs`                        |
| `src/unicode/props_uucode.zig` | `src/unicode/uucode/grapheme_gen.rs`               |
| `src/unicode/props_table.zig`  | `src/bun_core/string/immutable/grapheme_tables.rs` |
| `src/build/uucode_config.zig`  | `src/unicode/uucode/uucode_config.rs`              |

Differences: Ghostty generates tables every build; Bun pre-generates and commits them. Bun's `grapheme.rs` is fully self-contained with no runtime uucode import.

## What `uucode_config.rs` Controls

This tells uucode which properties to compute into its tables:

- `width` — derived from `wcwidth_standalone` and `wcwidth_zero_in_grapheme`
- `grapheme_break_no_control` — the 17-value enum for grapheme break rules
- `is_emoji_vs_base` — whether VS16 (U+FE0F) makes a codepoint width-2

## Adding New Properties

If you need additional Unicode properties (e.g., for a new width calculation):

1. Add the field to `uucode_config.rs`'s `tables` array
2. Add the field to `Properties` in both `grapheme_gen.rs` and `grapheme.rs`
3. Update the output format in `grapheme_gen.rs`'s `main()`
4. Regenerate the tables
