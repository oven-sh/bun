import { closeSync } from "node:fs";
import { BuildError } from "../error.ts";
import { openElf } from "./elf-file.ts";
import { featureNamed } from "./features.ts";
import type { SectionGraph } from "./graph.ts";
import { elfImage, machOImage, peImage, type LinkedImage } from "./linked-image.ts";
import {
  EdgeKind,
  type FeatureModel,
  type FeatureName,
  type ModuleTextRange,
  type ObjectFormat,
  type Partition,
  type RemovableRange,
} from "./types.ts";

export type { ModuleTextRange, RemovableRange } from "./types.ts";

// Protects the size of the trim table. The longest runs win.
export const maxCuttableRanges = 2048;
// Protects the size of the trim table. The largest ranges win.
export const maxFillOnlyRanges = 16384;

// These features refer to the section of the built-in modules, and none of them needs the text of a module in an
// executable that never runs a built-in module from its text. RuntimeTranspiler and Interpreter run a module from its
// text or record what ran. BuiltinSourceText reads the text of the built-in functions, which lies in front of the
// modules'. Bundler makes bytecode for an executable that is a copy of this one, so that has the texts this one has.
export const featuresNotKeepingModuleTexts: readonly FeatureName[] = [
  "RuntimeTranspiler",
  "Interpreter",
  "BuiltinSourceText",
  "Bundler",
];

export interface OutputPolicy {
  isMovable(output: string): boolean;
  canBeFilled(output: string): boolean;
  isCode(output: string): boolean;
}

// `ranges` is ascending and disjoint.
export interface RangeList {
  ranges: RemovableRange[];
  droppedRanges: number;
  droppedBytes: number;
}

export type RangeFailure =
  | { kind: "RetainedSectionInRemovableRange"; node: number; range: RemovableRange }
  | { kind: "TableEntryOutsideRemovableRanges"; node: number };

const byStart = (a: RemovableRange, b: RemovableRange) => a.start - b.start;
const rangeBytes = (range: RemovableRange) => range.end - range.start;
const runBytes = (run: RemovableRange[]) => run.at(-1)!.end - run[0]!.start;

function findCuttableRuns(graph: SectionGraph, partition: Partition, policy: OutputPolicy): RemovableRange[][] {
  const runs: RemovableRange[][] = [];
  let run: RemovableRange[] = [];
  const close = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };
  for (let node = 0; node < graph.placedCount; node++) {
    const output = graph.output[node]!;
    const set = partition.setOf[node]!;
    if (!policy.isMovable(output) || partition.isRetained[node] === 1 || set === 0) {
      close();
      continue;
    }
    const start = graph.address[node]!;
    const end = start + graph.size[node]!;
    const isNextToPrevious =
      node > 0 &&
      graph.output[node - 1] === output &&
      start - (graph.address[node - 1]! + graph.size[node - 1]!) < graph.alignment[node]!;
    if (!isNextToPrevious) close();
    if (start === end) continue;
    const last = run.at(-1);
    if (last?.set === set) last.end = end;
    else {
      if (last !== undefined) last.end = start;
      run.push({
        start,
        end,
        set,
        isCode: policy.isCode(output),
        canBeCut: true,
        canBeFilled: policy.canBeFilled(output),
      });
    }
  }
  close();
  return runs;
}

function limitCuttableRuns(runs: RemovableRange[][]): { listed: RemovableRange[]; dropped: RemovableRange[][] } {
  runs.sort((a, b) => runBytes(b) - runBytes(a) || a[0]!.start - b[0]!.start);
  const listed: RemovableRange[] = [];
  const dropped: RemovableRange[][] = [];
  for (const run of runs) {
    if (listed.length + run.length <= maxCuttableRanges) listed.push(...run);
    else dropped.push(run);
  }
  return { listed: listed.sort(byStart), dropped };
}

export function cuttableRanges(graph: SectionGraph, partition: Partition, policy: OutputPolicy): RangeList {
  const { listed, dropped } = limitCuttableRuns(findCuttableRuns(graph, partition, policy));
  return {
    ranges: listed,
    droppedRanges: dropped.reduce((sum, run) => sum + run.length, 0),
    droppedBytes: dropped.reduce((sum, run) => sum + runBytes(run), 0),
  };
}

