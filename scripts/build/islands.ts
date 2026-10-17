#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

interface Door {
  feature: string;
  whenShut: "exit" | "return";
  pattern: RegExp;
}

interface Doors {
  features: { name: string; description: string }[];
  doors: Door[];
  conditions: { feature: string; kind: string; name: string }[];
  smallest: Map<string, number>;
}

interface Graph {
  address: number[];
  size: number[];
  output: string[];
  object: string[];
  section: string[];
  successors: number[][];
  roots: Set<number>;
  functionName: Map<number, string>;
  aliases: Map<number, [string, string][]>;
  externalNames: Set<string>;
  unreadObjects: string[];
}

const pageSize = 16384;
const tableRoom = 65536;
const smallestIsland = 4096;
const isCode = (output: string) => output === ".text" || output.startsWith(".text.");
const isMovable = (output: string) => isCode(output) || output === ".rodata";
const isOrdinary = (output: string) =>
  isMovable(output) || [".data", ".data.rel.ro", ".bss"].includes(output) || islandOutput.test(output);
const ignoredOutputs = /^\.(debug|gdb_index|symtab|strtab|comment|shstrtab|eh_frame|gcc_except_table|rela|tbss|tdata)/;
const islandOutput = /^\.bun_[xr]\.(\d+)$/;
const onlyForDebuggers = /^-Wl,--(gdb-index|compress-debug-sections=.*)$/;

const startedAt = performance.now();
let lapStartedAt = startedAt;
const laps: string[] = [];

function lap(name: string): void {
  const now = performance.now();
  laps.push(`${name} ${((now - lapStartedAt) / 1000).toFixed(1)} s`);
  lapStartedAt = now;
}

function fail(message: string): never {
  console.error(`islands: ${message}`);
  process.exit(1);
}

function readDoors(path: string): Doors {
  const result: Doors = { features: [], doors: [], conditions: [], smallest: new Map() };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const words = line.trim().split(/\s+/);
    if (words[0] === "feature") result.features.push({ name: words[1]!, description: words.slice(2).join(" ") });
    else if (words[0] === "when") result.conditions.push({ feature: words[1]!, kind: words[2]!, name: words[3]! });
    else if (words[0] === "smallest") result.smallest.set(words[1]!, Number(words[2]));
    else if (words[0] === "door") {
      if (words[2] !== "exit" && words[2] !== "return") fail(`${path}: a door exits or returns: ${line}`);
      result.doors.push({ feature: words[1]!, whenShut: words[2], pattern: new RegExp(words.slice(3).join(" ")) });
    }
  }
  const names = new Set(result.features.map(feature => feature.name));
  for (const { feature } of [...result.doors, ...result.conditions])
    if (!names.has(feature)) fail(`${path}: there is no feature ${feature}`);
  return result;
}

function readAt(fd: number, offset: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, offset + done);
    if (count === 0) fail("a file ended early");
    done += count;
  }
  return buffer;
}

function fixedName(data: Buffer, offset: number): string {
  return data.toString("latin1", offset, offset + 16).replace(/\0.*$/, "");
}

function stringAt(table: Buffer, offset: number): string {
  return table.toString("latin1", offset, table.indexOf(0, offset));
}

interface SectionHeader {
  name: string;
  nameOffset: number;
  type: number;
  flags: number;
  address: number;
  offset: number;
  size: number;
  link: number;
  info: number;
}

interface ElfFile {
  fd: number;
  sectionHeadersOffset: number;
  namesIndex: number;
  sections: SectionHeader[];
}

function openElf(path: string, mode: "r" | "r+"): ElfFile | undefined {
  const fd = openSync(path, mode);
  if (fstatSync(fd).size < 64 || readAt(fd, 0, 4).readUInt32BE(0) !== 0x7f454c46) {
    closeSync(fd);
    return undefined;
  }
  const header = readAt(fd, 0, 64);
  const sectionHeadersOffset = Number(header.readBigUInt64LE(0x28));
  let count = header.readUInt16LE(0x3c);
  let namesIndex = header.readUInt16LE(0x3e);
  if (count === 0 || namesIndex === 0xffff) {
    const first = readAt(fd, sectionHeadersOffset, 64);
    if (count === 0) count = Number(first.readBigUInt64LE(0x20));
    if (namesIndex === 0xffff) namesIndex = first.readUInt32LE(0x28);
  }
  const table = readAt(fd, sectionHeadersOffset, count * 64);
  const sections: SectionHeader[] = [];
  for (let at = 0; at < table.length; at += 64) {
    sections.push({
      name: "",
      nameOffset: table.readUInt32LE(at),
      type: table.readUInt32LE(at + 4),
      flags: Number(table.readBigUInt64LE(at + 8)),
      address: Number(table.readBigUInt64LE(at + 16)),
      offset: Number(table.readBigUInt64LE(at + 24)),
      size: Number(table.readBigUInt64LE(at + 32)),
      link: table.readUInt32LE(at + 40),
      info: table.readUInt32LE(at + 44),
    });
  }
  const names = readAt(fd, sections[namesIndex]!.offset, sections[namesIndex]!.size);
  for (const section of sections) section.name = stringAt(names, section.nameOffset);
  return { fd, sectionHeadersOffset, namesIndex, sections };
}

interface ObjectReferences {
  references: Map<string, Set<string>>;
  definitions: [string, string][];
}

