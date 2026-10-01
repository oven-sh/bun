// Prototype port of the enumeration in internal/testrunner/compiler_runner.go and compiler_runner_test.go.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  HarnessFatal,
  type NamedTestConfiguration,
  emptySkipRelevantOptions,
  getCompilerVaryByMap,
  getFileBasedTestConfigurations,
  setOptionsFromTestConfig,
  skipUnsupportedCompilerOptions,
  type SkipRelevantOptions,
} from "./harnessutil";
import { extractCompilerSettings, getConfigNameFromFileName, parseTestFilesAndSymlinks, srcFolder } from "./test_case_parser";
import { parseJsonSourceFileConfigFileContent } from "./tsconfig";
import {
  getAnyExtensionFromPath,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
  normalizePath,
  removeTrailingDirectorySeparator,
} from "./tspath";
import { readFile } from "./vfs";

export type Suite = "compiler" | "conformance";
export type Status = "run" | "skipped" | "invalid";
export type Kind = "E" | "C";

export interface Instance {
  // configuredName of the reference, the stem of every baseline of the instance: `name(config).ts`
  name: string;
  // the subtest name of the reference before Go rewrites it: `name.ts config`
  testName: string;
  suite: Suite;
  // path of the case below the cases directory, with forward slashes
  casePath: string;
  configName: string;
  // undefined when the case has no setting at all (the reference passes a nil configuration)
  config: Map<string, string> | undefined;
  status: Status;
  reason: string;
  // set for run instances when a baseline directory is given
  kind: Kind | undefined;
  tags: string[];
}

// compiler_runner.go:86
export const skippedTests: readonly string[] = [
  "APILibCheck.ts",
  "APISample_Watch.ts",
  "APISample_WatchWithDefaults.ts",
  "APISample_WatchWithOwnWatchHost.ts",
  "APISample_compile.ts",
  "APISample_jsdoc.ts",
  "APISample_linter.ts",
  "APISample_parseConfig.ts",
  "APISample_transform.ts",
  "APISample_watcher.ts",
  "preserveUnusedImports.ts",
  "noCrashWithVerbatimModuleSyntaxAndImportsNotUsedAsValues.ts",
  "verbatimModuleSyntaxCompat.ts",
  "verbatimModuleSyntaxCompat2.ts",
  "verbatimModuleSyntaxCompat3.ts",
  "verbatimModuleSyntaxCompat4.ts",
  "preserveValueImports.ts",
  "preserveValueImports_importsNotUsedAsValues.ts",
  "preserveValueImports_errors.ts",
  "preserveValueImports_mixedImports.ts",
  "preserveValueImports_module.ts",
  "importsNotUsedAsValues_error.ts",
  "alwaysStrictNoImplicitUseStrict.ts",
  "nonPrimitiveIndexingWithForInSupressError.ts",
  "parameterInitializerBeforeDestructuringEmit.ts",
  "mappedTypeUnionConstraintInferences.ts",
  "lateBoundConstraintTypeChecksCorrectly.ts",
  "keyofDoesntContainSymbols.ts",
  "isolatedModulesOut.ts",
  "noStrictGenericChecks.ts",
  "noImplicitUseStrict_umd.ts",
  "noImplicitUseStrict_system.ts",
  "noImplicitUseStrict_es6.ts",
  "noImplicitUseStrict_commonjs.ts",
  "noImplicitUseStrict_amd.ts",
  "noImplicitAnyIndexingSuppressed.ts",
  "excessPropertyErrorsSuppressed.ts",
  "moduleNoneDynamicImport.ts",
  "moduleNoneErrors.ts",
  "moduleNoneOutFile.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile1.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile2.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile3.ts",
  "requireOfJsonFileWithModuleEmitNone.ts",
  "requireOfJsonFileWithModuleNodeResolutionEmitNone.ts",
];

// compiler_runner.go:441; the JavaScript output subtest of these is skipped, the error baseline is still compared
export const skippedEmitTests: ReadonlyMap<string, string> = new Map([
  ["filesEmittingIntoSameOutput.ts", "Output order nondeterministic due to collision on filename during parallel emit."],
  ["jsFileCompilationWithJsEmitPathSameAsInput.ts", "Output order nondeterministic due to collision on filename during parallel emit."],
  ["grammarErrors.ts", "Output order nondeterministic due to collision on filename during parallel emit."],
  ["jsFileCompilationEmitBlockedCorrectly.ts", "Output order nondeterministic due to collision on filename during parallel emit."],
  ["jsDeclarationsReexportAliasesEsModuleInterop.ts", "cls.d.ts is missing statements when run concurrently."],
  ["jsFileCompilationWithoutJsExtensions.ts", "No files are emitted."],
  ["typeOnlyMerge2.ts", "Nondeterministic contents when run concurrently."],
  ["typeOnlyMerge3.ts", "Nondeterministic contents when run concurrently."],
]);

