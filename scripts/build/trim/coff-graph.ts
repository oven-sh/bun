import { closeSync, existsSync, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readArchive, type ArchiveMember } from "./archive.ts";
import { readAt } from "./binary-reader.ts";
import {
  CoffObject,
  IMAGE_COMDAT_SELECT_ASSOCIATIVE,
  IMAGE_SCN_LNK_COMDAT,
  IMAGE_SYM_CLASS_EXTERNAL,
  notLoadedFlags,
  ordinarySectionName,
  scalarDeleting,
  type CoffSection,
} from "./coff-objects.ts";
import {
  createSectionGraph,
  nodeAt,
  type GraphFailure,
  type GraphReading,
  type PlacedNodes,
  type RecordSection,
  type UnreadReason,
} from "./graph.ts";
import type { NamedBytes } from "./icu-data.ts";
import { peImage, type LinkedImage } from "./linked-image.ts";

export const coffRecordSectionName = ".bun_removable_entry_points";

const pointerRelocationX64 = 1;
const pointerRelocationArm64 = 14;

export interface CoffLink {
  executable: string;
  chunkMap: string;
  symbolMap: string;
  inputs: string[];
  libraryFolders: string[];
  alternateNames: string[];
}

interface Chunk {
  address: number;
  size: number;
  alignment: number;
  output: string;
  object: string;
  section: string;
}

function readChunks(path: string): Chunk[] {
  const text = readFileSync(path, "latin1");
  const chunks: Chunk[] = [];
  const objects = new Map<string, string>();
  let output = "";
  for (let at = text.indexOf("\n") + 1; at < text.length;) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    if (text.charCodeAt(at + 24) !== 32) output = text.slice(at + 24, end).trim();
    else if (text.charCodeAt(at + 32) !== 32 && output !== ".pdata") {
      const line = text.slice(at, end).trimEnd();
      const open = line.lastIndexOf(":(");
      const size = parseInt(line.slice(9, 17), 16);
      if (open > 0 && size > 0) {
        const object = line.slice(32, open);
        if (!objects.has(object)) objects.set(object, object);
        chunks.push({
          address: parseInt(line.slice(0, 8), 16),
          size,
          alignment: Number(line.slice(18, 23)),
          output,
          object: objects.get(object)!,
          section: line.slice(open + 2, -1),
        });
      }
    }
    at = end + 1;
  }
  return chunks.sort((a, b) => a.address - b.address);
}

interface MapSymbol {
  name: string;
  address: number;
  object: string;
  isStatic: boolean;
}

function readSymbols(path: string): { symbols: MapSymbol[]; entry: number; knownToLinker: Set<string> } {
  const symbols: MapSymbol[] = [];
  const knownToLinker = new Set<string>();
  const sectionStart = new Map<number, number>();
  let base = 0;
  let entry = -1;
  let isStatic = false;
  for (const line of readFileSync(path, "latin1").split("\n")) {
    const symbol = /^ ([0-9a-f]{4}):([0-9a-f]{8}) +(\S+) +([0-9a-f]{16}) +(.*?)\s*$/.exec(line);
    if (symbol !== null) {
      knownToLinker.add(symbol[3]!);
      if (symbol[1] === "0000") continue;
      const address = parseInt(symbol[4]!, 16) - base;
      sectionStart.set(parseInt(symbol[1]!, 16), address - parseInt(symbol[2]!, 16));
      symbols.push({ name: symbol[3]!, address, object: symbol[5]!, isStatic });
    } else if (line.startsWith(" Preferred load address is ")) base = parseInt(line.slice(27), 16);
    else if (line.startsWith(" Static symbols")) isStatic = true;
    else {
      const at = /^ entry point at +([0-9a-f]{4}):([0-9a-f]{8})/.exec(line);
      if (at !== null) entry = (sectionStart.get(parseInt(at[1]!, 16)) ?? NaN) + parseInt(at[2]!, 16);
    }
  }
  return { symbols, entry, knownToLinker };
}

export function namedBytesOfPe(executable: string, symbolMap: string): NamedBytes {
  return {
    symbols: readSymbols(symbolMap).symbols.map(symbol => [symbol.name, symbol.address]),
    image: peImage(executable),
  };
}

