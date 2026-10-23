import { closeSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ArchiveCache } from "./archive.ts";
import { fail, readAt } from "./binary-reader.ts";
import type { GraphFailure, GraphReading, PlacedNodes, RecordSection, UnreadReason } from "./graph.ts";
import { createSectionGraph, nodeAt } from "./graph.ts";
import type { LinkedImage } from "./linked-image.ts";
import { machOImage } from "./linked-image.ts";
import type { MachOReferences } from "./macho-objects.ts";
import { LC_SEGMENT_64, readMachOObject } from "./macho-objects.ts";
import { xxh3 } from "./xxh3.ts";

export function* pointersInMachO(path: string): Generator<[at: number, target: number]> {
  const fd = openSync(path, "r");
  const commands = readAt(fd, 32, readAt(fd, 0, 32).readUInt32LE(20));
  const segments: { address: number; offset: number; size: number }[] = [];
  let fixups: Buffer | undefined;
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    const kind = commands.readUInt32LE(at);
    if (kind === LC_SEGMENT_64)
      segments.push({
        address: Number(commands.readBigUInt64LE(at + 24)),
        offset: Number(commands.readBigUInt64LE(at + 40)),
        size: Number(commands.readBigUInt64LE(at + 48)),
      });
    else if (kind === 0x80000034) fixups = readAt(fd, commands.readUInt32LE(at + 8), commands.readUInt32LE(at + 12));
  }
  const base = segments.find(segment => segment.offset === 0 && segment.size > 0)?.address ?? 0;
  const starts = fixups?.readUInt32LE(4) ?? 0;
  for (let index = 0; index < (fixups?.readUInt32LE(starts) ?? 0); index++) {
    const inSegment = fixups!.readUInt32LE(starts + 4 + index * 4);
    if (inSegment === 0) continue;
    const [sizeOfPage, format, pages] = [4, 6, 20].map(field => fixups!.readUInt16LE(starts + inSegment + field)) as [
      number,
      number,
      number,
    ];
    if (format !== 2 && format !== 6) continue;
    const { address, offset, size } = segments[index]!;
    const data = readAt(fd, offset, size);
    for (let page = 0; page < pages; page++) {
      const first = fixups!.readUInt16LE(starts + inSegment + 22 + page * 2);
      if (first === 0xffff) continue;
      for (let at = page * sizeOfPage + first; ;) {
        const high = data.readUInt32LE(at + 4);
        if (high >>> 31 === 0)
          yield [address + at, data.readUInt32LE(at) + (high & 15) * 0x100000000 + (format === 6 ? base : 0)];
        const next = (high >>> 19) & 0xfff;
        if (next === 0) break;
        at += next * 4;
      }
    }
  }
  closeSync(fd);
}

export const isOneUnitOfAssembly = (output: string) =>
  output === "__TEXT,__jsc_bytecode" || output === "__TEXT,__jsc_wasm";

const textOutput = "__TEXT,__text";
const stubsOutput = "__TEXT,__stubs";
const cstringOutput = "__TEXT,__cstring";
const literalOutput = "__TEXT,__literals";
const machOPageBytes = 16384;

interface MapSymbol {
  address: number;
  size: number;
  file: number;
  name: string;
}

interface OutputSection {
  address: number;
  size: number;
  name: string;
}

interface LinkMap {
  files: Map<number, string>;
  sections: OutputSection[];
  atoms: MapSymbol[];
  zeroSizeSymbols: MapSymbol[];
  literals: OutputSection | undefined;
}

interface InputObjects {
  files: Map<number, string>;
  objects: Map<number, MachOReferences | undefined>;
  unreadReasons: Map<number, UnreadReason>;
}

interface AtomLookup {
  findInFile(file: number, names: string): number | undefined;
  findInAnyFile(names: string): number | undefined;
  findExternalName(names: string): string | undefined;
}

interface SymbolIndex extends AtomLookup {
  external: Map<string, number>;
  fileOfNode: number[];
  aliases: Map<number, [string, string][]>;
  mergedStringFiles: Map<number, number[]>;
  symbolsWithoutBytes: Set<string>;
  namesWithoutBytes: Set<string>;
}

