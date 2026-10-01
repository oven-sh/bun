#!/usr/bin/env python3
# Builds a copy of the notes of the conformance unit in which every copy of a foundation module is replaced by a
# re-export of the merged set (runner/), and the writer family has the call-site edits that the merge asks for.
# The verifiers of the upper prototypes then run unchanged on the merged set.
# usage: python3 make_overlay.py <notes/lint/units/conformance> <overlay directory>
import os, re, shutil, subprocess, sys

src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
shutil.rmtree(out, ignore_errors=True)
subprocess.check_call(["cp", "-a", src, out])
merged = os.path.join(out, "shared-foundation-merge", "top-down", "runner")
written = []

def shim(rel, body):
    path = os.path.join(out, rel)
    if not os.path.exists(path):
        raise SystemExit("no file to replace: " + rel)
    m = os.path.relpath(merged, os.path.dirname(path))
    open(path, "w").write("// Overlay: this copy re-exports the merged set.\n" + body.replace("@M", m))
    written.append(rel)

RUNE_TESTS = 'export { isLineBreak, isWhiteSpaceLike, isWhiteSpaceSingleLine } from "@M/stringutil";\n'

GO_STRINGS = 'export { isSpace, toLower, trimSpace, trimSuffix } from "@M/gostrings";\n'

STRINGUTIL_99 = RUNE_TESTS + 'export { isSpace as isGoSpace, toLower, trimSpace, trimSuffix } from "@M/gostrings";\n'

# The copies took bytes; the merged set takes a ByteString.
SCANNER = '''import * as bs from "@M/bytestring";
import * as scanner from "@M/scanner";
export function decodeRune(text: Uint8Array, pos: number, end: number = text.length): [number, number] {
  return bs.decodeRune(bs.toByteString(text), pos, end);
}
export function decodeLastRune(text: Uint8Array, end: number): [number, number] {
  return bs.decodeLastRune(bs.toByteString(text), 0, end);
}
export function skipTrivia(text: Uint8Array, pos: number): number {
  return scanner.skipTrivia(bs.toByteString(text), pos);
}
'''

TSPATH_BASE = '''export {
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
} from "@M/tspath";
import * as tspath from "@M/tspath";
// The copies had the case sensitive form and the form without a list of extensions.
export function toPath(fileName: string, basePath: string): string {
  return tspath.toPath(fileName, basePath, true);
}
export function getAnyExtensionFromPath(path: string): string {
  return tspath.getAnyExtensionFromPath(path, undefined, false);
}
'''

TSPATH_MORE_308 = '''export {
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
} from "@M/tspath";
export type { ComparePathsOptions } from "@M/tspath";
export { equalFold } from "@M/gostrings";
export { compareStringsCaseInsensitive, compareStringsCaseSensitive } from "@M/stringutil";
'''

# The top-down copy had the case sensitive forms with the current directory as the last parameter.
TSPATH_MORE_233 = '''export {
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
  changeExtension,
  fileExtensionIs,
  fileExtensionIsOneOf,
  getNormalizedPathComponents,
  getPathComponents,
  getPathFromPathComponents,
  hasExtension,
  reducePathComponents,
} from "@M/tspath";
export { compareStrings as compareBytes } from "@M/gostrings";
import * as tspath from "@M/tspath";
const sensitive = (currentDirectory: string) => ({ useCaseSensitiveFileNames: true, currentDirectory });
export function getAnyExtensionFromPathOf(path: string, extensions: readonly string[]): string {
  return tspath.getAnyExtensionFromPath(path, extensions, false);
}
export function containsPath(parent: string, child: string, currentDirectory: string): boolean {
  return tspath.containsPath(parent, child, sensitive(currentDirectory));
}
export function getPathComponentsRelativeTo(from: string, to: string, currentDirectory: string): string[] {
  return tspath.getPathComponentsRelativeTo(from, to, sensitive(currentDirectory));
}
export function convertToRelativePath(absoluteOrRelativePath: string, currentDirectory: string): string {
  return tspath.convertToRelativePath(absoluteOrRelativePath, sensitive(currentDirectory));
}
'''