function exportedAddresses(executable: string): number[] {
  const fd = openSync(executable, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24 + 240);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  const offsetOf = (address: number) => {
    for (let at = 0; at < sections.length; at += 40) {
      const start = sections.readUInt32LE(at + 12);
      if (address >= start && address - start < sections.readUInt32LE(at + 16))
        return sections.readUInt32LE(at + 20) + address - start;
    }
    return -1;
  };
  const directory = offsetOf(header.readUInt32LE(24 + 112));
  const addresses: number[] = [];
  if (directory >= 0) {
    const exports = readAt(fd, directory, 40);
    const functions = readAt(fd, offsetOf(exports.readUInt32LE(28)), exports.readUInt32LE(20) * 4);
    for (let at = 0; at < functions.length; at += 4) addresses.push(functions.readUInt32LE(at));
  }
  closeSync(fd);
  return addresses;
}

export function sectionInFile(executable: string, name: string): { offset: number; size: number } | undefined {
  const fd = openSync(executable, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  closeSync(fd);
  for (let at = 0; at < sections.length; at += 40) {
    if (sections.toString("latin1", at, at + 8).replace(/\0.*$/, "") === name)
      return { offset: sections.readUInt32LE(at + 20), size: sections.readUInt32LE(at + 16) };
  }
  return undefined;
}

function readRecordSection(
  object: CoffObject,
  name: string,
  section: CoffSection,
  pointerRelocation: number,
): RecordSection | undefined {
  const table = object.relocationsOf(section);
  const references = new Map<number, string>();
  for (let at = 0; at < table.length; at += 10) {
    if (table.readUInt16LE(at + 8) !== pointerRelocation) return undefined;
    references.set(table.readUInt32LE(at), "S" + table.readUInt32LE(at + 4));
  }
  return { object: name, bytes: object.bytesOf(section), references };
}

interface InputObjects {
  objects: Map<string, CoffObject | undefined>;
  nameInSymbolMap: Map<string, string>;
  unreadReasons: Map<string, UnreadReason>;
}

interface SymbolTies {
  placed: Map<CoffObject, Map<number, number>>;
  externalNode: Map<string, number>;
  names: string[][];
  aliases: Map<number, [string, string][]>;
  findLeaderNodes(object: CoffObject, name: string, section: number): number[] | undefined;
}

type SymbolTarget =
  | { kind: "Section"; section: number }
  | { kind: "External"; node: number; name: string }
  | { kind: "Undefined"; name: string }
  | { kind: "NoSection" };

interface Connections {
  successors: Set<number>[];
  unplaced: Map<CoffObject, Map<number, number>>;
  unplacedNodes: { object: string; section: string }[];
  roots: Set<number>;
  failures: GraphFailure[];
  symbolsOutsideGraph: number;
}

function findArchiveMembers(link: CoffLink, symbols: MapSymbol[]): Map<string, ArchiveMember[]> {
  const members = new Map<string, ArchiveMember[]>();
  const archives = new Set(link.inputs.filter(path => /\.(lib|rlib|a)$/i.test(path) && existsSync(path)));
  const stems = new Set(
    [...archives].map(path =>
      basename(path)
        .replace(/\.[^.]*$/, "")
        .toLowerCase(),
    ),
  );
  const neededLibraries = new Set<string>();
  for (const symbol of symbols) {
    const colon = symbol.object.indexOf(":");
    if (colon > 1 && !stems.has(symbol.object.slice(0, colon).toLowerCase()))
      neededLibraries.add(symbol.object.slice(0, colon).toLowerCase() + ".lib");
  }
  for (const folder of link.libraryFolders) {
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder)) {
      if (neededLibraries.delete(file.toLowerCase())) archives.add(join(folder, file));
    }
  }
  for (const archive of archives)
    for (const [name, list] of readArchive(archive)) members.set(name, [...(members.get(name) ?? []), ...list]);
  return members;
}

