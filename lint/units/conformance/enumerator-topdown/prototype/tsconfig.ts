// Research probe: the smallest config reader that the skip rule needs (eight options and the extends chain).
import { enumMaps } from "./options";
import {
  getBaseFileName, getDirectoryPath, getNormalizedAbsolutePath, isRootedDiskPath, normalizeSlashes, toPath,
} from "./tspath";

export type JsonValue =
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "array"; elements: JsonValue[] }
  | { kind: "object"; entries: [string, JsonValue][] };

export type ParseResult = { ok: true; value: JsonValue | undefined } | { ok: false; reason: string };

// JSON with comments and trailing commas; an empty text gives no value. Nothing else is accepted.
export function parseJsonc(text: string): ParseResult {
  let pos = 0;
  let depth = 0;
  const fail = (what: string): { ok: false; reason: string } => ({ ok: false, reason: `${what} at offset ${pos}` });

  function skipTrivia(): string | undefined {
    for (;;) {
      const ch = text.charCodeAt(pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        pos++;
      } else if (ch === 0x2f && text.charCodeAt(pos + 1) === 0x2f) {
        pos += 2;
        while (pos < text.length && text.charCodeAt(pos) !== 0x0a && text.charCodeAt(pos) !== 0x0d) pos++;
      } else if (ch === 0x2f && text.charCodeAt(pos + 1) === 0x2a) {
        const end = text.indexOf("*/", pos + 2);
        if (end < 0) return "unterminated comment";
        pos = end + 2;
      } else {
        return undefined;
      }
    }
  }

  function parseString(): { ok: true; value: string } | { ok: false; reason: string } {
    pos++;
    let out = "";
    for (;;) {
      if (pos >= text.length) return fail("unterminated string");
      const ch = text[pos];
      const code = text.charCodeAt(pos);
      if (ch === '"') {
        pos++;
        return { ok: true, value: out };
      }
      if (code < 0x20) return fail("control character in string");
      if (ch === "\\") {
        const esc = text[pos + 1];
        pos += 2;
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = text.slice(pos, pos + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("bad unicode escape");
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 4;
            break;
          }
          default:
            return fail("bad escape");
        }
        continue;
      }
      out += ch;
      pos++;
    }
  }

  function parseValue(): { ok: true; value: JsonValue } | { ok: false; reason: string } {
    const trivia = skipTrivia();
    if (trivia !== undefined) return fail(trivia);
    if (pos >= text.length) return fail("value expected");
    const ch = text[pos];
    if (ch === "{") {
      if (++depth > 256) return fail("nesting too deep");
      pos++;
      const entries: [string, JsonValue][] = [];
      for (;;) {
        const t = skipTrivia();
        if (t !== undefined) return fail(t);
        if (text[pos] === "}") {
          pos++;
          break;
        }
        if (text[pos] !== '"') return fail("property name expected");
        const key = parseString();
        if (!key.ok) return key;
        const t2 = skipTrivia();
        if (t2 !== undefined) return fail(t2);
        if (text[pos] !== ":") return fail("colon expected");
        pos++;
        const value = parseValue();
        if (!value.ok) return value;
        entries.push([key.value, value.value]);
        const t3 = skipTrivia();
        if (t3 !== undefined) return fail(t3);
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          break;
        }
        return fail("comma or closing brace expected");
      }
      depth--;
      return { ok: true, value: { kind: "object", entries } };
    }
    if (ch === "[") {
      if (++depth > 256) return fail("nesting too deep");
      pos++;
      const elements: JsonValue[] = [];
      for (;;) {
        const t = skipTrivia();
        if (t !== undefined) return fail(t);
        if (text[pos] === "]") {
          pos++;
          break;
        }
        const value = parseValue();
        if (!value.ok) return value;
        elements.push(value.value);
        const t3 = skipTrivia();
        if (t3 !== undefined) return fail(t3);
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          break;
        }
        return fail("comma or closing bracket expected");
      }
      depth--;
      return { ok: true, value: { kind: "array", elements } };
    }
    if (ch === '"') {
      const s = parseString();
      if (!s.ok) return s;
      return { ok: true, value: { kind: "string", value: s.value } };
    }
    if (text.startsWith("true", pos)) return ((pos += 4), { ok: true, value: { kind: "boolean", value: true } });
    if (text.startsWith("false", pos)) return ((pos += 5), { ok: true, value: { kind: "boolean", value: false } });
    if (text.startsWith("null", pos)) return ((pos += 4), { ok: true, value: { kind: "null" } });
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(pos, pos + 64));
    if (m !== null) {
      pos += m[0].length;
      return { ok: true, value: { kind: "number", value: Number(m[0]) } };
    }
    return fail("value expected");
  }

  const lead = skipTrivia();
  if (lead !== undefined) return fail(lead);
  if (pos >= text.length) return { ok: true, value: undefined };
  const value = parseValue();
  if (!value.ok) return value;
  const trail = skipTrivia();
  if (trail !== undefined) return fail(trail);
  if (pos < text.length) {
    // A literal followed by an identifier character is one token for the reference's scanner.
    return fail("end of file expected");
  }
  return { ok: true, value: value.value };
}

