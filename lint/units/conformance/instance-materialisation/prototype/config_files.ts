// Research prototype: the file names that a config unit selects (tsoptions/tsconfigparsing.go), for the split into roots and other files.
import { enumMap } from "./harnessutil";
import type { MemFs } from "./memfs";
import { toLower } from "./stringutil";
import { isBlankJsonc, parseJsonc, type JsonNode } from "./tsconfig";
import {
  combinePaths,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
  normalizePath,
  normalizeSlashes,
} from "./tspath";
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
  getCanonicalFileName,
  toPathEx,
} from "./tspath_more";
import { UnlimitedDepth, Usage, matchIndex, newSpecMatcher, readDirectory, type SpecMatcher } from "./vfsmatch";

const TSUnknown = 0;
const TSFalse = 1;
const TSTrue = 2;

// The fields of core.CompilerOptions that the selection of file names reads.
export interface FileOptions {
  allowJs: number;
  checkJs: number;
  resolveJsonModule: number;
  module: number;
  moduleResolution: number;
  target: number;
  outDir: string;
  declarationDir: string;
}
const tristates = ["allowJs", "checkJs", "resolveJsonModule"] as const;
const enums = ["module", "moduleResolution", "target"] as const;
const paths = ["outDir", "declarationDir"] as const;
const allNames: readonly string[] = [...tristates, ...enums, ...paths];

function emptyOptions(configFileName: string): FileOptions {
  const o: FileOptions = { allowJs: 0, checkJs: 0, resolveJsonModule: 0, module: 0, moduleResolution: 0, target: 0, outDir: "", declarationDir: "" };
  // tsconfigparsing.go:927
  if (configFileName !== "" && getBaseFileName(configFileName) === "jsconfig.json") o.allowJs = TSTrue;
  return o;
}

// core/compileroptions.go:195, :202, :223, :266, :282
function getEmitModuleKind(o: FileOptions): number {
  if (o.module !== 0) return o.module;
  const target = o.target !== 0 ? o.target : 12;
  if (target === 99) return 99;
  if (target >= 9) return 7;
  if (target >= 7) return 6;
  if (target >= 2) return 5;
  return 1;
}
function getModuleResolutionKind(o: FileOptions): number {
  switch (o.moduleResolution) {
    case 0:
    case 1:
    case 2:
      switch (getEmitModuleKind(o)) {
        case 100:
        case 101:
        case 102:
          return 3;
        case 199:
          return 99;
        default:
          return 100;
      }
    default:
      return o.moduleResolution;
  }
}
function getResolveJsonModule(o: FileOptions): boolean {
  if (o.resolveJsonModule !== TSUnknown) return o.resolveJsonModule === TSTrue;
  const m = getEmitModuleKind(o);
  if (m === 102 || m === 199) return true;
  return getModuleResolutionKind(o) === 100;
}
function getAllowJS(o: FileOptions): boolean {
  if (o.allowJs !== TSUnknown) return o.allowJs === TSTrue;
  return o.checkJs === TSTrue;
}

const configDirTemplate = "${configDir}";
function startsWithConfigDirTemplate(value: unknown): boolean {
  return typeof value === "string" && toLower(value).startsWith(toLower(configDirTemplate));
}
function getSubstitutedPathWithConfigDirTemplate(value: string, basePath: string): string {
  return getNormalizedAbsolutePath(value.replace(configDirTemplate, "./"), basePath);
}
function getSubstitutedStringArrayWithConfigDirTemplate(list: string[], basePath: string): string[] | undefined {
  let result: string[] | undefined;
  list.forEach((element, i) => {
    if (startsWithConfigDirTemplate(element)) {
      result ??= list.slice();
      result[i] = getSubstitutedPathWithConfigDirTemplate(element, basePath);
    }
  });
  return result;
}

// A raw value of the config: the JSON value as written. undefined stands for a key that is absent.
type Raw = JsonNode | undefined;