function readObject(path: string, liveSections: Set<string>): ObjectReferences | undefined {
  if (!existsSync(path)) return undefined;
  const elf = openElf(path, "r");
  if (elf === undefined) return undefined;
  const { fd, sections } = elf;
  const result: ObjectReferences = { references: new Map(), definitions: [] };
  const symbolTable = sections.find(section => section.type === 2);
  if (symbolTable !== undefined) {
    const symbols = readAt(fd, symbolTable.offset, symbolTable.size);
    const strings = readAt(fd, sections[symbolTable.link]!.offset, sections[symbolTable.link]!.size);
    const extended = sections.find(section => section.type === 18);
    const extendedIndexes = extended && readAt(fd, extended.offset, extended.size);
    const sectionOf = (index: number) => {
      const section = symbols.readUInt16LE(index * 24 + 6);
      return section === 0xffff && extendedIndexes ? extendedIndexes.readUInt32LE(index * 4) : section;
    };
    const count = symbols.length / 24;
    for (let index = 0; index < count; index++) {
      const info = symbols[index * 24 + 4]!;
      const raw = symbols.readUInt16LE(index * 24 + 6);
      if (info >> 4 === 0 || raw === 0 || (info & 15) === 6 || (raw >= 0xff00 && raw < 0xffff)) continue;
      result.definitions.push([stringAt(strings, symbols.readUInt32LE(index * 24)), sections[sectionOf(index)]!.name]);
    }
    const targets: (string | undefined)[] = new Array(count);
    const targetOf = (index: number) => {
      let target = targets[index];
      if (target === undefined) {
        const info = symbols[index * 24 + 4]!;
        const section = sectionOf(index);
        if ((info & 15) === 6) target = "";
        else if (info >> 4 === 0)
          target = section > 0 && section < sections.length ? "L" + sections[section]!.name : "";
        else target = "G" + stringAt(strings, symbols.readUInt32LE(index * 24));
        targets[index] = target;
      }
      return target;
    };
    for (const section of sections) {
      if (section.type !== 4) continue;
      const source = sections[section.info]!.name;
      if (!liveSections.has(source)) continue;
      let set = result.references.get(source);
      if (set === undefined) result.references.set(source, (set = new Set()));
      const relocations = readAt(fd, section.offset, section.size);
      for (let at = 0; at < relocations.length; at += 24) {
        const target = targetOf(relocations.readUInt32LE(at + 12));
        if (target !== "") set.add(target);
      }
    }
  }
  closeSync(fd);
  return result;
}

function foldedSections(log: string): Map<string, string> {
  const folded = new Map<string, string>();
  let selected = "";
  for (const line of log.split("\n")) {
    const match = /^(?:ld\.lld: )?(selected|  removing identical) section (.*):\(([^()]*)\)\s*$/.exec(line);
    if (match === null) continue;
    const key = match[2] + "\0" + match[3];
    if (match[1] === "selected") selected = key;
    else folded.set(key, selected);
  }
  return folded;
}

function readGraph(executable: string, mapPath: string, log: string): Graph {
  const found: { address: number; size: number; output: string; object: string; section: string }[] = [];
  let output = "";
  for (const line of readFileSync(mapPath, "latin1").split("\n")) {
    const match = /^\s*([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)\s+\d+ ( *)(\S.*)$/.exec(line);
    if (match === null) continue;
    if (match[3]!.length === 0) output = match[4]!.trim();
    else if (match[3]!.length === 8 && !ignoredOutputs.test(output)) {
      const input = /^(.*):\(([^()]*)\)\s*$/.exec(match[4]!);
      const size = parseInt(match[2]!, 16);
      if (input !== null && size > 0) {
        found.push({ address: parseInt(match[1]!, 16), size, output, object: input[1]!, section: input[2]! });
      }
    }
  }
  found.sort((a, b) => a.address - b.address);
  const graph: Graph = {
    address: found.map(node => node.address),
    size: found.map(node => node.size),
    output: found.map(node => node.output),
    object: found.map(node => node.object),
    section: found.map(node => node.section),
    successors: [],
    roots: new Set(),
    functionName: new Map(),
    aliases: new Map(),
    externalNames: new Set(),
    unreadObjects: [],
  };
  const count = found.length;
  const nodeAt = (address: number) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (graph.address[middle]! <= address) low = middle + 1;
      else high = middle;
    }
    return low > 0 && address < graph.address[low - 1]! + graph.size[low - 1]! ? low - 1 : -1;
  };
  const nodesOf = new Map<string, number[]>();
  const liveSections = new Map<string, Set<string>>();
  for (let node = 0; node < count; node++) {
    const key = graph.object[node] + "\0" + graph.section[node];
    const list = nodesOf.get(key);
    if (list === undefined) nodesOf.set(key, [node]);
    else list.push(node);
    let live = liveSections.get(graph.object[node]!);
    if (live === undefined) liveSections.set(graph.object[node]!, (live = new Set()));
    live.add(graph.section[node]!);
    const name = functionOfSection(graph.section[node]!);
    if (name !== undefined && isCode(graph.output[node]!)) graph.functionName.set(node, name);
  }
  const folded = foldedSections(log);
  const placed = (key: string) => nodesOf.get(key)?.[0] ?? nodesOf.get(folded.get(key) ?? "")?.[0];
  for (const [removed, selected] of folded) {
    const node = nodesOf.get(selected)?.[0];
    const [object, section] = removed.split("\0") as [string, string];
    const name = functionOfSection(section);
    if (node === undefined || name === undefined) continue;
    const aliases = graph.aliases.get(node);
    if (aliases === undefined) graph.aliases.set(node, [[object, "_" + name]]);
    else aliases.push([object, "_" + name]);
  }
  const objects = new Map<string, ObjectReferences | undefined>();
  const defined = new Map<string, string[]>();
  for (const [object, live] of liveSections) {
    if (object === "<internal>") continue;
    const read = readObject(object, live);
    objects.set(object, read);
    if (read === undefined) graph.unreadObjects.push(object);
    for (const [name, section] of read?.definitions ?? []) {
      const list = defined.get(name);
      if (list === undefined) defined.set(name, [object + "\0" + section]);
      else list.push(object + "\0" + section);
    }
  }
  const resolveGlobal = (name: string) => {
    for (const key of defined.get(name) ?? []) {
      const node = placed(key);
      if (node !== undefined) return node;
    }
    return undefined;
  };
  const successors: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (const [object, read] of objects) {
    if (read === undefined) continue;
    for (const [source, targets] of read.references) {
      const from = successors[nodesOf.get(object + "\0" + source)![0]!]!;
      for (const target of targets) {
        const node = target[0] === "L" ? placed(object + "\0" + target.slice(1)) : resolveGlobal(target.slice(1));
        if (node !== undefined) from.add(node);
      }
    }
  }
  for (const nodes of nodesOf.values()) {
    for (const node of nodes.slice(1)) {
      successors[nodes[0]!]!.add(node);
      successors[node]!.add(nodes[0]!);
    }
  }
  graph.successors = successors.map((set, node) => (set.delete(node), [...set]));
  for (let node = 0; node < count; node++) {
    if (
      !isOrdinary(graph.output[node]!) ||
      (graph.object[node] !== "<internal>" && objects.get(graph.object[node]!) === undefined)
    ) {
      graph.roots.add(node);
    }
  }
  const elf = openElf(executable, "r") ?? fail(`${executable} is not an ELF file`);
  const entry = nodeAt(Number(readAt(elf.fd, 0x18, 8).readBigUInt64LE(0)));
  if (entry >= 0) graph.roots.add(entry);
  const dynamic = elf.sections.find(section => section.type === 11);
  if (dynamic !== undefined) {
    const symbols = readAt(elf.fd, dynamic.offset, dynamic.size);
    for (let at = 0; at < symbols.length; at += 24) {
      const node = symbols.readUInt16LE(at + 6) !== 0 ? nodeAt(Number(symbols.readBigUInt64LE(at + 8))) : -1;
      if (node >= 0) graph.roots.add(node);
    }
  }
  closeSync(elf.fd);
  return graph;
}

