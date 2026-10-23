import { deriveFeatureEdges } from "./edges.ts";
import { isUnwindRecordOf, onlyReturns, sortedUnique } from "./entry-points.ts";
import { isOutsideCompiledPrograms } from "./features.ts";
import { findEdge, propagateFeatureSets, reach, type SectionGraph } from "./graph.ts";
import {
  EdgeKind,
  featureIndexLimit,
  type EntryPoint,
  type Feature,
  type FeatureEdge,
  type FeatureModel,
  type Group,
  type Partition,
  type PartitionFailure,
} from "./types.ts";

export { EdgeKind, type Group, type Partition, type PartitionFailure } from "./types.ts";

export const smallestGroupBytes = 4096;
const smallestJoinedSetBytes = 4 * smallestGroupBytes;

export interface PartitionInput {
  graph: SectionGraph;
  entryPoints: EntryPoint[];
  model: FeatureModel;
  isMovable(output: string): boolean;
  isCode(output: string): boolean;
}

interface EdgeClassification {
  edgeKind: Uint8Array;
  entryFeatures: Map<number, number[]>;
  isGuardedEntry: Uint8Array;
  isSoftEntry: Uint8Array;
  foldedEntryPoints: EntryPoint[];
  failures: PartitionFailure[];
}

const ascending = (a: number, b: number) => a - b;

