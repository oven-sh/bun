import { closeSync, existsSync, fstatSync, openSync } from "node:fs";
import type { ArchiveCache } from "./archive.ts";
import { splitArchivePath } from "./archive.ts";
import { fixedName, readAt, stringAt } from "./binary-reader.ts";
import type { UnreadReason } from "./graph.ts";

export const machORecordSegment = "__DWARF";
export const machORecordSection = "__bun_entries";

export const MH_MAGIC_64 = 0xfeedfacf;
export const CPU_TYPE_X86_64 = 0x01000007;
const MH_SUBSECTIONS_VIA_SYMBOLS = 0x2000;
export const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 2;
const N_STAB = 0xe0;
const N_TYPE = 0x0e;
const N_SECT = 0x0e;
const N_EXT = 0x01;
const N_NO_DEAD_STRIP = 0x0020;
const N_ALT_ENTRY = 0x0200;
const SECTION_TYPE = 0xff;
const S_CSTRING_LITERALS = 2;
const S_4BYTE_LITERALS = 3;
const S_8BYTE_LITERALS = 4;
const S_16BYTE_LITERALS = 14;
const S_ATTR_NO_DEAD_STRIP = 0x10000000;
const RELOC_UNSIGNED = 0;
const ARM64_RELOC_ADDEND = 10;
const X86_64_RELOC_SIGNED = 1;
const X86_64_RELOC_BRANCH = 2;
const X86_64_RELOC_SIGNED_1 = 6;
const X86_64_RELOC_SIGNED_2 = 7;
const X86_64_RELOC_SIGNED_4 = 8;
const LENGTH_LONG = 2;
const LENGTH_QUAD = 3;

const headerSize = 32;
const literalSizes = new Map([
  [S_4BYTE_LITERALS, 4],
  [S_8BYTE_LITERALS, 8],
  [S_16BYTE_LITERALS, 16],
]);
const x64BytesAfterField = new Map([
  [X86_64_RELOC_SIGNED, 0],
  [X86_64_RELOC_BRANCH, 0],
  [X86_64_RELOC_SIGNED_1, 1],
  [X86_64_RELOC_SIGNED_2, 2],
  [X86_64_RELOC_SIGNED_4, 4],
]);
const unwindSections = ["__eh_frame", "__gcc_except_tab", "__compact_unwind"];
const sectionsRunBeforeMain = ["__mod_init_func", "__init_offsets", "__mod_term_func", "__thread_vars"];

const relocationType = (word: number) => word >>> 28;
const isExtern = (word: number) => ((word >>> 27) & 1) !== 0;
const relocationLength = (word: number) => (word >>> 25) & 3;
const isPCRelative = (word: number) => ((word >>> 24) & 1) !== 0;
const symbolNumber = (word: number) => word & 0xffffff;
const signed64At = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readInt32LE(at + 4) * 0x100000000;

export interface MachOReferences {
  references: Map<string, Set<string>>;
  externals: string[];
  retained: string[];
  liveWithoutReference: string[];
  unreadStrings: number;
  /** Where each of `unreadStrings` is, for the report of the link. */
  unreadStringPlaces: string[];
  unreadLiterals: number;
  textOfExternalName: Map<string, string>;
  recordSections: { bytes: Buffer; references: Map<number, string> }[];
}

interface Section {
  name: string;
  segment: string;
  address: number;
  size: number;
  offset: number;
  relocations: number;
  count: number;
  flags: number;
}

interface SymbolEntry {
  name: string;
  type: number;
  section: number;
  value: number;
}

interface SymbolTable {
  entries: Buffer;
  strings: Buffer;
}

type ReadBytes = (offset: number, size: number) => Buffer;
type Atom = [address: number, names: string];

function findObject(path: string, archives: ArchiveCache): { file: string; offset: number } | UnreadReason {
  if (existsSync(path)) return { file: path, offset: 0 };
  const inArchive = splitArchivePath(path);
  if (inArchive === undefined || !existsSync(inArchive.archive)) return "NotFound";
  const members = archives.members(inArchive.archive).get(inArchive.member) ?? [];
  if (members.length === 0) return "NotFound";
  if (members.length > 1) return "AmbiguousArchiveMember";
  return { file: inArchive.archive, offset: members[0]!.offset };
}