interface MachOReferences {
  references: Map<string, Set<string>>;
  externals: string[];
  kept: string[];
}

function readMachOObject(path: string): MachOReferences | undefined {
  if (!existsSync(path)) return undefined;
  const data = readFileSync(path);
  if (data.length < 32 || data.readUInt32LE(0) !== 0xfeedfacf) return undefined;
  const sectionsAreWhole = (data.readUInt32LE(24) & 0x2000) === 0;
  const sections: {
    name: string;
    segment: string;
    address: number;
    size: number;
    offset: number;
    relocations: number;
    count: number;
    flags: number;
  }[] = [];
  let symbolTable: { offset: number; count: number; strings: number } | undefined;
  let at = 32;
  for (let command = data.readUInt32LE(16); command > 0; command--) {
    const kind = data.readUInt32LE(at);
    if (kind === 0x19) {
      for (let index = 0; index < data.readUInt32LE(at + 64); index++) {
        const section = at + 72 + index * 80;
        sections.push({
          name: fixedName(data, section),
          segment: fixedName(data, section + 16),
          address: Number(data.readBigUInt64LE(section + 32)),
          size: Number(data.readBigUInt64LE(section + 40)),
          offset: data.readUInt32LE(section + 48),
          relocations: data.readUInt32LE(section + 56),
          count: data.readUInt32LE(section + 60),
          flags: data.readUInt32LE(section + 64),
        });
      }
    } else if (kind === 2) {
      symbolTable = {
        offset: data.readUInt32LE(at + 8),
        count: data.readUInt32LE(at + 12),
        strings: data.readUInt32LE(at + 16),
      };
    }
    at += data.readUInt32LE(at + 4);
  }
  const result: MachOReferences = { references: new Map(), externals: [], kept: [] };
  if (symbolTable === undefined) return result;
  const symbols: { name: string; type: number; section: number; value: number }[] = [];
  const namesAt: Map<number, string>[] = sections.map(() => new Map());
  for (let index = 0; index < symbolTable.count; index++) {
    const entry = symbolTable.offset + index * 16;
    const symbol = {
      name: stringAt(data, symbolTable.strings + data.readUInt32LE(entry)),
      type: data[entry + 4]!,
      section: data[entry + 5]!,
      value: Number(data.readBigUInt64LE(entry + 8)),
    };
    symbols.push(symbol);
    if ((symbol.type & 0xe0) !== 0 || (symbol.type & 0x0e) !== 0x0e) continue;
    const description = data.readUInt16LE(entry + 6);
    if ((description & 0x0200) === 0) {
      const names = namesAt[symbol.section - 1]!;
      names.set(symbol.value, names.has(symbol.value) ? names.get(symbol.value) + "\x01" + symbol.name : symbol.name);
    }
    if (symbol.type & 1) result.externals.push(symbol.name);
    if (description & 0x20) result.kept.push(symbol.name);
  }
  const atoms = namesAt.map(names => [...names].sort((a, b) => a[0] - b[0]));
  const atomAt = (section: number, address: number) => {
    const list = atoms[section - 1];
    if (list === undefined) return undefined;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]![0] <= address) low = middle + 1;
      else high = middle;
    }
    return low > 0 ? list[low - 1]![1] : undefined;
  };
  const refer = (from: string, to: string) => {
    const set = result.references.get(from);
    if (set === undefined) result.references.set(from, new Set([to]));
    else set.add(to);
  };
  if (sectionsAreWhole) {
    for (const list of atoms) {
      for (let index = 1; index < list.length; index++) {
        refer(list[index - 1]![1], "L" + list[index]![1]);
        refer(list[index]![1], "L" + list[index - 1]![1]);
      }
    }
  }
  sections.forEach((section, index) => {
    if (section.segment === "__DWARF" || section.segment === "__LD") return;
    if (["__eh_frame", "__gcc_except_tab", "__compact_unwind"].includes(section.name)) return;
    const runsBeforeMain = ["__mod_init_func", "__init_offsets", "__mod_term_func", "__thread_vars"].includes(
      section.name,
    );
    if (runsBeforeMain || section.flags & 0x10000000) for (const [, name] of atoms[index]!) result.kept.push(name);
    for (let entry = section.relocations; entry < section.relocations + section.count * 8; entry += 8) {
      const word = data.readUInt32LE(entry + 4);
      const type = word >>> 28;
      if (type === 10) continue;
      const from = atomAt(index + 1, section.address + data.readInt32LE(entry));
      if (from === undefined) continue;
      if ((word >>> 27) & 1) {
        const target = symbols[word & 0xffffff]!;
        if ((target.type & 0x0e) === 0x0e) refer(from, "L" + (atomAt(target.section, target.value) ?? target.name));
        else refer(from, "G" + target.name);
      } else if (type === 0 && ((word >>> 25) & 3) === 3) {
        const address = Number(data.readBigUInt64LE(section.offset + data.readInt32LE(entry)));
        const inSection = sections.findIndex(other => other.address <= address && address < other.address + other.size);
        const target = atomAt(inSection + 1, address);
        if (target !== undefined) refer(from, "L" + target);
      }
    }
  });
  return result;
}

