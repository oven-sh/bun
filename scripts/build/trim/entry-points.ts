import { guardFeatureOf } from "./builtin-uses.ts";
import { featureNamed } from "./features.ts";
import {
  nameInSource,
  reverseEdges,
  type GraphFailure,
  type GraphReading,
  type RecordSection,
  type SectionGraph,
} from "./graph.ts";
import {
  guardOrigins,
  stubKinds,
  type BuiltinKind,
  type BuiltinUses,
  type EntryPoint,
  type FeatureModel,
} from "./types.ts";

export { stubKinds, type EntryPoint } from "./types.ts";

export const recordBytes = 24;
const guardOffset = 0;
const entryOffset = 8;
const featureOffset = 16;
const stubOffset = 18;
const originOffset = 19;
const builtinOffset = 20;
const largestFunctionThatOnlyReturns = 32;
const unwindRecordSection = /^\.[px]data(\$|$)/;

export type EntryPointFailure =
  GraphFailure | { kind: "GuardWithoutReference"; guard: number; entry: undefined; feature: number; target: string };

export interface EntryPointReading {
  entryPoints: EntryPoint[];
  failures: EntryPointFailure[];
  statistics: {
    records: number;
    deadGuards: number;
    guardsInsideEntryPoint: number;
    definitions: number;
    guardsOfEmptyEntryPoints: number;
  };
}

type GuardWithoutReference = Extract<EntryPointFailure, { kind: "GuardWithoutReference" }>;

type EntryPointDefinition = Omit<EntryPoint, "guard">;

interface DecodedRecords {
  entryPoints: EntryPoint[];
  definitions: EntryPointDefinition[];
  unreadInputs: GraphFailure[];
  guardsWithoutReference: GuardWithoutReference[];
  statistics: EntryPointReading["statistics"];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEntryPoints(a: EntryPoint, b: EntryPoint): number {
  return (
    a.entry - b.entry ||
    a.guard - b.guard ||
    a.feature - b.feature ||
    stubKinds.indexOf(a.stub) - stubKinds.indexOf(b.stub) ||
    guardOrigins.indexOf(a.origin) - guardOrigins.indexOf(b.origin) ||
    (a.builtin ?? -1) - (b.builtin ?? -1) ||
    compareText(a.entrySection, b.entrySection)
  );
}

function compareGuardsWithoutReference(a: GuardWithoutReference, b: GuardWithoutReference): number {
  return a.guard - b.guard || a.feature - b.feature || compareText(a.target, b.target);
}

export function sortedUnique<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  const sorted = [...items].sort(compare);
  return sorted.filter((item, index) => index === 0 || compare(sorted[index - 1]!, item) !== 0);
}

// A COFF function that sets up a frame refers to its unwind records, and they to it and to each other.
export function isUnwindRecordOf(graph: SectionGraph, record: number, node: number): boolean {
  if (graph.format !== "coff" || !unwindRecordSection.test(graph.section[record]!)) return false;
  for (let edge = graph.successorStart[record]!; edge < graph.successorStart[record + 1]!; edge++) {
    const target = graph.successors[edge]!;
    if (target !== node && !unwindRecordSection.test(graph.section[target]!)) return false;
  }
  return true;
}

// The optimizer removes a call of a function that does nothing, also one it may not inline, and the function with it.
export function onlyReturns(graph: SectionGraph, node: number): boolean {
  if (graph.size[node]! > largestFunctionThatOnlyReturns) return false;
  for (let edge = graph.successorStart[node]!; edge < graph.successorStart[node + 1]!; edge++) {
    if (!isUnwindRecordOf(graph, graph.successors[edge]!, node)) return false;
  }
  return true;
}

