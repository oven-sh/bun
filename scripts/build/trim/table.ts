import { BuildError } from "../error.ts";
import type { IcuPackageRuns } from "./icu-data.ts";
import { fieldBytes, recordBytes, sectionNames, type SectionName } from "./table-format.ts";
import {
  edgeStrengths,
  type IcuLanguage,
  type ModuleTextRange,
  type Partition,
  type RemovableRange,
  type TrimTable,
} from "./types.ts";

export type { IcuItemRun, IcuPackage, ModuleText, TrimTable } from "./types.ts";
export { recordBytes };

export const trimTableMagic = "BUNTRIM\0";
export const trimTableVersion = 4;
export const trimTableHeaderBytes = 96;

export interface TableParts {
  featuresHash: bigint;
  partition: Partition;
  ranges: RemovableRange[];
  icuPackages: IcuPackageRuns[];
  icuLanguages: IcuLanguage[];
  moduleTexts: ModuleTextRange[];
}

export const roomFor = (tableBytes: number) => Math.ceil((tableBytes * 17) / 16 / 1024) * 1024;

// `apply` in src/trim/apply.rs writes a header and at most one RemovedRange for each range and each module text over
// the table, and fails without the room.
export const removedRangeListBytes = (rangeCount: number) => 16 + 16 * rangeCount;

const versionOffset = 8;
const byteLengthOffset = 12;
const featuresHashOffset = 16;
const baseAddressOffset = 24;
const directoryOffset = 32;
const directoryEntryBytes = 8;
const sectionAlignment = 4;
const baseAddressAlignment = 65536;
const setCountLimit = 65536;
const languageNameBytes = 4;
const u32Limit = 2 ** 32;
const addressLimit = 2 ** 53;
const fillOnly = 0;
const cutOrFill = 1;
const cutOnly = 2;

type Span = [first: number, count: number];

interface AddressRange {
  start: number;
  end: number;
}

const byStart = (a: AddressRange, b: AddressRange) => a.start - b.start;

interface SectionRecords {
  edges: [from: number, to: number, strength: number, isFollowed: number];
  featureSets: [firstMember: number, memberCount: number];
  setMembers: [feature: number];
  ranges: [start: number, size: number, set: number, isCode: number, removalMethods: number];
  icuPackages: [start: number, size: number, firstRun: number, runCount: number];
  icuRuns: [firstItem: number, itemCount: number, set: number, localeGroup: number];
  icuLanguages: [name: number, group: number, reserved: number];
  moduleTexts: [
    start: number,
    size: number,
    module: number,
    set: number,
    readers: number,
    removalMethods: number,
    reserved: number,
  ];
}
type Sections = Record<SectionName, Buffer>;

const hex = (address: number) => "0x" + address.toString(16);
const alignSection = (offset: number) => Math.ceil(offset / sectionAlignment) * sectionAlignment;
const isUnsignedBelow = (value: number, limit: number) => Number.isInteger(value) && value >= 0 && value < limit;

export function assembleTable(parts: TableParts): TrimTable {
  const { featuresHash, partition } = parts;
  const sets: number[][] = [];
  const setNumbers = new Map<string, number>();
  const internSet = (members: number[]): number => {
    if (members.length === 0) throw new BuildError("the trim table cannot list the empty feature set");
    const key = members.join();
    let set = setNumbers.get(key);
    if (set === undefined) {
      set = sets.push(members) - 1;
      setNumbers.set(key, set);
    }
    return set;
  };
  const renumberSet = (set: number): number => {
    const members = partition.sets[set];
    if (members === undefined) {
      throw new BuildError(`the trim table uses set ${set}, but the partition has ${partition.sets.length} sets`);
    }
    return internSet(members);
  };
  const packages = [...parts.icuPackages].sort(byStart);
  const texts = [...parts.moduleTexts].sort(byStart);
  const ranges = rangesOutside(parts.ranges, [...packages, ...texts].sort(byStart)).map(range => ({
    ...range,
    set: renumberSet(range.set),
  }));
  const icuPackages = packages.map(({ start, end, runs }) => ({
    start,
    end,
    runs: runs.map(({ firstItem, itemCount, features, localeGroup }) => ({
      firstItem,
      itemCount,
      set: internSet(features),
      localeGroup,
    })),
  }));
  const moduleTexts = texts.map(({ set, readers, ...text }) => ({
    ...text,
    set: renumberSet(set),
    readers: readers.length === 0 ? undefined : internSet(readers),
  }));
  const lowestStart = Math.min(...[ranges, icuPackages, moduleTexts].map(list => list[0]?.start ?? Infinity));
  const baseAddress = Number.isFinite(lowestStart) ? lowestStart - (lowestStart % baseAddressAlignment) : 0;
  return {
    featuresHash,
    baseAddress,
    edges: partition.edges,
    sets,
    ranges,
    icuPackages,
    icuLanguages: parts.icuLanguages,
    moduleTexts,
  };
}