function readLoadCommands(
  readFrom: ReadBytes,
  header: Buffer,
): { sections: Section[]; symbolTable: SymbolTable | undefined } {
  const commands = readFrom(headerSize, header.readUInt32LE(20));
  const sections: Section[] = [];
  let symbolTable: SymbolTable | undefined;
  let at = 0;
  for (let command = header.readUInt32LE(16); command > 0; command--) {
    const kind = commands.readUInt32LE(at);
    if (kind === LC_SEGMENT_64) {
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
    } else if (kind === LC_SYMTAB) {
      symbolTable = {
        entries: readFrom(commands.readUInt32LE(at + 8), commands.readUInt32LE(at + 12) * 16),
        strings: readFrom(commands.readUInt32LE(at + 16), commands.readUInt32LE(at + 20)),
      };
    }
    at += commands.readUInt32LE(at + 4);
  }
  return { sections, symbolTable };
}

function readSymbols({ entries, strings }: SymbolTable, sections: Section[], result: MachOReferences) {
  const symbols: SymbolEntry[] = [];
  const alternateEntries: SymbolEntry[] = [];
  const namesByAddress: Map<number, string>[] = sections.map(() => new Map());
  for (let entry = 0; entry < entries.length; entry += 16) {
    const symbol = {
      name: stringAt(strings, entries.readUInt32LE(entry)),
      type: entries[entry + 4]!,
      section: entries[entry + 5]!,
      value: Number(entries.readBigUInt64LE(entry + 8)),
    };
    symbols.push(symbol);
    if ((symbol.type & N_STAB) !== 0 || (symbol.type & N_TYPE) !== N_SECT) continue;
    const description = entries.readUInt16LE(entry + 6);
    if ((description & N_ALT_ENTRY) === 0) {
      const names = namesByAddress[symbol.section - 1]!;
      names.set(symbol.value, names.has(symbol.value) ? names.get(symbol.value) + "\x01" + symbol.name : symbol.name);
    } else alternateEntries.push(symbol);
    if (symbol.type & N_EXT) result.externals.push(symbol.name);
    if (description & N_NO_DEAD_STRIP)
      (sections[symbol.section - 1]?.name === "__text" ? result.liveWithoutReference : result.retained).push(
        symbol.name,
      );
  }
  const atoms = namesByAddress.map(names => [...names].sort((a, b) => a[0] - b[0]));
  return { symbols, alternateEntries, atoms };
}

function createObjectLookup(readFrom: ReadBytes, sections: Section[], atoms: Atom[][]) {
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
  const sectionNumberAt = (address: number) =>
    sections.findIndex(other => other.address <= address && address < other.address + other.size) + 1;
  const sectionType = (section: number) => (sections[section - 1]?.flags ?? 0) & SECTION_TYPE;
  const isCStringSection = (section: number) => sectionType(section) === S_CSTRING_LITERALS;
  const literalSize = (section: number) => literalSizes.get(sectionType(section));
  const literalContents = new Map<number, Buffer>();
  const literalAt = (section: number, address: number) => {
    const size = literalSize(section)!;
    const { address: start, offset, size: length } = sections[section - 1]!;
    const at = Math.floor((address - start) / size) * size;
    if (at < 0 || at + size > length) return undefined;
    let bytes = literalContents.get(section);
    if (bytes === undefined) literalContents.set(section, (bytes = readFrom(offset, length)));
    return bytes.toString("hex", at, at + size);
  };
  const cstringContents: (Buffer | undefined)[] = [];
  const enclosingString = (section: number, address: number) => {
    const { address: start, offset, size } = sections[section - 1]!;
    const text = (cstringContents[section] ??= readFrom(offset, size));
    const at = address - start;
    if (at < 0 || at >= text.length) return undefined;
    const end = text.indexOf(0, at);
    return text.toString("latin1", at === 0 ? 0 : text.lastIndexOf(0, at - 1) + 1, end < 0 ? text.length : end);
  };
  return { atomAt, sectionNumberAt, isCStringSection, literalSize, literalAt, enclosingString };
}

interface ObjectFile {
  isX64: boolean;
  readFrom: ReadBytes;
  sections: Section[];
  symbols: SymbolEntry[];
  atoms: Atom[][];
  lookup: ReturnType<typeof createObjectLookup>;
}

function addReference(result: MachOReferences, from: string, to: string): void {
  const set = result.references.get(from);
  if (set === undefined) result.references.set(from, new Set([to]));
  else set.add(to);
}

