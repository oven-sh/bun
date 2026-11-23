import { closeSync, fstatSync, openSync } from "node:fs";
import { readAt, stringAt } from "./binary-reader.ts";

export interface SectionHeader {
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

export interface ElfFile {
  fd: number;
  sectionHeadersOffset: number;
  namesIndex: number;
  sections: SectionHeader[];
}

export function openElf(path: string, mode: "r" | "r+", base = 0): ElfFile | undefined {
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
