// Generates src/jsc/bindings/stringWidthTables.h: the fused 3-stage
// codepoint classification table used by stringWidth.cpp.
//
// Each codepoint maps to one packed byte:
//   bits 0-4  grapheme break class (GraphemeBreakClass ordinal, see stringWidth.cpp)
//   bits 5-6  width class: 0 = zero-width, 1 = narrow, 2 = wide, 3 = East Asian Ambiguous
//   bit  7    Emoji property (with the isEmojiPresentation() early-outs baked in)
//
// The width and emoji bits are derived from the Unicode Character Database
// at UNICODE_VERSION (EastAsianWidth.txt, DerivedGeneralCategory.txt,
// emoji-data.txt) plus the zero-width rules in isZeroWidth(). The grapheme
// break class bits are carried over from the previous header (originally
// uucode-derived), so this script needs an existing stringWidthTables.h to
// bootstrap from.
//
// Usage: bun scripts/generate-stringwidth-tables.mjs [--ucd <dir>]
//        Rewrites src/jsc/bindings/stringWidthTables.h in place. Downloads
//        the UCD files from unicode.org unless --ucd points at a directory
//        holding EastAsianWidth.txt, DerivedGeneralCategory.txt and
//        emoji-data.txt for UNICODE_VERSION.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_VERSION = "17.0.0";
const UCD_BASE = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;

const headerPath = join(dirname(fileURLToPath(import.meta.url)), "../src/jsc/bindings/stringWidthTables.h");
const header = readFileSync(headerPath, "utf8");

// ---------------------------------------------------------------------------
// Load Unicode data
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const ucdDirIndex = args.indexOf("--ucd");
if (ucdDirIndex !== -1 && !args[ucdDirIndex + 1]) throw new Error("--ucd needs a directory argument");
const ucdDir = ucdDirIndex !== -1 ? args[ucdDirIndex + 1] : null;

