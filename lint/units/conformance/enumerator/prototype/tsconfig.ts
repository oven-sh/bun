// Prototype of the smallest config reader that the skip rule needs (tsoptions/tsconfigparsing.go, eight options and the extends chain).
import {
  type SkipRelevantOptions,
  emptySkipRelevantOptions,
  enumMap,
  optionsDeclarations,
  parseCompilerOptions,
  type CommandLineOption,
} from "./harnessutil";
import { toLower } from "./stringutil";
import {
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
  normalizePath,
  normalizeSlashes,
  toPath,
} from "./tspath";

export type JsonNode =
  | { kind: "object"; properties: { key: string; value: JsonNode }[] }
  | { kind: "array"; elements: JsonNode[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "null" };

// JSON with comments and trailing commas; undefined when the text is anything else.
export function parseJsonc(text: string): JsonNode | undefined {
  let i = 0;
  const n = text.length;
  let failed = false;
  let depth = 0;
  const fail = (): undefined => {
    failed = true;
    return undefined;
  };
  function skip() {
    for (;;) {
      while (i < n && /[\s\uFEFF]/.test(text[i])) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
        continue;
      }
      if (text[i] === "/" && text[i + 1] === "*") {
        const e = text.indexOf("*/", i + 2);
        if (e < 0) {
          i = n;
          failed = true;
          return;
        }
        i = e + 2;
        continue;
      }
      return;
    }
  }
  function str(): string | undefined {
    const start = i;
    i++;
    while (i < n && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text[i] === "\n" || text[i] === "\r") return fail();
      i++;
    }
    if (i >= n) return fail();
    i++;
    try {
      const v = JSON.parse(text.slice(start, i));
      return typeof v === "string" ? v : fail();
    } catch {
      return fail();
    }
  }
  function value(): JsonNode | undefined {
    skip();
    if (failed || i >= n) return fail();
    if (depth > 200) return fail();
    const c = text[i];
    if (c === "{") {
      i++;
      depth++;
      const properties: { key: string; value: JsonNode }[] = [];
      for (;;) {
        skip();
        if (failed) return undefined;
        if (text[i] === "}") {
          i++;
          break;
        }
        if (text[i] !== '"') return fail();
        const key = str();
        if (key === undefined) return undefined;
        skip();
        if (text[i] !== ":") return fail();
        i++;
        const v = value();
        if (v === undefined) return undefined;
        properties.push({ key, value: v });
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          break;
        }
        return fail();
      }
      depth--;
      return { kind: "object", properties };
    }
    if (c === "[") {
      i++;
      depth++;
      const elements: JsonNode[] = [];
      for (;;) {
        skip();
        if (failed) return undefined;
        if (text[i] === "]") {
          i++;
          break;
        }
        const v = value();
        if (v === undefined) return undefined;
        elements.push(v);
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          break;
        }
        return fail();
      }
      depth--;
      return { kind: "array", elements };
    }
    if (c === '"') {
      const s = str();
      return s === undefined ? undefined : { kind: "string", value: s };
    }
    const m = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i, i + 64));
    if (m && m[0].length > 0) {
      i += m[0].length;
      return { kind: "number", value: Number(m[0]) };
    }
    for (const kw of ["true", "false", "null"] as const) {
      if (text.startsWith(kw, i) && !/[A-Za-z0-9_$]/.test(text[i + kw.length] ?? "")) {
        i += kw.length;
        return { kind: kw };
      }
    }
    return fail();
  }
  const v = value();
  if (v === undefined || failed) return undefined;
  skip();
  if (failed || i < n) return undefined;
  return v;
}

// True when the text holds only white space and comments.
export function isBlankJsonc(text: string): boolean {
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (/[\s\uFEFF]/.test(text[i])) i++;
    else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e < 0) return false;
      i = e + 2;
    } else return false;
  }
  return true;
}

export interface ConfigHost {
  // absolute normalized path to content
  files: Map<string, string>;
  currentDirectory: string;
}

