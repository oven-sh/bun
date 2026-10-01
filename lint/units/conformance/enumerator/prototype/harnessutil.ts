// Prototype port of the parts of internal/testutil/harnessutil/harnessutil.go that enumeration and the skip rule reach.
import table from "./options_table.json";
import { toLower, trimSpace, isWhiteSpaceLike } from "./stringutil";
import { getNormalizedAbsolutePath } from "./tspath";

export type OptionKind = "string" | "number" | "boolean" | "object" | "list" | "listOrElement" | "enum";

export interface CommandLineOption {
  name: string;
  kind: OptionKind;
  isFilePath: boolean;
  isCommandLineOnly: boolean;
  affects: boolean;
}

export const optionsDeclarations: CommandLineOption[] = (table.rows as any[]).map(r => ({
  name: r.name,
  kind: r.kind,
  isFilePath: r.isFilePath,
  isCommandLineOnly: r.isCommandLineOnly,
  affects: r.affects,
}));

const plain = (name: string, kind: OptionKind): CommandLineOption => ({
  name,
  kind,
  isFilePath: false,
  isCommandLineOnly: false,
  affects: false,
});

// harnessutil.go:319
export const compilerOptions: CommandLineOption[] = optionsDeclarations.concat([
  plain("allowNonTsExtensions", "boolean"),
  plain("noErrorTruncation", "boolean"),
  plain("suppressOutputPathCheck", "boolean"),
  plain("noCheck", "boolean"),
]);

// harnessutil.go:341
export const harnessCommandLineOptions: CommandLineOption[] = [
  plain("useCaseSensitiveFileNames", "boolean"),
  plain("baselineFile", "string"),
  plain("includeBuiltFile", "string"),
  plain("fileName", "string"),
  plain("libFiles", "list"),
  plain("noImplicitReferences", "boolean"),
  plain("currentDirectory", "string"),
  plain("symlink", "string"),
  plain("link", "string"),
  plain("noTypesAndSymbols", "boolean"),
  plain("fullEmitPaths", "boolean"),
  plain("reportDiagnostics", "boolean"),
  plain("captureSuggestions", "boolean"),
];

// commandlineoption.go:183
const enumMapNames: Record<string, string> = {
  lib: "LibMap",
  moduleResolution: "moduleResolutionOptionMap",
  module: "moduleOptionMap",
  target: "targetOptionMap",
  moduleDetection: "moduleDetectionOptionMap",
  jsx: "jsxOptionMap",
  newLine: "newLineOptionMap",
};

export function enumMap(optionName: string): Map<string, number | string> | undefined {
  const n = enumMapNames[optionName];
  if (n === undefined) return undefined;
  return new Map((table.enumMaps as any)[n] as [string, number | string][]);
}

// commandlineoption.go:105, the element declarations that a compiler or harness list option can have
const elements: Record<string, { kind: OptionKind; isFilePath: boolean; enumOf?: string }> = {
  lib: { kind: "enum", isFilePath: false, enumOf: "lib" },
  rootDirs: { kind: "string", isFilePath: true },
  typeRoots: { kind: "string", isFilePath: true },
  types: { kind: "string", isFilePath: false },
  moduleSuffixes: { kind: "string", isFilePath: false },
  customConditions: { kind: "string", isFilePath: false },
  plugins: { kind: "object", isFilePath: false },
  libFiles: { kind: "string", isFilePath: false },
};