// `listedElsewhere` is ascending and disjoint.
function rangesOutside(ranges: RemovableRange[], listedElsewhere: readonly AddressRange[]): RemovableRange[] {
  const outside: RemovableRange[] = [];
  let at = 0;
  for (const range of ranges) {
    let start = range.start;
    while (at < listedElsewhere.length && listedElsewhere[at]!.end <= start) at++;
    for (let index = at; index < listedElsewhere.length && listedElsewhere[index]!.start < range.end; index++) {
      const other = listedElsewhere[index]!;
      if (start < other.start) outside.push({ ...range, start, end: other.start });
      start = other.end;
    }
    if (start < range.end) outside.push({ ...range, start });
  }
  return outside;
}

function checkFormatLimits({ featuresHash, baseAddress, sets, ranges, icuPackages, moduleTexts }: TrimTable): void {
  if (BigInt.asUintN(64, featuresHash) !== featuresHash) {
    throw new BuildError(`the trim table's features hash ${featuresHash} does not fit in 64 bits`);
  }
  if (!isUnsignedBelow(baseAddress, addressLimit)) {
    throw new BuildError(`the trim table's base address ${baseAddress} is not an integer below 2^53`);
  }
  if (sets.length >= setCountLimit) {
    throw new BuildError(`the trim table has ${sets.length} feature sets, the limit is ${setCountLimit - 1}`);
  }
  for (const { start, end } of [...ranges, ...icuPackages, ...moduleTexts]) {
    if (!isUnsignedBelow(start, addressLimit) || !isUnsignedBelow(end, addressLimit)) {
      throw new BuildError(`the trim table's addresses ${start} and ${end} are not integers below 2^53`);
    }
    if (start < baseAddress) {
      throw new BuildError(`the trim table's address ${hex(start)} is below its base address ${hex(baseAddress)}`);
    }
    if (start - baseAddress >= u32Limit) {
      throw new BuildError(`the trim table's address ${hex(start)} is 2^32 or more above ${hex(baseAddress)}`);
    }
    if (end - start >= u32Limit) {
      throw new BuildError(`the trim table's range at ${hex(start)} has ${end - start} bytes, the limit is 2^32 - 1`);
    }
  }
  for (const { firstItem, itemCount } of icuPackages.flatMap(({ runs }) => runs)) {
    if (!isUnsignedBelow(firstItem, u32Limit) || !isUnsignedBelow(itemCount, u32Limit)) {
      throw new BuildError(`the trim table's ICU run of ${itemCount} items at ${firstItem} does not fit in 32 bits`);
    }
  }
}

function createSpanSequence(): (count: number) => Span {
  let next = 0;
  return count => {
    const first = next;
    next += count;
    return [first, count];
  };
}

function packRecords<Name extends SectionName>(name: Name, records: readonly SectionRecords[Name][]): Buffer {
  const bytes = Buffer.alloc(records.length * recordBytes(name));
  let at = 0;
  for (const record of records) {
    const fields: readonly number[] = record;
    fieldBytes(name).forEach((width, field) => {
      bytes.writeUIntLE(fields[field]!, at, width);
      at += width;
    });
  }
  return bytes;
}