const compilerBaselineRegex = /\.tsx?$/;
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

// harnessutil.go:1002; os.ReadDir sorts the entries of a directory by name
export function enumerateFiles(folder: string, recursive: boolean): string[] {
  const paths: string[] = [];
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return paths;
  }
  entries.sort((a, b) => byBytes(a.name, b.name));
  for (const entry of entries) {
    const path = folder + "/" + entry.name;
    if (!entry.isDirectory()) {
      if (compilerBaselineRegex.test(path)) paths.push(path);
    } else if (recursive) {
      for (const p of enumerateFiles(path, recursive)) paths.push(p);
    }
  }
  return paths;
}

const compilerVaryBy = getCompilerVaryByMap();

// vfstest.go:84; returns the panic text, undefined when the map of files is acceptable
function checkVfsPaths(paths: string[]): string | undefined {
  let posix = false;
  let windows = false;
  for (const p of [...paths].sort(byBytes)) {
    if (!isRootedDiskPath(p)) return `non-rooted path ${JSON.stringify(p)}`;
    if (removeTrailingDirectorySeparator(normalizePath(p)) !== p) return `non-normalized path ${JSON.stringify(p)}`;
    if (p.startsWith("/")) posix = true;
    else windows = true;
  }
  if (posix && windows) return "mixed posix and windows paths";
  return undefined;
}

export interface CaseInfo {
  configurations: NamedTestConfiguration[];
  // text of the failure that stops the reference before any instance of the file starts
  fatal: string | undefined;
  content: string;
}

// compiler_runner.go:232
export function getCompilerFileBasedTest(content: string): CaseInfo {
  try {
    const settings = extractCompilerSettings(content);
    return { configurations: getFileBasedTestConfigurations(settings, compilerVaryBy), fatal: undefined, content };
  } catch (e) {
    if (e instanceof HarnessFatal) return { configurations: [], fatal: e.message, content };
    throw e;
  }
}

export interface StatusResult {
  status: Status;
  reason: string;
  options: SkipRelevantOptions;
  notes: string[];
  hasConfigUnit: boolean;
}

// compiler_runner.go:206 up to the call of SkipUnsupportedCompilerOptions, without the compilation
export function getStatus(content: string, fileName: string, config: Map<string, string> | undefined): StatusResult {
  const notes: string[] = [];
  let options = emptySkipRelevantOptions();
  const invalid = (reason: string, hasConfigUnit = false): StatusResult => ({ status: "invalid", reason, options, notes, hasConfigUnit });

  // makeUnitsFromTest
  const parsedUnits = parseTestFilesAndSymlinks(content, fileName, (name, text) => ({ value: { name, content: text }, error: undefined }));
  if (!parsedUnits.ok) return invalid(parsedUnits.reason);
  const unitsCurrentDirectory = parsedUnits.currentDirectory === "" ? srcFolder : parsedUnits.currentDirectory;
  const allFiles = new Map<string, string>();
  for (const data of parsedUnits.units) allFiles.set(getNormalizedAbsolutePath(data.name, unitsCurrentDirectory), data.content);
  const vfsPaths = [...allFiles.keys()];
  for (const [link, target] of parsedUnits.symlinks) {
    vfsPaths.push(getNormalizedAbsolutePath(link, unitsCurrentDirectory));
    vfsPaths.push(getNormalizedAbsolutePath(target, unitsCurrentDirectory));
  }
  const vfsPanic = checkVfsPaths(vfsPaths);
  if (vfsPanic !== undefined) return invalid(vfsPanic);

  const configUnit = parsedUnits.units.find(u => getConfigNameFromFileName(u.name) !== "");
  const hasConfigUnit = configUnit !== undefined;
  if (configUnit !== undefined) {
    const configFileName = getNormalizedAbsolutePath(configUnit.name, unitsCurrentDirectory);
    const configDir = getDirectoryPath(configFileName);
    const parsed = parseJsonSourceFileConfigFileContent(
      configUnit.content,
      { files: allFiles, currentDirectory: unitsCurrentDirectory },
      configDir,
      configFileName,
    );
    for (const n of parsed.notes) notes.push(n);
    if (parsed.options !== undefined) options = parsed.options;
  }

  // newCompilerTest
  const harnessConfig = config;
  const currentDirectory = getNormalizedAbsolutePath(harnessConfig?.get("currentdirectory") ?? "", srcFolder);
  if (!hasConfigUnit && harnessConfig !== undefined) {
    const baseUrl = harnessConfig.get("baseurl");
    if (baseUrl !== undefined && !isRootedDiskPath(baseUrl)) {
      harnessConfig.set("baseurl", getNormalizedAbsolutePath(baseUrl, currentDirectory));
    }
  }

  // CompileFiles
  if (harnessConfig !== undefined) {
    try {
      setOptionsFromTestConfig(harnessConfig, options, currentDirectory);
    } catch (e) {
      if (e instanceof HarnessFatal) return invalid(e.message, hasConfigUnit);
      throw e;
    }
  }
  // CompileFilesEx
  if (options.baseUrl !== "") options.baseUrl = getNormalizedAbsolutePath(options.baseUrl, currentDirectory);

  const reason = skipUnsupportedCompilerOptions(options);
  if (reason !== undefined) return { status: "skipped", reason, options, notes, hasConfigUnit };
  return { status: "run", reason: "", options, notes, hasConfigUnit };
}