// strings.EqualFold on ASCII names
function equalFold(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

// harnessutil.go:1182
export function getCommandLineOption(option: string): CommandLineOption | undefined {
  return compilerOptions.find(o => equalFold(o.name, option));
}

// harnessutil.go:399
export function getHarnessOption(name: string): CommandLineOption | undefined {
  return harnessCommandLineOptions.find(o => equalFold(o.name, name));
}

// compiler_runner.go:163
export function getCompilerVaryByMap(): Set<string> {
  const vary = new Set<string>();
  for (const o of optionsDeclarations) {
    if (!o.isCommandLineOnly && (o.kind === "boolean" || o.kind === "enum") && o.affects) vary.add(o.name.toLowerCase());
  }
  vary.add("noemit");
  vary.add("isolatedmodules");
  return vary;
}

export type TestConfiguration = Map<string, string>;
export interface NamedTestConfiguration {
  name: string;
  config: TestConfiguration;
}

export class HarnessFatal extends Error {}

type OptionValue = string | number | boolean;

// harnessutil.go:1158
function tryGetValueOfOptionString(option: string, value: string): { value: OptionValue; ok: boolean } {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return { value: "", ok: false };
  switch (optionDecl.kind) {
    case "enum": {
      const v = enumMap(optionDecl.name)?.get(toLower(value));
      if (v === undefined) return { value: "", ok: false };
      return { value: v, ok: true };
    }
    case "boolean":
      switch (toLower(value)) {
        case "true":
          return { value: true, ok: true };
        case "false":
          return { value: false, ok: true };
      }
      return { value: "", ok: false };
  }
  return { value, ok: true };
}

// harnessutil.go:1150
function getValueOfOptionString(option: string, value: string): OptionValue {
  const r = tryGetValueOfOptionString(option, value);
  if (!r.ok) throw new HarnessFatal(`Unknown value '${value}' for option '${option}'`);
  return r.value;
}

// harnessutil.go:1188
function getAllValuesForOption(option: string): string[] {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return [];
  switch (optionDecl.kind) {
    case "enum":
      return [...(enumMap(optionDecl.name)?.keys() ?? [])];
    case "boolean":
      return ["true", "false"];
  }
  return [];
}

// harnessutil.go:1085; the Go map of variations is unordered, here the order is the order of insertion
export function splitOptionValues(value: string, option: string): string[] {
  if (value.length === 0) return [];
  let star = false;
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let s of value.split(",")) {
    s = trimSpace(s);
    if (s.length === 0) continue;
    if (s === "*") star = true;
    else if (s.startsWith("-") || s.startsWith("!")) excludes.push(s.slice(1));
    else includes.push(s);
  }
  if (includes.length === 0 && !star && excludes.length === 0) return [];

  const variations = new Map<OptionValue, string>();
  for (const include of includes) {
    const v = getValueOfOptionString(option, include);
    if (!variations.has(v)) variations.set(v, include);
  }
  const allValues = getAllValuesForOption(option);
  if (star && allValues.length > 0) {
    for (const include of allValues) {
      const v = getValueOfOptionString(option, include);
      if (!variations.has(v)) variations.set(v, include);
    }
  }
  for (const exclude of excludes) {
    const r = tryGetValueOfOptionString(option, exclude);
    if (!r.ok) continue;
    variations.delete(r.value);
  }
  if (variations.size === 0) {
    throw new HarnessFatal(`Variations in test option '@${option}' resulted in an empty set.`);
  }
  return [...variations.values()];
}

const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

// harnessutil.go:1026
export function getFileBasedTestConfigurationDescription(config: TestConfiguration): string {
  const keys = [...config.keys()].sort(byBytes);
  return keys.map(key => `${key}=${toLower(config.get(key)!)}`).join(",");
}

// harnessutil.go:1038; the Go map of settings is unordered, here the order is the order of first appearance
export function getFileBasedTestConfigurations(
  settings: Map<string, string>,
  varyByOptions: Set<string>,
): NamedTestConfiguration[] {
  const optionEntries: string[][] = [];
  let variationCount = 1;
  const nonVaryingOptions = new Map<string, string>();
  for (const [option, value] of settings) {
    if (varyByOptions.has(option)) {
      const entries = splitOptionValues(value, option);
      if (entries.length > 1) {
        variationCount *= entries.length;
        if (variationCount > 25) throw new HarnessFatal("Provided test options exceeded the maximum number of variations");
        optionEntries.push([option, ...entries]);
      } else if (entries.length === 1) {
        nonVaryingOptions.set(option, entries[0]);
      }
    } else {
      nonVaryingOptions.set(option, value);
    }
  }
  const configurations: NamedTestConfiguration[] = [];
  if (optionEntries.length > 0) {
    const varying: TestConfiguration[] = [];
    computeWorker(varying, optionEntries, 0, new Map());
    for (const varyingConfig of varying) {
      const description = getFileBasedTestConfigurationDescription(varyingConfig);
      for (const [k, v] of nonVaryingOptions) varyingConfig.set(k, v);
      configurations.push({ name: description, config: varyingConfig });
    }
  } else if (nonVaryingOptions.size > 0) {
    configurations.push({ name: "", config: nonVaryingOptions });
  }
  return configurations;
}

