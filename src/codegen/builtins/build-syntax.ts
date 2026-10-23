import type { ModelBuilder } from "./build-entries.ts";
import type { Problems, Source, SourcedDeclaration } from "./declarations.ts";
import { canonicalTextOf } from "./dump.ts";
import type { ModelIntrinsic, ModelIntrinsicMeaning, ModelNativeBinding, ModelPrefixedGlobal } from "./model.ts";
import { compareBytes, joinPath, pathOfNativeBinding } from "./paths.ts";
import {
  conversions,
  directiveKinds,
  errorKinds,
  intrinsicPositions,
  nativeCallKinds,
  promiseStatuses,
  type IntrinsicPosition,
  type IntrinsicSpec,
  type NativeCallKind,
} from "./vocabulary.ts";

/** What the sources that the front end of the host compiles use of the lines. A host without a front end has none, and nobody reads its lines. */
export interface SyntaxUses {
  names: ReadonlyMap<string, ReadonlySet<IntrinsicPosition>>;
  prefixedGlobals: readonly string[];
  privateNames: readonly string[];
  errorCodes: readonly { name: string; number: number }[];
  inheritableClasses: readonly { name: string; number: number }[];
}

interface SyntaxLine {
  name: string;
  position: IntrinsicPosition;
  isPrefixedGlobal: boolean;
  isWritten: boolean;
  spec: IntrinsicSpec;
  source: Source;
}

const errorCallee = "makeErrorWithCode";
const inheritsCallee = "inherits";
const symbolKeyMark = "$";
const symbolConstructorPath = "Symbol";
const maxUint32 = 2 ** 32 - 1;
const usingSources = "src/js, the engine's built-ins, the models or the prelude";
const declaringFiles =
  "src/codegen/builtins/host/bun-syntax.builtins.ts or WebKit's Source/JavaScriptCore/aot/builtins/engine-syntax.builtins.ts";

const nativeCallMacros: Readonly<Record<NativeCallKind, string>> = {
  Cpp: "cpp",
  Rust: "rust",
  NewCppFunction: "newCppFunction",
  NewRustFunction: "newRustFunction",
  Bindgen: "bindgen",
};

const generatedSource: Source = {
  file: "src/codegen/builtins/build-syntax.ts",
  line: null,
  origin: "Host",
  proof: "Structure",
};

const sortedUnique = (texts: Iterable<string>): string[] => [...new Set(texts)].sort(compareBytes);

const isListed = (words: readonly string[], word: string): boolean => words.includes(word);

const intrinsicConversions = conversions.filter(conversion => conversion !== "None" && conversion !== "Dictionary");

const keyOf = (name: string, position: IntrinsicPosition): string => `${name}\t${position}`;

const compareLines = (left: SyntaxLine, right: SyntaxLine): number =>
  compareBytes(left.name, right.name) ||
  intrinsicPositions.indexOf(left.position) - intrinsicPositions.indexOf(right.position) ||
  compareBytes(left.source.file, right.source.file);

const subjectOf = (line: SyntaxLine): string =>
  line.isPrefixedGlobal ? `${line.name} as a prefixed global` : `$${line.name} as ${line.position}`;

function describeMeaning(spec: IntrinsicSpec): string {
  if (spec.intrinsic !== "Double") return canonicalTextOf(spec);
  return `{"intrinsic":"Double","value":${Object.is(spec.value, -0) ? "-0" : String(spec.value)}}`;
}

class SyntaxTable {
  readonly #problems: Problems;
  readonly #lines = new Map<string, SyntaxLine>();
  readonly #prefixedGlobals = new Map<string, SyntaxLine>();

  constructor(problems: Problems) {
    this.#problems = problems;
  }

