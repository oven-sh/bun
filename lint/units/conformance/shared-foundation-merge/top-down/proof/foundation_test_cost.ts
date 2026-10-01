// What a test of the foundation costs: the digests of the tables, the digests of the UTF-8 sets and the reduced vectors.
// The digests hold the mapped code points only, so the walk ends where the tables end: no run reaches 0x20000.
// usage: bun foundation_test_cost.ts [govec-test.jsonl.gz] [small: one row of eight of the large kinds, as for a debug build]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { type ByteString, InvalidUtf8Error, byteStringToUtf8, decodeLastRune, decodeRune, runeCount, utf8String, utf8ToByteString, validString } from "../runner/bytestring";
import { computeECMALineStarts, utf16Len } from "../runner/core";
import { atoi, compareStrings, equalFold, foldKey, isSpace, padLeft, sortedStrings, toLower, trimSpace, unicodeToLower } from "../runner/gostrings";
import { skipTrivia } from "../runner/scanner";
import { compareStringsCaseInsensitive, isLineBreak, isWhiteSpaceLike, isWhiteSpaceSingleLine } from "../runner/stringutil";
import * as tspath from "../runner/tspath";
import { foldRanges, lowerRanges } from "../runner/unicode_tables";
import { decodeBytes } from "../runner/vfs";

