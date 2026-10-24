import { closeSync, readFileSync } from "node:fs";
import { ArchiveCache } from "./archive.ts";
import { fail, readAt, stringAt } from "./binary-reader.ts";
import type { ElfFile } from "./elf-file.ts";
import { openElf } from "./elf-file.ts";
import type { ElfObjectReferences } from "./elf-objects.ts";
import { foldedSections, ignoredOutputs, isOrdinary, readElfObject } from "./elf-objects.ts";
import type { GraphFailure, GraphReading, PlacedNodes, RecordSection, ResolvedReference } from "./graph.ts";
import { createSectionGraph, nodeAt } from "./graph.ts";

interface MapEntry {
  address: number;
  size: number;
  alignment: number;
  output: string;
  object: string;
  section: string;
}

interface LinkedSymbols {
  nodesBySymbol: Map<string, number[]>;
  knownToLinker: Set<string>;
  ifuncNodes: number[];
}

interface InputObjects {
  objects: Map<string, ElfObjectReferences | undefined>;
  defined: Map<string, string[]>;
  failures: GraphFailure[];
}

interface SectionLookup {
  nodesBySection: Map<string, number[]>;
  findNode: (key: string) => number | undefined;
  resolveGlobal: (name: string) => number | undefined;
}

type GlobalNodes = number[] | "Unresolved";

interface Connections {
  successors: Set<number>[];
  names: string[][];
  unwindTableNodes: number[];
  failures: GraphFailure[];
}

export function functionOfSection(section: string): string | undefined {
  return /^\.text\.(?:unlikely\.|hot\.|startup\.|exit\.)?(.+)$/.exec(section)?.[1];
}

