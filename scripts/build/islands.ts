#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
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
import { namedBytesOfPe, readCoffGraph, sectionInFile } from "./islands-coff.ts";
import {
  type Claim,
  type DataPackage,
  type Library,
  encodeTable,
  groupsOfPlaces,
  inTableOrder,
  isPlan,
  itemsOf,
  misplaced,
  pageSize,
  type Place,
  placeKinds,
  type Plan,
  type PublicName,
  type Range,
  rangesThatCanGo,
  rangesThatCanOnlyBeOverwritten,
  readPlan,
  runsOf,
  type TableDoor,
  roomFor,
  wholePages,
  writePlan,
  xxh3,
} from "./islands-layout.ts";

interface Door {
  feature: string;
  whenShut: "exit" | "return";
  pattern: RegExp;
  isOperation?: boolean;
}

interface Doors {
  features: { name: string; description: string }[];
  doors: Door[];
  conditions: { feature: string; kind: string; name: string }[];
  smallest: Map<string, number>;
  data: Claim[];
  dataKeptOnWindows: RegExp[];
  loadNativeCode: string[];
  argued: { door: RegExp; namer: RegExp }[];
  unmerged: RegExp[];
  publicNames: PublicName[];
  libraries: (Library & { isOnlyOnWindows: boolean })[];
  fingerprint: string;
}

interface Graph {
  address: number[];
  size: number[];
  alignment: number[];
  output: string[];
  object: string[];
  section: string[];
  successors: number[][];
  roots: Set<number>;
  functionName: Map<number, string>;
  names: string[][];
  aliases: Map<number, [string, string][]>;
  externalNames: Set<string>;
  unreadObjects: string[];
  confirmedByTheBytes: number;
  sentOn: number;
  boundElsewhere: string[];
  placesThatName: Map<number, Map<number, Place[]>>;
  namedInWaysThatCannotBeRewritten: Map<number, Set<number>>;
  keptByAFlagAlone: Set<number>;
  neverDoors: Set<number>;
  otherNames: Map<number, string[]>;
  hashOfString: Map<number, number>;
  exported: Set<number>;
  stringsHeld: string | undefined;
  isArm64: boolean;
}

const smallestIsland = 4096;
const mostLeftOutside = 0.05;
const namelessPrefix = "bun_nameless_";
const isCode = (output: string) => output === ".text" || output.startsWith(".text.");
const isMovable = (output: string) => isCode(output) || output === ".rodata" || output === ".bun_builtins";
const mayMove = /^\.(text|rodata|bun_builtins)(\.|$)/;
const isOrdinary = (output: string) => isMovable(output) || [".data", ".data.rel.ro", ".bss"].includes(output);
const ignoredOutputs = /^\.(debug|gdb_index|symtab|strtab|comment|shstrtab|eh_frame|rela|tbss)/;
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
  const text = readFileSync(path, "utf8");
  const result: Doors = { features: [], doors: [], conditions: [], smallest: new Map(), data: [], dataKeptOnWindows: [], loadNativeCode: [], argued: [], unmerged: [], publicNames: [], libraries: [], fingerprint: createHash("sha256").update(text).digest("hex").slice(0, 16) };
  for (const line of text.split("\n")) {
    const words = line.trim().split(/\s+/);
    if (words[0] === "feature") result.features.push({ name: words[1]!, description: words.slice(2).join(" ") });
    else if (words[0] === "when") result.conditions.push({ feature: words[1]!, kind: words[2]!, name: words.slice(3).join(" ") });
    else if (words[0] === "exported") result.loadNativeCode.push(...words.slice(1));
    else if (words[0] === "argued") result.argued.push({ door: new RegExp(`^(?:${words[1]})$`), namer: new RegExp(`^(?:${words[2]})$`) });
    else if (words[0] === "unmerged") result.unmerged.push(new RegExp(words.slice(1).join(" ")));
    else if (words[0] === "smallest") result.smallest.set(words[1]!, Number(words[2]));
    else if (words[0] === "library" || words[0] === "windows-library") result.libraries.push({ name: `${words[1]} ${words[2]}`, features: words.slice(3), isOnlyOnWindows: words[0] === "windows-library" });
    else if (words[0] === "public") result.publicNames.push({ name: words[1]!, features: words.slice(2), tolerates: [] });
    else if (words[0] === "also") (result.publicNames.find(({ name }) => name === words[1]) ?? fail(`${path}: there is no public name ${words[1]}`)).tolerates.push(words[2]!);
    else if (words[0] === "data") result.data.push({ feature: words[1]!, pattern: new RegExp(words.slice(2).join(" ")) });
    else if (words[0] === "windows-keeps") result.dataKeptOnWindows.push(new RegExp(words.slice(1).join(" ")));
    else if (words[0] === "operations") result.doors.push({ feature: words[1]!, whenShut: "exit", pattern: new RegExp(words.slice(2).join(" ")), isOperation: true });
    else if (words[0] === "door") {
      if (words[2] !== "exit" && words[2] !== "return") fail(`${path}: a door exits or returns: ${line}`);
      result.doors.push({ feature: words[1]!, whenShut: words[2], pattern: new RegExp(words.slice(3).join(" ")) });
    }
  }
  const names = new Set(result.features.map(feature => feature.name));
  for (const { feature } of [...result.doors, ...result.conditions, ...result.data]) if (!names.has(feature)) fail(`${path}: there is no feature ${feature}`);
  for (const feature of [...result.publicNames.flatMap(({ features, tolerates }) => [...features, ...tolerates]), ...result.libraries.flatMap(({ features }) => features)]) if (!names.has(feature)) fail(`${path}: there is no feature ${feature}`);
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

const membersOf = new Map<string, Map<string, number[]>>();

function memberOffsets(archive: string, member: string): number[] {
  let members = membersOf.get(archive);
  if (members === undefined) {
    membersOf.set(archive, (members = new Map()));
    const fd = openSync(archive, "r");
    const end = fstatSync(fd).size;
    let longNames: Buffer = Buffer.alloc(0);
    if (end >= 8 && readAt(fd, 0, 8).toString("latin1") === "!<arch>\n") {
      for (let at = 8; at + 60 <= end; ) {
        const header = readAt(fd, at, 60).toString("latin1");
        const size = Number(header.slice(48, 58));
        let name = header.slice(0, 16).trimEnd();
        let nameAheadOfTheMember = 0;
        if (name === "//") longNames = readAt(fd, at + 60, size);
        else if (/^\/\d+$/.test(name)) name = longNames.toString("latin1", Number(name.slice(1)), longNames.indexOf("/\n", Number(name.slice(1))));
        else if (/^#1\/\d+$/.test(name)) name = readAt(fd, at + 60, (nameAheadOfTheMember = Number(name.slice(3)))).toString("latin1").replace(/\0+$/, "");
        else name = name.replace(/\/$/, "");
        if (name !== "" && name !== "/" && name !== "/SYM64") members.set(name, [...(members.get(name) ?? []), at + 60 + nameAheadOfTheMember]);
        at += 60 + size + (size & 1);
      }
    }
    closeSync(fd);
  }
  return members.get(member) ?? [];
}

function openElf(path: string, mode: "r" | "r+", base = 0): ElfFile | undefined {
  const fd = openSync(path, mode);
  if (fstatSync(fd).size < base + 64 || readAt(fd, base, 4).readUInt32BE(0) !== 0x7f454c46) {
    closeSync(fd);
    return undefined;
  }
  const header = readAt(fd, base, 64);
  const sectionHeadersOffset = base + Number(header.readBigUInt64LE(0x28));
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
      offset: base + Number(table.readBigUInt64LE(at + 24)),
      size: Number(table.readBigUInt64LE(at + 32)),
      link: table.readUInt32LE(at + 40),
      info: table.readUInt32LE(at + 44),
    });
  }
  const names = readAt(fd, sections[namesIndex]!.offset, sections[namesIndex]!.size);
  for (const section of sections) section.name = stringAt(names, section.nameOffset);
  return { fd, sectionHeadersOffset, namesIndex, sections };
}

