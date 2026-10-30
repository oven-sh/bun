import { closeSync, openSync } from "node:fs";
import { fixedName, readAt } from "./binary-reader.ts";
import type { ElfFile } from "./elf-file.ts";
import { CPU_TYPE_X86_64, LC_SEGMENT_64 } from "./macho-objects.ts";

export interface LinkedImage {
  isArm64: boolean;
  bytes(address: number, length: number): Buffer | undefined;
}

export interface ImagePart {
  start: number;
  end: number;
  offset: number;
}

export function imageOfParts(path: string, parts: ImagePart[], isArm64: boolean): LinkedImage {
  const loaded = new Map<ImagePart, Buffer>();
  const dataOf = (part: ImagePart) => {
    let data = loaded.get(part);
    if (data === undefined) {
      const fd = openSync(path, "r");
      data = readAt(fd, part.offset, part.end - part.start);
      closeSync(fd);
      loaded.set(part, data);
    }
    return data;
  };
  let last: ImagePart | undefined = parts[0];
  const partWith = (address: number, length: number) => {
    if (last === undefined || address < last.start || address + length > last.end)
      last = parts.find(part => part.start <= address && address + length <= part.end);
    return last;
  };
  return {
    isArm64,
    bytes(address, length) {
      const part = partWith(address, length);
      return part && dataOf(part).subarray(address - part.start, address - part.start + length);
    },
  };
}

export function elfImage(path: string, elf: ElfFile): LinkedImage {
  const parts = elf.sections
    .filter(section => (section.flags & 2) !== 0 && section.type !== 8 && section.size > 0)
    .map(section => ({ start: section.address, end: section.address + section.size, offset: section.offset }));
  return imageOfParts(path, parts, readAt(elf.fd, 18, 2).readUInt16LE(0) === 183);
}

export function machOImage(path: string): LinkedImage {
  const fd = openSync(path, "r");
  const header = readAt(fd, 0, 32);
  const commands = readAt(fd, 32, header.readUInt32LE(20));
  closeSync(fd);
  const parts: ImagePart[] = [];
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    if (commands.readUInt32LE(at) !== LC_SEGMENT_64 || fixedName(commands, at + 8) === "__LINKEDIT") continue;
    const start = Number(commands.readBigUInt64LE(at + 24));
    const size = Number(commands.readBigUInt64LE(at + 48));
    if (size > 0) parts.push({ start, end: start + size, offset: Number(commands.readBigUInt64LE(at + 40)) });
  }
  return imageOfParts(path, parts, header.readUInt32LE(4) !== CPU_TYPE_X86_64);
}

export function peImage(path: string): LinkedImage {
  const fd = openSync(path, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  closeSync(fd);
  const parts: ImagePart[] = [];
  for (let at = 0; at < sections.length; at += 40) {
    const length = Math.min(sections.readUInt32LE(at + 8), sections.readUInt32LE(at + 16));
    const start = sections.readUInt32LE(at + 12);
    if (length > 0) parts.push({ start, end: start + length, offset: sections.readUInt32LE(at + 20) });
  }
  return imageOfParts(path, parts, header.readUInt16LE(4) === 0xaa64);
}