export interface ParsedConfig {
  options: SkipRelevantOptions | undefined;
  // keys of compilerOptions whose value is null in the raw object, for mergeCompilerOptions
  explicitNull: Set<string>;
  // set when the reader met something it does not model; the text says what
  notes: string[];
}

const configDirTemplate = "${configDir}";
const eight = new Set([
  "module",
  "moduleResolution",
  "esModuleInterop",
  "allowSyntheticDefaultImports",
  "baseUrl",
  "outFile",
  "target",
  "alwaysStrict",
]);
const declarationByName = new Map<string, CommandLineOption>();
for (const o of optionsDeclarations) if (!declarationByName.has(o.name)) declarationByName.set(o.name, o);

function startsWithConfigDirTemplate(value: string): boolean {
  return toLower(value).startsWith(toLower(configDirTemplate));
}

// tsconfigparsing.go:457 for the kinds of the eight options; undefined stands for nil
function convertJsonOption(opt: CommandLineOption, node: JsonNode, basePath: string): unknown {
  if (opt.isCommandLineOnly) return undefined;
  if (node.kind === "null") return undefined;
  switch (opt.kind) {
    case "enum": {
      if (node.kind !== "string") return undefined;
      if (node.value === "") return undefined;
      return enumMap(opt.name)?.get(toLower(node.value));
    }
    case "boolean":
      if (node.kind === "true") return true;
      if (node.kind === "false") return false;
      return undefined;
    case "string": {
      if (node.kind !== "string") return undefined;
      let value = node.value;
      if (opt.isFilePath) {
        value = normalizeSlashes(value);
        if (!startsWithConfigDirTemplate(value)) value = getNormalizedAbsolutePath(value, basePath);
        if (value === "") value = ".";
      }
      return value;
    }
  }
  return undefined;
}

// parsinghelpers.go:648 restricted to the eight fields
function mergeCompilerOptions(
  target: SkipRelevantOptions,
  source: SkipRelevantOptions | undefined,
  explicitNull: Set<string>,
): SkipRelevantOptions {
  if (source === undefined) return target;
  for (const key of eight) {
    const k = key as keyof SkipRelevantOptions;
    if (explicitNull.has(key)) {
      (target as any)[k] = typeof target[k] === "string" ? "" : 0;
      continue;
    }
    const v = source[k];
    if (v !== 0 && v !== "") (target as any)[k] = v;
  }
  return target;
}

interface OwnConfig {
  options: SkipRelevantOptions;
  explicitNull: Set<string>;
  // undefined: no extends property reached the notifier
  extendedConfigPath: string[] | undefined;
}

// tsconfigparsing.go:553
function getExtendsConfigPath(extendedConfig: string, host: ConfigHost, basePath: string, notes: string[]): string {
  extendedConfig = normalizeSlashes(extendedConfig);
  if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
    let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
    if (!host.files.has(extendedConfigPath) && !extendedConfigPath.endsWith(".json")) {
      extendedConfigPath = extendedConfigPath + ".json";
      if (!host.files.has(extendedConfigPath)) return "";
    }
    return extendedConfigPath;
  }
  if (extendedConfig !== "") notes.push(`extends "${extendedConfig}" is resolved like a module by the reference; not modelled`);
  return "";
}

