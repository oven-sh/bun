// Builds the file set of the runner as it would be committed, from the module map below: one source per file,
// imports routed to the merged bottom layer, and the listed edits. The result has the layout of the repository.
// usage: bun assemble.ts <directory of the notes of the unit> <output directory>
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [notesArg, outArg] = process.argv.slice(2);
const notes = resolve(notesArg);
const out = resolve(outArg);
const here = "shared-foundation-merge/bottom-up";
const runner = "test/cli/lint/conformance/runner/";

// Committed file -> surviving source, both as paths below their roots.
export const moduleMap: [committed: string, source: string][] = [
  [runner + "gostrings.ts", here + "/runner/gostrings.ts"],
  [runner + "stringutil.ts", here + "/runner/stringutil.ts"],
  [runner + "core.ts", here + "/runner/core.ts"],
  [runner + "scanner.ts", here + "/runner/scanner.ts"],
  [runner + "tspath.ts", here + "/runner/tspath.ts"],
  [runner + "vfs.ts", here + "/runner/vfs.ts"],
  [runner + "vfstest.ts", here + "/runner/vfstest.ts"],
  [runner + "text_model.ts", here + "/runner/text_model.ts"],
  [runner + "UPSTREAM_PORTED", here + "/runner/UPSTREAM_PORTED"],
  [runner + "test_case_parser.ts", "instance-materialisation/prototype/test_case_parser.ts"],
  [runner + "harnessutil.ts", "instance-materialisation/prototype/harnessutil.ts"],
  [runner + "options_table.json", "instance-materialisation/prototype/options_table.json"],
  [runner + "tsconfig.ts", "instance-materialisation/prototype/tsconfig.ts"],
  [runner + "compiler_runner.ts", "instance-materialisation/prototype/enum_runner.ts"],
  [runner + "compiler_test.ts", "instance-materialisation/prototype/compiler_test.ts"],
  [runner + "config_files.ts", "instance-materialisation/prototype/config_files.ts"],
  [runner + "vfsmatch.ts", "instance-materialisation/prototype/vfsmatch.ts"],
  [runner + "materialize.ts", "instance-materialisation/prototype/materialize.ts"],
  [runner + "diagnosticwriter.ts", "error-baseline-format/top-down/diagnosticwriter.ts"],
  [runner + "error_baseline.ts", "error-baseline-format/top-down/error_baseline.ts"],
  [runner + "reader.ts", "error-baseline-format/top-down/reader.ts"],
  [runner + "shape.ts", "error-baseline-format/top-down/shape.ts"],
  [runner + "check.ts", "check-contract-default-spawn/top-down/check.ts"],
  [runner + "checks.ts", "check-contract-default-spawn/top-down/checks.ts"],
  [runner + "plain.ts", "check-contract-default-spawn/top-down/plain.ts"],
  [runner + "run.ts", "check-contract-default-spawn/top-down/run.ts"],
  [runner + "manifest.ts", "check-contract-default-spawn/top-down/manifest.ts"],
  [runner + "baseline.ts", "oracle-and-expectations/top-down/prototype/baseline.ts"],
  [runner + "expectations.ts", "oracle-and-expectations/top-down/prototype/expectations.ts"],
  [runner + "sweep_args.ts", "oracle-and-expectations/top-down/prototype/sweep_args.ts"],
  [runner + "index.ts", "test-file-and-sweep/top-down/index.ts"],
  ["test/cli/lint/conformance/sweep.ts", "test-file-and-sweep/top-down/sweep.ts"],
  ["test/cli/lint/conformance/expectations.json", "test-file-and-sweep/top-down/expectations.json"],
  ["test/cli/lint/conformance/post-emit-order.txt", "oracle-and-expectations/top-down/vectors/post-emit-order.txt"],
  ["test/cli/lint/conformance.test.ts", "test-file-and-sweep/top-down/conformance.test.ts"],
];