function readMachOGraph(mapPath: string, exportedSymbols: string): Graph {
  const files = new Map<number, string>();
  const sections: { address: number; size: number; name: string }[] = [];
  const found: { address: number; size: number; file: number; name: string }[] = [];
  const folded: { address: number; file: number; name: string }[] = [];
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
      if (symbol.size > 0) found.push(symbol);
      else folded.push(symbol);
    }
  }
  found.sort((a, b) => a.address - b.address);
  const outputOf = (address: number) =>
    sections.find(section => section.address <= address && address < section.address + section.size)?.name ?? "?";
  const graph: Graph = {
    address: found.map(node => node.address),
    size: found.map(node => node.size),
    output: [],
    object: found.map(node => files.get(node.file) ?? "?"),
    section: found.map(node => node.name),
    successors: [],
    roots: new Set(),
    functionName: new Map(),
    aliases: new Map(),
    externalNames: new Set(),
    unreadObjects: [],
  };
  let section = sections[0];
  graph.output = found.map(node => {
    if (section === undefined || node.address < section.address || node.address >= section.address + section.size) {
      section = sections.find(other => other.address <= node.address && node.address < other.address + other.size);
    }
    return section?.name ?? outputOf(node.address);
  });
  const atAddress = new Map(found.map((node, index) => [node.address, index]));
  const local = new Map<string, number>();
  const byName = new Map<string, number>();
  found.forEach((node, index) => {
    local.set(node.file + "\0" + node.name, index);
    if (!byName.has(node.name)) byName.set(node.name, index);
    if (graph.output[index] === "__TEXT,__text") graph.functionName.set(index, node.name.replace(/^_/, ""));
  });
  for (const symbol of folded) {
    const node = atAddress.get(symbol.address);
    if (node === undefined) continue;
    if (!local.has(symbol.file + "\0" + symbol.name)) local.set(symbol.file + "\0" + symbol.name, node);
    if (!byName.has(symbol.name)) byName.set(symbol.name, node);
    const list = graph.aliases.get(node);
    if (list === undefined) graph.aliases.set(node, [[files.get(symbol.file) ?? "?", symbol.name]]);
    else list.push([files.get(symbol.file) ?? "?", symbol.name]);
  }
  const objects = new Map<number, MachOReferences | undefined>();
  const external = new Map<string, number>();
  for (const [file, path] of files) {
    if (file === 0) continue;
    const read = readMachOObject(path);
    objects.set(file, read);
    if (read === undefined) graph.unreadObjects.push(path);
    for (const name of read?.externals ?? []) {
      const node = local.get(file + "\0" + name);
      if (node !== undefined && !external.has(name)) external.set(name, node);
    }
  }
  graph.externalNames = new Set(external.keys());
  const here = (file: number, names: string) => {
    for (const name of names.split("\x01")) {
      const node = local.get(file + "\0" + name);
      if (node !== undefined) return node;
    }
    return undefined;
  };
  const anywhere = (names: string) => {
    for (const name of names.split("\x01")) {
      const node = external.get(name) ?? (/^[lL]/.test(name) ? undefined : byName.get(name));
      if (node !== undefined) return node;
    }
    return undefined;
  };
  const successors: Set<number>[] = found.map(() => new Set());
  for (const [file, read] of objects) {
    if (read === undefined) continue;
    for (const name of read.kept) {
      const node = here(file, name);
      if (node !== undefined) graph.roots.add(node);
    }
    for (const [source, targets] of read.references) {
      const from = here(file, source);
      if (from === undefined) continue;
      for (const target of targets) {
        const node = (target[0] === "L" ? here(file, target.slice(1)) : undefined) ?? anywhere(target.slice(1));
        if (node !== undefined && node !== from) successors[from]!.add(node);
      }
    }
  }
  graph.successors = successors.map(set => [...set]);
  found.forEach((node, index) => {
    if (node.file === 0 || objects.get(node.file) === undefined) graph.roots.add(index);
  });
  for (const name of [
    "_main",
    ...readFileSync(exportedSymbols, "utf8")
      .split("\n")
      .map(line => line.trim()),
  ]) {
    const node = external.get(name);
    if (node !== undefined) graph.roots.add(node);
  }
  return graph;
}

function reach(graph: Graph, from: Iterable<number>, doors: Map<number, Door>): Set<number> {
  const seen = new Set(from);
  const stack = [...seen];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (doors.has(node)) continue;
    for (const next of graph.successors[node]!) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

interface Analysis {
  doors: Map<number, Door>;
  plainName: Map<number, string>;
  core: Set<number>;
  neededBy: Map<number, string>;
  unexplained: number;
  foldedOpen: number;
}

function demangle(demangler: string, names: string[]): string[] {
  const demangled = spawnSync(demangler, [], { input: names.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 30 });
  if (demangled.status !== 0) fail(`${demangler} failed`);
  const lines = demangled.stdout.split("\n");
  return names.map((_, index) => lines[index]!.replace(/ \(\.llvm\.\d+\)$/, ""));
}

function functionOfSection(section: string): string | undefined {
  return /^\.text\.(?:unlikely\.|hot\.|startup\.|exit\.)?(.+)$/.exec(section)?.[1];
}

function foldedDoors(log: string, declared: Doors, demangler: string): string[] {
  const names = [...foldedSections(log).keys()].flatMap(key => functionOfSection(key.split("\0")[1]!) ?? []);
  const plain = demangle(demangler, names);
  return names.filter((_, index) => declared.doors.some(door => door.pattern.test(plain[index]!)));
}

function analyze(graph: Graph, declared: Doors, demangler: string, foldedAway: string[]): Analysis {
  const nodes = [...graph.functionName.keys()];
  const plain = demangle(
    demangler,
    nodes.map(node => graph.functionName.get(node)!),
  );
  const plainName = new Map(nodes.map((node, index) => [node, plain[index]!]));
  const doors = new Map<number, Door>();
  const matched = new Set<Door>();
  for (const [node, name] of plainName) {
    const door = declared.doors.find(door => door.pattern.test(name));
    if (door !== undefined) {
      doors.set(node, door);
      matched.add(door);
    }
  }
  for (const name of demangle(demangler, foldedAway)) {
    for (const door of declared.doors) if (door.pattern.test(name)) matched.add(door);
  }
  for (const door of declared.doors) {
    if (!matched.has(door) && !declared.smallest.has(door.feature))
      fail(`no function matches the door ${door.pattern.source}`);
  }
  const folded = [...graph.aliases].filter(([node]) => doors.has(node));
  const plainAliases = demangle(
    demangler,
    folded.flatMap(([, aliases]) => aliases.map(([, name]) => name.replace(/^_/, ""))),
  );
  let foldedOpen = 0;
  let aliasAt = 0;
  for (const [node, aliases] of folded) {
    const names = plainAliases.slice(aliasAt, (aliasAt += aliases.length));
    const feature = doors.get(node)!.feature;
    if (names.every(name => declared.doors.find(door => door.pattern.test(name))?.feature === feature)) continue;
    doors.delete(node);
    foldedOpen++;
  }
  const explained = reach(graph, graph.roots, new Map());
  let unexplained = 0;
  for (let node = 0; node < graph.address.length; node++) {
    if (explained.has(node)) continue;
    graph.roots.add(node);
    unexplained += graph.size[node]!;
  }
  const core = reach(graph, graph.roots, doors);
  const neededBy = new Map<number, string>();
  for (const { name } of declared.features) {
    const behind: number[] = [];
    for (const [node, door] of doors) if (door.feature === name) behind.push(...graph.successors[node]!);
    for (const node of reach(graph, behind, doors)) {
      if (!core.has(node)) neededBy.set(node, neededBy.has(node) ? neededBy.get(node) + "," + name : name);
    }
  }
  return { doors, plainName, core, neededBy, unexplained, foldedOpen };
}

function staysAsDoor(analysis: Analysis, node: number): boolean {
  const door = analysis.doors.get(node);
  return door !== undefined && analysis.neededBy.get(node) !== door.feature;
}

function renameSections(object: string, islandOf: Map<string, number>, copy: string): void {
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(object, copy);
  const elf = openElf(copy, "r+") ?? fail(`${object} is not an ELF file`);
  const names = elf.sections[elf.namesIndex]!;
  const added = new Map<string, number>();
  let extra = "";
  elf.sections.forEach((section, index) => {
    const island = islandOf.get(section.name);
    const isLoadedAndReadOnly = section.type === 1 && (section.flags & 2) !== 0 && (section.flags & 0x11) === 0;
    if (island === undefined || !isLoadedAndReadOnly) return;
    const name = `${section.flags & 4 ? ".bun_x." : ".bun_r."}${island}`;
    if (!added.has(name)) {
      added.set(name, names.size + extra.length);
      extra += name + "\0";
    }
    const field = Buffer.alloc(4);
    field.writeUInt32LE(added.get(name)!);
    writeSync(elf.fd, field, 0, 4, elf.sectionHeadersOffset + index * 64);
  });
  const end = Math.ceil(fstatSync(elf.fd).size / 8) * 8;
  const table = Buffer.concat([readAt(elf.fd, names.offset, names.size), Buffer.from(extra, "latin1")]);
  writeSync(elf.fd, table, 0, table.length, end);
  const place = Buffer.alloc(16);
  place.writeBigUInt64LE(BigInt(end), 0);
  place.writeBigUInt64LE(BigInt(table.length), 8);
  writeSync(elf.fd, place, 0, 16, elf.sectionHeadersOffset + elf.namesIndex * 64 + 24);
  closeSync(elf.fd);
}

function isBitcode(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, "r");
  const magic = fstatSync(fd).size >= 4 ? readAt(fd, 0, 4).readUInt32BE(0) : 0;
  closeSync(fd);
  return magic === 0x4243c0de || magic === 0xdec0170b;
}

