// Builds a copy of the prototypes of the unit in which every old copy of the bottom layer is a shim over ../runner.
// The upper prototypes stay as they are but for the patches listed below, so their verifiers run against the merged set.
// usage: bun build.ts <directory of the notes of the unit> <output directory> [--no-patches | --without=<group of patches>]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const [notes, out, flag] = process.argv.slice(2);
const withPatches = flag !== "--no-patches";
// --without=<group> leaves one group of patches out: rename, decode-paths, go-case, go-atoi, compare-once.
const without = flag?.startsWith("--without=") ? flag.slice("--without=".length) : undefined;
const merged = join(import.meta.dir, "..", "runner");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(notes)) {
  if (entry === "shared-foundation-merge" || entry.startsWith(".")) continue;
  cpSync(join(notes, entry), join(out, entry), { recursive: true });
}
cpSync(merged, join(out, "_merged"), { recursive: true });

// Import specifier of a module of the merged set, from a file of the copy.
const m = (file: string, module: string) => {
  const r = relative(dirname(join(out, file)), join(out, "_merged", module));
  return r.startsWith(".") ? r : "./" + r;
};
const written: string[] = [];
function shim(files: string[], body: (file: string) => string): void {
  for (const file of files) {
    if (!existsSync(join(out, file))) throw new Error("no file to replace: " + file);
    writeFileSync(join(out, file), "// Shim: the old names of this module over the merged bottom layer.\n" + body(file));
    written.push(file);
  }
}

const families = ["enumerator/prototype", "enumerator-topdown/prototype/dg", "instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"];

// stringutil.ts of the enumerator family: the rune tests of upstream and three functions of Go.
shim(families.map(f => f + "/stringutil.ts"), f => `export { isLineBreak, isWhiteSpaceLike, isWhiteSpaceSingleLine } from "${m(f, "stringutil")}";
export { isSpace as isGoSpace, toLower, trimSpace, trimSuffix } from "${m(f, "gostrings")}";
`);

// scanner.ts of the enumerator family took the bytes as a Uint8Array.
const scannerOnBytes = (f: string) => `import { decodeLastRune as last, decodeRune as first, toByteString } from "${m(f, "gostrings")}";
import { skipTrivia as skip } from "${m(f, "scanner")}";
export function decodeRune(text: Uint8Array, pos: number, end: number = text.length): [number, number] {
  return first(toByteString(text), pos, end);
}
export function decodeLastRune(text: Uint8Array, end: number): [number, number] {
  return last(toByteString(text), 0, end);
}
export function skipTrivia(text: Uint8Array, pos: number): number {
  return skip(toByteString(text), pos);
}
`;
shim(families.map(f => f + "/scanner.ts"), scannerOnBytes);
shim(["directive-grammar/prototype/scanner.ts"], f => `import { toByteString } from "${m(f, "gostrings")}";
import { skipTrivia as skip } from "${m(f, "scanner")}";
export function skipTrivia(text: Uint8Array, pos: number): number {
  return skip(toByteString(text), pos);
}
`);
shim(["directive-grammar/prototype/go_utf8.ts"], f => `import { decodeLastRune as last, decodeRune as first, toByteString } from "${m(f, "gostrings")}";
export function decodeRune(text: Uint8Array, pos: number, end: number = text.length): [number, number] {
  return first(toByteString(text), pos, end);
}
export function decodeLastRune(text: Uint8Array, end: number): [number, number] {
  return last(toByteString(text), 0, end);
}
`);
shim(["directive-grammar/prototype/go_strings.ts"], f => `export { isSpace, toLower, trimSpace, trimSuffix } from "${m(f, "gostrings")}";
`);
shim(["directive-grammar/prototype/stringutil.ts"], f => `export { isLineBreak, isWhiteSpaceLike, isWhiteSpaceSingleLine } from "${m(f, "stringutil")}";
`);