// Old copies of the bottom layer: where each exported name lives in the merged set, and under which name.
type Route = Record<string, [module: string, name?: string]>;
const stringutilRoute: Route = {
  isWhiteSpaceLike: ["stringutil"],
  isWhiteSpaceSingleLine: ["stringutil"],
  isLineBreak: ["stringutil"],
  isGoSpace: ["gostrings", "isSpace"],
  trimSpace: ["gostrings"],
  trimSuffix: ["gostrings"],
  toLower: ["gostrings"],
};
const all = (module: string, names: string[]): Route => Object.fromEntries(names.map(n => [n, [module]]));
const tspathRoute: Route = all("tspath", [
  "hasTrailingDirectorySeparator",
  "isVolumeCharacter",
  "getEncodedRootLength",
  "getRootLength",
  "normalizeSlashes",
  "removeTrailingDirectorySeparator",
  "removeTrailingDirectorySeparators",
  "getBaseFileName",
  "isRootedDiskPath",
  "pathIsAbsolute",
  "ensureTrailingDirectorySeparator",
  "combinePaths",
  "getDirectoryPath",
  "getNormalizedAbsolutePath",
  "normalizePath",
  "toPath",
  "getAnyExtensionFromPath",
  "getPathComponents",
  "reducePathComponents",
  "getPathFromPathComponents",
  "comparePaths",
  "convertToRelativePath",
  "ComparePathsOptions",
]);
const tspathMoreRoute: Route = {
  ...all("tspath", [
    "ExtensionTs",
    "ExtensionTsx",
    "ExtensionDts",
    "ExtensionJs",
    "ExtensionJsx",
    "ExtensionJson",
    "ExtensionTsBuildInfo",
    "ExtensionMjs",
    "ExtensionMts",
    "ExtensionDmts",
    "ExtensionCjs",
    "ExtensionCts",
    "ExtensionDcts",
    "AllSupportedExtensions",
    "SupportedTSExtensions",
    "AllSupportedExtensionsWithJson",
    "SupportedTSExtensionsWithJson",
    "fileExtensionIs",
    "fileExtensionIsOneOf",
    "hasExtension",
    "ComparePathsOptions",
    "getComparer",
    "getPathComponents",
    "reducePathComponents",
    "getPathFromPathComponents",
    "getNormalizedPathComponents",
    "containsPath",
    "toFileNameLowerCase",
    "getCanonicalFileName",
    "getPathComponentsRelativeTo",
    "convertToRelativePath",
    "changeAnyExtension",
    "changeExtension",
  ]),
  toPathEx: ["tspath", "toPath"],
  getAnyExtensionFromPathEx: ["tspath", "getAnyExtensionFromPath"],
  equalFold: ["gostrings"],
  compareStringsCaseInsensitive: ["stringutil"],
  compareStringsCaseSensitive: ["stringutil"],
};
const routes: Record<string, Route> = {
  "instance-materialisation/prototype/stringutil.ts": stringutilRoute,
  "enumerator/prototype/stringutil.ts": stringutilRoute,
  "instance-materialisation/prototype/scanner.ts": all("scanner", ["skipTrivia"]),
  "instance-materialisation/prototype/tspath.ts": tspathRoute,
  "instance-materialisation/prototype/tspath_more.ts": tspathMoreRoute,
  "instance-materialisation/prototype/readfile.ts": all("vfs", ["readFile", "decodeBytes", "decodeUtf16", "ReadFileResult"]),
  "instance-materialisation/prototype/memfs.ts": all("vfstest", ["MemFs", "MemFsPanic", "MemInput", "MemEntry", "Entries"]),
  "error-baseline-format/top-down/go_compat.ts": {
    ...all("gostrings", [
      "ByteString",
      "RuneError",
      "toByteString",
      "fromByteString",
      "utf8ToByteString",
      "byteStringToUtf8",
      "decodeRune",
      "decodeLastRune",
      "runeCount",
      "isSpace",
      "trimRightSpace",
      "replaceNonWhitespace",
      "padLeft",
      "compareStrings",
    ]),
    utf16Len: ["core"],
  },
  "error-baseline-format/top-down/text_model.ts": { ...all("text_model", ["TextModel", "utf8Model", "utf16Model"]), isSpace: ["gostrings"] },
  "error-baseline-format/top-down/tspath.ts": {
    ...tspathRoute,
    compareStringsCaseInsensitive: ["stringutil"],
    compareStringsCaseSensitive: ["stringutil"],
  },
};

const committedOf = new Map(moduleMap.map(([committed, source]) => [source, committed]));
const specifier = (fromCommitted: string, toCommitted: string) => {
  const r = relative(dirname(fromCommitted), toCommitted).replace(/\.ts$/, "");
  return r.startsWith(".") ? r : "./" + r;
};

function resolveSource(fromSource: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = relative(notes, resolve(notes, dirname(fromSource), spec));
  for (const candidate of [base, base + ".ts"]) if (existsSync(join(notes, candidate)) && !candidate.endsWith("/")) return candidate;
  throw new Error(`${fromSource}: cannot resolve ${spec}`);
}

function rewriteImports(committed: string, source: string, text: string): string {
  // Named lists first: they may need to be split by the module of each name.
  text = text.replace(/^(import|export)( type)? \{([^}]*)\} from "([^"]+)";$/gms, (statement, keyword, typeOnly, list, spec) => {
    const target = resolveSource(source, spec);
    if (target === undefined) return statement;
    const route = routes[target];
    if (route === undefined) {
      const to = committedOf.get(target);
      if (to === undefined) throw new Error(`${source}: ${spec} is no file of the module map`);
      return statement.replace(`"${spec}"`, `"${specifier(committed, to)}"`);
    }
    const byModule = new Map<string, string[]>();
    for (const item of (list as string).split(",").map(s => s.trim()).filter(s => s !== "")) {
      const m = /^(type )?([A-Za-z_$][\w$]*)(?: as ([A-Za-z_$][\w$]*))?$/.exec(item);
      if (m === null) throw new Error(`${source}: cannot read the import of ${item}`);
      const [, isType, name, alias] = m;
      const to = route[name];
      if (to === undefined) throw new Error(`${source}: ${name} of ${target} has no place in the merged set`);
      const [module, newName = name] = to;
      const local = alias ?? name;
      const entry = (isType ?? "") + (newName === local ? newName : `${newName} as ${local}`);
      byModule.set(module, [...(byModule.get(module) ?? []), entry]);
    }
    return [...byModule]
      .map(([module, names]) => `${keyword}${typeOnly ?? ""} { ${names.join(", ")} } from "${specifier(committed, runner + module + ".ts")}";`)
      .join("\n");
  });
  // Every other form keeps its shape: only the specifier changes.
  text = text.replace(/^((?:import|export) (?:type )?(?:\* as [\w$]+|[\w$]+|\*) from )"([^"]+)";$/gm, (statement, head, spec) => {
    const target = resolveSource(source, spec);
    if (target === undefined) return statement;
    if (routes[target] !== undefined) throw new Error(`${source}: ${spec} is imported whole and has no single place in the merged set`);
    const to = committedOf.get(target);
    if (to === undefined) throw new Error(`${source}: ${spec} is no file of the module map`);
    return `${head}"${specifier(committed, to)}";`;
  });
  return text;
}