# The copies returned a flag for replaced bytes and went on; the merged set throws InvalidUtf8Error.
READFILE = '''import * as vfs from "@M/vfs";
export interface ReadFileResult {
  contents: string;
  ok: boolean;
  lossy: boolean;
}
import { utf8String } from "@M/bytestring";
export function readFile(path: string): ReadFileResult {
  const r = vfs.readFile(path);
  return r.ok ? { contents: r.contents, ok: true, lossy: false } : { contents: "", ok: false, lossy: false };
}
export function decodeBytes(s: Uint8Array): ReadFileResult {
  return { contents: utf8String(vfs.decodeBytes(s)), ok: true, lossy: false };
}
export const decodeUtf16 = vfs.decodeUtf16;
'''

# The copy of the directive grammar refused such a file with a value.
VFS_RESULT = '''import { InvalidUtf8Error, utf8String } from "@M/bytestring";
import * as vfs from "@M/vfs";
import type { Result } from "./result";
export function readFile(path: string): Result<string> {
  try {
    const r = vfs.readFile(path);
    return r.ok ? { ok: true, value: r.contents } : { ok: false, reason: "cannot read " + path };
  } catch (e) {
    if (e instanceof InvalidUtf8Error) return { ok: false, reason: "not valid UTF-8" };
    throw e;
  }
}
export function decodeBytes(s: Uint8Array): Result<string> {
  try {
    return { ok: true, value: utf8String(vfs.decodeBytes(s)) };
  } catch (e) {
    if (e instanceof InvalidUtf8Error) return { ok: false, reason: "not valid UTF-8" };
    throw e;
  }
}
export const decodeUtf16 = vfs.decodeUtf16;
'''

MEMFS = 'export * from "@M/vfstest";\n'

GO_COMPAT = '''export {
  RuneError,
  byteStringToUtf8,
  decodeLastRune,
  decodeRune,
  fromByteString,
  replaceNonWhitespace,
  runeCount,
  toByteString,
  trimRightSpace,
  utf8ToByteString,
} from "@M/bytestring";
export type { ByteString } from "@M/bytestring";
export { utf16Len } from "@M/core";
export { compareStrings, isSpace, padLeft } from "@M/gostrings";
'''

TSPATH_EB_NAMES = '''  combinePaths,
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
'''

# The first pass of the writer holds every text as a ByteString: names are decoded for the two calls that read runes.
TSPATH_EB_BYTES = "export {\n" + TSPATH_EB_NAMES + '''} from "@M/tspath";
export type { ComparePathsOptions } from "@M/tspath";
import { byteStringToUtf8, utf8ToByteString } from "@M/bytestring";
import * as stringutil from "@M/stringutil";
import * as tspath from "@M/tspath";
export function compareStringsCaseInsensitive(a: string, b: string): number {
  return stringutil.compareStringsCaseInsensitive(byteStringToUtf8(a), byteStringToUtf8(b));
}
export function compareStringsCaseSensitive(a: string, b: string): number {
  return stringutil.compareStringsCaseSensitive(a, b);
}
export function comparePaths(a: string, b: string, options: tspath.ComparePathsOptions): number {
  return tspath.comparePaths(byteStringToUtf8(a), byteStringToUtf8(b), options);
}
export function convertToRelativePath(path: string, options: tspath.ComparePathsOptions): string {
  return utf8ToByteString(tspath.convertToRelativePath(byteStringToUtf8(path), options));
}
'''

TSPATH_EB_DIRECT = "export {\n" + TSPATH_EB_NAMES + '''  comparePaths,
  convertToRelativePath,
} from "@M/tspath";
export type { ComparePathsOptions } from "@M/tspath";
export { compareStringsCaseInsensitive, compareStringsCaseSensitive } from "@M/stringutil";
'''

dg = "directive-grammar/prototype/"
shim(dg + "go_strings.ts", GO_STRINGS)
shim(dg + "go_utf8.ts", SCANNER)
shim(dg + "stringutil.ts", RUNE_TESTS)
shim(dg + "scanner.ts", SCANNER)
shim(dg + "tspath.ts", TSPATH_BASE)
shim(dg + "vfs.ts", VFS_RESULT)

