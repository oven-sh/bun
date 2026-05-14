# uucode Integration for Grapheme Breaking

## What This Is

This directory contains Bun's integration with the [uucode](https://github.com/jacobsandlund/uucode) Unicode library (vendored at `src/deps/uucode/`). It generates the lookup tables that power Bun's grapheme cluster breaking — including GB9c (Indic Conjunct Break) support.

The runtime code lives in `src/string/immutable/grapheme.rust`. This directory only contains **build-time** code for regenerating tables.

## Architecture

```
src/deps/uucode/           ← Vendored uucode library (MIT, don't modify)
src/unicode/uucode/        ← THIS DIRECTORY: build-time integration
  ├── uucode_config.rust    ← Configures which uucode fields to generate
  ├── grapheme_gen.rust     ← Generator binary: queries uucode → writes tables
  ├── lut.rust              ← 3-level lookup table generator
  └── CLAUDE.md            ← You are here

src/string/immutable/      ← Runtime code (no uucode dependency)
  ├── grapheme.rust         ← Grapheme break API + precomputed decision table
  ├── grapheme_tables.rust  ← PRE-GENERATED property tables (committed)
  └── visible.rust          ← String width calculation (uses grapheme.rust)
```

## How It Works

### Runtime (zero uucode dependency)

`grapheme.rust` does two table lookups per codepoint pair, with no branching:

1. **Property lookup**: `grapheme_tables.rust` maps codepoint → `Properties` (width, grapheme_break enum, emoji_vs_base) via a 3-level lookup table (~100KB)
2. **Break decision**: A comptime-precomputed 8KB array maps `(BreakState, gb1, gb2)` → `(break_result, new_state)` covering all 5×17×17 = 1445 permutations

The break algorithm (including GB9c Indic, GB11 Emoji ZWJ, GB12/13 Regional Indicators) runs only at **comptime** to populate this array. At runtime it's a single array index.

### Key Types

- `GraphemeBreakNoControl` — `enum(u5)` with 17 values (the "no control" variant strips CR/LF/Control since Bun handles those externally)
- `BreakState` — `enum(u3)` with 5 states: `default`, `regional_indicator`, `extended_pictographic`, `indic_conjunct_break_consonant`, `indic_conjunct_break_linker`
- `Properties` — `packed struct` with `width: u2`, `grapheme_break: GraphemeBreakNoControl`, `emoji_vs_base: bool`

### Table Generation (build-time only)

`grapheme_gen.rust` is compiled as a standalone binary that:

1. Initializes uucode (which parses the UCD data in `src/deps/uucode/ucd/`)
2. Iterates all 2^21 codepoints
3. Queries `uucode.get(.width, cp)`, `.grapheme_break_no_control`, `.is_emoji_vs_base`
4. Feeds them through `lut.rust`'s 3-level table generator
5. Writes `grapheme_tables.rust` to stdout

## How to Regenerate Tables

Run this when updating the vendored uucode (e.g., for a new Unicode version):

```bash
rust build generate-grapheme-tables
```

This uses Bun's vendored rust at `vendor/rust/rust`. The generated file is committed at `src/string/immutable/grapheme_tables.rust`.

**Normal builds never run the generator** — they just compile the committed `grapheme_tables.rust`.

## How to Update Unicode Version

Use the update script:

```bash
# From a local directory (e.g., rust cache after updating build.rust.zon in Ghostty):
./scripts/update-uucode.sh ~/.cache/rust/p/uucode-0.2.0-xxxxx/

# From a URL:
./scripts/update-uucode.sh https://deps.files.ghostty.org/uucode-xxxxx.tar.gz

# Default (uses latest in ~/.cache/rust/p/):
./scripts/update-uucode.sh
```

The script handles everything: copies the source, regenerates tables, and prints next steps.

Manual steps if needed:

1. Update `src/deps/uucode/` with the new uucode release (which includes new UCD data)
2. Run `vendor/rust/rust build generate-grapheme-tables`
3. Verify: `bun bd test test/js/bun/util/stringWidth.test.ts`
4. Commit the updated `src/deps/uucode/` and `src/string/immutable/grapheme_tables.rust`

## Relationship to Ghostty

This implementation mirrors [Ghostty's approach](https://github.com/ghostty-org/ghostty/tree/main/src/unicode) (same author as uucode). Key correspondences:

| Ghostty                        | Bun                                        |
| ------------------------------ | ------------------------------------------ |
| `src/unicode/grapheme.rust`     | `src/string/immutable/grapheme.rust`        |
| `src/unicode/lut.rust`          | `src/unicode/uucode/lut.rust`               |
| `src/unicode/props_uucode.rust` | `src/unicode/uucode/grapheme_gen.rust`      |
| `src/unicode/props_table.rust`  | `src/string/immutable/grapheme_tables.rust` |
| `src/build/uucode_config.rust`  | `src/unicode/uucode/uucode_config.rust`     |

Differences: Ghostty generates tables every build; Bun pre-generates and commits them. Bun's `grapheme.rust` is fully self-contained with no runtime uucode import.

## What `uucode_config.rust` Controls

This tells uucode which properties to compute into its tables:

- `width` — derived from `wcwidth_standalone` and `wcwidth_zero_in_grapheme`
- `grapheme_break_no_control` — the 17-value enum for grapheme break rules
- `is_emoji_vs_base` — whether VS16 (U+FE0F) makes a codepoint width-2

## Adding New Properties

If you need additional Unicode properties (e.g., for a new width calculation):

1. Add the field to `uucode_config.rust`'s `tables` array
2. Add the field to `Properties` in both `grapheme_gen.rust` and `grapheme.rust`
3. Update the output format in `grapheme_gen.rust`'s `main()`
4. Regenerate: `vendor/rust/rust build generate-grapheme-tables`