// compiler_runner.go:266
export function getConfiguredName(basename: string, configName: string): string {
  if (configName === "") return basename;
  const extname = getAnyExtensionFromPath(basename);
  const extensionlessBasename = basename.slice(0, basename.length - extname.length);
  return `${extensionlessBasename}(${configName})${extname}`;
}

export interface EnumerateOptions {
  // directory that holds `compiler` and `conformance`
  casesRoot: string;
  suites?: Suite[];
  // a directory below the suite to enumerate alone, for example "conformance/types/tuple"
  only?: string;
  recursive?: boolean;
  // keeps the files of skippedTests in the result, as status "invalid" with a reason, for the probes
  includeSkippedTests?: boolean;
}

export interface Enumeration {
  instances: Instance[];
  // base names dropped by skippedTests, in enumeration order
  droppedBySkippedTests: string[];
  files: number;
  notes: Map<string, string[]>;
}

// compiler_runner_test.go:20 and compiler_runner.go:137
export function enumerateInstances(opts: EnumerateOptions): Enumeration {
  const suites: Suite[] = opts.suites ?? ["compiler", "conformance"];
  const instances: Instance[] = [];
  const dropped: string[] = [];
  const notes = new Map<string, string[]>();
  let files = 0;
  for (const suite of suites) {
    const base = opts.casesRoot + "/" + suite;
    let folder = base;
    if (opts.only !== undefined) {
      if (opts.only !== suite && !opts.only.startsWith(suite + "/")) continue;
      folder = opts.casesRoot + "/" + opts.only;
    }
    for (const filename of enumerateFiles(folder, opts.recursive ?? true)) {
      files++;
      const basename = getBaseFileName(filename);
      const casePath = filename.slice(opts.casesRoot.length + 1);
      if (skippedTests.includes(basename)) {
        dropped.push(basename);
        if (!opts.includeSkippedTests) continue;
      }
      const read = readFile(filename);
      if (!read.ok) {
        instances.push({ name: basename, testName: basename, suite, casePath, configName: "", config: undefined, status: "invalid", reason: "Could not read test file: " + filename, kind: undefined, tags: [] });
        continue;
      }
      const test = getCompilerFileBasedTest(read.contents);
      if (test.fatal !== undefined) {
        instances.push({ name: basename, testName: basename, suite, casePath, configName: "", config: undefined, status: "invalid", reason: test.fatal, kind: undefined, tags: [] });
        continue;
      }
      const configs: (NamedTestConfiguration | undefined)[] = test.configurations.length > 0 ? test.configurations : [undefined];
      for (const config of configs) {
        const configName = config?.name ?? "";
        const testName = configName !== "" ? basename + " " + configName : basename;
        const name = getConfiguredName(basename, configName);
        const st = getStatus(read.contents, filename, config?.config);
        if (st.notes.length > 0) notes.set(name, st.notes);
        const tags: string[] = [];
        if (skippedEmitTests.has(basename)) tags.push("skipped-emit");
        instances.push({ name, testName, suite, casePath, configName, config: config?.config, status: st.status, reason: st.reason, kind: undefined, tags });
      }
    }
  }
  return { instances, droppedBySkippedTests: dropped, files, notes };
}
