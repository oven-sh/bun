// Generates src/jsc/bindings/stringWidthTables.h: the fused 3-stage
// codepoint classification table used by stringWidth.cpp.
//
// Each codepoint maps to one packed byte:
//   bits 0-4  grapheme break class (GraphemeBreakClass ordinal, see stringWidth.cpp)
//   bits 5-6  width class: 0 = zero-width, 1 = narrow, 2 = wide, 3 = East Asian Ambiguous
//   bit  7    Emoji property, minus the keycap bases [0-9#*]
//
// Every field is derived from the Unicode Character Database at
// UNICODE_VERSION:
//   EastAsianWidth.txt                     width class
//   extracted/DerivedGeneralCategory.txt   zero-width categories
//   DerivedCoreProperties.txt              Default_Ignorable_Code_Point, InCB
//   auxiliary/GraphemeBreakProperty.txt    Grapheme_Cluster_Break
//   emoji/emoji-data.txt                   Emoji, Emoji_Modifier(_Base),
//                                          Extended_Pictographic
//
// Usage: bun scripts/generate-stringwidth-tables.mjs [--ucd <dir>]
//        Rewrites src/jsc/bindings/stringWidthTables.h in place. Downloads
//        the UCD files from unicode.org unless --ucd points at a directory
//        holding the five files above (by base name) for UNICODE_VERSION.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_VERSION = "17.0.0";
const UCD_BASE = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;

const headerPath = join(dirname(fileURLToPath(import.meta.url)), "../src/jsc/bindings/stringWidthTables.h");

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
const corePropertiesText = await loadUCD("DerivedCoreProperties.txt");
const graphemeBreakText = await loadUCD("auxiliary/GraphemeBreakProperty.txt");
const emojiDataText = await loadUCD("emoji/emoji-data.txt");

