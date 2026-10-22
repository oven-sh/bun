import { closeSync } from "node:fs";
import { fail, readAt } from "./binary-reader.ts";
import { openElf, type ElfFile, type SectionHeader } from "./elf-file.ts";
import { featureIndexLimit, nodeAt, type SectionGraph } from "./graph.ts";
import type { Link } from "./linker.ts";
import { EdgeKind, type Partition } from "./partition.ts";
import type { RemovableRange } from "./ranges.ts";

export type RelocationFailure =
  | { kind: "RelinkedImageDiffers"; section: string }
  | { kind: "UnknownRelocationType"; section: string; type: number }
  | { kind: "ReferenceIntoRemovableRange"; from: number; address: number; to: number | undefined; range: RemovableRange };

export interface RelocationInput {
  shipped: Link;
  withRelocations: Link;
  graph: SectionGraph;
  partition: Partition;
  ranges: RemovableRange[];
}

export interface RelocationCheck {
  failures: RelocationFailure[];
  relocations: number;
  intoRanges: number;
  ambiguous: number;
  fieldsOutsideGraph: number;
}

export type ReferenceVerdict = "Legal" | "Illegal" | "Ambiguous";

// The build id is listed because it hashes the whole file, relocation sections included.
export const sectionsWrittenAfterLink = [".bun_trim", ".note.gnu.build-id"];

const Machine = { X86_64: 62, AArch64: 183 } as const;
const SectionFlag = { Alloc: 2, ExecInstr: 4, Tls: 0x400 } as const;
const SectionType = { SymbolTable: 2, Rela: 4, NoBits: 8, Rel: 9, Crel: 0x40000014 } as const;
const relocationSectionTypes: readonly number[] = [SectionType.Rela, SectionType.Rel, SectionType.Crel];
const SymbolType = { Section: 3, Tls: 6 } as const;
const SymbolKind = { NoAddress: 0, Section: 1, Named: 2 } as const;
const undefinedSectionIndex = 0;
const absoluteSectionIndex = 0xfff1;
const machineOffset = 0x12;
const symbolBytes = 24;
const relocationBytes = 24;
const notFound = -1;
const wordsPerSet = featureIndexLimit / 32;

type AddendBias = readonly [first: number, last: number] | "UnknownBase";

interface AddressRule {
  inCode: AddendBias;
  inData: AddendBias;
}

type RelocationRule = AddressRule | "NoAddress";
type TypeRange = number | readonly [first: number, last: number];
type RulesByType = readonly (RelocationRule | undefined)[];

interface RuleEntry {
  types: readonly TypeRange[];
  rule: RelocationRule;
}

const exactAddend: AddendBias = [0, 0];
// 4, or 5, 6 or 8 with an immediate after the field. Only decoding the instruction would tell them apart.
const fieldToNextInstruction: AddendBias = [4, 8];
const absolute: AddressRule = { inCode: exactAddend, inData: exactAddend };
// The field holds `target - base`. Its addend includes its distance from `base`, any label in its own input section.
const labelDifference: AddressRule = { inCode: "UnknownBase", inData: "UnknownBase" };

const relocationRules = new Map<number, readonly RuleEntry[]>([
  [
    Machine.X86_64,
    [
      { types: [1, 10, 11, 12, 14], rule: absolute },
      { types: [2, 4, 9, 41, 42], rule: { inCode: fieldToNextInstruction, inData: "UnknownBase" } },
      { types: [24], rule: { inCode: [8, 8], inData: "UnknownBase" } },
      { types: [0, [16, 23], [32, 36]], rule: "NoAddress" },
    ],
  ],
  [
    Machine.AArch64,
    [
      { types: [257, 258, [274, 280], [282, 286], 299, 311, 312], rule: absolute },
      { types: [260, 261, 314], rule: labelDifference },
      { types: [0, 256, [512, 573]], rule: "NoAddress" },
    ],
  ],
]);

function indexRulesByType(entries: readonly RuleEntry[]): RulesByType {
  const rulesByType: (RelocationRule | undefined)[] = [];
  for (const { types, rule } of entries) {
    for (const range of types) {
      const [first, last]: readonly [number, number] = typeof range === "number" ? [range, range] : range;
      for (let type = first; type <= last; type++) rulesByType[type] = rule;
    }
  }
  return rulesByType;
}

