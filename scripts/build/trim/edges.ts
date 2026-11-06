import { findEdge, propagateFeatureSets, type SectionGraph } from "./graph.ts";
import {
  EdgeKind,
  edgeStrengths,
  featureIndexLimit,
  type EdgeStrength,
  type EntryPoint,
  type FeatureEdge,
  type FeatureModel,
  type StubKind,
} from "./types.ts";

export interface EdgeInput {
  graph: SectionGraph;
  model: FeatureModel;
  entryPoints: EntryPoint[];
  edgeKind: Uint8Array;
  entryFeatures: Map<number, number[]>;
  seeds: Map<number, number[]>;
  isRetained: Uint8Array;
  exactSetOf: Uint32Array;
  sets: number[][];
}

const strengthOfStub = {
  Abort: "AbortingGuard",
  Throw: "RecoverableGuard",
  ReturnUndefined: "RecoverableGuard",
  ReturnDefault: "RecoverableGuard",
} as const satisfies Record<StubKind, EdgeStrength>;

export function findNativeEntries({ graph, entryPoints, edgeKind, entryFeatures, seeds }: EdgeInput): number[] {
  const entries = new Set<number>();
  for (const node of seeds.keys()) {
    if (!entryFeatures.has(node) || graph.isExported[node] !== 0) entries.add(node);
  }
  for (const { entry, origin } of entryPoints) {
    if (origin !== "Builtin" && seeds.has(entry)) entries.add(entry);
  }
  for (let edge = 0; edge < edgeKind.length; edge++) {
    if (edgeKind[edge] === EdgeKind.Unguarded) entries.add(graph.successors[edge]!);
  }
  return [...entries].sort((a, b) => a - b);
}

function referenceEdges({ graph, edgeKind, entryFeatures, exactSetOf, sets }: EdgeInput): FeatureEdge[] {
  const edges: FeatureEdge[] = [];
  for (let referrer = 0; referrer < graph.count; referrer++) {
    const referrerFeatures = sets[exactSetOf[referrer]!]!;
    for (let edge = graph.successorStart[referrer]!; edge < graph.successorStart[referrer + 1]!; edge++) {
      if (edgeKind[edge] !== EdgeKind.Unguarded) continue;
      const required = entryFeatures.get(graph.successors[edge]!)![0]!;
      for (const feature of referrerFeatures) {
        if (feature !== required) edges.push({ from: feature, to: required, strength: "Reference", isFollowed: true });
      }
    }
  }
  return edges;
}

function guardEdges(input: EdgeInput): FeatureEdge[] {
  const { graph, model, entryPoints, edgeKind, entryFeatures, seeds, isRetained, exactSetOf, sets } = input;
  const isStartupFeature = new Uint8Array(featureIndexLimit);
  const isProgramFeature = new Uint8Array(featureIndexLimit);
  for (const { index, enteredFrom } of model.features) {
    if (enteredFrom === "startup") isStartupFeature[index] = 1;
    if (enteredFrom === "program") isProgramFeature[index] = 1;
  }
  const nativeSeeds = new Map(findNativeEntries(input).map((entry): [number, number[]] => [entry, seeds.get(entry)!]));
  const reachedNatively = propagateFeatureSets(graph, nativeSeeds, edgeKind, isRetained);
  const edges: FeatureEdge[] = [];
  for (const { guard, entry, feature, stub, origin } of entryPoints) {
    if (!entryFeatures.has(entry) || isRetained[guard] !== 0) continue;
    // Code that reaches a static table does not enter the functions it lists: JavaScript does, as built-ins with their own uses.
    if (edgeKind[findEdge(graph, guard, entry)] === EdgeKind.Soft) continue;
    const nativeFeatures = reachedNatively.sets[reachedNatively.setOf[guard]!]!;
    for (const from of sets[exactSetOf[guard]!]!) {
      if (from === feature) continue;
      // A setting enters a start-up feature, so the setting's own requirement answers for a guard in it and for a guard of it.
      const isAnsweredByGuard =
        origin === "Definition" ||
        stub === "Throw" ||
        (isProgramFeature[from] !== 0 && isProgramFeature[feature] === 0);
      const isFollowed =
        !isAnsweredByGuard &&
        nativeFeatures.includes(from) &&
        isStartupFeature[from] === 0 &&
        isStartupFeature[feature] === 0;
      edges.push({ from, to: feature, strength: strengthOfStub[stub], isFollowed });
    }
  }
  return edges;
}

function mergeEdges(edges: FeatureEdge[]): FeatureEdge[] {
  const merged: FeatureEdge[] = [];
  for (const edge of [...edges].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const previous = merged.at(-1);
    if (previous === undefined || previous.from !== edge.from || previous.to !== edge.to) {
      merged.push({ ...edge });
      continue;
    }
    if (edgeStrengths.indexOf(edge.strength) < edgeStrengths.indexOf(previous.strength)) {
      previous.strength = edge.strength;
    }
    previous.isFollowed ||= edge.isFollowed;
  }
  return merged;
}

export function deriveFeatureEdges(input: EdgeInput): FeatureEdge[] {
  return mergeEdges([...referenceEdges(input), ...guardEdges(input)]);
}