export function fillOnlyRanges(
  graph: SectionGraph,
  partition: Partition,
  cuttable: RemovableRange[],
  policy: OutputPolicy,
): RangeList {
  const ranges: RemovableRange[] = [];
  let lastOutput: string | undefined;
  let at = 0;
  for (let node = 0; node < graph.placedCount; node++) {
    const output = graph.output[node]!;
    const set = partition.setOf[node]!;
    const size = graph.size[node]!;
    if (partition.isRetained[node] === 1 || set === 0 || size === 0 || !policy.canBeFilled(output)) continue;
    const start = graph.address[node]!;
    const end = start + size;
    while (at < cuttable.length && cuttable[at]!.end <= start) at++;
    if (at < cuttable.length && cuttable[at]!.start < end) continue;
    const last = ranges.at(-1);
    if (last !== undefined && start < last.end) continue;
    if (last !== undefined && last.end === start && last.set === set && lastOutput === output) last.end = end;
    else ranges.push({ start, end, set, isCode: policy.isCode(output), canBeCut: false, canBeFilled: true });
    lastOutput = output;
  }
  return limitFillOnlyRanges(ranges);
}

function limitFillOnlyRanges(ranges: RemovableRange[]): RangeList {
  if (ranges.length <= maxFillOnlyRanges) return { ranges, droppedRanges: 0, droppedBytes: 0 };
  const largestFirst = [...ranges].sort((a, b) => rangeBytes(b) - rangeBytes(a) || a.start - b.start);
  const dropped = largestFirst.slice(maxFillOnlyRanges);
  return {
    ranges: largestFirst.slice(0, maxFillOnlyRanges).sort(byStart),
    droppedRanges: dropped.length,
    droppedBytes: dropped.reduce((sum, range) => sum + rangeBytes(range), 0),
  };
}

export function removableRanges(graph: SectionGraph, partition: Partition, policy: OutputPolicy): RangeList {
  const { listed: cuttable, dropped } = limitCuttableRuns(findCuttableRuns(graph, partition, policy));
  const fillOnly = fillOnlyRanges(graph, partition, cuttable, policy);
  const unfillable = dropped.flat().filter(range => !range.canBeFilled);
  return {
    ranges: [...cuttable, ...fillOnly.ranges].sort(byStart),
    droppedRanges: fillOnly.droppedRanges + unfillable.length,
    droppedBytes: fillOnly.droppedBytes + unfillable.reduce((sum, range) => sum + rangeBytes(range), 0),
  };
}

function findTableEntries(graph: SectionGraph, partition: Partition): Uint8Array {
  const isTableEntry = new Uint8Array(graph.count);
  for (let edge = 0; edge < graph.successors.length; edge++) {
    if (partition.edgeKind[edge] === EdgeKind.Soft) isTableEntry[graph.successors[edge]!] = 1;
  }
  return isTableEntry;
}

// The run time asks removed_feature_at whether an entry of a table in data is still there, and that answers from the
// listed ranges. An entry outside all of them stays callable after what it calls is removed.
export function checkRanges(graph: SectionGraph, partition: Partition, ranges: RemovableRange[]): RangeFailure[] {
  const failures: RangeFailure[] = [];
  const isTableEntry = findTableEntries(graph, partition);
  let at = 0;
  for (let node = 0; node < graph.placedCount; node++) {
    const start = graph.address[node]!;
    const end = start + graph.size[node]!;
    if (start === end) continue;
    while (at < ranges.length && ranges[at]!.end <= start) at++;
    const isRemovable = partition.isRetained[node] !== 1 && partition.setOf[node] !== 0;
    const isListed = at < ranges.length && ranges[at]!.start <= start;
    if (isTableEntry[node] === 1 && isRemovable && !isListed) {
      failures.push({ kind: "TableEntryOutsideRemovableRanges", node });
    }
    for (let index = at; index < ranges.length && ranges[index]!.start < end; index++) {
      const range = ranges[index]!;
      if (partition.isRetained[node] === 1 || partition.setOf[node] !== range.set) {
        failures.push({ kind: "RetainedSectionInRemovableRange", node, range });
      }
    }
  }
  return failures;
}