function readRecordSection({ readFrom, symbols, lookup }: ObjectFile, section: Section) {
  const { atomAt, sectionNumberAt } = lookup;
  const relocations = readFrom(section.relocations, section.count * 8);
  const bytes = readFrom(section.offset, section.size);
  const references = new Map<number, string>();
  for (let entry = 0; entry < relocations.length; entry += 8) {
    const word = relocations.readUInt32LE(entry + 4);
    const field = relocations.readInt32LE(entry);
    const isPointer =
      relocationType(word) === RELOC_UNSIGNED && relocationLength(word) === LENGTH_QUAD && !isPCRelative(word);
    if (!isPointer || field < 0 || field + 8 > bytes.length) return undefined;
    const value = signed64At(bytes, field);
    if (!isExtern(word)) {
      const atom = atomAt(sectionNumberAt(value), value);
      if (atom !== undefined) references.set(field, "L" + atom);
      continue;
    }
    const symbol = symbols[symbolNumber(word)];
    if (symbol === undefined) return undefined;
    if ((symbol.type & N_TYPE) !== N_SECT) references.set(field, "G" + symbol.name);
    else
      references.set(
        field,
        "L" + (atomAt(symbol.section, symbol.value + value) ?? atomAt(symbol.section, symbol.value) ?? symbol.name),
      );
  }
  return { bytes, references };
}

function readSectionReferences(
  { isX64, readFrom, sections, symbols, atoms, lookup }: ObjectFile,
  index: number,
  result: MachOReferences,
): void {
  const { atomAt, sectionNumberAt, isCStringSection, literalSize, literalAt, enclosingString } = lookup;
  const section = sections[index]!;
  const addLiteralReference = (from: string, literalSection: number, address: number) => {
    const literal = literalAt(literalSection, address);
    if (literal === undefined) result.unreadLiterals++;
    else addReference(result, from, "W" + literal);
  };
  const runsBeforeMain = sectionsRunBeforeMain.includes(section.name);
  if (runsBeforeMain || (section.flags & S_ATTR_NO_DEAD_STRIP && section.name !== "__bun_builtins"))
    for (const [, name] of atoms[index]!) result.retained.push(name);
  if (section.count === 0) return;
  const relocations = readFrom(section.relocations, section.count * 8);
  let contents: Buffer | undefined;
  const readContents = () => (contents ??= readFrom(section.offset, section.size));
  const embeddedAddend = (word: number, field: number) => {
    if (relocationLength(word) === LENGTH_QUAD)
      return relocationType(word) === RELOC_UNSIGNED ? signed64At(readContents(), field) : 0;
    if (relocationLength(word) !== LENGTH_LONG || !isX64) return 0;
    return readContents().readInt32LE(field) + (x64BytesAfterField.get(relocationType(word)) ?? 0);
  };
  let pendingAddend = 0;
  for (let entry = 0; entry < relocations.length; entry += 8) {
    const word = relocations.readUInt32LE(entry + 4);
    const type = relocationType(word);
    if (type === ARM64_RELOC_ADDEND && !isX64) {
      pendingAddend = (word << 8) >> 8;
      continue;
    }
    const addend = pendingAddend;
    pendingAddend = 0;
    const isPointer = type === RELOC_UNSIGNED && relocationLength(word) === LENGTH_QUAD;
    const field = relocations.readInt32LE(entry);
    const from = atomAt(index + 1, section.address + field);
    if (runsBeforeMain && isExtern(word)) result.retained.push(symbols[symbolNumber(word)]!.name);
    if (runsBeforeMain && !isExtern(word) && isPointer) {
      const address = Number(readContents().readBigUInt64LE(field));
      const called = atomAt(sectionNumberAt(address), address);
      if (called !== undefined) result.retained.push(called);
    }
    if (from === undefined) continue;
    if (isExtern(word)) {
      const target = symbols[symbolNumber(word)]!;
      if ((target.type & N_TYPE) !== N_SECT) {
        addReference(result, from, "G" + target.name);
      } else if (isCStringSection(target.section)) {
        // The linker keeps the string that the symbol names and adds the addend to its address, wherever that leads:
        // `" " + 2`, one past the end, is a pointer that a program may hold. What lies there in this object is kept too.
        const named = enclosingString(target.section, target.value);
        const reached = enclosingString(target.section, target.value + addend + embeddedAddend(word, field));
        if (named === undefined) {
          result.unreadStrings++;
          result.unreadStringPlaces.push(`${from}: ${target.name} lies outside the section of strings it is listed in`);
        } else addReference(result, from, "S" + named);
        if (reached !== undefined && reached !== named) addReference(result, from, "S" + reached);
      } else if (literalSize(target.section) !== undefined) {
        addLiteralReference(from, target.section, target.value + addend + embeddedAddend(word, field));
      } else {
        addReference(result, from, "L" + (atomAt(target.section, target.value) ?? target.name));
      }
      continue;
    }
    const bytesAfterField = isX64 && relocationLength(word) === LENGTH_LONG ? x64BytesAfterField.get(type) : undefined;
    // `.long L_string - _symbol`, which only the x86-64 assembler takes: as the linker does, read the field as the address.
    const isShortAddress = isX64 && type === RELOC_UNSIGNED && relocationLength(word) === LENGTH_LONG;
    if (bytesAfterField === undefined && !isPointer && !isShortAddress) {
      if (isCStringSection(symbolNumber(word))) {
        result.unreadStrings++;
        result.unreadStringPlaces.push(
          `${from}: a relocation of type ${type} and length ${relocationLength(word)} against the section of strings`,
        );
      } else if (literalSize(symbolNumber(word)) !== undefined) result.unreadLiterals++;
      continue;
    }
    const address =
      bytesAfterField !== undefined
        ? section.address + field + 4 + readContents().readInt32LE(field) + bytesAfterField
        : isPointer
          ? Number(readContents().readBigUInt64LE(field))
          : readContents().readInt32LE(field);
    const targetSection = sectionNumberAt(address);
    if (isCStringSection(targetSection)) {
      addReference(result, from, "S" + enclosingString(targetSection, address)!);
      continue;
    }
    if (isShortAddress && isCStringSection(symbolNumber(word))) {
      result.unreadStrings++;
      result.unreadStringPlaces.push(`${from}: 0x${address.toString(16)} is outside the section of strings`);
      continue;
    }
    if (literalSize(targetSection) !== undefined) {
      addLiteralReference(from, targetSection, address);
      continue;
    }
    const target = atomAt(targetSection, address);
    if (target !== undefined) addReference(result, from, "L" + target);
  }
}

