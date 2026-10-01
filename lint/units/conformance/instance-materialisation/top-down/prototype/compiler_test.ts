// Prototype port of newCompilerTest (compiler_runner.go:266-338) and of the head of CompileFilesEx (harnessutil.go:125-218).
import { getConfigNameFromFileName, parseTestFilesAndSymlinks, srcFolder, type TestUnit } from "../../../enumerator/prototype/test_case_parser";
import { combinePaths, getNormalizedAbsolutePath, isRootedDiskPath, normalizePath, removeTrailingDirectorySeparator } from "../../../enumerator/prototype/tspath";
import { Undecided, getConfigFileNames } from "./config_files";
import { ExtensionDts, ExtensionJson, ExtensionTsBuildInfo, fileExtensionIs } from "./tspath_more";
import { MapFS } from "./vfs_model";

export interface TestFile {
  unitName: string;
  content: string;
}

export interface CompilerTest {
  currentDirectory: string;
  hasNonDtsFiles: boolean;
  tsConfigFiles: TestFile[];
  toBeCompiled: TestFile[];
  otherFiles: TestFile[];
  // harnessutil.go:125-156: the names given to the program
  programFileNames: string[];
  includeLibDir: boolean;
  // link to target, both absolute
  symlinks: Map<string, string>;
  useCaseSensitiveFileNames: boolean;
  configFileNames: string[] | undefined;
  configOptions?: unknown;
}

export type Result = { ok: true; value: CompilerTest } | { ok: false; status: "invalid" | "undecided-roots"; reason: string };

const requireStr = "require(";
// Go's \s is [\t\n\f\r ]
const referencesRegex = /reference[\t\n\f\r ]path/;
const testLibFolder = "/.lib";

// vfstest.go:84-137 and :154-162; returns the text of the panic
export function checkVfsPaths(paths: string[], targets: string[], useCaseSensitiveFileNames: boolean): string | undefined {
  let posix = false;
  let windows = false;
  for (const p of [...paths, ...targets]) {
    if (!isRootedDiskPath(p)) return `non-rooted path ${JSON.stringify(p)}`;
    if (removeTrailingDirectorySeparator(normalizePath(p)) !== p) return `non-normalized path ${JSON.stringify(p)}`;
    if (p.startsWith("/")) posix = true;
    else windows = true;
  }
  if (posix && windows) return "mixed posix and windows paths";
  if (!useCaseSensitiveFileNames) {
    const seen = new Map<string, string>();
    for (const p of paths) {
      // ToFileNameLowerCase: ASCII here; other letters need the table of the reference
      const canonical = p.toLowerCase();
      const other = seen.get(canonical);
      const cut = (x: string) => (x.startsWith("/") ? x.slice(1) : x);
      if (other !== undefined && other !== p) return `duplicate path: ${JSON.stringify(cut(other < p ? other : p))} and ${JSON.stringify(cut(other < p ? p : other))} have the same canonical path`;
      seen.set(canonical, p);
    }
  }
  return undefined;
}

function createHarnessTestFile(unit: TestUnit, currentDirectory: string): TestFile {
  return { unitName: getNormalizedAbsolutePath(unit.name, currentDirectory), content: unit.content };
}