export function linkedImageOf(format: ObjectFormat, executable: string): LinkedImage {
  if (format === "macho") return machOImage(executable);
  if (format === "coff") return peImage(executable);
  const elf = openElf(executable, "r");
  if (elf === undefined) throw new BuildError("the linked executable is not an ELF file", { file: executable });
  const image = elfImage(executable, elf);
  closeSync(elf.fd);
  return image;
}

export interface BuiltinModuleText {
  module: number;
  start: number;
  end: number;
}

// The index that src/codegen/bundle-modules.ts writes and src/exe_format/builtins.rs reads.
const builtinModulesMagic = "BUNBLTNS";
const builtinModulesVersion = 2;
const builtinModulesHeaderBytes = 48;
const versionOffset = 8;
const moduleCountOffset = 16;
const moduleRecordsOffset = 20;
const dataOffsetOffset = 32;
const dataLengthOffset = 36;
const moduleRecordBytes = 24;
const textOffsetInRecord = 16;
const textLengthInRecord = 20;

// Ascending and disjoint. Each text has the NUL that ends it.
export function readBuiltinModuleTexts(
  graph: SectionGraph,
  output: string,
  openImage: () => LinkedImage,
): BuiltinModuleText[] {
  const node = graph.output.indexOf(output);
  if (node < 0 || node >= graph.placedCount) return [];
  const malformed = (rule: string) =>
    new BuildError(`the index of the built-in modules in ${output} is malformed: ${rule}`);
  const image = openImage();
  const sectionStart = graph.address[node]!;
  const header = image.bytes(sectionStart, builtinModulesHeaderBytes);
  if (header?.toString("latin1", 0, builtinModulesMagic.length) !== builtinModulesMagic) return [];
  const version = header.readUInt32LE(versionOffset);
  if (version !== builtinModulesVersion) throw malformed(`the version is ${version}, not ${builtinModulesVersion}`);
  const count = header.readUInt32LE(moduleCountOffset);
  const records = image.bytes(sectionStart + header.readUInt32LE(moduleRecordsOffset), count * moduleRecordBytes);
  if (records === undefined) throw malformed(`the linked executable does not hold its ${count} records`);
  const dataStart = sectionStart + header.readUInt32LE(dataOffsetOffset);
  const dataLength = header.readUInt32LE(dataLengthOffset);
  const texts = Array.from({ length: count }, (_, module): BuiltinModuleText => {
    const offset = records.readUInt32LE(module * moduleRecordBytes + textOffsetInRecord);
    const length = records.readUInt32LE(module * moduleRecordBytes + textLengthInRecord);
    if (length === 0) throw malformed(`module ${module} has no text`);
    if (offset + length >= dataLength) throw malformed(`the text of module ${module} ends past the data`);
    return { module, start: dataStart + offset, end: dataStart + offset + length + 1 };
  }).sort((a, b) => a.start - b.start);
  texts.forEach(({ module, start }, index) => {
    if (index > 0 && start < texts[index - 1]!.end) throw malformed(`the text of module ${module} overlaps another`);
  });
  return texts;
}

export interface ModuleTextInput {
  graph: SectionGraph;
  partition: Partition;
  model: FeatureModel;
  // Ascending and disjoint.
  ranges: RemovableRange[];
  output: string;
  openImage(): LinkedImage;
}

export function moduleTextRanges(input: ModuleTextInput): ModuleTextRange[] {
  const { graph, partition, model, ranges, output, openImage } = input;
  const texts = readBuiltinModuleTexts(graph, output, openImage);
  if (texts.length === 0) return [];
  const notKeeping = new Set(featuresNotKeepingModuleTexts.map(name => featureNamed(model, name).index));
  const listed: ModuleTextRange[] = [];
  let at = 0;
  for (const text of texts) {
    while (at < ranges.length && ranges[at]!.end <= text.start) at++;
    const range = ranges[at];
    if (range === undefined || text.start < range.start || range.end < text.end) continue;
    const features = partition.sets[range.set]!;
    const readers = features.filter(feature => !notKeeping.has(feature));
    if (readers.length === features.length) continue;
    listed.push({ ...text, set: range.set, readers, canBeCut: range.canBeCut, canBeFilled: range.canBeFilled });
  }
  return listed;
}
