import { BuildError } from "../error.ts";
import { featureIndexLimit, type ObjectFormat } from "./types.ts";

export { featureIndexLimit, type ObjectFormat } from "./types.ts";

export interface SectionGraph {
  format: ObjectFormat;
  isArm64: boolean;
  count: number;
  placedCount: number;
  address: Float64Array;
  size: Float64Array;
  alignment: Uint32Array;
  output: string[];
  object: string[];
  section: string[];
  successorStart: Uint32Array;
  successors: Uint32Array;
  isRoot: Uint8Array;
  isExported: Uint8Array;
  isLiveWithoutReference: Uint8Array;
  names: string[][];
  aliases: Map<number, [object: string, name: string][]>;
  externalNames: Set<string>;
  stringHash: Map<number, number>;
}

export type Edges = Pick<SectionGraph, "count" | "successorStart" | "successors">;

export interface SectionGraphParts {
  format: ObjectFormat;
  isArm64: boolean;
  placedCount: number;
  address: number[];
  size: number[];
  alignment: number[];
  output: string[];
  object: string[];
  section: string[];
  successors: Set<number>[];
  roots: Set<number>;
  exported: Set<number>;
  liveWithoutReference: Set<number>;
  names: string[][];
  aliases: Map<number, [string, string][]>;
  externalNames: Set<string>;
  stringHash: Map<number, number>;
}

export type UnreadReason =
  | "NotFound"
  | "NotAnObject"
  | "AmbiguousArchiveMember"
  | "UnsupportedRelocations"
  | "MalformedRecords"
  | "UnknownFeature";

export type GraphFailure =
  | { kind: "UnreadInput"; object: string; reason: UnreadReason }
  | { kind: "UnresolvedReference"; object: string; section: string; target: string };

export interface RecordSection {
  object: string;
  bytes: Buffer;
  references: Map<number, string>;
}

export interface ResolvedReference {
  node: number;
  section: string;
}

export interface GraphReading {
  graph: SectionGraph;
  recordSections: RecordSection[];
  resolve(object: string, reference: string): ResolvedReference | undefined;
  failures: GraphFailure[];
  statistics: Record<string, number>;
  /** What the report of the link says besides the numbers. */
  remarks?: string[];
}

const unplacedAddress = -1;
const notFound = -1;
const chainStart = -1;
const notReached = -2;
const notVisited = -1;
const noComponent = -1;
const notInterned = -1;
const wordsPerSet = featureIndexLimit / 32;

function isNode(node: number, count: number): boolean {
  return Number.isInteger(node) && node >= 0 && node < count;
}

function invalidNode(use: string, node: number, count: number): BuildError {
  return new BuildError(`section graph: ${use} is node ${node}, but the graph has ${count} nodes`);
}

function checkLengths(parts: SectionGraphParts, count: number): void {
  const { size, alignment, output, object, section, successors, names, placedCount } = parts;
  for (const [name, list] of Object.entries({ size, alignment, output, object, section, successors, names })) {
    if (list.length !== count) {
      throw new BuildError(`section graph: ${name} has ${list.length} entries for ${count} nodes`);
    }
  }
  if (!(Number.isInteger(placedCount) && placedCount >= 0 && placedCount <= count)) {
    throw new BuildError(`section graph: placedCount is ${placedCount} for ${count} nodes`);
  }
}

function checkAddresses({ address, size, object, section, placedCount }: SectionGraphParts): void {
  const describe = (node: number) =>
    `${object[node]}:(${section[node]}) at 0x${address[node]!.toString(16)}, ${size[node]} bytes`;
  for (let node = 0; node < placedCount; node++) {
    const start = address[node]!;
    if (!(start >= 0 && size[node]! >= 0)) {
      throw new BuildError(`section graph: a placed node has no address or no size: ${describe(node)}`);
    }
    if (node === 0) continue;
    const previous = address[node - 1]!;
    if (!(start > previous || (start === previous && size[node - 1] === 0))) {
      throw new BuildError(
        `section graph: nodes are not sorted by address: ${describe(node - 1)}, then ${describe(node)}`,
      );
    }
  }
  for (let node = placedCount; node < address.length; node++) {
    if (address[node] !== unplacedAddress || size[node] !== 0) {
      throw new BuildError(`section graph: an unplaced node has an address or a size: ${describe(node)}`);
    }
  }
}

