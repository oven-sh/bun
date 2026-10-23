import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leftOutOf, Problems, type MemberDeclaration, type Source, type SourcedDeclaration } from "./declarations.ts";
import { memberPathOf } from "./paths.ts";
import { cap } from "./support.ts";
import { targetPlatforms, type BuiltinPath, type EntryColumns, type TargetPlatform } from "./vocabulary.ts";

export interface StaticTableEntry {
  key: string;
  value: string;
  attributes: readonly string[];
  length: number | null;
  platforms: readonly TargetPlatform[];
  line: number;
}

type Report = (line: number, message: string) => void;

type ValueColumn = "Function" | "Getter" | "Data" | "CreationCallback";

interface WordMeaning {
  kind?: "Function" | "Accessor" | "DataProperty";
  valueColumn?: ValueColumn;
  isLazilyCreated?: boolean;
  requiresFunction?: boolean;
}

interface Condition {
  platforms: readonly TargetPlatform[];
  isElse: boolean;
}

const constructableWord = "Constructable";

const attributeWords = new Map<string, WordMeaning>([
  ["Function", { kind: "Function", valueColumn: "Function" }],
  [constructableWord, { requiresFunction: true }],
  ["Builtin", { requiresFunction: true }],
  ["PropertyCallback", { kind: "DataProperty", valueColumn: "CreationCallback", isLazilyCreated: true }],
  ["ClassStructure", { kind: "DataProperty", valueColumn: "Data", isLazilyCreated: true }],
  ["CellProperty", { kind: "DataProperty", valueColumn: "Data" }],
  ["ConstantInteger", { kind: "DataProperty", valueColumn: "Data" }],
  ["CustomAccessor", { kind: "Accessor", valueColumn: "Getter" }],
  ["Accessor", { kind: "Accessor", valueColumn: "Getter" }],
  ["DOMJITAttribute", { kind: "Accessor", valueColumn: "Getter" }],
  ["DOMAttribute", {}],
  ["ReadOnly", {}],
  ["DontDelete", {}],
  ["DontEnum", {}],
]);

const builtinCodeGenerator = "JSBuiltin";

const beginPattern = /^@begin\s+([:\w]+)\s*\d*$/;
const conditionPattern = /^#if\s+(!?)OS\((WINDOWS|DARWIN|LINUX)\)$/;
// A row that only some builds of the host have. b.leftOut() lists the names that are defined.
const definedPattern = /^#if\s+(!?)defined\((\w+)\)$/;

const platformsByOS: Readonly<Record<string, readonly TargetPlatform[]>> = {
  WINDOWS: ["Windows"],
  DARWIN: ["Darwin"],
  LINUX: ["Linux", "Android"],
};

const platformsExcept = (excluded: readonly TargetPlatform[]): TargetPlatform[] =>
  targetPlatforms.filter(platform => !excluded.includes(platform));

function findTableBegin(lines: readonly string[], table: string, report: Report): number | null {
  const found = lines.flatMap((line, index) => (beginPattern.exec(line)?.[1] === table ? [index] : []));
  if (found.length === 0) {
    report(1, `there is no table ${table}`);
    return null;
  }
  if (found.length > 1) report(found[1] + 1, `the table ${table} appears twice`);
  return found[0];
}

function parseDirective(
  line: string,
  condition: Condition | null,
  definedNames: ReadonlySet<string>,
  lineNumber: number,
  report: Report,
): Condition | null {
  if (line === "#endif") {
    if (condition === null) report(lineNumber, "#endif without #if");
    return null;
  }
  if (line === "#else") {
    if (condition === null) {
      report(lineNumber, "#else without #if");
      return null;
    }
    if (condition.isElse) {
      report(lineNumber, "#else after #else");
      return condition;
    }
    return { platforms: platformsExcept(condition.platforms), isElse: true };
  }
  const match = conditionPattern.exec(line);
  const defined = definedPattern.exec(line);
  if (match === null && defined === null) {
    report(lineNumber, `unsupported directive: ${line}`);
    return condition;
  }
  if (condition !== null) {
    report(lineNumber, "nested #if");
    return condition;
  }
  if (match === null) {
    const holds = definedNames.has(defined![2]) !== (defined![1] === "!");
    return { platforms: holds ? targetPlatforms : [], isElse: false };
  }
  const tested = platformsByOS[match[2]];
  return { platforms: match[1] === "!" ? platformsExcept(tested) : tested, isElse: false };
}