// tspath.ts: the three selections of the second wave. toPath and getAnyExtensionFromPath had the short forms.
const tspathShort = (f: string) => `import * as t from "${m(f, "tspath")}";
export {
  combinePaths,
  ensureTrailingDirectorySeparator,
  getBaseFileName,
  getDirectoryPath,
  getEncodedRootLength,
  getNormalizedAbsolutePath,
  getRootLength,
  hasTrailingDirectorySeparator,
  isRootedDiskPath,
  isVolumeCharacter,
  normalizePath,
  normalizeSlashes,
  removeTrailingDirectorySeparator,
  removeTrailingDirectorySeparators,
} from "${m(f, "tspath")}";
export const toPath = (fileName: string, basePath: string): string => t.toPath(fileName, basePath, true);
export const getAnyExtensionFromPath = (path: string): string => t.getAnyExtensionFromPath(path, undefined, false);
`;
shim(
  [
    "enumerator/prototype/tspath.ts",
    "enumerator-topdown/prototype/tspath.ts",
    "enumerator-topdown/prototype/dg/tspath.ts",
    "instance-materialisation/prototype/tspath.ts",
    "instance-materialisation/bottom-up/prototype/tspath.ts",
    "directive-grammar/prototype/tspath.ts",
  ],
  tspathShort,
);

// tspath_more.ts of the materialisation prototype.
shim(["instance-materialisation/prototype/tspath_more.ts", "instance-materialisation/bottom-up/prototype/tspath_more.ts"], f => `export {
  AllSupportedExtensions,
  AllSupportedExtensionsWithJson,
  ExtensionCjs,
  ExtensionCts,
  ExtensionDcts,
  ExtensionDmts,
  ExtensionDts,
  ExtensionJs,
  ExtensionJson,
  ExtensionJsx,
  ExtensionMjs,
  ExtensionMts,
  ExtensionTs,
  ExtensionTsBuildInfo,
  ExtensionTsx,
  SupportedTSExtensions,
  SupportedTSExtensionsWithJson,
  changeAnyExtension,
  changeExtension,
  containsPath,
  convertToRelativePath,
  fileExtensionIs,
  fileExtensionIsOneOf,
  getAnyExtensionFromPath as getAnyExtensionFromPathEx,
  getCanonicalFileName,
  getComparer,
  getNormalizedPathComponents,
  getPathComponents,
  getPathComponentsRelativeTo,
  getPathFromPathComponents,
  hasExtension,
  reducePathComponents,
  toFileNameLowerCase,
  toPath as toPathEx,
} from "${m(f, "tspath")}";
export type { ComparePathsOptions } from "${m(f, "tspath")}";
export { compareStringsCaseInsensitive, compareStringsCaseSensitive } from "${m(f, "stringutil")}";
export { equalFold } from "${m(f, "gostrings")}";
`);

// tspath_more.ts of the top-down pass: case sensitive forms with the current directory as a string.
shim(["instance-materialisation/top-down/prototype/tspath_more.ts"], f => `import * as t from "${m(f, "tspath")}";
import { compareStrings } from "${m(f, "gostrings")}";
export {
  ExtensionCjs,
  ExtensionCts,
  ExtensionDcts,
  ExtensionDmts,
  ExtensionDts,
  ExtensionJs,
  ExtensionJson,
  ExtensionJsx,
  ExtensionMjs,
  ExtensionMts,
  ExtensionTs,
  ExtensionTsBuildInfo,
  ExtensionTsx,
  changeExtension,
  fileExtensionIs,
  fileExtensionIsOneOf,
  getNormalizedPathComponents,
  getPathComponents,
  getPathFromPathComponents,
  hasExtension,
  reducePathComponents,
} from "${m(f, "tspath")}";
export const AllSupportedExtensions = t.AllSupportedExtensions as string[][];
export const SupportedTSExtensions = t.SupportedTSExtensions as string[][];
export const AllSupportedExtensionsWithJson = t.AllSupportedExtensionsWithJson as string[][];
export const SupportedTSExtensionsWithJson = t.SupportedTSExtensionsWithJson as string[][];
const sensitive = (currentDirectory: string) => ({ useCaseSensitiveFileNames: true, currentDirectory });
export const getAnyExtensionFromPathOf = (path: string, extensions: readonly string[]): string => t.getAnyExtensionFromPath(path, extensions, false);
export const containsPath = (parent: string, child: string, currentDirectory: string): boolean => t.containsPath(parent, child, sensitive(currentDirectory));
export const getPathComponentsRelativeTo = (from: string, to: string, currentDirectory: string): string[] => t.getPathComponentsRelativeTo(from, to, sensitive(currentDirectory));
export const convertToRelativePath = (path: string, currentDirectory: string): string => t.convertToRelativePath(path, sensitive(currentDirectory));
export const compareBytes = compareStrings;
`);

