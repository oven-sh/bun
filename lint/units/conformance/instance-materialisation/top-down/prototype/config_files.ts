// Prototype: the file names that a config unit selects (tsoptions/tsconfigparsing.go), for the split into roots and other files.
import { enumMap } from "../../../enumerator/prototype/harnessutil";
import { isBlankJsonc, parseJsonc, type JsonNode } from "../../../enumerator/prototype/tsconfig";
import {
  combinePaths,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
  normalizePath,
  normalizeSlashes,
  toPath,
} from "../../../enumerator/prototype/tspath";
import {
  AllSupportedExtensions,
  AllSupportedExtensionsWithJson,
  ExtensionDts,
  ExtensionJs,
  ExtensionJson,
  ExtensionJsx,
  ExtensionTs,
  SupportedTSExtensions,
  SupportedTSExtensionsWithJson,
  changeExtension,
  convertToRelativePath,
  fileExtensionIs,
  fileExtensionIsOneOf,
} from "./tspath_more";
import { MapFS } from "./vfs_model";
import { newSpecMatcher, readDirectory } from "./vfsmatch";

const TSUnknown = 0;
const TSFalse = 1;
const TSTrue = 2;

// the fields of core.CompilerOptions that decide which files a config selects
export interface FileSelectionOptions {
  outDir: string;
  declarationDir: string;
  allowJs: number;
  checkJs: number;
  resolveJsonModule: number;
  module: number;
  moduleResolution: number;
  target: number;
  // read for the lib.d.ts rule of @libFiles (harnessutil.go:149)
  noLib: number;
}
const names = ["outDir", "declarationDir", "allowJs", "checkJs", "resolveJsonModule", "module", "moduleResolution", "target", "noLib"] as const;
type Name = (typeof names)[number];
const kindOf: Record<Name, "string" | "boolean" | "enum"> = {
  outDir: "string",
  declarationDir: "string",
  allowJs: "boolean",
  checkJs: "boolean",
  resolveJsonModule: "boolean",
  module: "enum",
  moduleResolution: "enum",
  target: "enum",
  noLib: "boolean",
};
function empty(): FileSelectionOptions {
  return { outDir: "", declarationDir: "", allowJs: 0, checkJs: 0, resolveJsonModule: 0, module: 0, moduleResolution: 0, target: 0, noLib: 0 };
}

const configDirTemplate = "${configDir}";
function startsWithConfigDirTemplate(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase().startsWith(configDirTemplate.toLowerCase());
}

type Raw = Map<string, unknown>;

// tsconfigparsing.go:818; arrays drop the elements that convert to nil
function toRaw(node: JsonNode): unknown {
  switch (node.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    case "string":
    case "number":
      return node.value;
    case "array": {
      const out: unknown[] = [];
      for (const e of node.elements) {
        const v = toRaw(e);
        if (v !== null) out.push(v);
      }
      return out;
    }
    case "object": {
      const m: Raw = new Map();
      for (const p of node.properties) if (p.key !== "") m.set(p.key, toRaw(p.value));
      return m;
    }
  }
}

interface Parsed {
  raw: Raw | undefined;
  options: FileSelectionOptions | undefined;
  explicitNull: Set<string>;
  extendedConfigPath: string[] | undefined;
}

export interface ConfigHost {
  fs: MapFS;
  read(path: string): string | undefined;
  currentDirectory: string;
  // the answers of the reference for extends values that it resolves like a module: value to absolute name
  extendsResolutions?: ReadonlyMap<string, string>;
}

export class Undecided extends Error {}

// tsconfigparsing.go:457 for the three kinds
function convertJsonOption(name: Name, value: unknown, basePath: string): unknown {
  if (value === null || value === undefined) return undefined;
  switch (kindOf[name]) {
    case "enum":
      if (typeof value !== "string" || value === "") return undefined;
      return enumMap(name)?.get(value.toLowerCase());
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "string": {
      if (typeof value !== "string") return undefined;
      let v = normalizeSlashes(value);
      if (!startsWithConfigDirTemplate(v)) v = getNormalizedAbsolutePath(v, basePath);
      if (v === "") v = ".";
      return v;
    }
  }
}

function setOption(options: FileSelectionOptions, name: Name, value: unknown) {
  if (value === undefined) return;
  if (kindOf[name] === "boolean") (options as any)[name] = value === true ? TSTrue : TSFalse;
  else (options as any)[name] = value;
}

// parsinghelpers.go:648
function mergeCompilerOptions(target: FileSelectionOptions, source: FileSelectionOptions | undefined, explicitNull: Set<string>): FileSelectionOptions {
  if (source === undefined) return target;
  for (const name of names) {
    if (explicitNull.has(name)) {
      (target as any)[name] = kindOf[name] === "string" ? "" : 0;
      continue;
    }
    const v = source[name];
    if (v !== 0 && v !== "") (target as any)[name] = v;
  }
  return target;
}