function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(2) + " MB";
}

interface Link {
  executable: string;
  map: string;
  log: string;
}

interface Linker {
  work: string;
  output: string;
  declared: Doors;
  demangler: string;
  command: string[];
  assemble(name: string, text: string): string;
  link(
    name: string,
    rewrite: (path: string) => string | undefined,
    first: string[],
    last: string[],
    runs?: boolean,
    without?: RegExp,
  ): Link;
}

function tableOf(
  declared: Doors,
  stub: number,
  islands: { start: number; end: number; features: string }[],
  doors: { address: number; size: number; door: Door; name: string }[],
): string {
  const hex = (value: number) => value.toString(16);
  const table =
    `bun-islands 1\nstub ${hex(stub)}\n` +
    declared.features.map(feature => `feature ${feature.name} ${feature.description}\n`).join("") +
    declared.conditions.map(({ feature, kind, name }) => `when ${feature} ${kind} ${name}\n`).join("") +
    [...islands]
      .sort((a, b) => a.start - b.start)
      .map(island => `island ${hex(island.start)} ${hex(island.end)} ${island.features}\n`)
      .join("") +
    doors
      .map(
        ({ address, size, door, name }) =>
          `door ${hex(address)} ${hex(size)} ${door.feature} ${door.whenShut} ${name.slice(0, 60)}\n`,
      )
      .join("");
  if (table.length > tableRoom) fail(`the table takes ${table.length} bytes and there is room for ${tableRoom}`);
  return table;
}

function listedDoors(
  graph: Graph,
  check: Analysis,
  work: string,
  featuresOfIslandAt: (node: number) => string | undefined,
) {
  const listed: { address: number; size: number; door: Door; name: string }[] = [];
  const namedBy = new Map<number, number[]>();
  for (const node of check.core) {
    if (check.doors.has(node)) continue;
    for (const next of graph.successors[node]!) {
      if (!check.doors.has(next)) continue;
      const list = namedBy.get(next);
      if (list === undefined) namedBy.set(next, [node]);
      else list.push(node);
    }
  }
  const spell = (node: number) =>
    check.plainName.get(node) ??
    `${graph.object[node]!.slice(graph.object[node]!.lastIndexOf("/") + 1)}:${graph.section[node]}`;
  const review: string[] = [];
  for (const [node, door] of check.doors) {
    if (featuresOfIslandAt(node) === door.feature) continue;
    if (door.whenShut === "exit" && graph.successors[node]!.every(next => check.core.has(next))) continue;
    const name = check.plainName.get(node)!;
    if (graph.size[node]! < (door.whenShut === "exit" ? 12 : 8))
      fail(`the door ${name} has ${graph.size[node]} bytes: too few to be shut`);
    review.push(
      `${listed.length} ${door.feature} ${graph.size[node]} ${name}\n` +
        [...new Set((namedBy.get(node) ?? []).map(spell))].map(by => `    ${by}\n`).join(""),
    );
    listed.push({ address: graph.address[node]!, size: graph.size[node]!, door, name });
  }
  writeFileSync(join(work, "doors.txt"), review.join(""));
  return listed;
}

function islandsBySize(graph: Graph, analysis: Analysis, declared: Doors, isMovable: (output: string) => boolean) {
  const bytesOf = new Map<string, number>();
  for (const [node, features] of analysis.neededBy) {
    if (isMovable(graph.output[node]!)) bytesOf.set(features, (bytesOf.get(features) ?? 0) + graph.size[node]!);
  }
  const rankOf = new Map(declared.features.map((feature, index) => [feature.name, index]));
  const rank = (features: string) => Math.max(...features.split(",").map(feature => rankOf.get(feature)!));
  const islands = [...bytesOf.keys()]
    .filter(features => bytesOf.get(features)! >= smallestIsland)
    .sort((a, b) => rank(a) - rank(b) || bytesOf.get(b)! - bytesOf.get(a)!);
  if (islands.length === 0) {
    fail(
      `nothing lies behind the ${analysis.doors.size} doors: ${graph.address.length} sections, ` +
        `${graph.successors.reduce((sum, list) => sum + list.length, 0)} references, ${graph.roots.size} roots, ` +
        `${megabytes(analysis.unexplained)} that nothing names, ${graph.unreadObjects.length} inputs that could not be read` +
        graph.unreadObjects
          .slice(0, 5)
          .map(object => `\n  ${object}`)
          .join(""),
    );
  }
  for (const [feature, smallest] of declared.smallest) {
    const bytes = islands
      .filter(features => features.split(",").includes(feature))
      .reduce((sum, features) => sum + bytesOf.get(features)!, 0);
    if (bytes < smallest)
      fail(
        `${megabytes(bytes)} can go with ${feature}, which is to be at least ${megabytes(smallest)}: something that stays has begun to name the rest`,
      );
  }
  return { islands, bytesOf, numberOf: new Map(islands.map((features, index) => [features, index + 1])) };
}

