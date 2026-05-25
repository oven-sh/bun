// Regenerates the fused 3-stage codepoint classification table in
// src/jsc/bindings/stringWidthTables.h.
//
// Each codepoint maps to one packed byte:
//   bits 0-4  grapheme break class (GraphemeBreakClass ordinal, see stringWidth.cpp)
//   bits 5-6  width class: 0 = zero-width, 1 = narrow, 2 = wide, 3 = East Asian Ambiguous
//   bit  7    Emoji property (with the isEmojiPresentation() early-outs baked in)
//
// The width/emoji bits are derived from the range tables earlier in the header
// (kEastAsianWideRanges, kEastAsianAmbiguousRanges, kEmojiPresentationRanges)
// plus the zero-width rules mirrored from the previous hand-written
// isZeroWidthCodepoint(); the grapheme class bits are carried over from the
// existing table (originally uucode-derived, see the header comment).
//
// Usage: bun scripts/generate-stringwidth-tables.mjs
//        (rewrites src/jsc/bindings/stringWidthTables.h in place)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const headerPath = join(dirname(fileURLToPath(import.meta.url)), "../src/jsc/bindings/stringWidthTables.h");
const header = readFileSync(headerPath, "utf8");

// ---------------------------------------------------------------------------
// Parse the existing tables
// ---------------------------------------------------------------------------

function parseArray(name) {
  const m = header.match(new RegExp(`${name}\\[[0-9]*\\] = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`could not find ${name}`);
  return m[1]
    .split(/[,\s]+/)
    .filter(tok => /^\d+$/.test(tok))
    .map(Number);
}

function parseRanges(name) {
  const m = header.match(new RegExp(`${name}\\[\\] = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`could not find ${name}`);
  const ranges = [];
  for (const rm of m[1].matchAll(/\{\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*\}/g)) {
    ranges.push([parseInt(rm[1], 16), parseInt(rm[2], 16)]);
  }
  return ranges;
}

const stage1 = parseArray("kGraphemeBreakStage1");
const stage2 = parseArray("kGraphemeBreakStage2");
const stage3 = parseArray("kGraphemeBreakStage3");
const wideRanges = parseRanges("kEastAsianWideRanges");
const ambiguousRanges = parseRanges("kEastAsianAmbiguousRanges");
const emojiRanges = parseRanges("kEmojiPresentationRanges");

// Existing stage3 may already hold fused bytes (re-run of this script); the
// grapheme class is always the low 5 bits.
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

// Zero-width rules, mirrored from the previous isZeroWidthCodepoint() in
// stringWidth.cpp (C0/C1 controls, soft hyphen, combining marks, invisible
// formatting characters, surrogates, tags, variation selectors, and the
// Indic/Thai/Lao combining sign heuristics).
function isZeroWidth(cp) {
  if (cp <= 0x1f) return true;
  if (cp >= 0x7f && cp <= 0x9f) return true;
  if (cp === 0xad) return true;
  if (cp >= 0x300 && cp <= 0x36f) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  if (cp >= 0x2060 && cp <= 0x2064) return true;
  if (cp >= 0x20d0 && cp <= 0x20ff) return true;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  if (cp >= 0xfe20 && cp <= 0xfe2f) return true;
  if (cp === 0xfeff) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true;
  if ((cp >= 0x600 && cp <= 0x605) || cp === 0x6dd || cp === 0x70f || cp === 0x8e2) return true;
  if (cp >= 0x900 && cp <= 0xd4f) {
    const offset = cp & 0x7f;
    if (offset <= 0x02) return true;
    if (offset >= 0x3a && offset <= 0x4d && offset !== 0x3d) return true;
    if (offset >= 0x51 && offset <= 0x57) return true;
    if (offset >= 0x62 && offset <= 0x63) return true;
  }
  if (cp === 0xe31 || (cp >= 0xe34 && cp <= 0xe3a) || (cp >= 0xe47 && cp <= 0xe4e)) return true;
  if (cp === 0xeb1 || (cp >= 0xeb4 && cp <= 0xebc) || (cp >= 0xec8 && cp <= 0xecd)) return true;
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true;
  if (cp >= 0x1dc0 && cp <= 0x1dff) return true;
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
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

const banner = `// 3-stage lookup of the packed per-codepoint classification:
//   stage1[cp >> 8] + (cp & 0xFF) indexes stage2, which indexes stage3.
// Each stage3 byte packs: grapheme break class (bits 0-4, GraphemeBreakClass
// ordinal), width class (bits 5-6: 0 zero-width, 1 narrow, 2 wide,
// 3 East Asian Ambiguous) and the Emoji property (bit 7, with the
// isEmojiPresentation() early-outs baked in). Regenerate with:
//   bun scripts/generate-stringwidth-tables.mjs
static constexpr uint16_t kGraphemeBreakStage1[${newStage1.length}] = {
${formatArray(newStage1, 24)}
};

static constexpr uint8_t kGraphemeBreakStage2[${newStage2.length}] = {
${formatArray(newStage2, 32)}
};

static constexpr uint8_t kGraphemeBreakStage3[${newStage3.length}] = {
${formatArray(newStage3, 24)}
};`;

// Replace everything from the old stage-table banner comment through the end
// of the stage3 array.
const startMarker = header.search(/\/\/ 3-stage lookup[\s\S]*?kGraphemeBreakStage1\[/);
if (startMarker === -1) throw new Error("could not find the stage table section");
const endMatch = header.match(/kGraphemeBreakStage3\[[0-9]*\] = \{[\s\S]*?\n\};/);
if (!endMatch) throw new Error("could not find the end of stage3");
const endIndex = header.indexOf(endMatch[0]) + endMatch[0].length;

const updated = header.slice(0, startMarker) + banner + header.slice(endIndex);
writeFileSync(headerPath, updated);

console.log(
  `stage1: ${newStage1.length} entries, stage2: ${newStage2.length} entries, ` +
    `stage3: ${newStage3.length} distinct packed values`,
);