// harnessutil.go:1208
function computeWorker(out: TestConfiguration[], optionEntries: string[][], index: number, state: TestConfiguration) {
  if (index >= optionEntries.length) {
    out.push(new Map(state));
    return;
  }
  const optionKey = optionEntries[index][0];
  for (const entry of optionEntries[index].slice(1)) {
    state.set(optionKey, entry);
    computeWorker(out, optionEntries, index + 1, state);
  }
}

// core/tristate.go
export const TSUnknown = 0;
export const TSFalse = 1;
export const TSTrue = 2;

// The eight fields of core.CompilerOptions that SkipUnsupportedCompilerOptions reads.
export interface SkipRelevantOptions {
  module: number;
  moduleResolution: number;
  esModuleInterop: number;
  allowSyntheticDefaultImports: number;
  baseUrl: string;
  outFile: string;
  target: number;
  alwaysStrict: number;
}

export function emptySkipRelevantOptions(): SkipRelevantOptions {
  return {
    module: 0,
    moduleResolution: 0,
    esModuleInterop: 0,
    allowSyntheticDefaultImports: 0,
    baseUrl: "",
    outFile: "",
    target: 0,
    alwaysStrict: 0,
  };
}

const tristateFields: Record<string, "esModuleInterop" | "allowSyntheticDefaultImports" | "alwaysStrict"> = {
  esModuleInterop: "esModuleInterop",
  allowSyntheticDefaultImports: "allowSyntheticDefaultImports",
  alwaysStrict: "alwaysStrict",
};
const enumFields: Record<string, "module" | "moduleResolution" | "target"> = {
  module: "module",
  moduleResolution: "moduleResolution",
  target: "target",
};
const stringFields: Record<string, "baseUrl" | "outFile"> = { baseUrl: "baseUrl", outFile: "outFile" };

// parsinghelpers.go:268 restricted to the eight fields; value undefined stands for nil
export function parseCompilerOptions(key: string, value: unknown, allOptions: SkipRelevantOptions): void {
  if (value === undefined || value === null) return;
  if (key in tristateFields) allOptions[tristateFields[key]] = value === true ? TSTrue : TSFalse;
  else if (key in enumFields) allOptions[enumFields[key]] = value as number;
  else if (key in stringFields) allOptions[stringFields[key]] = typeof value === "string" ? value : "";
}

// strconv.Atoi accepts an optional sign and decimal digits, with underscores rejected in base 10
function atoiOk(s: string): boolean {
  return /^[+-]?[0-9]+$/.test(s);
}

// commandlineparser.go:347 reduced to the validity of the value; returns the error count
function parseListTypeOptionErrors(option: CommandLineOption, value: string): number {
  value = trimSpace(value);
  if (value.startsWith("-")) return 0;
  if (option.kind === "listOrElement" && !value.includes(",")) return 0;
  if (value === "") return 0;
  const el = elements[option.name];
  if (el === undefined) return 0;
  const values = value.split(",");
  switch (el.kind) {
    case "string":
      return 0;
    case "boolean":
    case "object":
    case "number":
      throw new HarnessFatal("List of " + el.kind + " is not yet supported.");
    default: {
      let errors = 0;
      const map = enumMap(el.enumOf!)!;
      for (const v of values) {
        const t = trimFunc(v, isWhiteSpaceLike);
        if (t === "") continue;
        if (!map.has(toLower(t))) errors++;
      }
      return errors;
    }
  }
}