function packSuccessors(lists: Set<number>[]): { successorStart: Uint32Array; successors: Uint32Array } {
  const count = lists.length;
  const successorStart = new Uint32Array(count + 1);
  for (let node = 0; node < count; node++) {
    const targets = lists[node]!;
    successorStart[node + 1] = successorStart[node]! + targets.size - (targets.has(node) ? 1 : 0);
  }
  const successors = new Uint32Array(successorStart[count]!);
  for (let node = 0; node < count; node++) {
    const start = successorStart[node]!;
    let end = start;
    for (const target of lists[node]!) {
      if (!isNode(target, count)) throw invalidNode(`a successor of node ${node}`, target, count);
      if (target !== node) successors[end++] = target;
    }
    if (end - start > 1) successors.subarray(start, end).sort();
  }
  return { successorStart, successors };
}

function flagNodes(nodes: Set<number>, count: number, use: string): Uint8Array {
  const flags = new Uint8Array(count);
  for (const node of nodes) {
    if (!isNode(node, count)) throw invalidNode(use, node, count);
    flags[node] = 1;
  }
  return flags;
}

export function createSectionGraph(parts: SectionGraphParts): SectionGraph {
  const count = parts.address.length;
  checkLengths(parts, count);
  checkAddresses(parts);
  return {
    format: parts.format,
    isArm64: parts.isArm64,
    count,
    placedCount: parts.placedCount,
    address: Float64Array.from(parts.address),
    size: Float64Array.from(parts.size),
    alignment: Uint32Array.from(parts.alignment),
    output: parts.output,
    object: parts.object,
    section: parts.section,
    ...packSuccessors(parts.successors),
    isRoot: flagNodes(parts.roots, count, "a root"),
    isExported: flagNodes(parts.exported, count, "an exported node"),
    isLiveWithoutReference: flagNodes(parts.liveWithoutReference, count, "a node live without reference"),
    names: parts.names,
    aliases: parts.aliases,
    externalNames: parts.externalNames,
    stringHash: parts.stringHash,
  };
}

function checkSkippedEdges(graph: Edges, skippedEdges: Uint8Array | undefined): void {
  if (skippedEdges !== undefined && skippedEdges.length !== graph.successors.length) {
    throw new BuildError(
      `section graph: skippedEdges has ${skippedEdges.length} bytes for ${graph.successors.length} edges`,
    );
  }
}

export function reverseEdges(edges: Edges, skippedEdges: Uint8Array): Edges {
  checkSkippedEdges(edges, skippedEdges);
  const { count, successorStart, successors } = edges;
  const predecessorStart = new Uint32Array(count + 1);
  for (let edge = 0; edge < successors.length; edge++) {
    if (skippedEdges[edge] === 0) predecessorStart[successors[edge]! + 1]!++;
  }
  for (let node = 0; node < count; node++) predecessorStart[node + 1]! += predecessorStart[node]!;
  const predecessors = new Uint32Array(predecessorStart[count]!);
  const predecessorEnd = predecessorStart.slice(0, count);
  for (let node = 0; node < count; node++) {
    const end = successorStart[node + 1]!;
    for (let edge = successorStart[node]!; edge < end; edge++) {
      if (skippedEdges[edge] === 0) predecessors[predecessorEnd[successors[edge]!]!++] = node;
    }
  }
  return { count, successorStart: predecessorStart, successors: predecessors };
}