// The two readers of files. The merged reader throws on bytes that are not UTF-8; the old ones refused or replaced.
const readerWithFlags = (f: string) => `import { utf8String } from "${m(f, "gostrings")}";
import * as v from "${m(f, "vfs")}";
export interface ReadFileResult {
  contents: string;
  ok: boolean;
  lossy: boolean;
}
export function readFile(path: string): ReadFileResult {
  const r = v.readFile(path);
  return r.ok ? { contents: r.contents, ok: true, lossy: false } : { contents: "", ok: false, lossy: false };
}
export function decodeBytes(s: Uint8Array): ReadFileResult {
  return { contents: utf8String(v.decodeBytes(s)), ok: true, lossy: false };
}
export const decodeUtf16 = v.decodeUtf16;
`;
shim(
  [
    "enumerator/prototype/vfs.ts",
    "enumerator-topdown/prototype/dg/vfs.ts",
    "instance-materialisation/prototype/readfile.ts",
    "instance-materialisation/bottom-up/prototype/readfile.ts",
  ],
  readerWithFlags,
);
shim(["directive-grammar/prototype/vfs.ts"], f => `import { InvalidUtf8Error, utf8String } from "${m(f, "gostrings")}";
import * as v from "${m(f, "vfs")}";
import type { Result } from "./result";
export function readFile(path: string): Result<string> {
  try {
    const r = v.readFile(path);
    return r.ok ? { ok: true, value: r.contents } : { ok: false, reason: "cannot read " + path };
  } catch (e) {
    if (e instanceof InvalidUtf8Error) return { ok: false, reason: "not valid UTF-8" };
    throw e;
  }
}
export function decodeBytes(s: Uint8Array): Result<string> {
  try {
    return { ok: true, value: utf8String(v.decodeBytes(s)) };
  } catch (e) {
    if (e instanceof InvalidUtf8Error) return { ok: false, reason: "not valid UTF-8" };
    throw e;
  }
}
export const decodeUtf16 = v.decodeUtf16;
`);

// The file system in memory.
shim(["instance-materialisation/prototype/memfs.ts", "instance-materialisation/bottom-up/prototype/memfs.ts"], f => `export * from "${m(f, "vfstest")}";
`);

// The parser of the directive-grammar prototype over the one parser that the assembly keeps: only the shape of the result differs.
shim(["directive-grammar/prototype/test_case_parser.ts"], () => `import * as p from "../../instance-materialisation/prototype/test_case_parser";
import type { Result } from "./result";
export type { ParseFile, ParseTestFilesOptions, RawCompilerSettings, TestCaseContent, TestUnit } from "../../instance-materialisation/prototype/test_case_parser";
export const srcFolder = p.srcFolder;
export const extractCompilerSettings = p.extractCompilerSettings;
export const parseSymlinkFromTest = p.parseSymlinkFromTest;
export interface ParsedTestFiles<T> {
  units: T[];
  symlinks: Map<string, string>;
  currentDirectory: string;
  globalOptions: Map<string, string>;
  error: string | undefined;
}
export function makeUnitsFromTest(code: string, fileName: string): Result<p.TestCaseContent> {
  return p.makeUnitsFromTest(code, fileName);
}
export function parseTestFilesAndSymlinksWithOptions<T>(
  code: string,
  fileName: string,
  parseFile: p.ParseFile<T>,
  options: p.ParseTestFilesOptions,
): Result<ParsedTestFiles<T>> {
  const r = p.parseTestFilesAndSymlinksWithOptions(code, fileName, parseFile, options);
  if (!r.ok) return r;
  const { units, symlinks, currentDirectory, globalOptions, error } = r;
  return { ok: true, value: { units, symlinks, currentDirectory, globalOptions, error } };
}
export function parseTestFilesAndSymlinks<T>(code: string, fileName: string, parseFile: p.ParseFile<T>): Result<ParsedTestFiles<T>> {
  return parseTestFilesAndSymlinksWithOptions(code, fileName, parseFile, { allowImplicitFirstFile: false });
}
`);
shim(["directive-grammar/prototype/harnessutil.ts"], () => `export { getConfigNameFromFileName } from "../../instance-materialisation/prototype/test_case_parser";
`);