function trimFunc(s: string, f: (ch: number) => boolean): string {
  const cps = [...s];
  let start = 0;
  let end = cps.length;
  while (start < end && f(cps[start].codePointAt(0)!)) start++;
  while (end > start && f(cps[end - 1].codePointAt(0)!)) end--;
  return cps.slice(start, end).join("");
}

// harnessutil.go:443; returns the parsed value, undefined for nil
function getOptionValue(option: CommandLineOption, value: string, cwd: string): unknown {
  switch (option.kind) {
    case "string":
      if (option.isFilePath) return getNormalizedAbsolutePath(value, cwd);
      return value;
    case "number":
      if (!atoiOk(value)) throw new HarnessFatal(`Value for option '${option.name}' must be a number, got: ${value}`);
      return Number(value);
    case "boolean":
      switch (toLower(value)) {
        case "true":
          return true;
        case "false":
          return false;
        default:
          throw new HarnessFatal(`Value for option '${option.name}' must be a boolean, got: ${value}`);
      }
    case "enum": {
      const map = enumMap(option.name)!;
      const v = map.get(toLower(value));
      if (v === undefined) {
        throw new HarnessFatal(
          `Value for option '${option.name}' must be one of ${[...map.keys()].join(",")}, got: ${value}`,
        );
      }
      return v;
    }
    case "list":
    case "listOrElement": {
      const errors = parseListTypeOptionErrors(option, value);
      if (elements[option.name]?.isFilePath) return [];
      if (errors > 0) throw new HarnessFatal(`Unknown value '${value}' for compiler option '${option.name}'`);
      return [];
    }
    case "object":
      throw new HarnessFatal(`Object type options like '${option.name}' are not supported`);
  }
}

// harnessutil.go:292; the Go map is unordered, so when several entries are fatal the reference reports any one of them
export function setOptionsFromTestConfig(
  testConfig: TestConfiguration,
  compilerOptions: SkipRelevantOptions,
  currentDirectory: string,
): void {
  for (const [name, value] of testConfig) {
    if (name === "typescriptversion") continue;
    const commandLineOption = getCommandLineOption(name);
    if (commandLineOption !== undefined) {
      const parsedValue = getOptionValue(commandLineOption, value, currentDirectory);
      parseCompilerOptions(commandLineOption.name, parsedValue, compilerOptions);
      continue;
    }
    const harnessOption = getHarnessOption(name);
    if (harnessOption !== undefined) {
      getOptionValue(harnessOption, value, currentDirectory);
      continue;
    }
    throw new HarnessFatal(`Unknown compiler option '${name}'.`);
  }
}

const moduleKindNames: Record<number, string> = { 2: "AMD", 3: "UMD", 4: "System" };

// harnessutil.go:1236; returns the text that t.Skipf formats, undefined when the instance runs
export function skipUnsupportedCompilerOptions(options: SkipRelevantOptions): string | undefined {
  switch (options.module) {
    case 2:
    case 3:
    case 4:
      return `unsupported module kind ${moduleKindNames[options.module]}`;
  }
  switch (options.moduleResolution) {
    case 2:
    case 1:
      return `unsupported module resolution kind ${options.moduleResolution}`;
  }
  if (options.esModuleInterop === TSFalse) return "esModuleInterop=false is unsupported";
  if (options.allowSyntheticDefaultImports === TSFalse) return "allowSyntheticDefaultImports=false is unsupported";
  if (options.baseUrl !== "") return `unsupported baseUrl ${options.baseUrl}`;
  if (options.outFile !== "") return `unsupported outFile ${options.outFile}`;
  switch (options.target) {
    case 1:
      return "unsupported target ES5";
  }
  if (options.alwaysStrict === TSFalse) return "alwaysStrict=false is unsupported";
  return undefined;
}
