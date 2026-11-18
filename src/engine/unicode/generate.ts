// Writes tables.rs and properties.bin from files of the Unicode Character Database.
//
//   bun generate.ts <characters> <properties>
//
// <characters> decides identifiers and case conversion, and has the version of the ICU that Bun links:
// UnicodeData.txt, SpecialCasing.txt, DerivedCoreProperties.txt.
// <properties> decides what `\p{..}` matches, and the folding that is applied to those sets: UnicodeData.txt,
// CaseFolding.txt, the files in `binaryFiles` and `sequenceFiles`, Scripts.txt, ScriptExtensions.txt,
// PropertyAliases.txt, PropertyValueAliases.txt.

import assert from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Range = [first: number, last: number];

const [charactersFolder, propertiesFolder] = process.argv.slice(2);
assert(charactersFolder && propertiesFolder, "usage: generate.ts <characters> <properties>");

const MAX = 0x10ffff;
const hex = (text: string) => parseInt(text, 16);
const hexList = (text: string) => text.split(" ").filter(Boolean).map(hex);
const upTo = (count: number) => Array.from({ length: count }, (_, index) => index);

function rows(folder: string, file: string): string[][] {
  return readFileSync(join(folder, file), "utf8")
    .split("\n")
    .map(line => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map(line => line.split(";").map(field => field.trim()));
}

function version(folder: string): string {
  return /-(\d+\.\d+\.\d+)\.txt/.exec(readFileSync(join(folder, "DerivedCoreProperties.txt"), "utf8"))![1];
}

function range(text: string): Range {
  const [first, last = first] = text.split("..");
  return [hex(first), hex(last)];
}

function normalize(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [first, last] of ranges.toSorted((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else merged.push([first, last]);
  }
  return merged;
}

function complement(ranges: Range[]): Range[] {
  const gaps: Range[] = [];
  let next = 0;
  for (const [first, last] of normalize(ranges)) {
    if (first > next) gaps.push([next, first - 1]);
    next = last + 1;
  }
  if (next <= MAX) gaps.push([next, MAX]);
  return gaps;
}

const subtract = (from: Range[], what: Range[]) => complement([...complement(from), ...what]);

function add<T>(map: Map<string, T[]>, key: string, value: T) {
  map.has(key) ? map.get(key)!.push(value) : map.set(key, [value]);
}

function rangesByValue(folder: string, file: string): Map<string, Range[]> {
  const result = new Map<string, Range[]>();
  for (const [codePoints, value] of rows(folder, file)) add(result, value, range(codePoints));
  return result;
}

/** The index of each item among the distinct ones, in the order they first appear. */
function deduplicate<T>(items: T[]): { distinct: T[]; indices: number[] } {
  const seen = new Map<string, number>();
  const distinct: T[] = [];
  const indices = items.map(item => {
    const key = String(item);
    if (!seen.has(key)) seen.set(key, distinct.push(item) - 1);
    return seen.get(key)!;
  });
  return { distinct, indices };
}

let source = "";

function wrap(items: string[]): string {
  const lines = [""];
  for (const item of items) {
    if (lines.at(-1)!.length + item.length > 114) lines.push("");
    lines[lines.length - 1] += `${item},`;
  }
  return lines.map(line => `    ${line}\n`).join("");
}

function emit(name: string, type: string, items: (string | number)[]) {
  const limit = { u8: 0xff, u16: 0xffff }[type];
  assert(limit === undefined || items.every(item => +item <= limit), `${name} does not fit ${type}`);
  source += `pub(crate) static ${name}: [${type}; ${items.length}] = [\n${wrap(items.map(String))}];\n`;
}

const list = (items: (string | number)[]) => `[${items.join(",")}]`;
const literal = (value: number | bigint) => (value < 10 ? `${value}` : `0x${value.toString(16)}`);

function emitIdentifiers(core: Map<string, Range[]>) {
  const chunks = (ranges: Range[]) => {
    const words = new BigUint64Array(((ranges.at(-1)![1] >> 9) + 1) * 8);
    for (const [first, last] of ranges) for (let c = first; c <= last; c++) words[c >> 6] |= 1n << BigInt(c & 63);
    return upTo(words.length / 8).map(chunk => list([...words.subarray(chunk * 8, chunk * 8 + 8)].map(literal)));
  };
  const start = chunks(core.get("ID_Start")!);
  const { distinct, indices } = deduplicate([...start, ...chunks(core.get("ID_Continue")!)]);
  emit("ID_START_CHUNKS", "u8", indices.slice(0, start.length));
  emit("ID_CONTINUE_CHUNKS", "u8", indices.slice(start.length));
  emit("ID_BITS", "[u64; 8]", distinct);
}

/** `first << 11 | count - 1` */
function emitPackedRanges(name: string, ranges: Range[]) {
  const packed = normalize(ranges).map(([first, last]) => {
    assert(last - first < 1 << 11);
    return literal(first * 2048 + last - first);
  });
  emit(name, "u32", packed);
}

/** The characters that `canonical` does not tell apart, as runs in which the next of the equal characters is found in the same way. */
function emitCaseRuns(name: string, canonical: Map<number, number>) {
  const classes = new Map<string, number[]>();
  for (const [c, to] of canonical) {
    if (!classes.has(`${to}`)) add(classes, `${to}`, to);
    add(classes, `${to}`, c);
  }
  const steps = new Map<number, { kind: string; delta: number }>();
  for (const members of classes.values()) {
    members.sort((a, b) => a - b);
    const kind = members.length > 2 ? "Cycle" : members[1] - members[0] === 1 ? "Adjacent" : "Offset";
    members.forEach((c, index) => {
      steps.set(c, { kind, delta: kind === "Adjacent" ? 0 : members[(index + 1) % members.length] - c });
    });
  }
  const runs: { first: number; last: number; kind: string; delta: number }[] = [];
  for (const [c, step] of [...steps].sort((a, b) => a[0] - b[0])) {
    const run = runs.at(-1);
    const continues = run?.last === c - 1 && run.kind === step.kind && run.delta === step.delta;
    if (continues && step.kind !== "Cycle") run.last = c;
    else runs.push({ first: c, last: c, ...step });
  }
  const step = ({ kind, delta }: { kind: string; delta: number }) => (kind === "Adjacent" ? kind : `${kind}(${delta})`);
  emit(
    name,
    "CaseRun",
    runs.map(run => `run(${literal(run.first)},${literal(run.last)},${step(run)})`),
  );
}

function emitCase(core: Map<string, Range[]>) {
  const lower = new Map<number, number[]>();
  const upper = new Map<number, number[]>();
  for (const row of rows(charactersFolder, "UnicodeData.txt")) {
    if (row[12]) upper.set(hex(row[0]), [hex(row[12])]);
    if (row[13]) lower.set(hex(row[0]), [hex(row[13])]);
  }
  for (const [c, toLower, , toUpper, condition] of rows(charactersFolder, "SpecialCasing.txt")) {
    if (condition) continue;
    lower.set(hex(c), hexList(toLower));
    upper.set(hex(c), hexList(toUpper));
  }
  const folded = new Map<number, number>();
  for (const [c, status, to] of rows(propertiesFolder, "CaseFolding.txt")) {
    if (status === "C" || status === "S") folded.set(hex(c), hex(to));
  }
  // Canonicalize of ECMA-262 without the flags `u` and `v`.
  const raised = new Map<number, number>();
  for (const [c, [to, ...rest]] of upper) {
    if (c <= 0xffff && to <= 0xffff && to !== c && !rest.length && (c < 128 || to >= 128)) raised.set(c, to);
  }

  const expanding = (mapping: Map<number, number[]>) => [...mapping].filter(([, to]) => to.length > 1);
  assert.deepEqual(expanding(lower), [[0x130, [0x69, 0x307]]]);
  const CAPITAL_SIGMA = 0x3a3;
  const delta = (c: number, to: number[] = [c]) => {
    assert(to.length > 1 || to[0] >> 16 === c >> 16, "a mapping changes the number of code units");
    return to.length > 1 ? "SPECIAL" : to[0] - c;
  };
  const record = (c: number) => [
    c === CAPITAL_SIGMA ? "SPECIAL" : delta(c, lower.get(c)),
    delta(c, upper.get(c)),
    (raised.get(c) ?? c) - c,
    (folded.get(c) ?? c) - c,
  ];
  const end = Math.max(...lower.keys(), ...upper.keys(), ...folded.keys());
  const records = deduplicate(upTo(((end >> 6) + 1) << 6).map(record));
  const blocks = deduplicate(upTo((end >> 6) + 1).map(at => list(records.indices.slice(at * 64, at * 64 + 64))));
  assert(records.distinct.length <= 256);
  emit("CASE_BLOCK_INDEX", "u8", blocks.indices);
  emit("CASE_BLOCKS", "[u8; 64]", blocks.distinct);
  ["LOWER_CASE", "UPPER_CASE", "CANONICAL_CODE_UNIT", "CANONICAL_CODE_POINT"].forEach((name, column) => {
    const deltas = upTo(256).map(index => records.distinct[index]?.[column] ?? 0);
    emit(`${name}_DELTAS`, "i32", deltas);
  });
  emit(
    "UPPER_CASE_EXPANSIONS",
    "(u32, [u16; 3])",
    expanding(upper)
      .sort((a, b) => a[0] - b[0])
      .map(([c, [first, second, third = 0]]) => `(${literal(c)},${list([first, second, third].map(literal))})`),
  );
  emitPackedRanges("CASED", core.get("Cased")!);
  emitPackedRanges("CASE_IGNORABLE", core.get("Case_Ignorable")!);
  emitCaseRuns("CODE_UNIT_RUNS", raised);
  emitCaseRuns("CODE_POINT_RUNS", folded);
}

// Table "Binary Unicode property aliases" of ECMA-262, less the three that no file lists.
const binaryProperties = `ASCII_Hex_Digit Alphabetic Bidi_Control Bidi_Mirrored Case_Ignorable Cased
  Changes_When_Casefolded Changes_When_Casemapped Changes_When_Lowercased Changes_When_NFKC_Casefolded
  Changes_When_Titlecased Changes_When_Uppercased Dash Default_Ignorable_Code_Point Deprecated Diacritic Emoji
  Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extended_Pictographic Extender Grapheme_Base
  Grapheme_Extend Hex_Digit IDS_Binary_Operator IDS_Trinary_Operator ID_Continue ID_Start Ideographic Join_Control
  Logical_Order_Exception Lowercase Math Noncharacter_Code_Point Pattern_Syntax Pattern_White_Space Quotation_Mark
  Radical Regional_Indicator Sentence_Terminal Soft_Dotted Terminal_Punctuation Unified_Ideograph Uppercase
  Variation_Selector White_Space XID_Continue XID_Start`.split(/\s+/);
const binaryFiles = [
  "DerivedBinaryProperties.txt",
  "DerivedCoreProperties.txt",
  "DerivedNormalizationProps.txt",
  "PropList.txt",
  "emoji-data.txt",
];
const sequenceFiles = ["emoji-sequences.txt", "emoji-zwj-sequences.txt"];

function generalCategories(): Map<string, Range[]> {
  const categories = new Map<string, Range[]>();
  let first: number | undefined;
  for (const [codePoint, name, category] of rows(propertiesFolder, "UnicodeData.txt")) {
    const c = hex(codePoint);
    if (name.endsWith(", First>")) first = c;
    else add(categories, category, [name.endsWith(", Last>") ? first! : c, c]);
  }
  categories.set("Cn", complement([...categories.values()].flat()));
  for (const [category, ranges] of [...categories]) for (const it of ranges) add(categories, category[0], it);
  categories.set(
    "LC",
    ["Lu", "Ll", "Lt"].flatMap(category => categories.get(category)!),
  );
  return categories;
}

function varint(value: number): number[] {
  return value < 128 ? [value] : [(value & 127) | 128, ...varint(value >>> 7)];
}

/** For each range, how far it starts after the one before with its size less one, up to 7, in the low bits. After a 7, the rest of the size. */
function encodeRanges(ranges: Range[]): number[] {
  let next = 0;
  return normalize(ranges).flatMap(([first, last]) => {
    const more = last - first;
    const bytes = [...varint(((first - next) << 3) | Math.min(more, 7)), ...(more < 7 ? [] : varint(more - 7))];
    next = last + 1;
    return bytes;
  });
}

/** For each string, how many code points it shares with the one before and how many follow, in a byte, then those. */
function encodeStrings(strings: number[][]): number[] {
  const shared = (a: number[], b: number[]) => a.findIndex((c, index) => c !== b[index]);
  const sorted = strings.toSorted((a, b) => {
    const at = shared(a, b);
    return at < 0 ? a.length - b.length : a[at] - (b[at] ?? -1);
  });
  return sorted.flatMap((string, index) => {
    const kept = shared(string, sorted[index - 1] ?? []);
    assert(kept >= 0 && string.length < 16);
    return [(kept << 4) | (string.length - kept), ...string.slice(kept).flatMap(varint)];
  });
}

function emitNames(name: string, values: Map<string, number>) {
  const names = [...values.keys()].sort();
  let end = 0;
  source += `pub(crate) static ${name}: Names = Names {\n    text: b"\\\n`;
  source += names.join("").replace(/.{1,114}/g, "    $&\\\n");
  source += `    ",\n    ends_and_values: &[\n`;
  source += wrap(names.map(it => `(${(end += it.length)},${values.get(it)})`));
  source += "    ],\n};\n";
}

function emitProperties() {
  const sets: number[][] = [];
  const known = new Map<string, number>();
  const id = (ranges: Range[]) => {
    const bytes = encodeRanges(ranges);
    if (!known.has(`${bytes}`)) known.set(`${bytes}`, sets.push(bytes) - 1);
    return known.get(`${bytes}`)!;
  };

  const valueAliases = rows(propertiesFolder, "PropertyValueAliases.txt");
  const namesOf = (property: string) => valueAliases.filter(row => row[0] === property).map(row => row.slice(1));

  const categories = generalCategories();
  const categoryNames = new Map<string, number>();
  for (const names of namesOf("gc")) for (const name of names) categoryNames.set(name, id(categories.get(names[0])!));

  const binary = new Map(binaryFiles.flatMap(file => [...rangesByValue(propertiesFolder, file)]));
  const propertyAliases = rows(propertiesFolder, "PropertyAliases.txt");
  const binaryNames = new Map([
    ["Any", id([[0, MAX]])],
    ["ASCII", id([[0, 0x7f]])],
    ["Assigned", id(complement(categories.get("Cn")!))],
  ]);
  for (const property of binaryProperties) {
    for (const name of propertyAliases.find(row => row[1] === property)!) {
      binaryNames.set(name, id(binary.get(property)!));
    }
  }

  const scripts = rangesByValue(propertiesFolder, "Scripts.txt");
  scripts.set("Unknown", complement([...scripts.values()].flat()));
  const listed = rows(propertiesFolder, "ScriptExtensions.txt");
  const scriptNames = new Map<string, number>();
  const scriptSets: string[] = [];
  for (const names of namesOf("sc")) {
    const ranges = scripts.get(names[1]);
    if (!ranges) continue;
    const extended = [
      ...subtract(
        ranges,
        listed.map(row => range(row[0])),
      ),
      ...listed.filter(row => row[1].split(" ").includes(names[0])).map(row => range(row[0])),
    ];
    for (const name of names) scriptNames.set(name, scriptSets.length);
    scriptSets.push(list([id(ranges), id(extended)]));
  }

  const singles = new Map<string, Range[]>();
  const strings = new Map<string, number[][]>();
  for (const [codePoints, property] of sequenceFiles.flatMap(file => rows(propertiesFolder, file))) {
    if (codePoints.includes(" ")) add(strings, property, hexList(codePoints));
    else add(singles, property, range(codePoints));
  }
  // The union comes last, and its strings are those of the others.
  const sequenceProperties = [...strings.keys(), "RGI_Emoji"];
  singles.set("RGI_Emoji", [...singles.values()].flat());
  const firstWithStrings = sets.length;
  for (const property of sequenceProperties) sets.push(encodeRanges(singles.get(property) ?? []));
  const sequenceNames = new Map(sequenceProperties.map((name, index) => [name, firstWithStrings + index]));

  const sections = [...sets, ...[...strings.values()].map(encodeStrings)];
  let end = 0;
  emit("PROPERTY_SECTIONS", "u16", [0, ...sections.map(section => (end += section.length))]);
  source += `pub(crate) const FIRST_PROPERTY_OF_STRINGS: u16 = ${firstWithStrings};\n`;
  source += `pub(crate) const PROPERTY_COUNT: u16 = ${sets.length};\n`;
  emit("SCRIPT_PROPERTIES", "[u16; 2]", scriptSets);
  emitNames("GENERAL_CATEGORY_NAMES", categoryNames);
  emitNames("BINARY_PROPERTY_NAMES", binaryNames);
  emitNames("SCRIPT_NAMES", scriptNames);
  emitNames("PROPERTY_OF_STRINGS_NAMES", sequenceNames);
  writeFileSync(join(import.meta.dirname, "properties.bin"), new Uint8Array(sections.flat()));
}

source += `//! Written by generate.ts: identifiers and case conversion of Unicode ${version(charactersFolder)}, properties and folding of Unicode ${version(propertiesFolder)}.

use crate::case::SPECIAL;
use crate::ignore_case::{CaseRun, Step::{Adjacent, Cycle, Offset}, run};
use crate::property::Names;

`;
const core = rangesByValue(charactersFolder, "DerivedCoreProperties.txt");
emitIdentifiers(core);
emitCase(core);
emitProperties();
writeFileSync(join(import.meta.dirname, "tables.rs"), source);