// The helpers of the error baseline prototypes, on byte strings.
const goCompat = (f: string) => `export {
  RuneError,
  byteStringToUtf8,
  compareStrings,
  decodeLastRune,
  decodeRune,
  fromByteString,
  isSpace,
  padLeft,
  replaceNonWhitespace,
  runeCount,
  toByteString,
  trimRightSpace,
  utf8ToByteString,
} from "${m(f, "gostrings")}";
export type { ByteString } from "${m(f, "gostrings")}";
export { utf16Len } from "${m(f, "core")}";
`;
shim(["error-baseline-format/prototype/go_compat.ts", "error-baseline-format/top-down/go_compat.ts"], goCompat);
const tspathOfBaselines = (f: string) => `export {
  combinePaths,
  comparePaths,
  convertToRelativePath,
  ensureTrailingDirectorySeparator,
  getBaseFileName,
  getEncodedRootLength,
  getPathComponents,
  getPathFromPathComponents,
  getRootLength,
  hasTrailingDirectorySeparator,
  isRootedDiskPath,
  isVolumeCharacter,
  normalizeSlashes,
  pathIsAbsolute,
  reducePathComponents,
  removeTrailingDirectorySeparator,
} from "${m(f, "tspath")}";
export type { ComparePathsOptions } from "${m(f, "tspath")}";
export { compareStringsCaseInsensitive, compareStringsCaseSensitive } from "${m(f, "stringutil")}";
`;
shim(["error-baseline-format/prototype/tspath.ts", "error-baseline-format/top-down/tspath.ts"], tspathOfBaselines);
shim(["error-baseline-format/top-down/text_model.ts"], f => `export { utf16Model, utf8Model } from "${m(f, "text_model")}";
export type { TextModel } from "${m(f, "text_model")}";
export { isSpace } from "${m(f, "gostrings")}";
`);

