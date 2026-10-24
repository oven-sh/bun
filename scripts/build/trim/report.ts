import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../error.ts";
import { entriesById } from "./builtin-uses.ts";
import { findWayToGuard } from "./declared-uses.ts";
import type { EntryPointFailure } from "./entry-points.ts";
import {
  chainTo,
  nameInSource,
  propagateFeatureSets,
  shortestChains,
  type GraphFailure,
  type SectionGraph,
} from "./graph.ts";
import { smallestGroupBytes } from "./partition.ts";
import type { RangeFailure } from "./ranges.ts";
import {
  EdgeKind,
  featureIndexLimit,
  type BuiltinEntry,
  type BuiltinUses,
  type DeclaredUseFailure,
  type EdgeStrength,
  type EntryPoint,
  type FeatureModel,
  type Partition,
  type PartitionFailure,
} from "./types.ts";

export type LinkFailure = GraphFailure | EntryPointFailure | PartitionFailure | DeclaredUseFailure | RangeFailure;

export interface ReportContext {
  graph: SectionGraph;
  model: FeatureModel;
  uses: BuiltinUses | undefined;
  demangler: string | undefined;
  partition: Partition | undefined;
  entryPoints?: EntryPoint[];
}

export const maxPrintedFailures = 20;
export const maxChainLength = 6;
export const maxListedPerFeature = 12;
export const maxDescriptionLength = 200;
export const foldedEntryPointsHeading = "folded with other code, not removable:";

const maxListedReferences = 3;
const notCandidate = -1;
const uncredited = -2;

const failureKindOrder = {
  UnreadInput: true,
  UnresolvedReference: true,
  GuardWithoutReference: true,
  EntryPointReferencedByRetainedCode: true,
  FeatureBelowMinimum: true,
  GuardOfUnknownBuiltin: true,
  UndeclaredUse: true,
  UseWithoutGuard: true,
  GuardWithoutUser: true,
  RetainedSectionInRemovableRange: true,
  TableEntryOutsideRemovableRanges: true,
} satisfies Record<LinkFailure["kind"], true>;

const guardEdgeText = {
  AbortingGuard: "aborting guard",
  RecoverableGuard: "recoverable guard",
} satisfies Record<Exclude<EdgeStrength, "Reference">, string>;

export function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(2) + " MB";
}

const isMsvcName = (name: string): boolean => name.startsWith("?");
// The qualified name and the parameters, close to what llvm-cxxfilt prints for an Itanium name.
const undnameFlags = ["access-specifier", "calling-convention", "member-type", "return-type", "variable-type"].map(
  part => `--no-${part}`,
);

/** `path` is llvm-cxxfilt's. llvm-undname, which reads the names of the Microsoft ABI, lies beside it. */
export class Demangler {
  private readonly path: string | undefined;
  private readonly demangledNames = new Map<string, string>();

  constructor(path: string | undefined) {
    this.path = path;
  }

  demangle(names: string[]): string[] {
    const unknown = [...new Set(names)].filter(name => !this.demangledNames.has(name));
    this.demangleMsvcNames(unknown.filter(isMsvcName));
    this.demangleWithTool(unknown.filter(name => !isMsvcName(name)));
    return names.map(name => this.demangledNames.get(name) ?? name);
  }