// Edits of a committed file after its imports are routed: [file, old text, new text, times the old text occurs].
type Edit = [file: string, oldText: string, newText: string, times: number];
const r = (name: string) => runner + name;
const edits: Edit[] = [
  // test_case_parser.ts: the trivia scan takes the byte string of the text.
  [r("test_case_parser.ts"), `import { toLower, trimSpace, trimSuffix } from "./gostrings";`, `import { toLower, trimSpace, trimSuffix, utf8ToByteString } from "./gostrings";`, 1],
  [r("test_case_parser.ts"), `const encoder = new TextEncoder();\n\n`, "", 1],
  [r("test_case_parser.ts"), "const bytes = encoder.encode(currentFileContent);", "const bytes = utf8ToByteString(currentFileContent);", 1],
  [r("test_case_parser.ts"), `export const counters = { reachedSkipTrivia: 0 };\n\n`, "", 1],
  [r("test_case_parser.ts"), `          counters.reachedSkipTrivia++;\n`, "", 1],
  // test_case_parser.ts: strings.ToLower where upstream calls it (test_case_parser.go:172 and :285); the names are ASCII, so nothing changes.
  [r("test_case_parser.ts"), "const metaDataName = testMetaData[1].toLowerCase();", "const metaDataName = toLower(testMetaData[1]);", 1],
  [r("test_case_parser.ts"), "opts.set(match[1].toLowerCase(), ", "opts.set(toLower(match[1]), ", 1],
  // harnessutil.ts: strings.EqualFold, strings.Compare and strconv.Atoi of the merged set in place of the local copies.
  [r("harnessutil.ts"), `import { toLower, trimSpace } from "./gostrings";`, `import { atoi, compareStrings, equalFold, toLower, trimFunc, trimSpace } from "./gostrings";`, 1],
  [
    r("harnessutil.ts"),
    `// strconv.Atoi accepts an optional sign and decimal digits, with underscores rejected in base 10\nfunction atoiOk(s: string): boolean {\n  return /^[+-]?[0-9]+$/.test(s);\n}\n\n`,
    "",
    1,
  ],
  [
    r("harnessutil.ts"),
    "    case \"number\":\n      if (!atoiOk(value)) throw new HarnessFatal(`Value for option '${option.name}' must be a number, got: ${value}`);\n      return Number(value);\n",
    "    case \"number\": {\n      const numVal = atoi(value);\n      if (numVal === undefined) throw new HarnessFatal(`Value for option '${option.name}' must be a number, got: ${value}`);\n      return numVal;\n    }\n",
    1,
  ],
  // run.ts: the regexp of error_baseline.go:31 has one place, in error_baseline.ts.
  [r("error_baseline.ts"), "const diagnosticsLocationPrefixGo =\n", "export const diagnosticsLocationPrefixGo =\n", 1],
  [
    r("run.ts"),
    "// error_baseline.go:31, as the writer has it.\n" + String.raw`const diagnosticsLocationPrefixGo = /(?<![^\n])([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf))\(\d+,\d+\)/g;` + "\n",
    "",
    1,
  ],
  [
    r("run.ts"),
    `import { formatOpts, getErrorBaseline, removeTestPathPrefixes } from "./error_baseline";`,
    `import { diagnosticsLocationPrefixGo, formatOpts, getErrorBaseline, removeTestPathPrefixes } from "./error_baseline";`,
    1,
  ],
  [
    r("harnessutil.ts"),
    `function trimFunc(s: string, f: (ch: number) => boolean): string {\n  const cps = [...s];\n  let start = 0;\n  let end = cps.length;\n  while (start < end && f(cps[start].codePointAt(0)!)) start++;\n  while (end > start && f(cps[end - 1].codePointAt(0)!)) end--;\n  return cps.slice(start, end).join("");\n}\n`,
    "",
    1,
  ],
  [r("harnessutil.ts"), `// strings.EqualFold on ASCII names\nfunction equalFold(a: string, b: string): boolean {\n  return a.length === b.length && a.toLowerCase() === b.toLowerCase();\n}\n\n`, "", 1],
  [r("harnessutil.ts"), `const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));\n\n`, "", 1],
  [r("harnessutil.ts"), "[...config.keys()].sort(byBytes)", "[...config.keys()].sort(compareStrings)", 1],
  // vfsmatch.ts: strings.ToLower.
  [r("vfsmatch.ts"), "if (!p.caseSensitive) lit = lit.toLowerCase();", "if (!p.caseSensitive) lit = toLower(lit);", 1],
  [r("vfsmatch.ts"), `import type { MemFs } from "./vfstest";\n`, `import { toLower } from "./gostrings";\nimport type { MemFs } from "./vfstest";\n`, 1],
  // tsconfig.ts: the white space and the line breaks of the scanner of upstream, which the classes of JavaScript are not.
  [r("tsconfig.ts"), `import { toLower } from "./gostrings";`, `import { toLower } from "./gostrings";\nimport { isLineBreak, isWhiteSpaceLike } from "./stringutil";`, 1],
  [r("tsconfig.ts"), `while (i < n && /[\\s\\uFEFF]/.test(text[i])) i++;`, "while (i < n && isWhiteSpaceLike(text.charCodeAt(i))) i++;", 1],
  [r("tsconfig.ts"), `if (/[\\s\\uFEFF]/.test(text[i])) i++;`, "if (isWhiteSpaceLike(text.charCodeAt(i))) i++;", 1],
  [r("tsconfig.ts"), `while (i < n && text[i] !== "\\n" && text[i] !== "\\r") i++;`, "while (i < n && !isLineBreak(text.charCodeAt(i))) i++;", 2],
  // tsconfigparsing.go:436 and :1797 have one place, in tsconfig.ts, with the parameter of upstream (any value).
  [
    r("tsconfig.ts"),
    "function startsWithConfigDirTemplate(value: string): boolean {\n  return toLower(value).startsWith(toLower(configDirTemplate));\n}\n",
    "// tsconfigparsing.go:436\nexport function startsWithConfigDirTemplate(value: unknown): boolean {\n  return typeof value === \"string\" && toLower(value).startsWith(toLower(configDirTemplate));\n}\n",
    1,
  ],
  [r("tsconfig.ts"), "function getSubstitutedPathWithConfigDirTemplate(", "export function getSubstitutedPathWithConfigDirTemplate(", 1],
  [
    r("config_files.ts"),
    "const configDirTemplate = \"${configDir}\";\nfunction startsWithConfigDirTemplate(value: unknown): boolean {\n  return typeof value === \"string\" && toLower(value).startsWith(toLower(configDirTemplate));\n}\nfunction getSubstitutedPathWithConfigDirTemplate(value: string, basePath: string): string {\n  return getNormalizedAbsolutePath(value.replace(configDirTemplate, \"./\"), basePath);\n}\n",
    "",
    1,
  ],
  [
    r("config_files.ts"),
    `import { isBlankJsonc, parseJsonc, type JsonNode } from "./tsconfig";`,
    `import { getSubstitutedPathWithConfigDirTemplate, isBlankJsonc, parseJsonc, startsWithConfigDirTemplate, type JsonNode } from "./tsconfig";`,
    1,
  ],
  // The two functions of tspath that had a short form take the arguments of upstream.
  [r("tsconfig.ts"), "toPath(configFileName, basePath)", "toPath(configFileName, basePath, true)", 1],
  [r("compiler_runner.ts"), "getAnyExtensionFromPath(basename)", "getAnyExtensionFromPath(basename, undefined, false)", 1],
  [r("compiler_runner.ts"), `const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));\n`, `import { compareStrings as byBytes } from "./gostrings";\n`, 1],
  // config_files.ts and compiler_test.ts: the conversions that throw in place of the ones that replace.
  [r("config_files.ts"), `constructor(readonly host: MemFs, readonly decoder = new TextDecoder("utf-8")) {}`, "constructor(readonly host: MemFs) {}", 1],
  [r("config_files.ts"), "return b === undefined ? undefined : this.decoder.decode(b);", "return b === undefined ? undefined : utf8String(decodeBytes(b));", 1],
  [r("config_files.ts"), `import type { MemFs } from "./vfstest";\n`, `import { utf8String } from "./gostrings";\nimport { decodeBytes } from "./vfs";\nimport type { MemFs } from "./vfstest";\n`, 1],
  [r("compiler_test.ts"), `const encoder = new TextEncoder();\n\n`, "", 1],
  [r("compiler_test.ts"), "encoder.encode(", "utf8Bytes(", 3],
  [r("compiler_test.ts"), `import { Undecided, getConfigFileNames } from "./config_files";\n`, `import { Undecided, getConfigFileNames } from "./config_files";\nimport { utf8Bytes } from "./gostrings";\n`, 1],
  // baseline.ts: the two lists are decoded with the conversion that throws.
  [r("baseline.ts"), `readFileNameSet(readFileSync(p, "utf8"))`, "readFileNameSet(utf8String(readFileSync(p), p))", 1],
  [r("baseline.ts"), `import { trimSpace } from "./gostrings";`, `import { trimSpace, utf8String } from "./gostrings";`, 1],
  // The baseline modules: the name of the line split, and names decoded before tspath compares them.
  [r("error_baseline.ts"), "model.splitLines(", "model.contentLines(", 1],
  [r("reader.ts"), "model.splitLines(", "model.contentLines(", 1],
  [
    r("error_baseline.ts"),
    `import { comparePaths, ensureTrailingDirectorySeparator, getBaseFileName } from "./tspath";\n`,
    `import { type ComparePathsOptions, comparePaths, ensureTrailingDirectorySeparator, getBaseFileName } from "./tspath";\n\n// tspath.ComparePaths on names of the model: its comparers fold runes, so the names are decoded first.\nexport function comparePathsOf(rules: Rules, a: string, b: string, options: ComparePathsOptions): number {\n  return comparePaths(rules.model.toString(a), rules.model.toString(b), options);\n}\n`,
    1,
  ],
  [r("error_baseline.ts"), "comparePaths(removeTestPathPrefixes(rules, e.file.fileName), removeTestPathPrefixes(rules, inputFile.unitName), {", "comparePathsOf(rules, removeTestPathPrefixes(rules, e.file.fileName), removeTestPathPrefixes(rules, inputFile.unitName), {", 1],
  [r("reader.ts"), `import { type TestFile, isDefaultLibraryFile } from "./error_baseline";`, `import { type TestFile, comparePathsOf, isDefaultLibraryFile } from "./error_baseline";`, 1],
  [r("reader.ts"), `import { comparePaths, getBaseFileName, getRootLength } from "./tspath";`, `import { getBaseFileName, getRootLength } from "./tspath";`, 1],
  [r("reader.ts"), "comparePaths(e.fileName, section.name, caseInsensitive)", "comparePathsOf(rules, e.fileName, section.name, caseInsensitive)", 1],
  [r("reader.ts"), "comparePaths(unitName, realName(rules, sectionName, true), caseInsensitive)", "comparePathsOf(rules, unitName, realName(rules, sectionName, true), caseInsensitive)", 1],
  [r("reader.ts"), "comparePaths(name, sections[k].name, caseInsensitive)", "comparePathsOf(rules, name, sections[k].name, caseInsensitive)", 1],
  [r("shape.ts"), `import { type TestFile, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";`, `import { type TestFile, comparePathsOf, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";`, 1],
  [r("shape.ts"), `import { comparePaths } from "./tspath";\n`, "", 1],
  [r("shape.ts"), "comparePaths(shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive)", "comparePathsOf(rules, shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive)", 1],
  // scanner.ComputeLineOfPosition lives in scanner.ts.
  [
    r("diagnosticwriter.ts"),
    `// scanner.ComputeLineOfPosition\nexport function computeLineOfPosition(lineStarts: number[], pos: number): number {\n  let low = 0;\n  let high = lineStarts.length - 1;\n  while (low <= high) {\n    const middle = low + ((high - low) >> 1);\n    const value = lineStarts[middle];\n    if (value < pos) low = middle + 1;\n    else if (value > pos) high = middle - 1;\n    else return middle;\n  }\n  return low - 1;\n}\n\n`,
    "",
    1,
  ],
  [r("diagnosticwriter.ts"), `import { padLeft } from "./gostrings";\n`, `import { padLeft } from "./gostrings";\nimport { computeLineOfPosition } from "./scanner";\n`, 1],
  [r("shape.ts"), `  categoryName,\n  computeLineOfPosition,\n} from "./diagnosticwriter";\n`, `  categoryName,\n} from "./diagnosticwriter";\n`, 1],
  [r("shape.ts"), `import type { ParsedErrorBaseline } from "./reader";\n`, `import type { ParsedErrorBaseline } from "./reader";\nimport { computeLineOfPosition } from "./scanner";\n`, 1],
  // index.ts: a case that cannot be read is told apart, and the file of the post-emit order is beside the runner.
  [r("index.ts"), `  const content = readFile(file).contents;\n`, `  const read = readFile(file);\n  if (!read.ok) return { ok: false, status: "invalid", reason: "Could not read test file: " + file };\n  const content = read.contents;\n`, 1],
  [r("index.ts"), `new URL("../../oracle-and-expectations/top-down/vectors/post-emit-order.txt", import.meta.url)`, `new URL("../post-emit-order.txt", import.meta.url)`, 1],
  // index.ts: a link and its target are names of the file system, as harnessutil.go:208 makes them; the roots are such names already.
  [
    r("index.ts"),
    "links: [...t.symlinks].map(([path, target]) => ({ path, target })),",
    "links: [...t.symlinks].map(([path, target]) => ({\n        path: getNormalizedAbsolutePath(path, t.currentDirectory),\n        target: getNormalizedAbsolutePath(target, t.currentDirectory),\n      })),",
    1,
  ],
  [r("index.ts"), `import { readFile } from "./vfs";\n`, `import { getNormalizedAbsolutePath } from "./tspath";\nimport { readFile } from "./vfs";\n`, 1],
  // sweep.ts and the test: the runner is a directory, and the test reads the vectors of the research where they are.
  ["test/cli/lint/conformance/sweep.ts", `} from "./runner/index";`, `} from "./runner";`, 1],
  ["test/cli/lint/conformance.test.ts", `} from "./conformance/runner/index";`, `} from "./conformance/runner";`, 1],
  ["test/cli/lint/conformance.test.ts", `const notes = join(import.meta.dir, "..", "..");`, `const notes = ${JSON.stringify(notes)};`, 1],
  ["test/cli/lint/conformance.test.ts", `join(import.meta.dir, "expectations.json")`, `join(import.meta.dir, "conformance", "expectations.json")`, 1],
  // The test of the directive parser: one parser, bytes that are not UTF-8 throw, the trivia scan takes a byte string.
  [
    "test/cli/lint/conformance.test.ts",
    `import { getConfigNameFromFileName } from "../../directive-grammar/prototype/harnessutil";\nimport { skipTrivia } from "../../directive-grammar/prototype/scanner";\nimport * as directives from "../../directive-grammar/prototype/test_case_parser";\nimport { decodeBytes } from "../../directive-grammar/prototype/vfs";\n`,
    `import { InvalidUtf8Error, utf8String, utf8ToByteString } from "./conformance/runner/gostrings";\nimport { skipTrivia } from "./conformance/runner/scanner";\nimport * as directives from "./conformance/runner/test_case_parser";\nimport { decodeBytes } from "./conformance/runner/vfs";\n`,
    1,
  ],
  [
    "test/cli/lint/conformance.test.ts",
    `      const d = raw.length === 0 ? { ok: true as const, value: "" } : decodeBytes(raw);\n      if (!d.ok) return { name: i.name, refused: d.reason };\n      const content = d.value;\n      const bytes = new TextEncoder().encode(content);\n`,
    `      let content: string;\n      try {\n        content = raw.length === 0 ? "" : utf8String(decodeBytes(raw));\n      } catch (e) {\n        if (!(e instanceof InvalidUtf8Error)) throw e;\n        return { name: i.name, refused: "not valid UTF-8" };\n      }\n      const bytes = utf8ToByteString(content);\n`,
    1,
  ],
  ["test/cli/lint/conformance.test.ts", "let units = r.value.units;", "let units: any[] = r.units;", 1],
  ["test/cli/lint/conformance.test.ts", `o.error = r.value.error ?? "";`, `o.error = r.error ?? "";`, 1],
  ["test/cli/lint/conformance.test.ts", "o.symlinks = obj(r.value.symlinks);", "o.symlinks = obj(r.symlinks);", 1],
  ["test/cli/lint/conformance.test.ts", "o.currentDirectory = r.value.currentDirectory;", "o.currentDirectory = r.currentDirectory;", 1],
  ["test/cli/lint/conformance.test.ts", "o.globalOptions = obj(r.value.globalOptions);", "o.globalOptions = obj(r.globalOptions);", 1],
  ["test/cli/lint/conformance.test.ts", "getConfigNameFromFileName(u.name)", "directives.getConfigNameFromFileName(u.name)", 1],
];