interface Connections {
  successors: Set<number>[];
  retained: Set<number>;
  liveWithoutReference: Set<number>;
  stringReferrers: Map<number, Set<number>>;
  failures: GraphFailure[];
  stringsNotFound: number;
  stringsNotFoundAt: string[];
  literalsNotFollowed: number;
  symbolsOutsideGraph: number;
}

function parseMap(mapPath: string): LinkMap {
  const files = new Map<number, string>();
  const sections: OutputSection[] = [];
  const atoms: MapSymbol[] = [];
  const zeroSizeSymbols: MapSymbol[] = [];
  let stage = "";
  for (const line of readFileSync(mapPath, "latin1").split("\n")) {
    if (line.startsWith("#")) {
      stage = /^# (Object files|Sections|Symbols|Dead Stripped Symbols):/.exec(line)?.[1] ?? stage;
      continue;
    }
    if (stage === "Object files") {
      const match = /^\[\s*(\d+)\] (.*)$/.exec(line);
      if (match !== null) files.set(Number(match[1]), match[2]!);
    } else if (stage === "Sections") {
      const words = line.split(/\s+/);
      if (words.length >= 4)
        sections.push({
          address: parseInt(words[0]!, 16),
          size: parseInt(words[1]!, 16),
          name: `${words[2]},${words[3]}`,
        });
    } else if (stage === "Symbols") {
      const match = /^0x([0-9A-F]+)\s+0x([0-9A-F]+)\s+\[\s*(\d+)\] (.*)$/.exec(line);
      if (match === null) continue;
      const symbol = {
        address: parseInt(match[1]!, 16),
        size: parseInt(match[2]!, 16),
        file: Number(match[3]),
        name: match[4]!,
      };
      if (symbol.size > 0) atoms.push(symbol);
      else zeroSizeSymbols.push(symbol);
    }
  }
  const literals = sections.find(section => section.name === literalOutput);
  for (let at = 0; literals !== undefined && at + 4 <= literals.size; at += 4)
    atoms.push({
      address: literals.address + at,
      size: 4,
      file: 0,
      name: `literal ${(literals.address + at).toString(16)}`,
    });
  atoms.sort((a, b) => a.address - b.address);
  return { files, sections, atoms, zeroSizeSymbols, literals };
}

function findOutputs(atoms: MapSymbol[], sections: OutputSection[]): string[] {
  let section = sections[0];
  return atoms.map(atom => {
    if (section === undefined || atom.address < section.address || atom.address >= section.address + section.size) {
      section = sections.find(other => other.address <= atom.address && atom.address < other.address + other.size);
    }
    return section?.name ?? "?";
  });
}

function readObjects(listedFiles: Map<number, string>, compiledFromBitcode: string[]): InputObjects {
  const files = new Map(listedFiles);
  const listed = new Set([...files.values()].map(path => resolve(path)));
  for (const path of compiledFromBitcode) if (!listed.has(resolve(path))) files.set(files.size, path);
  const objects = new Map<number, MachOReferences | undefined>();
  const unreadReasons = new Map<number, UnreadReason>();
  const archives = new ArchiveCache();
  for (const [file, path] of files) {
    if (file === 0) continue;
    const read = readMachOObject(path, archives);
    objects.set(file, typeof read === "string" ? undefined : read);
    if (typeof read === "string") unreadReasons.set(file, read);
  }
  return { files, objects, unreadReasons };
}

function createAtomLookup(
  nodeInFile: Map<string, number>,
  nodeByName: Map<string, number>,
  external: Map<string, number>,
): AtomLookup {
  const findExternalName = (names: string) => names.split("\x01").find(name => external.has(name));
  return {
    findExternalName,
    findInFile(file, names) {
      for (const name of names.split("\x01")) {
        const node = nodeInFile.get(file + "\0" + name);
        if (node !== undefined) return node;
      }
      return undefined;
    },
    findInAnyFile(names) {
      const externalName = findExternalName(names);
      if (externalName !== undefined) return external.get(externalName);
      for (const name of names.split("\x01")) {
        const node = /^[lL]/.test(name) ? undefined : nodeByName.get(name);
        if (node !== undefined) return node;
      }
      return undefined;
    },
  };
}

