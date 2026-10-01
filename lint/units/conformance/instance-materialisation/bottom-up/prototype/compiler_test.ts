// Research prototype: port of newCompilerTest (compiler_runner.go:266) and of the part of CompileFilesEx that builds the file system.
import { Undecided, getConfigFileNames } from "./config_files";
import { MemFs, MemFsPanic, type MemInput } from "./memfs";
import { type TestUnit, getConfigNameFromFileName, parseTestFilesAndSymlinks, srcFolder } from "./test_case_parser";
import { combinePaths, getNormalizedAbsolutePath, isRootedDiskPath } from "./tspath";
import { ExtensionDts, ExtensionJson, ExtensionTsBuildInfo, fileExtensionIs } from "./tspath_more";

// harnessutil.go:41
export const testLibFolder = "/.lib";
// compiler_runner.go:29; Go's \s is [\t\n\f\r ]
const requireStr = "require(";
const referencesRegex = /reference[\t\n\f\r ]path/;

export interface TestFile {
  unitName: string;
  content: string;
}

export type RootRule = "config" | "noImplicitReferences" | "require" | "reference path" | "all";

export interface CompilerTest {
  currentDirectory: string;
  tsConfigFiles: TestFile[];
  toBeCompiled: TestFile[];
  otherFiles: TestFile[];
  hasNonDtsFiles: boolean;
  rule: RootRule;
  // link path to target, as the directives give them
  symlinks: Map<string, string>;
  // the file names of the config, when there is a config unit
  configFileNames: string[] | undefined;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: "invalid" | "undecided"; reason: string };

const encoder = new TextEncoder();

function createHarnessTestFile(unit: TestUnit, currentDirectory: string): TestFile {
  return { unitName: getNormalizedAbsolutePath(unit.name, currentDirectory), content: unit.content };
}

// makeUnitsFromTest (test_case_parser.go:51) followed by newCompilerTest (compiler_runner.go:266)
export function newCompilerTest(code: string, fileName: string, harnessConfig: Map<string, string> | undefined): Result<CompilerTest> {
  const parsed = parseTestFilesAndSymlinks<TestUnit>(code, fileName, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!parsed.ok) return { ok: false, status: "invalid", reason: parsed.reason };
  let units = parsed.units;
  const symlinks = parsed.symlinks;
  const unitsCurrentDirectory = parsed.currentDirectory === "" ? srcFolder : parsed.currentDirectory;

  // unit tests always list files explicitly
  const entries = new Map<string, MemInput>();
  for (const data of units) {
    entries.set(getNormalizedAbsolutePath(data.name, unitsCurrentDirectory), { kind: "file", data: encoder.encode(data.content) });
  }
  for (const [link, target] of symlinks) {
    entries.set(getNormalizedAbsolutePath(link, unitsCurrentDirectory), { kind: "symlink", target: getNormalizedAbsolutePath(target, unitsCurrentDirectory) });
  }
  let parseConfigHost: MemFs;
  try {
    parseConfigHost = new MemFs(entries, true);
  } catch (e) {
    if (e instanceof MemFsPanic) return { ok: false, status: "invalid", reason: e.message };
    throw e;
  }

  // check if project has tsconfig.json in the list of files
  let configFileNames: string[] | undefined;
  let tsConfigFileUnitData: TestUnit | undefined;
  for (let i = 0; i < units.length; i++) {
    const data = units[i];
    if (getConfigNameFromFileName(data.name) !== "") {
      try {
        configFileNames = getConfigFileNames(parseConfigHost, data.name, data.content, unitsCurrentDirectory).fileNames;
      } catch (e) {
        if (e instanceof Undecided) return { ok: false, status: "undecided", reason: e.message };
        throw e;
      }
      tsConfigFileUnitData = data;
      units = units.slice(0, i).concat(units.slice(i + 1));
      break;
    }
  }

  const currentDirectory = getNormalizedAbsolutePath(harnessConfig?.get("currentdirectory") ?? "", srcFolder);
  let toBeCompiled: TestFile[] = [];
  const otherFiles: TestFile[] = [];
  const hasNonDtsFiles = units.some(unit => !fileExtensionIs(unit.name, ExtensionDts));
  const tsConfigFiles: TestFile[] = [];
  let rule: RootRule;
  if (configFileNames !== undefined && tsConfigFileUnitData !== undefined) {
    rule = "config";
    tsConfigFiles.push(createHarnessTestFile(tsConfigFileUnitData, currentDirectory));
    for (const unit of units) {
      if (configFileNames.includes(getNormalizedAbsolutePath(unit.name, currentDirectory))) {
        toBeCompiled.push(createHarnessTestFile(unit, currentDirectory));
      } else {
        otherFiles.push(createHarnessTestFile(unit, currentDirectory));
      }
    }
  } else {
    const baseUrl = harnessConfig?.get("baseurl");
    if (harnessConfig !== undefined && baseUrl !== undefined && !isRootedDiskPath(baseUrl)) {
      harnessConfig.set("baseurl", getNormalizedAbsolutePath(baseUrl, currentDirectory));
    }
    // the reference indexes units[len(units)-1]; a case whose only unit is the config would panic there
    if (units.length === 0) return { ok: false, status: "invalid", reason: "no unit besides the config" };
    const lastUnit = units[units.length - 1];
    const nir = (harnessConfig?.get("noimplicitreferences") ?? "") !== "";
    if (nir || lastUnit.content.includes(requireStr) || referencesRegex.test(lastUnit.content)) {
      rule = nir ? "noImplicitReferences" : lastUnit.content.includes(requireStr) ? "require" : "reference path";
      toBeCompiled.push(createHarnessTestFile(lastUnit, currentDirectory));
      for (const unit of units.slice(0, units.length - 1)) otherFiles.push(createHarnessTestFile(unit, currentDirectory));
    } else {
      rule = "all";
      toBeCompiled = units.map(unit => createHarnessTestFile(unit, currentDirectory));
    }
  }
  return { ok: true, value: { currentDirectory, tsConfigFiles, toBeCompiled, otherFiles, hasNonDtsFiles, rule, symlinks, configFileNames } };
}