function report(doors: number, islands: string[], bytesOf: Map<string, number>, held: number): void {
  console.log(
    `${doors} doors, ${islands.length} islands of ${pageSize} byte pages, ${megabytes(held)}: ` +
      islands.map(features => `${features} ${megabytes(bytesOf.get(features)!)}`).join(", "),
  );
  console.log(`islands took ${((performance.now() - startedAt) / 1000).toFixed(1)} s: ${laps.join(", ")}`);
}

function linkElf({ work, output, declared, demangler, assemble, link }: Linker): void {
  const support = assemble(
    "room.s",
    `.section .note.bun,"aR",@note\n.p2align 3\n.long 4, 3584, 1\n.asciz "Bun"\n.zero 3584\n` +
      `.section .bun_islands,"aR",@progbits\n.zero ${tableRoom}\n` +
      `.section .rodata.Bun__trimmedFeatures,"a",@progbits\n.globl Bun__trimmedFeatures\nBun__trimmedFeatures:\n` +
      declared.features.map(feature => `.asciz ${JSON.stringify(feature.description)}\n`).join(""),
  );
  const always = ["-Wl,-u,Bun__trimmedOut", "-Wl,--print-icf-sections"];
  const inputDirectories = new Set([work]);
  const compiledAtLinkTime = () =>
    [...inputDirectories].flatMap(directory =>
      readdirSync(directory)
        .filter(name => name.startsWith("first.lto."))
        .map(name => join(directory, name)),
    );
  link("listing", path => (inputDirectories.add(dirname(path)), undefined), [], [], false);
  for (const stale of compiledAtLinkTime()) rmSync(stale);
  const first = link(
    "first",
    path => path,
    [support],
    [...always, "-Wl,--save-temps=prelink", "-Wl,--strip-debug"],
    true,
    onlyForDebuggers,
  );
  lap("first link");
  const empty = compiledAtLinkTime().filter(object => statSync(object).size === 0);
  if (empty.length > 0) {
    fail(
      `the linker kept ${empty.length} empty files for what it compiled from bitcode: it does so when it has a ThinLTO cache; link without one`,
    );
  }
  const graph = readGraph(first.executable, first.map, first.log);
  lap("graph");
  const foldedAway = foldedDoors(first.log, declared, demangler);
  const analysis = analyze(graph, declared, demangler, foldedAway);
  const keptApart = [...foldedAway, ...[...analysis.doors.keys()].map(node => graph.functionName.get(node)!)];
  const { islands, bytesOf, numberOf } = islandsBySize(graph, analysis, declared, isMovable);

  const islandOf = new Map<string, Map<string, number>>();
  for (let node = 0; node < graph.address.length; node++) {
    if (graph.object[node] === "<internal>" || !isMovable(graph.output[node]!)) continue;
    let sections = islandOf.get(graph.object[node]!);
    if (sections === undefined) islandOf.set(graph.object[node]!, (sections = new Map()));
    const island = staysAsDoor(analysis, node) ? 0 : (numberOf.get(analysis.neededBy.get(node) ?? "") ?? 0);
    const before = sections.get(graph.section[node]!);
    sections.set(graph.section[node]!, before === undefined || before === island ? island : 0);
  }
  for (const [removed, selected] of foldedSections(first.log)) {
    const [object, section] = removed.split("\0") as [string, string];
    const [selectedObject, selectedSection] = selected.split("\0") as [string, string];
    const island = islandOf.get(selectedObject)?.get(selectedSection) ?? 0;
    if (island === 0) continue;
    let sections = islandOf.get(object);
    if (sections === undefined) islandOf.set(object, (sections = new Map()));
    if (!sections.has(section)) sections.set(section, island);
  }
  const renamed = new Map<string, string>();
  for (const [object, sections] of islandOf) {
    if (![...sections.values()].some(island => island !== 0) || !existsSync(object)) continue;
    for (const [section, island] of sections) if (island === 0) sections.delete(section);
    const copy = join(work, "renamed", isAbsolute(object) ? object.slice(1) : object);
    renameSections(object, sections, copy);
    renamed.set(object, copy);
  }
  lap("plan and renaming");

  const edge = (begins: boolean) =>
    islands
      .map((_, index) => {
        const alignment = index === (begins ? 0 : islands.length - 1) ? ".p2align 14\n" : "";
        return (
          `.section .bun_x.${index + 1},"axR",@progbits\n${alignment}${begins ? ".zero 16, 0xcc\n" : ""}` +
          `.section .bun_r.${index + 1},"aR",@progbits\n${alignment}${begins ? ".zero 16\n" : ""}`
        );
      })
      .join("");
  const second = link(
    "second",
    path => (isBitcode(path) ? undefined : (renamed.get(path) ?? path)),
    [support, assemble("begin.s", edge(true)), ...compiledAtLinkTime().map(object => renamed.get(object) ?? object)],
    [assemble("end.s", edge(false)), ...always, ...keptApart.map(name => "-Wl,--keep-unique=" + name)],
  );
  lap("second link");

  const laidOut = readGraph(second.executable, second.map, second.log);
  const check = analyze(laidOut, declared, demangler, keptApart);
  if (check.foldedOpen > 0) console.log(`${check.foldedOpen} doors were folded into other functions and stay open`);
  let faults = 0;
  for (let node = 0; node < laidOut.address.length; node++) {
    const island = islandOutput.exec(laidOut.output[node]!);
    if (island === null) continue;
    const features = islands[Number(island[1]) - 1]!;
    if (laidOut.size[node]! <= 16 && laidOut.object[node]!.startsWith(work)) continue;
    const needed = check.core.has(node) ? ["what always stays"] : (check.neededBy.get(node) ?? "").split(",");
    if (!needed.every(feature => features.split(",").includes(feature)) && faults++ < 10) {
      console.error(
        `islands: ${laidOut.object[node]}:(${laidOut.section[node]}) lies in the island of ${features} but is needed by ${needed}`,
      );
    }
  }
  if (faults > 0) fail(`${faults} sections lie in an island that can go while they are needed`);

  const elf = openElf(resolve(output), "r+") ?? fail(`${output} is not an ELF file`);
  const placed = elf.sections
    .filter(section => (section.flags & 2) !== 0 && section.size > 0)
    .sort((a, b) => a.address - b.address);
  const ranges = placed.flatMap((section, index) => {
    const island = islandOutput.exec(section.name);
    if (island === null) return [];
    const next = placed[index + 1];
    const end = next !== undefined && islandOutput.test(next.name) ? next.address : section.address + section.size;
    return [{ start: section.address, end, features: islands[Number(island[1]) - 1]! }];
  });
  const stub =
    [...check.plainName].find(([, name]) => name === "Bun__trimmedOut")?.[0] ?? fail("Bun__trimmedOut is gone");
  const table = tableOf(
    declared,
    laidOut.address[stub]!,
    ranges,
    listedDoors(laidOut, check, work, node => islands[Number(islandOutput.exec(laidOut.output[node]!)?.[1]) - 1]),
  );
  const room = elf.sections.find(section => section.name === ".bun_islands") ?? fail("the room for the table is gone");
  writeSync(elf.fd, Buffer.from(table, "latin1"), 0, table.length, room.offset);
  closeSync(elf.fd);
  lap("check");
  report(
    check.doors.size,
    islands,
    bytesOf,
    ranges.reduce((sum, range) => sum + range.end - range.start, 0),
  );
}

