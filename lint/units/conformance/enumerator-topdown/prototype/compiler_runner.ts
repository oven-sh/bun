// Research probe: enumeration of instances and their status, after compiler_runner.go and harnessutil.go.
import { readdirSync } from "node:fs";
import libNameList from "./libnames.json";
import { readFile } from "./dg/vfs";
import { extractCompilerSettings, makeUnitsFromTest, srcFolder, type TestCaseContent } from "./dg/test_case_parser";
import { getFileBasedTestConfigurations, trimSpace, type NamedTestConfiguration, type TestConfiguration } from "./harnessutil";
import { compilerVaryBy, enumMapOf, getCommandLineOption, getHarnessOption, ModuleKind, ModuleResolutionKind, ScriptTarget, type CommandLineOption } from "./options";
import { emptySkipOptions, readConfigForSkip, TSFalse, TSTrue, type SkipOptions } from "./tsconfig";
import { getAnyExtensionFromPath, getBaseFileName, getNormalizedAbsolutePath, isRootedDiskPath, normalizePath, removeTrailingDirectorySeparator } from "./tspath";

export type Suite = "compiler" | "conformance";
export type Status = "run" | "skipped" | "invalid";

export interface Instance {
  // The configured name, which is the stem of every baseline of the instance.
  name: string;
  // The subtest name of the reference: the base name, then a space and the configuration name.
  testName: string;
  suite: Suite;
  // Path of the case below the suite directory, with forward slashes.
  casePath: string;
  configurationName: string;
  configuration: Record<string, string>;
  status: Status;
  reason: string;
  notes: string[];
  emitSkipped: boolean;
}

// compiler_runner.go:86-135
export const skippedTests: readonly string[] = [
  "APILibCheck.ts", "APISample_Watch.ts", "APISample_WatchWithDefaults.ts", "APISample_WatchWithOwnWatchHost.ts",
  "APISample_compile.ts", "APISample_jsdoc.ts", "APISample_linter.ts", "APISample_parseConfig.ts",
  "APISample_transform.ts", "APISample_watcher.ts",
  "preserveUnusedImports.ts", "noCrashWithVerbatimModuleSyntaxAndImportsNotUsedAsValues.ts",
  "verbatimModuleSyntaxCompat.ts", "verbatimModuleSyntaxCompat2.ts", "verbatimModuleSyntaxCompat3.ts",
  "verbatimModuleSyntaxCompat4.ts", "preserveValueImports.ts", "preserveValueImports_importsNotUsedAsValues.ts",
  "preserveValueImports_errors.ts", "preserveValueImports_mixedImports.ts", "preserveValueImports_module.ts",
  "importsNotUsedAsValues_error.ts", "alwaysStrictNoImplicitUseStrict.ts",
  "nonPrimitiveIndexingWithForInSupressError.ts", "parameterInitializerBeforeDestructuringEmit.ts",
  "mappedTypeUnionConstraintInferences.ts", "lateBoundConstraintTypeChecksCorrectly.ts",
  "keyofDoesntContainSymbols.ts", "isolatedModulesOut.ts", "noStrictGenericChecks.ts",
  "noImplicitUseStrict_umd.ts", "noImplicitUseStrict_system.ts", "noImplicitUseStrict_es6.ts",
  "noImplicitUseStrict_commonjs.ts", "noImplicitUseStrict_amd.ts", "noImplicitAnyIndexingSuppressed.ts",
  "excessPropertyErrorsSuppressed.ts", "moduleNoneDynamicImport.ts", "moduleNoneErrors.ts", "moduleNoneOutFile.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile1.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile2.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile3.ts",
  "requireOfJsonFileWithModuleEmitNone.ts", "requireOfJsonFileWithModuleNodeResolutionEmitNone.ts",
];
const skippedTestSet = new Set(skippedTests);

// compiler_runner.go:441-450
export const skippedEmitTests: readonly string[] = [
  "filesEmittingIntoSameOutput.ts", "jsFileCompilationWithJsEmitPathSameAsInput.ts", "grammarErrors.ts",
  "jsFileCompilationEmitBlockedCorrectly.ts", "jsDeclarationsReexportAliasesEsModuleInterop.ts",
  "jsFileCompilationWithoutJsExtensions.ts", "typeOnlyMerge2.ts", "typeOnlyMerge3.ts",
];
const skippedEmitSet = new Set(skippedEmitTests);