function cutMergeableSectionsApart(path: string, prefix: string): void {
  const elf = openElf(path, "r+");
  if (elf === undefined) return;
  const { fd, sections, sectionHeadersOffset, namesIndex } = elf;
  const done = () => closeSync(fd);
  const machine = readAt(fd, 18, 2).readUInt16LE(0);
  const symbolsIndex = sections.findIndex(section => section.type === 2);
  const headers = readAt(fd, sectionHeadersOffset, sections.length * 64);
  const hasReferences = new Set(sections.filter(section => section.type === 4 || section.type === 9).map(section => section.info));
  const isCut = sections.map((section, index) => section.type === 1 && (section.flags & 0x12) === 0x12 && (section.flags & 0x200) === 0 && section.size > 0 && !hasReferences.has(index));
  if (symbolsIndex < 0 || !isCut.includes(true) || sections.some(section => section.type === 18)) return done();
  const startsOf = new Map<number, number[]>();
  sections.forEach((section, index) => {
    if (!isCut[index]) return;
    const unit = Math.max(1, Number(headers.readBigUInt64LE(index * 64 + 56)));
    const starts: number[] = [];
    if ((section.flags & 0x20) === 0) for (let at = 0; at < section.size; at += unit) starts.push(at);
    else {
      const data = readAt(fd, section.offset, section.size);
      let start = 0;
      for (let at = 0; at + unit <= data.length; at += unit) {
        if (data.subarray(at, at + unit).some(byte => byte !== 0)) continue;
        starts.push(start);
        start = at + unit;
      }
      if (start < data.length) starts.push(start);
    }
    startsOf.set(index, starts);
  });
  const pieceAt = (section: number, offset: number) => {
    const starts = startsOf.get(section)!;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const symbols = readAt(fd, sections[symbolsIndex]!.offset, sections[symbolsIndex]!.size);
  const count = symbols.length / 24;
  const isRelativeToThePlace = (type: number) => (machine === 62 ? ![1, 10, 11].includes(type) : machine !== 183);
  const tables = sections.flatMap((section, index) => (section.type === 4 && (sections[section.info]!.flags & 2) !== 0 ? [{ index, data: readAt(fd, section.offset, section.size) }] : []));
  const sectionOfSectionSymbol = (symbol: number) => {
    const section = symbols.readUInt16LE(symbol * 24 + 6);
    return (symbols[symbol * 24 + 4]! & 15) === 3 && isCut[section] ? section : -1;
  };
  for (const { data } of tables) {
    for (let at = 0; at < data.length; at += 24) {
      const section = sectionOfSectionSymbol(data.readUInt32LE(at + 12));
      const addend = Number(data.readBigInt64LE(at + 16));
      if (section >= 0 && (isRelativeToThePlace(data.readUInt32LE(at + 8)) || addend < 0 || addend >= sections[section]!.size)) isCut[section] = false;
    }
  }
  const numberOf = new Map<string, number>();
  const pieces: { section: number; start: number; end: number }[] = [];
  const numberOfPiece = (section: number, offset: number) => {
    const piece = pieceAt(section, offset);
    const key = `${section} ${piece}`;
    let number = numberOf.get(key);
    if (number === undefined) {
      const starts = startsOf.get(section)!;
      numberOf.set(key, (number = pieces.length));
      pieces.push({ section, start: starts[piece]!, end: starts[piece + 1] ?? sections[section]!.size });
    }
    return number;
  };
  for (let symbol = 0; symbol < count; symbol++) {
    const section = symbols.readUInt16LE(symbol * 24 + 6);
    if (section >= sections.length || !isCut[section] || (symbols[symbol * 24 + 4]! & 15) === 3) continue;
    const value = Number(symbols.readBigUInt64LE(symbol * 24 + 8));
    const number = numberOfPiece(section, Math.min(value, sections[section]!.size - 1));
    symbols.writeUInt16LE(sections.length + number, symbol * 24 + 6);
    symbols.writeBigUInt64LE(BigInt(value - pieces[number]!.start), symbol * 24 + 8);
  }
  for (const { data } of tables) {
    for (let at = 0; at < data.length; at += 24) {
      const section = sectionOfSectionSymbol(data.readUInt32LE(at + 12));
      if (section < 0) continue;
      const addend = Number(data.readBigInt64LE(at + 16));
      const number = numberOfPiece(section, addend);
      data.writeUInt32LE(count + number, at + 12);
      data.writeBigInt64LE(BigInt(addend - pieces[number]!.start), at + 16);
    }
  }
  if (pieces.length === 0 || sections.length + pieces.length >= 0xff00) return done();
  const stringsIndex = sections[symbolsIndex]!.link;
  const moreSymbols = Buffer.alloc(pieces.length * 24);
  const moreHeaders = Buffer.alloc(pieces.length * 64);
  let moreStrings = "";
  let moreNames = "";
  pieces.forEach(({ section, start, end }, number) => {
    moreSymbols.writeUInt32LE(sections[stringsIndex]!.size + moreStrings.length, number * 24);
    moreSymbols[number * 24 + 4] = 0x10;
    moreSymbols[number * 24 + 5] = 2;
    moreSymbols.writeUInt16LE(sections.length + number, number * 24 + 6);
    moreStrings += `${prefix}_${number}\0`;
    headers.copy(moreHeaders, number * 64, section * 64, section * 64 + 64);
    moreHeaders.writeUInt32LE(moreNames.length, number * 64);
    moreHeaders.writeBigUInt64LE(BigInt(sections[section]!.flags & ~0x30), number * 64 + 8);
    moreHeaders.writeBigUInt64LE(BigInt(sections[section]!.offset + start), number * 64 + 24);
    moreHeaders.writeBigUInt64LE(BigInt(end - start), number * 64 + 32);
    moreHeaders.writeBigUInt64LE(0n, number * 64 + 56);
    moreNames += `${sections[section]!.name}.${number}\0`;
  });
  sections.forEach((section, index) => {
    if (!isCut[index]) return;
    headers.writeBigUInt64LE(BigInt(section.flags & ~0x30), index * 64 + 8);
    headers.writeBigUInt64LE(0n, index * 64 + 32);
    headers.writeBigUInt64LE(0n, index * 64 + 56);
  });
  let end = Math.ceil(fstatSync(fd).size / 8) * 8;
  const append = (data: Buffer) => {
    const at = end;
    writeSync(fd, data, 0, data.length, at);
    end = Math.ceil((at + data.length) / 8) * 8;
    return at;
  };
  const replace = (index: number, data: Buffer) => {
    headers.writeBigUInt64LE(BigInt(append(data)), index * 64 + 24);
    headers.writeBigUInt64LE(BigInt(data.length), index * 64 + 32);
  };
  const isOneTable = namesIndex === stringsIndex;
  const firstNewName = sections[namesIndex]!.size + (isOneTable ? moreStrings.length : 0);
  for (let number = 0; number < pieces.length; number++) moreHeaders.writeUInt32LE(firstNewName + moreHeaders.readUInt32LE(number * 64), number * 64);
  const grown = (index: number, more: string) => Buffer.concat([readAt(fd, sections[index]!.offset, sections[index]!.size), Buffer.from(more, "latin1")]);
  replace(symbolsIndex, Buffer.concat([symbols, moreSymbols]));
  replace(stringsIndex, grown(stringsIndex, isOneTable ? moreStrings + moreNames : moreStrings));
  if (!isOneTable) replace(namesIndex, grown(namesIndex, moreNames));
  for (const { index, data } of tables) writeSync(fd, data, 0, data.length, sections[index]!.offset);
  const place = Buffer.alloc(8);
  place.writeBigUInt64LE(BigInt(append(Buffer.concat([headers, moreHeaders]))));
  writeSync(fd, place, 0, 8, 0x28);
  const total = Buffer.alloc(2);
  total.writeUInt16LE(sections.length + pieces.length);
  writeSync(fd, total, 0, 2, 0x3c);
  done();
}

const { add32, add64, branch26, page21, low12, adr, pointer36, nop } = placeKinds;

interface ObjectReferences {
  references: Map<string, Set<string>>;
  boundAt: Map<string, Set<number>>;
  placesThatName: Map<string, Map<number, Place[]>>;
  namedInWaysThatCannotBeRewritten: Map<string, Set<number>>;
  definitions: [string, string][];
  named: [string, string][];
  otherNames: [string, string][];
  namedByUnwindTables: Set<string>;
}

interface Image {
  machine: number;
  isPositionIndependent: boolean;
  start: number;
  byte(address: number): number | undefined;
  signed32(address: number): number | undefined;
  unsigned32(address: number): number | undefined;
  unsigned64(address: number): number | undefined;
  text(address: number, length: number): string | undefined;
}

function imageOf(elf: ElfFile): Image {
  const header = readAt(elf.fd, 0, 64);
  const parts = elf.sections
    .filter(section => (section.flags & 2) !== 0 && section.type !== 8 && section.size > 0)
    .map(section => ({ start: section.address, end: section.address + section.size, data: readAt(elf.fd, section.offset, section.size) }));
  return imageOfParts(parts, header.readUInt16LE(0x12), header.readUInt16LE(0x10) === 3);
}

function imageOfParts(parts: { start: number; end: number; data: Buffer }[], machine: number, isPositionIndependent: boolean): Image {
  let last = parts[0];
  const partWith = (address: number, length: number) => {
    if (last === undefined || address < last.start || address + length > last.end) last = parts.find(part => part.start <= address && address + length <= part.end);
    return last;
  };
  return {
    machine,
    isPositionIndependent,
    start: Math.min(...parts.map(part => part.start)),
    byte: address => partWith(address, 1)?.data[address - last!.start],
    signed32: address => partWith(address, 4)?.data.readInt32LE(address - last!.start),
    unsigned32: address => partWith(address, 4)?.data.readUInt32LE(address - last!.start),
    unsigned64: address => {
      const data = partWith(address, 8)?.data;
      return data && data.readUInt32LE(address - last!.start) + data.readUInt32LE(address - last!.start + 4) * 0x100000000;
    },
    text: (address, length) => partWith(address, length)?.data.toString("latin1", address - last!.start, address - last!.start + length),
  };
}

type AddressGiven = (type: number, place: number, addend: number, symbol: number) => number | undefined;

function addressGivenOnX64(image: Image): AddressGiven {
  const less = (value: number | undefined, by: number) => (value === undefined ? undefined : value - by);
  return (type, place, addend) => {
    if (type === 2 || type === 4) return less(image.signed32(place), addend - place);
    if (type === 1) return image.isPositionIndependent ? undefined : less(image.unsigned64(place), addend);
    if (type === 10) return less(image.unsigned32(place), addend);
    if (type === 11) return less(image.signed32(place), addend);
    if (type !== 9 && type !== 41 && type !== 42) return undefined;
    const first = image.byte(place - 2);
    const second = image.byte(place - 1);
    if (first === 0xe9) return less(image.signed32(place - 1), -place - 3);
    const target = less(image.signed32(place), -place - 4);
    if (target === undefined) return undefined;
    if ((first === 0x67 && second === 0xe8) || first === 0x8d) return target;
    const readsTheSlot = first === 0x8b || (first === 0xff && (second === 0x15 || second === 0x25));
    return readsTheSlot && !image.isPositionIndependent ? image.unsigned64(target) : undefined;
  };
}

function addressGivenOnArm64(image: Image): AddressGiven {
  const pages = new Map<number, [number, number]>();
  const scaleOf = new Map([[277, 1], [278, 1], [284, 2], [285, 4], [286, 8], [299, 16]]);
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const distance21 = (word: number) => signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
  const is = (word: number, mask: number, bits: number) => (word & mask) >>> 0 === bits;
  return (type, place, addend, symbol) => {
    if (type === 257) {
      const value = image.isPositionIndependent ? undefined : image.unsigned64(place);
      return value === undefined ? undefined : value - addend;
    }
    const word = type === 261 || type === 314 ? image.signed32(place) : image.unsigned32(place);
    if (word === undefined) return undefined;
    if (type === 261 || type === 314) return word + place - addend;
    if (type === 282 || type === 283) return is(word, 0x7c000000, 0x14000000) ? place + signed(word & 0x3ffffff, 26) * 4 - addend : undefined;
    if (type === 275 || type === 276 || type === 311) {
      if (is(word, 0x9f000000, 0x90000000)) pages.set(symbol, [place - (place % 4096) + distance21(word) * 4096, addend]);
      else pages.delete(symbol);
      return undefined;
    }
    const scale = scaleOf.get(type);
    if (scale === undefined && type !== 312) return undefined;
    if (is(word, 0x9f000000, 0x10000000)) return place + distance21(word) - addend;
    const page = pages.get(symbol);
    if (page === undefined || page[1] !== addend) return undefined;
    const low = (word >>> 10) & 0xfff;
    if (scale !== undefined) return page[0] + low * scale - addend;
    if (is(word, 0xffc00000, 0x91000000)) return page[0] + low;
    return is(word, 0xffc00000, 0xf9400000) && !image.isPositionIndependent ? image.unsigned64(page[0] + low * 8) : undefined;
  };
}

type PlaceToRewrite = (type: number, place: number, addend: number, door: number) => Place | "none" | undefined;

function placeToRewriteOnX64(image: Image): PlaceToRewrite {
  const holds = (address: number, kind: number, value: number | undefined, door: number) => (value === door ? { address, kind } : undefined);
  const from = (field: number | undefined, next: number) => (field === undefined ? undefined : field + next);
  return (type, place, addend, door) => {
    if ((type === 2 || type === 4) && addend === -4) return holds(place, add32, from(image.signed32(place), place + 4), door);
    if (type === 1 && addend === 0 && !image.isPositionIndependent) return holds(place, add64, image.unsigned64(place), door);
    if ((type === 10 || type === 11) && addend === 0) return holds(place, add32, image.signed32(place), door);
    if ((type !== 9 && type !== 41 && type !== 42) || addend !== -4) return undefined;
    const first = image.byte(place - 2);
    const second = image.byte(place - 1);
    if (first === 0xe9) return holds(place - 1, add32, from(image.signed32(place - 1), place + 3), door);
    const target = from(image.signed32(place), place + 4);
    if ((first === 0x67 && second === 0xe8) || first === 0x8d) return holds(place, add32, target, door);
    const readsTheSlot = first === 0x8b || (first === 0xff && (second === 0x15 || second === 0x25));
    return readsTheSlot && target !== undefined && !image.isPositionIndependent ? holds(target, add64, image.unsigned64(target), door) : undefined;
  };
}

function placeToRewriteOnArm64(image: Image): PlaceToRewrite {
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const distance21 = (word: number) => signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
  const is = (word: number, mask: number, bits: number) => (word & mask) >>> 0 === bits;
  const pageOf = (address: number) => address - (address % 4096);
  return (type, place, addend, door) => {
    if (addend !== 0) return undefined;
    if (type === 257) return !image.isPositionIndependent && image.unsigned64(place) === door ? { address: place, kind: add64 } : undefined;
    if (type === 261 || type === 314) return (image.signed32(place) ?? NaN) + place === door ? { address: place, kind: add32 } : undefined;
    const word = image.unsigned32(place);
    if (word === undefined) return undefined;
    if (type === 282 || type === 283) return is(word, 0x7c000000, 0x14000000) && place + signed(word & 0x3ffffff, 26) * 4 === door ? { address: place, kind: branch26 } : undefined;
    if (type === 275 || type === 276) {
      if (word === 0xd503201f) return { address: place, kind: nop };
      return is(word, 0x9f000000, 0x90000000) && pageOf(place) + distance21(word) * 4096 === pageOf(door) ? { address: place, kind: page21 } : undefined;
    }
    if (type !== 277) return undefined;
    if (is(word, 0x9f000000, 0x10000000)) return place + distance21(word) === door ? { address: place, kind: adr } : undefined;
    return is(word, 0xffc00000, 0x91000000) && ((word >>> 10) & 0xfff) === door % 4096 ? { address: place, kind: low12 } : undefined;
  };
}

interface Linked {
  image: Image;
  doorAt: Map<number, number>;
  placeOf(section: string, size: number): number | undefined;
}

function readObject(path: string, liveSections: Set<string>, linked: Linked): ObjectReferences | undefined {
  const result: ObjectReferences = { references: new Map(), boundAt: new Map(), placesThatName: new Map(), namedInWaysThatCannotBeRewritten: new Map(), definitions: [], named: [], otherNames: [], namedByUnwindTables: new Set() };
  if (existsSync(path)) return readObjectAt(path, 0, liveSections, linked, result) ? result : undefined;
  const inArchive = /^(.*)\(([^()]*)\)$/.exec(path);
  const offsets = inArchive !== null && existsSync(inArchive[1]!) ? memberOffsets(inArchive[1]!, inArchive[2]!) : [];
  return offsets.length > 0 && offsets.every(offset => readObjectAt(inArchive![1]!, offset, liveSections, linked, result)) ? result : undefined;
}

const isLaidAsItIs = (section: SectionHeader) => (section.flags & 2) !== 0 && (section.flags & 0x10) === 0 && section.size > 0 && !ignoredOutputs.test(section.name);

function readObjectAt(path: string, base: number, liveSections: Set<string>, linked: Linked, result: ObjectReferences): boolean {
  const elf = openElf(path, "r", base);
  if (elf === undefined) return false;
  const { fd, sections } = elf;
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
      const type = info & 15;
      if (raw === 0 || type === 3 || type === 4 || type === 6 || (raw >= 0xff00 && raw < 0xffff)) continue;
      const section = sections[sectionOf(index)]!.name;
      const isGlobal = info >> 4 !== 0;
      if (!isGlobal && !mayMove.test(section)) continue;
      const name = stringAt(strings, symbols.readUInt32LE(index * 24));
      if (isGlobal) result.definitions.push([name, section]);
      if (mayMove.test(section)) result.named.push([name, section]);
      const startsTheSection = symbols.readUInt32LE(index * 24 + 8) === 0 && symbols.readUInt32LE(index * 24 + 12) === 0;
      if (type === 2 && startsTheSection && functionOfSection(section) !== undefined && functionOfSection(section) !== name) result.otherNames.push([name, section]);
    }
    const targets: (string | undefined)[] = new Array(count);
    const targetOf = (index: number) => {
      let target = targets[index];
      if (target === undefined) {
        const info = symbols[index * 24 + 4]!;
        const section = sectionOf(index);
        if ((info & 15) === 6) target = "";
        else if (info >> 4 === 0) target = section > 0 && section < sections.length && isLaidAsItIs(sections[section]!) ? "L" + sections[section]!.name : "";
        else target = "G" + stringAt(strings, symbols.readUInt32LE(index * 24));
        targets[index] = target;
      }
      return target;
    };
    const addressGiven = linked.image.machine === 62 ? addressGivenOnX64(linked.image) : linked.image.machine === 183 ? addressGivenOnArm64(linked.image) : undefined;
    const placeToRewrite = linked.image.machine === 62 ? placeToRewriteOnX64(linked.image) : placeToRewriteOnArm64(linked.image);
    const given = new Float64Array(addressGiven === undefined ? 0 : count).fill(-1);
    for (const section of sections) {
      const source = section.type === 4 || section.type === 9 || section.type === 0x40000014 ? sections[section.info]!.name : "";
      if (source === ".eh_frame" && section.type === 4) {
        const relocations = readAt(fd, section.offset, section.size);
        for (let at = 0; at < relocations.length; at += 24) {
          const target = targetOf(relocations.readUInt32LE(at + 12));
          if (target[0] === "G") result.namedByUnwindTables.add(target.slice(1));
        }
      }
      if (!liveSections.has(source)) continue;
      if (section.type !== 4) fail(`${path}: the references of ${source} are written in a way that is not read here (section type ${section.type})`);
      let set = result.references.get(source);
      if (set === undefined) result.references.set(source, (set = new Set()));
      let bound = result.boundAt.get(source);
      if (bound === undefined) result.boundAt.set(source, (bound = new Set()));
      const start = addressGiven && linked.placeOf(source, sections[section.info]!.size);
      const relocations = readAt(fd, section.offset, section.size);
      const earlier = new Map<number, number[]>();
      const noteThePlace = (at: number) => {
        const address = given[relocations.readUInt32LE(at + 12)]!;
        const door = linked.doorAt.get(address);
        if (door === undefined) return;
        const place = start! + relocations.readUInt32LE(at) + relocations.readUInt32LE(at + 4) * 0x100000000;
        const addend = relocations.readUInt32LE(at + 16) + relocations.readInt32LE(at + 20) * 0x100000000;
        const found = placeToRewrite(relocations.readUInt32LE(at + 8), place, addend, address);
        if (found === undefined) {
          const doors = result.namedInWaysThatCannotBeRewritten.get(source);
          if (doors === undefined) result.namedInWaysThatCannotBeRewritten.set(source, new Set([door]));
          else doors.add(door);
        }
        if (found === undefined || found === "none") return;
        let doors = result.placesThatName.get(source);
        if (doors === undefined) result.placesThatName.set(source, (doors = new Map()));
        const places = doors.get(door);
        if (places === undefined) doors.set(door, [found]);
        else places.push(found);
      };
      for (let at = 0; at < relocations.length; at += 24) {
        const symbol = relocations.readUInt32LE(at + 12);
        const target = targetOf(symbol);
        if (target === "") continue;
        set.add(target);
        if (start === undefined) continue;
        if (given[symbol] === -1) {
          const before = at > 0 && linked.image.machine === 62 ? relocations.readUInt32LE(at - 16) : 0;
          if (before === 19 || before === 20) continue;
          const place = start + relocations.readUInt32LE(at) + relocations.readUInt32LE(at + 4) * 0x100000000;
          const addend = relocations.readUInt32LE(at + 16) + relocations.readInt32LE(at + 20) * 0x100000000;
          const address = addressGiven!(relocations.readUInt32LE(at + 8), place, addend, symbol);
          if (address === undefined) {
            const list = earlier.get(symbol);
            if (list === undefined) earlier.set(symbol, [at]);
            else list.push(at);
            continue;
          }
          given[symbol] = address;
          earlier.get(symbol)?.forEach(noteThePlace);
        }
        bound.add(given[symbol]!);
        noteThePlace(at);
      }
    }
  }
  closeSync(fd);
  return true;
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