// The fields of core.CompilerOptions that harnessutil.SkipUnsupportedCompilerOptions reads; zero is "not set".
export interface SkipOptions {
  module: number;
  moduleResolution: number;
  esModuleInterop: 0 | 1 | 2;
  allowSyntheticDefaultImports: 0 | 1 | 2;
  baseUrl: string;
  outFile: string;
  target: number;
  alwaysStrict: 0 | 1 | 2;
}
export const TSUnknown = 0;
export const TSFalse = 1;
export const TSTrue = 2;
export function emptySkipOptions(): SkipOptions {
  return { module: 0, moduleResolution: 0, esModuleInterop: 0, allowSyntheticDefaultImports: 0, baseUrl: "", outFile: "", target: 0, alwaysStrict: 0 };
}
export const skipOptionNames = ["module", "moduleResolution", "esModuleInterop", "allowSyntheticDefaultImports", "baseUrl", "outFile", "target", "alwaysStrict"] as const;
type SkipOptionName = (typeof skipOptionNames)[number];
const kindOf: Record<SkipOptionName, "enum" | "boolean" | "string"> = {
  module: "enum", moduleResolution: "enum", target: "enum",
  esModuleInterop: "boolean", allowSyntheticDefaultImports: "boolean", alwaysStrict: "boolean",
  baseUrl: "string", outFile: "string",
};

const configDirTemplate = "${configDir}";
function startsWithConfigDirTemplate(value: string): boolean {
  return value.toLowerCase().startsWith(configDirTemplate.toLowerCase());
}

interface ParsedTsconfig {
  // undefined mirrors a nil options pointer (the circular case).
  options: SkipOptions | undefined;
  // Keys of compilerOptions whose last value is null or not a JSON value; undefined when raw is not an object.
  explicitNull: Set<string> | undefined;
  rawIsObject: boolean;
}

export interface ConfigReadResult {
  options: SkipOptions;
  // Facts that the reader saw and did not follow as the reference does.
  notes: string[];
}
export type ConfigResult = { ok: true; value: ConfigReadResult } | { ok: false; reason: string };

export interface ConfigHost {
  // Absolute normalized path to content, as makeUnitsFromTest builds allFiles.
  files: Map<string, string>;
  hasSymlinks: boolean;
  currentDirectory: string;
}

// tsoptions/parsinghelpers.go:648-694, for the eight fields.
function mergeCompilerOptions(target: SkipOptions, source: SkipOptions | undefined, explicitNull: Set<string> | undefined): SkipOptions {
  if (source === undefined) return target;
  for (const name of skipOptionNames) {
    if (explicitNull !== undefined && explicitNull.has(name)) {
      (target as any)[name] = kindOf[name] === "string" ? "" : 0;
      continue;
    }
    const v = source[name];
    if (v !== 0 && v !== "") (target as any)[name] = v;
  }
  return target;
}

class Reader {
  notes: string[] = [];
  failure: string | undefined;
  constructor(readonly host: ConfigHost) {}

  // tsconfigparsing.go:457-502 and parsinghelpers.go:279-558, for the eight options.
  setOption(options: SkipOptions, name: SkipOptionName, value: JsonValue, basePath: string): void {
    if (value.kind === "null") return;
    switch (kindOf[name]) {
      case "enum": {
        if (value.kind !== "string" || value.value === "") return;
        const hit = enumMaps[name].find(([k]) => k === value.value.toLowerCase());
        if (hit === undefined) return;
        (options as any)[name] = hit[1];
        return;
      }
      case "boolean":
        if (value.kind !== "boolean") return;
        (options as any)[name] = value.value ? TSTrue : TSFalse;
        return;
      case "string": {
        if (value.kind !== "string") return;
        let v = normalizeSlashes(value.value);
        if (!startsWithConfigDirTemplate(v)) v = getNormalizedAbsolutePath(v, basePath);
        if (v === "") v = ".";
        (options as any)[name] = v;
        return;
      }
    }
  }