function parseEntryLine(
  line: string,
  platforms: readonly TargetPlatform[],
  lineNumber: number,
  report: Report,
): StaticTableEntry | null {
  const fields = line.split(/\s+/);
  if (fields.length < 3 || fields.length > 5) {
    report(
      lineNumber,
      `expected key, value, attributes, optional length and optional intrinsic, found ${fields.length} fields`,
    );
    return null;
  }
  const [key, value, attributes, length] = fields;
  if (length !== undefined && !/^\d+$/.test(length)) {
    report(lineNumber, `${key}: length ${length} is not a decimal number`);
    return null;
  }
  return {
    key,
    value,
    attributes: attributes.split("|"),
    length: length === undefined ? null : Number(length),
    platforms,
    line: lineNumber,
  };
}

function parseTable(
  text: string,
  table: string,
  definedNames: ReadonlySet<string>,
  report: Report,
): StaticTableEntry[] {
  const lines = text.split("\n").map(line => line.trim());
  const beginIndex = findTableBegin(lines, table, report);
  if (beginIndex === null) return [];
  const entries: StaticTableEntry[] = [];
  const platformsByKey = new Map<string, Set<TargetPlatform>>();
  let condition: Condition | null = null;
  for (let index = beginIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line === "@end") {
      if (condition !== null) report(lineNumber, "@end inside #if");
      return entries;
    }
    if (line === "") continue;
    if (line.startsWith("#")) {
      condition = parseDirective(line, condition, definedNames, lineNumber, report);
      continue;
    }
    const entry = parseEntryLine(line, condition?.platforms ?? targetPlatforms, lineNumber, report);
    if (entry === null || entry.platforms.length === 0) continue;
    const earlierPlatforms = platformsByKey.get(entry.key) ?? new Set<TargetPlatform>();
    if (entry.platforms.some(platform => earlierPlatforms.has(platform))) {
      report(lineNumber, `${entry.key} appears twice`);
      continue;
    }
    platformsByKey.set(entry.key, earlierPlatforms.union(new Set(entry.platforms)));
    entries.push(entry);
  }
  report(beginIndex + 1, `the table ${table} has no @end`);
  return entries;
}

export function parseHashTable(
  text: string,
  table: string,
  file: string,
  definedNames: ReadonlySet<string> = new Set(),
): StaticTableEntry[] {
  const problems = new Problems();
  const entries = parseTable(text, table, definedNames, (line, message) =>
    problems.add(null, `${file}:${line}: ${message}`),
  );
  problems.throwIfAny();
  return entries;
}

function setterSymbolOf(getter: string): string {
  return `set${getter.includes("js") ? getter.replace("js", "JS") : cap(getter)}`;
}

function symbolColumnsOf(
  entry: StaticTableEntry,
): Pick<EntryColumns, "nativeSymbols" | "creationSymbol" | "hasSetter"> {
  if (entry.value === builtinCodeGenerator) return { nativeSymbols: [] };
  const symbol = entry.value.startsWith("&") ? entry.value.slice(1) : entry.value;
  const [valueColumn = "Getter"] = entry.attributes.flatMap(word => attributeWords.get(word)?.valueColumn ?? []);
  switch (valueColumn) {
    case "Data":
      return { nativeSymbols: [] };
    case "Function":
      return { nativeSymbols: [symbol] };
    case "Getter":
      return entry.attributes.includes("ReadOnly")
        ? { nativeSymbols: [symbol], hasSetter: false }
        : { nativeSymbols: [symbol, setterSymbolOf(symbol)], hasSetter: true };
    case "CreationCallback":
      return { nativeSymbols: [], creationSymbol: symbol };
  }
}