function readGraph(executable: string, mapPath: string, log: string, doorsAmong: (functionName: Map<number, string>) => Iterable<number>): Graph {
  const found: { address: number; size: number; alignment: number; output: string; object: string; section: string }[] = [];
  let output = "";
  for (const line of readFileSync(mapPath, "latin1").split("\n")) {
    const match = /^\s*([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)\s+(\d+) ( *)(\S.*)$/.exec(line);
    if (match === null) continue;
    if (match[4]!.length === 0) output = match[5]!.trim();
    else if (match[4]!.length === 8 && !ignoredOutputs.test(output)) {
      const input = /^(.*):\(([^()]*)\)\s*$/.exec(match[5]!);
      const size = parseInt(match[2]!, 16);
      if (input !== null && size > 0) {
        found.push({ address: parseInt(match[1]!, 16), size, alignment: Number(match[3]), output, object: input[1]!, section: input[2]! });
      }
    }
  }
  found.sort((a, b) => a.address - b.address);
  const graph: Graph = {
    address: found.map(node => node.address),
    size: found.map(node => node.size),
    alignment: found.map(node => node.alignment),
    output: found.map(node => node.output),
    object: found.map(node => node.object),
    section: found.map(node => node.section),
    successors: [],
    roots: new Set(),
    functionName: new Map(),
    names: found.map(() => []),
    aliases: new Map(),
    externalNames: new Set(),
    unreadObjects: [],
    confirmedByTheBytes: 0,
    sentOn: 0,
    placesThatName: new Map(),
    namedInWaysThatCannotBeRewritten: new Map(),
    keptByAFlagAlone: new Set(),
    neverDoors: new Set(),
    otherNames: new Map(),
    hashOfString: new Map(),
    exported: new Set(),
    stringsHeld: undefined,
    boundElsewhere: [],
    isArm64: false,
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
  const elf = openElf(executable, "r") ?? fail(`${executable} is not an ELF file`);
  const image = imageOf(elf);
  const doorAt = new Map([...doorsAmong(graph.functionName)].map(node => [graph.address[node]!, node]));
  const objects = new Map<string, ObjectReferences | undefined>();
  const defined = new Map<string, string[]>();
  for (const [object, live] of liveSections) {
    if (object === "<internal>") continue;
    const placeOf = (section: string, size: number) => {
      const nodes = nodesOf.get(object + "\0" + section)!.filter(node => graph.size[node] === size);
      return nodes.length === 1 ? graph.address[nodes[0]!] : undefined;
    };
    const read = readObject(object, live, { image, doorAt, placeOf });
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
  const linked = elf.sections.find(section => section.type === 2) ?? fail(`${executable} has no symbol table`);
  const linkedSymbols = readAt(elf.fd, linked.offset, linked.size);
  const linkedStrings = readAt(elf.fd, elf.sections[linked.link]!.offset, elf.sections[linked.link]!.size);
  const linkedAt = new Map<string, number[]>();
  for (let at = 0; at < linkedSymbols.length; at += 24) {
    const type = linkedSymbols[at + 4]! & 15;
    if (linkedSymbols.readUInt16LE(at + 6) === 0 || type === 3 || type === 4 || type === 6) continue;
    const node = nodeAt(Number(linkedSymbols.readBigUInt64LE(at + 8)));
    if (node < 0) continue;
    if (type === 10) graph.roots.add(node);
    const name = stringAt(linkedStrings, linkedSymbols.readUInt32LE(at));
    if (name.startsWith("$")) continue;
    const nodes = linkedAt.get(name);
    if (nodes === undefined) linkedAt.set(name, [node]);
    else if (!nodes.includes(node)) nodes.push(node);
  }
  const successors: Set<number>[] = Array.from({ length: count }, () => new Set());
  const leadNowhere: string[] = [];
  for (const [object, read] of objects) {
    if (read === undefined) continue;
    for (const [name, section] of read.named) {
      const node = placed(object + "\0" + section);
      if (node !== undefined) graph.names[node]!.push(name);
    }
    for (const [name, section] of read.otherNames) {
      const node = placed(object + "\0" + section);
      if (node !== undefined) graph.otherNames.set(node, [...(graph.otherNames.get(node) ?? []), name]);
    }
    for (const [source, targets] of read.references) {
      const from = successors[nodesOf.get(object + "\0" + source)![0]!]!;
      for (const target of targets) {
        const name = target.slice(1);
        const node = target[0] === "L" ? placed(object + "\0" + name) : resolveGlobal(name);
        if (node !== undefined) from.add(node);
        else if (target[0] === "L") leadNowhere.push(`${object}:(${source}) names (${name})`);
        if (target[0] === "L") continue;
        for (const spelling of [name, "__wrap_" + name, name.replace(/^__real_/, "")]) {
          for (const other of linkedAt.get(spelling) ?? []) from.add(other);
        }
      }
    }
    for (const name of read.namedByUnwindTables) {
      for (const node of [resolveGlobal(name), ...(linkedAt.get(name) ?? [])]) if (node !== undefined) graph.roots.add(node);
    }
  }
  if (leadNowhere.length > 0) {
    fail(`${leadNowhere.length} references lead to sections that the linker's map does not hold:` + leadNowhere.slice(0, 5).map(line => `\n  ${line}`).join(""));
  }
  const onlyInTheBytes: [Set<number>, number][] = [];
  for (const [object, read] of objects) {
    for (const [source, addresses] of read?.boundAt ?? []) {
      const same = nodesOf.get(object + "\0" + source)!;
      const from = successors[same[0]!]!;
      const isKnown = (node: number) => node >= 0 && (from.has(node) || same.includes(node));
      for (const address of addresses) {
        const node = address < image.start ? -1 : nodeAt(address);
        if (node < 0 || graph.object[node] === "<internal>") continue;
        if (isKnown(node) || isKnown(nodeAt(address - 1))) {
          graph.confirmedByTheBytes++;
          continue;
        }
        onlyInTheBytes.push([from, node]);
        if ([...from].some(between => successors[between]!.has(node))) graph.sentOn++;
        else graph.boundElsewhere.push(`${object}:(${source}) names ${graph.object[node]}:(${graph.section[node]})`);
      }
    }
  }
  for (const [from, node] of onlyInTheBytes) from.add(node);
  for (const [object, read] of objects) {
    for (const [source, doors] of read?.namedInWaysThatCannotBeRewritten ?? []) {
      const from = nodesOf.get(object + "\0" + source)![0]!;
      for (const door of doors) {
        const sources = graph.namedInWaysThatCannotBeRewritten.get(door);
        if (sources === undefined) graph.namedInWaysThatCannotBeRewritten.set(door, new Set([from]));
        else sources.add(from);
      }
    }
    for (const [source, doors] of read?.placesThatName ?? []) {
      const from = nodesOf.get(object + "\0" + source)![0]!;
      for (const [door, places] of doors) {
        let byNode = graph.placesThatName.get(door);
        if (byNode === undefined) graph.placesThatName.set(door, (byNode = new Map()));
        byNode.set(from, [...(byNode.get(from) ?? []), ...places]);
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
    if (!isOrdinary(graph.output[node]!) || (graph.object[node] !== "<internal>" && objects.get(graph.object[node]!) === undefined)) {
      graph.roots.add(node);
    }
  }
  graph.isArm64 = readAt(elf.fd, 0x12, 2).readUInt16LE(0) === 183;
  const entry = nodeAt(Number(readAt(elf.fd, 0x18, 8).readBigUInt64LE(0)));
  if (entry >= 0) graph.roots.add(entry);
  const dynamic = elf.sections.find(section => section.type === 11);
  if (dynamic !== undefined) {
    const symbols = readAt(elf.fd, dynamic.offset, dynamic.size);
    for (let at = 0; at < symbols.length; at += 24) {
      const node = symbols.readUInt16LE(at + 6) !== 0 ? nodeAt(Number(symbols.readBigUInt64LE(at + 8))) : -1;
      if (node >= 0) graph.exported.add(node);
    }
  }
  closeSync(elf.fd);
  return graph;
}

interface Sighting {
  from: string;
  offset: number;
  inTheObject: number;
}

interface Naming extends Sighting {
  to: string;
  type: number;
}

interface MachOReferences {
  references: Map<string, Set<string>>;
  sightings: Map<string, Map<number, Sighting>>;
  namingsOfDoors: Naming[];
  externals: string[];
  kept: string[];
  keptByAFlagAlone: string[];
  pieceOfEntry: Map<string, string>;
  calledByTheLoader: string[];
  stringsNotRead: number;
  textOfExternalName: Map<string, string>;
  literalsNotRead: number;
  isX64: boolean;
}

function readMachOObject(path: string, mayBeADoor: (name: string) => boolean): MachOReferences | undefined {
  const inArchive = existsSync(path) ? null : /^(.*)\(([^()]*)\)$/.exec(path);
  const offsets = inArchive !== null && existsSync(inArchive[1]!) ? memberOffsets(inArchive[1]!, inArchive[2]!) : [0];
  if ((inArchive === null && !existsSync(path)) || offsets.length !== 1) return undefined;
  const fd = openSync(inArchive?.[1] ?? path, "r");
  const readFrom = (offset: number, size: number) => readAt(fd, offsets[0]! + offset, size);
  const header = fstatSync(fd).size < offsets[0]! + 32 ? undefined : readFrom(0, 32);
  if (header === undefined || header.readUInt32LE(0) !== 0xfeedfacf) {
    closeSync(fd);
    return undefined;
  }
  const isX64 = header.readUInt32LE(4) === 0x01000007;
  const sectionsAreWhole = (header.readUInt32LE(24) & 0x2000) === 0;
  const commands = readFrom(32, header.readUInt32LE(20));
  const sections: { name: string; segment: string; address: number; size: number; offset: number; relocations: number; count: number; flags: number }[] = [];
  let symbolTable: { entries: Buffer; strings: Buffer } | undefined;
  let at = 0;
  for (let command = header.readUInt32LE(16); command > 0; command--) {
    const kind = commands.readUInt32LE(at);
    if (kind === 0x19) {
      for (let index = 0; index < commands.readUInt32LE(at + 64); index++) {
        const section = at + 72 + index * 80;
        sections.push({
          name: fixedName(commands, section),
          segment: fixedName(commands, section + 16),
          address: Number(commands.readBigUInt64LE(section + 32)),
          size: Number(commands.readBigUInt64LE(section + 40)),
          offset: commands.readUInt32LE(section + 48),
          relocations: commands.readUInt32LE(section + 56),
          count: commands.readUInt32LE(section + 60),
          flags: commands.readUInt32LE(section + 64),
        });
      }
    } else if (kind === 2) {
      symbolTable = {
        entries: readFrom(commands.readUInt32LE(at + 8), commands.readUInt32LE(at + 12) * 16),
        strings: readFrom(commands.readUInt32LE(at + 16), commands.readUInt32LE(at + 20)),
      };
    }
    at += commands.readUInt32LE(at + 4);
  }
  const result: MachOReferences = { references: new Map(), sightings: new Map(), namingsOfDoors: [], externals: [], kept: [], keptByAFlagAlone: [], pieceOfEntry: new Map(), calledByTheLoader: [], stringsNotRead: 0, literalsNotRead: 0, textOfExternalName: new Map(), isX64 };
  if (symbolTable === undefined) {
    closeSync(fd);
    return result;
  }
  const { entries, strings } = symbolTable;
  const symbols: { name: string; type: number; section: number; value: number }[] = [];
  const namesAt: Map<number, string>[] = sections.map(() => new Map());
  const otherEntries: typeof symbols = [];
  for (let entry = 0; entry < entries.length; entry += 16) {
    const symbol = {
      name: stringAt(strings, entries.readUInt32LE(entry)),
      type: entries[entry + 4]!,
      section: entries[entry + 5]!,
      value: Number(entries.readBigUInt64LE(entry + 8)),
    };
    symbols.push(symbol);
    if ((symbol.type & 0xe0) !== 0 || (symbol.type & 0x0e) !== 0x0e) continue;
    const description = entries.readUInt16LE(entry + 6);
    if ((description & 0x0200) === 0) {
      const names = namesAt[symbol.section - 1]!;
      names.set(symbol.value, names.has(symbol.value) ? names.get(symbol.value) + "\x01" + symbol.name : symbol.name);
    } else otherEntries.push(symbol);
    if (symbol.type & 1) result.externals.push(symbol.name);
    if (description & 0x20) (sections[symbol.section - 1]?.name === "__text" ? result.keptByAFlagAlone : result.kept).push(symbol.name);
  }
  const atoms = namesAt.map(names => [...names].sort((a, b) => a[0] - b[0]));
  const startAndAtomAt = (section: number, address: number) => {
    const list = atoms[section - 1];
    if (list === undefined) return undefined;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]![0] <= address) low = middle + 1;
      else high = middle;
    }
    return low > 0 ? list[low - 1] : undefined;
  };
  const atomAt = (section: number, address: number) => startAndAtomAt(section, address)?.[1];
  const holdsStrings = (section: number) => ((sections[section - 1]?.flags ?? 0) & 0xff) === 2;
  const sizeOfLiteralsIn = (section: number) => ({ 3: 4, 4: 8, 14: 16 })[(sections[section - 1]?.flags ?? 0) & 0xff];
  const literalSections = new Map<number, Buffer>();
  const referToLiteral = (from: string, section: number, address: number) => {
    const size = sizeOfLiteralsIn(section)!;
    const { address: start, offset, size: length } = sections[section - 1]!;
    const at = Math.floor((address - start) / size) * size;
    if (at < 0 || at + size > length) return void result.literalsNotRead++;
    let bytes = literalSections.get(section);
    if (bytes === undefined) literalSections.set(section, (bytes = readFrom(offset, length)));
    refer(from, "W" + bytes.toString("hex", at, at + size));
  };
  const textOfStrings: (Buffer | undefined)[] = [];
  const stringWith = (section: number, address: number) => {
    const { address: start, offset, size } = sections[section - 1]!;
    const text = (textOfStrings[section] ??= readFrom(offset, size));
    const at = address - start;
    if (at < 0 || at >= text.length) return undefined;
    const end = text.indexOf(0, at);
    return text.toString("latin1", at === 0 ? 0 : text.lastIndexOf(0, at - 1) + 1, end < 0 ? text.length : end);
  };
  for (const symbol of symbols) {
    if ((symbol.type & 0xe0) !== 0 || (symbol.type & 0x0f) !== 0x0f || !holdsStrings(symbol.section)) continue;
    const text = stringWith(symbol.section, symbol.value);
    if (text === undefined) result.stringsNotRead++;
    else result.textOfExternalName.set(symbol.name, text);
  }
  const refer = (from: string, to: string) => {
    const set = result.references.get(from);
    if (set === undefined) result.references.set(from, new Set([to]));
    else set.add(to);
  };
  for (const entry of otherEntries) {
    const atom = atomAt(entry.section, entry.value);
    if (atom === undefined) continue;
    refer(atom, "L" + entry.name);
    refer(entry.name, "L" + atom);
    result.pieceOfEntry.set(entry.name, atom);
  }
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
    const runsBeforeMain = ["__mod_init_func", "__init_offsets", "__mod_term_func", "__thread_vars"].includes(section.name);
    if (runsBeforeMain || (section.flags & 0x10000000 && section.name !== "__bun_builtins")) for (const [, name] of atoms[index]!) result.kept.push(name);
    if (section.count === 0) return;
    const relocations = readFrom(section.relocations, section.count * 8);
    let contents: Buffer | undefined;
    let hasAddend = false;
    let isSubtracted = false;
    let addend = 0;
    for (let entry = 0; entry < relocations.length; entry += 8) {
      const word = relocations.readUInt32LE(entry + 4);
      const type = word >>> 28;
      if (type === 10 && !isX64) {
        hasAddend = true;
        addend = (word << 8) >> 8;
        continue;
      }
      const isPlain = !hasAddend && !isSubtracted;
      const added = hasAddend ? addend : 0;
      hasAddend = false;
      isSubtracted = type === (isX64 ? 5 : 1);
      const field = relocations.readInt32LE(entry);
      const from = atomAt(index + 1, section.address + field);
      if (runsBeforeMain && (word >>> 27) & 1) {
        result.kept.push(symbols[word & 0xffffff]!.name);
        result.calledByTheLoader.push(symbols[word & 0xffffff]!.name);
      }
      if (runsBeforeMain && !((word >>> 27) & 1) && type === 0 && ((word >>> 25) & 3) === 3) {
        contents ??= readFrom(section.offset, section.size);
        const address = Number(contents.readBigUInt64LE(field));
        const called = atomAt(sections.findIndex(other => other.address <= address && address < other.address + other.size) + 1, address);
        if (called !== undefined) {
          result.kept.push(called);
          result.calledByTheLoader.push(called);
        }
      }
      if (from === undefined) continue;
      if ((word >>> 27) & 1) {
        const target = symbols[word & 0xffffff]!;
        let to = (target.type & 0x0e) === 0x0e ? "L" + (atomAt(target.section, target.value) ?? target.name) : "G" + target.name;
        if (to[0] === "L" && holdsStrings(target.section)) {
          const width = (word >>> 25) & 3;
          const isInTheField = width === 3 ? type === 0 : isX64 && width === 2;
          if (isInTheField) contents ??= readFrom(section.offset, section.size);
          const inTheField = !isInTheField ? 0 : width === 3 ? contents!.readUInt32LE(field) + contents!.readInt32LE(field + 4) * 0x100000000 : contents!.readInt32LE(field);
          const text = stringWith(target.section, target.value + added + inTheField);
          if (text === undefined) result.stringsNotRead++;
          else to = "S" + text;
        }
        if (to[0] === "L" && sizeOfLiteralsIn(target.section) !== undefined) {
          const width = (word >>> 25) & 3;
          const isInTheField = width === 3 ? type === 0 : isX64 && width === 2;
          if (isInTheField) contents ??= readFrom(section.offset, section.size);
          const inTheField = !isInTheField ? 0 : width === 3 ? contents!.readUInt32LE(field) + contents!.readInt32LE(field + 4) * 0x100000000 : contents!.readInt32LE(field) + ({ 6: 1, 7: 2, 8: 4 }[type] ?? 0);
          referToLiteral(from, target.section, target.value + added + inTheField);
          continue;
        }
        refer(from, to);
        const isOfADoor = mayBeADoor(target.name);
        const canBeRead = isPlain && !isSubtracted && (section.flags & 0xff) !== 1;
        let seen = result.sightings.get(to);
        if (canBeRead && seen === undefined) result.sightings.set(to, (seen = new Map()));
        if (!isOfADoor && (!canBeRead || seen!.has(type))) continue;
        const length = (word >>> 25) & 3;
        const holdsAnAddend = canBeRead && (length === 3 ? type === 0 : isX64 && length === 2);
        if (holdsAnAddend) contents ??= readFrom(section.offset, section.size);
        const inTheObject = !holdsAnAddend ? 0 : length === 3 ? contents!.readUInt32LE(field) + contents!.readInt32LE(field + 4) * 0x100000000 : contents!.readInt32LE(field);
        const sighting = { from, offset: section.address + field - startAndAtomAt(index + 1, section.address + field)![0], inTheObject };
        if (canBeRead && !seen!.has(type)) seen!.set(type, sighting);
        if (isOfADoor) result.namingsOfDoors.push({ ...sighting, to, type: canBeRead && inTheObject === 0 ? type : -1 });
        continue;
      }
      const length = (word >>> 25) & 3;
      const behindTheField = isX64 && length === 2 ? [undefined, 0, 0, undefined, undefined, undefined, 1, 2, 4][type] : undefined;
      if (behindTheField === undefined && (type !== 0 || length !== 3)) {
        if (sizeOfLiteralsIn(word & 0xffffff) !== undefined) result.literalsNotRead++;
        continue;
      }
      contents ??= readFrom(section.offset, section.size);
      const address =
        behindTheField === undefined ? Number(contents.readBigUInt64LE(field)) : section.address + field + 4 + contents.readInt32LE(field) + behindTheField;
      const inSection = sections.findIndex(other => other.address <= address && address < other.address + other.size);
      if (holdsStrings(inSection + 1)) {
        refer(from, "S" + stringWith(inSection + 1, address)!);
        continue;
      }
      if (sizeOfLiteralsIn(inSection + 1) !== undefined) {
        referToLiteral(from, inSection + 1, address);
        continue;
      }
      const target = atomAt(inSection + 1, address);
      if (target === undefined) continue;
      refer(from, "L" + target);
      if (target.split("\x01").some(mayBeADoor)) result.namingsOfDoors.push({ from, offset: 0, inTheObject: 0, to: "L" + target, type: -1 });
    }
  });
  closeSync(fd);
  return result;
}

function* pointersInMachO(path: string): Generator<[at: number, target: number]> {
  const fd = openSync(path, "r");
  const commands = readAt(fd, 32, readAt(fd, 0, 32).readUInt32LE(20));
  const segments: { address: number; offset: number; size: number }[] = [];
  let fixups: Buffer | undefined;
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    const kind = commands.readUInt32LE(at);
    if (kind === 0x19) segments.push({ address: Number(commands.readBigUInt64LE(at + 24)), offset: Number(commands.readBigUInt64LE(at + 40)), size: Number(commands.readBigUInt64LE(at + 48)) });
    else if (kind === 0x80000034) fixups = readAt(fd, commands.readUInt32LE(at + 8), commands.readUInt32LE(at + 12));
  }
  const base = segments.find(segment => segment.offset === 0 && segment.size > 0)?.address ?? 0;
  const starts = fixups?.readUInt32LE(4) ?? 0;
  for (let index = 0; index < (fixups?.readUInt32LE(starts) ?? 0); index++) {
    const inSegment = fixups!.readUInt32LE(starts + 4 + index * 4);
    if (inSegment === 0) continue;
    const [sizeOfPage, format, pages] = [4, 6, 20].map(field => fixups!.readUInt16LE(starts + inSegment + field)) as [number, number, number];
    if (format !== 2 && format !== 6) continue;
    const { address, offset, size } = segments[index]!;
    const data = readAt(fd, offset, size);
    for (let page = 0; page < pages; page++) {
      const first = fixups!.readUInt16LE(starts + inSegment + 22 + page * 2);
      if (first === 0xffff) continue;
      for (let at = page * sizeOfPage + first; ; ) {
        const high = data.readUInt32LE(at + 4);
        if (high >>> 31 === 0) yield [address + at, data.readUInt32LE(at) + (high & 15) * 0x100000000 + (format === 6 ? base : 0)];
        const next = (high >>> 19) & 0xfff;
        if (next === 0) break;
        at += next * 4;
      }
    }
  }
  closeSync(fd);
}

