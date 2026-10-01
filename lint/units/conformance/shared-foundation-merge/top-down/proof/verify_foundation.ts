// The merged foundation against the ground-truth program: Go's tables for every code point and the vectors.
// usage: bun verify_foundation.ts [gotab.txt.gz] [govec.jsonl.gz]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  type ByteString,
  InvalidUtf8Error,
  byteStringToUtf8,
  decodeLastRune,
  decodeRune,
  fromByteString,
  replaceNonWhitespace,
  runeCount,
  toByteString,
  trimRightSpace,
  utf8Bytes,
  utf8String,
  utf8ToByteString,
  validString,
} from "../runner/bytestring";
import { computeECMALineStarts, utf16Len } from "../runner/core";
import {
  atoi,
  compareStrings,
  equalFold,
  foldKey,
  isSpace,
  padLeft,
  sortedStrings,
  toLower,
  trimFunc,
  trimSpace,
  unicodeToLower,
} from "../runner/gostrings";
import { computeLineOfPosition, skipTrivia } from "../runner/scanner";
import {
  compareStringsCaseInsensitive,
  compareStringsCaseSensitive,
  isLineBreak,
  isWhiteSpaceLike,
  isWhiteSpaceSingleLine,
} from "../runner/stringutil";
import { utf8Model } from "../runner/text_model";
import * as tspath from "../runner/tspath";
import { unicodeVersion } from "../runner/unicode_tables";
import { decodeBytes } from "../runner/vfs";