function decodeRecordSection(
  section: RecordSection,
  reading: GraphReading,
  modelFeatures: Set<number>,
  namedByEngine: readonly number[],
  decoded: DecodedRecords,
): void {
  const { object, bytes, references } = section;
  const { statistics } = decoded;
  const resolveAt = (offset: number) => {
    const reference = references.get(offset);
    return reference === undefined ? undefined : reading.resolve(object, reference);
  };
  if (bytes.length % recordBytes !== 0) {
    decoded.unreadInputs.push({ kind: "UnreadInput", object, reason: "MalformedRecords" });
    return;
  }
  let hasUnknownFeature = false;
  for (let at = 0; at < bytes.length; at += recordBytes) {
    const stub = stubKinds[bytes[at + stubOffset]!];
    const recordedOrigin = guardOrigins[bytes[at + originOffset]!];
    const recordedNumber = bytes.readUInt32LE(at + builtinOffset);
    const isNamedByEngine = recordedOrigin === "BuiltinNamedByEngine";
    const origin = isNamedByEngine ? "Builtin" : recordedOrigin;
    const builtin = isNamedByEngine ? namedByEngine[recordedNumber] : recordedNumber;
    const isMalformed =
      stub === undefined ||
      origin === undefined ||
      builtin === undefined ||
      (origin === "NativeCode" && builtin !== 0) ||
      (origin === "Definition" && stub !== "Abort" && stub !== "Throw") ||
      (origin === "Definition" && stub === "Abort" && builtin !== 0);
    if (isMalformed) {
      decoded.unreadInputs.push({ kind: "UnreadInput", object, reason: "MalformedRecords" });
      return;
    }
    statistics.records++;
    const feature = bytes.readUInt16LE(at + featureOffset);
    if (!modelFeatures.has(feature)) {
      if (!hasUnknownFeature) decoded.unreadInputs.push({ kind: "UnreadInput", object, reason: "UnknownFeature" });
      hasUnknownFeature = true;
      continue;
    }
    const guard = resolveAt(at + guardOffset);
    if (guard === undefined) {
      statistics.deadGuards++;
      continue;
    }
    const entry = resolveAt(at + entryOffset);
    if (origin === "Definition") {
      if (entry?.node !== guard.node) {
        decoded.unreadInputs.push({ kind: "UnreadInput", object, reason: "MalformedRecords" });
        return;
      }
      statistics.definitions++;
      decoded.definitions.push({
        entry: entry.node,
        feature,
        stub,
        origin: builtin === 0 ? "Definition" : "Builtin",
        builtin: builtin === 0 ? undefined : builtin,
        entrySection: entry.section,
      });
    } else if (entry === undefined && onlyReturns(reading.graph, guard.node)) {
      statistics.guardsOfEmptyEntryPoints++;
    } else if (entry === undefined) {
      const target = references.get(at + entryOffset) ?? "";
      decoded.guardsWithoutReference.push({
        kind: "GuardWithoutReference",
        guard: guard.node,
        entry: undefined,
        feature,
        target,
      });
    } else if (guard.node === entry.node) {
      statistics.guardsInsideEntryPoint++;
    } else {
      decoded.entryPoints.push({
        guard: guard.node,
        entry: entry.node,
        feature,
        stub,
        origin,
        builtin: origin === "Builtin" ? builtin : undefined,
        entrySection: entry.section,
      });
    }
  }
}

function guardEveryReference(graph: SectionGraph, definitions: EntryPointDefinition[]): EntryPoint[] {
  if (definitions.length === 0) return [];
  const { successorStart: referrerStart, successors: referrers } = reverseEdges(
    graph,
    new Uint8Array(graph.successors.length),
  );
  const namedSections = new Map<number, Set<string>>();
  for (const { entry, entrySection } of definitions) {
    const sections = namedSections.get(entry);
    if (sections === undefined) namedSections.set(entry, new Set([entrySection]));
    else sections.add(entrySection);
  }
  return definitions.flatMap(definition => {
    const { entry } = definition;
    const guards = referrers.subarray(referrerStart[entry]!, referrerStart[entry + 1]!);
    const isFoldedWithOtherCode = namedSections.get(entry)!.size < 1 + (graph.aliases.get(entry)?.length ?? 0);
    return Array.from(isFoldedWithOtherCode ? guards.subarray(0, 1) : guards, (guard): EntryPoint => ({
      guard,
      ...definition,
    }));
  });
}