// Rule 5 of the unit: one comment line at a time, and no word of the research. [file, old text, new text].
const t = "test/cli/lint/conformance.test.ts";
const sw = "test/cli/lint/conformance/sweep.ts";
const comments: [file: string, oldText: string, newText: string][] = [
  [
    r("diagnosticwriter.ts"),
    `// Port of internal/diagnosticwriter/diagnosticwriter.go with the parts of core.go, scanner.go and ast/diagnostic.go it calls.\n// Rules "tsgo" are the port. Rules "tsc" are the functions of TypeScript's program.ts and watch.ts that wrote TypeScript's baselines.\n`,
    `// Port of internal/diagnosticwriter/diagnosticwriter.go of typescript-go 89d5d5b (rules "tsgo"); rules "tsc" are the writers of program.ts and watch.ts of TypeScript 5848bc5.\n`,
  ],
  [
    r("diagnosticwriter.ts"),
    `// If the error spans over 5 lines, we'll only show the first 2 and last 2 lines,\n    // so we'll skip ahead to the second-to-last line.\n`,
    `// If the error spans over 5 lines, only the first 2 and the last 2 lines are shown: skip ahead to the second-to-last line.\n`,
  ],
  [
    r("diagnosticwriter.ts"),
    `// If we're on the last line, then limit it to the last character of the last line.\n      // Otherwise, we'll just squiggle the rest of the line, giving 'slice' no end position.\n`,
    `// On the last line the squiggle ends at the last character; otherwise it runs to the end of the line.\n`,
  ],
  [r("diagnosticwriter.ts"), `// Fill with spaces until the first character,\n      // then squiggle the remainder of the line.\n`, `// Fill with spaces until the first character, then squiggle the remainder of the line.\n`],
  [
    r("diagnosticwriter.ts"),
    `// ast.CompareDiagnostics up to the category. What follows there compares the message key and its arguments,\n// which a diagnostic read from text does not have: the sort is stable and a tie keeps the order of the input.\n`,
    `// ast.CompareDiagnostics up to the category; its later keys, the message key and its arguments, are not in a diagnostic read from text, so a tie keeps the order of the input.\n`,
  ],
  [
    r("error_baseline.ts"),
    `// Port of internal/testutil/tsbaseline/error_baseline.go and util.go: the writer of .errors.txt baselines.\n// Rules "tsc" are the rules of TypeScript's src/harness/harnessIO.ts where they differ.\n`,
    `// Port of internal/testutil/tsbaseline/error_baseline.go and util.go of typescript-go 89d5d5b; rules "tsc" are those of src/harness/harnessIO.ts of TypeScript 5848bc5 where they differ.\n`,
  ],
  [
    r("reader.ts"),
    `// The summary ends the text: "Found ..." and an empty line, then the table of files and an empty line.\n    // Nothing is read from it: the writer derives it from the diagnostics.\n`,
    `// The summary ends the text ("Found ...", an empty line, the table of files, an empty line); nothing is read from it, the writer derives it.\n`,
  ],
  [
    r("reader.ts"),
    `// Per entry with a file: a line break, "  location - message", chain lines, the snippet. The line break\n      // ends the snippet before it, or is an empty line when a snippet or an entry without a file is before it.\n`,
    `// Per entry with a file: a line break (the end of the snippet before it, or an empty line), "  location - message", chain lines, the snippet.\n`,
  ],
  [
    r("reader.ts"),
    `// The same for a line that may be a source line: a chain line is 2 spaces per level and a text that is not\n// empty and does not start with a space.\n`,
    `// The same for a line that may be a source line: a chain line is 2 spaces per level, then text that is not empty and does not start with a space.\n`,
  ],
  [
    r("reader.ts"),
    `// A message never follows a source line, so this is a squiggle line of a diagnostic of a later line:\n          // the writer does that on the last line only.\n`,
    `// A message never follows a source line, so this is a squiggle line of a diagnostic of a later line, which the writer makes on the last line only.\n`,
  ],
  [
    r("shape.ts"),
    `// The shape that the runner and its check function exchange, and its conversion to the input of the writer.\n// Plain data: strings are JavaScript strings, nothing depends on the identity of an object.\n`,
    `// The plain data that the runner and a check function exchange (JavaScript strings, no identity of objects), and its conversion to the input of the writer.\n`,
  ],
  [
    r("shape.ts"),
    `// Offset and length in the unit of the rules: UTF-8 bytes (tsgo), UTF-16 code units (tsc).\n  // start is absent when the text of the file is not known; length is absent when it is not known.\n`,
    `// Offset and length in UTF-8 bytes (tsgo) or UTF-16 code units (tsc); start is absent when the text of the file is not known, length when it is not known.\n`,
  ],
  [
    r("plain.ts"),
    `// Research prototype: reader of the plain format of tsc, as a lint run prints it on stderr when stderr is no terminal.\n// A text that has a line of no known form is refused whole: a crash report must never read as an empty list.\n`,
    `// Reader of the plain format of tsc on stderr; a text with a line of no known form is refused whole, so that a crash report never reads as an empty list.\n`,
  ],
  [
    r("plain.ts"),
    `// A line that starts with a category has no file; else the first "(line,column): category code: " ends the name.\n// A code is "TS" and a number, or a name: of a rule, or of the command for what is no diagnostic of TypeScript.\n`,
    `// A line that starts with a category has no file, else the first "(line,column): category code: " ends the name; a code is "TS" and a number, or the name of a rule or of the command.\n`,
  ],
  [
    r("check.ts"),
    `// Research prototype: the contract between the runner and a check function, and the check that spawns a command.\n// It imports nothing of the test harness: the command and the environment are given by the caller.\n`,
    `// The contract between the runner and a check function, and the check that spawns a command; the caller gives the command and the environment.\n`,
  ],
  [
    r("run.ts"),
    `// Strongest first. "baseline": every byte of the baseline. "first-section": the baseline starts with the first\n// section of the run. The level of a result follows from what the result holds, before anything is compared.\n`,
    `// Strongest first: "baseline" is every byte of the baseline, "first-section" is its first section; the level follows from what a result holds, before anything is compared.\n`,
  ],
  [
    r("index.ts"),
    `// Research prototype of runner/index.ts: the one module that conformance.test.ts and sweep.ts import.\n// Every name below is re-exported from a prototype of the first wave or is glue that the runner has to own.\n`,
    `// The one module that conformance.test.ts and sweep.ts import.\n`,
  ],
  [
    sw,
    `// Research prototype of test/cli/lint/conformance/sweep.ts, wired to the prototypes of the first wave and to the reference clone.\n// In the repository: "./runner" for "./index", the committed corpus for referenceLayout() when --reference is absent.\n`,
    `// The full run over the corpus: the pass counts by directory and by diagnostic code, and the report file.\n`,
  ],
  [sw, `// The prototype takes this switch before the options of the first wave are read: parseSweepArgs has to learn it.\n`, `// --round-trip is read here and not by parseSweepArgs.\n`],
  [
    t,
    `// Research prototype of test/cli/lint/conformance.test.ts, wired to the prototypes of the first wave and to the reference clone.\n// In the repository: "harness" for the absolute import, "./conformance/runner" for "./index", the committed corpus for referenceLayout().\n`,
    "",
  ],
  [t, `// Two switches of the prototype alone: other lists, and the check that replays the oracle in place of the binary.\n`, `// Two switches for work on the runner: other lists, and the check that replays the oracle in place of the binary.\n`],
  [r("baseline.ts"), `// Prototype of runner/baseline.ts: the list reader`, `// The list reader`],
  [r("checks.ts"), `// Research prototype: checks that need no command. They prove the pipeline before a linter exists.`, `// Checks that need no command: they prove the pipeline without a linter.`],
  [r("compiler_runner.ts"), `// Prototype port of the enumeration in internal/testrunner/compiler_runner.go and compiler_runner_test.go.`, `// Port of the enumeration in internal/testrunner/compiler_runner.go and compiler_runner_test.go of typescript-go 89d5d5b.`],
  [r("compiler_test.ts"), `// Research prototype: port of newCompilerTest (compiler_runner.go:266) and of the part of CompileFilesEx that builds the file system.`, `// Port of newCompilerTest (compiler_runner.go:266) and of the part of CompileFilesEx (harnessutil.go) that builds the file system, of typescript-go 89d5d5b.`],
  [r("config_files.ts"), `// Research prototype: the file names that a config unit selects`, `// The file names that a config unit selects`],
  [r("expectations.ts"), `// Prototype of runner/expectations.ts: the two lists`, `// The two lists`],
  [r("harnessutil.ts"), `// Prototype port of the parts of internal/testutil/harnessutil/harnessutil.go that enumeration and the skip rule reach.`, `// Port of the parts of internal/testutil/harnessutil/harnessutil.go of typescript-go 89d5d5b that enumeration and the skip rule reach.`],
  [r("manifest.ts"), `// Research prototype: the batch form. One process`, `// The batch form: one process`],
  [r("materialize.ts"), `// Research prototype: the file system of an instance`, `// The file system of an instance`],
  [r("run.ts"), `// Research prototype: one instance through a check`, `// One instance through a check`],
  [r("sweep_args.ts"), `// Prototype of the command line of sweep.ts`, `// The command line of sweep.ts`],
  [r("tsconfig.ts"), `// Prototype of the smallest config reader that the skip rule needs (tsoptions/tsconfigparsing.go, eight options and the extends chain).`, `// The smallest config reader that the skip rule needs: eight options and the extends chain of internal/tsoptions/tsconfigparsing.go of typescript-go 89d5d5b.`],
  [r("vfsmatch.ts"), `// Research prototype: port of internal/vfs/vfsmatch/vfsmatch.go, same names and order.`, `// Port of internal/vfs/vfsmatch/vfsmatch.go of typescript-go 89d5d5b, same names and order.`],
];