const compilerBaselineRegex = /\.tsx?$/;
const encoder = new TextEncoder();
function compareBytes(a: string, b: string): number {
  return Buffer.compare(encoder.encode(a), encoder.encode(b));
}

// harnessutil.go:990-1024; os.ReadDir sorts by file name, files and directories together.
export function enumerateFiles(folder: string, recursive: boolean): string[] {
  const paths: string[] = [];
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return paths;
  }
  entries.sort((a, b) => compareBytes(a.name, b.name));
  for (const entry of entries) {
    const path = folder + "/" + entry.name;
    if (!entry.isDirectory()) {
      if (compilerBaselineRegex.test(path)) paths.push(path);
    } else if (recursive) {
      paths.push(...enumerateFiles(path, recursive));
    }
  }
  return paths;
}

const moduleKindNames = new Map<number, string>(Object.entries(ModuleKind).map(([k, v]) => [v, k]));
const scriptTargetNames = new Map<number, string>(Object.entries(ScriptTarget).map(([k, v]) => [v, k]));

// harnessutil.go:1236-1265
export function skipUnsupportedCompilerOptions(options: SkipOptions): string | undefined {
  switch (options.module) {
    case ModuleKind.AMD: case ModuleKind.UMD: case ModuleKind.System:
      return `unsupported module kind ${moduleKindNames.get(options.module)}`;
  }
  switch (options.moduleResolution) {
    case ModuleResolutionKind.Node10: case ModuleResolutionKind.Classic:
      return `unsupported module resolution kind ${options.moduleResolution}`;
  }
  if (options.esModuleInterop === TSFalse) return "esModuleInterop=false is unsupported";
  if (options.allowSyntheticDefaultImports === TSFalse) return "allowSyntheticDefaultImports=false is unsupported";
  if (options.baseUrl !== "") return `unsupported baseUrl ${options.baseUrl}`;
  if (options.outFile !== "") return `unsupported outFile ${options.outFile}`;
  switch (options.target) {
    case ScriptTarget.ES5:
      return `unsupported target ${scriptTargetNames.get(options.target)}`;
  }
  if (options.alwaysStrict === TSFalse) return "alwaysStrict=false is unsupported";
  return undefined;
}