// tsconfigparsing.go:178 and :742, for a root that parseJsonc accepted
function parseOwnConfig(root: JsonNode, host: ConfigHost, basePath: string, configFileName: string, notes: string[]): OwnConfig {
  const options = emptySkipRelevantOptions();
  const explicitNull = new Set<string>();
  let extendedConfigPath: string[] | undefined;
  let rootObject: JsonNode | undefined = root;
  if (root.kind !== "object") {
    rootObject = root.kind === "array" ? root.elements.find(e => e.kind === "object") : undefined;
  }
  if (rootObject === undefined || rootObject.kind !== "object") return { options, explicitNull, extendedConfigPath };
  const rawCompilerOptions = new Map<string, JsonNode>();
  let lastCompilerOptionsIsObject = false;
  for (const { key, value } of rootObject.properties) {
    if (key === "compilerOptions") {
      lastCompilerOptionsIsObject = value.kind === "object";
      rawCompilerOptions.clear();
      if (value.kind === "object") {
        for (const p of value.properties) {
          rawCompilerOptions.set(p.key, p.value);
          const option = declarationByName.get(p.key);
          if (option === undefined) continue;
          const converted = convertJsonOption(option, p.value, basePath);
          if (converted !== undefined) parseCompilerOptions(option.name, converted, options);
        }
      }
    } else if (key === "extends") {
      const newBase = getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath));
      extendedConfigPath = [];
      if (value.kind === "string") {
        const p = getExtendsConfigPath(value.value, host, newBase, notes);
        if (p !== "") extendedConfigPath.push(p);
      } else if (value.kind === "array") {
        for (const e of value.elements) {
          if (e.kind === "string") {
            const p = getExtendsConfigPath(e.value, host, newBase, notes);
            if (p !== "") extendedConfigPath.push(p);
          }
        }
      }
    }
  }
  if (lastCompilerOptionsIsObject) {
    for (const [k, v] of rawCompilerOptions) if (v.kind === "null") explicitNull.add(k);
  }
  return { options, explicitNull, extendedConfigPath };
}

// tsconfigparsing.go:1082
function parseConfig(
  text: string,
  host: ConfigHost,
  basePath: string,
  configFileName: string,
  resolutionStack: string[],
  notes: string[],
): ParsedConfig {
  basePath = normalizeSlashes(basePath);
  const resolvedPath = toPath(configFileName, basePath);
  if (resolutionStack.includes(resolvedPath)) {
    return { options: undefined, explicitNull: new Set(), notes };
  }
  const root = isBlankJsonc(text) ? ({ kind: "object", properties: [] } as JsonNode) : parseJsonc(text);
  if (root === undefined) {
    notes.push(`${resolvedPath} is not JSON with comments; the reference reads it with its parser's error recovery; not modelled`);
    return { options: emptySkipRelevantOptions(), explicitNull: new Set(), notes };
  }
  const own = parseOwnConfig(root, host, basePath, configFileName, notes);
  let options = own.options;
  if (own.extendedConfigPath !== undefined) {
    const stack = resolutionStack.concat([resolvedPath]);
    const result = emptySkipRelevantOptions();
    for (const extendedConfigPath of own.extendedConfigPath) {
      const extendedText = host.files.get(extendedConfigPath);
      // readJsonConfigFile: a file that is absent or empty gives no config
      if (extendedText === undefined) continue;
      if (!isBlankJsonc(extendedText) && parseJsonc(extendedText) === undefined) {
        notes.push(`${extendedConfigPath} is not JSON with comments; not modelled`);
        continue;
      }
      const extended = parseConfig(
        extendedText,
        host,
        getDirectoryPath(extendedConfigPath),
        getBaseFileName(extendedConfigPath),
        stack,
        notes,
      );
      if (extended.options !== undefined) mergeCompilerOptions(result, extended.options, extended.explicitNull);
    }
    options = mergeCompilerOptions(result, own.options, own.explicitNull);
  }
  return { options, explicitNull: own.explicitNull, notes };
}

// tsconfigparsing.go:1797
function getSubstitutedPathWithConfigDirTemplate(value: string, basePath: string): string {
  return getNormalizedAbsolutePath(value.replace(configDirTemplate, "./"), basePath);
}

// tsconfigparsing.go:1237 up to the options; the file names of the config are not computed
export function parseJsonSourceFileConfigFileContent(
  text: string,
  host: ConfigHost,
  basePath: string,
  configFileName: string,
): ParsedConfig {
  const basePathForFileNames = normalizePath(getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)));
  const parsed = parseConfig(text, host, basePath, configFileName, [], []);
  const options = parsed.options;
  if (options !== undefined) {
    if (startsWithConfigDirTemplate(options.outFile)) {
      options.outFile = getSubstitutedPathWithConfigDirTemplate(options.outFile, basePathForFileNames);
    }
    if (startsWithConfigDirTemplate(options.baseUrl)) {
      options.baseUrl = getSubstitutedPathWithConfigDirTemplate(options.baseUrl, basePathForFileNames);
    }
  }
  return parsed;
}
