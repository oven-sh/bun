// Prototype of the block of test/cli/lint/conformance.test.ts that holds the foundation to the answers of Go.
// In the repository: "harness" for the absolute import, "./conformance/runner/..." for "../runner/...", and the
// vectors beside the runner. A debug or sanitizer build takes one row of eight of the large kinds and no table walk.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type ByteString,
  InvalidUtf8Error,
  byteStringToUtf8,
  decodeLastRune,
  decodeRune,
  runeCount,
  trimRightSpace,
  replaceNonWhitespace,
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
  trimSpace,
  unicodeToLower,
} from "../runner/gostrings";
import { computeLineOfPosition, skipTrivia } from "../runner/scanner";
import {
  compareStringsCaseInsensitive,
  isLineBreak,
  isWhiteSpaceLike,
  isWhiteSpaceSingleLine,
} from "../runner/stringutil";
import * as tspath from "../runner/tspath";
import { foldRanges, lowerRanges, unicodeVersion } from "../runner/unicode_tables";
import { decodeBytes } from "../runner/vfs";
import { isASAN, isDebug } from "/workspace/wt/conformance/test/harness.ts";

const small = isDebug || isASAN;
const seen: Record<string, number> = {};
const rows: any[] = gunzipSync(readFileSync(join(import.meta.dir, "..", "vectors", "govec-test.jsonl.gz")))
  .toString("utf8")
  .split("\n")
  .filter(l => l !== "")
  .map(l => JSON.parse(l))
  .filter(v => {
    const n = (seen[v.k] = (seen[v.k] ?? 0) + 1);
    return !small || !["text", "pair", "path", "ext"].includes(v.k) || (n - 1) % 8 === 0;
  });
const of = (kind: string) => rows.filter(v => v.k === kind);
const b = (s: string): ByteString => Buffer.from(s, "base64").toString("latin1");
const hex = (s: ByteString) => Buffer.from(s, "latin1").toString("hex");
const d = (s: string) => byteStringToUtf8(b(s));