export function reach(graph: Edges, from: Iterable<number>, skippedEdges?: Uint8Array): Uint8Array {
  checkSkippedEdges(graph, skippedEdges);
  const { successorStart, successors } = graph;
  const seen = new Uint8Array(graph.count);
  const stack: number[] = [];
  for (const node of from) {
    if (!isNode(node, graph.count)) throw invalidNode("the start of a search", node, graph.count);
    if (seen[node] === 0) {
      seen[node] = 1;
      stack.push(node);
    }
  }
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const end = successorStart[node + 1]!;
    for (let edge = successorStart[node]!; edge < end; edge++) {
      if (skippedEdges?.[edge]) continue;
      const next = successors[edge]!;
      if (seen[next] === 0) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return seen;
}

interface Components {
  count: number;
  componentOf: Int32Array;
  memberStart: Uint32Array;
  members: Uint32Array;
}

function findComponents(graph: Edges, skippedEdges: Uint8Array, isExcluded: Uint8Array): Components {
  const { count, successorStart, successors } = graph;
  const index = new Int32Array(count).fill(notVisited);
  const lowLink = new Int32Array(count);
  const componentOf = new Int32Array(count).fill(noComponent);
  const memberStart = new Uint32Array(count + 1);
  const members = new Uint32Array(count);
  const pending = new Uint32Array(count);
  const path = new Uint32Array(count);
  const pathEdge = new Uint32Array(count);
  let visitedCount = 0;
  let componentCount = 0;
  let memberCount = 0;
  let pendingCount = 0;
  let depth = 0;
  const enter = (node: number) => {
    index[node] = lowLink[node] = visitedCount++;
    pending[pendingCount++] = node;
    path[depth] = node;
    pathEdge[depth++] = successorStart[node]!;
  };
  for (let start = 0; start < count; start++) {
    if (isExcluded[start] !== 0 || index[start] !== notVisited) continue;
    enter(start);
    while (depth > 0) {
      const node = path[depth - 1]!;
      const edge = pathEdge[depth - 1]!;
      if (edge < successorStart[node + 1]!) {
        pathEdge[depth - 1] = edge + 1;
        const next = successors[edge]!;
        if (skippedEdges[edge] !== 0 || isExcluded[next] !== 0) continue;
        if (index[next] === notVisited) enter(next);
        else if (componentOf[next] === noComponent) lowLink[node] = Math.min(lowLink[node]!, index[next]!);
        continue;
      }
      depth--;
      if (depth > 0) {
        const parent = path[depth - 1]!;
        lowLink[parent] = Math.min(lowLink[parent]!, lowLink[node]!);
      }
      if (lowLink[node] !== index[node]) continue;
      let member: number;
      do {
        member = pending[--pendingCount]!;
        componentOf[member] = componentCount;
        members[memberCount++] = member;
      } while (member !== node);
      memberStart[++componentCount] = memberCount;
    }
  }
  return { count: componentCount, componentOf, memberStart, members };
}

function seedComponents(components: Components, seeds: Map<number, number[]>): Uint32Array {
  const { componentOf } = components;
  const bits = new Uint32Array(components.count * wordsPerSet);
  for (const node of [...seeds.keys()].sort((a, b) => a - b)) {
    if (!isNode(node, componentOf.length)) throw invalidNode("a seed", node, componentOf.length);
    const component = componentOf[node]!;
    for (const feature of seeds.get(node)!) {
      if (!(Number.isInteger(feature) && feature >= 0 && feature < featureIndexLimit)) {
        throw new BuildError(`section graph: feature ${feature} of seed ${node} is not below ${featureIndexLimit}`);
      }
      if (component !== noComponent) bits[component * wordsPerSet + (feature >>> 5)]! |= 1 << (feature & 31);
    }
  }
  return bits;
}

function isEmptySet(bits: Uint32Array, start: number): boolean {
  for (let word = 0; word < wordsPerSet; word++) {
    if (bits[start + word] !== 0) return false;
  }
  return true;
}

function spreadFeatureBits(graph: Edges, skippedEdges: Uint8Array, components: Components, bits: Uint32Array): void {
  const { successorStart, successors } = graph;
  const { componentOf, memberStart, members } = components;
  for (let component = components.count - 1; component >= 0; component--) {
    const source = component * wordsPerSet;
    if (isEmptySet(bits, source)) continue;
    for (let at = memberStart[component]!; at < memberStart[component + 1]!; at++) {
      const node = members[at]!;
      for (let edge = successorStart[node]!; edge < successorStart[node + 1]!; edge++) {
        const target = componentOf[successors[edge]!]!;
        if (skippedEdges[edge] !== 0 || target === noComponent || target === component) continue;
        const destination = target * wordsPerSet;
        for (let word = 0; word < wordsPerSet; word++) bits[destination + word]! |= bits[source + word]!;
      }
    }
  }
}

function featuresIn(bits: Uint32Array, start: number): number[] {
  const features: number[] = [];
  for (let word = 0; word < wordsPerSet; word++) {
    for (let rest = bits[start + word]!; rest !== 0; rest &= rest - 1) {
      features.push(word * 32 + 31 - Math.clz32(rest & -rest));
    }
  }
  return features;
}

function internFeatureSets(components: Components, bits: Uint32Array): { setOf: Uint32Array; sets: number[][] } {
  const { componentOf } = components;
  const setOf = new Uint32Array(componentOf.length);
  const sets: number[][] = [[]];
  const setOfKey = new Map([["", 0]]);
  const setOfComponent = new Int32Array(components.count).fill(notInterned);
  for (let node = 0; node < componentOf.length; node++) {
    const component = componentOf[node]!;
    if (component === noComponent) continue;
    if (setOfComponent[component] === notInterned) {
      const features = featuresIn(bits, component * wordsPerSet);
      const key = features.join();
      let set = setOfKey.get(key);
      if (set === undefined) {
        set = sets.length;
        sets.push(features);
        setOfKey.set(key, set);
      }
      setOfComponent[component] = set;
    }
    setOf[node] = setOfComponent[component]!;
  }
  return { setOf, sets };
}

export function propagateFeatureSets(
  graph: Edges,
  seeds: Map<number, number[]>,
  skippedEdges: Uint8Array,
  isExcluded: Uint8Array,
): { setOf: Uint32Array; sets: number[][] } {
  checkSkippedEdges(graph, skippedEdges);
  if (isExcluded.length !== graph.count) {
    throw new BuildError(`section graph: isExcluded has ${isExcluded.length} bytes for ${graph.count} nodes`);
  }
  const components = findComponents(graph, skippedEdges, isExcluded);
  const bits = seedComponents(components, seeds);
  spreadFeatureBits(graph, skippedEdges, components, bits);
  return internFeatureSets(components, bits);
}

export function nameInSource({ format }: Pick<SectionGraph, "format">, symbol: string): string {
  return format === "macho" && symbol.startsWith("_") ? symbol.slice(1) : symbol;
}

export function findEdge(graph: SectionGraph, from: number, to: number): number {
  if (!isNode(from, graph.count)) throw invalidNode("the source of an edge", from, graph.count);
  const end = graph.successorStart[from + 1]!;
  let low = graph.successorStart[from]!;
  let high = end;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (graph.successors[middle]! < to) low = middle + 1;
    else high = middle;
  }
  return low < end && graph.successors[low] === to ? low : notFound;
}