function readUInt64(bytes: Buffer, at: number): number {
  return bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * 0x100000000;
}

function readInt64(bytes: Buffer, at: number): number {
  return bytes.readUInt32LE(at) + bytes.readInt32LE(at + 4) * 0x100000000;
}

const isAllocated = (section: SectionHeader) => (section.flags & SectionFlag.Alloc) !== 0;
const hasBit = (bits: Uint32Array, index: number) => (bits[index >>> 5]! & (1 << (index & 31))) !== 0;

export class ReferenceClassifier {
  private readonly graph: SectionGraph;
  private readonly partition: Partition;
  private readonly ranges: readonly RemovableRange[];
  private readonly rangeEnds: Float64Array;
  private readonly requiredFeatures = new Map<number, number[]>();
  private readonly closures = new Map<number, Uint32Array>();
  private readonly setPairRetention = new Map<number, boolean>();

  constructor({ graph, partition, ranges }: Pick<RelocationInput, "graph" | "partition" | "ranges">) {
    this.graph = graph;
    this.partition = partition;
    this.ranges = ranges;
    this.rangeEnds = Float64Array.from(ranges, range => range.end);
    ranges.forEach((range, index) => {
      if (range.end < range.start || (index > 0 && range.start < ranges[index - 1]!.end)) {
        fail(`the removable ranges are not sorted and disjoint at 0x${range.start.toString(16)}`);
      }
    });
    for (const { from, to, strength } of partition.edges) {
      if (strength !== "Reference") continue;
      const list = this.requiredFeatures.get(from);
      if (list === undefined) this.requiredFeatures.set(from, [to]);
      else list.push(to);
    }
  }

  private findRangeEndingAfter(address: number): number {
    let low = 0;
    let high = this.rangeEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.rangeEnds[middle]! <= address) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  rangeAt(address: number): RemovableRange | undefined {
    const range = this.ranges[this.findRangeEndingAfter(address)];
    return range !== undefined && range.start <= address ? range : undefined;
  }

  overlapsRange(first: number, last: number): boolean {
    const range = this.ranges[this.findRangeEndingAfter(first)];
    return range !== undefined && range.start <= last;
  }

  private closureOf(feature: number): Uint32Array {
    let closure = this.closures.get(feature);
    if (closure !== undefined) return closure;
    closure = new Uint32Array(wordsPerSet);
    closure[feature >>> 5]! |= 1 << (feature & 31);
    const stack = [feature];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      for (const required of this.requiredFeatures.get(next) ?? []) {
        if (hasBit(closure, required)) continue;
        closure[required >>> 5]! |= 1 << (required & 31);
        stack.push(required);
      }
    }
    this.closures.set(feature, closure);
    return closure;
  }

  private impliesRetention(referrerSet: number, rangeSet: number): boolean {
    const { sets } = this.partition;
    const pair = referrerSet * sets.length + rangeSet;
    let isImplied = this.setPairRetention.get(pair);
    if (isImplied === undefined) {
      const rangeFeatures = sets[rangeSet]!;
      isImplied = sets[referrerSet]!.every(feature => {
        const closure = this.closureOf(feature);
        return rangeFeatures.some(member => hasBit(closure, member));
      });
      this.setPairRetention.set(pair, isImplied);
    }
    return isImplied;
  }

  private classifyByGuards(from: number, first: number, last: number): ReferenceVerdict {
    const { address, size, successorStart, successors } = this.graph;
    let verdict: ReferenceVerdict = "Illegal";
    for (let edge = successorStart[from]!; edge < successorStart[from + 1]!; edge++) {
      const kind = this.partition.edgeKind[edge];
      if (kind !== EdgeKind.Guarded && kind !== EdgeKind.Soft) continue;
      const entry = successors[edge]!;
      const start = address[entry]!;
      const end = start + size[entry]!;
      if (start <= first && last < end) return "Legal";
      if (start <= last && first < end) verdict = "Ambiguous";
    }
    return verdict;
  }

  private classifyInRange(from: number, range: RemovableRange, first: number, last: number): ReferenceVerdict {
    const { isRetained, exactSetOf } = this.partition;
    // Not setOf: a node that joined a larger set is dead code when only the added features are retained.
    if (isRetained[from] === 0 && this.impliesRetention(exactSetOf[from]!, range.set)) return "Legal";
    return this.classifyByGuards(from, first, last);
  }

  classify(from: number, first: number, last: number, isSectionSymbol: boolean): ReferenceVerdict {
    let index = this.findRangeEndingAfter(first);
    let range = this.ranges[index];
    if (range === undefined) return "Legal";
    // A section symbol plus addend on a range's first byte may point one past the end of the section before it.
    const startsInside = isSectionSymbol ? range.start < first : range.start <= first;
    const isInsideOneRange = startsInside && last < range.end;
    for (; range !== undefined && range.start <= last; range = this.ranges[++index]) {
      const verdict = this.classifyInRange(from, range, Math.max(first, range.start), Math.min(last, range.end - 1));
      if (verdict !== "Legal") return isInsideOneRange ? verdict : "Ambiguous";
    }
    return "Legal";
  }
}