function openObjects(chunks: Chunk[], members: Map<string, ArchiveMember[]>, files: Map<string, number>): InputObjects {
  const fdOf = (path: string) => {
    let fd = files.get(path);
    if (fd === undefined) files.set(path, (fd = openSync(path, "r")));
    return fd;
  };
  const objects = new Map<string, CoffObject | undefined>();
  const nameInSymbolMap = new Map<string, string>();
  const unreadReasons = new Map<string, UnreadReason>();
  for (const { object } of chunks) {
    if (objects.has(object)) continue;
    let read: CoffObject | undefined;
    const inArchives = members.get(object);
    let reason: UnreadReason = "NotFound";
    if (existsSync(object)) {
      reason = "NotAnObject";
      const fd = fdOf(object);
      read = CoffObject.open(fd, 0, fstatSync(fd).size);
      nameInSymbolMap.set(object, basename(object).toLowerCase());
    } else if (inArchives !== undefined && inArchives.length > 1) {
      reason = "AmbiguousArchiveMember";
    } else if (inArchives?.length === 1) {
      reason = "NotAnObject";
      const { archive, offset, size } = inArchives[0]!;
      read = CoffObject.open(fdOf(archive), offset, size);
      nameInSymbolMap.set(object, (basename(archive).replace(/\.[^.]*$/, "") + ":" + basename(object)).toLowerCase());
    }
    objects.set(object, read);
    if (read === undefined) unreadReasons.set(object, reason);
  }
  return { objects, nameInSymbolMap, unreadReasons };
}

function tieSymbolsToChunks(
  chunks: Chunk[],
  placedNodes: PlacedNodes,
  symbols: MapSymbol[],
  { objects, nameInSymbolMap }: InputObjects,
  alternateNames: Set<string>,
): SymbolTies {
  const placed = new Map<CoffObject, Map<number, number>>();
  const placedSectionsOf = (object: CoffObject) => {
    let sections = placed.get(object);
    if (sections === undefined) placed.set(object, (sections = new Map()));
    return sections;
  };
  const externalNode = new Map<string, number>();
  const staticNodes = new Map<string, number[]>();
  const names: string[][] = chunks.map(() => []);
  const aliases = new Map<number, [string, string][]>();
  const nodesWithLeader = new Set<number>();
  const ledByLabel = new Set<number>();
  for (const symbol of symbols) {
    const node = nodeAt(placedNodes, symbol.address);
    if (node < 0) continue;
    const chunk = chunks[node]!;
    if (symbol.isStatic) {
      const key = symbol.object.toLowerCase() + "\0" + symbol.name;
      const list = staticNodes.get(key);
      if (list === undefined) staticNodes.set(key, [node]);
      else list.push(node);
    } else externalNode.set(symbol.name, node);
    const object = objects.get(chunk.object);
    const isSameObject = nameInSymbolMap.get(chunk.object) === symbol.object.toLowerCase();
    const ownSymbol = isSameObject
      ? object?.byName.get(symbol.name)?.find(index => {
          const section = object.sections[object.symbolSection[index]! - 1]!;
          const isExternal = object.symbolClass[index] === IMAGE_SYM_CLASS_EXTERNAL;
          return (
            symbol.address - object.symbolValue[index]! === chunk.address &&
            section.size === chunk.size &&
            isExternal !== symbol.isStatic
          );
        })
      : undefined;
    if (object !== undefined && ownSymbol !== undefined)
      placedSectionsOf(object).set(object.symbolSection[ownSymbol]!, node);
    if (symbol.address !== chunk.address) continue;
    names[node]!.push(symbol.name);
    const isLabel = object !== undefined && ownSymbol !== undefined && symbol.isStatic && !object.isFunction(ownSymbol);
    if (ownSymbol !== undefined && (!nodesWithLeader.has(node) || (ledByLabel.has(node) && !isLabel))) {
      nodesWithLeader.add(node);
      if (isLabel) ledByLabel.add(node);
      else ledByLabel.delete(node);
    } else if (chunk.output === ".text" && !isLabel && !alternateNames.has(symbol.name)) {
      const list = aliases.get(node);
      if (list === undefined) aliases.set(node, [[symbol.object, symbol.name]]);
      else list.push([symbol.object, symbol.name]);
    }
  }
  const findLeaderNodes = (object: CoffObject, name: string, section: number): number[] | undefined => {
    const { leader } = object.sections[section - 1]!;
    if (leader < 0) return undefined;
    if (object.symbolClass[leader] !== IMAGE_SYM_CLASS_EXTERNAL)
      return staticNodes.get(nameInSymbolMap.get(name) + "\0" + object.nameOf(leader));
    const node = externalNode.get(object.nameOf(leader));
    return node === undefined ? undefined : [node];
  };
  return { placed, externalNode, names, aliases, findLeaderNodes };
}