interface ParsedTsconfig {
  // undefined stands for a nil options pointer (the circular case)
  options: FileOptions | undefined;
  // keys of compilerOptions whose raw value is null
  explicitNull: Set<string>;
  raw: Map<string, JsonNode> | undefined;
}

export class Undecided extends Error {}

class Reader {
  notes: string[] = [];
  constructor(readonly host: MemFs, readonly decoder = new TextDecoder("utf-8")) {}

  readFile(path: string): string | undefined {
    const b = this.host.readFile(path);
    return b === undefined ? undefined : this.decoder.decode(b);
  }

  // tsconfigparsing.go:457 for the kinds of the options above
  setOption(options: FileOptions, name: string, node: JsonNode, basePath: string): void {
    if (node.kind === "null") return;
    if ((tristates as readonly string[]).includes(name)) {
      if (node.kind === "true") (options as any)[name] = TSTrue;
      else if (node.kind === "false") (options as any)[name] = TSFalse;
      return;
    }
    if ((enums as readonly string[]).includes(name)) {
      if (node.kind !== "string" || node.value === "") return;
      const v = enumMap(name)?.get(toLower(node.value));
      if (typeof v === "number") (options as any)[name] = v;
      return;
    }
    if (node.kind !== "string") return;
    let value = normalizeSlashes(node.value);
    if (!startsWithConfigDirTemplate(value)) value = getNormalizedAbsolutePath(value, basePath);
    if (value === "") value = ".";
    (options as any)[name] = value;
  }

