import { closeSync, constants, copyFileSync, fstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import {
  CoffObject,
  IMAGE_COMDAT_SELECT_ASSOCIATIVE,
  IMAGE_COMDAT_SELECT_NODUPLICATES,
  IMAGE_SCN_LNK_COMDAT,
  IMAGE_SYM_CLASS_STATIC,
  notLoadedFlags,
  type CoffSymbolTable,
} from "./coff-objects.ts";

const nameableSectionName = /^\.(rdata|xdata)$/;

/**
 * The unwind records and jump tables of functions: associative sections that hold no symbol. Only those that the function, or
 * what is kept with it, refers to: they stay in the link with the function when they are no longer tied to it.
 */
function findNameableSections(object: CoffObject): number[] {
  const { sections } = object;
  const isCandidate = sections.map(
    section =>
      (section.flags & IMAGE_SCN_LNK_COMDAT) !== 0 &&
      (section.flags & notLoadedFlags) === 0 &&
      section.selection === IMAGE_COMDAT_SELECT_ASSOCIATIVE &&
      section.size > 0 &&
      section.definition >= 0 &&
      !section.hasSymbol &&
      nameableSectionName.test(section.name),
  );
  if (!isCandidate.includes(true)) return [];
  const functionOf = (index: number) =>
    sections[index]!.selection === IMAGE_COMDAT_SELECT_ASSOCIATIVE ? sections[index]!.parent - 1 : index;
  const referrersOf = new Map<number, number[]>();
  sections.forEach((section, from) => {
    if (section.flags & notLoadedFlags) return;
    for (const symbol of object.targetsOf(section)) {
      const to = object.symbolSection[symbol]! - 1;
      if (to < 0 || to === from || !isCandidate[to] || functionOf(from) !== functionOf(to)) continue;
      const referrers = referrersOf.get(to);
      if (referrers === undefined) referrersOf.set(to, [from]);
      else referrers.push(from);
    }
  });
  const isKeptWithFunction = isCandidate.map(candidate => !candidate);
  for (let hasChanged = true; hasChanged;) {
    hasChanged = false;
    for (const [section, referrers] of referrersOf) {
      if (isKeptWithFunction[section] || !referrers.some(from => isKeptWithFunction[from])) continue;
      isKeptWithFunction[section] = true;
      hasChanged = true;
    }
  }
  return sections.flatMap((_, index) => (isCandidate[index] && isKeptWithFunction[index] ? [index] : []));
}

function writeLeaders(
  fd: number,
  object: CoffObject,
  table: CoffSymbolTable,
  sections: number[],
  prefix: string,
): void {
  const { offset, recordBytes, isBig, records, strings } = table;
  const leaders = Buffer.alloc(sections.length * recordBytes);
  let names = "";
  sections.forEach((section, number) => {
    const auxiliary = (object.sections[section]!.definition + 1) * recordBytes;
    records.writeUInt16LE(0, auxiliary + 12);
    records[auxiliary + 14] = IMAGE_COMDAT_SELECT_NODUPLICATES;
    if (isBig) records.writeUInt16LE(0, auxiliary + 16);
    const leader = number * recordBytes;
    leaders.writeUInt32LE(strings.length + names.length, leader + 4);
    if (isBig) leaders.writeUInt32LE(section + 1, leader + 12);
    else leaders.writeUInt16LE(section + 1, leader + 12);
    leaders[leader + recordBytes - 2] = IMAGE_SYM_CLASS_STATIC;
    names += `${prefix}_${section + 1}\0`;
  });
  const grownStrings = Buffer.concat([strings, Buffer.from(names, "latin1")]);
  grownStrings.writeUInt32LE(grownStrings.length, 0);
  const end = fstatSync(fd).size;
  const isLastInFile = offset + records.length + strings.length === end;
  const newOffset = isLastInFile ? offset : Math.ceil(end / 4) * 4;
  const grown = Buffer.concat([records, leaders, grownStrings]);
  writeSync(fd, grown, 0, grown.length, newOffset);
  const fields = Buffer.alloc(8);
  fields.writeUInt32LE(newOffset, 0);
  fields.writeUInt32LE((records.length + leaders.length) / recordBytes, 4);
  writeSync(fd, fields, 0, 8, isBig ? 48 : 8);
}

/**
 * lld-link places a section by the name of the symbol that leads its COMDAT, and its map names a section by its symbols. An
 * associative section has no leader. Those of `source` that can do without the tie get a leader named `<prefix>_<section>`.
 * Returns false, and writes nothing, where there are none.
 */
export function nameSections(source: string, prefix: string, target: string = source): boolean {
  const reading = openSync(source, "r");
  let object: CoffObject | undefined;
  let sections: number[];
  try {
    object = CoffObject.open(reading, 0, fstatSync(reading).size);
    sections = object === undefined ? [] : findNameableSections(object);
  } finally {
    closeSync(reading);
  }
  const table = object?.symbolTable;
  if (object === undefined || table === undefined || sections.length === 0) return false;
  if (target !== source) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_FICLONE);
  }
  const fd = openSync(target, "r+");
  try {
    writeLeaders(fd, object, table, sections, prefix);
  } finally {
    closeSync(fd);
  }
  return true;
}