// tsconfigparsing.go:553
function getExtendsConfigPath(extendedConfig: string, host: ConfigHost, basePath: string): string {
  extendedConfig = normalizeSlashes(extendedConfig);
  if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
    let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
    if (!host.fs.fileExists(extendedConfigPath) && !extendedConfigPath.endsWith(ExtensionJson)) {
      extendedConfigPath = extendedConfigPath + ExtensionJson;
      if (!host.fs.fileExists(extendedConfigPath)) return "";
    }
    return extendedConfigPath;
  }
  if (extendedConfig === "") return "";
  const known = host.extendsResolutions?.get(extendedConfig);
  if (known !== undefined) return known;
  throw new Undecided(`extends ${JSON.stringify(extendedConfig)} is resolved like a module`);
}

// tsconfigparsing.go:178 and :311
function parseOwnConfig(text: string, host: ConfigHost, basePath: string, configFileName: string): Parsed {
  // tsconfigparsing.go:927: a file named jsconfig.json, in this exact case, starts with allowJs
  const options = empty();
  if (configFileName !== "" && getBaseFileName(configFileName) === "jsconfig.json") options.allowJs = TSTrue;
  let root: JsonNode | undefined;
  if (isBlankJsonc(text)) root = undefined;
  else {
    root = parseJsonc(text);
    if (root === undefined) throw new Undecided(`${configFileName} is not JSON with comments and trailing commas`);
  }
  if (root !== undefined && root.kind !== "object") {
    const first = root.kind === "array" ? root.elements.find(e => e.kind === "object") : undefined;
    if (first === undefined) return { raw: new Map(), options, explicitNull: new Set(), extendedConfigPath: undefined };
    root = first;
  }
  if (root === undefined) return { raw: undefined, options, explicitNull: new Set(), extendedConfigPath: undefined };
  const raw = toRaw(root) as Raw;
  let extendedConfigPath: string[] | undefined;
  for (const { key, value } of (root as Extract<JsonNode, { kind: "object" }>).properties) {
    if (key === "compilerOptions" && value.kind === "object") {
      for (const p of value.properties) {
        if ((names as readonly string[]).includes(p.key)) setOption(options, p.key as Name, convertJsonOption(p.key as Name, toRaw(p.value), basePath));
      }
    } else if (key === "extends") {
      const newBase = configFileName !== "" ? getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)) : basePath;
      extendedConfigPath = [];
      const v = toRaw(value);
      if (typeof v === "string") {
        const p = getExtendsConfigPath(v, host, newBase);
        if (p !== "") extendedConfigPath.push(p);
      } else if (Array.isArray(v)) {
        for (const e of v) {
          if (typeof e === "string") {
            const p = getExtendsConfigPath(e, host, newBase);
            if (p !== "") extendedConfigPath.push(p);
          }
        }
      }
    }
  }
  const explicitNull = new Set<string>();
  const co = raw.get("compilerOptions");
  if (co instanceof Map) for (const [k, v] of co) if (v === null) explicitNull.add(k);
  return { raw, options, explicitNull, extendedConfigPath };
}

// tsconfigparsing.go:1082
function parseConfig(text: string, host: ConfigHost, basePath: string, configFileName: string, resolutionStack: string[]): Parsed {
  basePath = normalizeSlashes(basePath);
  const resolvedPath = toPath(configFileName, basePath);
  if (resolutionStack.includes(resolvedPath)) return { raw: undefined, options: undefined, explicitNull: new Set(), extendedConfigPath: undefined };
  const ownConfig = parseOwnConfig(text, host, basePath, configFileName);
  if (ownConfig.extendedConfigPath !== undefined) {
    resolutionStack = [...resolutionStack, resolvedPath];
    const result: { options: FileSelectionOptions; include?: unknown[]; exclude?: unknown[]; files?: unknown[] } = { options: empty() };
    for (const extendedConfigPath of ownConfig.extendedConfigPath) {
      const extendedText = host.read(extendedConfigPath);
      if (extendedText === undefined) continue;
      const extendedConfig = parseConfig(extendedText, host, getDirectoryPath(extendedConfigPath), getBaseFileName(extendedConfigPath), resolutionStack);
      if (extendedConfig.options === undefined) continue;
      const extendsRaw = extendedConfig.raw;
      let relativeDifference = "";
      for (const propertyName of ["include", "exclude", "files"] as const) {
        if (ownConfig.raw !== undefined && ownConfig.raw.has(propertyName)) continue;
        if (extendsRaw === undefined || !extendsRaw.has(propertyName)) continue;
        const slice = extendsRaw.get(propertyName);
        if (!Array.isArray(slice)) continue;
        result[propertyName] = slice.map(path => {
          if (typeof path !== "string") return path;
          if (startsWithConfigDirTemplate(path) || isRootedDiskPath(path)) return path;
          if (relativeDifference === "") relativeDifference = convertToRelativePath(getDirectoryPath(extendedConfigPath), basePath);
          return combinePaths(relativeDifference, path);
        });
      }
      mergeCompilerOptions(result.options, extendedConfig.options, extendedConfig.explicitNull);
    }
    if (ownConfig.raw === undefined) throw new Undecided("a config with extends has no raw object");
    if (result.include !== undefined) ownConfig.raw.set("include", result.include);
    if (result.exclude !== undefined) ownConfig.raw.set("exclude", result.exclude);
    if (result.files !== undefined) ownConfig.raw.set("files", result.files);
    ownConfig.options = mergeCompilerOptions(result.options, ownConfig.options, ownConfig.explicitNull);
  }
  return ownConfig;
}