describe("foundation", () => {
  test("the tables are the ones of the Unicode version of the reference's toolchain", () => {
    expect(unicodeVersion).toBe(of("version")[0].unicode);
  });

  // The digests hold the mapped code points only, so the walk ends where the tables end.
  test.skipIf(small)("case mapping, folding and white space of every code point", () => {
    const tablesEnd = 0x20000;
    expect(lowerRanges[lowerRanges.length - 3]).toBeLessThan(tablesEnd);
    expect(foldRanges[foldRanges.length - 3]).toBeLessThan(tablesEnd);
    for (const r of [tablesEnd, 0x2fffe, 0xe0041, 0x10ffff]) {
      expect([unicodeToLower(r), foldKey(r), isSpace(r), isWhiteSpaceLike(r)]).toEqual([r, r, false, false]);
    }
    const h = [createHash("sha256"), createHash("sha256"), createHash("sha256"), createHash("sha256")];
    for (let r = 0; r < tablesEnd; r++) {
      const l = unicodeToLower(r);
      if (l !== r) h[0].update(`${r.toString(16)} ${l.toString(16)}\n`);
      const k = foldKey(r);
      if (k !== r) h[1].update(`${r.toString(16)} ${k.toString(16)}\n`);
      if (isSpace(r)) h[2].update(`${r.toString(16)}\n`);
      if (isWhiteSpaceLike(r)) h[3].update(`${r.toString(16)} ${isWhiteSpaceSingleLine(r)} ${isLineBreak(r)}\n`);
    }
    const want = of("tables")[0];
    expect(h.map(x => x.digest("hex"))).toEqual([want.lower, want.foldKey, want.space, want.white]);
  });

  test("UTF-8 sequences decode as in Go", () => {
    const edge = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xf0, 0xf4, 0xff];
    function* seqSet(set: string): Generator<ByteString> {
      const s = String.fromCharCode;
      if (set === "one") for (let a = 0; a < 256; a++) yield s(a);
      else if (set.startsWith("two-")) {
        const a = parseInt(set.slice(4), 16);
        for (let x = a; x < a + 16; x++) for (let y = 0; y < 256; y++) yield s(x, y);
      } else if (set === "three") {
        for (let a = 0xe0; a <= 0xef; a++) for (const x of edge) for (const y of edge) yield s(a, x, y);
      } else throw new Error("unknown set " + set);
    }
    const got: Record<string, number> = {};
    const want: Record<string, number> = {};
    for (const v of of("seq")) {
      if (small && v.set !== "one") continue;
      let sum = 2166136261;
      for (const s of seqSet(v.set)) {
        const [r, size] = decodeRune(s, 0);
        const [lr, lsize] = decodeLastRune(s, 0, s.length);
        for (const x of [r, size, lr, lsize, runeCount(s), validString(s) ? 1 : 0, utf16Len(s)]) {
          sum = Math.imul(sum ^ x, 16777619);
        }
      }
      got[v.set] = sum >>> 0;
      want[v.set] = v.sum32;
    }
    expect(got).toEqual(want);
  });

  test("texts: line starts, trivia, trims", () => {
    const bad: string[] = [];
    for (const v of of("text")) {
      const s = b(v.s);
      const id = hex(s).slice(0, 40);
      const starts = computeECMALineStarts(s);
      if (JSON.stringify(starts) !== JSON.stringify(v.ls)) bad.push("line starts " + id);
      if (hex(trimRightSpace(s)) !== hex(b(v.trimRight))) bad.push("trim right " + id);
      if (hex(replaceNonWhitespace(s)) !== hex(b(v.blank))) bad.push("blank " + id);
      for (let p = 0; p <= s.length; p++) {
        if (skipTrivia(s, p) !== v.skip[p]) bad.push(`trivia ${id} at ${p}`);
        const line = computeLineOfPosition(starts, p);
        if (line !== v.lc[p][0] || utf16Len(s.slice(starts[line], p)) !== v.lc[p][1])
          bad.push(`line and character ${id} at ${p}`);
      }
      if (v.valid) {
        const text = byteStringToUtf8(s);
        if (hex(utf8ToByteString(trimSpace(text))) !== hex(b(v.trimSpace))) bad.push("trim " + id);
        if (hex(utf8ToByteString(toLower(text))) !== hex(b(v.toLower))) bad.push("lower " + id);
        if (hex(utf8ToByteString(tspath.toFileNameLowerCase(text))) !== hex(b(v.toFileNameLowerCase)))
          bad.push("file name lower " + id);
      } else {
        expect(() => byteStringToUtf8(s)).toThrow(InvalidUtf8Error);
      }
    }
    expect(bad).toEqual([]);
  });

  test("pairs: fold and order", () => {
    const bad: string[] = [];
    for (const v of of("pair")) {
      const x = d(v.a);
      const y = d(v.b);
      if (equalFold(x, y) !== v.equalFold) bad.push(`fold ${x} ${y}`);
      if (compareStrings(x, y) !== v.compare) bad.push(`order ${x} ${y}`);
      if (compareStringsCaseInsensitive(x, y) !== v.compareCaseInsensitive) bad.push(`order without case ${x} ${y}`);
    }
    expect(bad).toEqual([]);
  });

  test("paths", () => {
    const bad: string[] = [];
    for (const v of of("path")) {
      const name = d(v.name);
      const dir = d(v.dir);
      const id = JSON.stringify([name, dir]);
      const insensitive = { useCaseSensitiveFileNames: false, currentDirectory: "" };
      if (tspath.getNormalizedAbsolutePath(name, dir) !== d(v.getNormalizedAbsolutePath)) bad.push("absolute " + id);
      if (tspath.normalizePath(name) !== d(v.normalizePath)) bad.push("normalize " + id);
      if (tspath.combinePaths(dir, name) !== d(v.combinePaths)) bad.push("combine " + id);
      if (tspath.getBaseFileName(name) !== d(v.getBaseFileName)) bad.push("base name " + id);
      if (tspath.getDirectoryPath(name) !== d(v.getDirectoryPath)) bad.push("directory " + id);
      if (tspath.getRootLength(b(v.name)) !== v.getRootLength) bad.push("root length " + id);
      if (tspath.toPath(name, dir, false) !== d(v.toPathCaseInsensitive)) bad.push("path " + id);
      if (tspath.comparePaths(name, dir, insensitive) !== v.comparePathsCaseInsensitive) bad.push("compare " + id);
      if (tspath.containsPath(dir, name, insensitive) !== v.containsPathCaseInsensitive) bad.push("contains " + id);
      if (
        tspath.convertToRelativePath(name, { useCaseSensitiveFileNames: false, currentDirectory: dir }) !==
        d(v.convertToRelativePathCaseInsensitive)
      )
        bad.push("relative " + id);
      if (tspath.changeExtension(name, ".ts") !== d(v.changeExtensionTs)) bad.push("extension " + id);
    }
    for (const v of of("ext")) {
      const list: string[] = v.extensions.map(d);
      const id = JSON.stringify([d(v.name), list, v.ignoreCase]);
      if (tspath.getAnyExtensionFromPath(d(v.name), list, v.ignoreCase) !== d(v.getAnyExtensionFromPath))
        bad.push("any extension " + id);
      if (tspath.changeAnyExtension(d(v.name), ".x", list, v.ignoreCase) !== d(v.changeAnyExtension))
        bad.push("change extension " + id);
    }
    expect(bad).toEqual([]);
  });

  test("files decode as the reference reads them, and bytes that are no UTF-8 throw", () => {
    for (const v of of("decode")) {
      const bytes = Buffer.from(v.bytes, "base64");
      const contents = bytes.length === 0 ? bytes : Buffer.from(decodeBytes(bytes));
      expect(contents.toString("hex")).toBe(hex(b(v.contents)));
      if (v.valid) expect(hex(utf8ToByteString(utf8String(contents)))).toBe(hex(b(v.contents)));
      else expect(() => utf8String(contents)).toThrow(InvalidUtf8Error);
    }
    expect(() => utf8ToByteString("a\ud800")).toThrow(InvalidUtf8Error);
  });

  test("strconv.Atoi, slices.Sorted and the padding of fmt", () => {
    for (const v of of("atoi")) expect(atoi(b(v.s))).toBe(v.ok ? v.n : undefined);
    const sorted: string[] = of("sorted")[0].sorted.map(d);
    expect(sortedStrings([...sorted].reverse())).toEqual(sorted);
    const pad = of("pad")[0];
    expect([padLeft("ab", 5), padLeft("abc", 1), padLeft("42", 4), padLeft("", 0)]).toEqual([
      pad.a,
      pad.b,
      pad.c,
      pad.d,
    ]);
  });
});