export interface HarnessFs {
  // the file names that make the program, in order (harnessutil.go:125 and :146)
  programFileNames: string[];
  // true when the directory of test libraries is mounted (harnessutil.go:144 and :154)
  includeLibDir: boolean;
  // absolute name to entry, in the order of the reference: roots, other files, links; a later entry replaces an earlier one
  entries: Map<string, MemInput>;
  useCaseSensitiveFileNames: boolean;
}

export interface HarnessFsOptions {
  libFiles: string[];
  noLib: boolean;
  useCaseSensitiveFileNames: boolean;
}

// CompileFilesEx (harnessutil.go:115) up to vfstest.FromMap, without the files of the test library directory
export function buildHarnessFs(test: CompilerTest, opts: HarnessFsOptions): HarnessFs {
  const currentDirectory = test.currentDirectory;
  const programFileNames: string[] = [];
  for (const file of test.toBeCompiled) {
    const fileName = getNormalizedAbsolutePath(file.unitName, currentDirectory);
    if (!fileExtensionIs(fileName, ExtensionJson) && !fileExtensionIs(fileName, ExtensionTsBuildInfo)) programFileNames.push(fileName);
  }
  let includeLibDir = test.toBeCompiled.some(file => file.content.includes(testLibFolder + "/"));
  for (const libFile of opts.libFiles) {
    if (libFile === "lib.d.ts" && !opts.noLib) continue;
    programFileNames.push(combinePaths(testLibFolder, libFile));
    includeLibDir = true;
  }
  const entries = new Map<string, MemInput>();
  const put = (name: string, e: MemInput) => {
    entries.delete(name);
    entries.set(name, e);
  };
  for (const file of test.toBeCompiled) put(getNormalizedAbsolutePath(file.unitName, currentDirectory), { kind: "file", data: encoder.encode(file.content) });
  for (const file of test.otherFiles) put(getNormalizedAbsolutePath(file.unitName, currentDirectory), { kind: "file", data: encoder.encode(file.content) });
  for (const [src, target] of test.symlinks) {
    put(getNormalizedAbsolutePath(src, currentDirectory), { kind: "symlink", target: getNormalizedAbsolutePath(target, currentDirectory) });
  }
  return { programFileNames, includeLibDir, entries, useCaseSensitiveFileNames: opts.useCaseSensitiveFileNames };
}
