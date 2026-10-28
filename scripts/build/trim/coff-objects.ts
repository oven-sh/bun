import { readAt } from "./binary-reader.ts";

const IMAGE_SCN_LNK_INFO = 0x200;
const IMAGE_SCN_LNK_REMOVE = 0x800;
const IMAGE_SCN_MEM_DISCARDABLE = 0x0200_0000;
export const IMAGE_SCN_LNK_COMDAT = 0x1000;
export const notLoadedFlags = IMAGE_SCN_LNK_INFO | IMAGE_SCN_LNK_REMOVE | IMAGE_SCN_MEM_DISCARDABLE;
export const IMAGE_COMDAT_SELECT_ASSOCIATIVE = 5;
export const IMAGE_SYM_CLASS_EXTERNAL = 2;
export const IMAGE_SYM_CLASS_WEAK_EXTERNAL = 105;
export const ordinarySectionName = /^\.(text|rdata|data|bss|xdata|pdata)(\$|$)/;

export const scalarDeleting = (name: string) => (name.startsWith("??_E") ? "??_G" + name.slice(4) : name);

export interface CoffSection {
  name: string;
  size: number;
  contents: number;
  flags: number;
  relocations: number;
  relocationCount: number;
  selection: number;
  parent: number;
  leader: number;
}

export class CoffObject {
  sections: CoffSection[] = [];
  symbolSection: Int32Array;
  symbolValue: Uint32Array;
  symbolClass: Uint8Array;
  symbolDefault: Int32Array;
  byName = new Map<string, number[]>();
  private fd: number;
  private base: number;
  private symbols: Buffer;
  private strings: Buffer;
  private entry: number;

  private constructor(fd: number, base: number, header: Buffer) {
    this.fd = fd;
    this.base = base;
    const isBig = header.readUInt16LE(0) === 0 && header.readUInt16LE(2) === 0xffff;
    const sectionCount = isBig ? header.readUInt32LE(44) : header.readUInt16LE(2);
    const symbolsAt = header.readUInt32LE(isBig ? 48 : 8);
    const symbolCount = header.readUInt32LE(isBig ? 52 : 12);
    this.entry = isBig ? 20 : 18;
    this.symbols = readAt(fd, base + symbolsAt, symbolCount * this.entry);
    const stringsAt = base + symbolsAt + symbolCount * this.entry;
    this.strings = symbolsAt === 0 ? Buffer.alloc(4) : readAt(fd, stringsAt, readAt(fd, stringsAt, 4).readUInt32LE(0));
    const table = readAt(fd, base + (isBig ? 56 : 20 + header.readUInt16LE(16)), sectionCount * 40);
    for (let at = 0; at < table.length; at += 40) {
      let name = table.toString("latin1", at, at + 8).replace(/\0.*$/, "");
      if (/^\/\d+$/.test(name)) name = this.stringAt(Number(name.slice(1)));
      const flags = table.readUInt32LE(at + 36);
      let relocations = table.readUInt32LE(at + 24);
      let relocationCount = table.readUInt16LE(at + 32);
      if (relocationCount === 0xffff && flags & 0x0100_0000) {
        relocationCount = readAt(fd, base + relocations, 4).readUInt32LE(0) - 1;
        relocations += 10;
      }
      this.sections.push({
        name,
        size: table.readUInt32LE(at + 16),
        contents: table.readUInt32LE(at + 20),
        flags,
        relocations,
        relocationCount,
        selection: 0,
        parent: 0,
        leader: -1,
      });
    }
    this.symbolSection = new Int32Array(symbolCount);
    this.symbolValue = new Uint32Array(symbolCount);
    this.symbolClass = new Uint8Array(symbolCount);
    this.symbolDefault = new Int32Array(symbolCount).fill(-1);
    const defined = new Set<number>();
    for (let index = 0; index < symbolCount; index++) {
      const at = index * this.entry;
      const section = isBig ? this.symbols.readInt32LE(at + 12) : this.symbols.readInt16LE(at + 12);
      const storage = this.symbols[at + this.entry - 2]!;
      const auxiliaries = this.symbols[at + this.entry - 1]!;
      this.symbolSection[index] = section;
      this.symbolValue[index] = this.symbols.readUInt32LE(at + 8);
      this.symbolClass[index] = storage;
      if (storage === IMAGE_SYM_CLASS_WEAK_EXTERNAL && auxiliaries > 0)
        this.symbolDefault[index] = this.symbols.readUInt32LE(at + this.entry);
      if (section > 0 && section <= sectionCount) {
        const found = this.sections[section - 1]!;
        const isDefinition =
          storage === 3 &&
          auxiliaries > 0 &&
          this.symbolValue[index] === 0 &&
          !defined.has(section) &&
          this.nameOf(index) === found.name;
        if (isDefinition) {
          defined.add(section);
          const auxiliary = at + this.entry;
          found.selection = this.symbols[auxiliary + 14]!;
          found.parent =
            this.symbols.readUInt16LE(auxiliary + 12) | (isBig ? this.symbols.readUInt16LE(auxiliary + 16) << 16 : 0);
        } else {
          if (
            found.leader < 0 &&
            found.flags & IMAGE_SCN_LNK_COMDAT &&
            found.selection !== IMAGE_COMDAT_SELECT_ASSOCIATIVE
          )
            found.leader = index;
          const name = this.nameOf(index);
          const list = this.byName.get(name);
          if (list === undefined) this.byName.set(name, [index]);
          else list.push(index);
        }
      }
      index += auxiliaries;
    }
  }

  static open(fd: number, base: number, size: number): CoffObject | undefined {
    if (size < 56) return undefined;
    const header = readAt(fd, base, 56);
    const machine = header.readUInt16LE(0);
    if (machine === 0 && header.readUInt16LE(2) === 0xffff) {
      if (header.readUInt16LE(4) < 2) return undefined;
    } else if (machine !== 0x8664 && machine !== 0xaa64) return undefined;
    return new CoffObject(fd, base, header);
  }

  private stringAt(offset: number): string {
    return this.strings.toString("latin1", offset, this.strings.indexOf(0, offset));
  }

  nameOf(symbol: number): string {
    const at = symbol * this.entry;
    if (this.symbols.readUInt32LE(at) === 0) return this.stringAt(this.symbols.readUInt32LE(at + 4));
    return this.symbols.toString("latin1", at, at + 8).replace(/\0.*$/, "");
  }

  isFunction(symbol: number): boolean {
    return this.symbols.readUInt16LE(symbol * this.entry + this.entry - 4) === 0x20;
  }

  contentsOf(section: CoffSection): string {
    return (
      `${section.name}\0${section.relocationCount}\0` +
      readAt(this.fd, this.base + section.contents, section.size).toString("latin1")
    );
  }

  bytesOf(section: CoffSection): Buffer {
    return readAt(this.fd, this.base + section.contents, section.size);
  }

  relocationsOf(section: CoffSection): Buffer {
    return readAt(this.fd, this.base + section.relocations, section.relocationCount * 10);
  }

  targetsOf(section: CoffSection): Set<number> {
    const targets = new Set<number>();
    if (section.relocationCount === 0) return targets;
    const table = readAt(this.fd, this.base + section.relocations, section.relocationCount * 10);
    for (let at = 0; at < table.length; at += 10) targets.add(table.readUInt32LE(at + 4));
    return targets;
  }
}