export function readEntryPoints(
  reading: GraphReading,
  model: FeatureModel,
  namedByEngine: readonly number[] = [],
): EntryPointReading {
  const modelFeatures = new Set(model.features.map(feature => feature.index));
  const decoded: DecodedRecords = {
    entryPoints: [],
    definitions: [],
    unreadInputs: [],
    guardsWithoutReference: [],
    statistics: { records: 0, deadGuards: 0, guardsInsideEntryPoint: 0, definitions: 0, guardsOfEmptyEntryPoints: 0 },
  };
  for (const section of reading.recordSections)
    decodeRecordSection(section, reading, modelFeatures, namedByEngine, decoded);
  return {
    entryPoints: sortedUnique(
      [...decoded.entryPoints, ...guardEveryReference(reading.graph, decoded.definitions)],
      compareEntryPoints,
    ),
    failures: [...decoded.unreadInputs, ...sortedUnique(decoded.guardsWithoutReference, compareGuardsWithoutReference)],
    statistics: decoded.statistics,
  };
}

export interface StaticTableInput {
  reading: GraphReading;
  model: FeatureModel;
  uses: BuiltinUses;
  isCode(output: string): boolean;
  demangle(names: string[]): string[];
}

interface GuardedBuiltin {
  builtin: number;
  feature: number;
  symbol: string;
}

const kindsAskedWhenMadeCallable: ReadonlySet<BuiltinKind> = new Set(["Function", "Method", "Constructor", "Accessor"]);

function collectGuardedBuiltins(model: FeatureModel, uses: BuiltinUses): Map<string, GuardedBuiltin[]> {
  const guardedBuiltins = new Map<string, GuardedBuiltin[]>();
  for (const entry of uses.entries) {
    const guardFeature = guardFeatureOf(entry);
    if (guardFeature === undefined || !kindsAskedWhenMadeCallable.has(entry.kind)) continue;
    for (const symbol of entry.nativeSymbols) {
      const guarded = { builtin: entry.id, feature: featureNamed(model, guardFeature).index, symbol };
      const list = guardedBuiltins.get(unqualifiedFunctionName(symbol));
      if (list === undefined) guardedBuiltins.set(unqualifiedFunctionName(symbol), [guarded]);
      else list.push(guarded);
    }
  }
  return guardedBuiltins;
}

function qualifiedFunctionName(demangled: string): string {
  const parameters = demangled.indexOf("(");
  return parameters < 0 ? demangled : demangled.slice(0, parameters);
}

export function unqualifiedFunctionName(demangled: string): string {
  const qualified = qualifiedFunctionName(demangled);
  const scope = qualified.lastIndexOf("::");
  return scope < 0 ? qualified : qualified.slice(scope + 2);
}

const isNamedBy = (symbol: string, qualified: string) => qualified === symbol || qualified.endsWith("::" + symbol);

function findFunctionsNamedInData({ reading, isCode }: StaticTableInput): Map<number, number[]> {
  const { graph } = reading;
  const tablesOfFunction = new Map<number, number[]>();
  for (let table = 0; table < graph.count; table++) {
    if (isCode(graph.output[table]!)) continue;
    for (let edge = graph.successorStart[table]!; edge < graph.successorStart[table + 1]!; edge++) {
      const target = graph.successors[edge]!;
      if (!isCode(graph.output[target]!)) continue;
      const tables = tablesOfFunction.get(target);
      if (tables === undefined) tablesOfFunction.set(target, [table]);
      else tables.push(table);
    }
  }
  return tablesOfFunction;
}

export function findStaticTableEntryPoints(input: StaticTableInput): EntryPoint[] {
  const { graph } = input.reading;
  const guardedBuiltins = collectGuardedBuiltins(input.model, input.uses);
  const tablesOfFunction = findFunctionsNamedInData(input);
  const named = [...tablesOfFunction.keys()].flatMap(entry => graph.names[entry]!.map(name => ({ entry, name })));
  const demangledNames = input.demangle(named.map(({ name }) => nameInSource(graph, name)));
  const entryPoints: EntryPoint[] = [];
  named.forEach(({ entry }, index) => {
    const entrySection = graph.object[entry] + "\0" + graph.section[entry];
    const qualified = qualifiedFunctionName(demangledNames[index]!);
    for (const { builtin, feature, symbol } of guardedBuiltins.get(unqualifiedFunctionName(qualified)) ?? []) {
      if (!isNamedBy(symbol, qualified)) continue;
      for (const guard of tablesOfFunction.get(entry)!) {
        entryPoints.push({ guard, entry, feature, stub: "Throw", origin: "Builtin", builtin, entrySection });
      }
    }
  });
  return sortedUnique(entryPoints, compareEntryPoints);
}