  // tsconfigparsing.go:553
  getExtendsConfigPath(extendedConfig: string, basePath: string): string {
    extendedConfig = normalizeSlashes(extendedConfig);
    if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
      let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
      if (!this.host.fileExists(extendedConfigPath) && !extendedConfigPath.endsWith(ExtensionJson)) {
        extendedConfigPath = extendedConfigPath + ExtensionJson;
        if (!this.host.fileExists(extendedConfigPath)) return "";
      }
      return extendedConfigPath;
    }
    if (extendedConfig === "") return "";
    throw new Undecided(`extends ${JSON.stringify(extendedConfig)} is resolved like a module by the reference`);
  }

  parseText(text: string, what: string): JsonNode {
    if (isBlankJsonc(text)) return { kind: "object", properties: [] };
    const root = parseJsonc(text);
    if (root === undefined) throw new Undecided(`${what} is not JSON with comments and trailing commas; the reference reads it with the error recovery of its parser`);
    return root;
  }

  // tsconfigparsing.go:178 and :742
  parseOwnConfig(root: JsonNode, basePath: string, configFileName: string): { own: ParsedTsconfig; extendedConfigPath: string[] | undefined } {
    const options = emptyOptions(configFileName);
    const explicitNull = new Set<string>();
    let extendedConfigPath: string[] | undefined;
    let rootObject: JsonNode | undefined = root;
    if (root.kind !== "object") {
      rootObject = root.kind === "array" ? root.elements.find(e => e.kind === "object") : undefined;
      if (rootObject === undefined) return { own: { options, explicitNull, raw: new Map() }, extendedConfigPath };
    }
    if (rootObject.kind !== "object") return { own: { options, explicitNull, raw: new Map() }, extendedConfigPath };
    const raw = new Map<string, JsonNode>();
    for (const { key, value } of rootObject.properties) {
      if (key === "") continue;
      raw.set(key, value);
      if (key === "contentMappers") throw new Undecided("the config has contentMappers");
      if (key === "compilerOptions") {
        if (value.kind === "object") {
          for (const p of value.properties) if (allNames.includes(p.key)) this.setOption(options, p.key, p.value, basePath);
        }
      } else if (key === "extends") {
        const newBase = configFileName !== "" ? getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)) : basePath;
        extendedConfigPath = [];
        if (value.kind === "string") {
          const p = this.getExtendsConfigPath(value.value, newBase);
          if (p !== "") extendedConfigPath.push(p);
        } else if (value.kind === "array") {
          for (const e of value.elements) {
            if (e.kind === "string") {
              const p = this.getExtendsConfigPath(e.value, newBase);
              if (p !== "") extendedConfigPath.push(p);
            }
          }
        }
      }
    }
    const co = raw.get("compilerOptions");
    if (co !== undefined && co.kind === "object") {
      const last = new Map<string, JsonNode>();
      for (const p of co.properties) last.set(p.key, p.value);
      for (const [k, v] of last) if (v.kind === "null") explicitNull.add(k);
    }
    return { own: { options, explicitNull, raw }, extendedConfigPath };
  }

  // parsinghelpers.go:648 for the fields above
  merge(target: FileOptions, source: FileOptions | undefined, explicitNull: Set<string>): FileOptions {
    if (source === undefined) return target;
    for (const name of allNames) {
      if (explicitNull.has(name)) {
        (target as any)[name] = typeof (target as any)[name] === "string" ? "" : 0;
        continue;
      }
      const v = (source as any)[name];
      if (v !== 0 && v !== "") (target as any)[name] = v;
    }
    return target;
  }

  // tsconfigparsing.go:1082
  parseConfig(text: string, basePath: string, configFileName: string, resolutionStack: string[]): ParsedTsconfig {
    basePath = normalizeSlashes(basePath);
    const resolvedPath = toPathEx(configFileName, basePath, this.host.useCaseSensitiveFileNames);
    if (resolutionStack.includes(resolvedPath)) return { options: undefined, explicitNull: new Set(), raw: undefined };
    const { own: ownConfig, extendedConfigPath } = this.parseOwnConfig(this.parseText(text, resolvedPath), basePath, configFileName);
    if (extendedConfigPath !== undefined) {
      resolutionStack = resolutionStack.concat([resolvedPath]);
      const result: { options: FileOptions; include?: JsonNode[]; exclude?: JsonNode[]; files?: JsonNode[] } = { options: emptyOptions("") };
      for (const path of extendedConfigPath) {
        // tsconfigparsing.go:1015 and :996; a file that cannot be read gives no config
        const extendedText = this.readFile(path);
        if (extendedText === undefined) continue;
        const extendedConfig = this.parseConfig(extendedText, getDirectoryPath(path), getBaseFileName(path), resolutionStack);
        if (extendedConfig.options === undefined) continue;
        const extendsRaw = extendedConfig.raw;
        let relativeDifference = "";
        for (const propertyName of ["include", "exclude", "files"] as const) {
          if (ownConfig.raw !== undefined && ownConfig.raw.has(propertyName)) continue;
          const v = extendsRaw?.get(propertyName);
          if (v === undefined || v.kind !== "array") continue;
          result[propertyName] = v.elements.map(e => {
            if (e.kind !== "string") return e;
            if (startsWithConfigDirTemplate(e.value) || isRootedDiskPath(e.value)) return e;
            if (relativeDifference === "") {
              relativeDifference = convertToRelativePath(getDirectoryPath(path), {
                useCaseSensitiveFileNames: this.host.useCaseSensitiveFileNames,
                currentDirectory: basePath,
              });
            }
            return { kind: "string", value: combinePaths(relativeDifference, e.value) } as JsonNode;
          });
        }
        this.merge(result.options, extendedConfig.options, extendedConfig.explicitNull);
      }
      for (const propertyName of ["include", "exclude", "files"] as const) {
        const v = result[propertyName];
        if (v !== undefined) ownConfig.raw!.set(propertyName, { kind: "array", elements: v });
      }
      ownConfig.options = this.merge(result.options, ownConfig.options, ownConfig.explicitNull);
    }
    return ownConfig;
  }
}

