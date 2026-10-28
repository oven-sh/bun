import { closeSync, fstatSync, writeSync } from "node:fs";
import { fail, readAt } from "./binary-reader.ts";
import type { ElfFile, SectionHeader } from "./elf-file.ts";
import { openElf } from "./elf-file.ts";

interface Piece {
  section: number;
  start: number;
  end: number;
}

interface SectionSplit {
  isSplit: boolean[];
  pieces: Piece[];
  headers: Buffer;
  symbolsIndex: number;
  symbols: Buffer;
  tables: { index: number; data: Buffer }[];
}

function findPieceStarts(
  fd: number,
  sections: SectionHeader[],
  headers: Buffer,
  isSplit: boolean[],
): Map<number, number[]> {
  const startsOf = new Map<number, number[]>();
  sections.forEach((section, index) => {
    if (!isSplit[index]) return;
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
  return startsOf;
}

function writeSplitSections(elf: ElfFile, split: SectionSplit, prefix: string): void {
  const { fd, sections, namesIndex } = elf;
  const { isSplit, pieces, headers, symbolsIndex, symbols, tables } = split;
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
    if (!isSplit[index]) return;
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
  for (let number = 0; number < pieces.length; number++)
    moreHeaders.writeUInt32LE(firstNewName + moreHeaders.readUInt32LE(number * 64), number * 64);
  const grown = (index: number, more: string) =>
    Buffer.concat([readAt(fd, sections[index]!.offset, sections[index]!.size), Buffer.from(more, "latin1")]);
  replace(symbolsIndex, Buffer.concat([symbols, moreSymbols]));
  replace(stringsIndex, grown(stringsIndex, isOneTable ? moreStrings + moreNames : moreStrings));
  if (!isOneTable) replace(namesIndex, grown(namesIndex, moreNames));
  for (const { index, data } of tables) writeSync(fd, data, 0, data.length, sections[index]!.offset);
  const field = Buffer.alloc(8);
  field.writeBigUInt64LE(BigInt(append(Buffer.concat([headers, moreHeaders]))));
  writeSync(fd, field, 0, 8, 0x28);
  const total = Buffer.alloc(2);
  total.writeUInt16LE(sections.length + pieces.length);
  writeSync(fd, total, 0, 2, 0x3c);
}

export function splitMergeableSections(path: string, prefix: string): void {
  const elf = openElf(path, "r+");
  if (elf === undefined) return;
  const { fd, sections, sectionHeadersOffset } = elf;
  const done = () => closeSync(fd);
  const machine = readAt(fd, 18, 2).readUInt16LE(0);
  const symbolsIndex = sections.findIndex(section => section.type === 2);
  const headers = readAt(fd, sectionHeadersOffset, sections.length * 64);
  const hasReferences = new Set(
    sections.filter(section => section.type === 4 || section.type === 9).map(section => section.info),
  );
  const isSplit = sections.map(
    (section, index) =>
      section.type === 1 &&
      (section.flags & 0x12) === 0x12 &&
      (section.flags & 0x200) === 0 &&
      section.size > 0 &&
      !hasReferences.has(index),
  );
  if (symbolsIndex < 0 || !isSplit.includes(true) || sections.some(section => section.type === 18)) return done();
  const startsOf = findPieceStarts(fd, sections, headers, isSplit);
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
  const isPcRelative = (type: number) => (machine === 62 ? ![1, 10, 11].includes(type) : machine !== 183);
  const tables = sections.flatMap((section, index) =>
    section.type === 4 && (sections[section.info]!.flags & 2) !== 0
      ? [{ index, data: readAt(fd, section.offset, section.size) }]
      : [],
  );
  const sectionOfSectionSymbol = (symbol: number) => {
    const section = symbols.readUInt16LE(symbol * 24 + 6);
    return (symbols[symbol * 24 + 4]! & 15) === 3 && isSplit[section] ? section : -1;
  };
  for (const { data } of tables) {
    for (let at = 0; at < data.length; at += 24) {
      const section = sectionOfSectionSymbol(data.readUInt32LE(at + 12));
      const addend = Number(data.readBigInt64LE(at + 16));
      if (section >= 0 && (isPcRelative(data.readUInt32LE(at + 8)) || addend < 0 || addend >= sections[section]!.size))
        isSplit[section] = false;
    }
  }
  const numberOf = new Map<string, number>();
  const pieces: Piece[] = [];
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
    if (section >= sections.length || !isSplit[section] || (symbols[symbol * 24 + 4]! & 15) === 3) continue;
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
  writeSplitSections(elf, { isSplit, pieces, headers, symbolsIndex, symbols, tables }, prefix);
  done();
}

export function nameSections(path: string, wanted: Set<string>, prefix: string): [section: string, symbol: string][] {
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
    const field = Buffer.alloc(16);
    field.writeBigUInt64LE(BigInt(end), 0);
    field.writeBigUInt64LE(BigInt(whole.length), 8);
    writeSync(elf.fd, field, 0, 16, elf.sectionHeadersOffset + index * 64 + 24);
  };
  if (named.length > 0) {
    grow(symbolsIndex, Buffer.concat(symbols));
    grow(stringsIndex, Buffer.from(strings, "latin1"));
    if (extendedIndex >= 0) grow(extendedIndex, Buffer.concat(extended));
  }
  closeSync(elf.fd);
  return named;
}