// core/compileroptions.go:202-286; the enum numbers are those of core (ModuleKind, ScriptTarget, ModuleResolutionKind)
const ModuleKindNode16 = 100;
const ModuleKindNode18 = 101;
const ModuleKindNode20 = 102;
const ModuleKindNodeNext = 199;
const ModuleResolutionKindBundler = 100;
function getAllowJS(o: FileSelectionOptions): boolean {
  if (o.allowJs !== TSUnknown) return o.allowJs === TSTrue;
  return o.checkJs === TSTrue;
}
function getResolveJsonModule(o: FileSelectionOptions): boolean {
  if (o.resolveJsonModule !== TSUnknown) return o.resolveJsonModule === TSTrue;
  // GetEmitModuleKind gives a Node kind only when module is set to one
  const m = o.module;
  if (m === ModuleKindNode20 || m === ModuleKindNodeNext) return true;
  // GetModuleResolutionKind: unknown, classic and node10 follow the module kind
  if (o.moduleResolution === 0 || o.moduleResolution === 1 || o.moduleResolution === 2) {
    if (m === ModuleKindNode16 || m === ModuleKindNode18 || m === ModuleKindNode20 || m === ModuleKindNodeNext) return false;
    return true;
  }
  return o.moduleResolution === ModuleResolutionKindBundler;
}

// tsconfigparsing.go:1566
function specIsInvalid(spec: string, disallowTrailingRecursion: boolean): boolean {
  if (disallowTrailingRecursion) {
    const s = spec.endsWith("/") ? spec.slice(0, -1) : spec;
    if (s === "**" || s.endsWith("/**")) return true;
  }
  const wildcardIndex = spec.startsWith("**/") ? 0 : spec.indexOf("/**/");
  if (wildcardIndex === -1) return false;
  const lastDotIndex = spec.endsWith("/..") ? spec.length : spec.lastIndexOf("/../");
  return lastDotIndex > wildcardIndex;
}

function validateSpecs(specs: unknown[], disallowTrailingRecursion: boolean): string[] {
  const out: string[] = [];
  for (const value of specs) if (typeof value === "string" && !specIsInvalid(value, disallowTrailingRecursion)) out.push(value);
  return out;
}

// tsconfigparsing.go:1801; undefined stands for nil
function substitute(list: string[], basePath: string): string[] {
  return list.map(e => (startsWithConfigDirTemplate(e) ? getNormalizedAbsolutePath(e.replace(configDirTemplate, "./"), basePath) : e));
}

// tsconfigparsing.go:1869
function hasFileWithHigherPriorityExtension(file: string, extensions: string[][], hasFile: (f: string) => boolean): boolean {
  const extensionGroup: string[] = [];
  for (const group of extensions) if (fileExtensionIsOneOf(file, group)) extensionGroup.push(...group);
  if (extensionGroup.length === 0) return false;
  for (const ext of extensionGroup) {
    if (fileExtensionIs(file, ext) && (ext !== ExtensionTs || !fileExtensionIs(file, ExtensionDts))) return false;
    if (hasFile(changeExtension(file, ext))) {
      if (ext === ExtensionDts && (fileExtensionIs(file, ExtensionJs) || fileExtensionIs(file, ExtensionJsx))) continue;
      return true;
    }
  }
  return false;
}

