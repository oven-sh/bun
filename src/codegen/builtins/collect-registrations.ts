import { readFileSync } from "node:fs";
import path from "node:path";
import type { NativeCallsDeclaration, Problems, Proof, Source, SourcedDeclaration } from "./declarations.ts";
import * as b from "./lib.ts";
import { compareBytes, pathOfClassMember } from "./paths.ts";

const accessDirections = ["Read", "Write"] as const;
const numberKinds = ["Signed", "Unsigned", "Float", "BigInt"] as const;
const endiannesses = ["Little", "Big"] as const;

type NumberKind = (typeof numberKinds)[number];

export interface BufferAccessor {
  name: string;
  aliasOf: string | null;
  direction: (typeof accessDirections)[number];
  byteCount: number;
  numberKind: NumberKind;
  endianness: (typeof endiannesses)[number];
}

export interface NativeLoadSite {
  file: string;
  line: number;
  registryField: string;
  onBehalfOf: string;
  exports: string[] | null;
}

interface ListedAccessor {
  accessor: BufferAccessor;
  line: number;
}

interface ListedAlias {
  alias: string;
  original: string;
  line: number;
}

interface Span {
  start: number;
  end: number;
}

type ReportAtLine = (line: number, message: string) => void;
type Report = (message: string) => void;

const accessorsFile = "src/jsc/bindings/JSBufferAccessors.def";
const accessorPattern = /^BUFFER_ACCESSOR\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\d+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)$/;
const aliasPattern = /^BUFFER_ACCESSOR_ALIAS\(\s*(\w+)\s*,\s*(\w+)\s*\)$/;

const byteCountsByKind: Readonly<Record<NumberKind, readonly number[]>> = {
  Signed: [1, 2, 3, 4, 5, 6, 8],
  Unsigned: [1, 2, 3, 4, 5, 6, 8],
  Float: [4, 8],
  BigInt: [8],
};

const bufferClass = "Buffer";
const arrayBufferView = b.union(b.instance("TypedArray"), b.instance("DataView"));
const offsetType = b.f64.optional;
const maximumBufferLength = b.checked(2 ** 32, "MAX_ARRAY_BUFFER_SIZE");

const requireMacro = "BUN_REQUIRE_INTERNAL_MODULE";
const privateRequire = "requireId";
const registryFiles: ReadonlySet<string> = new Set([
  "src/jsc/bindings/InternalModuleRegistry.h",
  "src/jsc/bindings/InternalModuleRegistry.cpp",
]);

const cppTokenPattern =
  /\/\/(?:[^\\\n]|\\[^])*|\/\*[^]*?(?:\*\/|$)|(?:u8|[uUL])?R"([^\s()\\]{0,16})\([^]*?\)\1"|"(?:[^"\\\n]|\\[^])*"?|'(?:[^'\\\n]|\\[^])*'?|\d(?:[eEpP][+-]|[\w.'])*|[A-Za-z_$][\w$]*/g;
const rustTokenPattern =
  /\/\/[^\n]*|\/\*[^]*?(?:\*\/|$)|b?r(#*)"[^]*?"\1|b?"(?:[^"\\]|\\[^])*"?|b?'(?:[^'\\\n]|\\(?:[^u\n]|u\{[\da-fA-F_]*\}))'/g;
const macroUsePattern = new RegExp(`(#[ \\t]*define[ \\t]+)?\\b${requireMacro}\\b\\s*\\(`, "g");
const directRequirePattern = new RegExp(`\\b${privateRequire}\\s*\\(`, "g");
const identifierPattern = /^[A-Za-z_]\w*$/;
const plainLiteralPattern = /^"([^"\\\n]+)"$/;
const asciiLiteralPattern = /^"([^"\\\n]+)"_s$/;

const sourceAt = (file: string, line: number | null, proof: Proof): Source => ({ file, line, origin: "Host", proof });

function findWord<Word extends string>(words: readonly Word[], written: string, report: Report): Word | null {
  const word = words.find(candidate => candidate === written) ?? null;
  if (word === null) report(`${written} is not one of ${words.join(", ")}`);
  return word;
}

function parseAccessor(match: RegExpExecArray, reportLine: Report): BufferAccessor | null {
  const [, name, writtenDirection, writtenByteCount, writtenKind, writtenEndianness] = match;
  const report: Report = message => reportLine(`${name}: ${message}`);
  const direction = findWord(accessDirections, writtenDirection, report);
  const numberKind = findWord(numberKinds, writtenKind, report);
  const endianness = findWord(endiannesses, writtenEndianness, report);
  if (direction === null || numberKind === null || endianness === null) return null;
  const byteCount = Number(writtenByteCount);
  if (!byteCountsByKind[numberKind].includes(byteCount)) {
    report(`no ${numberKind} accessor moves ${byteCount} bytes`);
    return null;
  }
  return { name, aliasOf: null, direction, byteCount, numberKind, endianness };
}