export function newCompilerTest(content: string, fileName: string, configuration: Map<string, string> | undefined, extendsResolutions?: ReadonlyMap<string, string>): Result {
  // makeUnitsFromTest (test_case_parser.go:51)
  const parsed = parseTestFilesAndSymlinks<TestUnit>(content, fileName, (name, text) => ({ value: { name, content: text }, error: undefined }));
  if (!parsed.ok) return { ok: false, status: "invalid", reason: parsed.reason };
  const unitsCurrentDirectory = parsed.currentDirectory === "" ? srcFolder : parsed.currentDirectory;
  let units = parsed.units;
  {
    const paths = parsed.units.map(u => getNormalizedAbsolutePath(u.name, unitsCurrentDirectory));
    const targets: string[] = [];
    for (const [link, target] of parsed.symlinks) {
      paths.push(getNormalizedAbsolutePath(link, unitsCurrentDirectory));
      targets.push(getNormalizedAbsolutePath(target, unitsCurrentDirectory));
    }
    const panic = checkVfsPaths(paths, targets, true);
    if (panic !== undefined) return { ok: false, status: "invalid", reason: panic };
  }
  let configFileNames: string[] | undefined;
  let configOptions: unknown;
  let tsConfigFileUnitData: TestUnit | undefined;
  const index = units.findIndex(u => getConfigNameFromFileName(u.name) !== "");
  if (index >= 0) {
    const data = units[index];
    const allFiles = new Map<string, string>();
    for (const u of units) allFiles.set(getNormalizedAbsolutePath(u.name, unitsCurrentDirectory), u.content);
    const links = new Map<string, string>();
    for (const [link, target] of parsed.symlinks) {
      links.set(getNormalizedAbsolutePath(link, unitsCurrentDirectory), getNormalizedAbsolutePath(target, unitsCurrentDirectory));
    }
    // a link replaces a file of the same name (vfsparseconfighost.go:50-55)
    const files = [...allFiles.keys()].filter(f => !links.has(f));
    const fs = new MapFS(files, links);
    try {
      const r = getConfigFileNames(
        { fs, currentDirectory: unitsCurrentDirectory, read: p => (fs.fileExists(p) ? allFiles.get(fs.realpath(p)) : undefined), extendsResolutions },
        data.name,
        data.content,
      );
      configFileNames = r.fileNames;
      configOptions = r.options;
    } catch (e) {
      if (e instanceof Undecided) return { ok: false, status: "undecided-roots", reason: e.message };
      throw e;
    }
    if (fs.ambiguous) return { ok: false, status: "undecided-roots", reason: "two links are prefixes of one path" };
    tsConfigFileUnitData = data;
    units = units.slice(0, index).concat(units.slice(index + 1));
  }

  // newCompilerTest
  const harnessConfig = configuration;
  const currentDirectory = getNormalizedAbsolutePath(harnessConfig?.get("currentdirectory") ?? "", srcFolder);
  let toBeCompiled: TestFile[] = [];
  const otherFiles: TestFile[] = [];
  const hasNonDtsFiles = units.some(unit => !fileExtensionIs(unit.name, ExtensionDts));
  let tsConfigFiles: TestFile[] = [];
  if (configFileNames !== undefined && tsConfigFileUnitData !== undefined) {
    tsConfigFiles = [createHarnessTestFile(tsConfigFileUnitData, currentDirectory)];
    for (const unit of units) {
      if (configFileNames.includes(getNormalizedAbsolutePath(unit.name, currentDirectory))) toBeCompiled.push(createHarnessTestFile(unit, currentDirectory));
      else otherFiles.push(createHarnessTestFile(unit, currentDirectory));
    }
  } else {
    if (units.length === 0) return { ok: false, status: "invalid", reason: "no unit" };
    const lastUnit = units[units.length - 1];
    if ((harnessConfig?.get("noimplicitreferences") ?? "") !== "" || lastUnit.content.includes(requireStr) || referencesRegex.test(lastUnit.content)) {
      toBeCompiled.push(createHarnessTestFile(lastUnit, currentDirectory));
      for (const unit of units.slice(0, units.length - 1)) otherFiles.push(createHarnessTestFile(unit, currentDirectory));
    } else {
      toBeCompiled = units.map(unit => createHarnessTestFile(unit, currentDirectory));
    }
  }

  // CompileFiles and CompileFilesEx
  let useCaseSensitiveFileNames = true;
  const v = harnessConfig?.get("usecasesensitivefilenames");
  if (v !== undefined) {
    const lower = v.toLowerCase();
    if (lower === "true") useCaseSensitiveFileNames = true;
    else if (lower === "false") useCaseSensitiveFileNames = false;
    else return { ok: false, status: "invalid", reason: `Value for option 'useCaseSensitiveFileNames' must be a boolean, got: ${v}` };
  }
  // commandlineparser.go:347 for a list of strings: no trimming of the elements, empty elements dropped
  let libFiles: string[] = [];
  const rawLibFiles = harnessConfig?.get("libfiles");
  if (rawLibFiles !== undefined) {
    const value = rawLibFiles.trim();
    if (!value.startsWith("-") && value !== "") libFiles = value.split(",").filter(v => v !== "");
  }
  // harnessutil.go:90-110: the options of the config unit, then the settings of the case
  let noLib = (configOptions as { noLib?: number } | undefined)?.noLib === 2;
  const rawNoLib = harnessConfig?.get("nolib");
  if (rawNoLib !== undefined) {
    const lower = rawNoLib.toLowerCase();
    if (lower !== "true" && lower !== "false") return { ok: false, status: "invalid", reason: `Value for option 'noLib' must be a boolean, got: ${rawNoLib}` };
    noLib = lower === "true";
  }
  const programFileNames: string[] = [];
  for (const file of toBeCompiled) {
    const name = getNormalizedAbsolutePath(file.unitName, currentDirectory);
    if (!fileExtensionIs(name, ExtensionJson) && !fileExtensionIs(name, ExtensionTsBuildInfo)) programFileNames.push(name);
  }
  let includeLibDir = toBeCompiled.some(file => file.content.includes(testLibFolder + "/"));
  for (const libFile of libFiles) {
    if (libFile === "lib.d.ts" && !noLib) continue;
    programFileNames.push(combinePaths(testLibFolder, libFile));
    includeLibDir = true;
  }
  const symlinks = new Map<string, string>();
  for (const [src, target] of parsed.symlinks) {
    symlinks.set(getNormalizedAbsolutePath(src, currentDirectory), getNormalizedAbsolutePath(target, currentDirectory));
  }
  void combinePaths;
  {
    const paths = [...toBeCompiled, ...otherFiles].map(f => f.unitName);
    for (const l of symlinks.keys()) paths.push(l);
    const panic = checkVfsPaths([...new Set(paths)], [...symlinks.values()], useCaseSensitiveFileNames);
    if (panic !== undefined) return { ok: false, status: "invalid", reason: panic };
  }
  return {
    ok: true,
    value: { currentDirectory, hasNonDtsFiles, tsConfigFiles, toBeCompiled, otherFiles, programFileNames, includeLibDir, symlinks, useCaseSensitiveFileNames, configFileNames, configOptions },
  };
}