// tsoptions/commandlineparser.go:347-390, reduced to the question whether the reference fails on the value.
function listValueProblem(option: CommandLineOption, value: string): string | undefined {
  const v = trimSpace(value);
  if (v.startsWith("-") || v === "") return undefined;
  const elements = listElementKind[option.name];
  if (elements === undefined) return `list option '${option.name}' has no element declaration`;
  if (elements === "string") return undefined;
  if (elements === "object") return "List of object is not yet supported.";
  for (const item of v.split(",")) {
    const s = trimWhiteSpaceLike(item);
    if (s === "") continue;
    if (!libNames.has(s.toLowerCase())) return `Unknown value '${value}' for compiler option '${option.name}'`;
  }
  return undefined;
}
// tsoptions/commandlineoption.go:105-180, the element kind of each list option.
const listElementKind: Record<string, "string" | "enum" | "object"> = {
  lib: "enum", rootDirs: "string", typeRoots: "string", types: "string", moduleSuffixes: "string",
  customConditions: "string", plugins: "object", libFiles: "string",
};
const libNames = new Set<string>(libNameList as string[]);
export function setLibNames(_names: Iterable<string>) {}
// stringutil.IsWhiteSpaceLike, as strings.TrimFunc applies it.
function isWhiteSpaceLike(ch: number): boolean {
  switch (ch) {
    case 0x20: case 0x09: case 0x0b: case 0x0c: case 0x85: case 0xa0: case 0x1680: case 0x200b: case 0x202f:
    case 0x205f: case 0x3000: case 0xfeff: case 0x0a: case 0x0d: case 0x2028: case 0x2029:
      return true;
  }
  return ch >= 0x2000 && ch <= 0x200a;
}
function trimWhiteSpaceLike(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isWhiteSpaceLike(s.charCodeAt(start))) start++;
  while (end > start && isWhiteSpaceLike(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}
// strconv.Atoi: an optional sign, decimal digits, and a value that fits in 64 bits.
function isGoInt(value: string): boolean {
  if (!/^[+-]?[0-9]+$/.test(value)) return false;
  const n = BigInt(value.startsWith("+") ? value.slice(1) : value);
  return n >= -(2n ** 63n) && n <= 2n ** 63n - 1n;
}

// harnessutil.go:292-317 and 443-486; the keys are visited in sorted order, where the reference visits a Go map.
export function setOptionsFromTestConfig(testConfig: TestConfiguration, options: SkipOptions, currentDirectory: string): string | undefined {
  const names = [...testConfig.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const value = testConfig.get(name)!;
    if (name === "typescriptversion") continue;
    const option = getCommandLineOption(name) ?? getHarnessOption(name);
    if (option === undefined) return `Unknown compiler option '${name}'.`;
    const isCompilerOption = getCommandLineOption(name) !== undefined;
    switch (option.kind) {
      case "String": {
        const v = option.isFilePath ? getNormalizedAbsolutePath(value, currentDirectory) : value;
        if (isCompilerOption) {
          if (option.name === "baseUrl") options.baseUrl = v;
          if (option.name === "outFile") options.outFile = v;
        }
        break;
      }
      case "Number":
        if (!isGoInt(value)) return `Value for option '${option.name}' must be a number, got: ${value}`;
        break;
      case "Boolean": {
        const lower = value.toLowerCase();
        if (lower !== "true" && lower !== "false") return `Value for option '${option.name}' must be a boolean, got: ${value}`;
        if (isCompilerOption) {
          const t = lower === "true" ? TSTrue : TSFalse;
          if (option.name === "esModuleInterop") options.esModuleInterop = t;
          if (option.name === "allowSyntheticDefaultImports") options.allowSyntheticDefaultImports = t;
          if (option.name === "alwaysStrict") options.alwaysStrict = t;
        }
        break;
      }
      case "Enum": {
        const map = enumMapOf(option) ?? [];
        const hit = map.find(([k]) => k === value.toLowerCase());
        if (hit === undefined) {
          return `Value for option '${option.name}' must be one of ${map.map(([k]) => k).join(",")}, got: ${value}`;
        }
        if (option.name === "module") options.module = hit[1];
        if (option.name === "moduleResolution") options.moduleResolution = hit[1];
        if (option.name === "target") options.target = hit[1];
        break;
      }
      case "List": case "ListOrElement": {
        const bad = listValueProblem(option, value);
        if (bad !== undefined) return bad;
        break;
      }
      case "Object":
        return `Object type options like '${option.name}' are not supported`;
    }
  }
  return undefined;
}

// vfstest.go:84-138, the checks that make FromMap panic.
function vfsProblem(paths: string[]): string | undefined {
  let posix = false;
  let windows = false;
  for (const p of paths) {
    if (!isRootedDiskPath(p)) return `non-rooted path ${JSON.stringify(p)}`;
    if (removeTrailingDirectorySeparator(normalizePath(p)) !== p) return `non-normalized path ${JSON.stringify(p)}`;
    if (p.startsWith("/")) posix = true;
    else windows = true;
  }
  if (posix && windows) return "mixed posix and windows paths";
  return undefined;
}

export interface CaseFacts {
  units: TestCaseContent | undefined;
  unitsProblem: string | undefined;
}

export function enumerateCase(suite: Suite, suiteRoot: string, filename: string): Instance[] {
  const basename = getBaseFileName(filename);
  const casePath = filename.slice(suiteRoot.length + 1);
  const base = { suite, casePath, notes: [] as string[], emitSkipped: skippedEmitSet.has(basename) };
  const file = readFile(filename);
  if (!file.ok) {
    return [{ ...base, name: basename, testName: basename, configurationName: "", configuration: {}, status: "invalid", reason: "Could not read test file: " + filename }];
  }
  const content = file.contents;
  const settings = extractCompilerSettings(content);
  const configurations = getFileBasedTestConfigurations(settings, compilerVaryBy);
  if (!configurations.ok) {
    return [{ ...base, name: basename, testName: basename, configurationName: "", configuration: {}, status: "invalid", reason: configurations.reason }];
  }
  const list: (NamedTestConfiguration | undefined)[] = configurations.value.length > 0 ? configurations.value : [undefined];
  const payload = makeUnitsFromTest(content, filename);
  const out: Instance[] = [];
  for (const config of list) {
    let testName = basename;
    let configuredName = basename;
    if (config !== undefined && config.name !== "") {
      testName += " " + config.name;
      const extname = getAnyExtensionFromPath(basename);
      configuredName = `${basename.slice(0, basename.length - extname.length)}(${config.name})${extname}`;
    }
    const configuration: Record<string, string> = {};
    if (config !== undefined) for (const [k, v] of [...config.config].sort((a, b) => (a[0] < b[0] ? -1 : 1))) configuration[k] = v;
    const inst: Instance = { ...base, notes: [], name: configuredName, testName, configurationName: config?.name ?? "", configuration, status: "run", reason: "" };
    out.push(inst);
    if (!payload.ok) {
      inst.status = "invalid";
      inst.reason = payload.reason;
      continue;
    }
    const units = payload.value;
    // test_case_parser.go:64-69
    const allFiles = new Map<string, string>();
    const everyUnit = units.tsConfigFileUnitData !== undefined ? [...units.testUnitData, units.tsConfigFileUnitData] : units.testUnitData;
    for (const data of everyUnit) allFiles.set(getNormalizedAbsolutePath(data.name, units.currentDirectory), data.content);
    const linkPaths: string[] = [];
    for (const [link, target] of units.symlinks) {
      linkPaths.push(getNormalizedAbsolutePath(link, units.currentDirectory), getNormalizedAbsolutePath(target, units.currentDirectory));
    }
    const problem = vfsProblem([...allFiles.keys(), ...linkPaths]);
    if (problem !== undefined) inst.notes.push("vfs: " + problem);

    let options = emptySkipOptions();
    if (units.tsConfigFileUnitData !== undefined) {
      const read = readConfigForSkip(
        { files: allFiles, hasSymlinks: units.symlinks.size > 0, currentDirectory: units.currentDirectory },
        units.tsConfigFileUnitData.name,
        units.tsConfigFileUnitData.content,
      );
      if (!read.ok) {
        inst.status = "invalid";
        inst.reason = read.reason;
        continue;
      }
      options = read.value.options;
      inst.notes.push(...read.value.notes);
    }
    // compiler_runner.go:290-291 and 318-321
    const harnessConfig: TestConfiguration = new Map(config?.config ?? []);
    const currentDirectory = getNormalizedAbsolutePath(harnessConfig.get("currentdirectory") ?? "", srcFolder);
    if (units.tsConfigFileUnitData === undefined) {
      const baseUrl = harnessConfig.get("baseurl");
      if (baseUrl !== undefined && !isRootedDiskPath(baseUrl)) {
        harnessConfig.set("baseurl", getNormalizedAbsolutePath(baseUrl, currentDirectory));
      }
    }
    // harnessutil.go:107-110; a nil configuration sets nothing.
    if (config !== undefined) {
      const failure = setOptionsFromTestConfig(harnessConfig, options, currentDirectory);
      if (failure !== undefined) {
        inst.status = "invalid";
        inst.reason = failure;
        continue;
      }
    }
    // harnessutil.go:176-178
    if (options.baseUrl !== "") options.baseUrl = getNormalizedAbsolutePath(options.baseUrl, currentDirectory);
    const reason = skipUnsupportedCompilerOptions(options);
    if (reason !== undefined) {
      inst.status = "skipped";
      inst.reason = reason;
    }
  }
  return out;
}

export function enumerateSuite(casesRoot: string, suite: Suite): { instances: Instance[]; files: number; dropped: string[] } {
  const suiteRoot = casesRoot + "/" + suite;
  const files = enumerateFiles(suiteRoot, true);
  const instances: Instance[] = [];
  const dropped: string[] = [];
  for (const filename of files) {
    if (skippedTestSet.has(getBaseFileName(filename))) {
      dropped.push(filename.slice(suiteRoot.length + 1));
      continue;
    }
    instances.push(...enumerateCase(suite, suiteRoot, filename));
  }
  return { instances, files: files.length, dropped };
}
