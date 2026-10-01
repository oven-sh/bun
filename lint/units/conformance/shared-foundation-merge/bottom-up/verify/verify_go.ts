// The merged bottom layer against the results of Go (groundtruth/main.go): every table in full, every vector.
// usage: bun verify_go.ts <vectors.jsonl or vectors.jsonl.gz>      exit code 1 when a check differs
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { computeECMALineStarts, utf16Len } from "../runner/core";
import * as go from "../runner/gostrings";
import { computeLineOfPosition, skipTrivia } from "../runner/scanner";
import * as su from "../runner/stringutil";
import { utf8Model } from "../runner/text_model";
import * as tp from "../runner/tspath";
import { decodeBytes } from "../runner/vfs";
import * as RE2 from "./re2";

const path = process.argv[2] ?? import.meta.dir + "/../vectors/go-vectors.jsonl.gz";
const raw = readFileSync(path);
const sections = new Map<string, any>();
for (const line of (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n")) {
  if (line !== "") {
    const v = JSON.parse(line);
    sections.set(v.s, v);
  }
}
const sec = (name: string) => {
  const v = sections.get(name);
  if (v === undefined) throw new Error("no section " + name);
  return v;
};

const counts = new Map<string, { checks: number; bad: number }>();
const shown: string[] = [];
function check(what: string, got: unknown, want: unknown, detail: () => string): void {
  let c = counts.get(what);
  if (c === undefined) counts.set(what, (c = { checks: 0, bad: 0 }));
  c.checks++;
  const same = typeof got === "object" ? JSON.stringify(got) === JSON.stringify(want) : got === want;
  if (!same) {
    c.bad++;
    if (shown.length < 40) shown.push(`${what}: ${detail()} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
const hex = (r: number) => "U+" + r.toString(16).toUpperCase().padStart(4, "0");
const bytesOf = (h: string): go.ByteString => Buffer.from(h, "hex").toString("latin1");
const hexOf = (s: go.ByteString) => Buffer.from(s, "latin1").toString("hex");
const isScalar = (r: number) => r < 0xd800 || r > 0xdfff;
function mapOf(pairs: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < pairs.length; i += 2) m.set(pairs[i], pairs[i + 1]);
  return m;
}

const meta = sec("meta");
console.log(`ground truth: ${meta.go}, Unicode ${meta.unicode}; runtime: bun ${process.versions.bun}, Unicode ${process.versions.unicode}`);

// Tables, every rune.
{
  const lower = mapOf(sec("tolower").pairs);
  const fold = mapOf(sec("simplefold").pairs);
  const fileLower = mapOf(sec("filenamelower").pairs);
  const space = new Set<number>(sec("isspace").runes);
  const wssl = new Set<number>(sec("wssl").runes);
  const lb = new Set<number>(sec("linebreak").runes);
  const key = new Map<number, number>();
  for (const r of fold.keys()) {
    let min = r;
    for (let x = fold.get(r)!; x !== r; x = fold.get(x)!) if (x < min) min = x;
    key.set(r, min);
  }
  for (let r = 0; r <= 0x10ffff; r++) {
    const wantLower = lower.get(r) ?? r;
    check("unicode.ToLower, every rune", go.unicodeToLower(r), wantLower, () => hex(r));
    check("unicode.SimpleFold orbit key, every rune", go.foldKey(r), key.get(r) ?? r, () => hex(r));
    check("unicode.IsSpace, every rune", go.isSpace(r), space.has(r), () => hex(r));
    check("stringutil.IsWhiteSpaceSingleLine, every rune", su.isWhiteSpaceSingleLine(r), wssl.has(r), () => hex(r));
    check("stringutil.IsLineBreak, every rune", su.isLineBreak(r), lb.has(r), () => hex(r));
    check("stringutil.IsWhiteSpaceLike, every rune", su.isWhiteSpaceLike(r), wssl.has(r) || lb.has(r), () => hex(r));
    if (!isScalar(r)) continue;
    const s = String.fromCodePoint(r);
    check("strings.ToLower, every scalar value", go.toLower(s), String.fromCodePoint(wantLower), () => hex(r));
    check("strings.ToLower behind a letter that is not ASCII", go.toLower("\u00e9" + s), "\u00e9" + String.fromCodePoint(wantLower), () => hex(r));
    const wantFile = String.fromCodePoint(fileLower.get(r) ?? r);
    check("tspath.ToFileNameLowerCase, every scalar value", tp.toFileNameLowerCase("\u00e9" + s), "\u00e9" + wantFile, () => hex(r));
    if (r < 0x80) check("tspath.ToFileNameLowerCase, ASCII path", tp.toFileNameLowerCase(s), String.fromCodePoint(wantLower), () => hex(r));
  }
  // Every ordered pair of an orbit folds; a rune and the rune after the largest of its orbit do not.
  let orbits = 0;
  const seen = new Set<number>();
  for (const r of fold.keys()) {
    if (seen.has(r)) continue;
    const orbit = [r];
    for (let x = fold.get(r)!; x !== r; x = fold.get(x)!) orbit.push(x);
    for (const x of orbit) seen.add(x);
    orbits++;
    for (const a of orbit) {
      for (const b of orbit) {
        check("strings.EqualFold, every ordered pair of every orbit", go.equalFold(String.fromCodePoint(a), String.fromCodePoint(b)), true, () => hex(a) + " " + hex(b));
      }
      const outside = Math.max(...orbit) + 1;
      if (isScalar(outside) && !orbit.includes(outside)) {
        check("strings.EqualFold, a rune outside the orbit", go.equalFold(String.fromCodePoint(a), String.fromCodePoint(outside)), false, () => hex(a) + " " + hex(outside));
      }
    }
  }
  console.log(`tables: ${lower.size} lower case entries, ${fold.size} fold entries in ${orbits} orbits, ${space.size} spaces`);
  check("strings.ToLower is unicode.ToLower rune by rune in Go", sec("strtolower").runesWhereStringsToLowerIsNotUnicodeToLower, 0, () => "");
}

// String pairs.
for (const [a, b, fold, ci, cs] of sec("pairs").cases as [string, string, boolean, number, number][]) {
  const d = () => JSON.stringify([a, b]);
  check("strings.EqualFold, pairs", go.equalFold(a, b), fold, d);
  check("stringutil.CompareStringsCaseInsensitive, pairs", su.compareStringsCaseInsensitive(a, b), ci, d);
  check("strings.Compare, pairs", go.compareStrings(a, b), cs, d);
  check("strings.Compare, pairs as byte strings", go.compareStrings(go.utf8ToByteString(a), go.utf8ToByteString(b)), cs, d);
  check("Buffer.compare of the UTF-8 forms is strings.Compare", Math.sign(Buffer.compare(Buffer.from(a), Buffer.from(b))), cs, d);
}
for (const [s, trimSpace, trimRight, lower, fileLower, trimSuffix, trimFunc] of sec("strings").cases as string[][]) {
  const d = () => JSON.stringify(s);
  check("strings.TrimSpace", go.trimSpace(s), trimSpace, d);
  check("strings.TrimRightFunc(IsSpace) on a byte string", go.byteStringToUtf8(go.trimRightSpace(go.utf8ToByteString(s))), trimRight, d);
  check("strings.ToLower, strings", go.toLower(s), lower, d);
  check("tspath.ToFileNameLowerCase, strings", tp.toFileNameLowerCase(s), fileLower, d);
  check("strings.TrimSuffix", go.trimSuffix(go.trimSpace(s), ";"), trimSuffix, d);
  check("strings.TrimFunc(IsWhiteSpaceLike)", go.trimFunc(s, su.isWhiteSpaceLike), trimFunc, d);
}

// utf8.DecodeRuneInString and utf8.DecodeLastRuneInString on every string of a class of byte strings.
function decodeClass(name: string, tails: number[][]): void {
  const flat = sec(name).flat as number[];
  let at = 0;
  const rec = (bytes: number[], k: number) => {
    if (k === tails.length) {
      const s = String.fromCharCode(...bytes);
      check(`utf8.DecodeRuneInString, ${name}`, go.decodeRune(s, 0), [flat[at], flat[at + 1]], () => hexOf(s));
      check(`utf8.DecodeLastRuneInString, ${name}`, go.decodeLastRune(s, 0, s.length), [flat[at + 2], flat[at + 3]], () => hexOf(s));
      at += 4;
      return;
    }
    for (const b of tails[k]) rec([...bytes, b], k + 1);
  };
  rec([], 0);
  check(`${name}: all results used`, at, flat.length, () => "");
}
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
decodeClass("utf8-1", [range(0, 255)]);
decodeClass("utf8-2", [range(0, 255), range(0, 255)]);
decodeClass("utf8-3", [range(0xe0, 0xef), range(0, 255), [0x00, 0x7f, 0x80, 0xbf, 0xc0, 0xff]]);
decodeClass("utf8-4", [range(0xf0, 0xf7), range(0, 255), [0x7f, 0x80, 0xbf, 0xc0], [0x7f, 0x80, 0xbf, 0xc0]]);

// Byte strings, valid and not.
for (const c of sec("bytes").cases as any[]) {
  const s = bytesOf(c.in);
  const d = () => c.in;
  check("utf8.RuneCountInString", go.runeCount(s), c.runeCount, d);
  check("core.UTF16Len", utf16Len(s), c.utf16Len, d);
  check("core.ComputeECMALineStarts", computeECMALineStarts(s), c.lineStarts, d);
  check("regexp \\S to one space", hexOf(go.replaceNonWhitespace(s)), c.blank, d);
  check("strings.TrimRightFunc(IsSpace), byte strings", hexOf(go.trimRightSpace(s)), c.trimRight, d);
  check("lineDelimiter.Split", utf8Model.contentLines(s).map(hexOf), c.lineDelimiterSplit, d);
  let valid = true;
  let text = "";
  try {
    text = go.byteStringToUtf8(s);
  } catch (e) {
    valid = false;
    check("the conversion throws InvalidUtf8Error", e instanceof go.InvalidUtf8Error, true, d);
  }
  check("utf8.ValidString is: the conversion does not throw", valid, c.valid, d);
  if (valid) {
    check("the conversion gives the bytes back", hexOf(go.utf8ToByteString(text)), c.in, d);
    check("strings.TrimSpace, valid byte strings", Buffer.from(go.trimSpace(text), "utf8").toString("hex"), c.trimSpace, d);
    check("utf16Len is the length of the JavaScript string", text.length, c.utf16Len, d);
  }
  const first: number[] = [];
  const last: number[] = [];
  for (let i = 0; i <= s.length; i++) {
    first.push(...go.decodeRune(s, i));
    last.push(...go.decodeLastRune(s, 0, i));
  }
  check("utf8.DecodeRuneInString at every offset", first, c.first, d);
  check("utf8.DecodeLastRuneInString before every offset", last, c.last, d);
}

// scanner.SkipTrivia from every position.
for (const c of sec("skiptrivia").cases as any[]) {
  const s = bytesOf(c.in);
  const got: number[] = [];
  for (let pos = c.from; pos <= s.length + 1; pos++) got.push(skipTrivia(s, pos));
  check("scanner.SkipTrivia from every position", got, c.results, () => c.in);
}

// Line maps and positions.
for (const c of sec("lines").cases as any[]) {
  const s = bytesOf(c.in);
  const d = () => c.in;
  const starts = computeECMALineStarts(s);
  check("core.ComputeECMALineStarts, line cases", starts, c.lineStarts, d);
  const lineOf: number[] = [];
  for (let pos = -2; pos <= s.length + 2; pos++) lineOf.push(computeLineOfPosition(starts, pos));
  check("scanner.ComputeLineOfPosition from -2", lineOf, c.lineOfFromMinus2, d);
  const lineAndChar: number[] = [];
  for (let pos = 0; pos <= s.length; pos++) {
    const line = computeLineOfPosition(starts, pos);
    lineAndChar.push(line, utf8Model.utf16Length(s, starts[line], pos));
  }
  check("scanner.GetECMALineAndUTF16CharacterOfPosition", lineAndChar, c.lineAndUTF16Character, d);
  // advanceUTF16 is the strict inverse: it answers where Go gives a position whose count of code units is exact.
  let at = 0;
  for (let line = -1; line <= starts.length; line++) {
    for (let ch = 0; ch <= 12; ch++) {
      const want = c.positionOfLineFromMinus1Char0To12[at++];
      if (line < 0 || line >= starts.length) {
        check("scanner.ComputePositionOfLineAndUTF16Character panics on a bad line", typeof want === "object", true, d);
        continue;
      }
      const lineEnd = line + 1 < starts.length ? starts[line + 1] : s.length;
      const got = utf8Model.advanceUTF16(s, starts[line], ch, lineEnd);
      const exact = typeof want === "number" && utf16Len(s.slice(starts[line], want)) === ch;
      check("advanceUTF16 against scanner.ComputePositionOfLineAndUTF16Character", got, exact ? want : undefined, () => `${c.in} line ${line} character ${ch} go ${JSON.stringify(want)}`);
    }
  }
}

// decodeBytes of the file system.
for (const [input, output, ok] of sec("decodeBytes").cases as [string, string, boolean][]) {
  check("vfs decodeBytes", Buffer.from(decodeBytes(Buffer.from(input, "hex"))).toString("hex"), output, () => input);
  check("vfs decodeBytes is always ok", ok, true, () => input);
}

// tspath on names with letters that are not ASCII. Lengths of Go are bytes.
{
  const exts = [".TS", ".d.ts", "json"];
  const byteLen = (a: string, n: number) => (n < 0 ? ~Buffer.byteLength(a.slice(0, ~n)) : Buffer.byteLength(a.slice(0, n)));
  const one: Record<string, (a: string) => unknown> = {
    "pathIsAbsolute": a => tp.pathIsAbsolute(a),
    "isRootedDiskPath": a => tp.isRootedDiskPath(a),
    "getRootLength": a => byteLen(a, tp.getRootLength(a)),
    "getEncodedRootLength": a => byteLen(a, tp.getEncodedRootLength(a)),
    "toFileNameLowerCase": a => tp.toFileNameLowerCase(a),
    "getCanonicalFileName(false)": a => tp.getCanonicalFileName(a, false),
    "getCanonicalFileName(true)": a => tp.getCanonicalFileName(a, true),
    "hasExtension": a => tp.hasExtension(a),
    "getAnyExtensionFromPath": a => tp.getAnyExtensionFromPath(a, undefined, false),
    "getAnyExtensionFromPathEx(exts,false)": a => tp.getAnyExtensionFromPath(a, exts, false),
    "getAnyExtensionFromPathEx(exts,true)": a => tp.getAnyExtensionFromPath(a, exts, true),
    "getBaseFileName": a => tp.getBaseFileName(a),
    "getDirectoryPath": a => tp.getDirectoryPath(a),
    "normalizePath": a => tp.normalizePath(a),
    "normalizeSlashes": a => tp.normalizeSlashes(a),
    "removeTrailingDirectorySeparator": a => tp.removeTrailingDirectorySeparator(a),
    "ensureTrailingDirectorySeparator": a => tp.ensureTrailingDirectorySeparator(a),
    "removeTrailingDirectorySeparators": a => tp.removeTrailingDirectorySeparators(a),
    "hasTrailingDirectorySeparator": a => tp.hasTrailingDirectorySeparator(a),
    "changeExtension(.js)": a => tp.changeExtension(a, ".js"),
    "changeAnyExtension(x,exts,true)": a => tp.changeAnyExtension(a, "x", exts, true),
    "fileExtensionIs(.ts)": a => tp.fileExtensionIs(a, ".ts"),
    "fileExtensionIsOneOf": a => tp.fileExtensionIsOneOf(a, [".d.ts", ".json"]),
    "getPathComponents": a => tp.getPathComponents(a, ""),
    "getPathFromPathComponents": a => tp.getPathFromPathComponents(tp.getPathComponents(a, "")),
    "reducePathComponents": a => tp.reducePathComponents(tp.getPathComponents(a, "")),
    "getNormalizedPathComponents(/cur)": a => tp.getNormalizedPathComponents(a, "/cur"),
  };
  const p1 = sec("path1");
  const f1 = (p1.fields as string).split(" ");
  for (const row of p1.cases as unknown[][]) {
    const a = row[0] as string;
    for (let k = 1; k < f1.length; k++) {
      const f = one[f1[k]];
      if (f === undefined) throw new Error("no port of " + f1[k]);
      check("tspath." + f1[k], f(a), row[k], () => JSON.stringify(a));
      // The same function on the byte string of the name: equal for every function that does not fold case.
      if (!/LowerCase|Canonical|exts,true/.test(f1[k])) {
        const bytes = go.utf8ToByteString(a);
        const back = (x: unknown): unknown =>
          typeof x === "string" ? go.byteStringToUtf8(x) : Array.isArray(x) ? x.map(back) : x;
        // On a byte string a length is the length of Go: no conversion.
        const got = f1[k] === "getRootLength" ? tp.getRootLength(bytes) : f1[k] === "getEncodedRootLength" ? tp.getEncodedRootLength(bytes) : back(f(bytes));
        check("tspath." + f1[k] + " on a byte string", got, row[k], () => JSON.stringify(a));
      }
    }
  }
  const two: Record<string, (a: string, b: string) => unknown> = {
    "comparePaths(cs)": (a, b) => Math.sign(tp.comparePaths(a, b, { useCaseSensitiveFileNames: true, currentDirectory: "" })),
    "comparePaths(ci)": (a, b) => Math.sign(tp.comparePaths(a, b, { useCaseSensitiveFileNames: false, currentDirectory: "" })),
    "comparePaths(cs,/cur)": (a, b) => Math.sign(tp.comparePaths(a, b, { useCaseSensitiveFileNames: true, currentDirectory: "/cur" })),
    "containsPath(cs)": (a, b) => tp.containsPath(a, b, { useCaseSensitiveFileNames: true, currentDirectory: "" }),
    "containsPath(ci)": (a, b) => tp.containsPath(a, b, { useCaseSensitiveFileNames: false, currentDirectory: "" }),
    "convertToRelativePath(a,{cwd:b,cs})": (a, b) => tp.convertToRelativePath(a, { useCaseSensitiveFileNames: true, currentDirectory: b }),
    "convertToRelativePath(a,{cwd:b,ci})": (a, b) => tp.convertToRelativePath(a, { useCaseSensitiveFileNames: false, currentDirectory: b }),
    "combinePaths": (a, b) => tp.combinePaths(a, b),
    "getNormalizedAbsolutePath": (a, b) => tp.getNormalizedAbsolutePath(a, b),
    "toPath(true)": (a, b) => tp.toPath(a, b, true),
    "toPath(false)": (a, b) => tp.toPath(a, b, false),
    "getPathComponentsRelativeTo(ci)": (a, b) => tp.getPathComponentsRelativeTo(a, b, { useCaseSensitiveFileNames: false, currentDirectory: "" }),
    "getPathComponents": (a, b) => tp.getPathComponents(a, b),
  };
  const undecoded = { pairs: 0, ci: 0, cs: 0, ciEquality: 0 };
  const p2 = sec("path2");
  const f2 = (p2.fields as string).split(" ");
  for (const row of p2.cases as unknown[][]) {
    const a = row[0] as string;
    const b = row[1] as string;
    for (let k = 2; k < f2.length; k++) {
      const f = two[f2[k]];
      if (f === undefined) throw new Error("no port of " + f2[k]);
      check("tspath." + f2[k], f(a, b), row[k], () => JSON.stringify([a, b]));
    }
    // Byte strings in place of JavaScript strings: exact for ASCII names, and not for every name, which is why the baseline modules decode first.
    const ba = go.utf8ToByteString(a);
    const bb = go.utf8ToByteString(b);
    const ci = Math.sign(tp.comparePaths(ba, bb, { useCaseSensitiveFileNames: false, currentDirectory: "" }));
    const cs = Math.sign(tp.comparePaths(ba, bb, { useCaseSensitiveFileNames: true, currentDirectory: "" }));
    if (ba === a && bb === b) {
      check("tspath.comparePaths(ci) on ASCII byte strings", ci, row[3], () => JSON.stringify([a, b]));
      check("tspath.comparePaths(cs) on ASCII byte strings", cs, row[2], () => JSON.stringify([a, b]));
    } else {
      undecoded.pairs++;
      if (ci !== row[3]) undecoded.ci++;
      if (cs !== row[2]) undecoded.cs++;
      if ((ci === 0) !== (row[3] === 0)) undecoded.ciEquality++;
    }
  }
  console.log(`comparePaths on byte strings that are not decoded, ${undecoded.pairs} pairs with a name that is not ASCII: the sign differs from Go in ${undecoded.ci} (case folded) and ${undecoded.cs} (case kept), the test for 0 differs in ${undecoded.ciEquality}`);
}

// The classes and anchors of Go's regexp, written in the syntax of JavaScript: regex_sites.ts holds the places of the runner to them.
{
  const c = sec("re2classes");
  const cls: [string, string, number[], boolean][] = [
    ["\\s", RE2.SPACE, c.space, true],
    ["\\S", RE2.NOT_SPACE, c.not_S, false],
    ["\\w", RE2.WORD, c.w, true],
    ["\\d", RE2.DIGIT, c.d, true],
    [".", RE2.DOT, c.not_dot, false],
  ];
  for (const [name, source, runes, positive] of cls) {
    const set = new Set(runes);
    const re = new RegExp("^" + source + "$", "u");
    const plain = new RegExp("^" + source + "$");
    for (let r = 0; r <= 0x10ffff; r++) {
      if (!isScalar(r)) continue;
      const s = String.fromCodePoint(r);
      check(`regexp ${name} is ${source} (flag u), every scalar value`, re.test(s), set.has(r) === positive, () => hex(r));
      if (r <= 0xffff) check(`regexp ${name} is ${source} (no flag), every code unit`, plain.test(s), set.has(r) === positive, () => hex(r));
      if (r <= 0xff) check(`regexp ${name} is ${source} on one byte of a byte string`, plain.test(s), set.has(r) === positive || (r >= 0x80 && !positive), () => hex(r));
    }
  }
  const a = sec("re2anchors");
  const text = go.utf8ToByteString(a.text);
  const at = (source: string) => [...text.matchAll(new RegExp(source, "g"))].map(m => m.index);
  check("regexp (?m)^ is RE2.LINE_START", at(RE2.LINE_START), a.mstart, () => "");
  check("regexp (?m)$ is RE2.LINE_END", at(RE2.LINE_END), a.mend, () => "");
  check("regexp ^ without a flag is the start of the text", at("^"), a.start, () => "");
  check("regexp $ without a flag is the end of the text", at("$"), a.end, () => "");
  // Under (?i) a letter matches the runes of its orbit under unicode.SimpleFold: s has U+017F, k has U+212A, the others two runes.
  const orbit = (letters: string, extra: number[] = []) => [...new Set([...letters.toLowerCase(), ...letters.toUpperCase()].map(x => x.codePointAt(0)!)), ...extra].sort((x, y) => x - y);
  check("regexp (?i)s", c.is, orbit("s", [0x17f]), () => "");
  check("regexp (?i)k", c.ik, orbit("k", [0x212a]), () => "");
  check("regexp (?i)i", c.ii, orbit("i"), () => "");
  check("regexp (?i)[libdt]", c.ilibdt, orbit("libdt"), () => "");
  const option = new RegExp(RE2.optionRegexText, "g");
  const link = new RegExp(RE2.LINE_START + RE2.linkRegexLine.slice(1));
  const references = new RegExp(RE2.referencesRegex);
  const compilerBaseline = /\.tsx?$/;
  for (const [line, optionWant, linkWant, referencesWant, baselineWant] of sec("regexps").cases as [string, string[][] | null, string[] | null, boolean, boolean][]) {
    const d = () => JSON.stringify(line);
    check("optionRegex.FindAllStringSubmatch", [...line.matchAll(option)].map(m => [...m]), optionWant ?? [], d);
    const l = link.exec(line);
    check("linkRegex.FindStringSubmatch", l === null ? null : [...l], linkWant, d);
    check("referencesRegex.MatchString", references.test(line), referencesWant, d);
    check("compilerBaselineRegex.MatchString", compilerBaseline.test(line), baselineWant, d);
  }
}

// error_baseline.go:31 and :32 on byte strings, texts that are not UTF-8 among them.
{
  const prefix = new RegExp(RE2.diagnosticsLocationPrefixGo, "g");
  const pattern = new RegExp(RE2.diagnosticsLocationPatternGo, "g");
  for (const [input, prefixWant, patternWant] of sec("libLocation").cases as string[][]) {
    const s = bytesOf(input);
    check("diagnosticsLocationPrefix.ReplaceAllString", hexOf(s.replace(prefix, "$1(--,--)")), prefixWant, () => input);
    check("diagnosticsLocationPattern.ReplaceAllString", hexOf(s.replace(pattern, "$1:--:--")), patternWant, () => input);
  }
}

// strconv.Atoi: the value as Go prints it, read back as a number.
check("strconv.IntSize", sec("atoi").int, 64, () => "");
for (const [input, value, ok] of sec("atoi").cases as [string, string, boolean][]) {
  check("strconv.Atoi", go.atoi(input), ok ? Number(value) : undefined, () => JSON.stringify(input));
}

let total = 0;
let bad = 0;
for (const [what, c] of counts) {
  total += c.checks;
  bad += c.bad;
  console.log(`${c.bad === 0 ? "ok  " : "FAIL"} ${String(c.checks).padStart(8)} ${what}${c.bad === 0 ? "" : "  (" + c.bad + " differ)"}`);
}
for (const s of shown) console.log("  " + s.slice(0, 400));
console.log(`checks ${total}, differences ${bad}`);
process.exit(bad === 0 ? 0 : 1);