function hasSameContents(shipped: ElfFile, expected: SectionHeader, relinked: ElfFile, actual: SectionHeader): boolean {
  if (expected.name !== actual.name || expected.type !== actual.type) return false;
  if (expected.address !== actual.address || expected.size !== actual.size) return false;
  if (expected.type === SectionType.NoBits || sectionsWrittenAfterLink.includes(expected.name)) return true;
  return readAt(shipped.fd, expected.offset, expected.size).equals(readAt(relinked.fd, actual.offset, actual.size));
}

function compareImages(shipped: ElfFile, relinked: ElfFile): RelocationFailure[] {
  const shippedSections = shipped.sections.filter(isAllocated);
  const relinkedSections = relinked.sections.filter(isAllocated);
  const failures: RelocationFailure[] = [];
  for (let index = 0; index < Math.max(shippedSections.length, relinkedSections.length); index++) {
    const expected = shippedSections[index];
    const actual = relinkedSections[index];
    const hasBoth = expected !== undefined && actual !== undefined;
    if (hasBoth && hasSameContents(shipped, expected, relinked, actual)) continue;
    failures.push({ kind: "RelinkedImageDiffers", section: (expected ?? actual)!.name });
  }
  return failures;
}

interface Symbols {
  kind: Uint8Array;
  value: Float64Array;
}

function readSymbols(elf: ElfFile, path: string): Symbols {
  const table =
    elf.sections.find(section => section.type === SectionType.SymbolTable) ?? fail(`${path} has no symbol table`);
  const bytes = readAt(elf.fd, table.offset, table.size);
  const count = Math.floor(bytes.length / symbolBytes);
  const kind = new Uint8Array(count);
  const value = new Float64Array(count);
  for (let index = 1; index < count; index++) {
    const at = index * symbolBytes;
    const type = bytes[at + 4]! & 15;
    const sectionIndex = bytes.readUInt16LE(at + 6);
    value[index] = readUInt64(bytes, at + 8);
    if (sectionIndex === undefinedSectionIndex || sectionIndex === absoluteSectionIndex) continue;
    if (type === SymbolType.Tls) continue;
    if (type !== SymbolType.Section) kind[index] = SymbolKind.Named;
    else if (((elf.sections[sectionIndex]?.flags ?? 0) & SectionFlag.Tls) === 0) kind[index] = SymbolKind.Section;
  }
  return { kind, value };
}

interface RelocationSection {
  name: string;
  isCode: boolean;
  bytes: Buffer;
}

interface RelocationContext {
  graph: SectionGraph;
  symbols: Symbols;
  rulesByType: RulesByType;
  classifier: ReferenceClassifier;
  reportedPairs: Set<number>;
}

