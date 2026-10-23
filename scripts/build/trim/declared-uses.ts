import { entriesById, featuresWithDeclaredUse, guardFeatureOf } from "./builtin-uses.ts";
import { sortedUnique } from "./entry-points.ts";
import { featureNamed } from "./features.ts";
import { findEdge, propagateFeatureSets, reverseEdges, type SectionGraph } from "./graph.ts";
import {
  EdgeKind,
  type BuiltinEntry,
  type BuiltinUses,
  type DeclaredUseFailure,
  type EntryPoint,
  type FeatureModel,
  type FeatureName,
  type Partition,
} from "./types.ts";

export interface DeclaredUseInput {
  graph: SectionGraph;
  model: FeatureModel;
  uses: BuiltinUses;
  entryPoints: EntryPoint[];
  partition: Partition;
}

type FailureOf<Kind extends DeclaredUseFailure["kind"]> = Extract<DeclaredUseFailure, { kind: Kind }>;
type FeatureSets = ReturnType<typeof propagateFeatureSets>;
type LowestEntryByFeature = Map<number, number>;

type GuardSearch = Pick<DeclaredUseInput, "graph" | "entryPoints" | "partition">;

function guardsThatCount({ graph, entryPoints, partition }: GuardSearch): EntryPoint[] {
  const foldedEntries = new Set(partition.foldedEntryPoints.map(record => record.entry));
  return entryPoints.filter(
    ({ guard, entry, origin }) =>
      origin !== "Definition" &&
      !foldedEntries.has(entry) &&
      partition.isRetained[guard] === 0 &&
      partition.edgeKind[findEdge(graph, guard, entry)] !== EdgeKind.Soft,
  );
}