  get lines(): SyntaxLine[] {
    return [...this.#lines.values()].sort(compareLines);
  }

  get prefixedGlobals(): SyntaxLine[] {
    return [...this.#prefixedGlobals.values()].sort(compareLines);
  }

  find(name: string, position: IntrinsicPosition): SyntaxLine | undefined {
    return this.#lines.get(keyOf(name, position));
  }

  add(line: SyntaxLine): void {
    const lines = line.isPrefixedGlobal ? this.#prefixedGlobals : this.#lines;
    const key = line.isPrefixedGlobal ? line.name : keyOf(line.name, line.position);
    const existing = lines.get(key);
    if (existing === undefined) {
      lines.set(key, line);
      return;
    }
    const existingMeaning = describeMeaning(existing.spec);
    const meaning = describeMeaning(line.spec);
    if (existingMeaning === meaning) return;
    this.#problems.add(line.source, `${subjectOf(line)} means both ${existingMeaning} and ${meaning}`);
  }

  addGenerated(name: string, position: IntrinsicPosition, spec: IntrinsicSpec): void {
    this.add({ name, position, isPrefixedGlobal: false, isWritten: false, spec, source: generatedSource });
  }

  collectCallees(): Set<string> {
    const callees = new Set<string>([errorCallee, inheritsCallee]);
    for (const { spec } of this.#lines.values()) {
      if (spec.intrinsic === "PrependArgument") callees.add(spec.callee);
    }
    return callees;
  }
}

function addWrittenLines(table: SyntaxTable, declarations: readonly SourcedDeclaration[]): void {
  const lines = declarations.flatMap(({ declaration, source }): SyntaxLine[] => {
    if (declaration.declares !== "Intrinsic") return [];
    const { name, position, isPrefixedGlobal, meaning } = declaration;
    return [{ name, position, isPrefixedGlobal, isWritten: true, spec: meaning, source }];
  });
  for (const line of lines.sort(compareLines)) table.add(line);
}

function addErrorCodes(table: SyntaxTable, errorCodes: SyntaxUses["errorCodes"]): void {
  for (const { name, number } of errorCodes) {
    table.addGenerated(name, "Call", { intrinsic: "PrependArgument", callee: errorCallee, argument: number });
  }
}

function addInheritableClasses(table: SyntaxTable, classes: SyntaxUses["inheritableClasses"]): void {
  for (const { name, number } of classes) {
    table.addGenerated(`inherits${name}`, "Call", {
      intrinsic: "PrependArgument",
      callee: inheritsCallee,
      argument: number,
    });
  }
}

function addCalleesAndMacros(table: SyntaxTable): void {
  for (const callee of table.collectCallees()) {
    if (table.find(callee, "Call") !== undefined || table.find(callee, "Value") !== undefined) continue;
    table.addGenerated(callee, "Value", { intrinsic: "PrivateGlobal" });
  }
  for (const kind of nativeCallKinds) {
    table.addGenerated(nativeCallMacros[kind], "Call", { intrinsic: "NativeCall", kind });
  }
}

function addPrivateNames(table: SyntaxTable, uses: SyntaxUses): void {
  const privateNames = new Set(uses.privateNames);
  for (const [name, positions] of uses.names) {
    if (!positions.has("Member") || !privateNames.has(name) || table.find(name, "Member") !== undefined) continue;
    table.addGenerated(name, "Member", { intrinsic: "PrivateName" });
  }
}

function findLineOfUse(table: SyntaxTable, name: string, position: IntrinsicPosition): SyntaxLine | undefined {
  const isSymbolKey = name.startsWith(symbolKeyMark);
  const line = table.find(isSymbolKey ? name.slice(symbolKeyMark.length) : name, position);
  return line !== undefined && (line.spec.intrinsic === "SymbolKey") === isSymbolKey ? line : undefined;
}

function checkUses(table: SyntaxTable, uses: SyntaxUses, problems: Problems): void {
  const usedLines = new Set<SyntaxLine>();
  for (const name of sortedUnique(uses.names.keys())) {
    for (const position of intrinsicPositions) {
      if (!uses.names.get(name)?.has(position)) continue;
      const line = findLineOfUse(table, name, position);
      if (line !== undefined) {
        usedLines.add(line);
        continue;
      }
      problems.add(null, `$${name} as ${position} is used in ${usingSources} and has no line in ${declaringFiles}`);
    }
  }
  const callees = table.collectCallees();
  for (const line of table.lines) {
    if (!line.isWritten || usedLines.has(line) || callees.has(line.name)) continue;
    problems.add(line.source, `${subjectOf(line)} has a line, but nothing in ${usingSources} uses it`);
  }
}

function checkPrefixedGlobals(table: SyntaxTable, prefixedGlobals: readonly string[], problems: Problems): void {
  const written = new Set(table.prefixedGlobals.map(line => line.name));
  for (const name of sortedUnique(written.symmetricDifference(new Set(prefixedGlobals)))) {
    problems.add(
      null,
      `${name} is a prefixed global in only one of src/codegen/replacements.ts and src/codegen/builtins/host/bun-syntax.builtins.ts. It has to be in both or in neither`,
    );
  }
}

function resolveMeaning(builder: ModelBuilder, line: SyntaxLine): ModelIntrinsicMeaning | null {
  const { spec, source } = line;
  const reject = (reason: string): null => {
    builder.problems.add(source, `${subjectOf(line)}: ${reason}`);
    return null;
  };
  switch (spec.intrinsic) {
    case "Operation":
      return builder.schema.operations.has(spec.opcode) ? spec : reject(`the schema has no operation ${spec.opcode}`);
    case "SymbolKey": {
      if (line.isPrefixedGlobal || line.position !== "Member") return reject("a symbol key is a Member: x.$$name");
      const symbolEntry = builder.resolve(joinPath([symbolConstructorPath, spec.symbol]), source);
      if (symbolEntry === null) return null;
      const { constant, text } = symbolEntry;
      if (constant === null || constant.constant !== "Symbol") return reject(`${text} is not a well-known symbol`);
      return { intrinsic: "SymbolKey", symbol: constant.name };
    }
    case "Builtin":
    case "Construct": {
      const builtin = builder.resolve(spec.path, source);
      if (builtin === null) return null;
      const { mutability, text } = builtin;
      if (mutability === "ChangesOnItsOwn") return reject(`${text} changes on its own, so it is not a constant`);
      return { intrinsic: spec.intrinsic, builtin };
    }
    case "LinkTimeConstant":
      return { intrinsic: "LinkTimeConstant", constant: line.name };
    case "Int":
      if (!Number.isSafeInteger(spec.value)) return reject(`${spec.value} is not an integer`);
      if (spec.cppExpression === "") return reject("an Int needs the C++ expression that it equals");
      builder.checkedNumbers.push({ value: spec.value, cppExpression: spec.cppExpression });
      return { intrinsic: "Int", value: spec.value };
    case "PrependArgument": {
      const { callee, argument } = spec;
      if (!Number.isInteger(argument) || argument < 0 || argument > maxUint32) {
        return reject(`${argument} is not an unsigned 32-bit integer`);
      }
      return { intrinsic: "PrependArgument", callee: builder.internName(callee, "Text"), argument };
    }
    case "Conversion":
      return isListed(intrinsicConversions, spec.conversion)
        ? spec
        : reject(`${spec.conversion} is not a conversion an intrinsic can name`);
    case "Throw":
      return isListed(errorKinds, spec.error) ? spec : reject(`${spec.error} is not an error kind`);
    case "Directive":
      return isListed(directiveKinds, spec.directive) ? spec : reject(`${spec.directive} is not a directive kind`);
    case "HasPromiseStatus":
      return isListed(promiseStatuses, spec.status) ? spec : reject(`${spec.status} is not a promise status`);
    case "NativeCall":
      return isListed(nativeCallKinds, spec.kind) ? spec : reject(`${spec.kind} is not a native call kind`);
    case "LinkedFunction": {
      const named = builder.functions.filter(candidate => candidate.name === line.name);
      if (named.length !== 1) return reject(`${named.length} runtime functions have this name`);
      return { intrinsic: "LinkedFunction", function: named[0] };
    }
    case "IfAbruptCloseIterator":
    case "HasJSType":
    case "Bool":
    case "Double":
    case "Call":
    case "PutByValDirect":
    case "GetOwnProperty":
    case "IsNullish":
    case "IsObject":
    case "IsCallable":
    case "Undefined":
    case "Apply":
    case "ArrayPush":
    case "ArgumentCount":
    case "Argument":
    case "PrivateGlobal":
    case "ReplaceablePrivateGlobal":
    case "PrivateName":
    case "Erased":
    case "BundleError":
      return spec as ModelIntrinsicMeaning;
  }
}

function buildNativeBindings(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]): ModelNativeBinding[] {
  return declarations
    .flatMap(({ declaration, source }): ModelNativeBinding[] => {
      if (declaration.declares !== "NativeBinding" || declaration.isHandedByNativeCode === true) return [];
      const { kind, file, symbol, hostNumber } = declaration;
      return [
        {
          kind,
          file: builder.internName(file, "Text"),
          symbol: builder.internName(symbol, "Text"),
          builtin: hostNumber === null ? null : builder.resolve(pathOfNativeBinding(kind, file, symbol), source),
        },
      ];
    })
    .sort(
      (left, right) =>
        nativeCallKinds.indexOf(left.kind) - nativeCallKinds.indexOf(right.kind) ||
        compareBytes(left.file.text, right.file.text) ||
        compareBytes(left.symbol.text, right.symbol.text),
    );
}

// The engine is compiled with an enumeration of these words, so its own lines say which there are.
function wordsOfEngine(
  builder: ModelBuilder,
  lines: readonly SyntaxLine[],
  kind: string,
  wordsOf: (line: SyntaxLine) => readonly string[],
): string[] {
  const words = sortedUnique(lines.filter(({ source }) => source.origin === "Engine").flatMap(wordsOf));
  for (const line of lines) {
    for (const word of wordsOf(line)) {
      if (words.includes(word)) continue;
      builder.problems.add(
        line.source,
        `${subjectOf(line)}: no line of the engine has the ${kind} ${word}, so the engine has no number for it`,
      );
    }
  }
  return words;
}

export function buildSyntax(
  builder: ModelBuilder,
  declarations: readonly SourcedDeclaration[],
  uses: SyntaxUses | null,
): void {
  const table = new SyntaxTable(builder.problems);
  addWrittenLines(table, declarations);
  if (uses !== null) {
    addErrorCodes(table, uses.errorCodes);
    addInheritableClasses(table, uses.inheritableClasses);
  }
  addCalleesAndMacros(table);
  if (uses !== null) {
    addPrivateNames(table, uses);
    checkUses(table, uses, builder.problems);
    checkPrefixedGlobals(table, uses.prefixedGlobals, builder.problems);
  }

  const resolveLines = (lines: readonly SyntaxLine[]): ModelIntrinsic[] =>
    lines.flatMap(line => {
      const meaning = resolveMeaning(builder, line);
      if (meaning === null) return [];
      return [{ name: builder.internName(line.name, "Text"), position: line.position, meaning }];
    });
  const lines = [...table.lines, ...table.prefixedGlobals];
  const intrinsics = resolveLines(table.lines);
  const prefixedGlobals = resolveLines(table.prefixedGlobals).map(({ name, meaning }): ModelPrefixedGlobal => ({
    name,
    meaning,
  }));
  builder.syntax = {
    intrinsics,
    prefixedGlobals,
    nativeBindings: buildNativeBindings(builder, declarations),
    checkedJSTypes: wordsOfEngine(builder, lines, "JSType", ({ spec }) =>
      spec.intrinsic === "HasJSType" ? [spec.first, spec.last] : [],
    ),
    linkTimeConstants: wordsOfEngine(builder, lines, "link-time constant", ({ spec, name }) =>
      spec.intrinsic === "LinkTimeConstant" ? [name] : [],
    ),
  };
}