if (import.meta.main) {
  rmSync(out, { recursive: true, force: true });
  const texts = new Map<string, string>();
  for (const [committed, source] of moduleMap) {
    const from = join(notes, source);
    const to = join(out, committed);
    mkdirSync(dirname(to), { recursive: true });
    if (!committed.endsWith(".ts")) {
      cpSync(from, to);
      continue;
    }
    let text = readFileSync(from, "utf8");
    // The four imports of the test that name the directive-grammar prototype are replaced whole by an edit below.
    const direct = committed.endsWith("conformance.test.ts");
    if (direct) text = text.replace(/^import .* from "\.\.\/\.\.\/directive-grammar\/prototype\/[a-z_]+";$/gm, s => "//KEEP " + s);
    text = source.startsWith(here) ? text : rewriteImports(committed, source, text);
    if (direct) text = text.replace(/^\/\/KEEP /gm, "");
    texts.set(committed, text);
  }
  for (const [file, oldText, newText, times] of edits) {
    const text = texts.get(file);
    if (text === undefined) throw new Error("edit of a file that is not in the module map: " + file);
    const found = text.split(oldText).length - 1;
    if (found !== times) throw new Error(`${file}: the text of an edit occurs ${found} times, not ${times}: ${oldText.slice(0, 90)}`);
    texts.set(file, text.replaceAll(oldText, newText));
  }
  for (const [file, oldText, newText] of comments) {
    const text = texts.get(file);
    if (text === undefined) throw new Error("comment of a file that is not in the module map: " + file);
    if (!text.includes(oldText)) throw new Error(`${file}: no such comment: ${oldText.slice(0, 90)}`);
    texts.set(file, text.replaceAll(oldText, newText));
  }
  // test_case_parser.ts came without a first line.
  texts.set(r("test_case_parser.ts"), "// Port of internal/testrunner/test_case_parser.go of typescript-go 89d5d5b.\n" + texts.get(r("test_case_parser.ts"))!);
  for (const [file, text] of texts) writeFileSync(join(out, file), text);
  const edited = new Map<string, number>();
  for (const [file] of edits) edited.set(file, (edited.get(file) ?? 0) + 1);
  console.log(`${moduleMap.length} files in ${out}; ${edits.length} edits in ${edited.size} files`);
  for (const [committed, source] of moduleMap) console.log(`  ${committed}\t<- ${source}${edited.has(committed) ? "\t(" + edited.get(committed) + " edits)" : ""}`);
}