function readRecordSections(
  objects: InputObjects["objects"],
  pointerRelocation: number,
): { recordSections: RecordSection[]; failures: GraphFailure[] } {
  const recordSections: RecordSection[] = [];
  const failures: GraphFailure[] = [];
  for (const [name, object] of objects) {
    if (object === undefined) continue;
    for (const section of object.sections) {
      if (section.name !== coffRecordSectionName) continue;
      const records = readRecordSection(object, name, section, pointerRelocation);
      if (records === undefined) failures.push({ kind: "UnreadInput", object: name, reason: "UnsupportedRelocations" });
      else recordSections.push(records);
    }
  }
  return { recordSections, failures };
}

function findSymbolTarget(object: CoffObject, symbol: number, externalNode: Map<string, number>): SymbolTarget {
  for (;;) {
    const section = object.symbolSection[symbol];
    if (section === undefined || section < 0) return { kind: "NoSection" };
    if (section > 0) return { kind: "Section", section };
    const name = object.nameOf(symbol);
    const node = externalNode.get(name) ?? externalNode.get(scalarDeleting(name));
    if (node !== undefined) return { kind: "External", node, name };
    const weakDefault = object.symbolDefault[symbol]!;
    if (weakDefault < 0) return { kind: "Undefined", name };
    symbol = weakDefault;
  }
}

function findUntiedSectionKeys(
  chunks: Chunk[],
  objects: InputObjects["objects"],
  placed: SymbolTies["placed"],
): Map<string, Set<string>> {
  const tiedNodes = new Set<number>();
  for (const sections of placed.values()) for (const node of sections.values()) tiedNodes.add(node);
  const keysByObject = new Map<string, Set<string>>();
  chunks.forEach((chunk, node) => {
    if (tiedNodes.has(node) || objects.get(chunk.object) === undefined) return;
    let keys = keysByObject.get(chunk.object);
    if (keys === undefined) keysByObject.set(chunk.object, (keys = new Set()));
    keys.add(chunk.section + "\0" + chunk.size);
  });
  return keysByObject;
}

function connectSections(
  chunks: Chunk[],
  objects: InputObjects["objects"],
  ties: SymbolTies,
  knownToLinker: Set<string>,
): Connections {
  const { placed, externalNode, findLeaderNodes } = ties;
  const successors: Set<number>[] = chunks.map(() => new Set());
  const unplaced = new Map<CoffObject, Map<number, number>>();
  const unplacedNodes: { object: string; section: string }[] = [];
  const worklist: [CoffObject, string, number, number][] = [];
  const roots = new Set<number>();
  const failures: GraphFailure[] = [];
  let symbolsOutsideGraph = 0;
  const ensureUnplacedNode = (object: CoffObject, name: string, section: number) => {
    let nodes = unplaced.get(object);
    if (nodes === undefined) unplaced.set(object, (nodes = new Map()));
    let node = nodes.get(section);
    if (node === undefined) {
      nodes.set(section, (node = successors.length));
      unplacedNodes.push({ object: name, section: object.sections[section - 1]!.name });
      successors.push(new Set());
      worklist.push([object, name, section, node]);
    }
    return node;
  };
  const nodesOf = (object: CoffObject, name: string, section: number): number[] => {
    const node = placed.get(object)?.get(section);
    if (node !== undefined) return [node];
    return findLeaderNodes(object, name, section) ?? [ensureUnplacedNode(object, name, section)];
  };
  const addReferences = (
    object: CoffObject,
    name: string,
    section: number,
    from: number,
    reportsUnresolved: boolean,
  ) => {
    for (const symbol of object.targetsOf(object.sections[section - 1]!)) {
      const target = findSymbolTarget(object, symbol, externalNode);
      switch (target.kind) {
        case "Section":
          for (const node of nodesOf(object, name, target.section)) successors[from]!.add(node);
          break;
        case "External":
          successors[from]!.add(target.node);
          break;
        case "Undefined":
          if (!reportsUnresolved || knownToLinker.has(target.name)) symbolsOutsideGraph++;
          else
            failures.push({
              kind: "UnresolvedReference",
              object: name,
              section: object.sections[section - 1]!.name,
              target: target.name,
            });
          break;
        case "NoSection":
          break;
      }
    }
  };
  const drainWorklist = (reportsUnresolved: boolean) => {
    for (let next = worklist.pop(); next !== undefined; next = worklist.pop())
      addReferences(next[0], next[1], next[2], next[3], reportsUnresolved);
  };
  for (const [name, object] of objects) {
    if (object === undefined) continue;
    object.sections.forEach((section, index) => {
      if (section.flags & notLoadedFlags || section.size === 0) return;
      const node = placed.get(object)?.get(index + 1);
      const parent =
        section.selection === IMAGE_COMDAT_SELECT_ASSOCIATIVE ? placed.get(object)?.get(section.parent) : undefined;
      const isInImage = node !== undefined || parent !== undefined;
      const isRoot = !(section.flags & IMAGE_SCN_LNK_COMDAT) || (isInImage && !ordinarySectionName.test(section.name));
      if (isRoot) roots.add(node ?? ensureUnplacedNode(object, name, index + 1));
      if (node !== undefined) addReferences(object, name, index + 1, node, true);
      if (parent !== undefined) successors[parent]!.add(node ?? ensureUnplacedNode(object, name, index + 1));
    });
  }
  drainWorklist(true);
  for (const [name, untiedSectionKeys] of findUntiedSectionKeys(chunks, objects, placed)) {
    const object = objects.get(name)!;
    object.sections.forEach((section, index) => {
      const isUntied = untiedSectionKeys.has(section.name + "\0" + section.size) && !placed.get(object)?.has(index + 1);
      if (isUntied && section.selection !== IMAGE_COMDAT_SELECT_ASSOCIATIVE)
        roots.add(ensureUnplacedNode(object, name, index + 1));
    });
  }
  drainWorklist(false);
  return { successors, unplaced, unplacedNodes, roots, failures, symbolsOutsideGraph };
}