function linkMachO({ work, output, declared, demangler, command, assemble, link }: Linker): void {
  const movable = new Map([
    ["__TEXT,__text", "text"],
    ["__TEXT,__const", "const"],
  ]);
  const exportedSymbols = command[command.indexOf("-exported_symbols_list") + 1]!;
  const orderAt = command.findIndex(argument => argument.startsWith("-Wl,-order_file,"));
  const compiledAt = command.findIndex(argument => argument.startsWith("-Wl,-object_path_lto,"));
  const support = assemble(
    "room.s",
    `.section __TEXT,__bun_islands\n.globl _Bun__islands\n.no_dead_strip _Bun__islands\n_Bun__islands:\n.zero ${tableRoom}\n` +
      `.section __TEXT,__const\n.globl _Bun__trimmedFeatures\n_Bun__trimmedFeatures:\n` +
      declared.features.map(feature => `.asciz ${JSON.stringify(feature.description)}\n`).join("") +
      `.subsections_via_symbols\n`,
  );
  const always = ["-Wl,-u,_Bun__trimmedOut", "-Wl,-headerpad,0x2000"];
  const compiled = join(work, "compiled");
  mkdirSync(compiled);
  mkdirSync(join(work, "unused"));
  if (compiledAt >= 0) command[compiledAt] = "-Wl,-object_path_lto," + compiled;
  else always.push("-Wl,-object_path_lto," + compiled);
  const fromBitcode = link("compiling", path => path, [support], always);
  lap("first link");
  const native = readdirSync(compiled).map(name => join(compiled, name));
  const withoutBitcode = (path: string) => (isBitcode(path) ? undefined : path);
  if (compiledAt >= 0) command[compiledAt] = "-Wl,-object_path_lto," + join(work, "unused");
  else always[always.length - 1] = "-Wl,-object_path_lto," + join(work, "unused");
  const first = native.length === 0 ? fromBitcode : link("first", withoutBitcode, [support, ...native], always);
  if (first !== fromBitcode) lap("link of what it compiled");
  const graph = readMachOGraph(first.map, exportedSymbols);
  lap("graph");
  const foldedNames = (of: Graph) => [...of.aliases.values()].flat().map(([, name]) => name.replace(/^_/, ""));
  const analysis = analyze(graph, declared, demangler, foldedNames(graph));
  if (analysis.foldedOpen > 0)
    console.log(`${analysis.foldedOpen} doors were folded into other functions and stay open`);
  const { islands, bytesOf, numberOf } = islandsBySize(graph, analysis, declared, output => movable.has(output));

  const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const stem = (name: string) => name.split(".llvm.")[0]!.split(".__uniq.")[0]!;
  const spell = (object: string, name: string) => (graph.externalNames.has(name) ? name : `${base(object)}:${name}`);
  const namesOf = (node: number): [string, string][] => [
    [graph.object[node]!, graph.section[node]!],
    ...(graph.aliases.get(node) ?? []),
  ];
  const moves = (node: number) =>
    analysis.neededBy.has(node) && movable.has(graph.output[node]!) && !staysAsDoor(analysis, node);
  const taken = new Set<string>();
  const takenAnywhere = new Set<string>();
  for (let node = 0; node < graph.address.length; node++) {
    if (moves(node)) continue;
    for (const [object, name] of namesOf(node)) {
      taken.add(base(graph.object[node]!) + "\0" + stem(name));
      taken.add(base(object) + "\0" + stem(name));
      takenAnywhere.add(stem(name));
      if (graph.externalNames.has(name)) taken.add("\0" + stem(name));
    }
  }
  const canBeNamed = (node: number) =>
    namesOf(node).every(([object, name]) =>
      graph.externalNames.has(name)
        ? !takenAnywhere.has(stem(name))
        : !taken.has(base(graph.object[node]!) + "\0" + stem(name)) &&
          !taken.has(base(object) + "\0" + stem(name)) &&
          !taken.has("\0" + stem(name)),
    );
  let order: string[] = [];
  let markerText = "";
  islands.forEach((features, index) => {
    for (const [section, short] of movable) {
      const isCode = short === "text";
      for (const edge of ["begin", "end"]) {
        const symbol = `_bun_island_${index + 1}_${short}_${edge}`;
        const alignment = index === (edge === "begin" ? 0 : islands.length - 1) ? 14 : 2;
        markerText +=
          `.section ${section}${isCode ? ",regular,pure_instructions" : ""}\n.p2align ${alignment}\n.globl ${symbol}\n.no_dead_strip ${symbol}\n` +
          `${symbol}:\n${isCode ? "brk #1" : ".long 0"}\n`;
      }
      order.push(`_bun_island_${index + 1}_${short}_begin`);
      for (let node = 0; node < graph.address.length; node++) {
        if (
          moves(node) &&
          graph.output[node] === section &&
          numberOf.get(analysis.neededBy.get(node)!) === index + 1 &&
          canBeNamed(node)
        ) {
          for (const [object, name] of namesOf(node)) order.push(spell(object, name));
        }
      }
      order.push(`_bun_island_${index + 1}_${short}_end`);
    }
  });
  const markers = [assemble("markers.s", markerText + ".subsections_via_symbols\n")];
  const inherited = orderAt >= 0 ? readFileSync(command[orderAt]!.slice("-Wl,-order_file,".length), "utf8") : "";
  const orderFile = join(work, "order.txt");
  if (orderAt >= 0) command[orderAt] = "-Wl,-order_file," + orderFile;
  else always.push("-Wl,-order_file," + orderFile);

  for (let round = 1; ; round++) {
    writeFileSync(orderFile, order.join("\n") + "\n" + inherited);
    if (round === 1) lap("plan");
    const second = link("second", withoutBitcode, [support, ...markers, ...native], always);
    lap("ordered link");
    const laidOut = readMachOGraph(second.map, exportedSymbols);
    const check = analyze(laidOut, declared, demangler, foldedNames(laidOut));
    const marker = new Map<string, number>();
    laidOut.section.forEach(
      (name, node) => void (name.startsWith("_bun_island_") && marker.set(name, laidOut.address[node]!)),
    );
    const ranges = islands.flatMap((features, index) =>
      [...movable.values()].map(short => ({
        start: marker.get(`_bun_island_${index + 1}_${short}_begin`)!,
        end: marker.get(
          index + 1 < islands.length
            ? `_bun_island_${index + 2}_${short}_begin`
            : `_bun_island_${index + 1}_${short}_end`,
        )!,
        features,
      })),
    );
    const islandAt = (address: number) => ranges.find(range => range.start <= address && address < range.end);
    const dragging = new Set<string>();
    for (let node = 0; node < laidOut.address.length; node++) {
      const island = islandAt(laidOut.address[node]!);
      if (island === undefined || laidOut.section[node]!.startsWith("_bun_island_")) continue;
      const needed = check.core.has(node) ? ["what always stays"] : (check.neededBy.get(node) ?? "").split(",");
      if (needed.every(feature => island.features.split(",").includes(feature))) continue;
      let before = node - 1;
      while (before >= 0 && (check.core.has(before) || laidOut.section[before]!.startsWith("_bun_island_"))) before--;
      if (before >= 0) dragging.add(spell(laidOut.object[before]!, laidOut.section[before]!));
    }
    lap("check");
    if (dragging.size > 0) {
      if (round === 5) fail(`${dragging.size} atoms lie in an island that can go while they are needed`);
      order = order.filter(line => !dragging.has(line));
      continue;
    }
    const stub = laidOut.section.indexOf("_Bun__trimmedOut");
    if (stub < 0) fail("Bun__trimmedOut is gone");
    const table = tableOf(
      declared,
      laidOut.address[stub]!,
      ranges,
      listedDoors(laidOut, check, work, node => islandAt(laidOut.address[node]!)?.features),
    );
    const fd = openSync(resolve(output), "r+");
    const commands = readAt(fd, 0, 32 + readAt(fd, 20, 4).readUInt32LE(0));
    let room = -1;
    for (let at = 32; at < commands.length; at += commands.readUInt32LE(at + 4)) {
      if (commands.readUInt32LE(at) !== 0x19) continue;
      for (let index = 0; index < commands.readUInt32LE(at + 64); index++) {
        const section = at + 72 + index * 80;
        if (fixedName(commands, section) === "__bun_islands") room = commands.readUInt32LE(section + 48);
      }
    }
    if (room < 0) fail("the room for the table is gone");
    writeSync(fd, Buffer.from(table, "latin1"), 0, table.length, room);
    closeSync(fd);
    report(
      check.doors.size,
      islands,
      bytesOf,
      ranges.reduce((sum, range) => sum + range.end - range.start, 0),
    );
    return;
  }
}