function findMeanings(path: BuiltinPath, entry: StaticTableEntry, report: Report): WordMeaning[] | null {
  const meanings: WordMeaning[] = [];
  for (const word of entry.attributes) {
    const meaning = attributeWords.get(word);
    if (meaning === undefined) report(entry.line, `${path}: unknown attribute ${word}`);
    else meanings.push(meaning);
  }
  return meanings.length === entry.attributes.length ? meanings : null;
}

function memberOf(
  holder: BuiltinPath,
  isPrototype: boolean,
  entry: StaticTableEntry,
  report: Report,
): MemberDeclaration | null {
  const path = memberPathOf(holder, entry.key);
  const meanings = findMeanings(path, entry, report);
  if (meanings === null) return null;
  const attributeText = entry.attributes.join("|");
  const kinds = new Set(meanings.flatMap(meaning => meaning.kind ?? []));
  if (kinds.size > 1) {
    report(entry.line, `${path}: expected at most one kind of member in ${attributeText}`);
    return null;
  }
  const [kind = "DataProperty"] = kinds;
  if (kind === "Function" && entry.length === null) {
    report(entry.line, `${path}: a function needs a length`);
    return null;
  }
  if (kind !== "Function" && meanings.some(meaning => meaning.requiresFunction === true)) {
    report(entry.line, `${path}: ${attributeText} applies only to a function`);
    return null;
  }
  return {
    declares: "Member",
    path,
    kind: kind === "Function" && isPrototype ? "Method" : kind,
    isOwnPropertyOfInstances: false,
    isLazilyCreated: meanings.some(meaning => meaning.isLazilyCreated === true),
    signatures: [],
    dispatches: [],
    constant: null,
    length: entry.length,
    columns: {
      platforms: entry.platforms,
      ...symbolColumnsOf(entry),
      ...(entry.attributes.includes(constructableWord) ? { constructable: true } : {}),
    },
  };
}

function findPrototypePaths(declared: readonly SourcedDeclaration[]): Set<BuiltinPath> {
  const paths = new Set<BuiltinPath>();
  for (const { declaration } of declared) {
    if (declaration.declares !== "Class" || declaration.columns.hasPrototype === false) continue;
    paths.add(memberPathOf(declaration.path, "prototype"));
  }
  return paths;
}

function readTableFile(path: string, texts: Map<string, string | null>): string | null {
  const known = texts.get(path);
  if (known !== undefined) return known;
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  texts.set(path, text);
  return text;
}

export function collectStaticTables(
  declared: readonly SourcedDeclaration[],
  roots: { Engine: string; Host: string },
  problems: Problems,
): SourcedDeclaration[] {
  const prototypePaths = findPrototypePaths(declared);
  const definedNames = new Set(leftOutOf(declared).flatMap(leftOut => leftOut.definedNames));
  const texts = new Map<string, string | null>();
  const members: SourcedDeclaration[] = [];
  for (const { declaration, source } of declared) {
    if (declaration.declares !== "StaticTable") continue;
    const { holder, table } = declaration;
    const text = readTableFile(join(roots[source.origin], table.file), texts);
    if (text === null) {
      problems.add(source, `${holder}: there is no file ${table.file}`);
      continue;
    }
    const sourceAt = (line: number): Source => ({ file: table.file, line, origin: source.origin, proof: "Structure" });
    const report: Report = (line, message) => problems.add(sourceAt(line), message);
    for (const entry of parseTable(text, table.table, definedNames, report)) {
      const member = memberOf(holder, prototypePaths.has(holder), entry, report);
      if (member !== null) members.push({ declaration: member, source: sourceAt(entry.line) });
    }
  }
  return members;
}