function readObject(readFrom: ReadBytes): MachOReferences | UnreadReason {
  const header = readFrom(0, headerSize);
  if (header.readUInt32LE(0) !== MH_MAGIC_64) return "NotAnObject";
  const isX64 = header.readUInt32LE(4) === CPU_TYPE_X86_64;
  const hasSubsectionsViaSymbols = (header.readUInt32LE(24) & MH_SUBSECTIONS_VIA_SYMBOLS) !== 0;
  const { sections, symbolTable } = readLoadCommands(readFrom, header);
  const result: MachOReferences = {
    references: new Map(),
    externals: [],
    retained: [],
    liveWithoutReference: [],
    unreadStrings: 0,
    unreadStringPlaces: [],
    unreadLiterals: 0,
    textOfExternalName: new Map(),
    recordSections: [],
  };
  if (symbolTable === undefined) return result;
  const { symbols, alternateEntries, atoms } = readSymbols(symbolTable, sections, result);
  const lookup = createObjectLookup(readFrom, sections, atoms);
  const object: ObjectFile = { isX64, readFrom, sections, symbols, atoms, lookup };
  for (const symbol of symbols) {
    if (
      (symbol.type & N_STAB) !== 0 ||
      (symbol.type & (N_TYPE | N_EXT)) !== (N_SECT | N_EXT) ||
      !lookup.isCStringSection(symbol.section)
    )
      continue;
    const text = lookup.enclosingString(symbol.section, symbol.value);
    if (text === undefined) {
      result.unreadStrings++;
      result.unreadStringPlaces.push(`${symbol.name}: an external name outside the section of strings it is listed in`);
    } else result.textOfExternalName.set(symbol.name, text);
  }
  for (const entry of alternateEntries) {
    const atom = lookup.atomAt(entry.section, entry.value);
    if (atom === undefined) continue;
    addReference(result, atom, "L" + entry.name);
    addReference(result, entry.name, "L" + atom);
  }
  if (!hasSubsectionsViaSymbols) {
    for (const list of atoms) {
      for (let index = 1; index < list.length; index++) {
        addReference(result, list[index - 1]![1], "L" + list[index]![1]);
        addReference(result, list[index]![1], "L" + list[index - 1]![1]);
      }
    }
  }
  for (const [index, section] of sections.entries()) {
    if (section.segment === machORecordSegment && section.name === machORecordSection) {
      const records = readRecordSection(object, section);
      if (records === undefined) return "UnsupportedRelocations";
      result.recordSections.push(records);
      continue;
    }
    if (section.segment === "__DWARF" || section.segment === "__LD") continue;
    if (unwindSections.includes(section.name)) continue;
    readSectionReferences(object, index, result);
  }
  return result;
}

export function readMachOObject(path: string, archives: ArchiveCache): MachOReferences | UnreadReason {
  const location = findObject(path, archives);
  if (typeof location === "string") return location;
  const fd = openSync(location.file, "r");
  try {
    if (fstatSync(fd).size < location.offset + headerSize) return "NotAnObject";
    return readObject((offset, size) => readAt(fd, location.offset + offset, size));
  } finally {
    closeSync(fd);
  }
}