function parseListedLines(text: string, report: ReportAtLine): (ListedAccessor | ListedAlias)[] {
  const listed: (ListedAccessor | ListedAlias)[] = [];
  for (const [index, piece] of text.split("\n").entries()) {
    const line = index + 1;
    const written = piece.trim();
    if (written === "") continue;
    const accessorMatch = accessorPattern.exec(written);
    const aliasMatch = aliasPattern.exec(written);
    if (accessorMatch !== null) {
      const accessor = parseAccessor(accessorMatch, message => report(line, message));
      if (accessor !== null) listed.push({ accessor, line });
    } else if (aliasMatch !== null) {
      listed.push({ alias: aliasMatch[1], original: aliasMatch[2], line });
    } else {
      report(
        line,
        `expected BUFFER_ACCESSOR(name, direction, bytes, kind, endianness) or BUFFER_ACCESSOR_ALIAS(alias, name), found ${written}`,
      );
    }
  }
  return listed;
}

function resolveAliases(listed: readonly (ListedAccessor | ListedAlias)[], report: ReportAtLine): ListedAccessor[] {
  const originals = new Map<string, BufferAccessor>();
  for (const entry of listed) {
    if ("accessor" in entry) originals.set(entry.accessor.name, entry.accessor);
  }
  const names = new Set<string>();
  const resolved: ListedAccessor[] = [];
  for (const entry of listed) {
    const name = "accessor" in entry ? entry.accessor.name : entry.alias;
    if (names.has(name)) {
      report(entry.line, `${name} is listed twice`);
      continue;
    }
    names.add(name);
    if ("accessor" in entry) {
      resolved.push(entry);
      continue;
    }
    const original = originals.get(entry.original);
    if (original === undefined) {
      report(entry.line, `${entry.alias}: ${entry.original} is not an accessor of this file`);
      continue;
    }
    resolved.push({ accessor: { ...original, name: entry.alias, aliasOf: original.name }, line: entry.line });
  }
  return resolved;
}

function listAccessors(text: string, file: string, problems: Problems): ListedAccessor[] {
  const report: ReportAtLine = (line, message) => problems.add(sourceAt(file, line, "Structure"), message);
  return resolveAliases(parseListedLines(text, report), report);
}

function movedTypeOf({ numberKind, byteCount }: BufferAccessor): b.TableType {
  const bitCount = 8 * byteCount;
  switch (numberKind) {
    case "BigInt":
      return b.bigint;
    case "Float":
      return b.f64;
    case "Signed":
      return bitCount === 64 ? b.bigint : b.int(-(2 ** (bitCount - 1)), 2 ** (bitCount - 1) - 1);
    case "Unsigned":
      return bitCount === 64 ? b.bigint : b.int(0, 2 ** bitCount - 1);
  }
}

function signatureOf(accessor: BufferAccessor): b.SignatureOptions {
  const { direction, byteCount, numberKind, endianness } = accessor;
  const moved = movedTypeOf(accessor);
  const movesBigInt = moved === b.bigint;
  const shared = {
    this: b.instance(bufferClass),
    capability: movesBigInt ? "heap" : "none",
    throws: true,
    implementation: b.inline("BufferAccess", {
      parameters: [direction, byteCount, numberKind, endianness],
      otherwise: b.hostCall,
    }),
  } as const;
  switch (direction) {
    case "Read":
      return { ...shared, args: { offset: offsetType }, returns: moved, uses: { this: [b.readsContents()] } };
    case "Write":
      return {
        ...shared,
        args: { value: movesBigInt ? b.bigint : b.f64.loose, offset: offsetType },
        returns: b.int(byteCount, maximumBufferLength),
        uses: { this: [b.readsContents(), b.writesContents()] },
      };
  }
}

function overloadsOf(accessor: BufferAccessor): b.FunctionField[] {
  const onBuffer = signatureOf(accessor);
  return [onBuffer, { ...onBuffer, this: arrayBufferView, implementation: b.hostCall }];
}