function indexSymbols(
  { atoms, zeroSizeSymbols }: LinkMap,
  output: string[],
  { files, objects }: InputObjects,
): SymbolIndex {
  const nodeByAddress = new Map(atoms.map((atom, node) => [atom.address, node]));
  const nodeInFile = new Map<string, number>();
  const nodeByName = new Map<string, number>();
  atoms.forEach((atom, node) => {
    if (output[node] === stubsOutput && nodeInFile.has(atom.file + "\0" + atom.name)) return;
    nodeInFile.set(atom.file + "\0" + atom.name, node);
    if (!nodeByName.has(atom.name)) nodeByName.set(atom.name, node);
  });
  const aliases = new Map<number, [string, string][]>();
  const mergedStringFiles = new Map<number, number[]>();
  const symbolsWithoutBytes = new Set<string>();
  const namesWithoutBytes = new Set<string>();
  for (const symbol of zeroSizeSymbols) {
    const node = nodeByAddress.get(symbol.address);
    if (node === undefined) {
      symbolsWithoutBytes.add(symbol.file + "\0" + symbol.name);
      namesWithoutBytes.add(symbol.name);
      continue;
    }
    if (output[node] === cstringOutput) {
      const list = mergedStringFiles.get(node);
      if (list === undefined) mergedStringFiles.set(node, [symbol.file]);
      else list.push(symbol.file);
      continue;
    }
    if (!nodeInFile.has(symbol.file + "\0" + symbol.name)) nodeInFile.set(symbol.file + "\0" + symbol.name, node);
    if (!nodeByName.has(symbol.name)) nodeByName.set(symbol.name, node);
    const list = aliases.get(node);
    if (list === undefined) aliases.set(node, [[files.get(symbol.file) ?? "?", symbol.name]]);
    else list.push([files.get(symbol.file) ?? "?", symbol.name]);
  }
  const nodeInUnreadFile = new Map<string, number>();
  for (const symbol of [...atoms, ...zeroSizeSymbols]) {
    const node = objects.get(symbol.file) === undefined ? nodeInFile.get(symbol.file + "\0" + symbol.name) : undefined;
    if (node !== undefined) nodeInUnreadFile.set(symbol.name, node);
  }
  const external = new Map<string, number>();
  const fileOfNode = atoms.map(atom => atom.file);
  for (const [file, read] of objects) {
    for (const name of read?.externals ?? []) {
      let node = nodeInFile.get(file + "\0" + name);
      if (node === undefined && (node = nodeInUnreadFile.get(name)) !== undefined) {
        nodeInFile.set(file + "\0" + name, node);
        if (atoms[node]!.name === name) fileOfNode[node] = file;
      }
      if (node !== undefined && !external.has(name)) external.set(name, node);
    }
  }
  const lookup = createAtomLookup(nodeInFile, nodeByName, external);
  return { ...lookup, external, fileOfNode, aliases, mergedStringFiles, symbolsWithoutBytes, namesWithoutBytes };
}

function findUnreadInputs({ files, unreadReasons }: InputObjects, fileOfNode: number[]): GraphFailure[] {
  const filesWithNodes = new Set(fileOfNode);
  const failures: GraphFailure[] = [];
  for (const [file, reason] of unreadReasons) {
    const path = files.get(file)!;
    if (filesWithNodes.has(file) && !/\.(tbd|dylib)$/.test(path))
      failures.push({ kind: "UnreadInput", object: path, reason });
  }
  return failures;
}