const here = import.meta.dir;
const tabPath = process.argv[2] ?? here + "/../vectors/gotab.txt.gz";
const vecPath = process.argv[3] ?? here + "/../vectors/govec.jsonl.gz";
const load = (p: string) => (p.endsWith(".gz") ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString("utf8");

let checks = 0;
let failures = 0;
const shown = new Map<string, number>();
function fail(what: string, detail: unknown): void {
  failures++;
  const n = (shown.get(what) ?? 0) + 1;
  shown.set(what, n);
  if (n <= 5) console.log("FAIL", what, JSON.stringify(detail));
}
function eq(what: string, got: unknown, want: unknown, detail: unknown): void {
  checks++;
  const same = typeof got === "object" ? JSON.stringify(got) === JSON.stringify(want) : got === want;
  if (!same) fail(what, { got, want, detail });
}

const MaxRune = 0x10ffff;
const b = (s: string): ByteString => Buffer.from(s, "base64").toString("latin1");
const hex = (s: ByteString) => Buffer.from(s, "latin1").toString("hex");

// Tables.
const lower = new Map<number, number>();
const next = new Map<number, number>();
const space = new Set<number>();
const white = new Map<number, [boolean, boolean]>();
const tab = load(tabPath).split("\n");
eq("unicode version", unicodeVersion, tab[0].replace("version ", ""), tab[0]);
for (const l of tab) {
  const f = l.split(" ");
  if (f[0] === "L") lower.set(parseInt(f[1], 16), parseInt(f[2], 16));
  else if (f[0] === "F") next.set(parseInt(f[1], 16), parseInt(f[2], 16));
  else if (f[0] === "S") space.add(parseInt(f[1], 16));
  else if (f[0] === "W") white.set(parseInt(f[1], 16), [f[2] === "true", f[3] === "true"]);
}
let engineLowerDiffers = 0;
const engineLowerExamples: string[] = [];
for (let r = 0; r <= MaxRune; r++) {
  const want = lower.get(r) ?? r;
  checks++;
  if (unicodeToLower(r) !== want) fail("unicode.ToLower", { r: r.toString(16), got: unicodeToLower(r).toString(16), want: want.toString(16) });
  checks++;
  if (isSpace(r) !== space.has(r)) fail("unicode.IsSpace", { r: r.toString(16) });
  const w = white.get(r);
  checks++;
  if (isWhiteSpaceLike(r) !== (w !== undefined) || isWhiteSpaceSingleLine(r) !== (w?.[0] ?? false) || isLineBreak(r) !== (w?.[1] ?? false)) {
    fail("stringutil rune tests", { r: r.toString(16) });
  }
  if (r >= 0xd800 && r <= 0xdfff) continue;
  // What the engine would give with one code point at a time and U+0130 as "i": the helpers that the merge replaces.
  const ch = String.fromCodePoint(r);
  const l = ch.toLowerCase();
  const engine = r === 0x130 ? 0x69 : [...l].length === 1 ? l.codePointAt(0)! : r;
  if (engine !== want) {
    engineLowerDiffers++;
    if (engineLowerExamples.length < 8) engineLowerExamples.push(`U+${r.toString(16)}: engine U+${engine.toString(16)}, Go U+${want.toString(16)}`);
  }
}
// Orbits of unicode.SimpleFold: the key of a rune is the smallest member of its orbit.
const orbitOf = (r: number): number[] => {
  const out = [r];
  for (let n = next.get(r); n !== undefined && n !== r; n = next.get(n)) out.push(n);
  return out;
};
let foldPairs = 0;
let engineFoldDiffers = 0;
const engineFold = (x: number, y: number): boolean => {
  // The fold of the replaced helper: upper then lower, one code point at a time.
  const f = (r: number) => {
    const ch = String.fromCodePoint(r);
    const u = ch.toUpperCase();
    const l = (u.length === ch.length ? u : ch).toLowerCase();
    return l.length === ch.length ? l : ch;
  };
  return x === y || f(x) === f(y);
};
for (let r = 0; r <= MaxRune; r++) {
  const orbit = next.has(r) ? orbitOf(r) : [r];
  const want = Math.min(...orbit);
  checks++;
  if (foldKey(r) !== want) fail("fold key", { r: r.toString(16), got: foldKey(r).toString(16), want: want.toString(16) });
  if (r >= 0xd800 && r <= 0xdfff) continue;
  for (const o of orbit) {
    if (o === r) continue;
    foldPairs++;
    checks++;
    if (!equalFold(String.fromCodePoint(r), String.fromCodePoint(o))) fail("strings.EqualFold on an orbit", { r: r.toString(16), o: o.toString(16) });
    if (!engineFold(r, o)) engineFoldDiffers++;
  }
  // What the engine maps the rune to, and its neighbour, fold to it only when they are in the orbit.
  const ch = String.fromCodePoint(r);
  const outside = new Set<number>([r + 1]);
  for (const m of [ch.toLowerCase(), ch.toUpperCase()]) if ([...m].length === 1) outside.add(m.codePointAt(0)!);
  for (const n of outside) {
    if (n > MaxRune || (n >= 0xd800 && n <= 0xdfff) || orbit.includes(n)) continue;
    checks++;
    if (equalFold(ch, String.fromCodePoint(n))) fail("strings.EqualFold outside an orbit", { r: r.toString(16), n: n.toString(16) });
    if (engineFold(r, n)) engineFoldDiffers++;
    if (engineFold(n, r)) engineFoldDiffers++;
  }
}

// Vectors.
const counts: Record<string, number> = {};
let splitDiffersFromSplitLines = 0;
let cutByUnitsDiffers = 0;
let foldOnByteStringsDiffers = 0;
let rootFoldOnByteStringsDiffers = 0;
let validTexts = 0;
function seqLine(s: ByteString): string {
  const [r, size] = decodeRune(s, 0);
  const [lr, lsize] = decodeLastRune(s, 0, s.length);
  return `${hex(s)} ${r} ${size} ${lr} ${lsize} ${runeCount(s)} ${validString(s)} ${utf16Len(s)}\n`;
}
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
    for (let r = 0; r <= MaxRune; r += 7) {
      if (r >= 0xd800 && r <= 0xdfff) continue;
      yield "x" + utf8ToByteString(String.fromCodePoint(r)) + "y";
    }
  } else throw new Error("unknown set " + set);
}
const byteLen = (s: string) => Buffer.byteLength(s, "utf8");
const enc = (s: string) => utf8ToByteString(s);