function machOImageOf(path: string): Image {
  const fd = openSync(path, "r");
  const header = readAt(fd, 0, 32);
  const commands = readAt(fd, 32, header.readUInt32LE(20));
  const parts: { start: number; end: number; data: Buffer }[] = [];
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    if (commands.readUInt32LE(at) !== 0x19 || fixedName(commands, at + 8) === "__LINKEDIT") continue;
    const start = Number(commands.readBigUInt64LE(at + 24));
    const size = Number(commands.readBigUInt64LE(at + 48));
    if (size > 0) parts.push({ start, end: start + size, data: readAt(fd, Number(commands.readBigUInt64LE(at + 40)), size) });
  }
  closeSync(fd);
  return imageOfParts(parts, header.readUInt32LE(4) === 0x01000007 ? 62 : 183, true);
}

function addressGivenInMachO(image: Image, seen: Map<number, Sighting>, placeOf: (sighting: Sighting) => number | undefined): number | undefined {
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const is = (word: number, mask: number, bits: number) => (word & mask) >>> 0 === bits;
  const pointerAt = (address: number) => {
    const low = image.unsigned32(address);
    const high = image.unsigned32(address + 4);
    return low === undefined || high === undefined || high >>> 31 === 1 ? undefined : low + (high & 15) * 0x100000000;
  };
  const at = (type: number) => {
    const sighting = seen.get(type);
    const place = sighting && placeOf(sighting);
    return place === undefined ? undefined : { place, inTheObject: sighting!.inTheObject };
  };
  const pointer = at(0);
  const value = pointer && pointerAt(pointer.place);
  if (value !== undefined && value !== 0) return value - pointer!.inTheObject;
  if (image.machine === 62) {
    for (const type of [2, 1, 6, 7, 8, 3]) {
      const site = at(type);
      const field = site && image.signed32(site.place);
      if (field === undefined) continue;
      if (type === 3 && image.byte(site!.place - 2) !== 0x8d) continue;
      return field - site!.inTheObject + site!.place + 4;
    }
    return undefined;
  }
  const branch = at(2);
  const call = branch && image.unsigned32(branch.place);
  if (call !== undefined && is(call, 0x7c000000, 0x14000000)) return branch!.place + signed(call & 0x3ffffff, 26) * 4;
  for (const [pageType, lowType] of [[3, 4], [5, 6]] as const) {
    const high = at(pageType);
    const first = high && image.unsigned32(high.place);
    if (first === undefined) continue;
    const distance = signed((((first >>> 5) & 0x7ffff) << 2) | ((first >>> 29) & 3), 21);
    if (is(first, 0x9f000000, 0x10000000) && pageType === 3) return high!.place + distance;
    if (!is(first, 0x9f000000, 0x90000000)) continue;
    const page = high!.place - (high!.place % 4096) + distance * 4096;
    const low = at(lowType);
    const second = low && image.unsigned32(low.place);
    if (second === undefined) continue;
    const bits = (second >>> 10) & 0xfff;
    if (is(second, 0x7fc00000, 0x11000000)) return page + bits;
    if (!is(second, 0x3b000000, 0x39000000)) continue;
    const scale = (second >>> 26) & 1 && (second >>> 23) & 1 ? 4 : second >>> 30;
    if (pageType === 3) return page + bits * 2 ** scale;
    return pointerAt(page + bits * 8);
  }
  return undefined;
}

function placeToRewriteInMachO(image: Image, slotOf: Map<number, number>, type: number, place: number, door: number): Place | "none" | undefined {
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const is = (word: number, mask: number, bits: number) => (word & mask) >>> 0 === bits;
  const pageOf = (address: number) => address - (address % 4096);
  const slot = () => {
    const address = slotOf.get(door);
    return address === undefined ? undefined : { address, kind: pointer36 };
  };
  if (type === 0) {
    const low = image.unsigned32(place);
    const high = image.unsigned32(place + 4);
    return low !== undefined && high !== undefined && high >>> 31 === 0 && low + (high & 15) * 0x100000000 === door ? { address: place, kind: pointer36 } : undefined;
  }
  if (image.machine === 62) {
    const isDirect = type === 1 || type === 2 || (type === 3 && image.byte(place - 2) === 0x8d);
    if (isDirect) return (image.signed32(place) ?? NaN) + place + 4 === door ? { address: place, kind: add32 } : undefined;
    return type === 3 || type === 4 ? slot() : undefined;
  }
  const word = image.unsigned32(place);
  if (word === undefined) return undefined;
  const distance21 = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
  if (type === 2) return is(word, 0x7c000000, 0x14000000) && place + signed(word & 0x3ffffff, 26) * 4 === door ? { address: place, kind: branch26 } : undefined;
  if (type < 3 || type > 6) return undefined;
  if (word === 0xd503201f) return type === 4 || type === 6 ? { address: place, kind: nop } : "none";
  if ((type === 3 || type === 5) && is(word, 0x9f000000, 0x10000000)) return place + distance21 === door ? { address: place, kind: adr } : undefined;
  if (type === 3 || type === 5) {
    if (!is(word, 0x9f000000, 0x90000000)) return undefined;
    if (pageOf(place) + distance21 * 4096 === pageOf(door)) return { address: place, kind: page21 };
    return type === 5 ? "none" : undefined;
  }
  if (is(word, 0xffc00000, 0x91000000)) return ((word >>> 10) & 0xfff) === door % 4096 ? { address: place, kind: low12 } : undefined;
  return type === 6 ? slot() : undefined;
}

const isOneUnitOfAssembly = (output: string) => output === "__TEXT,__jsc_bytecode" || output === "__TEXT,__jsc_wasm";

function readMachOGraph(executable: string, mapPath: string, compiledFromBitcode: string[], exportedSymbols: string, doorsAmong: (functionName: Map<number, string>) => Iterable<number>): Graph {
  const strings = "__TEXT,__cstring";
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
      if (words.length >= 4) sections.push({ address: parseInt(words[0]!, 16), size: parseInt(words[1]!, 16), name: `${words[2]},${words[3]}` });
    } else if (stage === "Symbols") {
      const match = /^0x([0-9A-F]+)\s+0x([0-9A-F]+)\s+\[\s*(\d+)\] (.*)$/.exec(line);
      if (match === null) continue;
      const symbol = { address: parseInt(match[1]!, 16), size: parseInt(match[2]!, 16), file: Number(match[3]), name: match[4]! };
      if (symbol.size > 0) found.push(symbol);
      else folded.push(symbol);
    }
  }
  const literals = sections.find(section => section.name === "__TEXT,__literals");
  for (let at = 0; literals !== undefined && at + 4 <= literals.size; at += 4) found.push({ address: literals.address + at, size: 4, file: 0, name: `literal ${(literals.address + at).toString(16)}` });
  found.sort((a, b) => a.address - b.address);
  const listed = new Set([...files.values()].map(path => resolve(path)));
  for (const path of compiledFromBitcode) if (!listed.has(resolve(path))) files.set(files.size, path);
  const outputOf = (address: number) =>
    sections.find(section => section.address <= address && address < section.address + section.size)?.name ?? "?";
  const graph: Graph = {
    address: found.map(node => node.address),
    size: found.map(node => node.size),
    alignment: found.map(() => 64),
    output: [],
    object: found.map(node => files.get(node.file) ?? "?"),
    section: found.map(node => node.name),
    successors: [],
    roots: new Set(),
    functionName: new Map(),
    names: [],
    aliases: new Map(),
    externalNames: new Set(),
    unreadObjects: [],
    confirmedByTheBytes: 0,
    sentOn: 0,
    placesThatName: new Map(),
    namedInWaysThatCannotBeRewritten: new Map(),
    keptByAFlagAlone: new Set(),
    neverDoors: new Set(),
    otherNames: new Map(),
    hashOfString: new Map(),
    exported: new Set(),
    stringsHeld: undefined,
    boundElsewhere: [],
    isArm64: false,
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
    if (graph.output[index] === "__TEXT,__stubs" && local.has(node.file + "\0" + node.name)) return;
    local.set(node.file + "\0" + node.name, index);
    if (!byName.has(node.name)) byName.set(node.name, index);
    if (graph.output[index] === "__TEXT,__text") graph.functionName.set(index, node.name.replace(/^_/, ""));
  });
  const filesWithString = new Map<number, number[]>();
  for (const symbol of folded) {
    const node = atAddress.get(symbol.address);
    if (node === undefined) continue;
    if (graph.output[node] === strings) {
      const list = filesWithString.get(node);
      if (list === undefined) filesWithString.set(node, [symbol.file]);
      else list.push(symbol.file);
      continue;
    }
    if (!local.has(symbol.file + "\0" + symbol.name)) local.set(symbol.file + "\0" + symbol.name, node);
    if (!byName.has(symbol.name)) byName.set(symbol.name, node);
    const list = graph.aliases.get(node);
    if (list === undefined) graph.aliases.set(node, [[files.get(symbol.file) ?? "?", symbol.name]]);
    else list.push([files.get(symbol.file) ?? "?", symbol.name]);
  }
  const doorNodes = new Set(doorsAmong(graph.functionName));
  const namesOfDoors = new Set([...doorNodes].flatMap(node => [found[node]!.name, ...(graph.aliases.get(node) ?? []).map(([, name]) => name)]));
  const mayBeADoor = (name: string) => namesOfDoors.has(name);
  const objects = new Map<number, MachOReferences | undefined>();
  const external = new Map<string, number>();
  for (const [file, path] of files) {
    if (file === 0) continue;
    const read = readMachOObject(path, mayBeADoor);
    objects.set(file, read);
  }
  const underBitcode = new Map<string, number>();
  for (const symbol of [...found, ...folded]) {
    const node = objects.get(symbol.file) === undefined ? local.get(symbol.file + "\0" + symbol.name) : undefined;
    if (node !== undefined) underBitcode.set(symbol.name, node);
  }
  for (const [file, read] of objects) {
    for (const name of read?.externals ?? []) {
      let node = local.get(file + "\0" + name);
      if (node === undefined && (node = underBitcode.get(name)) !== undefined) {
        local.set(file + "\0" + name, node);
        if (found[node]!.name === name) {
          found[node]!.file = file;
          graph.object[node] = files.get(file)!;
        }
      }
      if (node !== undefined && !external.has(name)) external.set(name, node);
    }
  }
  const holdsAPiece = new Set(found.map(symbol => symbol.file));
  graph.unreadObjects = [...files]
    .filter(([file, path]) => file !== 0 && holdsAPiece.has(file) && objects.get(file) === undefined && !/\.(tbd|dylib)$/.test(path))
    .map(([file, path]) => `${path}: ${found.filter(symbol => symbol.file === file).slice(0, 3).map(symbol => symbol.name).join(", ")}`);
  graph.externalNames = new Set(external.keys());
  graph.isArm64 = ![...objects.values()].some(read => read?.isX64);
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
      const node = here(file, name) ?? anywhere(name);
      if (node !== undefined) graph.roots.add(node);
    }
    for (const name of [...read.calledByTheLoader, ...read.pieceOfEntry.keys(), ...read.pieceOfEntry.values()]) {
      const node = here(file, name) ?? anywhere(name);
      if (node !== undefined) graph.neverDoors.add(node);
    }
    for (const name of read.keptByAFlagAlone) {
      const node = here(file, name);
      if (node !== undefined) graph.keptByAFlagAlone.add(node);
    }
    for (const [source, targets] of read.references) {
      const from = here(file, source);
      if (from === undefined) continue;
      for (const target of targets) {
        if (target[0] === "S" || target[0] === "W") continue;
        const node = (target[0] === "L" ? here(file, target.slice(1)) : undefined) ?? anywhere(target.slice(1));
        if (node !== undefined && node !== from) successors[from]!.add(node);
      }
    }
  }
  const image = machOImageOf(executable);
  for (let index = 1; index < found.length; index++) {
    const end = found[index - 1]!.address + found[index - 1]!.size;
    const padding = found[index]!.address - end;
    const segmentOf = (output: string) => output.slice(0, output.indexOf(","));
    if (padding <= 0 || padding >= pageSize || segmentOf(graph.output[index - 1]!) !== segmentOf(graph.output[index]!) || graph.output[index - 1] === "__TEXT,__text") continue;
    if (/^\0*$/.test(image.text(end, padding) ?? "?")) graph.size[index - 1]! += padding;
  }
  found.forEach((node, index) => {
    const segmentOf = (output: string | undefined) => output?.slice(0, output.indexOf(","));
    if (segmentOf(graph.output[index]) === segmentOf(graph.output[index + 1])) return;
    const end = node.address + node.size;
    const padding = Math.min(Math.ceil(end / pageSize) * pageSize, found[index + 1]?.address ?? Infinity) - end;
    if (padding > 0 && /^\0*$/.test(image.text(end, padding) ?? "?")) graph.size[index]! += padding;
  });
  const stringWithText = new Map<string, number>();
  found.forEach((node, index) => {
    if (graph.output[index] !== strings) return;
    const text = image.text(node.address, node.size - 1)!;
    stringWithText.set(text, index);
    graph.hashOfString.set(index, Number(xxh3(Buffer.from(text, "latin1")) & 0x7fffffffn));
  });
  const filesThatNameString = new Map<number, Set<number>>();
  const namesString = (file: number, node: number) => {
    const files = filesThatNameString.get(node);
    if (files === undefined) filesThatNameString.set(node, new Set([file]));
    else files.add(file);
  };
  const stringWithExternalName = new Map<string, { text: string; file: number }>();
  for (const [file, read] of objects) for (const [name, text] of read?.textOfExternalName ?? []) stringWithExternalName.set(name, { text, file });
  let stringsNotFound = 0;
  let stringsElsewhere = 0;
  for (const [file, read] of objects) {
    if (read === undefined) continue;
    stringsNotFound += read.stringsNotRead;
    for (const [source, targets] of read.references) {
      const from = here(file, source);
      if (from === undefined) continue;
      for (const target of targets) {
        const named = target[0] === "G" ? stringWithExternalName.get(target.slice(1)) : undefined;
        if (target[0] !== "S" && named === undefined) continue;
        const node = stringWithText.get(named?.text ?? target.slice(1));
        if (node === undefined) {
          stringsNotFound++;
          continue;
        }
        successors[from]!.add(node);
        namesString(file, node);
        if (named !== undefined) namesString(named.file, node);
      }
    }
  }
  const nodeAt = (address: number) => {
    let low = 0;
    let high = found.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (found[middle]!.address <= address) low = middle + 1;
      else high = middle;
    }
    return low > 0 && address < found[low - 1]!.address + found[low - 1]!.size ? low - 1 : -1;
  };
  for (const [file, read] of objects) {
    if (read === undefined) continue;
    for (const [target, seen] of read.sightings) {
      const address = addressGivenInMachO(image, seen, sighting => {
        const from = here(file, sighting.from);
        return from === undefined ? undefined : found[from]!.address + sighting.offset;
      });
      const node = address === undefined ? -1 : nodeAt(address);
      if (target[0] === "S") {
        if (node === stringWithText.get(target.slice(1))) graph.confirmedByTheBytes++;
        else if (address !== undefined) stringsElsewhere++;
        continue;
      }
      if (node < 0 || found[node]!.file === 0 || !/^__(TEXT,__(text|const|bun_builtins|cstring)|DATA)/.test(graph.output[node]!)) continue;
      if (target[0] === "G" && node === stringWithText.get(stringWithExternalName.get(target.slice(1))?.text ?? "\0")) {
        graph.confirmedByTheBytes++;
        continue;
      }
      const isAnotherEntryOfIt = () => target[0] === "L" && [...read.pieceOfEntry].some(([entry, piece]) => piece === target.slice(1) && here(file, entry) === node);
      if (node === ((target[0] === "L" ? here(file, target.slice(1)) : undefined) ?? anywhere(target.slice(1))) || isAnotherEntryOfIt()) {
        graph.confirmedByTheBytes++;
        continue;
      }
      graph.boundElsewhere.push(`${files.get(file)} names ${target.slice(1).replaceAll("\x01", " | ")}, which lies in ${graph.object[node]}:${graph.section[node]}`);
      for (const [source, targets] of read.references) {
        const from = targets.has(target) ? here(file, source) : undefined;
        if (from !== undefined && from !== node) successors[from]!.add(node);
      }
    }
  }
  const cellsWith = new Map<string, number[]>();
  const firstCell = literals === undefined ? -1 : nodeAt(literals.address);
  for (const size of literals === undefined ? [] : [4, 8, 16]) {
    for (let at = 0; at + size <= literals.size; at += size) {
      const bytes = Buffer.from(image.text(literals.address + at, size)!, "latin1").toString("hex");
      const cells = cellsWith.get(bytes);
      if (cells === undefined) cellsWith.set(bytes, [firstCell + at / 4]);
      else cells.push(firstCell + at / 4);
    }
  }
  let literalsNotFollowed = 0;
  for (const [file, read] of objects) {
    if (read === undefined) continue;
    literalsNotFollowed += read.literalsNotRead;
    for (const [source, targets] of read.references) {
      const from = here(file, source);
      if (from === undefined) continue;
      for (const target of targets) {
        if (target[0] !== "W") continue;
        const cells = cellsWith.get(target.slice(1));
        if (cells === undefined) literalsNotFollowed++;
        for (const first of cells ?? []) for (let cell = first; cell < first + (target.length - 1) / 8; cell++) successors[from]!.add(cell);
      }
    }
  }
  if (literalsNotFollowed > 0) found.forEach((_, node) => void (graph.output[node] === "__TEXT,__literals" && graph.roots.add(node)));
  if (literals !== undefined) console.log(literalsNotFollowed > 0 ? `${literalsNotFollowed} references to literals could not be followed: no literal can go` : "every reference to a literal was followed by its bytes");
  const canMove = /^__(TEXT,__(text|const|bun_builtins|cstring)|DATA_CONST,__const)$/;
  const followTheBytes = (from: number, address: number) => {
    const to = nodeAt(address);
    if (from < 0 || to < 0 || from === to || found[from]!.file === 0 || found[to]!.file === 0 || !canMove.test(graph.output[to]!) || successors[from]!.has(to)) return;
    successors[from]!.add(to);
    for (const twin of successors[from]!) if (twin !== to && successors[twin]!.has(to) && (successors[twin]!.has(from) || successors[to]!.has(twin))) return;
    graph.boundElsewhere.push(`${graph.object[from]}:${graph.section[from]} holds the address of ${graph.object[to]}:${graph.section[to]}, which no name in it says`);
    if (!doorNodes.has(to)) return;
    const sources = graph.namedInWaysThatCannotBeRewritten.get(to);
    if (sources === undefined) graph.namedInWaysThatCannotBeRewritten.set(to, new Set([from]));
    else sources.add(from);
  };
  for (const [at, target] of pointersInMachO(executable)) followTheBytes(nodeAt(at), target);
  for (const { name, address, size } of graph.isArm64 ? sections : []) {
    if (name !== "__TEXT,__text") continue;
    const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
    let from = nodeAt(address);
    for (let at = address; at < address + size; at += 4) {
      while (from + 1 < found.length && found[from + 1]!.address <= at) from++;
      const word = image.unsigned32(at)!;
      if ((word & 0x7c000000) >>> 0 === 0x14000000) followTheBytes(from, at + signed(word & 0x3ffffff, 26) * 4);
      if ((word & 0x1f000000) >>> 0 !== 0x10000000) continue;
      const distance = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
      if (word >>> 31 === 0) {
        followTheBytes(from, at + distance);
        continue;
      }
      const next = image.unsigned32(at + 4) ?? 0;
      if (((next >>> 5) & 31) !== (word & 31)) continue;
      const page = at - (at % 4096) + distance * 4096;
      if ((next & 0x7fc00000) >>> 0 === 0x11000000) followTheBytes(from, page + ((next >>> 10) & 0xfff));
      else if ((next & 0x3b000000) >>> 0 === 0x39000000) followTheBytes(from, page + ((next >>> 10) & 0xfff) * 2 ** ((next >>> 30) + ((next >>> 26) & (next >>> 23) & 1) * 4));
    }
  }
  const slotOf = new Map<number, number>();
  for (const { name, address, size } of sections) {
    if (name !== "__DATA_CONST,__got" && name !== "__DATA,__got") continue;
    for (let slot = address; slot < address + size; slot += 8) {
      const high = image.unsigned32(slot + 4) ?? 0x80000000;
      if (high >>> 31 === 0) slotOf.set(image.unsigned32(slot)! + (high & 15) * 0x100000000, slot);
    }
  }
  for (const [file, read] of objects) {
    for (const naming of read?.namingsOfDoors ?? []) {
      const door = (naming.to[0] === "L" ? here(file, naming.to.slice(1)) : undefined) ?? anywhere(naming.to.slice(1));
      const from = here(file, naming.from);
      if (door === undefined || from === undefined || !doorNodes.has(door)) continue;
      const place = naming.type < 0 ? undefined : placeToRewriteInMachO(image, slotOf, naming.type, found[from]!.address + naming.offset, found[door]!.address);
      if (place === "none") continue;
      if (place === undefined) {
        const sources = graph.namedInWaysThatCannotBeRewritten.get(door);
        if (sources === undefined) graph.namedInWaysThatCannotBeRewritten.set(door, new Set([from]));
        else sources.add(from);
        continue;
      }
      let byNode = graph.placesThatName.get(door);
      if (byNode === undefined) graph.placesThatName.set(door, (byNode = new Map()));
      byNode.set(from, [...(byNode.get(from) ?? []), place]);
    }
  }
  for (let index = 1; index < found.length; index++) {
    if (!isOneUnitOfAssembly(graph.output[index]!) || graph.output[index - 1] !== graph.output[index]) continue;
    successors[index - 1]!.add(index);
    successors[index]!.add(index - 1);
  }
  graph.successors = successors.map(set => [...set]);
  found.forEach((node, index) => {
    if (graph.output[index] === "__TEXT,__literals") return;
    if (node.file === 0 || objects.get(node.file) === undefined || (graph.output[index]!.startsWith("__TEXT,__jsc_") && !isOneUnitOfAssembly(graph.output[index]!))) graph.roots.add(index);
  });
  if (stringsNotFound + stringsElsewhere > 0) graph.stringsHeld = `${stringsNotFound} references to strings lead to none that the map holds and ${stringsElsewhere} lead elsewhere by the bytes: no string can go`;
  let namedInWaysNotSeen = 0;
  for (const index of graph.hashOfString.keys()) {
    const isSeen = (file: number) => filesThatNameString.get(index)?.has(file) === true;
    if (graph.stringsHeld === undefined && isSeen(found[index]!.file) && (filesWithString.get(index) ?? []).every(isSeen)) continue;
    graph.roots.add(index);
    namedInWaysNotSeen++;
  }
  graph.stringsHeld ??= `${graph.hashOfString.size - namedInWaysNotSeen} strings are followed by their text; ${namedInWaysNotSeen} more lie in an input in which nothing was seen to name them, and stay`;
  const main = external.get("_main");
  if (main !== undefined) graph.roots.add(main);
  for (const line of readFileSync(exportedSymbols, "utf8").split("\n")) {
    const node = external.get(line.trim());
    if (node !== undefined) graph.exported.add(node);
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
  thin: Set<number>;
  whyFat: Map<number, string>;
  plainName: Map<number, string>;
  core: Set<number>;
  neededBy: Map<number, string>;
  unexplained: number;
  foldedOpen: number;
  tooSmall: number;
  neverDoors: number;
  calledDirectly: number;
  conditions: Doors["conditions"];
}