function computePaddedSizes(atoms: MapSymbol[], output: string[], image: LinkedImage): number[] {
  const sizes = atoms.map(atom => atom.size);
  const isZeroFilled = (address: number, length: number) =>
    image.bytes(address, length)?.every(byte => byte === 0) === true;
  const segmentOf = (name: string | undefined) => name?.slice(0, name.indexOf(","));
  for (let node = 1; node < atoms.length; node++) {
    const end = atoms[node - 1]!.address + atoms[node - 1]!.size;
    const padding = atoms[node]!.address - end;
    if (
      padding <= 0 ||
      padding >= machOPageBytes ||
      segmentOf(output[node - 1]) !== segmentOf(output[node]) ||
      output[node - 1] === textOutput
    )
      continue;
    if (isZeroFilled(end, padding)) sizes[node - 1]! += padding;
  }
  atoms.forEach((atom, node) => {
    if (segmentOf(output[node]) === segmentOf(output[node + 1])) return;
    const end = atom.address + atom.size;
    const padding =
      Math.min(Math.ceil(end / machOPageBytes) * machOPageBytes, atoms[node + 1]?.address ?? Infinity) - end;
    if (padding > 0 && isZeroFilled(end, padding)) sizes[node]! += padding;
  });
  return sizes;
}

function indexStrings(
  atoms: MapSymbol[],
  output: string[],
  image: LinkedImage,
): { stringByText: Map<string, number>; stringHash: Map<number, number> } {
  const stringByText = new Map<string, number>();
  const stringHash = new Map<number, number>();
  atoms.forEach((atom, node) => {
    if (output[node] !== cstringOutput) return;
    const bytes = image.bytes(atom.address, atom.size - 1)!;
    stringByText.set(bytes.toString("latin1"), node);
    stringHash.set(node, Number(xxh3(bytes) & 0x7fffffffn));
  });
  return { stringByText, stringHash };
}

function indexLiteralCells(
  literals: OutputSection | undefined,
  placedNodes: PlacedNodes,
  image: LinkedImage,
): Map<string, number[]> {
  const cellsByValue = new Map<string, number[]>();
  if (literals === undefined) return cellsByValue;
  const firstCell = nodeAt(placedNodes, literals.address);
  for (const size of [4, 8, 16]) {
    for (let at = 0; at + size <= literals.size; at += size) {
      const bytes = image.bytes(literals.address + at, size)!.toString("hex");
      const cells = cellsByValue.get(bytes);
      if (cells === undefined) cellsByValue.set(bytes, [firstCell + at / 4]);
      else cells.push(firstCell + at / 4);
    }
  }
  return cellsByValue;
}