export interface CFunctionEntryPoints {
  entryPoints: EntryPoint[];
  missing: string[];
}

export function findCFunctionEntryPoints({ graph }: GraphReading, model: FeatureModel): CFunctionEntryPoints {
  const featuresOfSymbol = new Map<string, number[]>();
  const prefix = graph.format === "macho" ? "_" : "";
  for (const { index, cFunctions = [] } of model.features) {
    for (const name of cFunctions) {
      const features = featuresOfSymbol.get(prefix + name);
      if (features === undefined) featuresOfSymbol.set(prefix + name, [index]);
      else features.push(index);
    }
  }
  if (featuresOfSymbol.size === 0) return { entryPoints: [], missing: [] };
  const found = new Set<string>();
  const definitions: EntryPointDefinition[] = [];
  for (let entry = 0; entry < graph.count; entry++) {
    const names = graph.names[entry]!;
    if (!names.every(name => featuresOfSymbol.has(name))) continue;
    for (const name of names) {
      const features = featuresOfSymbol.get(name);
      if (features === undefined || found.has(name)) continue;
      found.add(name);
      const entrySection = graph.object[entry] + "\0" + graph.section[entry];
      for (const feature of features) {
        definitions.push({ entry, feature, stub: "Abort", origin: "Definition", builtin: undefined, entrySection });
      }
    }
  }
  return {
    entryPoints: sortedUnique(guardEveryReference(graph, definitions), compareEntryPoints),
    missing: [...featuresOfSymbol.keys()].filter(name => !found.has(name)).sort(),
  };
}

export interface CxxFunctionInput {
  reading: GraphReading;
  model: FeatureModel;
  isCode: (output: string) => boolean;
  demangle: (names: string[]) => string[];
}

export interface CxxFunctionEntryPoints {
  entryPoints: EntryPoint[];
  unmatched: string[];
}

export function findCxxFunctionEntryPoints({
  reading: { graph },
  model,
  isCode,
  demangle,
}: CxxFunctionInput): CxxFunctionEntryPoints {
  const patterns = model.features.flatMap(({ index, cxxFunctions = [] }) =>
    cxxFunctions.map(({ hint, pattern }) => ({ feature: index, hint, text: pattern, pattern: new RegExp(pattern) })),
  );
  if (patterns.length === 0) return { entryPoints: [], unmatched: [] };
  const hinted: number[] = [];
  for (let entry = 0; entry < graph.count; entry++) {
    const names = graph.names[entry]!;
    if (names.length === 0 || !isCode(graph.output[entry]!)) continue;
    if (names.every(name => patterns.some(({ hint }) => name.includes(hint)))) hinted.push(entry);
  }
  const demangledNames = demangle(hinted.flatMap(entry => graph.names[entry]!.map(name => nameInSource(graph, name))));
  const matched = new Set<string>();
  const definitions: EntryPointDefinition[] = [];
  let next = 0;
  for (const entry of hinted) {
    const names = demangledNames.slice(next, (next += graph.names[entry]!.length));
    const entrySection = graph.object[entry] + "\0" + graph.section[entry];
    for (const { feature, text, pattern } of patterns) {
      if (!names.every(name => pattern.test(name))) continue;
      matched.add(text);
      definitions.push({ entry, feature, stub: "Abort", origin: "Definition", builtin: undefined, entrySection });
    }
  }
  return {
    entryPoints: sortedUnique(guardEveryReference(graph, definitions), compareEntryPoints),
    unmatched: [...new Set(patterns.map(({ text }) => text))].filter(text => !matched.has(text)).sort(),
  };
}

export function mergeEntryPoints(...lists: EntryPoint[][]): EntryPoint[] {
  return sortedUnique(lists.flat(), compareEntryPoints);
}