  // tsconfigparsing.go:553-588
  getExtendsConfigPath(extendedConfig: string, basePath: string): string {
    extendedConfig = normalizeSlashes(extendedConfig);
    if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
      let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
      if (!this.fileExists(extendedConfigPath) && !extendedConfigPath.endsWith(".json")) {
        extendedConfigPath = extendedConfigPath + ".json";
        if (!this.fileExists(extendedConfigPath)) return "";
      }
      return extendedConfigPath;
    }
    this.notes.push(`extends ${JSON.stringify(extendedConfig)} is resolved like a module by the reference and is not followed`);
    return "";
  }

  fileExists(path: string): boolean {
    if (this.host.files.has(path)) return true;
    if (this.host.hasSymlinks) this.notes.push(`extends path ${JSON.stringify(path)} is not a unit and the case has links, which are not followed`);
    return false;
  }

  // tsconfigparsing.go:178-281, for compilerOptions and extends.
  parseOwnConfig(text: string, basePath: string, configFileName: string): { own: ParsedTsconfig; extendedConfigPath: string[] | undefined } | undefined {
    const parsed = parseJsonc(text);
    if (!parsed.ok) {
      this.failure = parsed.reason;
      return undefined;
    }
    const options = emptySkipOptions();
    let extendedConfigPath: string[] | undefined;
    let root = parsed.value;
    // tsconfigparsing.go:319-335, the recovery that takes the first object of a root array.
    if (root !== undefined && root.kind === "array") {
      root = root.elements.find(e => e.kind === "object");
      if (root === undefined) return { own: { options, explicitNull: new Set(), rawIsObject: true }, extendedConfigPath };
    }
    if (root === undefined || root.kind !== "object") {
      return { own: { options, explicitNull: undefined, rawIsObject: false }, extendedConfigPath };
    }
    let explicitNull: Set<string> | undefined;
    let lastCompilerOptions: JsonValue | undefined;
    for (const [key, value] of root.entries) {
      if (key === "compilerOptions") {
        lastCompilerOptions = value;
        if (value.kind === "object") {
          for (const [k, v] of value.entries) {
            if ((skipOptionNames as readonly string[]).includes(k)) this.setOption(options, k as SkipOptionName, v, basePath);
          }
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
    if (lastCompilerOptions !== undefined && lastCompilerOptions.kind === "object") {
      explicitNull = new Set();
      const last = new Map<string, JsonValue>();
      for (const [k, v] of lastCompilerOptions.entries) last.set(k, v);
      for (const [k, v] of last) if (v.kind === "null") explicitNull.add(k);
    }
    return { own: { options, explicitNull, rawIsObject: true }, extendedConfigPath };
  }

  // tsconfigparsing.go:1082-1217
  parseConfig(text: string, basePath: string, configFileName: string, resolutionStack: string[]): ParsedTsconfig | undefined {
    basePath = normalizeSlashes(basePath);
    const resolvedPath = toPath(configFileName, basePath);
    if (resolutionStack.includes(resolvedPath)) {
      return { options: undefined, explicitNull: undefined, rawIsObject: false };
    }
    const parsed = this.parseOwnConfig(text, basePath, configFileName);
    if (parsed === undefined) return undefined;
    const ownConfig = parsed.own;
    if (parsed.extendedConfigPath !== undefined) {
      resolutionStack = [...resolutionStack, resolvedPath];
      const result = emptySkipOptions();
      for (const extendedConfigPath of parsed.extendedConfigPath) {
        // tsconfigparsing.go:1052-1078; a file that cannot be read gives no config.
        const extendedText = this.host.files.get(extendedConfigPath);
        if (extendedText === undefined) continue;
        let extendedConfig: ParsedTsconfig | undefined;
        if (extendedText === "") {
          extendedConfig = { options: emptySkipOptions(), explicitNull: undefined, rawIsObject: false };
        } else {
          extendedConfig = this.parseConfig(extendedText, getDirectoryPath(extendedConfigPath), getBaseFileName(extendedConfigPath), resolutionStack);
          if (extendedConfig === undefined) return undefined;
        }
        if (extendedConfig.options !== undefined) {
          mergeCompilerOptions(result, extendedConfig.options, extendedConfig.explicitNull);
        }
      }
      ownConfig.options = mergeCompilerOptions(result, ownConfig.options, ownConfig.explicitNull);
    }
    return ownConfig;
  }
}

// test_case_parser.go:82-110 with tsconfigparsing.go:1237-1264, for the eight fields.
export function readConfigForSkip(host: ConfigHost, configUnitName: string, configText: string): ConfigResult {
  const reader = new Reader(host);
  const configFileName = getNormalizedAbsolutePath(configUnitName, host.currentDirectory);
  const configDir = getDirectoryPath(configFileName);
  const parsedConfig = reader.parseConfig(configText, configDir, configFileName, []);
  if (parsedConfig === undefined) {
    return { ok: false, reason: `${configFileName}: ${reader.failure}: the config reader takes JSON with comments and trailing commas only` };
  }
  const options = parsedConfig.options ?? emptySkipOptions();
  // tsconfigparsing.go:1817-1865
  const basePathForFileNames = getDirectoryPath(getNormalizedAbsolutePath(configFileName, configDir));
  for (const name of ["outFile", "baseUrl"] as const) {
    if (startsWithConfigDirTemplate(options[name])) {
      options[name] = getNormalizedAbsolutePath(options[name].replace(configDirTemplate, "./"), basePathForFileNames);
    }
  }
  return { ok: true, value: { options, notes: reader.notes } };
}