for (const line of load(vecPath).split("\n")) {
  if (line === "") continue;
  const v = JSON.parse(line);
  const k: string = v.k ?? "pad";
  counts[k] = (counts[k] ?? 0) + 1;
  if (k === "version") {
    eq("unicode version of the vectors", unicodeVersion, v.unicode, v);
  } else if (k === "tables") {
    // The same digests from the functions of the merged set: what a test can hold in place of the tables of Go.
    const h = { lower: createHash("sha256"), foldKey: createHash("sha256"), space: createHash("sha256"), white: createHash("sha256") };
    for (let r = 0; r <= MaxRune; r++) {
      const x = r.toString(16);
      if (unicodeToLower(r) !== r) h.lower.update(`${x} ${unicodeToLower(r).toString(16)}\n`);
      if (foldKey(r) !== r) h.foldKey.update(`${x} ${foldKey(r).toString(16)}\n`);
      if (isSpace(r)) h.space.update(`${x}\n`);
      if (isWhiteSpaceLike(r)) h.white.update(`${x} ${isWhiteSpaceSingleLine(r)} ${isLineBreak(r)}\n`);
    }
    eq("digests of the tables", [h.lower.digest("hex"), h.foldKey.digest("hex"), h.space.digest("hex"), h.white.digest("hex")], [v.lower, v.foldKey, v.space, v.white], "tables");
  } else if (k === "text") {
    const s = b(v.s);
    const id = hex(s).slice(0, 60);
    eq("utf8.ValidString", validString(s), v.valid, id);
    eq("utf8.RuneCountInString", runeCount(s), v.rc, id);
    eq("core.UTF16Len", utf16Len(s), v.u16, id);
    const starts = computeECMALineStarts(s);
    eq("core.ComputeECMALineStarts", starts, v.ls, id);
    eq("strings.TrimRightFunc(IsSpace)", hex(trimRightSpace(s)), hex(b(v.trimRight)), id);
    eq("regexp \\S to space", hex(replaceNonWhitespace(s)), hex(b(v.blank)), id);
    for (let p = 0; p <= s.length; p++) {
      checks++;
      if (skipTrivia(s, p) !== v.skip[p]) fail("scanner.SkipTrivia", { id, p, got: skipTrivia(s, p), want: v.skip[p] });
      const lineNo = computeLineOfPosition(starts, p);
      checks++;
      if (lineNo !== v.lc[p][0] || utf16Len(s.slice(starts[lineNo], p)) !== v.lc[p][1]) fail("line and UTF-16 character", { id, p });
      checks++;
      if (utf8Model.utf16Length(s, starts[lineNo], p) !== v.lc[p][1]) fail("utf8Model.utf16Length", { id, p });
    }
    eq("lineDelimiter.Split on bytes", s.split(/\r?\n/).map(hex), v.split.map((x: string) => hex(b(x))), id);
    eq("utf8Model.contentLines", utf8Model.contentLines(s).map(hex), v.split.map((x: string) => hex(b(x))), id);
    if (JSON.stringify(v.split) !== JSON.stringify(v.splitLines)) splitDiffersFromSplitLines++;
    if (v.valid) {
      validTexts++;
      const d = byteStringToUtf8(s);
      eq("round trip of the conversions", hex(enc(d)), hex(s), id);
      eq("bytes of a ByteString", fromByteString(s).toString("hex"), hex(s), id);
      eq("utf8String and utf8Bytes", utf8Bytes(utf8String(fromByteString(s))).toString("hex"), hex(s), id);
      eq("lineDelimiter.Split on decoded text", d.split(/\r?\n/).map(x => hex(enc(x))), v.split.map((x: string) => hex(b(x))), id);
      eq("strings.TrimSpace", hex(enc(trimSpace(d))), hex(b(v.trimSpace)), id);
      eq("strings.TrimFunc(IsWhiteSpaceLike)", hex(enc(trimFunc(d, isWhiteSpaceLike))), hex(b(v.trimWhite)), id);
      eq("strings.TrimFunc(IsSpace)", hex(enc(trimFunc(d, isSpace))), hex(b(v.trimSpace)), id);
      eq("strings.ToLower", hex(enc(toLower(d))), hex(b(v.toLower)), id);
      eq("tspath.ToFileNameLowerCase", hex(enc(tspath.toFileNameLowerCase(d))), hex(b(v.toFileNameLowerCase)), id);
    } else {
      checks++;
      let threw = false;
      try {
        byteStringToUtf8(s);
      } catch (e) {
        threw = e instanceof InvalidUtf8Error;
      }
      if (!threw) fail("bytes that are no UTF-8 throw", id);
      checks++;
      threw = false;
      try {
        utf8String(fromByteString(s));
      } catch (e) {
        threw = e instanceof InvalidUtf8Error;
      }
      if (!threw) fail("utf8String throws on bytes that are no UTF-8", id);
    }
  } else if (k === "seq") {
    const h = createHash("sha256");
    let sum = 2166136261;
    let n = 0;
    for (const s of seqSet(v.set)) {
      h.update(seqLine(s), "latin1");
      const [r, size] = decodeRune(s, 0);
      const [lr, lsize] = decodeLastRune(s, 0, s.length);
      for (const x of [r, size, lr, lsize, runeCount(s), validString(s) ? 1 : 0, utf16Len(s)]) sum = Math.imul(sum ^ x, 16777619) >>> 0;
      n++;
    }
    eq("utf8 on the set " + v.set, [n, h.digest("hex"), sum], [v.count, v.digest, v.sum32], v.set);
  } else if (k === "pair") {
    const x = byteStringToUtf8(b(v.a));
    const y = byteStringToUtf8(b(v.b));
    const id = [x, y];
    eq("strings.EqualFold", equalFold(x, y), v.equalFold, id);
    eq("strings.Compare", compareStrings(x, y), v.compare, id);
    eq("strings.Compare on ByteStrings", compareStrings(b(v.a), b(v.b)), v.compare, id);
    eq("stringutil.CompareStringsCaseInsensitive", compareStringsCaseInsensitive(x, y), v.compareCaseInsensitive, id);
    eq("stringutil.CompareStringsCaseSensitive", compareStringsCaseSensitive(x, y), v.compareCaseSensitive, id);
  } else if (k === "path") {
    const name = byteStringToUtf8(b(v.name));
    const dir = byteStringToUtf8(b(v.dir));
    const id = [name, dir];
    const d = (x: string) => byteStringToUtf8(b(x));
    const cs = { useCaseSensitiveFileNames: true, currentDirectory: dir };
    const ci = { useCaseSensitiveFileNames: false, currentDirectory: dir };
    const plainCS = { useCaseSensitiveFileNames: true, currentDirectory: "" };
    const plainCI = { useCaseSensitiveFileNames: false, currentDirectory: "" };
    eq("GetNormalizedAbsolutePath", tspath.getNormalizedAbsolutePath(name, dir), d(v.getNormalizedAbsolutePath), id);
    eq("NormalizePath", tspath.normalizePath(name), d(v.normalizePath), id);
    eq("GetDirectoryPath", tspath.getDirectoryPath(name), d(v.getDirectoryPath), id);
    eq("GetBaseFileName", tspath.getBaseFileName(name), d(v.getBaseFileName), id);
    // The reference counts bytes; the port counts the units of its string.
    const root = tspath.getRootLength(name);
    eq("GetRootLength", byteLen(name.slice(0, root)), v.getRootLength, id);
    const encoded = tspath.getEncodedRootLength(name);
    eq("GetEncodedRootLength", encoded < 0 ? ~byteLen(name.slice(0, ~encoded)) : byteLen(name.slice(0, encoded)), v.getEncodedRootLength, id);
    eq("IsRootedDiskPath", tspath.isRootedDiskPath(name), v.isRootedDiskPath, id);
    eq("PathIsAbsolute", tspath.pathIsAbsolute(name), v.pathIsAbsolute, id);
    eq("CombinePaths", tspath.combinePaths(dir, name), d(v.combinePaths), id);
    eq("ToPath case sensitive", tspath.toPath(name, dir, true), d(v.toPathCaseSensitive), id);
    eq("ToPath case insensitive", tspath.toPath(name, dir, false), d(v.toPathCaseInsensitive), id);
    eq("GetAnyExtensionFromPath", tspath.getAnyExtensionFromPath(name, undefined, false), d(v.getAnyExtensionFromPath), id);
    eq("HasExtension", tspath.hasExtension(name), v.hasExtension, id);
    eq("FileExtensionIs .d.ts", tspath.fileExtensionIs(name, tspath.ExtensionDts), v.fileExtensionIsDts, id);
    eq("ChangeExtension", tspath.changeExtension(name, ".ts"), d(v.changeExtensionTs), id);
    eq("GetNormalizedPathComponents", tspath.getNormalizedPathComponents(name, dir), v.getNormalizedPathComponents.map(d), id);
    eq("GetPathComponents", tspath.getPathComponents(name, dir), v.getPathComponents.map(d), id);
    eq("ToFileNameLowerCase", tspath.toFileNameLowerCase(name), d(v.toFileNameLowerCase), id);
    eq("RemoveTrailingDirectorySeparator", tspath.removeTrailingDirectorySeparator(name), d(v.removeTrailingDirectorySeparator), id);
    eq("RemoveTrailingDirectorySeparators", tspath.removeTrailingDirectorySeparators(name), d(v.removeTrailingDirectorySeparators), id);
    eq("EnsureTrailingDirectorySeparator", tspath.ensureTrailingDirectorySeparator(name), d(v.ensureTrailingDirectorySeparator), id);
    eq("HasTrailingDirectorySeparator", tspath.hasTrailingDirectorySeparator(name), v.hasTrailingDirectorySeparator, id);
    eq("ComparePaths case sensitive", tspath.comparePaths(name, dir, plainCS), v.comparePathsCaseSensitive, id);
    eq("ComparePaths case insensitive", tspath.comparePaths(name, dir, plainCI), v.comparePathsCaseInsensitive, id);
    eq("ContainsPath case sensitive", tspath.containsPath(dir, name, plainCS), v.containsPathCaseSensitive, id);
    eq("ContainsPath case insensitive", tspath.containsPath(dir, name, plainCI), v.containsPathCaseInsensitive, id);
    eq("ConvertToRelativePath case sensitive", tspath.convertToRelativePath(name, cs), d(v.convertToRelativePathCaseSensitive), id);
    eq("ConvertToRelativePath case insensitive", tspath.convertToRelativePath(name, ci), d(v.convertToRelativePathCaseInsensitive), id);
    // The functions that the writer calls with a ByteString: there they count bytes and give the bytes of the reference.
    const bn = b(v.name);
    const bd = b(v.dir);
    eq("GetRootLength of a ByteString", tspath.getRootLength(bn), v.getRootLength, id);
    eq("GetEncodedRootLength of a ByteString", tspath.getEncodedRootLength(bn), v.getEncodedRootLength, id);
    eq("IsRootedDiskPath of a ByteString", tspath.isRootedDiskPath(bn), v.isRootedDiskPath, id);
    eq("PathIsAbsolute of a ByteString", tspath.pathIsAbsolute(bn), v.pathIsAbsolute, id);
    eq("GetBaseFileName of a ByteString", hex(tspath.getBaseFileName(bn)), hex(b(v.getBaseFileName)), id);
    eq("CombinePaths of ByteStrings", hex(tspath.combinePaths(bd, bn)), hex(b(v.combinePaths)), id);
    eq("GetPathComponents of ByteStrings", tspath.getPathComponents(bn, bd).map(hex), v.getPathComponents.map((x: string) => hex(b(x))), id);
    eq("GetNormalizedPathComponents of ByteStrings", tspath.getPathFromPathComponents(tspath.reducePathComponents(tspath.getPathComponents(bn, bd))), tspath.getPathFromPathComponents(v.getNormalizedPathComponents.map(b)), id);
    eq("RemoveTrailingDirectorySeparator of a ByteString", hex(tspath.removeTrailingDirectorySeparator(bn)), hex(b(v.removeTrailingDirectorySeparator)), id);
    eq("EnsureTrailingDirectorySeparator of a ByteString", hex(tspath.ensureTrailingDirectorySeparator(bn)), hex(b(v.ensureTrailingDirectorySeparator)), id);
    eq("HasTrailingDirectorySeparator of a ByteString", tspath.hasTrailingDirectorySeparator(bn), v.hasTrailingDirectorySeparator, id);
    eq("NormalizeSlashes of a ByteString", hex(tspath.normalizeSlashes(bn)), hex(utf8ToByteString(tspath.normalizeSlashes(name))), id);
    // ComparePaths folds the root in both modes and the rest in one: it takes decoded names, on ByteStrings it is another function.
    if (tspath.comparePaths(bn, bd, plainCS) !== v.comparePathsCaseSensitive) rootFoldOnByteStringsDiffers++;
    if (tspath.comparePaths(bn, bd, plainCI) !== v.comparePathsCaseInsensitive) foldOnByteStringsDiffers++;
  } else if (k === "ext") {
    const name = byteStringToUtf8(b(v.name));
    const list: string[] = v.extensions.map((x: string) => byteStringToUtf8(b(x)));
    const id = [name, list, v.ignoreCase];
    eq("GetAnyExtensionFromPath with a list", tspath.getAnyExtensionFromPath(name, list, v.ignoreCase), byteStringToUtf8(b(v.getAnyExtensionFromPath)), id);
    eq("ChangeAnyExtension", tspath.changeAnyExtension(name, ".x", list, v.ignoreCase), byteStringToUtf8(b(v.changeAnyExtension)), id);
    // The cut by code units, which the copies had: where it is another answer than the one of the reference.
    const ext = list.map(e => (e.startsWith(".") ? e : "." + e));
    const p = tspath.removeTrailingDirectorySeparator(name);
    let byUnits = "";
    for (const e of ext) {
      if (p.length >= e.length && p[p.length - e.length] === ".") {
        const tail = p.slice(p.length - e.length);
        if (v.ignoreCase ? equalFold(tail, e) : tail === e) {
          byUnits = tail;
          break;
        }
      }
    }
    if (byUnits !== byteStringToUtf8(b(v.getAnyExtensionFromPath))) cutByUnitsDiffers++;
  } else if (k === "decode") {
    const bytes = Buffer.from(v.bytes, "base64");
    const contents = bytes.length === 0 ? bytes : Buffer.from(decodeBytes(bytes));
    eq("decodeBytes", contents.toString("hex"), hex(b(v.contents)), v.bytes);
    let got: string;
    try {
      got = hex(enc(utf8String(contents)));
    } catch (e) {
      got = e instanceof InvalidUtf8Error ? "InvalidUtf8Error" : String(e);
    }
    eq("utf8String of decodeBytes", got, v.valid ? hex(b(v.contents)) : "InvalidUtf8Error", v.bytes);
  } else if (k === "atoi") {
    eq("strconv.Atoi", atoi(b(v.s)), v.ok ? v.n : undefined, v);
  } else if (k === "sorted") {
    const want: string[] = v.sorted.map((x: string) => byteStringToUtf8(b(x)));
    eq("slices.Sorted", sortedStrings([...want].reverse()), want, "sorted");
  } else if (k === "pad") {
    eq("fmt %*s", [padLeft("ab", 5), padLeft("abc", 1), padLeft("42", 4), padLeft("", 0)], [v.a, v.b, v.c, v.d], v);
  } else {
    fail("unknown kind of vector", k);
  }
}
// The ByteString of a decoded name gives the same comparison through toByteString of its bytes.
eq("toByteString", toByteString(Buffer.from("é中😀", "utf8")), enc("é中😀"), "");

console.log(`unicode ${unicodeVersion}: ${lower.size} lower mappings, ${foldPairs} ordered fold pairs, ${space.size} spaces`);
console.log(`engine (Unicode ${process.versions.unicode}) against Go: ${engineLowerDiffers} code points lower differently, ${engineFoldDiffers} ordered pairs fold differently`);
for (const e of engineLowerExamples) console.log("   " + e);
console.log("vectors:", JSON.stringify(counts), "valid texts:", validTexts);
console.log(`texts where lineDelimiter.Split and stringutil.SplitLines differ: ${splitDiffersFromSplitLines} of ${counts.text}`);
console.log(`extension rows where a cut by code units gives another answer than the reference: ${cutByUnitsDiffers} of ${counts.ext}`);
console.log(`path rows where ComparePaths of ByteStrings gives another answer than the reference: case sensitive ${rootFoldOnByteStringsDiffers}, case insensitive ${foldOnByteStringsDiffers} of ${counts.path}`);
console.log(`checks ${checks}, failures ${failures}`);
for (const [what, n] of shown) console.log(`   ${n}  ${what}`);
process.exit(failures === 0 ? 0 : 1);