// Patches of upper modules: [file, old text, new text, times the old text occurs]. A patch that does not apply is an error.
type Patch = [file: string, oldText: string, newText: string, times: number];
const groups: [name: string, patches: Patch[]][] = [];
const group = (name: string, patches: Patch[]) => groups.push([name, patches]);
group("rename", [
  // The split of an input file into lines is not stringutil.SplitLines: it does not carry that name.
  ["error-baseline-format/top-down/error_baseline.ts", "model.splitLines(", "model.contentLines(", 1],
  ["error-baseline-format/top-down/reader.ts", "model.splitLines(", "model.contentLines(", 1],
  ["error-baseline-format/top-down/reader_fuzz.ts", "model.splitLines(", "model.contentLines(", 1],
  ["error-baseline-format/top-down/stats_spans.ts", "model.splitLines(", "model.contentLines(", 1],
]);
// The comparers of tspath fold runes, so a name of the model is decoded before it is compared.
group("decode-paths", [
  [
    "error-baseline-format/top-down/error_baseline.ts",
    `import { comparePaths, ensureTrailingDirectorySeparator, getBaseFileName } from "./tspath";\n`,
    `import { type ComparePathsOptions, comparePaths, ensureTrailingDirectorySeparator, getBaseFileName } from "./tspath";\n\n// tspath.ComparePaths on names of the model: its comparers fold runes, so the names are decoded first.\nexport function comparePathsOf(rules: Rules, a: string, b: string, options: ComparePathsOptions): number {\n  return comparePaths(rules.model.toString(a), rules.model.toString(b), options);\n}\n`,
    1,
  ],
  [
    "error-baseline-format/top-down/error_baseline.ts",
    "comparePaths(removeTestPathPrefixes(rules, e.file.fileName), removeTestPathPrefixes(rules, inputFile.unitName), {",
    "comparePathsOf(rules, removeTestPathPrefixes(rules, e.file.fileName), removeTestPathPrefixes(rules, inputFile.unitName), {",
    1,
  ],
  ["error-baseline-format/top-down/reader.ts", `import { type TestFile, isDefaultLibraryFile } from "./error_baseline";`, `import { type TestFile, comparePathsOf, isDefaultLibraryFile } from "./error_baseline";`, 1],
  ["error-baseline-format/top-down/reader.ts", `import { comparePaths, getBaseFileName, getRootLength } from "./tspath";`, `import { getBaseFileName, getRootLength } from "./tspath";`, 1],
  ["error-baseline-format/top-down/reader.ts", "comparePaths(e.fileName, section.name, caseInsensitive)", "comparePathsOf(rules, e.fileName, section.name, caseInsensitive)", 1],
  ["error-baseline-format/top-down/reader.ts", "comparePaths(unitName, realName(rules, sectionName, true), caseInsensitive)", "comparePathsOf(rules, unitName, realName(rules, sectionName, true), caseInsensitive)", 1],
  ["error-baseline-format/top-down/reader.ts", "comparePaths(name, sections[k].name, caseInsensitive)", "comparePathsOf(rules, name, sections[k].name, caseInsensitive)", 1],
  ["error-baseline-format/top-down/shape.ts", `import { type TestFile, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";`, `import { type TestFile, comparePathsOf, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";`, 1],
  ["error-baseline-format/top-down/shape.ts", `import { comparePaths } from "./tspath";\n`, "", 1],
  ["error-baseline-format/top-down/shape.ts", "comparePaths(shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive)", "comparePathsOf(rules, shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive)", 1],
]);
// Go's strings.ToLower and strings.EqualFold in place of the methods of JavaScript.
group("go-case", [
  ...["enumerator/prototype", "instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"].flatMap((d): Patch[] => [
    [
      d + "/harnessutil.ts",
      `// strings.EqualFold on ASCII names\nfunction equalFold(a: string, b: string): boolean {\n  return a.length === b.length && a.toLowerCase() === b.toLowerCase();\n}\n`,
      `import { equalFold } from "${m(d + "/harnessutil.ts", "gostrings")}";\n`,
      1,
    ],
  ]),
]);
// strconv.Atoi of the merged set in place of the local test of the form.
group("go-atoi", [
  ...["enumerator/prototype", "instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"].flatMap((d): Patch[] => [
    [
      d + "/harnessutil.ts",
      `// strconv.Atoi accepts an optional sign and decimal digits, with underscores rejected in base 10\nfunction atoiOk(s: string): boolean {\n  return /^[+-]?[0-9]+$/.test(s);\n}\n`,
      `import { atoi } from "${m(d + "/harnessutil.ts", "gostrings")}";\n`,
      1,
    ],
    [
      d + "/harnessutil.ts",
      "    case \"number\":\n      if (!atoiOk(value)) throw new HarnessFatal(`Value for option '${option.name}' must be a number, got: ${value}`);\n      return Number(value);\n",
      "    case \"number\": {\n      const numVal = atoi(value);\n      if (numVal === undefined) throw new HarnessFatal(`Value for option '${option.name}' must be a number, got: ${value}`);\n      return numVal;\n    }\n",
      1,
    ],
  ]),
]);
// strings.Compare once: the local comparers on the UTF-8 forms give way to compareStrings.
group("compare-once", [
  ...["enumerator/prototype", "instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"].flatMap((d): Patch[] => [
    [
      d + "/harnessutil.ts",
      `const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));\n`,
      `import { compareStrings as byBytes } from "${m(d + "/harnessutil.ts", "gostrings")}";\n`,
      1,
    ],
  ]),
  ...["instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"].flatMap((d): Patch[] => [
    [
      d + "/enum_runner.ts",
      `const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));\n`,
      `import { compareStrings as byBytes } from "${m(d + "/enum_runner.ts", "gostrings")}";\n`,
      1,
    ],
  ]),
]);
group("go-case", [
  ...["instance-materialisation/prototype", "instance-materialisation/bottom-up/prototype"].flatMap((d): Patch[] => [
    [d + "/vfsmatch.ts", "if (!p.caseSensitive) lit = lit.toLowerCase();", "if (!p.caseSensitive) lit = toLower(lit);", 1],
    [d + "/vfsmatch.ts", `import type { MemFs } from "./memfs";\n`, `import type { MemFs } from "./memfs";\nimport { toLower } from "${m(d + "/vfsmatch.ts", "gostrings")}";\n`, 1],
  ]),
]);
const patches = groups.filter(([name]) => name !== without).flatMap(([, list]) => list);
const applied: string[] = [];
if (withPatches) {
  for (const [file, oldText, newText, times] of patches) {
    const path = join(out, file);
    const text = readFileSync(path, "utf8");
    const found = text.split(oldText).length - 1;
    if (found !== times) throw new Error(`${file}: the text of a patch occurs ${found} times, not ${times}: ${oldText.slice(0, 80)}`);
    writeFileSync(path, text.replaceAll(oldText, newText));
    applied.push(file);
  }
}
console.log(`overlay in ${out}: ${written.length} shims, ${applied.length} patches in ${new Set(applied).size} files`);
for (const f of written) console.log("  shim   " + f);
for (const f of [...new Set(applied)]) console.log("  patch  " + f + " x" + applied.filter(x => x === f).length);