for d in ["enumerator/prototype/", "enumerator-topdown/prototype/dg/"]:
    shim(d + "stringutil.ts", STRINGUTIL_99)
    shim(d + "scanner.ts", SCANNER)
    shim(d + "tspath.ts", TSPATH_BASE)
    shim(d + "vfs.ts", READFILE)
shim("enumerator-topdown/prototype/tspath.ts", TSPATH_BASE)

for d in ["instance-materialisation/prototype/", "instance-materialisation/bottom-up/prototype/"]:
    shim(d + "stringutil.ts", STRINGUTIL_99)
    shim(d + "scanner.ts", SCANNER)
    shim(d + "tspath.ts", TSPATH_BASE)
    shim(d + "tspath_more.ts", TSPATH_MORE_308)
    shim(d + "readfile.ts", READFILE)
    shim(d + "memfs.ts", MEMFS)
shim("instance-materialisation/top-down/prototype/tspath_more.ts", TSPATH_MORE_233)

shim("error-baseline-format/prototype/go_compat.ts", GO_COMPAT)
shim("error-baseline-format/prototype/tspath.ts", TSPATH_EB_BYTES)
shim("error-baseline-format/top-down/go_compat.ts", GO_COMPAT)
shim("error-baseline-format/top-down/tspath.ts", TSPATH_EB_DIRECT)
shim("error-baseline-format/top-down/text_model.ts", 'export * from "@M/text_model";\n')

edits = []

def edit(rel, old, new, count=1):
    path = os.path.join(out, rel)
    text = open(path).read()
    if text.count(old) != count:
        raise SystemExit("%s: %d occurrences of %r, expected %d" % (rel, text.count(old), old, count))
    open(path, "w").write(text.replace(old, new))
    edits.append((rel, old, new))

td = "error-baseline-format/top-down/"
# tspath works on JavaScript strings: a name of the model goes there and back.
edit(td + "diagnosticwriter.ts",
     "export function ecmaLineMap(",
     "function relativePath(rules: Rules, fileName: string, options: ComparePathsOptions): string {\n"
     "  return rules.model.fromString(convertToRelativePath(rules.model.toString(fileName), options));\n"
     "}\n\nexport function ecmaLineMap(")
edit(td + "diagnosticwriter.ts", "convertToRelativePath(file.fileName, formatOpts)", "relativePath(rules, file.fileName, formatOpts)", 2)
edit(td + "diagnosticwriter.ts", "convertToRelativePath(fileName, formatOpts)", "relativePath(rules, fileName, formatOpts)")
edit(td + "error_baseline.ts",
     "comparePaths(removeTestPathPrefixes(rules, e.file.fileName), removeTestPathPrefixes(rules, inputFile.unitName), {",
     "comparePaths(model.toString(removeTestPathPrefixes(rules, e.file.fileName)), model.toString(removeTestPathPrefixes(rules, inputFile.unitName)), {")
edit(td + "error_baseline.ts", "model.splitLines(", "model.contentLines(")
edit(td + "reader.ts", "comparePaths(e.fileName, section.name, caseInsensitive)",
     "comparePaths(rules.model.toString(e.fileName), rules.model.toString(section.name), caseInsensitive)")
edit(td + "reader.ts", "comparePaths(unitName, realName(rules, sectionName, true), caseInsensitive)",
     "comparePaths(rules.model.toString(unitName), rules.model.toString(realName(rules, sectionName, true)), caseInsensitive)")
edit(td + "reader.ts", "comparePaths(name, sections[k].name, caseInsensitive)",
     "comparePaths(model.toString(name), model.toString(sections[k].name), caseInsensitive)")
edit(td + "reader.ts", "model.splitLines(", "model.contentLines(")
edit(td + "shape.ts", "comparePaths(shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive)",
     "comparePaths(model.toString(shown), model.toString(removeTestPathPrefixes(rules, f.unitName)), caseInsensitive)")
edit(td + "reader_fuzz.ts", "rules.model.splitLines(", "rules.model.contentLines(")
edit(td + "stats_spans.ts", "rules.model.splitLines(", "rules.model.contentLines(")

print("overlay:", out)
print("replaced by a re-export:", len(written))
for w in written:
    print("  " + w)
print("call-site edits:", len(edits))
for rel, old, new in edits:
    print("  %s: %s" % (rel, old.split("\n")[0][:90]))