function connectReferences(
  count: number,
  { files, objects }: InputObjects,
  index: SymbolIndex,
  stringByText: Map<string, number>,
  cellsByValue: Map<string, number[]>,
): Connections {
  const { findInFile, findInAnyFile, symbolsWithoutBytes, namesWithoutBytes } = index;
  const successors: Set<number>[] = Array.from({ length: count }, () => new Set());
  const retained = new Set<number>();
  const liveWithoutReference = new Set<number>();
  const stringReferrers = new Map<number, Set<number>>();
  const failures: GraphFailure[] = [];
  let stringsNotFound = 0;
  const stringsNotFoundAt: string[] = [];
  let literalsNotFollowed = 0;
  let symbolsOutsideGraph = 0;
  const definedExternals = new Set<string>();
  for (const read of objects.values()) for (const name of read?.externals ?? []) definedExternals.add(name);
  const externalStrings = new Map<string, { text: string; file: number }>();
  for (const [file, read] of objects)
    for (const [name, text] of read?.textOfExternalName ?? []) externalStrings.set(name, { text, file });
  const connectAtom = (file: number, source: string, from: number, isLocal: boolean, names: string) => {
    const node = (isLocal ? findInFile(file, names) : undefined) ?? findInAnyFile(names);
    if (node !== undefined) {
      successors[from]!.add(node);
      return;
    }
    const hasNoBytes = (name: string) =>
      isLocal ? symbolsWithoutBytes.has(file + "\0" + name) : namesWithoutBytes.has(name);
    if (names.split("\x01").some(hasNoBytes)) symbolsOutsideGraph++;
    else if (isLocal || (definedExternals.has(names) && !externalStrings.has(names)))
      failures.push({ kind: "UnresolvedReference", object: files.get(file)!, section: source, target: names });
  };
  const addStringReferrer = (file: number, node: number) => {
    const referrers = stringReferrers.get(node);
    if (referrers === undefined) stringReferrers.set(node, new Set([file]));
    else referrers.add(file);
  };
  const connectString = (referrers: number[], source: string, from: number, text: string) => {
    const node = stringByText.get(text);
    if (node === undefined) {
      stringsNotFound++;
      stringsNotFoundAt.push(
        `${files.get(referrers[0]!)}: ${source}: ${JSON.stringify(text.slice(0, 80))} is not among the strings of the image`,
      );
      return;
    }
    successors[from]!.add(node);
    for (const file of referrers) addStringReferrer(file, node);
  };
  const connectLiteral = (from: number, value: string) => {
    const cells = cellsByValue.get(value);
    if (cells === undefined) literalsNotFollowed++;
    for (const first of cells ?? [])
      for (let cell = first; cell < first + value.length / 8; cell++) successors[from]!.add(cell);
  };
  for (const [file, read] of objects) {
    if (read === undefined) continue;
    stringsNotFound += read.unreadStrings;
    for (const place of read.unreadStringPlaces) stringsNotFoundAt.push(`${files.get(file)}: ${place}`);
    literalsNotFollowed += read.unreadLiterals;
    for (const name of read.retained) {
      const node = findInFile(file, name) ?? findInAnyFile(name);
      if (node !== undefined) retained.add(node);
    }
    for (const name of read.liveWithoutReference) {
      const node = findInFile(file, name);
      if (node !== undefined) liveWithoutReference.add(node);
    }
    for (const [source, targets] of read.references) {
      const from = findInFile(file, source);
      if (from === undefined) continue;
      for (const target of targets) {
        const value = target.slice(1);
        switch (target[0]) {
          case "L":
            connectAtom(file, source, from, true, value);
            break;
          case "G": {
            connectAtom(file, source, from, false, value);
            const externalString = externalStrings.get(value);
            if (externalString !== undefined)
              connectString([file, externalString.file], source, from, externalString.text);
            break;
          }
          case "S":
            connectString([file], source, from, value);
            break;
          case "W":
            connectLiteral(from, value);
            break;
          default:
            fail(`${files.get(file)}: ${source} has a reference of an unknown kind: ${target}`);
        }
      }
    }
  }
  return {
    successors,
    retained,
    liveWithoutReference,
    stringReferrers,
    failures,
    stringsNotFound,
    stringsNotFoundAt,
    literalsNotFollowed,
    symbolsOutsideGraph,
  };
}

function connectFixups(
  executable: string,
  placedNodes: PlacedNodes,
  fileOfNode: number[],
  successors: Set<number>[],
): number {
  let pointersOnlyInFixups = 0;
  for (const [at, target] of pointersInMachO(executable)) {
    const from = nodeAt(placedNodes, at);
    const to = nodeAt(placedNodes, target);
    if (
      from < 0 ||
      to < 0 ||
      from === to ||
      fileOfNode[from] === 0 ||
      fileOfNode[to] === 0 ||
      successors[from]!.has(to)
    )
      continue;
    successors[from]!.add(to);
    pointersOnlyInFixups++;
  }
  return pointersOnlyInFixups;
}

function connectAssemblyUnits(output: string[], successors: Set<number>[]): void {
  for (let node = 1; node < output.length; node++) {
    if (!isOneUnitOfAssembly(output[node]!) || output[node - 1] !== output[node]) continue;
    successors[node - 1]!.add(node);
    successors[node]!.add(node - 1);
  }
}

function findRoots(
  output: string[],
  objects: InputObjects["objects"],
  index: SymbolIndex,
  connections: Connections,
  stringNodes: Iterable<number>,
): { roots: Set<number>; stringsRetained: number } {
  const { fileOfNode, mergedStringFiles, external } = index;
  const { stringReferrers, stringsNotFound, literalsNotFollowed } = connections;
  const roots = new Set(connections.retained);
  output.forEach((name, node) => {
    if (name === literalOutput) {
      if (literalsNotFollowed > 0) roots.add(node);
      return;
    }
    const file = fileOfNode[node]!;
    if (
      file === 0 ||
      objects.get(file) === undefined ||
      (name.startsWith("__TEXT,__jsc_") && !isOneUnitOfAssembly(name))
    )
      roots.add(node);
  });
  let stringsRetained = 0;
  for (const node of stringNodes) {
    const isReferrer = (file: number) => stringReferrers.get(node)?.has(file) === true;
    if (stringsNotFound === 0 && isReferrer(fileOfNode[node]!) && (mergedStringFiles.get(node) ?? []).every(isReferrer))
      continue;
    roots.add(node);
    stringsRetained++;
  }
  const main = external.get("_main");
  if (main !== undefined) roots.add(main);
  return { roots, stringsRetained };
}