function main(): void {
  const separator = process.argv.indexOf("--");
  const [doorsPath, demangler, work] = process.argv.slice(2, separator);
  const command = process.argv.slice(separator + 1);
  if (separator < 0 || work === undefined || command.length === 0) {
    fail("usage: islands.ts <doors> <llvm-cxxfilt> <work directory> -- <link command>");
  }
  const isMachO = command.some(argument => argument.startsWith("-Wl,-map,"));
  const mapFlag = isMachO ? "-Wl,-map," : "-Wl,-Map=";
  const outputAt = command.indexOf("-o") + 1;
  const mapAt = command.findIndex(argument => argument.startsWith(mapFlag));
  if (outputAt === 0 || mapAt < 0) fail("the link command names no output or no map");
  const output = command[outputAt]!;
  const finalMap = command[mapAt]!.slice(mapFlag.length);
  const compiler = command[0]!;
  const targetFlags = command.flatMap((argument, index) =>
    /^(--target=|-mmacosx-version-min=)/.test(argument)
      ? [argument]
      : argument === "-isysroot"
        ? [argument, command[index + 1]!]
        : [],
  );
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const linker: Linker = {
    work,
    output,
    declared: readDoors(doorsPath!),
    demangler: demangler!,
    command,
    assemble(name, text) {
      const source = join(work, name);
      writeFileSync(source, text);
      const made = spawnSync(compiler, [...targetFlags, "-c", source, "-o", source + ".o"], { stdio: "inherit" });
      if (made.status !== 0) fail(`${name} does not compile`);
      return source + ".o";
    },
    link(name, rewrite, first, last, runs = true, without) {
      const executable = name === "second" ? output : join(work, name);
      const map = name === "second" ? finalMap : join(work, name + ".map");
      const rewritten = command.slice(1).flatMap((argument, index) => {
        if (index + 1 === outputAt) return [executable];
        if (index + 1 === mapAt) return [mapFlag + map];
        if (without?.test(argument)) return [];
        const file = /^(-Wl,)?@(.*)$/.exec(argument);
        if (file === null) return [argument];
        const lines = readFileSync(file[2]!, "utf8")
          .split("\n")
          .filter(line => line !== "");
        const kept = lines.flatMap(line => {
          const path = line.replace(/^"(.*)"$/, "$1");
          if (path.startsWith("-")) return [line];
          const replaced = rewrite(path);
          return replaced === undefined ? [] : [`"${replaced}"`];
        });
        const copy = join(work, `${name}.${index}.rsp`);
        writeFileSync(copy, kept.join("\n") + "\n");
        return [`${file[1] ?? ""}@${copy}`];
      });
      if (!runs) return { executable, map, log: "" };
      const linked = spawnSync(compiler, [...first, ...rewritten, ...last], { encoding: "latin1", maxBuffer: 1 << 30 });
      const log = linked.stdout + linked.stderr;
      if (linked.status !== 0) fail(`the ${name} link failed:\n${log.slice(-4000)}`);
      return { executable, map, log };
    },
  };
  if (isMachO) linkMachO(linker);
  else linkElf(linker);
}

main();