const bytesToShut = (graph: Graph, door: Door) => (graph.isArm64 ? (door.whenShut === "exit" ? 12 : 8) : door.whenShut === "exit" ? 10 : 3);

const plainNames = new Map<string, string>();

function demangle(demangler: string, names: string[]): string[] {
  const unknown = [...new Set(names)].filter(name => !plainNames.has(name));
  if (unknown.length > 0) {
    const demangled = spawnSync(demangler, [], { input: unknown.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 30 });
    if (demangled.status !== 0) fail(`${demangler} failed`);
    const lines = demangled.stdout.split("\n");
    unknown.forEach((name, index) => plainNames.set(name, lines[index]!.replace(/ \(\.llvm\.\d+\)$/, "")));
  }
  return names.map(name => plainNames.get(name)!);
}

function startOfOwnName(plainName: string): number {
  let depth = 0;
  let start = 0;
  for (let at = 0; at < plainName.length; at++) {
    const character = plainName[at];
    if (character === "(" && depth === 0 && !plainName.startsWith("(anonymous namespace)", at)) break;
    if (character === "<" || character === "(" || character === "[") depth++;
    else if (character === ">" || character === ")" || character === "]") depth--;
    else if (character === " " && depth === 0) start = at + 1;
  }
  return start;
}

function isDoorFor(door: Door, plainName: string): boolean {
  const match = door.pattern.exec(plainName);
  return match !== null && match.index + match[0].length > startOfOwnName(plainName);
}

function functionOfSection(section: string): string | undefined {
  return /^\.text\.(?:unlikely\.|hot\.|startup\.|exit\.)?(.+)$/.exec(section)?.[1];
}

const doorOfName = new Map<string, Door | undefined>();

function doorOf(declared: Doors, plainName: string): Door | undefined {
  if (!doorOfName.has(plainName)) doorOfName.set(plainName, declared.doors.find(door => isDoorFor(door, plainName)));
  return doorOfName.get(plainName);
}

function nodesThatMatchADoor(functionName: Map<number, string>, declared: Doors, demangler: string): number[] {
  const nodes = [...functionName.keys()];
  const plain = demangle(demangler, nodes.map(node => functionName.get(node)!));
  return nodes.filter((_, index) => doorOf(declared, plain[index]!) !== undefined);
}

const largestFatDoor = 32;

function doorsThatCanBeThin(graph: Graph, doors: Map<number, Door>, whyFat: Map<number, string>): Set<number> {
  const thin = new Set<number>();
  for (const [node] of doors) {
    const why =
      graph.size[node]! <= largestFatDoor
        ? "it is small"
        : graph.roots.has(node)
          ? "it is a root"
          : graph.exported.has(node)
            ? "the executable exports it"
            : !graph.placesThatName.has(node)
              ? "no place that names it was read"
              : undefined;
    if (why === undefined) thin.add(node);
    else whyFat.set(node, why);
  }
  const spell = (node: number) => `${graph.object[node]!.slice(graph.object[node]!.lastIndexOf("/") + 1)}:${graph.section[node]}`;
  const itsOwn = new Map<number, number>();
  const fatten = (door: number, why: string) => {
    thin.delete(door);
    whyFat.set(door, why);
  };
  graph.successors.forEach((list, node) => {
    for (const next of list) {
      if (!thin.has(next) || next === node) continue;
      const places = graph.placesThatName.get(next)!.get(node);
      const ascending = [...new Map((places ?? []).map(place => [place.address, place])).values()].sort((a, b) => a.address - b.address);
      const canBeSaid = places !== undefined && groupsOfPlaces(ascending) !== undefined;
      const isRewritten = canBeSaid && graph.namedInWaysThatCannotBeRewritten.get(next)?.has(node) !== true;
      if (isRewritten) continue;
      if (itsOwn.has(node) || doors.has(node)) fatten(next, `a reference in ${spell(node)} cannot be rewritten`);
      else itsOwn.set(node, next);
    }
  });
  graph.successors.forEach((list, node) => {
    for (const next of list) {
      const door = itsOwn.get(next);
      if (door !== undefined && node !== door && node !== next && thin.has(door)) fatten(door, `a reference in ${spell(next)}, which ${spell(node)} names too, cannot be rewritten`);
    }
  });
  for (const [node, door] of itsOwn) if (graph.roots.has(node) && thin.has(door)) fatten(door, `a reference in ${spell(node)}, a root, cannot be rewritten`);
  return thin;
}