// The sections from `from` to the nearest guard of `feature`, and the entry point that the guard enters. Empty if there is none.
export function findWayToGuard(search: GuardSearch, from: number, feature: number): number[] {
  const { graph, partition } = search;
  const enteredBy = new Map<number, number>();
  for (const record of guardsThatCount(search)) {
    if (record.feature === feature && !enteredBy.has(record.guard)) enteredBy.set(record.guard, record.entry);
  }
  const previous = new Map<number, number | undefined>([[from, undefined]]);
  const queue = [from];
  for (const node of queue) {
    const entered = enteredBy.get(node);
    if (entered !== undefined) {
      const way = [entered];
      for (let at: number | undefined = node; at !== undefined; at = previous.get(at)) way.unshift(at);
      return way;
    }
    for (let edge = graph.successorStart[node]!; edge < graph.successorStart[node + 1]!; edge++) {
      const next = graph.successors[edge]!;
      if (partition.edgeKind[edge] !== 0 || partition.isRetained[next] !== 0 || previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  return [];
}

export function guardedFeaturesReachedFrom(input: DeclaredUseInput): FeatureSets {
  const { graph, partition } = input;
  const seeds = new Map<number, number[]>();
  for (const { guard, feature } of guardsThatCount(input)) {
    const features = seeds.get(guard);
    if (features === undefined) seeds.set(guard, [feature]);
    else if (!features.includes(feature)) features.push(feature);
  }
  for (const features of seeds.values()) features.sort((a, b) => a - b);
  const reversed = reverseEdges(graph, partition.edgeKind);
  return propagateFeatureSets(reversed, seeds, new Uint8Array(reversed.successors.length), partition.isRetained);
}

function declaredFeatures(model: FeatureModel, entry: BuiltinEntry): number[] {
  return entry.uses.map(use => featureNamed(model, use.feature).index);
}

function collectGuardedFeatures(entryPoints: EntryPoint[], reached: FeatureSets): Map<number, LowestEntryByFeature> {
  const guardedFeatures = new Map<number, LowestEntryByFeature>();
  for (const { builtin, entry, feature } of entryPoints) {
    if (builtin === undefined) continue;
    let lowestEntryOf = guardedFeatures.get(builtin);
    if (lowestEntryOf === undefined) guardedFeatures.set(builtin, (lowestEntryOf = new Map()));
    for (const guarded of [feature, ...reached.sets[reached.setOf[entry]!]!]) {
      lowestEntryOf.set(guarded, Math.min(entry, lowestEntryOf.get(guarded) ?? entry));
    }
  }
  return guardedFeatures;
}

function findUnknownBuiltinGuards(
  entryPoints: EntryPoint[],
  entries: Map<number, BuiltinEntry>,
): FailureOf<"GuardOfUnknownBuiltin">[] {
  const failures: FailureOf<"GuardOfUnknownBuiltin">[] = [];
  for (const { builtin, guard, entry, feature } of entryPoints) {
    if (builtin === undefined || entries.has(builtin)) continue;
    failures.push({ kind: "GuardOfUnknownBuiltin", builtin, guard, entry, feature });
  }
  return sortedUnique(
    failures,
    (a, b) => a.builtin - b.builtin || a.guard - b.guard || a.entry - b.entry || a.feature - b.feature,
  );
}

function findUndeclaredUses(
  model: FeatureModel,
  entries: Map<number, BuiltinEntry>,
  guardedFeatures: Map<number, LowestEntryByFeature>,
): FailureOf<"UndeclaredUse">[] {
  // A setting or the command line enters every other feature: no use by the program retains it, and its guard is the cut.
  const programFeatures = new Set(
    model.features.filter(feature => feature.enteredFrom === "program").map(feature => feature.index),
  );
  const failures: FailureOf<"UndeclaredUse">[] = [];
  for (const [builtin, lowestEntryOf] of guardedFeatures) {
    const declaration = entries.get(builtin);
    if (declaration === undefined) continue;
    const declared = new Set(declaredFeatures(model, declaration));
    for (const [feature, entry] of lowestEntryOf) {
      if (!programFeatures.has(feature) || declared.has(feature)) continue;
      failures.push({ kind: "UndeclaredUse", builtin, entry, feature });
    }
  }
  return failures.sort((a, b) => a.builtin - b.builtin || a.entry - b.entry || a.feature - b.feature);
}

// The root that hands out the instances of a class without a constructor declares what the methods of the class enter.
function collectFeaturesByGuardFeature(
  uses: BuiltinUses,
  guardedFeatures: Map<number, LowestEntryByFeature>,
): Map<FeatureName, Set<number>> {
  const featuresOf = new Map<FeatureName, Set<number>>();
  for (const declaration of uses.entries) {
    const guardFeature = guardFeatureOf(declaration);
    const guarded = guardedFeatures.get(declaration.id);
    if (guardFeature === undefined || guarded === undefined) continue;
    let features = featuresOf.get(guardFeature);
    if (features === undefined) featuresOf.set(guardFeature, (features = new Set()));
    for (const feature of guarded.keys()) features.add(feature);
  }
  return featuresOf;
}

// Such a feature owns no bytes, so nothing leaves with it and a line that names it retains nothing.
export function findUsedFeaturesWithoutGuard({
  model,
  uses,
  entryPoints,
}: Pick<DeclaredUseInput, "model" | "uses" | "entryPoints">): number[] {
  const guardedFeatures = new Set(entryPoints.map(record => record.feature));
  return [...featuresWithDeclaredUse(uses, model)]
    .filter(feature => !guardedFeatures.has(feature))
    .sort((a, b) => a - b);
}

function findUsesWithoutGuard(
  input: DeclaredUseInput,
  guardedFeatures: Map<number, LowestEntryByFeature>,
): FailureOf<"UseWithoutGuard">[] {
  const { model, uses, entryPoints, partition } = input;
  const retainedGuardFeatures = new Set<number>();
  for (const { guard, feature } of entryPoints) {
    if (partition.isRetained[guard] !== 0) retainedGuardFeatures.add(feature);
  }
  const featuresWithoutGuard = new Set(findUsedFeaturesWithoutGuard(input));
  // A guard at a definition cuts every reference to the function, whoever makes it: which built-in comes to it is not followed.
  const featuresFollowed = new Set(
    entryPoints.filter(record => record.origin !== "Definition").map(record => record.feature),
  );
  const featuresByGuardFeature = collectFeaturesByGuardFeature(uses, guardedFeatures);
  const failures: FailureOf<"UseWithoutGuard">[] = [];
  for (const declaration of uses.entries) {
    const guardFeature = guardFeatureOf(declaration);
    const guarded = guardedFeatures.get(declaration.id);
    const guardedBesideIt = guardFeature === undefined ? undefined : featuresByGuardFeature.get(guardFeature);
    for (const feature of declaredFeatures(model, declaration)) {
      if (guarded?.has(feature) || guardedBesideIt?.has(feature)) continue;
      if (retainedGuardFeatures.has(feature) || featuresWithoutGuard.has(feature) || !featuresFollowed.has(feature))
        continue;
      failures.push({ kind: "UseWithoutGuard", builtin: declaration.id, feature });
    }
  }
  return failures.sort((a, b) => a.builtin - b.builtin || a.feature - b.feature);
}

function findGuardsWithoutUser({
  model,
  uses,
  entryPoints,
  partition,
}: DeclaredUseInput): FailureOf<"GuardWithoutUser">[] {
  const usedFeatures = featuresWithDeclaredUse(uses, model);
  const enteredFeatures = new Set(partition.edges.map(edge => edge.to));
  const programFeatures = new Set(
    model.features.filter(feature => feature.enteredFrom === "program").map(feature => feature.index),
  );
  const firstRecordOf = new Map<number, EntryPoint>();
  for (const record of entryPoints) {
    const { feature } = record;
    if (!programFeatures.has(feature) || usedFeatures.has(feature) || enteredFeatures.has(feature)) continue;
    const first = firstRecordOf.get(feature);
    if (first === undefined || (record.guard - first.guard || record.entry - first.entry) < 0) {
      firstRecordOf.set(feature, record);
    }
  }
  return Array.from(firstRecordOf.values(), ({ guard, entry, feature }): FailureOf<"GuardWithoutUser"> => ({
    kind: "GuardWithoutUser",
    guard,
    entry,
    feature,
  })).sort((a, b) => a.guard - b.guard || a.entry - b.entry || a.feature - b.feature);
}

export function checkDeclaredUses(input: DeclaredUseInput): DeclaredUseFailure[] {
  const { model, uses, entryPoints } = input;
  const entries = entriesById(uses);
  const guardedFeatures = collectGuardedFeatures(entryPoints, guardedFeaturesReachedFrom(input));
  return [
    ...findUnknownBuiltinGuards(entryPoints, entries),
    ...findUndeclaredUses(model, entries, guardedFeatures),
    ...findUsesWithoutGuard(input, guardedFeatures),
    ...findGuardsWithoutUser(input),
  ];
}