function findExportedNodes(exportedSymbols: string, external: Map<string, number>): Set<number> {
  const exported = new Set<number>();
  for (const line of readFileSync(exportedSymbols, "utf8").split("\n")) {
    const node = external.get(line.trim());
    if (node !== undefined) exported.add(node);
  }
  return exported;
}

function createResolver(
  files: Map<number, string>,
  { findInFile, findExternalName, external }: SymbolIndex,
): GraphReading["resolve"] {
  const fileByPath = new Map([...files].map(([file, path]) => [path, file]));
  return (object, reference) => {
    const file = fileByPath.get(object);
    if (file === undefined) return undefined;
    const names = reference.slice(1);
    const externalName = findExternalName(names);
    const node =
      (reference[0] === "L" ? findInFile(file, names) : undefined) ??
      (externalName === undefined ? undefined : external.get(externalName));
    if (node === undefined) return undefined;
    return { node, section: externalName === undefined ? file + "\0" + names : "X" + externalName };
  };
}

export function readMachOGraph(
  executable: string,
  mapPath: string,
  compiledFromBitcode: string[],
  exportedSymbols: string,
): GraphReading {
  const map = parseMap(mapPath);
  const { atoms } = map;
  const inputs = readObjects(map.files, compiledFromBitcode);
  const { files, objects } = inputs;
  const output = findOutputs(atoms, map.sections);
  const index = indexSymbols(map, output, inputs);
  const image = machOImage(executable);
  const placedNodes = {
    address: atoms.map(atom => atom.address),
    size: computePaddedSizes(atoms, output, image),
    placedCount: atoms.length,
  };
  const { stringByText, stringHash } = indexStrings(atoms, output, image);
  const cellsByValue = indexLiteralCells(map.literals, placedNodes, image);
  const connections = connectReferences(atoms.length, inputs, index, stringByText, cellsByValue);
  const { successors, stringsNotFound, literalsNotFollowed, symbolsOutsideGraph } = connections;
  const pointersOnlyInFixups = connectFixups(executable, placedNodes, index.fileOfNode, successors);
  connectAssemblyUnits(output, successors);
  const { roots, stringsRetained } = findRoots(output, objects, index, connections, stringHash.keys());
  const graph = createSectionGraph({
    format: "macho",
    isArm64: image.isArm64,
    ...placedNodes,
    alignment: atoms.map(() => 64),
    output,
    object: index.fileOfNode.map(file => files.get(file) ?? "?"),
    section: atoms.map(atom => atom.name),
    successors,
    roots,
    exported: findExportedNodes(exportedSymbols, index.external),
    liveWithoutReference: connections.liveWithoutReference,
    names: atoms.map(atom => [atom.name]),
    aliases: index.aliases,
    externalNames: new Set(index.external.keys()),
    stringHash,
  });
  const recordSections: RecordSection[] = [];
  for (const [file, read] of objects) {
    for (const { bytes, references } of read?.recordSections ?? [])
      recordSections.push({ object: files.get(file)!, bytes, references });
  }
  return {
    graph,
    recordSections,
    resolve: createResolver(files, index),
    failures: [...findUnreadInputs(inputs, index.fileOfNode), ...connections.failures],
    // One string that is not followed keeps every string of the image.
    remarks: connections.stringsNotFoundAt.map(place => `a string is not followed: ${place}`),
    statistics: {
      stringsFollowed: stringHash.size - stringsRetained,
      stringsRetained,
      stringsNotFound,
      literalsNotFollowed,
      pointersOnlyInFixups,
      symbolsOutsideGraph,
    },
  };
}