const fillsTheRuntimeTable = (plainName: string) => /^JSC::AOT::(RuntimeTable::RuntimeTable|runtimeTable)\(/.test(plainName);

function operationsThatOtherCodeNames(graph: Graph, doors: Map<number, Door>, plainName: Map<number, string>): number[] {
  const namersOf = (wanted: (node: number) => boolean) => {
    const namers = new Map<number, number[]>();
    graph.successors.forEach((list, node) => {
      for (const next of list) {
        if (next === node || !wanted(next)) continue;
        const known = namers.get(next);
        if (known === undefined) namers.set(next, [node]);
        else known.push(node);
      }
    });
    return namers;
  };
  const ofOperations = namersOf(node => doors.get(node)?.isOperation === true);
  const fillsTheTable = (node: number) => fillsTheRuntimeTable(plainName.get(node) ?? "");
  const others = new Set([...ofOperations.values()].flat().filter(node => !fillsTheTable(node)));
  const ofOthers = namersOf(node => others.has(node));
  const isItsOwn = (node: number, operation: number) => !graph.functionName.has(node) && !graph.roots.has(node) && (ofOthers.get(node) ?? []).every(namer => namer === operation);
  return [...ofOperations].filter(([operation, namers]) => !namers.every(node => fillsTheTable(node) || isItsOwn(node, operation))).map(([operation]) => operation);
}

function analyze(graph: Graph, declared: Doors, demangler: string, foldedAway: string[]): Analysis {
  const nodes = [...graph.functionName.keys()];
  const plain = demangle(demangler, nodes.map(node => graph.functionName.get(node)!));
  const plainName = new Map(nodes.map((node, index) => [node, plain[index]!]));
  const doors = new Map<number, Door>();
  const matched = new Set<Door>();
  for (const [node, name] of plainName) {
    if (name.replace(/^_/, "") === "Bun__trimmedOut") graph.roots.add(node);
    const door = doorOf(declared, name);
    if (door !== undefined) {
      doors.set(node, door);
      matched.add(door);
    }
  }
  for (const name of demangle(demangler, foldedAway)) {
    for (const door of declared.doors) if (isDoorFor(door, name)) matched.add(door);
  }
  for (const door of declared.doors) {
    if (!matched.has(door) && !declared.smallest.has(door.feature)) fail(`no function matches the door ${door.pattern.source}`);
  }
  const sharers = new Map<number, string[]>();
  for (const [node, aliases] of graph.aliases) if (doors.has(node)) sharers.set(node, aliases.map(([, name]) => name.replace(/^_/, "")));
  for (const [node, names] of graph.otherNames) if (doors.has(node)) sharers.set(node, [...(sharers.get(node) ?? []), ...names]);
  const folded = [...sharers];
  const plainAliases = demangle(demangler, folded.flatMap(([, names]) => names));
  let foldedOpen = 0;
  let aliasAt = 0;
  const otherPlainNames = new Map<number, string[]>();
  for (const [node, aliases] of folded) {
    const names = plainAliases.slice(aliasAt, (aliasAt += aliases.length));
    const door = doors.get(node)!;
    otherPlainNames.set(node, names);
    const others = names.map(name => declared.doors.find(other => isDoorFor(other, name)));
    if (others.every(other => other?.whenShut === door.whenShut)) {
      const members = new Set([door.feature, ...others.map(other => other!.feature)]);
      if (members.size > 1) doors.set(node, { ...door, feature: declared.features.map(feature => feature.name).filter(name => members.has(name)).join(",") });
      continue;
    }
    doors.delete(node);
    foldedOpen++;
  }
  graph.section.forEach((name, node) => {
    if (/^\.(preinit_array|init_array|fini_array|ctors|dtors)\b|^\.CRT\$X/.test(name)) for (const next of graph.successors[node]!) graph.neverDoors.add(next);
  });
  let neverDoors = 0;
  for (const node of graph.neverDoors) if (doors.delete(node)) neverDoors++;
  let tooSmall = 0;
  for (const [node, door] of doors) {
    if (graph.size[node]! >= bytesToShut(graph, door)) continue;
    doors.delete(node);
    tooSmall++;
  }
  const calledDirectly = operationsThatOtherCodeNames(graph, doors, plainName);
  for (const node of calledDirectly) doors.delete(node);
  const namedByTheRuntimeTable = new Set<number>();
  for (const [filler, name] of plainName) {
    if (fillsTheRuntimeTable(name)) for (const node of graph.successors[filler]!) namedByTheRuntimeTable.add(node);
  }
  const conditions = [...doors]
    .filter(([node, door]) => door.isOperation || (namedByTheRuntimeTable.has(node) && plainName.get(node)!.startsWith("operation")))
    .flatMap(([node, door]) => {
      const featureOf = (name: string) => (door.feature.includes(",") ? declared.doors.find(other => isDoorFor(other, name))!.feature : door.feature);
      return [plainName.get(node)!, ...(otherPlainNames.get(node) ?? [])].map(name => ({ feature: featureOf(name), kind: "operation", name }));
    });
  const calledByWhatIsLoaded: number[] = [];
  for (const node of graph.exported) {
    const door = doors.get(node);
    const isOfAnother = door !== undefined && !door.feature.split(",").every(feature => declared.loadNativeCode.includes(feature));
    if (declared.loadNativeCode.length === 0 || graph.roots.has(node) || isOfAnother) graph.roots.add(node);
    else calledByWhatIsLoaded.push(node);
  }
  const explained = reach(graph, [...graph.roots, ...graph.keptByAFlagAlone, ...calledByWhatIsLoaded], new Map());
  let unexplained = 0;
  for (let node = 0; node < graph.address.length; node++) {
    if (explained.has(node)) continue;
    graph.roots.add(node);
    unexplained += graph.size[node]!;
  }
  const core = reach(graph, graph.roots, doors);
  const whyFat = new Map<number, string>();
  const thin = doorsThatCanBeThin(graph, doors, whyFat);
  for (const node of thin) core.delete(node);
  const neededBy = new Map<number, string>();
  for (const { name } of declared.features) {
    const behind: number[] = [];
    for (const [node, door] of doors) if (door.feature.split(",").includes(name)) behind.push(...graph.successors[node]!);
    if (declared.loadNativeCode.includes(name)) behind.push(...calledByWhatIsLoaded);
    for (const node of reach(graph, behind, doors)) {
      if (!core.has(node)) neededBy.set(node, neededBy.has(node) ? neededBy.get(node) + "," + name : name);
    }
  }
  const bytesOfSet = new Map<string, number>();
  for (const [node, features] of neededBy) bytesOfSet.set(features, (bytesOfSet.get(features) ?? 0) + graph.size[node]!);
  const largeSets = [...bytesOfSet].filter(([, bytes]) => bytes >= 4 * smallestIsland).map(([features]) => ({ features, members: new Set(features.split(",")) }));
  const placeOf = new Map(declared.features.map((feature, index) => [feature.name, index]));
  const lastOf = (members: Set<string>) => Math.max(...[...members].map(member => placeOf.get(member)!));
  const joins = new Map<string, string>();
  for (const [features, bytes] of bytesOfSet) {
    if (bytes >= smallestIsland) continue;
    const members = features.split(",");
    const holders = largeSets.filter(set => members.every(member => set.members.has(member)));
    holders.sort((a, b) => lastOf(a.members) - lastOf(b.members) || a.members.size - b.members.size || (a.features < b.features ? -1 : 1));
    if (holders.length > 0) joins.set(features, holders[0]!.features);
  }
  for (const [node, features] of neededBy) if (joins.has(features) && !doors.has(node)) neededBy.set(node, joins.get(features)!);
  for (const node of thin) neededBy.set(node, doors.get(node)!.feature);
  return { doors, thin, whyFat, plainName, core, neededBy, unexplained, foldedOpen, tooSmall, neverDoors, calledDirectly: calledDirectly.length, conditions };
}

function staysAsDoor(analysis: Analysis, node: number): boolean {
  const door = analysis.doors.get(node);
  return door !== undefined && analysis.neededBy.get(node) !== door.feature;
}

function nameSections(path: string, wanted: Set<string>, prefix: string): [string, string][] {
  const elf = openElf(path, "r+") ?? fail(`${path} is not an ELF file`);
  const tableIndexes = [2, 18].map(type => elf.sections.findIndex(section => section.type === type));
  const [symbolsIndex, extendedIndex] = tableIndexes as [number, number];
  if (symbolsIndex < 0) fail(`${path} has no symbol table`);
  const stringsIndex = elf.sections[symbolsIndex]!.link;
  const named: [string, string][] = [];
  const symbols: Buffer[] = [];
  const extended: Buffer[] = [];
  let strings = "";
  elf.sections.forEach((section, index) => {
    const isLoadedAndReadOnly = section.type === 1 && (section.flags & 2) !== 0 && (section.flags & 0x11) === 0;
    if (!isLoadedAndReadOnly || !wanted.has(section.name) || (index >= 0xff00 && extendedIndex < 0)) return;
    const name = `${prefix}_${index}`;
    const symbol = Buffer.alloc(24);
    symbol.writeUInt32LE(elf.sections[stringsIndex]!.size + strings.length, 0);
    symbol[4] = 0x10;
    symbol[5] = 2;
    symbol.writeUInt16LE(index >= 0xff00 ? 0xffff : index, 6);
    symbols.push(symbol);
    const wide = Buffer.alloc(4);
    wide.writeUInt32LE(index >= 0xff00 ? index : 0);
    extended.push(wide);
    strings += name + "\0";
    named.push([section.name, name]);
  });
  const grow = (index: number, more: Buffer) => {
    const section = elf.sections[index]!;
    const end = Math.ceil(fstatSync(elf.fd).size / 8) * 8;
    const whole = Buffer.concat([readAt(elf.fd, section.offset, section.size), more]);
    writeSync(elf.fd, whole, 0, whole.length, end);
    const place = Buffer.alloc(16);
    place.writeBigUInt64LE(BigInt(end), 0);
    place.writeBigUInt64LE(BigInt(whole.length), 8);
    writeSync(elf.fd, place, 0, 16, elf.sectionHeadersOffset + index * 64 + 24);
  };
  if (named.length > 0) {
    grow(symbolsIndex, Buffer.concat(symbols));
    grow(stringsIndex, Buffer.from(strings, "latin1"));
    if (extendedIndex >= 0) grow(extendedIndex, Buffer.concat(extended));
  }
  closeSync(elf.fd);
  return named;
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
  planPath: string | undefined;
  freshPlanPath: string | undefined;
  assemble(name: string, text: string): string;
  link(name: string, rewrite: (path: string) => string | undefined, first: string[], last: string[], runs?: boolean, without?: RegExp): Link;
}

interface ListedDoor extends TableDoor {
  size: number;
}

interface NamedBytes {
  symbols: [string, number][];
  between(start: number, end: number): Buffer | undefined;
}

function namedBytesOfElf(executable: string): NamedBytes | undefined {
  const elf = openElf(executable, "r");
  if (elf === undefined) return undefined;
  const table = elf.sections.find(section => section.type === 2) ?? fail(`${executable} has no symbol table`);
  const symbols = readAt(elf.fd, table.offset, table.size);
  const strings = readAt(elf.fd, elf.sections[table.link]!.offset, elf.sections[table.link]!.size);
  const named: [string, number][] = [];
  for (let at = 0; at < symbols.length; at += 24) {
    const section = symbols.readUInt16LE(at + 6);
    if (section === 0 || (section >= 0xff00 && section < 0xffff) || (symbols[at + 4]! & 15) === 6) continue;
    if (section < 0xff00 && (elf.sections[section]!.flags & 2) === 0) continue;
    const name = stringAt(strings, symbols.readUInt32LE(at));
    if (!name.startsWith("$")) named.push([name, Number(symbols.readBigUInt64LE(at + 8))]);
  }
  closeSync(elf.fd);
  return {
    symbols: named,
    between(start, end) {
      const section = elf.sections.find(section => (section.flags & 2) !== 0 && section.address <= start && end <= section.address + section.size);
      if (section === undefined) return undefined;
      const fd = openSync(executable, "r");
      const bytes = readAt(fd, section.offset + (start - section.address), end - start);
      closeSync(fd);
      return bytes;
    },
  };
}

function dataPackagesOf(linked: NamedBytes | undefined, graph: Graph, declared: Doors, kept: RegExp[]): DataPackage[] {
  if (linked === undefined) return [];
  const starts = linked.symbols.filter(([name]) => /^icudt\d+_dat$/.test(name)).map(([, address]) => address);
  return [...new Set(starts)].map(start => {
    const node = graph.address.findIndex((address, node) => address <= start && start < address + graph.size[node]!);
    if (node < 0) fail("ICU's data package lies in no section");
    const end = linked.symbols.reduce((end, [, address]) => (address > start && address < end ? address : end), graph.address[node]! + graph.size[node]!);
    const items = itemsOf(linked.between(start, end) ?? fail("ICU's data package lies in no section"));
    const runs = runsOf(items, declared.data, declared.features.map(feature => feature.name), kept);
    const held = new Map<string, number>();
    for (const run of runs) {
      const bytes = items.slice(run.first, run.first + run.count).reduce((sum, item) => sum + item.size, 0);
      held.set(run.features, (held.get(run.features) ?? 0) + bytes);
    }
    console.log(
      `ICU's data: ${items.length} items, ${megabytes(end - start)}, of which can go, in ${runs.length} runs: ` + [...held].map(([features, bytes]) => `${features} ${megabytes(bytes)}`).join(", "),
    );
    return { start, end, runs };
  });
}

function tableOf(declared: Doors, conditions: Doors["conditions"], stub: number, islands: Range[], doors: ListedDoor[], packages: DataPackage[], isWindows: boolean): Buffer {
  const smallest = (whenShut: string) => {
    const sizes = doors.filter(door => door.whenShut === whenShut && door.places === undefined).map(door => door.size);
    return sizes.length > 0 ? Math.min(...sizes) : 0;
  };
  try {
    return encodeTable({
      stub,
      smallestDoor: { exit: smallest("exit"), return: smallest("return") },
      features: declared.features.map(feature => feature.name),
      conditions: [...declared.conditions, ...conditions],
      islands: [...islands].sort((a, b) => a.start - b.start),
      doors,
      packages,
      publicNames: declared.publicNames,
      libraries: declared.libraries.filter(library => isWindows || !library.isOnlyOnWindows).map(({ name, features }) => ({ name, features })),
    });
  } catch (error) {
    fail((error as Error).message);
  }
}

function pairsToArgue(graph: Graph, check: Analysis, declared: Doors, spell: (node: number) => string): string[] {
  const follows = new Map<string, string[]>();
  const facts = new Map<string, string[]>();
  for (const { feature, kind, name } of declared.conditions) {
    const lists = kind === "feature" ? follows : facts;
    lists.set(feature, [...(lists.get(feature) ?? []), kind === "feature" ? name : `${kind} ${name}`]);
  }
  const keptWith = (feature: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(feature)) return seen;
    seen.add(feature);
    for (const other of follows.get(feature) ?? []) keptWith(other, seen);
    return seen;
  };
  const factsOf = (feature: string) => new Set([...keptWith(feature)].flatMap(other => facts.get(other) ?? []));
  const isKeptWith = (door: string, namer: string) => {
    const ofTheNamer = factsOf(namer);
    const ofTheDoor = factsOf(door);
    return keptWith(door).has(namer) || (!follows.has(namer) && ofTheNamer.size === 0) || (ofTheNamer.size > 0 && [...ofTheNamer].every(fact => ofTheDoor.has(fact)));
  };
  const found = new Map<string, string[]>();
  graph.successors.forEach((list, node) => {
    const holders = (check.doors.get(node)?.feature ?? check.neededBy.get(node))?.split(",");
    if (holders === undefined) return;
    for (const next of list) {
      const members = check.doors.get(next)?.feature.split(",");
      if (members === undefined) continue;
      for (const holder of holders) {
        if (members.includes(holder) || members.some(member => isKeptWith(member, holder))) continue;
        const pair = `${members.join(",")} <- ${holder}`;
        if (declared.argued.some(({ door, namer }) => door.test(members.join(",")) && namer.test(holder))) continue;
        found.set(pair, [...(found.get(pair) ?? []), `${spell(next)} <- ${spell(node)}`]);
      }
    }
  });
  return [...found]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pair, references]) => `${pair}: ${references.length} references\n` + references.slice(0, 3).map(reference => `    ${reference.slice(0, 220)}\n`).join(""));
}

function listedDoors(graph: Graph, check: Analysis, declared: Doors, work: string, featuresOfIslandAt: (node: number) => string | undefined): ListedDoor[] {
  const listed: (ListedDoor & { node: number })[] = [];
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
  const spell = (node: number) => check.plainName.get(node) ?? `${graph.object[node]!.slice(graph.object[node]!.lastIndexOf("/") + 1)}:${graph.section[node]}`;
  for (const [node, door] of check.doors) {
    const members = door.feature.split(",");
    if (check.thin.has(node)) {
      const places = new Map<number, Place>();
      for (const [by, list] of graph.placesThatName.get(node)!) {
        const goesNoLater = !check.core.has(by) && check.neededBy.get(by)?.split(",").every(feature => members.includes(feature)) === true;
        if (!goesNoLater) for (const place of list) places.set(place.address, place);
      }
      if (places.size === 0) continue;
      const ascending = [...places.values()].sort((a, b) => a.address - b.address);
      listed.push({ address: graph.address[node]!, size: graph.size[node]!, feature: door.feature, whenShut: door.whenShut, node, places: ascending });
      continue;
    }
    if (featuresOfIslandAt(node) === door.feature) continue;
    if (door.whenShut === "exit" && graph.successors[node]!.every(next => check.core.has(next))) continue;
    if (graph.size[node]! < bytesToShut(graph, door)) fail(`the door ${check.plainName.get(node)} has ${graph.size[node]} bytes: too few to be shut`);
    listed.push({ address: graph.address[node]!, size: graph.size[node]!, feature: door.feature, whenShut: door.whenShut, node });
  }
  const ordered = inTableOrder(declared.features.map(feature => feature.name), listed);
  const review = ordered.map(
    ({ node, feature, size }, number) =>
      `${number} ${feature} ${size} ${check.plainName.get(node)}${check.thin.has(node) ? "" : ` (fat: ${check.whyFat.get(node)})`}\n` + [...new Set((namedBy.get(node) ?? []).map(spell))].map(by => `    ${by}\n`).join(""),
  );
  writeFileSync(join(work, "doors.txt"), review.join(""));
  const pairs = pairsToArgue(graph, check, declared, spell);
  writeFileSync(join(work, "pairs.txt"), pairs.join(""));
  if (declared.argued.length > 0 && pairs.length > 0) {
    fail(`${pairs.length} times code of one feature names a door of another, no condition keeps the second wherever the first is kept, and no line "argued" says why that is right:\n` + pairs.join(""));
  }
  if (process.env.BUILDKITE !== undefined) {
    console.log(
      "the doors by number, and the first that names each:\n" +
        ordered.map(({ node, feature }, number) => `door ${number} ${feature} ${check.plainName.get(node)} <- ${(namedBy.get(node) ?? []).slice(0, 1).map(spell).join("")}`.slice(0, 240)).join("\n"),
    );
    console.log(`${pairs.length} times code of one feature names a door of another that the conditions do not keep with it:\n` + pairs.map(pair => pair.split("\n").slice(0, 2).join("\n").slice(0, 400)).join("\n"));
  }
  return ordered;
}

function whatHolds(graph: Graph, analysis: Analysis, declared: Doors, feature: string): string {
  const behind = (name: string) => {
    const starts: number[] = [];
    for (const [node, door] of analysis.doors) if (door.feature.split(",").includes(name)) starts.push(...graph.successors[node]!);
    return reach(graph, starts, analysis.doors);
  };
  const others = new Map<number, number>();
  for (const node of behind(feature)) if (analysis.core.has(node) && !analysis.doors.has(node)) others.set(node, 0);
  for (const { name } of declared.features) {
    if (name !== feature) for (const node of behind(name)) if (others.has(node)) others.set(node, others.get(node)! + 1);
  }
  const namedBy = new Map<number, number>();
  const queue = [...graph.roots];
  for (const root of queue) namedBy.set(root, -1);
  for (const node of queue) {
    if (analysis.doors.has(node)) continue;
    for (const next of graph.successors[node]!) if (!namedBy.has(next)) (namedBy.set(next, node), queue.push(next));
  }
  const spell = (node: number) => `${analysis.plainName.get(node) ?? graph.section[node]} (${graph.object[node]!.slice(graph.object[node]!.lastIndexOf("/") + 1)}, ${graph.size[node]} bytes)`.slice(0, 200);
  const its = [...others].filter(([, count]) => count <= 1).map(([node]) => node);
  const firstOfItsKind = its.filter(node => !others.has(namedBy.get(node)!) || others.get(namedBy.get(node)!)! > 1);
  return (
    `\n  ${megabytes(its.reduce((sum, node) => sum + graph.size[node]!, 0))} in ${its.length} pieces lie behind its doors, behind at most one other feature's, and stay; where what stays first comes to them:` +
    firstOfItsKind
      .sort((a, b) => graph.size[b]! - graph.size[a]!)
      .slice(0, 12)
      .map(node => {
        const chain: string[] = [];
        for (let at = node; at >= 0 && chain.length < 6; at = namedBy.get(at)!) chain.push(spell(at));
        return "\n  " + chain.join("\n      <- ");
      })
      .join("")
  );
}

const goesByFacts = (declared: Doors, feature: string) =>
  declared.conditions.some(condition => condition.feature === feature) || declared.doors.some(door => door.isOperation && door.feature === feature);

function islandsBySize(graph: Graph, analysis: Analysis, declared: Doors, isMovable: (output: string) => boolean) {
  const bytesOf = new Map<string, number>();
  for (const [node, features] of analysis.neededBy) {
    if (isMovable(graph.output[node]!)) bytesOf.set(features, (bytesOf.get(features) ?? 0) + graph.size[node]!);
  }
  const rankOf = new Map(declared.features.map((feature, index) => [feature.name, index]));
  const firstThatAlwaysGoes = declared.features.findIndex(feature => !goesByFacts(declared, feature.name));
  const rank = (features: string) => {
    const ranks = features.split(",").map(feature => rankOf.get(feature)!);
    const aheadOfWhatAlwaysGoes = ranks.filter(rank => rank < firstThatAlwaysGoes);
    return aheadOfWhatAlwaysGoes.length > 0 ? Math.min(...aheadOfWhatAlwaysGoes) : Math.max(...ranks);
  };
  const islands = [...bytesOf.keys()]
    .filter(features => bytesOf.get(features)! >= smallestIsland)
    .sort((a, b) => rank(a) - rank(b) || bytesOf.get(b)! - bytesOf.get(a)!);
  if (islands.length === 0) {
    fail(
      `nothing lies behind the ${analysis.doors.size} doors: ${graph.address.length} sections, ` +
        `${graph.successors.reduce((sum, list) => sum + list.length, 0)} references, ${graph.roots.size} roots, ` +
        `${megabytes(analysis.unexplained)} that nothing names, ${graph.unreadObjects.length} inputs that could not be read` +
        graph.unreadObjects.slice(0, 5).map(object => `\n  ${object}`).join(""),
    );
  }
  for (const [feature, smallest] of declared.smallest) {
    const bytes = islands.filter(features => features.split(",").includes(feature)).reduce((sum, features) => sum + bytesOf.get(features)!, 0);
    if (bytes >= 2 * smallest) continue;
    const said = `${megabytes(bytes)} can go with ${feature}, which is to be at least ${megabytes(smallest)}: something that stays names the rest:` + whatHolds(graph, analysis, declared, feature);
    if (bytes < smallest) fail(said);
    console.log(said);
  }
  return { islands, bytesOf, numberOf: new Map(islands.map((features, index) => [features, index + 1])) };
}

interface FreshPlan extends Plan {
  bytesOf: Map<string, number>;
  nodes: number[];
  nameless: Map<string, Map<string, number>>;
}