function parseMap(mapPath: string): MapEntry[] {
  const entries: MapEntry[] = [];
  let output = "";
  let isLoaded = false;
  for (const line of readFileSync(mapPath, "latin1").split("\n")) {
    const match = /^\s*([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)\s+(\d+) ( *)(\S.*)$/.exec(line);
    if (match === null) continue;
    if (match[4]!.length === 0) {
      output = match[5]!.trim();
      isLoaded = parseInt(match[1]!, 16) !== 0;
    } else if (match[4]!.length === 8 && isLoaded && !ignoredOutputs.test(output)) {
      const input = /^(.*):\(([^()]*)\)\s*$/.exec(match[5]!);
      const size = parseInt(match[2]!, 16);
      if (input !== null && size > 0) {
        entries.push({
          address: parseInt(match[1]!, 16),
          size,
          alignment: Number(match[3]),
          output,
          object: input[1]!,
          section: input[2]!,
        });
      }
    }
  }
  entries.sort((a, b) => a.address - b.address);
  return entries;
}

function indexSections(entries: MapEntry[]): {
  nodesBySection: Map<string, number[]>;
  liveSections: Map<string, Set<string>>;
} {
  const nodesBySection = new Map<string, number[]>();
  const liveSections = new Map<string, Set<string>>();
  for (let node = 0; node < entries.length; node++) {
    const { object, section } = entries[node]!;
    const key = object + "\0" + section;
    const list = nodesBySection.get(key);
    if (list === undefined) nodesBySection.set(key, [node]);
    else list.push(node);
    let live = liveSections.get(object);
    if (live === undefined) liveSections.set(object, (live = new Set()));
    live.add(section);
  }
  return { nodesBySection, liveSections };
}

function findAliases(
  folded: Map<string, string>,
  nodesBySection: Map<string, number[]>,
): Map<number, [string, string][]> {
  const result = new Map<number, [string, string][]>();
  for (const [removed, selected] of folded) {
    const node = nodesBySection.get(selected)?.[0];
    const [object, section] = removed.split("\0") as [string, string];
    const name = functionOfSection(section);
    if (node === undefined || name === undefined) continue;
    const aliases = result.get(node);
    if (aliases === undefined) result.set(node, [[object, name]]);
    else aliases.push([object, name]);
  }
  return result;
}

function readObjects(liveSections: Map<string, Set<string>>): InputObjects {
  const archives = new ArchiveCache();
  const objects = new Map<string, ElfObjectReferences | undefined>();
  const defined = new Map<string, string[]>();
  const failures: GraphFailure[] = [];
  for (const [object, live] of liveSections) {
    if (object === "<internal>") continue;
    const read = readElfObject(object, live, archives);
    if (typeof read === "string") {
      objects.set(object, undefined);
      failures.push({ kind: "UnreadInput", object, reason: read });
      continue;
    }
    objects.set(object, read);
    for (const [name, section] of read.definitions) {
      const list = defined.get(name);
      if (list === undefined) defined.set(name, [object + "\0" + section]);
      else list.push(object + "\0" + section);
    }
  }
  return { objects, defined, failures };
}

function readLinkedSymbols(elf: ElfFile, placedNodes: PlacedNodes, executable: string): LinkedSymbols {
  const symbolTable = elf.sections.find(section => section.type === 2) ?? fail(`${executable} has no symbol table`);
  const symbols = readAt(elf.fd, symbolTable.offset, symbolTable.size);
  const strings = readAt(elf.fd, elf.sections[symbolTable.link]!.offset, elf.sections[symbolTable.link]!.size);
  const nodesBySymbol = new Map<string, number[]>();
  const knownToLinker = new Set<string>();
  const ifuncNodes: number[] = [];
  for (let at = 0; at < symbols.length; at += 24) {
    const name = stringAt(strings, symbols.readUInt32LE(at));
    knownToLinker.add(name);
    const type = symbols[at + 4]! & 15;
    if (symbols.readUInt16LE(at + 6) === 0 || type === 3 || type === 4 || type === 6) continue;
    const node = nodeAt(placedNodes, Number(symbols.readBigUInt64LE(at + 8)));
    if (node < 0) continue;
    if (type === 10) ifuncNodes.push(node);
    if (name.startsWith("$")) continue;
    const nodes = nodesBySymbol.get(name);
    if (nodes === undefined) nodesBySymbol.set(name, [node]);
    else if (!nodes.includes(node)) nodes.push(node);
  }
  return { nodesBySymbol, knownToLinker, ifuncNodes };
}

const withoutSymbolVersion = (name: string) => name.replace(/@.*$/, "");

function createGlobalNodeFinder(
  resolveGlobal: SectionLookup["resolveGlobal"],
  { nodesBySymbol, knownToLinker }: LinkedSymbols,
): (name: string) => GlobalNodes {
  const nodesOfGlobal = new Map<string, GlobalNodes>();
  return (name: string) => {
    let nodes = nodesOfGlobal.get(name);
    if (nodes === undefined) {
      const spellings = [name, "__wrap_" + name, name.replace(/^__real_/, ""), withoutSymbolVersion(name)];
      const distinct = new Set(spellings.flatMap(spelling => nodesBySymbol.get(spelling) ?? []));
      const node = resolveGlobal(name);
      if (node !== undefined) distinct.add(node);
      const isKnown = distinct.size > 0 || spellings.some(spelling => knownToLinker.has(spelling));
      nodes = isKnown ? [...distinct] : "Unresolved";
      nodesOfGlobal.set(name, nodes);
    }
    return nodes;
  };
}

function connect(
  count: number,
  objects: InputObjects["objects"],
  lookup: SectionLookup,
  symbols: LinkedSymbols,
): Connections {
  const { nodesBySection, findNode, resolveGlobal } = lookup;
  const findGlobalNodes = createGlobalNodeFinder(resolveGlobal, symbols);
  const successors: Set<number>[] = Array.from({ length: count }, () => new Set());
  const names: string[][] = Array.from({ length: count }, () => []);
  const unwindTableNodes: number[] = [];
  const failures: GraphFailure[] = [];
  for (const [object, read] of objects) {
    if (read === undefined) continue;
    for (const [name, section] of read.named) {
      const node = findNode(object + "\0" + section);
      if (node !== undefined) names[node]!.push(name);
    }
    for (const [source, targets] of read.references) {
      const from = successors[nodesBySection.get(object + "\0" + source)![0]!]!;
      for (const target of targets) {
        const name = target.slice(1);
        if (target[0] === "L") {
          const node = findNode(object + "\0" + name);
          if (node !== undefined) from.add(node);
          else failures.push({ kind: "UnresolvedReference", object, section: source, target: name });
          continue;
        }
        const nodes = findGlobalNodes(name);
        if (nodes !== "Unresolved") for (const node of nodes) from.add(node);
        else failures.push({ kind: "UnresolvedReference", object, section: source, target: name });
      }
    }
    for (const name of read.namedByUnwindTables) {
      for (const node of [resolveGlobal(name), ...(symbols.nodesBySymbol.get(name) ?? [])])
        if (node !== undefined) unwindTableNodes.push(node);
    }
  }
  for (const nodes of nodesBySection.values()) {
    for (const node of nodes.slice(1)) {
      successors[nodes[0]!]!.add(node);
      successors[node]!.add(nodes[0]!);
    }
  }
  return { successors, names, unwindTableNodes, failures };
}

function findRoots(
  entries: MapEntry[],
  objects: InputObjects["objects"],
  elf: ElfFile,
  placedNodes: PlacedNodes,
  symbolNodes: number[],
): { roots: Set<number>; exported: Set<number> } {
  const roots = new Set(symbolNodes);
  entries.forEach(({ output, object }, node) => {
    if (!isOrdinary(output) || objects.get(object) === undefined) roots.add(node);
  });
  const entry = nodeAt(placedNodes, Number(readAt(elf.fd, 0x18, 8).readBigUInt64LE(0)));
  if (entry >= 0) roots.add(entry);
  const exported = new Set<number>();
  const dynamic = elf.sections.find(section => section.type === 11);
  if (dynamic !== undefined) {
    const symbols = readAt(elf.fd, dynamic.offset, dynamic.size);
    for (let at = 0; at < symbols.length; at += 24) {
      const node =
        symbols.readUInt16LE(at + 6) !== 0 ? nodeAt(placedNodes, Number(symbols.readBigUInt64LE(at + 8))) : -1;
      if (node >= 0) exported.add(node);
    }
  }
  return { roots, exported };
}

function createReading(
  elf: ElfFile,
  executable: string,
  entries: MapEntry[],
  folded: Map<string, string>,
): GraphReading {
  const placedNodes = {
    address: entries.map(entry => entry.address),
    size: entries.map(entry => entry.size),
    placedCount: entries.length,
  };
  const { nodesBySection, liveSections } = indexSections(entries);
  const findNode = (key: string) => nodesBySection.get(key)?.[0] ?? nodesBySection.get(folded.get(key) ?? "")?.[0];
  const { objects, defined, failures: unreadInputs } = readObjects(liveSections);
  const resolveGlobal = (name: string) => {
    for (const key of defined.get(name) ?? []) {
      const node = findNode(key);
      if (node !== undefined) return node;
    }
    return undefined;
  };
  const symbols = readLinkedSymbols(elf, placedNodes, executable);
  const { nodesBySymbol, ifuncNodes } = symbols;
  const connections = connect(entries.length, objects, { nodesBySection, findNode, resolveGlobal }, symbols);
  const symbolNodes = [...ifuncNodes, ...connections.unwindTableNodes];
  const { roots, exported } = findRoots(entries, objects, elf, placedNodes, symbolNodes);
  const graph = createSectionGraph({
    format: "elf",
    isArm64: readAt(elf.fd, 0x12, 2).readUInt16LE(0) === 183,
    ...placedNodes,
    alignment: entries.map(entry => entry.alignment),
    output: entries.map(entry => entry.output),
    object: entries.map(entry => entry.object),
    section: entries.map(entry => entry.section),
    successors: connections.successors,
    roots,
    exported,
    liveWithoutReference: new Set(),
    names: connections.names,
    aliases: findAliases(folded, nodesBySection),
    externalNames: new Set(),
    stringHash: new Map(),
  });
  const resolve = (object: string, reference: string): ResolvedReference | undefined => {
    const name = reference.slice(1);
    const keys = reference[0] === "L" ? [object + "\0" + name] : (defined.get(name) ?? []);
    for (const key of keys) {
      const node = findNode(key);
      if (node !== undefined) return { node, section: key };
    }
    const node = reference[0] === "G" ? nodesBySymbol.get(name)?.[0] : undefined;
    return node === undefined ? undefined : { node, section: graph.object[node] + "\0" + graph.section[node] };
  };
  const recordSections: RecordSection[] = [];
  for (const [object, read] of objects) {
    for (const section of read?.recordSections ?? []) recordSections.push({ object, ...section });
  }
  const statistics = { sections: graph.count, references: graph.successors.length, foldedSections: folded.size };
  return { graph, recordSections, resolve, failures: [...unreadInputs, ...connections.failures], statistics };
}

export function readElfGraph(executable: string, mapPath: string, log: string): GraphReading {
  const elf = openElf(executable, "r") ?? fail(`${executable} is not an ELF file`);
  try {
    return createReading(elf, executable, parseMap(mapPath), foldedSections(log));
  } finally {
    closeSync(elf.fd);
  }
}