// Parse `LO(..HI) ; VALUE [; VALUE2] # comment` lines. `wanted` receives the
// property value ("Mn", "W", "Extended_Pictographic") or, for two-field lines
// such as `InCB; Linker`, "InCB=Linker".
function parseUCDRanges(text, wanted) {
  const ranges = [];
  for (const m of text.matchAll(/^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(\w+)\s*(?:;\s*(\w+)\s*)?#/gm)) {
    const value = m[4] === undefined ? m[3] : `${m[3]}=${m[4]}`;
    if (!wanted(value)) continue;
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

const wideRanges = parseUCDRanges(eastAsianWidthText, type => type === "W" || type === "F");
const ambiguousRanges = parseUCDRanges(eastAsianWidthText, type => type === "A");

const categoryRanges = name => parseUCDRanges(generalCategoryText, gc => gc === name);
const controlRanges = categoryRanges("Cc");
const formatRanges = categoryRanges("Cf");
const surrogateRanges = categoryRanges("Cs");
const unassignedRanges = categoryRanges("Cn");
const nonspacingMarkRanges = parseUCDRanges(generalCategoryText, gc => gc === "Mn" || gc === "Me");
const spacingMarkRanges = categoryRanges("Mc");

const defaultIgnorableRanges = parseUCDRanges(corePropertiesText, p => p === "Default_Ignorable_Code_Point");
const incbLinkerRanges = parseUCDRanges(corePropertiesText, p => p === "InCB=Linker");
const incbConsonantRanges = parseUCDRanges(corePropertiesText, p => p === "InCB=Consonant");

const graphemeRanges = name => parseUCDRanges(graphemeBreakText, p => p === name);
const gcb = {
  Control: graphemeRanges("Control"),
  Extend: graphemeRanges("Extend"),
  Prepend: graphemeRanges("Prepend"),
  RegionalIndicator: graphemeRanges("Regional_Indicator"),
  SpacingMark: graphemeRanges("SpacingMark"),
  L: graphemeRanges("L"),
  V: graphemeRanges("V"),
  T: graphemeRanges("T"),
  LV: graphemeRanges("LV"),
  LVT: graphemeRanges("LVT"),
  ZWJ: graphemeRanges("ZWJ"),
};

const emojiProperty = name => parseUCDRanges(emojiDataText, p => p === name);
const emojiRanges = emojiProperty("Emoji");
const emojiModifierRanges = emojiProperty("Emoji_Modifier");
const emojiModifierBaseRanges = emojiProperty("Emoji_Modifier_Base");
const extendedPictographicRanges = emojiProperty("Extended_Pictographic");

// Guard against a UCD format change silently emptying a table.
if (
  !inRanges(0x4e00, wideRanges) ||
  !inRanges(0x300, nonspacingMarkRanges) ||
  !inRanges(0x1f600, emojiRanges) ||
  !inRanges(0x94d, incbLinkerRanges) ||
  !inRanges(0x1f1e6, gcb.RegionalIndicator) ||
  !inRanges(0xe0080, defaultIgnorableRanges)
)
  throw new Error("UCD parse sanity check failed");

// ---------------------------------------------------------------------------
// Grapheme break class (GraphemeBreakClass ordinals in stringWidth.cpp)
// ---------------------------------------------------------------------------

const GraphemeBreakClass = {
  Other: 0,
  Prepend: 1,
  RegionalIndicator: 2,
  SpacingMark: 3,
  L: 4,
  V: 5,
  T: 6,
  Lv: 7,
  Lvt: 8,
  Zwj: 9,
  Zwnj: 10,
  ExtendedPictographic: 11,
  EmojiModifierBase: 12,
  EmojiModifier: 13,
  IndicConjunctBreakExtend: 14,
  IndicConjunctBreakLinker: 15,
  IndicConjunctBreakConsonant: 16,
  Control: 17,
};

// Grapheme_Cluster_Break, refined with the emoji and Indic Conjunct Break
// properties the break rules GB9c and GB11 need. CR and LF are Control here:
// the width code never needs CR LF kept as one cluster.
function graphemeBreakClass(cp) {
  if (inRanges(cp, gcb.Control) || cp === 0x0d || cp === 0x0a) return GraphemeBreakClass.Control;
  if (inRanges(cp, incbLinkerRanges)) return GraphemeBreakClass.IndicConjunctBreakLinker;
  if (inRanges(cp, emojiModifierRanges)) return GraphemeBreakClass.EmojiModifier;
  if (cp === 0x200c) return GraphemeBreakClass.Zwnj;
  if (inRanges(cp, gcb.Extend)) return GraphemeBreakClass.IndicConjunctBreakExtend;
  if (inRanges(cp, gcb.ZWJ)) return GraphemeBreakClass.Zwj;
  if (inRanges(cp, gcb.Prepend)) return GraphemeBreakClass.Prepend;
  if (inRanges(cp, gcb.RegionalIndicator)) return GraphemeBreakClass.RegionalIndicator;
  if (inRanges(cp, gcb.SpacingMark)) return GraphemeBreakClass.SpacingMark;
  if (inRanges(cp, gcb.L)) return GraphemeBreakClass.L;
  if (inRanges(cp, gcb.V)) return GraphemeBreakClass.V;
  if (inRanges(cp, gcb.T)) return GraphemeBreakClass.T;
  if (inRanges(cp, gcb.LV)) return GraphemeBreakClass.Lv;
  if (inRanges(cp, gcb.LVT)) return GraphemeBreakClass.Lvt;
  if (inRanges(cp, emojiModifierBaseRanges)) return GraphemeBreakClass.EmojiModifierBase;
  if (inRanges(cp, extendedPictographicRanges)) return GraphemeBreakClass.ExtendedPictographic;
  if (inRanges(cp, incbConsonantRanges)) return GraphemeBreakClass.IndicConjunctBreakConsonant;
  return GraphemeBreakClass.Other;
}

// ---------------------------------------------------------------------------
// Width classification
// ---------------------------------------------------------------------------

// Zero-width: controls (Cc), format characters (Cf: soft hyphen, bidi
// controls, ZWSP/ZWJ/ZWNJ, tags, BOM, ...), nonspacing and enclosing marks
// (Mn/Me), surrogates, unassigned default-ignorable codepoints (reserved for
// future format characters), and the conjoining Hangul jungseong/jongseong
// (Grapheme_Cluster_Break V/T in the Hangul Jamo blocks; the Kirat Rai vowel
// signs are V too but are visible letters): an L+V(+T) cluster is 2 columns
// wide, all carried by the leading consonant. Deliberate deviation: the
// spacing vowel signs (Mc) of the Indic blocks U+0900-U+0DFF are zero-width
// too, so a consonant+vowel-sign syllable stays one column.
function isZeroWidth(cp) {
  if (inRanges(cp, controlRanges)) return true;
  if (inRanges(cp, formatRanges)) return true;
  if (inRanges(cp, nonspacingMarkRanges)) return true;
  if (inRanges(cp, surrogateRanges)) return true;
  if (inRanges(cp, unassignedRanges) && inRanges(cp, defaultIgnorableRanges)) return true;
  if (cp <= 0xd7ff && (inRanges(cp, gcb.V) || inRanges(cp, gcb.T))) return true;
  if (cp >= 0x900 && cp <= 0xdff && inRanges(cp, spacingMarkRanges)) return true;
  return false;
}

// 0 = zero-width, 1 = narrow, 2 = wide, 3 = ambiguous
function widthClass(cp) {
  if (isZeroWidth(cp)) return 0;
  if (inRanges(cp, wideRanges)) return 2;
  if (inRanges(cp, ambiguousRanges)) return 3;
  return 1;
}

// The Emoji property, minus the keycap bases: a digit, '#' or '*' is only
// emoji as part of a keycap sequence, which the width code detects through
// U+20E3 itself.
function isEmoji(cp) {
  if ((cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a) return false;
  return inRanges(cp, emojiRanges);
}

const packed = cp => graphemeBreakClass(cp) | (widthClass(cp) << 5) | (isEmoji(cp) ? 0x80 : 0);

// ---------------------------------------------------------------------------
// Build the 3-stage table over the packed values
// ---------------------------------------------------------------------------

const highCount = 0x1100; // blocks of 256 codepoints up to U+10FFFF
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

// Verify the built table roundtrips for every codepoint.
for (let cp = 0; cp <= 0x10ffff; cp++) {
  const got = newStage3[newStage2[newStage1[cp >> 8] + (cp & 0xff)]];
  if (got !== packed(cp)) throw new Error(`roundtrip mismatch at U+${cp.toString(16)}`);
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
//   bits 0-4  GraphemeBreakClass ordinal: Grapheme_Cluster_Break refined
//             with Indic_Conjunct_Break, Emoji_Modifier(_Base) and
//             Extended_Pictographic
//   bits 5-6  width class: 0 zero-width, 1 narrow, 2 wide (East Asian Width
//             W/F), 3 East Asian Ambiguous
//   bit  7    the Unicode Emoji property, minus the keycap bases [0-9#*]
// Zero-width: Cc, Cf, Mn, Me, surrogates, unassigned default-ignorable
// codepoints, conjoining Hangul jungseong/jongseong, and the spacing vowel
// signs (Mc) of the Indic blocks U+0900-U+0DFF; see isZeroWidth() in the
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