// tsconfigparsing.go:1576 and :1583
function invalidTrailingRecursion(spec: string): boolean {
  const s = spec.endsWith("/") ? spec.slice(0, -1) : spec;
  return s === "**" || s.endsWith("/**");
}
function invalidDotDotAfterRecursiveWildcard(s: string): boolean {
  const wildcardIndex = s.startsWith("**/") ? 0 : s.indexOf("/**/");
  if (wildcardIndex === -1) return false;
  const lastDotIndex = s.endsWith("/..") ? s.length : s.lastIndexOf("/../");
  return lastDotIndex > wildcardIndex;
}
// tsconfigparsing.go:1540
function validateSpecs(specs: JsonNode[], disallowTrailingRecursion: boolean): string[] {
  const finalSpecs: string[] = [];
  for (const value of specs) {
    if (value.kind !== "string") continue;
    const spec = value.value;
    if (disallowTrailingRecursion && invalidTrailingRecursion(spec)) continue;
    if (invalidDotDotAfterRecursiveWildcard(spec)) continue;
    finalSpecs.push(spec);
  }
  return finalSpecs;
}

// tsconfigparsing.go:1869
function hasFileWithHigherPriorityExtension(file: string, extensions: readonly (readonly string[])[], hasFile: (fileName: string) => boolean): boolean {
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
function removeWildcardFilesWithLowerPriorityExtension(file: string, wildcardFiles: Map<string, string>, extensions: readonly (readonly string[])[], keyMapper: (v: string) => string): void {
  const extensionGroup: string[] = [];
  for (const group of extensions) if (fileExtensionIsOneOf(file, group)) extensionGroup.push(...group);
  if (extensionGroup.length === 0) return;
  for (let i = extensionGroup.length - 1; i >= 0; i--) {
    const ext = extensionGroup[i];
    if (fileExtensionIs(file, ext)) return;
    wildcardFiles.delete(keyMapper(changeExtension(file, ext)));
  }
}

export interface ConfigFileSpecs {
  validatedFilesSpec: string[];
  validatedIncludeSpecs: string[];
  validatedExcludeSpecs: string[];
}

// tsconfigparsing.go:1928
export function getFileNamesFromConfigSpecs(specs: ConfigFileSpecs, basePath: string, options: FileOptions | undefined, host: MemFs): string[] {
  basePath = normalizePath(basePath);
  const keyMapper = (value: string) => getCanonicalFileName(value, host.useCaseSensitiveFileNames);
  const literalFileMap = new Map<string, string>();
  const wildcardFileMap = new Map<string, string>();
  const wildCardJsonFileMap = new Map<string, string>();
  const o = options ?? emptyOptions("");
  const supportedExtensions = getAllowJS(o) ? AllSupportedExtensions : SupportedTSExtensions;
  const withJson = !getResolveJsonModule(o) ? supportedExtensions : supportedExtensions === AllSupportedExtensions ? AllSupportedExtensionsWithJson : SupportedTSExtensionsWithJson;
  for (const fileName of specs.validatedFilesSpec) {
    const file = getNormalizedAbsolutePath(fileName, basePath);
    literalFileMap.set(keyMapper(fileName), file);
  }
  let jsonOnlyIncludeMatchers: SpecMatcher | undefined;
  let jsonOnlyMade = false;
  if (specs.validatedIncludeSpecs.length > 0) {
    const files = readDirectory(host, basePath, basePath, withJson.flat(), specs.validatedExcludeSpecs, specs.validatedIncludeSpecs, UnlimitedDepth);
    for (const file of files) {
      if (fileExtensionIs(file, ExtensionJson)) {
        if (!jsonOnlyMade) {
          const includes = specs.validatedIncludeSpecs.filter(i => i.endsWith(ExtensionJson));
          jsonOnlyIncludeMatchers = newSpecMatcher(includes, basePath, Usage.Files, host.useCaseSensitiveFileNames);
          // the reference tests the pointer again for each file, which repeats this work and gives the same matcher
          jsonOnlyMade = jsonOnlyIncludeMatchers !== undefined;
        }
        const includeIndex = jsonOnlyIncludeMatchers !== undefined ? matchIndex(jsonOnlyIncludeMatchers, file) : -1;
        if (includeIndex !== -1) {
          const key = keyMapper(file);
          if (!literalFileMap.has(key) && !wildCardJsonFileMap.has(key)) wildCardJsonFileMap.set(key, file);
        }
        continue;
      }
      if (hasFileWithHigherPriorityExtension(file, supportedExtensions, fileName => {
        const canonicalFileName = keyMapper(fileName);
        return literalFileMap.has(canonicalFileName) || wildcardFileMap.has(canonicalFileName);
      })) continue;
      removeWildcardFilesWithLowerPriorityExtension(file, wildcardFileMap, supportedExtensions, keyMapper);
      const key = keyMapper(file);
      if (!literalFileMap.has(key) && !wildcardFileMap.has(key)) wildcardFileMap.set(key, file);
    }
  }
  return [...literalFileMap.values(), ...wildcardFileMap.values(), ...wildCardJsonFileMap.values()];
}

export interface ConfigFileNames {
  fileNames: string[];
  specs: ConfigFileSpecs;
  basePathForFileNames: string;
  options: FileOptions | undefined;
}

// test_case_parser.go:82 with tsconfigparsing.go:1237, up to the file names
export function getConfigFileNames(host: MemFs, configUnitName: string, configText: string, currentDirectory: string): ConfigFileNames {
  const reader = new Reader(host);
  const configFileName = getNormalizedAbsolutePath(configUnitName, currentDirectory);
  const basePath = getDirectoryPath(configFileName);
  const basePathForFileNames = normalizePath(getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)));
  const parsedConfig = reader.parseConfig(configText, basePath, configFileName, []);
  const options = parsedConfig.options;
  if (options !== undefined) {
    for (const name of paths) {
      if (startsWithConfigDirTemplate(options[name])) options[name] = getSubstitutedPathWithConfigDirTemplate(options[name], basePathForFileNames);
    }
  }
  const raw = parsedConfig.raw ?? new Map<string, JsonNode>();
  // getPropFromRaw with a source file: a value that is not an array counts as absent
  const prop = (name: string): JsonNode[] | undefined => {
    const v: Raw = raw.get(name);
    return v !== undefined && v.kind === "array" ? v.elements : undefined;
  };
  const fileSpecs = prop("files");
  let includeSpecs = prop("include");
  let excludeSpecs = prop("exclude");
  if (excludeSpecs === undefined && options !== undefined) {
    const values: JsonNode[] = [];
    if (options.outDir !== "") values.push({ kind: "string", value: options.outDir });
    if (options.declarationDir !== "") values.push({ kind: "string", value: options.declarationDir });
    if (values.length > 0) excludeSpecs = values;
  }
  if (fileSpecs === undefined && includeSpecs === undefined) includeSpecs = [{ kind: "string", value: "**/*" }];
  let validatedIncludeSpecs: string[] = [];
  let validatedExcludeSpecs: string[] = [];
  let validatedFilesSpec: string[] = [];
  if (includeSpecs !== undefined) {
    const before = validateSpecs(includeSpecs, true);
    validatedIncludeSpecs = getSubstitutedStringArrayWithConfigDirTemplate(before, basePathForFileNames) ?? before;
  }
  if (excludeSpecs !== undefined) {
    const before = validateSpecs(excludeSpecs, false);
    validatedExcludeSpecs = getSubstitutedStringArrayWithConfigDirTemplate(before, basePathForFileNames) ?? before;
  }
  if (fileSpecs !== undefined) {
    const before = fileSpecs.filter(s => s.kind === "string").map(s => (s as { value: string }).value);
    validatedFilesSpec = getSubstitutedStringArrayWithConfigDirTemplate(before, basePathForFileNames) ?? before;
  }
  const specs: ConfigFileSpecs = { validatedFilesSpec, validatedIncludeSpecs, validatedExcludeSpecs };
  const fileNames = getFileNamesFromConfigSpecs(specs, basePathForFileNames, options, host);
  return { fileNames, specs, basePathForFileNames, options };
}