export interface PlacedNodes {
  address: ArrayLike<number>;
  size: ArrayLike<number>;
  placedCount: number;
}

export function nodeAt(nodes: PlacedNodes, address: number): number {
  let low = 0;
  let high = nodes.placedCount;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (nodes.address[middle]! <= address) low = middle + 1;
    else high = middle;
  }
  return low > 0 && address < nodes.address[low - 1]! + nodes.size[low - 1]! ? low - 1 : notFound;
}

export function shortestChains(graph: Edges, from: Iterable<number>, skippedEdges?: Uint8Array): Int32Array {
  checkSkippedEdges(graph, skippedEdges);
  const { successorStart, successors } = graph;
  const previous = new Int32Array(graph.count).fill(notReached);
  const queue = new Uint32Array(graph.count);
  let queued = 0;
  for (const node of from) {
    if (!isNode(node, graph.count)) throw invalidNode("the start of a search", node, graph.count);
    if (previous[node] === notReached) {
      previous[node] = chainStart;
      queue[queued++] = node;
    }
  }
  for (let head = 0; head < queued; head++) {
    const node = queue[head]!;
    const end = successorStart[node + 1]!;
    for (let edge = successorStart[node]!; edge < end; edge++) {
      if (skippedEdges?.[edge]) continue;
      const next = successors[edge]!;
      if (previous[next] === notReached) {
        previous[next] = node;
        queue[queued++] = next;
      }
    }
  }
  return previous;
}

export function chainTo(previous: Int32Array, node: number): number[] {
  if (!isNode(node, previous.length)) throw invalidNode("the end of a chain", node, previous.length);
  const chain: number[] = [];
  if (previous[node] === notReached) return chain;
  for (let at = node; at !== chainStart; at = previous[at]!) chain.push(at);
  return chain;
}