function checkSection(section: RelocationSection, context: RelocationContext, check: RelocationCheck): void {
  const { name, isCode, bytes } = section;
  const { graph, symbols, rulesByType, classifier, reportedPairs } = context;
  if (bytes.length % relocationBytes !== 0) fail(`the size of ${name} is not a multiple of ${relocationBytes}`);
  check.relocations += bytes.length / relocationBytes;
  const unknownTypes = new Set<number>();
  for (let at = 0; at < bytes.length; at += relocationBytes) {
    const type = bytes.readUInt32LE(at + 8);
    const rule = rulesByType[type];
    if (rule === "NoAddress") continue;
    if (rule === undefined) {
      if (!unknownTypes.has(type)) check.failures.push({ kind: "UnknownRelocationType", section: name, type });
      unknownTypes.add(type);
      continue;
    }
    const symbol = bytes.readUInt32LE(at + 12);
    const symbolKind = symbols.kind[symbol] ?? fail(`${name} refers to symbol ${symbol}, past the symbol table's end`);
    if (symbolKind === SymbolKind.NoAddress) continue;
    const isSectionSymbol = symbolKind === SymbolKind.Section;
    const bias = !isSectionSymbol ? exactAddend : isCode ? rule.inCode : rule.inData;
    const address = readUInt64(bytes, at);
    const unbiased = symbols.value[symbol]! + (isSectionSymbol ? readInt64(bytes, at + 16) : 0);
    let first = unbiased;
    let last = unbiased;
    if (bias !== "UnknownBase") {
      first += bias[0];
      last += bias[1];
    } else {
      const field = nodeAt(graph, address);
      if (field !== notFound) {
        first -= address - graph.address[field]!;
        last = first + graph.size[field]!;
      }
    }
    if (!classifier.overlapsRange(first, last)) continue;
    check.intoRanges++;
    const from = nodeAt(graph, address);
    if (from === notFound) {
      check.fieldsOutsideGraph++;
      continue;
    }
    const verdict = classifier.classify(from, first, last, isSectionSymbol);
    if (verdict === "Ambiguous") check.ambiguous++;
    if (verdict !== "Illegal") continue;
    const target = bias === "UnknownBase" ? unbiased : first;
    const to = nodeAt(graph, target);
    const pair = from * (graph.count + 1) + to + 1;
    if (reportedPairs.has(pair)) continue;
    reportedPairs.add(pair);
    check.failures.push({
      kind: "ReferenceIntoRemovableRange",
      from,
      address,
      to: to === notFound ? undefined : to,
      range: classifier.rangeAt(target)!,
    });
  }
}

function checkRelocations(relinked: ElfFile, input: RelocationInput): RelocationCheck {
  const path = input.withRelocations.executable;
  const machine = readAt(relinked.fd, machineOffset, 2).readUInt16LE(0);
  const rules = relocationRules.get(machine) ?? fail(`${path}: no relocation rules for machine ${machine}`);
  const context: RelocationContext = {
    graph: input.graph,
    symbols: readSymbols(relinked, path),
    rulesByType: indexRulesByType(rules),
    classifier: new ReferenceClassifier(input),
    reportedPairs: new Set(),
  };
  const check: RelocationCheck = { failures: [], relocations: 0, intoRanges: 0, ambiguous: 0, fieldsOutsideGraph: 0 };
  for (const section of relinked.sections) {
    if (isAllocated(section) || !relocationSectionTypes.includes(section.type)) continue;
    const relocated = relinked.sections[section.info];
    if (relocated === undefined || !isAllocated(relocated)) continue;
    if (section.type !== SectionType.Rela) fail(`${section.name} of ${path} is not in RELA format`);
    const isCode = (relocated.flags & SectionFlag.ExecInstr) !== 0;
    const bytes = readAt(relinked.fd, section.offset, section.size);
    checkSection({ name: section.name, isCode, bytes }, context, check);
  }
  if (check.relocations === 0) fail(`${path} has no relocations, so it was not linked with --emit-relocs`);
  return check;
}

function openExecutable(path: string): ElfFile {
  return openElf(path, "r") ?? fail(`${path} is not an ELF file`);
}

export function checkElfRelocations(input: RelocationInput): RelocationCheck {
  const shipped = openExecutable(input.shipped.executable);
  try {
    const relinked = openExecutable(input.withRelocations.executable);
    try {
      const failures = compareImages(shipped, relinked);
      if (failures.length > 0) return { failures, relocations: 0, intoRanges: 0, ambiguous: 0, fieldsOutsideGraph: 0 };
      return checkRelocations(relinked, input);
    } finally {
      closeSync(relinked.fd);
    }
  } finally {
    closeSync(shipped.fd);
  }
}

export function validateElfRelocations(input: RelocationInput): RelocationFailure[] {
  const { failures, relocations, intoRanges, ambiguous, fieldsOutsideGraph } = checkElfRelocations(input);
  console.log(
    `${relocations} relocations from the linker: ${intoRanges} into removable ranges, ` +
      `${ambiguous} ambiguous, ${fieldsOutsideGraph} in sections outside the graph`,
  );
  return failures;
}