interface Format {
  keepsDoorsApart: boolean;
  isWindows?: boolean;
  linksTheSameInputsAgain?: boolean;
  namedBytes?(link: Link): NamedBytes;
  isMovable(output: string): boolean;
  canBeOverwritten?(output: string): boolean;
  support(room: number): string[];
  laidAheadOfTheOthers?: string[];
  flags: string[];
  onlyInTheFirstLink: string[];
  notInTheFirstLink: RegExp | undefined;
  flagsFor(plan: Plan): string[];
  compiledBy(link: "first" | "second"): string[];
  prepared?(path: string): string;
  prepareWhatWasCompiled?(objects: string[]): boolean;
  makesItsOwnPlan?: boolean;
  read(link: Link): Graph;
  planFrom(graph: Graph, analysis: Analysis): FreshPlan;
  nameTheNameless(plan: FreshPlan, ours: string[]): Map<string, string>;
  stub(graph: Graph, analysis: Analysis): number | undefined;
  write(table: Buffer): void;
  tidyUp(): void;
}

function layOut({ work, declared, demangler, planPath, freshPlanPath, link }: Linker, format: Format): void {
  const foldedNames = (graph: Graph) => [...graph.aliases.values()].flat().map(([, name]) => name.replace(/^_/, ""));
  const isDoor = (plainName: string) => declared.doors.some(door => isDoorFor(door, plainName));
  const foldedDoors = (graph: Graph, analysis: Analysis) => {
    if (!format.keepsDoorsApart) return [];
    const names = foldedNames(graph);
    const plain = demangle(demangler, names);
    const swallowed = names.filter((_, index) => isDoor(plain[index]!));
    const open = [...graph.aliases.keys()].filter(node => !analysis.doors.has(node) && isDoor(analysis.plainName.get(node) ?? ""));
    return [...swallowed, ...open.map(node => graph.functionName.get(node)!)];
  };

  const tableFor = (laid: Link, graph: Graph, analysis: Analysis, ranges: Range[]) => {
    const stub = format.stub(graph, analysis) ?? fail("Bun__trimmedOut is gone");
    const featuresAt = (node: number) => ranges.find(range => range.start <= graph.address[node]! && graph.address[node]! < range.end)?.features;
    const named = declared.data.length === 0 ? undefined : format.namedBytes ? format.namedBytes(laid) : namedBytesOfElf(laid.executable);
    return tableOf(declared, analysis.conditions, graph.address[stub]!, ranges, listedDoors(graph, analysis, declared, work, featuresAt), dataPackagesOf(named, graph, declared, format.isWindows ? declared.dataKeptOnWindows : []), format.isWindows === true);
  };

  const ahead = format.laidAheadOfTheOthers ?? [];
  const inItsPlace = (path: string) => (ahead.includes(path) ? undefined : (format.prepared?.(path) ?? path));
  const namedInItsPlace = (path: string) => {
    const prepared = inItsPlace(path);
    return prepared === undefined ? undefined : (named.get(prepared) ?? prepared);
  };
  let plan = format.makesItsOwnPlan ? undefined : readPlan(planPath, declared.features.map(feature => feature.name), declared.fingerprint);
  if (plan === undefined && isPlan(planPath)) {
    console.log(format.makesItsOwnPlan ? "an earlier build's plan does not say where unmerged sections go: this link makes its own" : "the earlier build's plan was made for other doors: this link makes its own");
  }
  let native: string[] | undefined;
  let named = new Map<string, string>();
  const isInherited = plan !== undefined;
  if (plan === undefined) {
    let first = link("first", inItsPlace, [...format.support(0), ...ahead], [...format.flags, ...format.onlyInTheFirstLink], true, format.notInTheFirstLink);
    lap("first link");
    native = format.compiledBy("first");
    if (format.prepareWhatWasCompiled?.(native)) {
      const compiled = native;
      first = link("first", path => (isBitcode(path) ? undefined : inItsPlace(path)), [...format.support(0), ...ahead, ...compiled], [...format.flags, ...format.onlyInTheFirstLink], true, format.notInTheFirstLink);
      lap("first link again, of what was compiled");
    }
    const graph = format.read(first);
    lap("graph");
    const analysis = analyze(format.keepsDoorsApart ? { ...graph, aliases: new Map() } : graph, declared, demangler, foldedNames(graph));
    const own = format.planFrom(graph, analysis);
    own.doors.push(...foldedDoors(graph, analysis));
    named = format.nameTheNameless(own, native);
    plan = own;
    const stretches = own.islands.reduce((sum, island) => sum + 24 + island.features.split(",").length, 0);
    const scattered = rangesThatCanOnlyBeOverwritten(graph, analysis, [], output => !format.isMovable(output) && format.canBeOverwritten?.(output) === true);
    plan.tableBytes = tableFor(first, graph, analysis, []).length + stretches + scattered.length * 4 + own.islands.length * 16;
    lap("plan");
  }
  let room = roomFor(plan.tableBytes ?? 65536);

  for (;;) {
    const compiledBefore = format.linksTheSameInputsAgain ? undefined : native;
    const laid = link(
      "second",
      compiledBefore === undefined ? inItsPlace : path => (isBitcode(path) ? undefined : namedInItsPlace(path)),
      [...format.support(room), ...ahead, ...(compiledBefore ?? [])],
      [...format.flags, ...format.flagsFor(plan)],
    );
    lap(native === undefined ? "link by an earlier build's plan" : "ordered link");
    const compiled = native ?? format.compiledBy("second");
    const graph = format.read(laid);
    lap("graph");
    const analysis = analyze(graph, declared, demangler, foldedNames(graph));
    if (analysis.foldedOpen > 0) console.log(`${analysis.foldedOpen} doors were folded into other functions and stay open`);
    console.log(
      `the bytes the linker wrote confirm ${graph.confirmedByTheBytes} references; ${graph.sentOn} branches to a branch were sent on to its target; ${graph.boundElsewhere.length} references lead where the names did not` +
        graph.boundElsewhere.slice(0, 5).map(line => `\n  ${line}`).join(""),
    );
    writeFileSync(join(work, "bound-elsewhere.txt"), graph.boundElsewhere.join("\n") + "\n");
    if (graph.stringsHeld !== undefined) console.log(graph.stringsHeld);
    if (analysis.tooSmall > 0) console.log(`${analysis.tooSmall} functions that match a door are too small to be shut and are no doors`);
    if (analysis.neverDoors > 0) console.log(`${analysis.neverDoors} functions that match a door run before main or after it, or have a second entry, and are no doors`);
    if (analysis.calledDirectly > 0) console.log(`${analysis.calledDirectly} operations are named by more than the table that compiled code calls them through and are no doors`);
    console.log(`${analysis.thin.size} doors are thin: ${megabytes([...analysis.thin].reduce((sum, node) => sum + graph.size[node]!, 0))} of their bodies go with their features`);
    const ranges = rangesThatCanGo(graph, analysis, format.isMovable);
    const faults = misplaced(graph, analysis, ranges);
    if (faults > 0) fail(`${faults} sections lie in a stretch that can go while they are needed`);
    const fresh = format.planFrom(graph, analysis);
    const folded = foldedDoors(graph, analysis);
    const keptApart = new Set(plan.doors);
    fresh.doors.push(...folded);
    const canGo = [...fresh.bytesOf.values()].reduce((sum, bytes) => sum + bytes, 0);
    const featuresAt = (address: number) => ranges.find(range => range.start <= address && address < range.end)?.features;
    const leftOutside = fresh.nodes.reduce((sum, node) => (featuresAt(graph.address[node]!) === undefined ? sum + graph.size[node]! : sum), 0);
    lap("check");
    if (native === undefined && (folded.some(name => !keptApart.has(name)) || leftOutside > mostLeftOutside * canGo)) {
      console.log(`the earlier build's plan leaves ${megabytes(leftOutside)} of ${megabytes(canGo)} outside: linking again by this link's own plan`);
      named = format.nameTheNameless(fresh, compiled);
      plan = fresh;
      native = compiled;
      continue;
    }

    const overwritten = format.canBeOverwritten === undefined ? [] : rangesThatCanOnlyBeOverwritten(graph, analysis, ranges, format.canBeOverwritten);
    const listed = [...ranges, ...overwritten].sort((a, b) => a.start - b.start);
    if (misplaced(graph, analysis, listed) > 0) fail("a stretch that can only be overwritten holds what is needed");
    writeFileSync(
      join(work, "needed-by.txt"),
      [...analysis.neededBy].map(([node, features]) => `${graph.address[node]!.toString(16)} ${graph.size[node]} ${features} ${graph.output[node]} ${analysis.plainName.get(node) ?? graph.section[node]}\n`).join(""),
    );
    const table = tableFor(laid, graph, analysis, listed);
    if (table.length > room) {
      console.log(`the table takes ${table.length} bytes and there is room for ${room}: linking again`);
      room = roomFor(table.length);
      if (native === undefined) {
        named = format.nameTheNameless(fresh, compiled);
        plan = fresh;
        native = compiled;
      }
      continue;
    }
    format.write(table);
    fresh.tableBytes = table.length;
    for (const island of fresh.islands) island.names = island.names.filter(name => !name.startsWith(namelessPrefix));
    if (freshPlanPath !== undefined) writePlan(freshPlanPath, fresh, declared.fingerprint);
    format.tidyUp();
    lap("table and plan");
    const held = new Map<string, number>();
    for (const range of ranges) held.set(range.features, (held.get(range.features) ?? 0) + range.end - range.start);
    console.log(
      `${analysis.doors.size} doors, ${held.size} islands in ${ranges.length} stretches, ${megabytes(wholePages(ranges))} in whole pages of ${pageSize} bytes, of ${megabytes(canGo)} that can go` +
        `; ${overwritten.length} more stretches, ${overwritten.reduce((sum, range) => sum + range.end - range.start, 0)} bytes, can only be overwritten` +
        (isInherited && native === undefined ? " (laid out by an earlier build's plan)" : "") +
        `; the table takes ${table.length} of ${room} bytes` +
        ": " +
        [...held].map(([features, bytes]) => `${features} ${megabytes(bytes)}`).join(", "),
    );
    const fixed = new Map<string, number>();
    for (const [node] of analysis.neededBy) {
      if (!format.isMovable(graph.output[node]!)) fixed.set(graph.output[node]!, (fixed.get(graph.output[node]!) ?? 0) + graph.size[node]!);
    }
    console.log(
      "only features need, in sections that are not cut: " +
        [...fixed]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([output, bytes]) => `${output} ${megabytes(bytes)}`)
          .join(", "),
    );
    console.log(`islands took ${((performance.now() - startedAt) / 1000).toFixed(1)} s: ${laps.join(", ")}`);
    return;
  }
}

function elf({ work, output, declared, demangler, command, assemble, link }: Linker): Format {
  const orderFlag = "-Wl,--symbol-ordering-file=";
  const orderAt = command.findIndex(argument => argument.startsWith(orderFlag));
  const inherited = orderAt >= 0 ? readFileSync(command[orderAt]!.slice(orderFlag.length), "utf8") : "";
  const orderFile = join(work, "order.txt");
  const inputDirectories = new Set([work]);
  link("listing", path => (inputDirectories.add(dirname(path)), undefined), [], [], false);
  const nameOf = { first: "first", second: output.slice(output.lastIndexOf("/") + 1) };
  const compiledBy = (link: "first" | "second") =>
    [...inputDirectories].flatMap(directory =>
      readdirSync(directory)
        .filter(file => file.startsWith(nameOf[link] + ".lto."))
        .map(file => join(directory, file)),
    );
  const tidyUp = () => {
    for (const object of [...compiledBy("first"), ...compiledBy("second")]) rmSync(object);
  };
  tidyUp();
  const isUnmerged = (path: string) => declared.unmerged.some(pattern => pattern.test(path));
  const unmergedCopies = new Map<string, string>();
  let ordinalOfCut = 0;
  return {
    keepsDoorsApart: false,
    isMovable,
    canBeOverwritten: output => isMovable(output) || [".data", ".data.rel.ro"].includes(output),
    prepared(path) {
      if (!isUnmerged(path) || !existsSync(path) || isBitcode(path)) return path;
      let copy = unmergedCopies.get(path);
      if (copy === undefined) {
        copy = join(work, "unmerged", isAbsolute(path) ? path.slice(1) : path);
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(path, copy, constants.COPYFILE_FICLONE);
        cutMergeableSectionsApart(copy, `${namelessPrefix}piece${ordinalOfCut++}`);
        unmergedCopies.set(path, copy);
      }
      return copy;
    },
    prepareWhatWasCompiled(objects) {
      const unmerged = objects.filter(isUnmerged);
      for (const object of unmerged) cutMergeableSectionsApart(object, `${namelessPrefix}piece${ordinalOfCut++}`);
      return unmerged.length > 0;
    },
    makesItsOwnPlan: declared.unmerged.length > 0,
    support: room => [
      assemble(
        "room.s",
        `.section .note.bun,"aR",@note\n.p2align 3\n.long 4, 3584, 1\n.asciz "Bun"\n.zero 3584\n` +
          `.section .bun_islands,"aR",@progbits\n.zero ${room}\n` +
          `.section .rodata.Bun__trimmedFeatures,"a",@progbits\n.globl Bun__trimmedFeatures\nBun__trimmedFeatures:\n` +
          declared.features.map(feature => `.asciz ${JSON.stringify(feature.description)}\n`).join(""),
      ),
    ],
    flags: ["-Wl,-u,Bun__trimmedOut", "-Wl,--print-icf-sections", "-Wl,--save-temps=prelink"],
    onlyInTheFirstLink: ["-Wl,--strip-debug"],
    notInTheFirstLink: onlyForDebuggers,
    flagsFor(plan) {
      writeFileSync(orderFile, plan.islands.flatMap(island => island.names).join("\n") + "\n" + inherited, "latin1");
      if (orderAt >= 0) command[orderAt] = orderFlag + orderFile;
      return orderAt >= 0 ? [] : [orderFlag + orderFile, "-Wl,--no-warn-symbol-ordering"];
    },
    compiledBy(link) {
      const objects = compiledBy(link);
      const empty = objects.filter(object => statSync(object).size === 0);
      if (empty.length > 0) {
        fail(`the linker kept ${empty.length} empty files for what it compiled from bitcode: it does so when it has a ThinLTO cache; link without one`);
      }
      return objects;
    },
    read(link) {
      const graph = readGraph(link.executable, link.map, link.log, functionName => nodesThatMatchADoor(functionName, declared, demangler));
      if (graph.unreadObjects.length > 0) {
        fail(`${graph.unreadObjects.length} inputs could not be read, so what they name is not known:` + graph.unreadObjects.slice(0, 5).map(object => `\n  ${object}`).join(""));
      }
      return graph;
    },
    planFrom(graph, analysis) {
      const { islands, bytesOf, numberOf } = islandsBySize(graph, analysis, declared, isMovable);
      const islandOf = (node: number) => (staysAsDoor(analysis, node) ? 0 : (numberOf.get(analysis.neededBy.get(node) ?? "") ?? 0));
      const namesOf = (node: number) => [...graph.names[node]!, ...(graph.aliases.get(node) ?? []).map(([, name]) => name.replace(/^_/, ""))];
      const islandOfName = new Map<string, number>();
      for (let node = 0; node < graph.address.length; node++) {
        if (!isMovable(graph.output[node]!)) continue;
        const island = islandOf(node);
        for (const name of namesOf(node)) {
          const before = islandOfName.get(name);
          islandOfName.set(name, before === undefined || before === island ? island : 0);
        }
      }
      const plan = {
        doors: [...analysis.doors.keys()].map(node => graph.functionName.get(node)!),
        islands: islands.map(features => ({ features, names: [] as string[] })),
        bytesOf,
        nodes: [] as number[],
        nameless: new Map<string, Map<string, number>>(),
      };
      for (let node = 0; node < graph.address.length; node++) {
        const island = isMovable(graph.output[node]!) ? islandOf(node) : 0;
        if (island === 0 || graph.object[node] === "<internal>") continue;
        const names = namesOf(node).filter(name => islandOfName.get(name) === island);
        plan.islands[island - 1]!.names.push(...names);
        plan.nodes.push(node);
        if (names.length > 0) continue;
        const sections = plan.nameless.get(graph.object[node]!);
        if (sections === undefined) plan.nameless.set(graph.object[node]!, new Map([[graph.section[node]!, island]]));
        else sections.set(graph.section[node]!, island);
      }
      return plan;
    },
    nameTheNameless(plan, ours) {
      const mayBeWritten = new Set([...ours, ...unmergedCopies.values()]);
      const copies = new Map<string, string>();
      let ordinal = 0;
      for (const [object, sections] of plan.nameless) {
        if (!existsSync(object)) continue;
        let path = object;
        if (!mayBeWritten.has(object)) {
          path = join(work, "named", isAbsolute(object) ? object.slice(1) : object);
          mkdirSync(dirname(path), { recursive: true });
          copyFileSync(object, path);
          copies.set(object, path);
        }
        for (const [section, name] of nameSections(path, new Set(sections.keys()), namelessPrefix + ordinal++)) {
          plan.islands[sections.get(section)! - 1]!.names.push(name);
        }
      }
      return copies;
    },
    stub: (_, analysis) => [...analysis.plainName].find(([, name]) => name === "Bun__trimmedOut")?.[0],
    write(table) {
      const file = openElf(resolve(output), "r+") ?? fail(`${output} is not an ELF file`);
      const room = file.sections.find(section => section.name === ".bun_islands") ?? fail("the room for the table is gone");
      writeSync(file.fd, table, 0, table.length, room.offset);
      closeSync(file.fd);
    },
    tidyUp,
  };
}