function connectDuplicateSections(
  count: number,
  placed: SymbolTies["placed"],
  unplaced: Connections["unplaced"],
  successors: Set<number>[],
): void {
  const isFoldable = (section: CoffSection) => section.name.startsWith(".rdata") && section.contents !== 0;
  const placedSuccessors = (node: number) => [...successors[node]!].filter(next => next < count);
  const unplacedByContents = new Map<string, [number, number[]][]>();
  const sizes = new Set<number>();
  for (const [object, nodes] of unplaced) {
    for (const [index, node] of nodes) {
      const section = object.sections[index - 1]!;
      if (!isFoldable(section)) continue;
      sizes.add(section.size);
      const contents = object.contentsOf(section);
      const list = unplacedByContents.get(contents);
      if (list === undefined) unplacedByContents.set(contents, [[node, placedSuccessors(node)]]);
      else list.push([node, placedSuccessors(node)]);
    }
  }
  for (const [object, sections] of placed) {
    for (const [index, node] of sections) {
      const section = object.sections[index - 1]!;
      if (!sizes.has(section.size) || !isFoldable(section)) continue;
      for (const [duplicate, references] of unplacedByContents.get(object.contentsOf(section)) ?? []) {
        if (
          references.length === placedSuccessors(node).length &&
          references.every(next => successors[node]!.has(next))
        )
          successors[duplicate]!.add(node);
      }
    }
  }
}

function findUnreadChunks(
  chunks: Chunk[],
  unreadReasons: Map<string, UnreadReason>,
): { nodes: number[]; failures: GraphFailure[] } {
  const nodes: number[] = [];
  const failures: GraphFailure[] = [];
  const reportedObjects = new Set<string>();
  chunks.forEach(({ object, output }, node) => {
    const reason = unreadReasons.get(object);
    if (reason === undefined) return;
    nodes.push(node);
    if (output === ".rsrc" || reportedObjects.has(object)) return;
    reportedObjects.add(object);
    failures.push({ kind: "UnreadInput", object, reason });
  });
  return { nodes, failures };
}

function findExportedNodes(executable: string, placedNodes: PlacedNodes): Set<number> {
  const exported = new Set<number>();
  for (const address of exportedAddresses(executable)) {
    const node = nodeAt(placedNodes, address);
    if (node >= 0) exported.add(node);
  }
  return exported;
}

function findOutputs(chunks: Chunk[], image: LinkedImage): string[] {
  return chunks.map(chunk =>
    chunk.output === ".data" && image.bytes(chunk.address, chunk.size) === undefined ? ".bss" : chunk.output,
  );
}