  private demangleMsvcNames(names: string[]): void {
    if (this.path === undefined || names.length === 0) return;
    const tool = this.path.replace(/llvm-cxxfilt(?=[^/\\]*$)/, "llvm-undname");
    const demangled = spawnSync(tool, undnameFlags, {
      input: names.map(name => name.replace(/\.llvm\.\d+$/, "") + "\n").join(""),
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (demangled.error !== undefined) throw new BuildError(`failed to run ${tool}`, { cause: demangled.error });
    // For each name: the name, a line with what it reads as unless it cannot be read, and an empty line.
    const answers = demangled.stdout.split(/\r?\n\r?\n/);
    names.forEach((name, index) => {
      const text = answers[index]?.split(/\r?\n/)[1];
      this.demangledNames.set(name, text?.replace(/\b(?:class|struct|union|enum) /g, "") ?? name);
    });
  }

  private demangleWithTool(names: string[]): void {
    if (this.path === undefined || names.length === 0) return;
    const demangled = spawnSync(this.path, ["--no-strip-underscore"], {
      input: names.join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (demangled.status !== 0) throw new BuildError(`failed to run ${this.path}`, { cause: demangled.error });
    const lines = demangled.stdout.split("\n");
    names.forEach((name, index) =>
      this.demangledNames.set(name, (lines[index] ?? name).replace(/ \(\.llvm\.\d+\)$/, "")),
    );
  }
}

class Printer {
  private readonly graph: SectionGraph;
  private readonly featureNameOf: Map<number, string>;
  private readonly builtinOf: Map<number, BuiltinEntry>;
  private readonly demangler: Demangler;

  constructor(context: ReportContext, nodes: Iterable<number>, symbols: readonly string[] = []) {
    this.graph = context.graph;
    this.featureNameOf = new Map(context.model.features.map(feature => [feature.index, feature.name]));
    this.builtinOf = context.uses === undefined ? new Map() : entriesById(context.uses);
    this.demangler = new Demangler(context.demangler);
    const printed = [...[...nodes].map(node => this.nameOf(node)), ...symbols];
    this.demangler.demangle(printed.map(symbol => nameInSource(this.graph, symbol)));
  }

  demangledSymbol(symbol: string): string {
    return this.demangler.demangle([nameInSource(this.graph, symbol)])[0]!;
  }

  demangledName(node: number): string {
    return this.demangledSymbol(this.nameOf(node));
  }

  describe(node: number): string {
    const object = this.graph.object[node]!;
    const baseName = object.slice(Math.max(object.lastIndexOf("/"), object.lastIndexOf("\\")) + 1);
    return `${this.demangledName(node)} (${baseName}, ${this.graph.size[node]} bytes)`.slice(0, maxDescriptionLength);
  }

  describeChain(chain: readonly number[]): string {
    return chain
      .slice(0, maxChainLength)
      .map(node => this.describe(node))
      .join("\n      <- ");
  }

  featureName(index: number): string {
    return this.featureNameOf.get(index) ?? String(index);
  }

  featureNames(features: readonly number[], separator = ", "): string {
    return features.map(feature => this.featureName(feature)).join(separator);
  }

  builtinPath(id: number): string {
    return this.builtinOf.get(id)?.path ?? `built-in ${id}`;
  }

  successorsOf(node: number): number[] {
    return [...this.graph.successors.subarray(this.graph.successorStart[node]!, this.graph.successorStart[node + 1]!)];
  }

  private nameOf(node: number): string {
    return this.graph.names[node]?.[0] ?? this.graph.section[node]!;
  }
}

function requirePartition(context: ReportContext): Partition {
  if (context.partition === undefined) throw new BuildError("trim report: the report context has no partition");
  return context.partition;
}

function hex(address: number): string {
  return address.toString(16);
}

function rootNodes(graph: SectionGraph, partition: Partition): number[] {
  const roots: number[] = [];
  for (let node = 0; node < graph.count; node++) if (partition.isRoot[node]) roots.push(node);
  return roots;
}

function printedChain(previous: Int32Array, node: number): number[] {
  return chainTo(previous, node).slice(0, maxChainLength);
}

interface RetainedFrontier {
  node: number;
  bytes: number;
}

interface RetainedShare {
  bytes: number;
  sections: number;
  frontiers: RetainedFrontier[];
}

interface RetainedWithFeature {
  previous: Int32Array;
  shares: Map<number, RetainedShare>;
}

function creditFrontiers(
  graph: SectionGraph,
  previous: Int32Array,
  candidates: readonly number[],
  frontierOf: Int32Array,
): RetainedShare {
  for (const candidate of candidates) frontierOf[candidate] = uncredited;
  const bytesOfFrontier = new Map<number, number>();
  const path: number[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    path.length = 0;
    let at = candidate;
    while (frontierOf[at] === uncredited) {
      path.push(at);
      const predecessor = previous[at]!;
      if (predecessor < 0 || frontierOf[predecessor] === notCandidate) {
        frontierOf[at] = at;
        break;
      }
      at = predecessor;
    }
    const frontier = frontierOf[at]!;
    for (const node of path) frontierOf[node] = frontier;
    const size = graph.size[candidate]!;
    bytes += size;
    bytesOfFrontier.set(frontier, (bytesOfFrontier.get(frontier) ?? 0) + size);
  }
  for (const candidate of candidates) frontierOf[candidate] = notCandidate;
  const frontiers = [...bytesOfFrontier]
    .map(([node, frontierBytes]) => ({ node, bytes: frontierBytes }))
    .sort((a, b) => b.bytes - a.bytes || a.node - b.node)
    .slice(0, maxListedPerFeature);
  return { bytes, sections: candidates.length, frontiers };
}

function retainedWithFeature(graph: SectionGraph, partition: Partition): RetainedWithFeature {
  const reaching = propagateFeatureSets(graph, partition.seeds, partition.edgeKind, new Uint8Array(graph.count));
  const previous = shortestChains(graph, rootNodes(graph, partition), partition.edgeKind);
  const candidatesOf = new Map<number, number[]>();
  for (let node = 0; node < graph.count; node++) {
    if (!partition.isRetained[node]) continue;
    const features = reaching.sets[reaching.setOf[node]!]!;
    if (features.length > 2) continue;
    for (const feature of features) {
      const candidates = candidatesOf.get(feature);
      if (candidates === undefined) candidatesOf.set(feature, [node]);
      else candidates.push(node);
    }
  }
  const frontierOf = new Int32Array(graph.count).fill(notCandidate);
  const shares = new Map<number, RetainedShare>();
  for (const [feature, candidates] of candidatesOf) {
    shares.set(feature, creditFrontiers(graph, previous, candidates, frontierOf));
  }
  return { previous, shares };
}

function retainedShareNodes(share: RetainedShare | undefined, previous: Int32Array): number[] {
  return (share?.frontiers ?? []).flatMap(frontier => printedChain(previous, frontier.node));
}

function describeRetained(share: RetainedShare | undefined, previous: Int32Array, printer: Printer): string {
  const bytes = megabytes(share?.bytes ?? 0);
  const head =
    `\n  ${bytes} in ${share?.sections ?? 0} sections are reached from its entry points, ` +
    `from at most one other feature's, and from retained code; where retained code first reaches them:`;
  const frontiers = (share?.frontiers ?? []).map(
    frontier => `\n  ${megabytes(frontier.bytes)} ${printer.describeChain(chainTo(previous, frontier.node))}`,
  );
  return head + frontiers.join("");
}

interface FailureDetails {
  previous: Int32Array | undefined;
  retained: RetainedWithFeature | undefined;
  wayToGuard: (failure: Extract<LinkFailure, { kind: "UndeclaredUse" }>) => number[];
}

function waysToGuards({ graph, partition, entryPoints }: ReportContext): FailureDetails["wayToGuard"] {
  if (partition === undefined || entryPoints === undefined) return () => [];
  const found = new Map<string, number[]>();
  return ({ entry, feature }) => {
    const key = `${entry} ${feature}`;
    let way = found.get(key);
    if (way === undefined) found.set(key, (way = findWayToGuard({ graph, partition, entryPoints }, entry, feature)));
    return way;
  };
}

function computeFailureDetails(failures: readonly LinkFailure[], context: ReportContext): FailureDetails {
  const { graph, partition } = context;
  const wayToGuard = waysToGuards(context);
  if (partition === undefined) return { previous: undefined, retained: undefined, wayToGuard };
  const retained = failures.some(failure => failure.kind === "FeatureBelowMinimum")
    ? retainedWithFeature(graph, partition)
    : undefined;
  if (retained !== undefined) return { previous: retained.previous, retained, wayToGuard };
  const needsChains = failures.some(failure => failure.kind === "EntryPointReferencedByRetainedCode");
  const previous = needsChains ? shortestChains(graph, rootNodes(graph, partition), partition.edgeKind) : undefined;
  return { previous, retained, wayToGuard };
}

function failureNodes(failure: LinkFailure, details: FailureDetails): number[] {
  switch (failure.kind) {
    case "UnreadInput":
    case "UnresolvedReference":
      return [];
    case "GuardWithoutReference":
      return failure.entry === undefined ? [failure.guard] : [failure.guard, failure.entry];
    case "EntryPointReferencedByRetainedCode": {
      if (failure.referrer === undefined) return [failure.entry];
      const chain = details.previous === undefined ? [] : printedChain(details.previous, failure.referrer);
      return [failure.entry, failure.referrer, ...chain];
    }
    case "FeatureBelowMinimum":
      if (details.retained === undefined) return [];
      return retainedShareNodes(details.retained.shares.get(failure.feature), details.retained.previous);
    case "GuardOfUnknownBuiltin":
    case "GuardWithoutUser":
      return [failure.guard, failure.entry];
    case "UndeclaredUse":
      return [failure.entry, ...details.wayToGuard(failure)];
    case "UseWithoutGuard":
      return [];
    case "RetainedSectionInRemovableRange":
    case "TableEntryOutsideRemovableRanges":
      return [failure.node];
    default: {
      const unhandled: never = failure;
      throw new BuildError(`trim report: unknown failure ${JSON.stringify(unhandled)}`);
    }
  }
}

function describeGuardWithoutReference(
  failure: Extract<LinkFailure, { kind: "GuardWithoutReference" }>,
  printer: Printer,
): string {
  const missing =
    failure.entry === undefined ? `${failure.target}, which is not in the image` : printer.describe(failure.entry);
  const text =
    `the guard in ${printer.describe(failure.guard)} has no reference to ${missing}, ` +
    `an entry point of ${printer.featureName(failure.feature)}: the compiler inlined it, so nothing can be cut. ` +
    `The entry point must not be inlined (#[inline(never)], NEVER_INLINE)`;
  const references = failure.entry === undefined ? printer.successorsOf(failure.guard) : [];
  if (references.length === 0) return text;
  const listed = references.slice(0, maxListedReferences).map(node => printer.describe(node));
  const more = references.length > listed.length ? ` and ${references.length - listed.length} more` : "";
  return `${text}\n  it refers to ${listed.join(", ")}${more}`;
}

function describeRetainedReference(
  failure: Extract<LinkFailure, { kind: "EntryPointReferencedByRetainedCode" }>,
  printer: Printer,
  details: FailureDetails,
): string {
  const entry = `${printer.describe(failure.entry)}, an entry point of ${printer.featureNames(failure.features)}`;
  if (failure.referrer === undefined) return `${entry}, is itself a root of the link`;
  const text =
    `${printer.describe(failure.referrer)} refers to ${printer.describe(failure.entry)}, ` +
    `an entry point of ${printer.featureNames(failure.features)}, and is not one of its guards`;
  if (details.previous === undefined) return text;
  const chain = chainTo(details.previous, failure.referrer);
  return chain.length === 0 ? text : `${text}\n  ${printer.describeChain(chain)}`;
}

function describeFailure(
  failure: LinkFailure,
  printer: Printer,
  context: ReportContext,
  details: FailureDetails,
): string {
  switch (failure.kind) {
    case "UnreadInput":
      return `${failure.object} could not be read (${failure.reason}), so what it refers to is unknown`;
    case "UnresolvedReference":
      return `${failure.object}:(${failure.section}) refers to ${failure.target}, which is in no section of the linker's map`;
    case "GuardWithoutReference":
      return describeGuardWithoutReference(failure, printer);
    case "EntryPointReferencedByRetainedCode":
      return describeRetainedReference(failure, printer, details);
    case "FeatureBelowMinimum": {
      const text =
        `${megabytes(failure.bytes)} can be removed with ${printer.featureName(failure.feature)}, ` +
        `below its minimum of ${megabytes(failure.minimum)}: retained code refers to the rest`;
      if (details.retained === undefined) return text;
      return text + describeRetained(details.retained.shares.get(failure.feature), details.retained.previous, printer);
    }
    case "GuardOfUnknownBuiltin":
      return (
        `the guard in ${printer.describe(failure.guard)} enters ${printer.describe(failure.entry)} ` +
        `as built-in ${failure.builtin}, which builtin-uses.json does not list`
      );
    case "UndeclaredUse": {
      const feature = printer.featureName(failure.feature);
      return (
        `${printer.builtinPath(failure.builtin)} (${printer.describe(failure.entry)}) reaches a guard of ${feature}, ` +
        `and its table entry has no "uses ${feature}": a program that calls it would lose ${feature} under --trim` +
        details
          .wayToGuard(failure)
          .slice(1)
          .map(node => `\n      -> ${printer.describe(node)}`)
          .join("")
      );
    }
    case "UseWithoutGuard": {
      const feature = printer.featureName(failure.feature);
      return (
        `${printer.builtinPath(failure.builtin)} declares "uses ${feature}", ` +
        `and no guard of ${feature} is reachable from it: the line retains ${feature} for nothing`
      );
    }
    case "GuardWithoutUser": {
      const feature = printer.featureName(failure.feature);
      return (
        `${printer.describe(failure.guard)} enters ${printer.describe(failure.entry)}, an entry point of ${feature}, ` +
        `and no table entry uses ${feature} and no feature's code enters it: --trim would always remove it`
      );
    }
    case "RetainedSectionInRemovableRange": {
      const partition = requirePartition(context);
      const { node, range } = failure;
      const owner = partition.isRetained[node]
        ? "retained"
        : "needed by " + printer.featureNames(partition.sets[partition.setOf[node]!]!);
      return (
        `${printer.describe(node)} at ${hex(context.graph.address[node]!)} lies in the range ` +
        `${hex(range.start)}-${hex(range.end)} of ${printer.featureNames(partition.sets[range.set]!)}, and is ${owner}`
      );
    }
    case "TableEntryOutsideRemovableRanges": {
      const partition = requirePartition(context);
      const features = printer.featureNames(partition.sets[partition.setOf[failure.node]!]!);
      return (
        `a table in data holds ${printer.describe(failure.node)}, which can be removed with ${features}, and no ` +
        `range of the trim table lists it: it would stay callable after what it calls is removed`
      );
    }
    default: {
      const unhandled: never = failure;
      throw new BuildError(`trim report: unknown failure ${JSON.stringify(unhandled)}`);
    }
  }
}

export function describeFailures(failures: readonly LinkFailure[], context: ReportContext): string {
  const groups = Object.keys(failureKindOrder).map(kind => failures.filter(failure => failure.kind === kind));
  const shown = groups.flatMap(group => group.slice(0, maxPrintedFailures));
  const details = computeFailureDetails(shown, context);
  const printer = new Printer(
    context,
    shown.flatMap(failure => failureNodes(failure, details)),
  );
  const lines: string[] = [];
  for (const group of groups) {
    for (const failure of group.slice(0, maxPrintedFailures)) {
      lines.push(`${failure.kind}: ${describeFailure(failure, printer, context, details)}`);
    }
    if (group.length > maxPrintedFailures) lines.push(`  and ${group.length - maxPrintedFailures} more`);
  }
  return lines.join("\n");
}

interface RequiredReferences {
  count: number;
  listed: [entry: number, referrer: number][];
}

function collectRequiredReferences(graph: SectionGraph, partition: Partition): Map<number, RequiredReferences> {
  const references = new Map<number, RequiredReferences>();
  for (let source = 0; source < graph.count; source++) {
    const features = partition.sets[partition.exactSetOf[source]!]!;
    if (features.length === 0) continue;
    for (let edge = graph.successorStart[source]!; edge < graph.successorStart[source + 1]!; edge++) {
      if (partition.edgeKind[edge] !== EdgeKind.Unguarded) continue;
      const target = graph.successors[edge]!;
      const seed = partition.seeds.get(target);
      if (seed?.length !== 1) continue;
      const required = seed[0]!;
      for (const feature of features) {
        if (feature === required) continue;
        const key = feature * featureIndexLimit + required;
        let pair = references.get(key);
        if (pair === undefined) references.set(key, (pair = { count: 0, listed: [] }));
        pair.count++;
        if (pair.listed.length < maxListedReferences) pair.listed.push([target, source]);
      }
    }
  }
  return references;
}

function aliasNames(graph: SectionGraph, node: number): string[] {
  return (graph.aliases.get(node) ?? []).map(([, name]) => name);
}

function entryPointLines(
  graph: SectionGraph,
  partition: Partition,
  entryPoints: EntryPoint[],
  printer: Printer,
): string[] {
  const lines = entryPoints.map(
    ({ feature, stub, entry, guard }) =>
      `${printer.featureName(feature)} ${stub} ${graph.size[entry]} ${printer.describe(entry)} <- ${printer.describe(guard)}`,
  );
  if (partition.foldedEntryPoints.length === 0) return lines;
  lines.push(foldedEntryPointsHeading);
  for (const { feature, entry } of partition.foldedEntryPoints) {
    const aliases = aliasNames(graph, entry).map(name => printer.demangledSymbol(name));
    lines.push(`  ${printer.featureName(feature)} ${printer.describe(entry)}: ${aliases.join(", ")}`);
  }
  return lines;
}

function requiresLines(partition: Partition, references: Map<number, RequiredReferences>, printer: Printer): string[] {
  const referenceLines: string[] = [];
  const guardLines: string[] = [];
  for (const { from, to, strength, isFollowed } of partition.edges) {
    if (strength !== "Reference") {
      const names = `${printer.featureName(from)} enters ${printer.featureName(to)}`;
      guardLines.push(`${names}: ${guardEdgeText[strength]}${isFollowed ? "" : ", answered elsewhere"}`);
      continue;
    }
    const pair = references.get(from * featureIndexLimit + to);
    const names = `${printer.featureName(from)} requires ${printer.featureName(to)}`;
    referenceLines.push(`${names}: ${pair?.count ?? 0} references`);
    for (const [entry, referrer] of pair?.listed ?? []) {
      referenceLines.push(`    ${printer.describe(entry)} <- ${printer.describe(referrer)}`);
    }
  }
  return [...referenceLines, ...guardLines];
}

function groupLines(context: ReportContext, partition: Partition, printer: Printer): string[] {
  const lines = partition.groups.map(
    (group, index) => `${index} ${megabytes(group.bytes)} ${printer.featureNames(partition.sets[group.set]!, ",")}`,
  );
  lines.push("");
  for (const feature of featuresByIndex(context.model)) {
    const bytes = partition.removableBytes.get(feature);
    if (bytes !== undefined) lines.push(`${printer.featureName(feature)} ${megabytes(bytes)}`);
  }
  return lines;
}

function retainedByLines(features: number[], retained: RetainedWithFeature, printer: Printer): string[] {
  return features.flatMap(feature => [
    `${printer.featureName(feature)}:` + describeRetained(retained.shares.get(feature), retained.previous, printer),
    "",
  ]);
}

function featuresByIndex(model: FeatureModel): number[] {
  return model.features.map(feature => feature.index).sort((a, b) => a - b);
}

function writeLines(path: string, lines: readonly string[]): void {
  writeFileSync(path, lines.join("\n") + "\n");
}

export function writeReviewFiles(directory: string, context: ReportContext, entryPoints: EntryPoint[]): void {
  const partition = requirePartition(context);
  const { graph, model } = context;
  const references = collectRequiredReferences(graph, partition);
  const retained = retainedWithFeature(graph, partition);
  const listedFeatures = featuresByIndex(model).filter(
    feature => (retained.shares.get(feature)?.bytes ?? 0) >= smallestGroupBytes,
  );
  const nodes = [
    ...entryPoints.flatMap(({ entry, guard }) => [entry, guard]),
    ...partition.foldedEntryPoints.map(({ entry }) => entry),
    ...[...references.values()].flatMap(pair => pair.listed.flat()),
    ...listedFeatures.flatMap(feature => retainedShareNodes(retained.shares.get(feature), retained.previous)),
  ];
  const aliases = partition.foldedEntryPoints.flatMap(({ entry }) => aliasNames(graph, entry));
  const printer = new Printer(context, nodes, aliases);
  writeLines(join(directory, "entry-points.txt"), entryPointLines(graph, partition, entryPoints, printer));
  writeLines(join(directory, "requires.txt"), requiresLines(partition, references, printer));
  writeLines(join(directory, "groups.txt"), groupLines(context, partition, printer));
  writeLines(join(directory, "retained-by.txt"), retainedByLines(listedFeatures, retained, printer));
}

export function writeSectionsFile(path: string, context: ReportContext): void {
  const partition = requirePartition(context);
  const { graph } = context;
  const nodes: number[] = [];
  for (let node = 0; node < graph.placedCount; node++) {
    if (!partition.isRetained[node] && partition.setOf[node] !== 0) nodes.push(node);
  }
  const printer = new Printer(context, nodes);
  const lines = nodes.map(node => {
    const features = printer.featureNames(partition.sets[partition.setOf[node]!]!, ",");
    return `${hex(graph.address[node]!)} ${graph.size[node]} ${features} ${graph.output[node]} ${printer.demangledName(node)}`;
  });
  writeLines(path, lines);
}
