import { closeSync, existsSync } from "node:fs";
import type { ArchiveCache } from "./archive.ts";
import { splitArchivePath } from "./archive.ts";
import { readAt, stringAt } from "./binary-reader.ts";
import type { ElfFile, SectionHeader } from "./elf-file.ts";
import { openElf } from "./elf-file.ts";
import type { UnreadReason } from "./graph.ts";

export const elfRecordSectionName = ".bun_removable_entry_points";
export const isCode = (output: string) => output === ".text" || output.startsWith(".text.");
export const isMovable = (output: string) => isCode(output) || output === ".rodata" || output === ".bun_builtins";
export const mayMove = /^\.(text|rodata|bun_builtins)(\.|$)/;
export const isOrdinary = (output: string) => isMovable(output) || [".data", ".data.rel.ro", ".bss"].includes(output);
export const ignoredOutputs = /^\.(debug|gdb_index|symtab|strtab|comment|shstrtab|eh_frame|rela|tbss)/;

const EM_X86_64 = 62;
const EM_AARCH64 = 183;
const R_X86_64_64 = 1;
const R_AARCH64_ABS64 = 257;
const pointerRelocationTypes = new Map([
  [EM_X86_64, R_X86_64_64],
  [EM_AARCH64, R_AARCH64_ABS64],
]);

export interface ElfObjectReferences {
  references: Map<string, Set<string>>;
  definitions: [name: string, section: string][];
  named: [name: string, section: string][];
  namedByUnwindTables: Set<string>;
  recordSections: { bytes: Buffer; references: Map<number, string> }[];
}

export function readElfObject(
  path: string,
  liveSections: Set<string>,
  archives: ArchiveCache,
): ElfObjectReferences | UnreadReason {
  const result: ElfObjectReferences = {
    references: new Map(),
    definitions: [],
    named: [],
    namedByUnwindTables: new Set(),
    recordSections: [],
  };
  if (existsSync(path)) return readObjectAt(path, 0, liveSections, result) ?? result;
  const inArchive = splitArchivePath(path);
  if (inArchive === undefined || !existsSync(inArchive.archive)) return "NotFound";
  const members = archives.members(inArchive.archive).get(inArchive.member) ?? [];
  if (members.length === 0) return "NotFound";
  for (const member of members) {
    const reason = readObjectAt(member.archive, member.offset, liveSections, result);
    if (reason !== undefined) return reason;
  }
  return result;
}

const isLaidOutUnchanged = (section: SectionHeader) =>
  (section.flags & 2) !== 0 && (section.flags & 0x10) === 0 && section.size > 0 && !ignoredOutputs.test(section.name);

function readObjectAt(
  path: string,
  base: number,
  liveSections: Set<string>,
  result: ElfObjectReferences,
): UnreadReason | undefined {
  const elf = openElf(path, "r", base);
  if (elf === undefined) return "NotAnObject";
  try {
    return readObjectTables(elf, base, liveSections, result);
  } finally {
    closeSync(elf.fd);
  }
}

function readObjectTables(
  elf: ElfFile,
  base: number,
  liveSections: Set<string>,
  result: ElfObjectReferences,
): UnreadReason | undefined {
  const { fd, sections } = elf;
  const symbolTable = sections.find(section => section.type === 2);
  if (symbolTable === undefined) return undefined;
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
    // AArch64's mapping symbols, $x and $d, mark where code and data begin.
    if (mayMove.test(section) && !name.startsWith("$")) result.named.push([name, section]);
  }
  const targets: (string | undefined)[] = new Array(count);
  const targetOf = (index: number) => {
    let target = targets[index];
    if (target === undefined) {
      const info = symbols[index * 24 + 4]!;
      const section = sectionOf(index);
      if ((info & 15) === 6) target = "";
      else if (info >> 4 === 0)
        target =
          section > 0 && section < sections.length && isLaidOutUnchanged(sections[section]!)
            ? "L" + sections[section]!.name
            : "";
      else target = "G" + stringAt(strings, symbols.readUInt32LE(index * 24));
      targets[index] = target;
    }
    return target;
  };
  const pointerRelocationType = pointerRelocationTypes.get(readAt(fd, base + 18, 2).readUInt16LE(0));
  for (const section of sections) {
    const source =
      section.type === 4 || section.type === 9 || section.type === 0x40000014 ? sections[section.info]!.name : "";
    if (source === ".eh_frame" && section.type === 4) {
      const relocations = readAt(fd, section.offset, section.size);
      for (let at = 0; at < relocations.length; at += 24) {
        const target = targetOf(relocations.readUInt32LE(at + 12));
        if (target[0] === "G") result.namedByUnwindTables.add(target.slice(1));
      }
    }
    if (source === elfRecordSectionName) {
      if (section.type !== 4) return "UnsupportedRelocations";
      const relocations = readAt(fd, section.offset, section.size);
      const references = new Map<number, string>();
      for (let at = 0; at < relocations.length; at += 24) {
        if (relocations.readUInt32LE(at + 8) !== pointerRelocationType) return "UnsupportedRelocations";
        const offset = relocations.readUInt32LE(at) + relocations.readUInt32LE(at + 4) * 0x100000000;
        const target = targetOf(relocations.readUInt32LE(at + 12));
        if (target !== "") references.set(offset, target);
      }
      const records = sections[section.info]!;
      result.recordSections.push({ bytes: readAt(fd, records.offset, records.size), references });
    }
    if (!liveSections.has(source)) continue;
    if (section.type !== 4) return "UnsupportedRelocations";
    let set = result.references.get(source);
    if (set === undefined) result.references.set(source, (set = new Set()));
    const relocations = readAt(fd, section.offset, section.size);
    for (let at = 0; at < relocations.length; at += 24) {
      const target = targetOf(relocations.readUInt32LE(at + 12));
      if (target !== "") set.add(target);
    }
  }
  return undefined;
}

export function foldedSections(log: string): Map<string, string> {
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
