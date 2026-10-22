import { BuildError } from "../error.ts";
import type { IcuPackageRuns } from "./icu-data.ts";
import type { LibraryBytes } from "./libraries.ts";
import {
  edgeStrengths,
  featureIndexLimit,
  type EdgeStrength,
  type FeatureEdge,
  type IcuItemRun,
  type IcuLanguage,
  type IcuPackage,
  type LibraryUse,
  type ModuleText,
  type ModuleTextRange,
  type Partition,
  type RemovableRange,
  type TrimTable,
} from "./types.ts";

export type { IcuItemRun, IcuPackage, LibraryUse, ModuleText, TrimTable } from "./types.ts";

export const trimTableMagic = "BUNTRIM\0";
export const trimTableVersion = 3;
export const trimTableHeaderBytes = 120;

export interface TableParts {
  featuresHash: bigint;
  partition: Partition;
  ranges: RemovableRange[];
  icuPackages: IcuPackageRuns[];
  icuLanguages: IcuLanguage[];
  libraries: LibraryBytes[];
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
const localeGroupLimit = 65535;
const moduleLimit = 65536;
const languageNameBytes = 4;
const languageNamePattern = /^[a-z]{2,3}$/;
const u32Limit = 2 ** 32;
const addressLimit = 2 ** 53;
const fillOnly = 0;
const cutOrFill = 1;
const cutOnly = 2;

type Span = [first: number, count: number];

interface Sliceable<Self> {
  length: number;
  slice(start: number, end: number): Self;
}

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
  libraries: [
    nameStart: number,
    nameBytes: number,
    versionStart: number,
    versionBytes: number,
    firstSet: number,
    setCount: number,
    hasRetainedBytes: number,
  ];
  librarySets: [set: number];
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
type RecordSectionName = keyof SectionRecords;
type SectionName = RecordSectionName | "text";
type Sections = Record<SectionName, Buffer>;

// The bytes of each field of a record, in directory order. src/trim/table.rs reads the same format.
const fieldBytes: Record<SectionName, readonly number[]> = {
  edges: [2, 2, 1, 1],
  featureSets: [4, 4],
  setMembers: [2],
  ranges: [4, 4, 2, 1, 1],
  icuPackages: [4, 4, 4, 4],
  icuRuns: [4, 4, 2, 2],
  icuLanguages: [4, 2, 2],
  libraries: [4, 4, 4, 4, 4, 4, 4],
  librarySets: [2],
  text: [1],
  moduleTexts: [4, 4, 2, 2, 2, 1, 1],
};
const sectionNames = Object.keys(fieldBytes) as SectionName[];

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const malformed = (rule: string) => new BuildError(`the trim table is malformed: ${rule}`);
const hex = (address: number) => "0x" + address.toString(16);
export const recordBytes = (name: SectionName) => fieldBytes[name].reduce((sum, bytes) => sum + bytes, 0);
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
  const libraries = parts.libraries.map(library => ({
    name: library.name,
    version: library.version,
    hasRetainedBytes: library.retainedBytes > 0,
    sets: library.sets.map(renumberSet).sort((a, b) => a - b),
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
    libraries,
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

function checkWellFormed(table: TrimTable): void {
  const setCount = table.sets.length;
  checkEdges(table.edges);
  checkSets(table.sets);
  checkAddressRanges(table.ranges, "range");
  for (const { start, set, canBeCut, canBeFilled } of table.ranges) {
    if (!isUnsignedBelow(set, setCount)) throw malformed(`the range at ${hex(start)} has set ${set} of ${setCount}`);
    if (!canBeCut && !canBeFilled) throw malformed(`the range at ${hex(start)} can be neither cut nor filled`);
  }
  checkIcuLanguages(table.icuLanguages);
  const groups = new Set(table.icuLanguages.map(({ group }) => group));
  checkAddressRanges(table.icuPackages, "ICU package");
  for (const { runs } of table.icuPackages) checkIcuRuns(runs, setCount, groups);
  checkLibraries(table.libraries, setCount);
  checkAddressRanges(table.moduleTexts, "module text");
  checkModuleTexts(table.moduleTexts, table.sets);
}

function checkEdges(edges: FeatureEdge[]): void {
  edges.forEach(({ from, to, strength, isFollowed }, at) => {
    if (!isUnsignedBelow(from, featureIndexLimit) || !isUnsignedBelow(to, featureIndexLimit)) {
      throw malformed(`Edges has features ${from} and ${to}, not both below ${featureIndexLimit}`);
    }
    if (from === to) throw malformed(`feature ${from} has an edge to itself`);
    if (strength === "Reference" && !isFollowed) {
      throw malformed(`the reference from feature ${from} to feature ${to} is not followed`);
    }
    if (at === 0) return;
    const previous = edges[at - 1]!;
    if (from < previous.from || (from === previous.from && to <= previous.to)) {
      throw malformed("Edges is not strictly ascending");
    }
  });
}

function checkStrictlyAscending(indexes: number[], limit: number, list: string): void {
  indexes.forEach((index, at) => {
    if (!isUnsignedBelow(index, limit)) throw malformed(`${list} has index ${index}, not below ${limit}`);
    if (at > 0 && index <= indexes[at - 1]!) throw malformed(`${list} is not strictly ascending`);
  });
}

function checkSets(sets: number[][]): void {
  const distinct = new Set<string>();
  for (const set of sets) {
    if (set.length === 0) throw malformed("a feature set is empty");
    checkStrictlyAscending(set, featureIndexLimit, "a feature set");
    distinct.add(set.join());
  }
  if (distinct.size !== sets.length) throw malformed("two feature sets are equal");
}

function checkAddressRanges(ranges: readonly AddressRange[], kind: string): void {
  let previousEnd = 0;
  for (const { start, end } of ranges) {
    if (start >= end) throw malformed(`the ${kind} at ${hex(start)} is empty`);
    if (start < previousEnd) throw malformed(`the ${kind} at ${hex(start)} overlaps the previous one`);
    previousEnd = end;
  }
}

function checkIcuLanguages(languages: IcuLanguage[]): void {
  languages.forEach(({ name, group }, at) => {
    if (!languageNamePattern.test(name)) {
      throw malformed(`the ICU language ${JSON.stringify(name)} is not two or three letters from a to z`);
    }
    if (!isUnsignedBelow(group, localeGroupLimit)) {
      throw malformed(`the ICU language ${name} has group ${group}, not below ${localeGroupLimit}`);
    }
    if (at > 0 && name <= languages[at - 1]!.name) throw malformed("IcuLanguages is not strictly ascending");
  });
}

function checkIcuRuns(runs: IcuItemRun[], setCount: number, groups: Set<number>): void {
  let previousEnd = 0;
  for (const { firstItem, itemCount, set, localeGroup } of runs) {
    if (itemCount < 1) throw malformed(`the ICU run at item ${firstItem} is empty`);
    if (firstItem < previousEnd) throw malformed(`the ICU run at item ${firstItem} overlaps the previous one`);
    if (!isUnsignedBelow(set, setCount)) {
      throw malformed(`the ICU run at item ${firstItem} has set ${set} of ${setCount}`);
    }
    if (localeGroup !== undefined && !groups.has(localeGroup)) {
      throw malformed(`the ICU run at item ${firstItem} has locale group ${localeGroup}, which no ICU language has`);
    }
    previousEnd = firstItem + itemCount;
  }
}

function checkLibraries(libraries: LibraryUse[], setCount: number): void {
  let previousName: Buffer | undefined;
  for (const { name, version, sets } of libraries) {
    const nameBytes = Buffer.from(name);
    if (utf8.decode(nameBytes) !== name || utf8.decode(Buffer.from(version)) !== version) {
      throw malformed(`the text of library ${name} has no UTF-8 encoding`);
    }
    if (previousName !== undefined && Buffer.compare(previousName, nameBytes) >= 0) {
      throw malformed("library names are not strictly ascending");
    }
    checkStrictlyAscending(sets, setCount, `the sets of library ${name}`);
    previousName = nameBytes;
  }
}

function checkModuleTexts(moduleTexts: ModuleText[], sets: number[][]): void {
  const modules = new Set<number>();
  for (const { start, module, set, readers, canBeCut, canBeFilled } of moduleTexts) {
    const text = `the module text at ${hex(start)}`;
    if (!isUnsignedBelow(module, moduleLimit)) {
      throw malformed(`${text} has module ${module}, not below ${moduleLimit}`);
    }
    if (modules.has(module)) throw malformed(`module ${module} has two texts`);
    modules.add(module);
    if (!isUnsignedBelow(set, sets.length)) throw malformed(`${text} has set ${set} of ${sets.length}`);
    if (!canBeCut && !canBeFilled) throw malformed(`${text} can be neither cut nor filled`);
    if (readers === undefined) continue;
    if (!isUnsignedBelow(readers, sets.length)) throw malformed(`${text} has readers ${readers} of ${sets.length}`);
    if (readers === set || !sets[readers]!.every(feature => sets[set]!.includes(feature))) {
      throw malformed(`the readers of ${text} are not some of its set`);
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

function packRecords<Name extends RecordSectionName>(name: Name, records: readonly SectionRecords[Name][]): Buffer {
  const bytes = Buffer.alloc(records.length * recordBytes(name));
  let at = 0;
  for (const record of records) {
    const fields: readonly number[] = record;
    fieldBytes[name].forEach((width, field) => {
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
  const { baseAddress, edges, sets, ranges, icuPackages, icuLanguages, libraries, moduleTexts } = table;
  const nextMemberSpan = createSpanSequence();
  const nextRunSpan = createSpanSequence();
  const nextLibrarySetSpan = createSpanSequence();
  const nextTextSpan = createSpanSequence();
  const text: Buffer[] = [];
  const appendText = (value: string): Span => {
    const bytes = Buffer.from(value);
    text.push(bytes);
    return nextTextSpan(bytes.length);
  };
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
  const libraryRecords = libraries.map((library): SectionRecords["libraries"] => [
    ...appendText(library.name),
    ...appendText(library.version),
    ...nextLibrarySetSpan(library.sets.length),
    Number(library.hasRetainedBytes),
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
    libraries: packRecords("libraries", libraryRecords),
    librarySets: packRecords(
      "librarySets",
      libraries.flatMap(library => library.sets).map((set): SectionRecords["librarySets"] => [set]),
    ),
    text: Buffer.concat(text),
    moduleTexts: packRecords("moduleTexts", moduleTextRecords),
  };
}

export function encodeTable(table: TrimTable): Buffer {
  checkFormatLimits(table);
  checkWellFormed(table);
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

function readHeader(input: Buffer): { byteLength: number; featuresHash: bigint; baseAddress: number } {
  if (input.length < trimTableHeaderBytes) throw malformed(`${input.length} bytes cannot hold the header`);
  if (input.toString("latin1", 0, trimTableMagic.length) !== trimTableMagic) throw malformed("the magic is wrong");
  const version = input.readUInt32LE(versionOffset);
  if (version !== trimTableVersion) throw malformed(`the version is ${version}, not ${trimTableVersion}`);
  const byteLength = input.readUInt32LE(byteLengthOffset);
  if (byteLength < trimTableHeaderBytes || byteLength > input.length) {
    throw malformed(`byteLength is ${byteLength}, the input has ${input.length} bytes`);
  }
  if (input.subarray(byteLength).some(byte => byte !== 0)) throw malformed("a byte after byteLength is not zero");
  const baseAddress = input.readBigUInt64LE(baseAddressOffset);
  if (baseAddress >= BigInt(addressLimit)) throw malformed(`baseAddress ${baseAddress} is not below 2^53`);
  return { byteLength, featuresHash: input.readBigUInt64LE(featuresHashOffset), baseAddress: Number(baseAddress) };
}

function readSections(input: Buffer, byteLength: number): Sections {
  const sections: Partial<Sections> = {};
  let previousEnd = trimTableHeaderBytes;
  sectionNames.forEach((name, index) => {
    const entry = directoryOffset + index * directoryEntryBytes;
    const offset = input.readUInt32LE(entry);
    const end = offset + input.readUInt32LE(entry + 4) * recordBytes(name);
    if (offset % sectionAlignment !== 0) {
      throw malformed(`section ${name} starts at ${offset}, not at a multiple of ${sectionAlignment}`);
    }
    if (offset < previousEnd) throw malformed(`section ${name} starts at ${offset}, before byte ${previousEnd}`);
    if (end > byteLength) throw malformed(`section ${name} ends at ${end}, past byteLength ${byteLength}`);
    sections[name] = input.subarray(offset, end);
    previousEnd = end;
  });
  return sections as Sections;
}

function unpackRecords<Name extends RecordSectionName>(name: Name, sections: Sections): SectionRecords[Name][] {
  const bytes = sections[name];
  const records: number[][] = [];
  let at = 0;
  while (at < bytes.length) {
    const record: number[] = [];
    for (const width of fieldBytes[name]) {
      record.push(bytes.readUIntLE(at, width));
      at += width;
    }
    records.push(record);
  }
  return records as SectionRecords[Name][];
}

function checkTiling(spans: Span[], itemCount: number, rule: string): void {
  let next = 0;
  for (const [first, count] of spans) {
    if (first !== next || count > itemCount - next) throw malformed(rule);
    next += count;
  }
  if (next !== itemCount) throw malformed(rule);
}

function sliceBySpans<Items extends Sliceable<Items>>(items: Items, spans: Span[], rule: string): Items[] {
  checkTiling(spans, items.length, rule);
  return spans.map(([first, count]) => items.slice(first, first + count));
}

function readFlag(value: number, field: string): boolean {
  if (value > 1) throw malformed(`${field} is ${value}`);
  return value === 1;
}

function readStrength(value: number): EdgeStrength {
  const strength = edgeStrengths[value];
  if (strength === undefined) throw malformed(`strength is ${value}`);
  return strength;
}

function readRemovalMethods(value: number): Pick<RemovableRange, "canBeCut" | "canBeFilled"> {
  if (value > cutOnly) throw malformed(`removalMethods is ${value}`);
  return { canBeCut: value !== fillOnly, canBeFilled: value !== cutOnly };
}

function readAddressRange(baseAddress: number, start: number, size: number): AddressRange {
  const end = baseAddress + start + size;
  if (end >= addressLimit) throw malformed(`the address ${start} + ${size} above baseAddress is not below 2^53`);
  return { start: baseAddress + start, end };
}

function readText(bytes: Buffer): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw malformed("library text is not valid UTF-8");
  }
}

function readLanguageName(value: number): string {
  const bytes = Buffer.alloc(languageNameBytes);
  bytes.writeUInt32LE(value);
  return bytes.toString("latin1").replace(/\0+$/, "");
}

function readEdges(sections: Sections): FeatureEdge[] {
  return unpackRecords("edges", sections).map(([from, to, strength, isFollowed]) => ({
    from,
    to,
    strength: readStrength(strength),
    isFollowed: readFlag(isFollowed, "isFollowed"),
  }));
}

function readSets(sections: Sections): number[][] {
  const members = unpackRecords("setMembers", sections).map(([feature]) => feature);
  return sliceBySpans(members, unpackRecords("featureSets", sections), "the feature sets do not tile SetMembers");
}

function readRanges(sections: Sections, baseAddress: number): RemovableRange[] {
  return unpackRecords("ranges", sections).map(([start, size, set, isCode, removalMethods]) => ({
    ...readAddressRange(baseAddress, start, size),
    set,
    isCode: readFlag(isCode, "isCode"),
    ...readRemovalMethods(removalMethods),
  }));
}

function readIcuPackages(sections: Sections, baseAddress: number): IcuPackage[] {
  const runs = unpackRecords("icuRuns", sections).map(([firstItem, itemCount, set, localeGroup]) => ({
    firstItem,
    itemCount,
    set,
    localeGroup: localeGroup === 0 ? undefined : localeGroup - 1,
  }));
  const packages = unpackRecords("icuPackages", sections);
  const runSpans = packages.map(([, , firstRun, runCount]): Span => [firstRun, runCount]);
  const packageRuns = sliceBySpans(runs, runSpans, "the ICU packages do not tile IcuRuns");
  return packages.map(([start, size], index) => ({
    ...readAddressRange(baseAddress, start, size),
    runs: packageRuns[index]!,
  }));
}

function readIcuLanguages(sections: Sections): IcuLanguage[] {
  return unpackRecords("icuLanguages", sections).map(([name, group, reserved]) => {
    if (reserved !== 0) throw malformed("the reserved field of an ICU language is not zero");
    return { name: readLanguageName(name), group };
  });
}

function readLibraries(sections: Sections): LibraryUse[] {
  const libraries = unpackRecords("libraries", sections);
  const sets = unpackRecords("librarySets", sections).map(([set]) => set);
  const setSpans = libraries.map(([, , , , firstSet, setCount]): Span => [firstSet, setCount]);
  const librarySets = sliceBySpans(sets, setSpans, "the libraries do not tile LibrarySets");
  const textSpans = libraries.flatMap(([nameStart, nameBytes, versionStart, versionBytes]): Span[] => [
    [nameStart, nameBytes],
    [versionStart, versionBytes],
  ]);
  const text = sliceBySpans(sections.text, textSpans, "the libraries do not tile Text");
  return libraries.map(([, , , , , , hasRetainedBytes], index) => ({
    name: readText(text[2 * index]!),
    version: readText(text[2 * index + 1]!),
    hasRetainedBytes: readFlag(hasRetainedBytes, "hasRetainedBytes"),
    sets: librarySets[index]!,
  }));
}

function readModuleTexts(sections: Sections, baseAddress: number): ModuleText[] {
  return unpackRecords("moduleTexts", sections).map(([start, size, module, set, readers, removalMethods, reserved]) => {
    if (reserved !== 0) throw malformed("the reserved field of a module text is not zero");
    return {
      ...readAddressRange(baseAddress, start, size),
      module,
      set,
      readers: readers === 0 ? undefined : readers - 1,
      ...readRemovalMethods(removalMethods),
    };
  });
}

export function decodeTable(bytes: Uint8Array): TrimTable {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { byteLength, featuresHash, baseAddress } = readHeader(input);
  const sections = readSections(input, byteLength);
  const table: TrimTable = {
    featuresHash,
    baseAddress,
    edges: readEdges(sections),
    sets: readSets(sections),
    ranges: readRanges(sections, baseAddress),
    icuPackages: readIcuPackages(sections, baseAddress),
    icuLanguages: readIcuLanguages(sections),
    libraries: readLibraries(sections),
    moduleTexts: readModuleTexts(sections, baseAddress),
  };
  checkWellFormed(table);
  return table;
}