// tsconfigparsing.go:1901
function removeWildcardFilesWithLowerPriorityExtension(file: string, wildcardFiles: Map<string, string>, extensions: string[][]) {
  let extensionGroup: string[] | undefined;
  for (const group of extensions) if (fileExtensionIsOneOf(file, group)) (extensionGroup ??= []).push(...group);
  if (extensionGroup === undefined) return;
  for (let i = extensionGroup.length - 1; i >= 0; i--) {
    const ext = extensionGroup[i];
    if (fileExtensionIs(file, ext)) return;
    wildcardFiles.delete(changeExtension(file, ext));
  }
}

export interface ConfigFileNames {
  fileNames: string[];
  options: FileSelectionOptions;
}

// test_case_parser.go:82-110 over tsconfigparsing.go:1237 and :1928
export function getConfigFileNames(host: ConfigHost, configUnitName: string, configText: string): ConfigFileNames {
  const configFileName = getNormalizedAbsolutePath(configUnitName, host.currentDirectory);
  const basePath = getDirectoryPath(configFileName);
  const basePathForFileNames = normalizePath(getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)));
  const parsed = parseConfig(configText, host, basePath, configFileName, []);
  const options = parsed.options ?? empty();
  for (const n of ["outDir", "declarationDir"] as const) {
    if (startsWithConfigDirTemplate(options[n])) options[n] = getNormalizedAbsolutePath(options[n].replace(configDirTemplate, "./"), basePathForFileNames);
  }
  const raw = parsed.raw ?? new Map<string, unknown>();
  const prop = (name: string): unknown[] | undefined => {
    const value = raw.get(name);
    return Array.isArray(value) ? value : undefined;
  };
  const fileSpecs = prop("files");
  let includeSpecs = prop("include");
  let excludeSpecs = prop("exclude");
  // a property that is absent, null or not an array counts as "no-prop" when the config is read from a source file
  const excludeIsNoProp = excludeSpecs === undefined;
  if (excludeIsNoProp && parsed.options !== undefined) {
    const values: unknown[] = [];
    if (options.outDir !== "") values.push(options.outDir);
    if (options.declarationDir !== "") values.push(options.declarationDir);
    if (values.length > 0) excludeSpecs = values;
  }
  if (fileSpecs === undefined && includeSpecs === undefined) includeSpecs = ["**/*"];
  const validatedIncludeSpecs = includeSpecs === undefined ? [] : substitute(validateSpecs(includeSpecs, true), basePathForFileNames);
  const validatedExcludeSpecs = excludeSpecs === undefined ? [] : substitute(validateSpecs(excludeSpecs, false), basePathForFileNames);
  const validatedFilesSpec = fileSpecs === undefined ? [] : substitute(fileSpecs.filter(s => typeof s === "string") as string[], basePathForFileNames);

  // getFileNamesFromConfigSpecs
  const base = normalizePath(basePathForFileNames);
  const literalFileMap = new Map<string, string>();
  const wildcardFileMap = new Map<string, string>();
  const wildCardJsonFileMap = new Map<string, string>();
  const supportedExtensions = getAllowJS(options) ? AllSupportedExtensions : SupportedTSExtensions;
  const withJson = !getResolveJsonModule(options) ? supportedExtensions : supportedExtensions === AllSupportedExtensions ? AllSupportedExtensionsWithJson : SupportedTSExtensionsWithJson;
  for (const fileName of validatedFilesSpec) literalFileMap.set(fileName, getNormalizedAbsolutePath(fileName, base));
  let jsonOnlyIncludeMatchers: ((path: string) => number) | undefined;
  let jsonMatcherMade = false;
  if (validatedIncludeSpecs.length > 0) {
    const files = readDirectory(host.fs, base, base, withJson.flat(), validatedExcludeSpecs, validatedIncludeSpecs);
    for (const file of files) {
      if (fileExtensionIs(file, ExtensionJson)) {
        if (!jsonMatcherMade) {
          jsonMatcherMade = true;
          jsonOnlyIncludeMatchers = newSpecMatcher(validatedIncludeSpecs.filter(i => i.endsWith(ExtensionJson)), base, "files");
        }
        const includeIndex = jsonOnlyIncludeMatchers === undefined ? -1 : jsonOnlyIncludeMatchers(file);
        if (includeIndex !== -1 && !literalFileMap.has(file) && !wildCardJsonFileMap.has(file)) wildCardJsonFileMap.set(file, file);
        continue;
      }
      if (hasFileWithHigherPriorityExtension(file, supportedExtensions, f => literalFileMap.has(f) || wildcardFileMap.has(f))) continue;
      removeWildcardFilesWithLowerPriorityExtension(file, wildcardFileMap, supportedExtensions);
      if (!literalFileMap.has(file) && !wildcardFileMap.has(file)) wildcardFileMap.set(file, file);
    }
  }
  return { fileNames: [...literalFileMap.values(), ...wildcardFileMap.values(), ...wildCardJsonFileMap.values()], options };
}