function hasMachOSection(path: string, name: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const fd = openSync(path, "r");
  const header = fstatSync(fd).size < 32 ? undefined : readAt(fd, 0, 32);
  const commands = header?.readUInt32LE(0) === 0xfeedfacf ? readAt(fd, 32, header.readUInt32LE(20)) : Buffer.alloc(0);
  closeSync(fd);
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    if (commands.readUInt32LE(at) !== 0x19) continue;
    for (let index = 0; index < commands.readUInt32LE(at + 64); index++) if (fixedName(commands, at + 72 + index * 80) === name) return true;
  }
  return false;
}

function machO({ work, output, declared, demangler, command, assemble, link }: Linker): Format {
  const inputs: string[] = [];
  link("listing", path => (inputs.push(path), undefined), [], [], false);
  const isMovable = (output: string) =>
    ["__TEXT,__text", "__TEXT,__const", "__TEXT,__bun_builtins", "__TEXT,__cstring", "__DATA_CONST,__const"].includes(output) || isOneUnitOfAssembly(output);
  const exportedSymbols = command[command.indexOf("-exported_symbols_list") + 1]!;
  const orderAt = command.findIndex(argument => argument.startsWith("-Wl,-order_file,"));
  const compiledAt = command.findIndex(argument => argument.startsWith("-Wl,-object_path_lto,"));
  const inherited = orderAt >= 0 ? readFileSync(command[orderAt]!.slice("-Wl,-order_file,".length), "utf8") : "";
  const orderFile = join(work, "order.txt");
  const compiled = join(work, "compiled");
  mkdirSync(compiled);
  mkdirSync(join(work, "unused"));
  const flags = ["-Wl,-u,_Bun__trimmedOut", "-Wl,-headerpad,0x2000"];
  const compileInto = (directory: string) => {
    if (compiledAt >= 0) command[compiledAt] = "-Wl,-object_path_lto," + directory;
    else flags[2] = "-Wl,-object_path_lto," + directory;
  };
  compileInto(compiled);
  return {
    keepsDoorsApart: false,
    isMovable,
    canBeOverwritten: output => /^__TEXT,__(text|const|bun_builtins|cstring|literals)$/.test(output),
    support: room => [
      assemble(
        "room.s",
        `.section __TEXT,__bun_islands\n.globl _Bun__islands\n.no_dead_strip _Bun__islands\n_Bun__islands:\n.zero ${room}\n` +
          `.section __TEXT,__bun_features\n.globl _Bun__trimmedFeatures\n_Bun__trimmedFeatures:\n` +
          declared.features.map(feature => `.asciz ${JSON.stringify(feature.description)}\n`).join("") +
          `.literal8\n.quad 0\n.cstring\n.asciz "laid ahead of the built-ins' text and the constants"\n` +
          `.subsections_via_symbols\n`,
      ),
    ],
    laidAheadOfTheOthers: inputs.filter(path => hasMachOSection(path, "__bun_builtins")),
    flags,
    onlyInTheFirstLink: [],
    notInTheFirstLink: undefined,
    flagsFor(plan) {
      const behindWhatStays = [...(plan.first ?? []), ...[...plan.islands].reverse().flatMap(island => island.behindWhatStays ?? [])];
      writeFileSync(orderFile, [...plan.islands.flatMap(island => island.names), ...behindWhatStays].join("\n") + "\n" + inherited);
      if (orderAt >= 0) command[orderAt] = "-Wl,-order_file," + orderFile;
      return orderAt >= 0 ? [] : ["-Wl,-order_file," + orderFile];
    },
    compiledBy() {
      compileInto(join(work, "unused"));
      return readdirSync(compiled).map(name => join(compiled, name));
    },
    read(link) {
      const compiledFromBitcode = readdirSync(compiled).map(name => join(compiled, name));
      const graph = readMachOGraph(link.executable, link.map, compiledFromBitcode, exportedSymbols, functionName => nodesThatMatchADoor(functionName, declared, demangler));
      if (graph.unreadObjects.length > 0) {
        fail(`${graph.unreadObjects.length} inputs could not be read, so what they name is not known:` + graph.unreadObjects.slice(0, 5).map(object => `\n  ${object}`).join(""));
      }
      return graph;
    },
    planFrom(graph, analysis) {
      const { islands, bytesOf, numberOf } = islandsBySize(graph, analysis, declared, isMovable);
      const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
      const stem = (name: string) => name.split(".llvm.")[0]!.split(".__uniq.")[0]!;
      const spell = (object: string, name: string) => (graph.externalNames.has(name) ? name : `${base(object)}:${name}`);
      const namesOf = (node: number): [string, string][] => [[graph.object[node]!, graph.section[node]!], ...(graph.aliases.get(node) ?? [])];
      const aheadOfWhatAlwaysGoes = new Set(islands.slice(0, Math.max(0, islands.findIndex(features => !features.split(",").some(feature => goesByFacts(declared, feature))))));
      const moves = (node: number) =>
        analysis.neededBy.has(node) &&
        isMovable(graph.output[node]!) &&
        !staysAsDoor(analysis, node) &&
        (graph.output[node] === "__TEXT,__text" || !aheadOfWhatAlwaysGoes.has(analysis.neededBy.get(node)!));
      const taken = new Set<string>();
      const takenAnywhere = new Set<string>();
      for (let node = 0; node < graph.address.length; node++) {
        if (moves(node) && numberOf.has(analysis.neededBy.get(node)!)) continue;
        for (const [object, name] of namesOf(node)) {
          taken.add(base(graph.object[node]!) + "\0" + stem(name));
          taken.add(base(object) + "\0" + stem(name));
          takenAnywhere.add(stem(name));
          if (graph.externalNames.has(name)) taken.add("\0" + stem(name));
        }
      }
      const findsNothingThatStays = (node: number, object: string, name: string) =>
        graph.externalNames.has(name)
          ? !takenAnywhere.has(stem(name))
          : !taken.has(base(graph.object[node]!) + "\0" + stem(name)) && !taken.has(base(object) + "\0" + stem(name)) && !taken.has("\0" + stem(name));
      const stringsThatStay = new Set<number>();
      for (const [node, hash] of graph.hashOfString) if (!moves(node) || !numberOf.has(analysis.neededBy.get(node)!)) stringsThatStay.add(hash);
      const first = [...stringsThatStay].map(hash => "CSTR;" + hash);
      const staysFirstIn = (output: string) => output === "__DATA_CONST,__const";
      for (let node = 0; node < graph.address.length; node++) {
        if (staysFirstIn(graph.output[node]!) && !(moves(node) && numberOf.has(analysis.neededBy.get(node)!))) first.push(spell(graph.object[node]!, graph.section[node]!));
      }
      const plan = { doors: [], first, islands: islands.map(features => ({ features, names: [] as string[], behindWhatStays: [] as string[] })), bytesOf, nodes: [] as number[], nameless: new Map() };
      const lineOf = (node: number, name: string) => (graph.externalNames.has(name) ? stem(name) : `${base(graph.object[node]!)}:${stem(name)}`);
      const lastIslandOf = new Map<string, number>();
      const laidBehindWhatStays = new Set<string>();
      const written = new Set<string>();
      const isNamed = (node: number) => graph.hashOfString.get(node) === undefined && !isOneUnitOfAssembly(graph.output[node]!);
      for (let node = 0; node < graph.address.length; node++) {
        const island = moves(node) && isNamed(node) ? numberOf.get(analysis.neededBy.get(node)!) : undefined;
        if (island === undefined) continue;
        for (const [object, name] of namesOf(node)) {
          for (const line of [lineOf(node, name), `${base(object)}:${stem(name)}`, stem(name)]) {
            lastIslandOf.set(line, Math.max(lastIslandOf.get(line) ?? 0, island));
            if (staysFirstIn(graph.output[node]!)) laidBehindWhatStays.add(line);
          }
        }
      }
      for (let node = 0; node < graph.address.length; node++) {
        const island = moves(node) ? numberOf.get(analysis.neededBy.get(node)!) : undefined;
        if (island === undefined) continue;
        const hash = graph.hashOfString.get(node);
        if (hash !== undefined && stringsThatStay.has(hash)) continue;
        if (hash !== undefined) plan.islands[island - 1]!.behindWhatStays.push("CSTR;" + hash);
        else if (isNamed(node)) {
          const names = namesOf(node).filter(([object, name]) => findsNothingThatStays(node, object, name));
          if (names.length === 0) continue;
          for (const [, name] of names) {
            const line = lineOf(node, name);
            if (written.has(line)) continue;
            written.add(line);
            plan.islands[lastIslandOf.get(line)! - 1]![laidBehindWhatStays.has(line) ? "behindWhatStays" : "names"].push(spell(graph.object[node]!, name));
          }
        }
        plan.nodes.push(node);
      }
      return plan;
    },
    nameTheNameless: () => new Map(),
    stub(graph) {
      const node = graph.section.indexOf("_Bun__trimmedOut");
      return node < 0 ? undefined : node;
    },
    write(table) {
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
      writeSync(fd, table, 0, table.length, room);
      closeSync(fd);
    },
    tidyUp() {},
  };
}

function coff({ work, output, declared, demangler, command, assemble, link }: Linker): Format {
  const isMovable = (output: string) => output === ".text" || output === ".rdata";
  const valueOf = (flag: string) => command.filter(argument => argument.toLowerCase().startsWith(flag)).map(argument => argument.slice(flag.length));
  const at = (flag: string) => command.findIndex(argument => argument.toLowerCase().startsWith(flag));
  const [orderAt, symbolMapAt] = [at("/order:@"), at("/map:")];
  if (symbolMapAt < 0) fail("the link command names no /map");
  const finalSymbolMap = command[symbolMapAt]!.slice(5);
  const inherited = orderAt >= 0 ? readFileSync(command[orderAt]!.slice(8), "utf8") : "";
  const orderFile = join(work, "order.txt");
  const architecture = valueOf("/machine:")[0]!.toLowerCase();
  const inside = (folder: string) => (existsSync(folder) ? readdirSync(folder).map(name => join(folder, name)) : []);
  const libraryFolders = [
    ...valueOf("/libpath:"),
    ...valueOf("/winsysroot:").flatMap(root => [
      ...inside(join(root, "VC", "Tools", "MSVC")).map(version => join(version, "lib", architecture)),
      ...inside(join(root, "Windows Kits", "10", "Lib")).flatMap(version => [join(version, "ucrt", architecture), join(version, "um", architecture)]),
    ]),
  ];
  const inputs: string[] = [];
  link("listing", path => (inputs.push(path), undefined), [], [], false);
  const inputDirectories = new Set([work, ...inputs.map(path => dirname(path))]);
  const nameOf = { first: "first.exe", second: output.slice(output.lastIndexOf("/") + 1) };
  const compiledBy = (link: "first" | "second") =>
    [...inputDirectories].flatMap(directory =>
      readdirSync(directory)
        .filter(file => file.startsWith(nameOf[link] + ".lto."))
        .map(file => join(directory, file)),
    );
  const tidyUp = () => {
    for (const object of [...compiledBy("first"), ...compiledBy("second")]) rmSync(object);
  };
  tidyUp();
  command[symbolMapAt] = "/map:" + join(work, "first.symbols.map");
  return {
    keepsDoorsApart: false,
    isWindows: true,
    linksTheSameInputsAgain: inputs.some(isBitcode),
    isMovable,
    support: room => [
      assemble(
        "room.s",
        `.section .bunisl,"dr"\n.zero ${room}\n` +
          `.section .rdata,"dr",discard,Bun__trimmedFeatures\n.globl Bun__trimmedFeatures\nBun__trimmedFeatures:\n` +
          declared.features.map(feature => `.asciz ${JSON.stringify(feature.description)}\n`).join(""),
      ),
    ],
    flags: ["/include:Bun__trimmedOut", "/lldsavetemps:prelink"],
    onlyInTheFirstLink: [],
    notInTheFirstLink: /^\/(debug|pdb)(:|$)/i,
    flagsFor(plan) {
      writeFileSync(orderFile, plan.islands.flatMap(island => island.names).join("\n") + "\n" + inherited, "latin1");
      command[symbolMapAt] = "/map:" + finalSymbolMap;
      if (orderAt >= 0) command[orderAt] = "/order:@" + orderFile;
      return orderAt >= 0 ? [] : ["/order:@" + orderFile, "/ignore:4037"];
    },
    compiledBy,
    read: link => ({
      placesThatName: new Map(),
      namedInWaysThatCannotBeRewritten: new Map(),
      keptByAFlagAlone: new Set(),
      neverDoors: new Set(),
      otherNames: new Map(),
      hashOfString: new Map(),
      exported: new Set(),
      stringsHeld: undefined,
      ...readCoffGraph({
        executable: link.executable,
        chunkMap: link.map,
        symbolMap: command[symbolMapAt]!.slice(5),
        inputs: [...inputs, ...compiledBy("first"), ...compiledBy("second")],
        libraryFolders,
        objdump: demangler.replace(/cxxfilt(?=[^\\/]*$)/, "objdump"),
        work,
      }),
    }),
    planFrom(graph, analysis) {
      const { islands, bytesOf, numberOf } = islandsBySize(graph, analysis, declared, isMovable);
      const islandOf = (node: number) => (isMovable(graph.output[node]!) && !staysAsDoor(analysis, node) ? (numberOf.get(analysis.neededBy.get(node) ?? "") ?? 0) : 0);
      const islandOfName = new Map<string, number>();
      graph.names.forEach((names, node) => {
        for (const name of names) islandOfName.set(name, (islandOfName.get(name) ?? islandOf(node)) === islandOf(node) ? islandOf(node) : 0);
      });
      const plan = { doors: [], islands: islands.map(features => ({ features, names: [] as string[] })), bytesOf, nodes: [] as number[], nameless: new Map() };
      graph.names.forEach((all, node) => {
        const names = all.filter(name => islandOfName.get(name) === islandOf(node));
        if (islandOf(node) === 0 || names.length === 0) return;
        plan.islands[islandOf(node) - 1]!.names.push(...names);
        plan.nodes.push(node);
      });
      return plan;
    },
    nameTheNameless: () => new Map(),
    namedBytes: link => namedBytesOfPe(link.executable, command[symbolMapAt]!.slice(5)),
    stub: (_, analysis) => [...analysis.plainName].find(([, name]) => name === "Bun__trimmedOut")?.[0],
    write(table) {
      const room = sectionInFile(resolve(output), ".bunisl") ?? fail("the room for the table is gone");
      const fd = openSync(resolve(output), "r+");
      writeSync(fd, table, 0, table.length, room.offset);
      closeSync(fd);
    },
    tidyUp,
  };
}

function main(): void {
  const separator = process.argv.indexOf("--");
  const [doorsPath, demangler, work, planPath, freshPlanPath] = process.argv.slice(2, separator);
  const command = process.argv.slice(separator + 1);
  if (separator < 0 || work === undefined || command.length === 0) {
    fail("usage: islands.ts <doors> <llvm-cxxfilt> <work directory> [<plan of an earlier build> <where to write this build's plan>] -- <link command>");
  }
  const isMachO = command.some(argument => argument.startsWith("-Wl,-map,"));
  const isCoff = command.includes("/link");
  const mapFlag = isCoff ? "/lldmap:" : isMachO ? "-Wl,-map," : "-Wl,-Map=";
  const outputFlag = isCoff ? "/Fe" : "";
  const outputAt = isCoff ? Math.max(0, command.findIndex(argument => argument.startsWith(outputFlag))) : command.indexOf("-o") + 1;
  const mapAt = command.findIndex(argument => argument.startsWith(mapFlag));
  if (outputAt === 0 || mapAt < 0) fail("the link command names no output or no map");
  const output = command[outputAt]!.slice(outputFlag.length);
  const finalMap = command[mapAt]!.slice(mapFlag.length);
  const compiler = command[0]!;
  const targetFlags = command.flatMap((argument, index) =>
    /^(--target=|-mmacosx-version-min=)/.test(argument)
      ? [argument]
      : argument === "-isysroot"
        ? [argument, command[index + 1]!]
        : /^\/machine:/i.test(argument)
          ? ["--driver-mode=gcc", `--target=${/arm64/i.test(argument) ? "aarch64" : "x86_64"}-pc-windows-msvc`]
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
    planPath,
    freshPlanPath,
    assemble(name, text) {
      const source = join(work, name);
      writeFileSync(source, text);
      const made = spawnSync(compiler, [...targetFlags, "-c", source, "-o", source + ".o"], { stdio: "inherit" });
      if (made.status !== 0) fail(`${name} does not compile`);
      return source + ".o";
    },
    link(name, rewrite, first, last, runs = true, without) {
      const executable = name === "second" ? output : join(work, name + (isCoff ? ".exe" : ""));
      const map = name === "second" ? finalMap : join(work, name + ".map");
      const rewritten = command.slice(1).flatMap((argument, index) => {
        if (index + 1 === outputAt) return [outputFlag + executable];
        if (index + 1 === mapAt) return [mapFlag + map];
        if (without?.test(argument)) return [];
        const file = /^((?:\/clang:)?-Wl,)?@(.*)$/.exec(argument);
        if (file === null) return [argument];
        const lines = readFileSync(file[2]!, "utf8").split("\n").filter(line => line !== "");
        const kept = lines.flatMap(line => {
          const path = line.replace(/^"(.*)"$/, "$1");
          if (path.startsWith("-") || /^\/(start|end)-lib$/.test(path)) return [line];
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
  layOut(linker, isCoff ? coff(linker) : isMachO ? machO(linker) : elf(linker));
}

main();