async function loadUCD(remotePath) {
  const name = remotePath.split("/").pop();
  if (ucdDir) return readFileSync(join(ucdDir, name), "utf8");
  const url = `${UCD_BASE}/${remotePath}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return await response.text();
}

const eastAsianWidthText = await loadUCD("EastAsianWidth.txt");
const generalCategoryText = await loadUCD("extracted/DerivedGeneralCategory.txt");
const emojiDataText = await loadUCD("emoji/emoji-data.txt");

// Parse `LO(..HI) ; VALUE # comment` lines whose VALUE is accepted by `wanted`.
function parseUCDRanges(text, wanted) {
  const ranges = [];
  for (const m of text.matchAll(/^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(\w+)\s*#/gm)) {
    if (!wanted(m[3])) continue;
    ranges.push([parseInt(m[1], 16), m[2] === undefined ? parseInt(m[1], 16) : parseInt(m[2], 16)]);
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [lo, hi] of ranges) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

// East Asian Width `W` (wide) + `F` (fullwidth), and `A` (ambiguous).
const wideRanges = parseUCDRanges(eastAsianWidthText, type => type === "W" || type === "F");
const ambiguousRanges = parseUCDRanges(eastAsianWidthText, type => type === "A");
// General_Category Mn (nonspacing mark) + Me (enclosing mark).
const nonspacingMarkRanges = parseUCDRanges(generalCategoryText, gc => gc === "Mn" || gc === "Me");
// The `Emoji` binary property (not Emoji_Presentation / Emoji_Modifier / ...).
const emojiRanges = parseUCDRanges(emojiDataText, property => property === "Emoji");

// ---------------------------------------------------------------------------
// Carry the grapheme break classes over from the existing table
// ---------------------------------------------------------------------------

function parseArray(name) {
  const m = header.match(new RegExp(`${name}\\[[0-9]*\\] = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`could not find ${name} in stringWidthTables.h (needed to bootstrap the grapheme classes)`);
  return m[1]
    .split(/[,\s]+/)
    .filter(tok => /^\d+$/.test(tok))
    .map(Number);
}

const stage1 = parseArray("kGraphemeBreakStage1");
const stage2 = parseArray("kGraphemeBreakStage2");
const stage3 = parseArray("kGraphemeBreakStage3");

// Existing stage3 holds fused bytes; the grapheme class is always the low 5 bits.
const classOf = cp => {
  const high = cp >> 8;
  const low = cp & 0xff;
  return stage3[stage2[stage1[high] + low]] & 0x1f;
};

const inRanges = (cp, ranges) => {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][0] <= cp) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && cp <= ranges[lo - 1][1];
};

// Guard against a UCD format change silently emptying a table.
if (!inRanges(0x4e00, wideRanges) || !inRanges(0x300, nonspacingMarkRanges) || !inRanges(0x1f600, emojiRanges))
  throw new Error("UCD parse sanity check failed");

// ---------------------------------------------------------------------------
// Width classification
// ---------------------------------------------------------------------------

// Zero-width: controls, every nonspacing/enclosing mark (Mn/Me), conjoining
// Hangul jungseong/jongseong, and the invisible format characters glibc
// wcwidth() and string-width treat as zero-width. Deliberate deviations:
// prepended concatenation marks (U+0600..) are zero-width, and the Indic
// block heuristic below also zero-widths spacing vowel signs (Mc) so a
// consonant+vowel-sign syllable stays one column.
function isZeroWidth(cp) {
  if (cp <= 0x1f) return true;
  if (cp >= 0x7f && cp <= 0x9f) return true;
  if (cp === 0xad) return true;
  if (inRanges(cp, nonspacingMarkRanges)) return true;
  // Hangul jungseong (V) and jongseong (T): an L+V(+T) conjoining cluster is
  // 2 columns wide, all carried by the leading consonant.
  if (cp >= 0x1160 && cp <= 0x11ff) return true;
  if (cp >= 0xd7b0 && cp <= 0xd7ff) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  // The bidi embedding/override controls (LRE..RLO) and the rest of the
  // U+2060-U+206F block (word joiner, invisible operators, the LRI..PDI bidi
  // isolates, deprecated format characters): invisible format characters,
  // exactly like U+200B-U+200F above.
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2060 && cp <= 0x206f) return true;
  // U+061C ARABIC LETTER MARK, the remaining bidi control character.
  if (cp === 0x61c) return true;
  // The remaining default-ignorable format characters (Cf): the shorthand and
  // musical notation controls. glibc wcwidth() and string-width return 0.
  if (cp >= 0x1bca0 && cp <= 0x1bca3) return true;
  if (cp >= 0x1d173 && cp <= 0x1d17a) return true;
  // Mongolian free variation selectors and vowel separator.
  if (cp >= 0x180b && cp <= 0x180f) return true;
  // Blocks reserved wholly for combining marks: their unassigned tails stay
  // zero-width too.
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true;
  if (cp >= 0x20d0 && cp <= 0x20ff) return true;
  if (cp === 0xfeff) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true;
  if ((cp >= 0x600 && cp <= 0x605) || cp === 0x6dd || cp === 0x70f || cp === 0x8e2) return true;
  // Indic vowel-sign heuristic (covers the spacing Mc vowel signs, not just
  // the Mn ones): a consonant plus vowel sign renders as one column.
  if (cp >= 0x900 && cp <= 0xd4f) {
    const offset = cp & 0x7f;
    if (offset <= 0x02) return true;
    if (offset >= 0x3a && offset <= 0x4d && offset !== 0x3d) return true;
    if (offset >= 0x51 && offset <= 0x57) return true;
    if (offset >= 0x62 && offset <= 0x63) return true;
  }
  // Tag characters.
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return false;
}

// 0 = zero-width, 1 = narrow, 2 = wide, 3 = ambiguous
function widthClass(cp) {
  if (isZeroWidth(cp)) return 0;
  if (inRanges(cp, wideRanges)) return 2;
  if (inRanges(cp, ambiguousRanges)) return 3;
  return 1;
}

// Emoji property with the isEmojiPresentation() early-outs baked in.
function isEmoji(cp) {
  if (cp < 0x203c) return false;
  if (cp >= 0x2c00 && cp < 0x1f000) return false;
  if (cp === 0xfe0e || cp === 0xfe0f || cp === 0x200d) return false;
  return inRanges(cp, emojiRanges);
}

const packed = cp => classOf(cp) | (widthClass(cp) << 5) | (isEmoji(cp) ? 0x80 : 0);

// ---------------------------------------------------------------------------
// Rebuild the 3-stage table over the packed values
// ---------------------------------------------------------------------------

const highCount = stage1.length; // 8192 blocks of 256 codepoints
const blockKeyToOffset = new Map();
const newStage1 = new Array(highCount);
const newStage2 = [];
const valueToIndex = new Map();
const newStage3 = [];

for (let high = 0; high < highCount; high++) {
  const block = new Array(256);
  for (let low = 0; low < 256; low++) {
    const value = packed(high * 256 + low);
    let index = valueToIndex.get(value);
    if (index === undefined) {
      index = newStage3.length;
      if (index > 255) throw new Error("more than 256 distinct packed values");
      valueToIndex.set(value, index);
      newStage3.push(value);
    }
    block[low] = index;
  }
  const key = block.join(",");
  let offset = blockKeyToOffset.get(key);
  if (offset === undefined) {
    offset = newStage2.length;
    blockKeyToOffset.set(key, offset);
    newStage2.push(...block);
  }
  newStage1[high] = offset;
}

if (newStage2.length - 256 > 0xffff) throw new Error("stage1 offsets no longer fit in uint16_t");

// Verify the rebuilt table roundtrips for every codepoint and preserves the
// original grapheme classes exactly.
for (let cp = 0; cp <= 0x10ffff; cp++) {
  const got = newStage3[newStage2[newStage1[cp >> 8] + (cp & 0xff)]];
  if (got !== packed(cp)) throw new Error(`roundtrip mismatch at U+${cp.toString(16)}`);
  if ((got & 0x1f) !== classOf(cp)) throw new Error(`class mismatch at U+${cp.toString(16)}`);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function formatArray(values, perLine) {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push("    " + values.slice(i, i + perLine).join(", ") + ",");
  }
  return lines.join("\n");
}

const output = `// clang-format off
// Generated by scripts/generate-stringwidth-tables.mjs from the Unicode
// ${UNICODE_VERSION} Character Database. Do not edit manually; regenerate with
//   bun scripts/generate-stringwidth-tables.mjs
//
// 3-stage lookup of the packed per-codepoint classification used by
// stringWidth.cpp: stage1[cp >> 8] + (cp & 0xFF) indexes stage2, which
// indexes stage3. Each stage3 byte packs:
//   bits 0-4  GraphemeBreakClass ordinal (grapheme break property + Indic
//             Conjunct Break, uucode-derived)
//   bits 5-6  width class: 0 zero-width, 1 narrow, 2 wide (East Asian Width
//             W/F), 3 East Asian Ambiguous
//   bit  7    the Unicode Emoji property, with the isEmojiPresentation()
//             early-outs (< U+203C, [U+2C00, U+1F000), VS15/VS16/ZWJ) baked in
// Zero-width: C0/C1 controls, soft hyphen, every Mn/Me mark, conjoining Hangul
// jungseong/jongseong (U+1160-U+11FF, U+D7B0-U+D7FF), invisible format
// characters (bidi controls, ZWSP/ZWJ/ZWNJ, U+2060-206F, tags, BOM),
// surrogates and the Indic vowel-sign heuristic; see isZeroWidth() in the
// generator.
#pragma once

#include <cstdint>

namespace Bun {
namespace StringWidthTables {

static constexpr uint16_t kGraphemeBreakStage1[${newStage1.length}] = {
${formatArray(newStage1, 24)}
};

static constexpr uint8_t kGraphemeBreakStage2[${newStage2.length}] = {
${formatArray(newStage2, 32)}
};

static constexpr uint8_t kGraphemeBreakStage3[${newStage3.length}] = {
${formatArray(newStage3, 24)}
};

} // namespace StringWidthTables
} // namespace Bun
`;

writeFileSync(headerPath, output);

console.log(
  `Unicode ${UNICODE_VERSION}: stage1: ${newStage1.length} entries, stage2: ${newStage2.length} entries, ` +
    `stage3: ${newStage3.length} distinct packed values`,
);