export function collectBufferAccessors(bunRoot: string, problems: Problems): SourcedDeclaration[] {
  const text = readFileSync(path.join(bunRoot, accessorsFile), "utf8");
  const pathOf = (name: string) => pathOfClassMember(bufferClass, "proto", name);
  return listAccessors(text, accessorsFile, problems).flatMap(({ accessor, line }) => {
    const { name, aliasOf } = accessor;
    if (aliasOf !== null) {
      const source = sourceAt(accessorsFile, line, "Structure");
      return b.same(pathOf(name), pathOf(aliasOf)).map(declaration => ({ declaration, source }));
    }
    const source = sourceAt(accessorsFile, line, "ByConstruction");
    return b.method(pathOf(name), overloadsOf(accessor)).map(declaration => ({ declaration, source }));
  });
}

const blank = (text: string): string => text.replace(/[^\n]/g, " ");

function blankCommentsAndStrings(text: string): string {
  return text.replace(cppTokenPattern, token => {
    if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("'")) return blank(token);
    const quote = token.indexOf('"');
    if (quote === -1) return token;
    if (quote > 0) return blank(token);
    const isClosed = token.length > 1 && token.endsWith('"');
    return isClosed ? `"${blank(token.slice(1, -1))}"` : `"${blank(token.slice(1))}`;
  });
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = text.indexOf("\n"); index !== -1 && index < offset; index = text.indexOf("\n", index + 1)) line++;
  return line;
}

function splitArguments(code: string, start: number): Span[] | null {
  const spans: Span[] = [];
  let depth = 0;
  let first = start;
  for (let index = start; index < code.length; index++) {
    const character = code[index];
    if (character === "(") {
      depth++;
    } else if (character === ")" && depth > 0) {
      depth--;
    } else if (character === ")") {
      spans.push({ start: first, end: index });
      return spans;
    } else if (character === "," && depth === 0) {
      spans.push({ start: first, end: index });
      first = index + 1;
    }
  }
  return null;
}

function textOfArgument(text: string, code: string, { start, end }: Span): string {
  const blanked = code.slice(start, end);
  const leadingBlanks = blanked.length - blanked.trimStart().length;
  return text.slice(start + leadingBlanks, start + blanked.trimEnd().length);
}

function parseLoadArguments(
  written: readonly string[],
  report: Report,
): Pick<NativeLoadSite, "registryField" | "onBehalfOf" | "exports"> | null {
  if (written.length < 3) {
    report(`${requireMacro} takes a global object, a field of InternalModuleRegistry and a path or "Startup"`);
    return null;
  }
  const [, registryField, writtenPath, ...writtenExports] = written;
  const isField = identifierPattern.test(registryField);
  if (!isField) report(`${requireMacro}: ${registryField} is not the name of a field of InternalModuleRegistry`);
  const onBehalfOf = plainLiteralPattern.exec(writtenPath)?.[1] ?? null;
  if (onBehalfOf === null) report(`${requireMacro}: ${writtenPath} is not a string literal with a path or "Startup"`);
  const exports: string[] = [];
  for (const writtenExport of writtenExports) {
    const name = asciiLiteralPattern.exec(writtenExport)?.[1];
    if (name === undefined) report(`${requireMacro}: ${writtenExport} is not an export written as "name"_s`);
    else exports.push(name);
  }
  if (!isField || onBehalfOf === null || exports.length < writtenExports.length) return null;
  return { registryField, onBehalfOf, exports: exports.length === 0 ? null : exports };
}

export function parseNativeLoads(text: string, file: string, problems: Problems): NativeLoadSite[] {
  if (!text.includes(requireMacro) && !text.includes(privateRequire)) return [];
  const code = blankCommentsAndStrings(text);
  const reportAt =
    (offset: number): Report =>
    message =>
      problems.add(sourceAt(file, lineAt(code, offset), "Structure"), message);
  if (!registryFiles.has(file)) {
    for (const match of code.matchAll(directRequirePattern)) {
      reportAt(match.index)(
        `${privateRequire} is private to InternalModuleRegistry: use ${requireMacro}, DeclaredModuleLoad::requireNamedAtRunTime or DeclaredModuleLoad::requireForCommandLine`,
      );
    }
  }
  const sites: NativeLoadSite[] = [];
  for (const match of code.matchAll(macroUsePattern)) {
    if (match[1] !== undefined) continue;
    const report = reportAt(match.index);
    const spans = splitArguments(code, match.index + match[0].length);
    if (spans === null) {
      report(`${requireMacro} has no closing parenthesis`);
      continue;
    }
    const load = parseLoadArguments(
      spans.map(span => textOfArgument(text, code, span)),
      report,
    );
    if (load !== null) sites.push({ file, line: lineAt(code, match.index), ...load });
  }
  return sites;
}