function compareMemberLists(a: number[], b: number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function nodesWith(flags: Uint8Array): number[] {
  const nodes: number[] = [];
  for (let node = 0; node < flags.length; node++) {
    if (flags[node] !== 0) nodes.push(node);
  }
  return nodes;
}

function groupByEntry(entryPoints: EntryPoint[]): [entry: number, records: EntryPoint[]][] {
  const recordsOfEntry = new Map<number, EntryPoint[]>();
  for (const record of entryPoints) {
    const records = recordsOfEntry.get(record.entry);
    if (records === undefined) recordsOfEntry.set(record.entry, [record]);
    else records.push(record);
  }
  return [...recordsOfEntry].sort(([a], [b]) => a - b);
}

function isFoldedWithOtherCode(graph: SectionGraph, entry: number, records: EntryPoint[]): boolean {
  const namedSections = new Set(records.map(record => record.entrySection)).size;
  return namedSections < 1 + (graph.aliases.get(entry)?.length ?? 0);
}

function findEmptyEntriesThatOtherCodeJumpsTo(
  graph: SectionGraph,
  recordsByEntry: [entry: number, records: EntryPoint[]][],
): Set<number> {
  const guardsOfEmptyEntry = new Map<number, Set<number>>();
  for (const [entry, records] of recordsByEntry) {
    if (onlyReturns(graph, entry)) guardsOfEmptyEntry.set(entry, new Set(records.map(record => record.guard)));
  }
  const found = new Set<number>();
  if (guardsOfEmptyEntry.size === 0) return found;
  const isEmptyEntry = new Uint8Array(graph.count);
  for (const entry of guardsOfEmptyEntry.keys()) isEmptyEntry[entry] = 1;
  for (let referrer = 0; referrer < graph.count; referrer++) {
    for (let edge = graph.successorStart[referrer]!; edge < graph.successorStart[referrer + 1]!; edge++) {
      const entry = graph.successors[edge]!;
      if (isEmptyEntry[entry] === 0 || guardsOfEmptyEntry.get(entry)!.has(referrer)) continue;
      if (!isUnwindRecordOf(graph, referrer, entry)) found.add(entry);
    }
  }
  return found;
}

function classifyEdges(
  graph: SectionGraph,
  entryPoints: EntryPoint[],
  exportFeatures: number[],
  isCode: (output: string) => boolean,
): EdgeClassification {
  const edgeKind = new Uint8Array(graph.successors.length);
  const entryFeatures = new Map<number, number[]>();
  const isGuardedEntry = new Uint8Array(graph.count);
  const isSoftEntry = new Uint8Array(graph.count);
  const foldedEntryPoints: EntryPoint[] = [];
  const failures: PartitionFailure[] = [];
  const recordsByEntry = groupByEntry(entryPoints);
  const emptyEntriesThatOtherCodeJumpsTo = findEmptyEntriesThatOtherCodeJumpsTo(graph, recordsByEntry);
  for (const [entry, records] of recordsByEntry) {
    if (isFoldedWithOtherCode(graph, entry, records) || emptyEntriesThatOtherCodeJumpsTo.has(entry)) {
      foldedEntryPoints.push(...records);
      continue;
    }
    const features: number[] = [];
    for (const { guard, feature } of records) {
      const edge = findEdge(graph, guard, entry);
      if (edge === -1) {
        failures.push({ kind: "GuardWithoutReference", guard, entry, feature });
        continue;
      }
      // A guard in data is a static table that holds the entry's address: the run time asks removed_feature_at.
      if (isCode(graph.output[guard]!)) {
        edgeKind[edge] = EdgeKind.Guarded;
        isGuardedEntry[entry] = 1;
      } else {
        edgeKind[edge] = EdgeKind.Soft;
        isSoftEntry[entry] = 1;
      }
      features.push(feature);
    }
    if (features.length === 0) continue;
    if (graph.isExported[entry] !== 0) features.push(...exportFeatures);
    entryFeatures.set(entry, sortedUnique(features, ascending));
  }
  for (let edge = 0; edge < edgeKind.length; edge++) {
    if (edgeKind[edge] !== EdgeKind.Ordinary) continue;
    const target = graph.successors[edge]!;
    if (isGuardedEntry[target] !== 0 && entryFeatures.get(target)!.length === 1) edgeKind[edge] = EdgeKind.Unguarded;
  }
  return { edgeKind, entryFeatures, isGuardedEntry, isSoftEntry, foldedEntryPoints, failures };
}

function findRoots(graph: SectionGraph, exportFeatures: number[]): { isRoot: Uint8Array; unexplainedBytes: number } {
  const isRoot = graph.isRoot.slice();
  const explanations: number[] = [];
  for (let node = 0; node < graph.count; node++) {
    const isExported = graph.isExported[node] !== 0;
    if (isExported && exportFeatures.length === 0) isRoot[node] = 1;
    if (isRoot[node] !== 0 || isExported || graph.isLiveWithoutReference[node] !== 0) explanations.push(node);
  }
  const isExplained = reach(graph, explanations);
  let unexplainedBytes = 0;
  for (let node = 0; node < graph.count; node++) {
    if (isExplained[node] !== 0) continue;
    isRoot[node] = 1;
    unexplainedBytes += graph.size[node]!;
  }
  return { isRoot, unexplainedBytes };
}

function findViolations(
  graph: SectionGraph,
  isRoot: Uint8Array,
  isRetained: Uint8Array,
  { edgeKind, entryFeatures, isGuardedEntry }: EdgeClassification,
): PartitionFailure[] {
  const failures: PartitionFailure[] = [];
  for (let entry = 0; entry < graph.count; entry++) {
    if (isGuardedEntry[entry] === 0 || isRoot[entry] === 0) continue;
    const features = entryFeatures.get(entry)!;
    failures.push({ kind: "EntryPointReferencedByRetainedCode", entry, referrer: undefined, features });
  }
  const reportedSharedEntries = new Set<number>();
  for (let referrer = 0; referrer < graph.count; referrer++) {
    if (isRetained[referrer] === 0) continue;
    for (let edge = graph.successorStart[referrer]!; edge < graph.successorStart[referrer + 1]!; edge++) {
      const kind = edgeKind[edge];
      if (kind === EdgeKind.Guarded || kind === EdgeKind.Soft) continue;
      const entry = graph.successors[edge]!;
      if (isGuardedEntry[entry] === 0) continue;
      if (kind === EdgeKind.Ordinary) {
        if (reportedSharedEntries.has(entry)) continue;
        reportedSharedEntries.add(entry);
      }
      failures.push({
        kind: "EntryPointReferencedByRetainedCode",
        entry,
        referrer,
        features: entryFeatures.get(entry)!,
      });
    }
  }
  return failures;
}

function createSeeds(
  graph: SectionGraph,
  isRetained: Uint8Array,
  entryFeatures: Map<number, number[]>,
  exportFeatures: number[],
): Map<number, number[]> {
  const seeds = new Map<number, number[]>();
  const hasExportFeatures = exportFeatures.length > 0;
  for (let node = 0; node < graph.count; node++) {
    const features = entryFeatures.get(node);
    if (features !== undefined) seeds.set(node, features);
    else if (hasExportFeatures && graph.isExported[node] !== 0 && isRetained[node] === 0) {
      seeds.set(node, exportFeatures);
    }
  }
  return seeds;
}

function countDependents(model: FeatureModel, edges: FeatureEdge[]): Uint32Array {
  const impliedFeatures: number[][] = Array.from({ length: featureIndexLimit }, () => []);
  for (const { from, to } of edges) impliedFeatures[from]!.push(to);
  const dependents = new Uint32Array(featureIndexLimit);
  for (const { index } of model.features) {
    const seen = new Uint8Array(featureIndexLimit);
    seen[index] = 1;
    const stack = [index];
    for (let feature = stack.pop(); feature !== undefined; feature = stack.pop()) {
      for (const implied of impliedFeatures[feature]!) {
        if (seen[implied] !== 0) continue;
        seen[implied] = 1;
        dependents[implied]!++;
        stack.push(implied);
      }
    }
  }
  return dependents;
}

function rankFeatures(model: FeatureModel, edges: FeatureEdge[]): Uint16Array {
  const dependents = countDependents(model, edges);
  const decisionRank = (feature: Feature) => (isOutsideCompiledPrograms(feature) ? 0 : 1);
  const ordered = [...model.features].sort(
    (a, b) => decisionRank(a) - decisionRank(b) || dependents[a.index]! - dependents[b.index]! || a.index - b.index,
  );
  const layoutRank = new Uint16Array(featureIndexLimit);
  ordered.forEach((feature, position) => {
    layoutRank[feature.index] = position;
  });
  return layoutRank;
}

function rankSets(sets: number[][], layoutRank: Uint16Array): Uint16Array {
  const setRanks = new Uint16Array(sets.length);
  sets.forEach((members, set) => {
    for (const member of members) setRanks[set] = Math.max(setRanks[set]!, layoutRank[member]!);
  });
  return setRanks;
}

function bytesOfSets(
  graph: SectionGraph,
  setOf: Uint32Array,
  setCount: number,
  isCounted: (output: string) => boolean,
): Float64Array {
  const bytes = new Float64Array(setCount);
  for (let node = 0; node < graph.count; node++) {
    if (isCounted(graph.output[node]!)) bytes[setOf[node]!]! += graph.size[node]!;
  }
  return bytes;
}

function joinSmallSets(
  graph: SectionGraph,
  exactSetOf: Uint32Array,
  sets: number[][],
  setRanks: Uint16Array,
  isSoftEntry: Uint8Array,
): Uint32Array {
  const bytes = bytesOfSets(graph, exactSetOf, sets.length, () => true);
  const largeSets: { set: number; members: Set<number> }[] = [];
  for (let set = 1; set < sets.length; set++) {
    if (bytes[set]! >= smallestJoinedSetBytes) largeSets.push({ set, members: new Set(sets[set]!) });
  }
  largeSets.sort(
    (a, b) =>
      setRanks[a.set]! - setRanks[b.set]! ||
      a.members.size - b.members.size ||
      compareMemberLists(sets[a.set]!, sets[b.set]!),
  );
  const joinedSet = Uint32Array.from(sets.keys());
  for (let set = 1; set < sets.length; set++) {
    if (bytes[set]! >= smallestGroupBytes) continue;
    const superset = largeSets.find(({ members }) => sets[set]!.every(member => members.has(member)));
    if (superset !== undefined) joinedSet[set] = superset.set;
  }
  // removed_feature_at answers by address, so a soft entry has to leave as soon as its own features do.
  return exactSetOf.map((set, node) => (isSoftEntry[node] !== 0 ? set : joinedSet[set]!));
}

function orderGroups(
  graph: SectionGraph,
  setOf: Uint32Array,
  sets: number[][],
  setRanks: Uint16Array,
  isMovable: (output: string) => boolean,
): { groups: Group[]; groupOfSet: Map<number, number> } {
  const bytes = bytesOfSets(graph, setOf, sets.length, isMovable);
  const groups: Group[] = [];
  for (let set = 1; set < sets.length; set++) {
    if (bytes[set]! >= smallestGroupBytes) groups.push({ set, bytes: bytes[set]! });
  }
  groups.sort(
    (a, b) =>
      setRanks[a.set]! - setRanks[b.set]! || b.bytes - a.bytes || compareMemberLists(sets[a.set]!, sets[b.set]!),
  );
  return { groups, groupOfSet: new Map(groups.map(({ set }, index) => [set, index])) };
}

function checkMinimumSizes(
  graph: SectionGraph,
  model: FeatureModel,
  groups: Group[],
  sets: number[][],
): { removableBytes: Map<number, number>; featuresNearMinimum: number[]; failures: PartitionFailure[] } {
  const bytesOfFeature = new Float64Array(featureIndexLimit);
  for (const { set, bytes } of groups) {
    for (const feature of sets[set]!) bytesOfFeature[feature]! += bytes;
  }
  const removableBytes = new Map<number, number>();
  bytesOfFeature.forEach((bytes, feature) => {
    if (bytes > 0) removableBytes.set(feature, bytes);
  });
  const featuresNearMinimum: number[] = [];
  const failures: PartitionFailure[] = [];
  for (const { index, minimumBytes } of [...model.features].sort((a, b) => a.index - b.index)) {
    const minimum = minimumBytes[graph.format] ?? 0;
    if (minimum <= 0) continue;
    const bytes = bytesOfFeature[index]!;
    if (bytes < minimum) failures.push({ kind: "FeatureBelowMinimum", feature: index, bytes, minimum });
    else if (bytes < 2 * minimum) featuresNearMinimum.push(index);
  }
  return { removableBytes, featuresNearMinimum, failures };
}

export function partition(input: PartitionInput): Partition {
  const { graph, entryPoints, model, isMovable, isCode } = input;
  const exportFeatures = model.features
    .filter(feature => feature.exports)
    .map(feature => feature.index)
    .sort(ascending);
  const classification = classifyEdges(graph, entryPoints, exportFeatures, isCode);
  const { edgeKind, entryFeatures, isSoftEntry, foldedEntryPoints } = classification;
  const { isRoot, unexplainedBytes } = findRoots(graph, exportFeatures);
  const isRetained = reach(graph, nodesWith(isRoot), edgeKind);
  const violations = findViolations(graph, isRoot, isRetained, classification);
  const seeds = createSeeds(graph, isRetained, entryFeatures, exportFeatures);
  const { setOf: exactSetOf, sets } = propagateFeatureSets(graph, seeds, edgeKind, isRetained);
  const edges = deriveFeatureEdges({
    graph,
    model,
    entryPoints,
    edgeKind,
    entryFeatures,
    seeds,
    isRetained,
    exactSetOf,
    sets,
  });
  const layoutRank = rankFeatures(model, edges);
  const setRanks = rankSets(sets, layoutRank);
  const setOf = joinSmallSets(graph, exactSetOf, sets, setRanks, isSoftEntry);
  const { groups, groupOfSet } = orderGroups(graph, setOf, sets, setRanks, isMovable);
  const minimumSizes = checkMinimumSizes(graph, model, groups, sets);
  const { removableBytes, featuresNearMinimum } = minimumSizes;
  return {
    isRoot,
    isRetained,
    exactSetOf,
    setOf,
    sets,
    edgeKind,
    seeds,
    foldedEntryPoints,
    edges,
    layoutRank,
    groups,
    groupOfSet,
    removableBytes,
    featuresNearMinimum,
    unexplainedBytes,
    failures: [...classification.failures, ...violations, ...minimumSizes.failures],
  };
}