function computePaddedSizes(chunks: Chunk[], output: string[]): number[] {
  return chunks.map((chunk, node) => {
    const next = chunks[node + 1];
    if (next === undefined) return chunk.size;
    const padding = next.address - chunk.address - chunk.size;
    return output[node] === output[node + 1] && padding > 0 && padding < next.alignment
      ? chunk.size + padding
      : chunk.size;
  });
}

function createResolver(
  objects: InputObjects["objects"],
  { placed, externalNode, findLeaderNodes }: SymbolTies,
  unplaced: Connections["unplaced"],
): GraphReading["resolve"] {
  return (object, reference) => {
    const coff = objects.get(object);
    if (coff === undefined) return undefined;
    const target = findSymbolTarget(coff, Number(reference.slice(1)), externalNode);
    switch (target.kind) {
      case "Section": {
        const { section } = target;
        const node =
          placed.get(coff)?.get(section) ??
          findLeaderNodes(coff, object, section)?.[0] ??
          unplaced.get(coff)?.get(section);
        if (node === undefined) return undefined;
        const { leader } = coff.sections[section - 1]!;
        const hasExternalLeader = leader >= 0 && coff.symbolClass[leader] === IMAGE_SYM_CLASS_EXTERNAL;
        return { node, section: hasExternalLeader ? "X" + coff.nameOf(leader) : object + "\0" + section };
      }
      case "External":
        return { node: target.node, section: "X" + target.name };
      case "Undefined":
      case "NoSection":
        return undefined;
    }
  };
}

function createReading(link: CoffLink, files: Map<string, number>): GraphReading {
  const chunks = readChunks(link.chunkMap);
  const { symbols, entry, knownToLinker } = readSymbols(link.symbolMap);
  const image = peImage(link.executable);
  const count = chunks.length;
  const placedNodes = {
    address: chunks.map(chunk => chunk.address),
    size: chunks.map(chunk => chunk.size),
    placedCount: count,
  };
  const inputs = openObjects(chunks, findArchiveMembers(link, symbols), files);
  const ties = tieSymbolsToChunks(chunks, placedNodes, symbols, inputs, new Set(link.alternateNames));
  const records = readRecordSections(inputs.objects, image.isArm64 ? pointerRelocationArm64 : pointerRelocationX64);
  const connections = connectSections(chunks, inputs.objects, ties, knownToLinker);
  const { successors, unplaced, unplacedNodes, symbolsOutsideGraph } = connections;
  connectDuplicateSections(count, ties.placed, unplaced, successors);
  const unreadChunks = findUnreadChunks(chunks, inputs.unreadReasons);
  const roots = new Set([...connections.roots, ...unreadChunks.nodes]);
  const entryNode = nodeAt(placedNodes, entry);
  if (entryNode >= 0) roots.add(entryNode);
  const output = findOutputs(chunks, image);
  const graph = createSectionGraph({
    format: "coff",
    isArm64: image.isArm64,
    placedCount: count,
    address: [...placedNodes.address, ...unplacedNodes.map(() => -1)],
    size: [...computePaddedSizes(chunks, output), ...unplacedNodes.map(() => 0)],
    alignment: [...chunks.map(chunk => chunk.alignment), ...unplacedNodes.map(() => 1)],
    output: [...output, ...unplacedNodes.map(() => "")],
    object: [...chunks.map(chunk => chunk.object), ...unplacedNodes.map(node => node.object)],
    section: [...chunks.map(chunk => chunk.section), ...unplacedNodes.map(node => node.section)],
    successors,
    roots,
    exported: findExportedNodes(link.executable, placedNodes),
    liveWithoutReference: new Set(),
    names: [...ties.names, ...unplacedNodes.map(() => [])],
    aliases: ties.aliases,
    externalNames: new Set(ties.externalNode.keys()),
    stringHash: new Map(),
  });
  return {
    graph,
    recordSections: records.recordSections,
    resolve: createResolver(inputs.objects, ties, unplaced),
    failures: [...records.failures, ...connections.failures, ...unreadChunks.failures],
    statistics: {
      chunks: count,
      sectionsWithoutAddress: unplacedNodes.length,
      references: graph.successors.length,
      symbolsOutsideGraph,
    },
  };
}

export function readCoffGraph(link: CoffLink): GraphReading {
  const files = new Map<string, number>();
  try {
    return createReading(link, files);
  } finally {
    for (const fd of files.values()) closeSync(fd);
  }
}