const t0 = performance.now();
const small = process.argv[3] === "small";
const seen: Record<string, number> = {};
const rows = gunzipSync(readFileSync(process.argv[2] ?? import.meta.dir + "/../vectors/govec-test.jsonl.gz")).toString("utf8").split("\n").filter(l => l !== "").map(l => JSON.parse(l)).filter(v => {
  const n = (seen[v.k] = (seen[v.k] ?? 0) + 1);
  return !small || !["text", "pair", "path", "ext"].includes(v.k) || (n - 1) % 8 === 0;
});
const t1 = performance.now();
const b = (s: string): ByteString => Buffer.from(s, "base64").toString("latin1");
const hex = (s: ByteString) => Buffer.from(s, "latin1").toString("hex");
let bad = 0;
const want = rows.find(r => r.k === "tables");
const h = [createHash("sha256"), createHash("sha256"), createHash("sha256"), createHash("sha256")];
const tablesEnd = 0x20000;
if (lowerRanges[lowerRanges.length - 3] >= tablesEnd || foldRanges[foldRanges.length - 3] >= tablesEnd) bad++;
for (const r of [tablesEnd, 0x2fffe, 0xe0041, 0x10ffff]) if (unicodeToLower(r) !== r || foldKey(r) !== r || isSpace(r) || isWhiteSpaceLike(r)) bad++;
for (let r = 0; r < tablesEnd; r++) {
  const l = unicodeToLower(r);
  if (l !== r) h[0].update(`${r.toString(16)} ${l.toString(16)}\n`);
  const k = foldKey(r);
  if (k !== r) h[1].update(`${r.toString(16)} ${k.toString(16)}\n`);
  if (isSpace(r)) h[2].update(`${r.toString(16)}\n`);
  if (isWhiteSpaceLike(r)) h[3].update(`${r.toString(16)} ${isWhiteSpaceSingleLine(r)} ${isLineBreak(r)}\n`);
}
if (JSON.stringify(h.map(x => x.digest("hex"))) !== JSON.stringify([want.lower, want.foldKey, want.space, want.white])) bad++;
const t2 = performance.now();
const edge = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xf0, 0xf4, 0xff];
function* seqSet(set: string): Generator<ByteString> {
  const s = String.fromCharCode;
  if (set === "one") for (let a = 0; a < 256; a++) yield s(a);
  else if (set.startsWith("two-")) {
    const a = parseInt(set.slice(4), 16);
    for (let x = a; x < a + 16; x++) for (let y = 0; y < 256; y++) yield s(x, y);
  } else if (set === "three") {
    for (let a = 0xe0; a <= 0xef; a++) for (const x of edge) for (const y of edge) yield s(a, x, y);
  } else if (set === "four") {
    for (let a = 0xf0; a <= 0xf7; a++) for (const x of edge) for (const y of edge) for (const z of edge) yield s(a, x, y, z);
  } else if (set === "scalars") {
    for (let r = 0; r <= 0x10ffff; r += 7) if (!(r >= 0xd800 && r <= 0xdfff)) yield "x" + utf8ToByteString(String.fromCodePoint(r)) + "y";
  }
}
for (const v of rows) {
  if (v.k === "seq") {
    let sum = 2166136261;
    for (const s of seqSet(v.set)) {
      const [r, size] = decodeRune(s, 0);
      const [lr, lsize] = decodeLastRune(s, 0, s.length);
      sum = Math.imul(sum ^ r, 16777619);
      sum = Math.imul(sum ^ size, 16777619);
      sum = Math.imul(sum ^ lr, 16777619);
      sum = Math.imul(sum ^ lsize, 16777619);
      sum = Math.imul(sum ^ runeCount(s), 16777619);
      sum = Math.imul(sum ^ (validString(s) ? 1 : 0), 16777619);
      sum = Math.imul(sum ^ utf16Len(s), 16777619);
    }
    if (sum >>> 0 !== v.sum32) bad++;
  }
}
const t3 = performance.now();
for (const v of rows) {
  if (v.k === "text") {
    const s = b(v.s);
    if (JSON.stringify(computeECMALineStarts(s)) !== JSON.stringify(v.ls)) bad++;
    for (let p = 0; p <= s.length; p++) if (skipTrivia(s, p) !== v.skip[p]) bad++;
    if (v.valid) {
      const d = byteStringToUtf8(s);
      if (hex(utf8ToByteString(trimSpace(d))) !== hex(b(v.trimSpace))) bad++;
      if (hex(utf8ToByteString(toLower(d))) !== hex(b(v.toLower))) bad++;
    }
  } else if (v.k === "pair") {
    const x = byteStringToUtf8(b(v.a));
    const y = byteStringToUtf8(b(v.b));
    if (equalFold(x, y) !== v.equalFold || compareStrings(x, y) !== v.compare || compareStringsCaseInsensitive(x, y) !== v.compareCaseInsensitive) bad++;
  } else if (v.k === "path") {
    const name = byteStringToUtf8(b(v.name));
    const dir = byteStringToUtf8(b(v.dir));
    const d = (x: string) => byteStringToUtf8(b(x));
    if (tspath.getNormalizedAbsolutePath(name, dir) !== d(v.getNormalizedAbsolutePath)) bad++;
    if (tspath.comparePaths(name, dir, { useCaseSensitiveFileNames: false, currentDirectory: "" }) !== v.comparePathsCaseInsensitive) bad++;
    if (tspath.toPath(name, dir, false) !== d(v.toPathCaseInsensitive)) bad++;
  } else if (v.k === "ext") {
    const d = (x: string) => byteStringToUtf8(b(x));
    const list: string[] = v.extensions.map(d);
    if (tspath.getAnyExtensionFromPath(d(v.name), list, v.ignoreCase) !== d(v.getAnyExtensionFromPath)) bad++;
    if (tspath.changeAnyExtension(d(v.name), ".x", list, v.ignoreCase) !== d(v.changeAnyExtension)) bad++;
  } else if (v.k === "decode") {
    const bytes = Buffer.from(v.bytes, "base64");
    let got: string;
    try {
      got = bytes.length === 0 ? "" : hex(utf8ToByteString(utf8String(decodeBytes(bytes))));
    } catch (e) {
      got = e instanceof InvalidUtf8Error ? "InvalidUtf8Error" : String(e);
    }
    if (got !== (v.valid ? hex(b(v.contents)) : "InvalidUtf8Error")) bad++;
  } else if (v.k === "atoi") {
    if (atoi(b(v.s)) !== (v.ok ? v.n : undefined)) bad++;
  } else if (v.k === "sorted") {
    const want: string[] = v.sorted.map((x: string) => byteStringToUtf8(b(x)));
    if (JSON.stringify(sortedStrings([...want].reverse())) !== JSON.stringify(want)) bad++;
  } else if (v.k === "pad") {
    if (JSON.stringify([padLeft("ab", 5), padLeft("abc", 1), padLeft("42", 4), padLeft("", 0)]) !== JSON.stringify([v.a, v.b, v.c, v.d])) bad++;
  }
}
const t4 = performance.now();
console.log(JSON.stringify({ rows: rows.length, bad, msLoad: Math.round(t1 - t0), msTables: Math.round(t2 - t1), msUtf8Sets: Math.round(t3 - t2), msRows: Math.round(t4 - t3), msAll: Math.round(t4 - t0) }));