function packRemovalMethods({ canBeCut, canBeFilled }: Pick<RemovableRange, "canBeCut" | "canBeFilled">): number {
  return canBeFilled ? (canBeCut ? cutOrFill : fillOnly) : cutOnly;
}

function packSections(table: TrimTable): Sections {
  const { baseAddress, edges, sets, ranges, icuPackages, icuLanguages, moduleTexts } = table;
  const nextMemberSpan = createSpanSequence();
  const nextRunSpan = createSpanSequence();
  const edgeRecords = edges.map(({ from, to, strength, isFollowed }): SectionRecords["edges"] => [
    from,
    to,
    edgeStrengths.indexOf(strength),
    Number(isFollowed),
  ]);
  const rangeRecords = ranges.map((range): SectionRecords["ranges"] => [
    range.start - baseAddress,
    range.end - range.start,
    range.set,
    Number(range.isCode),
    packRemovalMethods(range),
  ]);
  const packageRecords = icuPackages.map(({ start, end, runs }): SectionRecords["icuPackages"] => [
    start - baseAddress,
    end - start,
    ...nextRunSpan(runs.length),
  ]);
  const runRecords = icuPackages
    .flatMap(({ runs }) => runs)
    .map(({ firstItem, itemCount, set, localeGroup }): SectionRecords["icuRuns"] => [
      firstItem,
      itemCount,
      set,
      localeGroup === undefined ? 0 : localeGroup + 1,
    ]);
  const languageRecords = icuLanguages.map(({ name, group }): SectionRecords["icuLanguages"] => [
    Buffer.from(name.padEnd(languageNameBytes, "\0"), "latin1").readUInt32LE(0),
    group,
    0,
  ]);
  const moduleTextRecords = moduleTexts.map((text): SectionRecords["moduleTexts"] => [
    text.start - baseAddress,
    text.end - text.start,
    text.module,
    text.set,
    text.readers === undefined ? 0 : text.readers + 1,
    packRemovalMethods(text),
    0,
  ]);
  return {
    edges: packRecords("edges", edgeRecords),
    featureSets: packRecords(
      "featureSets",
      sets.map(set => nextMemberSpan(set.length)),
    ),
    setMembers: packRecords(
      "setMembers",
      sets.flat().map((feature): SectionRecords["setMembers"] => [feature]),
    ),
    ranges: packRecords("ranges", rangeRecords),
    icuPackages: packRecords("icuPackages", packageRecords),
    icuRuns: packRecords("icuRuns", runRecords),
    icuLanguages: packRecords("icuLanguages", languageRecords),
    moduleTexts: packRecords("moduleTexts", moduleTextRecords),
  };
}

export function encodeTable(table: TrimTable): Buffer {
  checkFormatLimits(table);
  const sections = packSections(table);
  let byteLength = trimTableHeaderBytes;
  const offsets = sectionNames.map(name => {
    const offset = byteLength;
    byteLength = alignSection(offset + sections[name].length);
    return offset;
  });
  if (byteLength >= u32Limit) {
    throw new BuildError(`the trim table takes ${byteLength} bytes, the limit is 2^32 - 1`);
  }
  const bytes = Buffer.alloc(byteLength);
  bytes.write(trimTableMagic, 0, "latin1");
  bytes.writeUInt32LE(trimTableVersion, versionOffset);
  bytes.writeUInt32LE(byteLength, byteLengthOffset);
  bytes.writeBigUInt64LE(table.featuresHash, featuresHashOffset);
  bytes.writeBigUInt64LE(BigInt(table.baseAddress), baseAddressOffset);
  sectionNames.forEach((name, index) => {
    const entry = directoryOffset + index * directoryEntryBytes;
    bytes.writeUInt32LE(offsets[index]!, entry);
    bytes.writeUInt32LE(sections[name].length / recordBytes(name), entry + 4);
    bytes.set(sections[name], offsets[index]!);
  });
  return bytes;
}