const relativeToRoot = (bunRoot: string, file: string): string =>
  path.relative(bunRoot, path.resolve(bunRoot, file)).split(path.sep).join("/");

export function collectNativeLoads(
  bunRoot: string,
  nativeFiles: readonly string[],
  problems: Problems,
): SourcedDeclaration[] {
  const files = nativeFiles.map(file => relativeToRoot(bunRoot, file)).sort(compareBytes);
  return files.flatMap(file =>
    parseNativeLoads(readFileSync(path.join(bunRoot, file), "utf8"), file, problems).map(
      ({ line, registryField, onBehalfOf, exports }): SourcedDeclaration => ({
        declaration: { declares: "NativeLoad", registryField, onBehalfOf, exports },
        source: sourceAt(file, line, "Structure"),
      }),
    ),
  );
}

const blankRustCommentsAndStrings = (text: string): string => text.replace(rustTokenPattern, blank);

const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wordPattern = (words: readonly string[], after: string): RegExp =>
  new RegExp(`(?<![\\w$])(?:${words.map(escapeForPattern).join("|")})${after}`, "g");

const callPattern = (names: readonly string[]): RegExp => wordPattern(names, "\\s*(?:(?:::)?<[^<>();]*>\\s*)?\\(");

class NativeSources {
  readonly #bunRoot: string;
  readonly #files: ReadonlySet<string>;
  readonly #texts = new Map<string, string>();
  readonly #code = new Map<string, string>();

  constructor(bunRoot: string, files: readonly string[]) {
    this.#bunRoot = bunRoot;
    this.#files = new Set(files.map(file => relativeToRoot(bunRoot, file)).sort(compareBytes));
  }

  has(file: string): boolean {
    return this.#files.has(file);
  }

  filesNaming(names: readonly string[]): string[] {
    return [...this.#files].filter(file => names.some(name => this.#textOf(file).includes(name)));
  }

  codeOf(file: string): string {
    let code = this.#code.get(file);
    if (code === undefined) {
      const text = this.#textOf(file);
      code = file.endsWith(".rs") ? blankRustCommentsAndStrings(text) : blankCommentsAndStrings(text);
      this.#code.set(file, code);
    }
    return code;
  }

  #textOf(file: string): string {
    let text = this.#texts.get(file);
    if (text === undefined) {
      text = readFileSync(path.join(this.#bunRoot, file), "utf8");
      this.#texts.set(file, text);
    }
    return text;
  }
}

function countListedMentions({ otherMentions, callers }: NativeCallsDeclaration): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { file, times = 1 } of [...otherMentions, ...callers]) counts.set(file, (counts.get(file) ?? 0) + times);
  return counts;
}

function checkNativeCallsOf(
  declared: NativeCallsDeclaration,
  source: Source,
  sources: NativeSources,
  problems: Problems,
): void {
  const called = declared.calls.map(call => ("function" in call ? call.function.name : call.name)).join(" and ");
  const listed = countListedMentions(declared);
  for (const file of new Set([...listed.keys(), ...sources.filesNaming(declared.through)])) {
    if (!sources.has(file)) {
      problems.add(source, `${file} is not among the native sources that are searched for calls of ${called}`);
      continue;
    }
    const code = sources.codeOf(file);
    const lines = Array.from(code.matchAll(callPattern(declared.through)), mention => lineAt(code, mention.index));
    const listedCount = listed.get(file) ?? 0;
    if (lines.length === listedCount) continue;
    problems.add(
      sourceAt(file, lines[0] ?? null, "Structure"),
      `${declared.through.join(", ")}: named on ${lines.length} lines (${lines.join(", ")}), and ${source.file} lists ` +
        `${listedCount}. They end in a call of ${called}: list each native function that names one, with the built-ins it runs for`,
    );
  }
  for (const { file, caller } of declared.callers) {
    if (sources.has(file) && !wordPattern([caller], "(?![\\w$])").test(sources.codeOf(file))) {
      problems.add(source, `${file} has no ${caller}`);
    }
  }
}

export function checkNativeCalls(
  bunRoot: string,
  nativeFiles: readonly string[],
  declarations: readonly SourcedDeclaration[],
  problems: Problems,
): void {
  const sources = new NativeSources(bunRoot, nativeFiles);
  for (const { declaration, source } of declarations) {
    if (declaration.declares === "NativeCalls") checkNativeCallsOf(declaration, source, sources, problems);
  }
}
