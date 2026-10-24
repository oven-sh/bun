import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { isBitcode } from "./binary-reader.ts";
import { checkBuiltinUses, readBuiltinUses } from "./builtin-uses.ts";
import { checkDeclaredUses, findUsedFeaturesWithoutGuard } from "./declared-uses.ts";
import {
  findCFunctionEntryPoints,
  findCxxFunctionEntryPoints,
  findStaticTableEntryPoints,
  mergeEntryPoints,
  readEntryPoints,
  type EntryPointReading,
} from "./entry-points.ts";
import { readFeatureModel } from "./features.ts";
import type { GraphReading, SectionGraph } from "./graph.ts";
import { icuPackagesOf, type IcuPackageRuns } from "./icu-data.ts";
import { coff } from "./linker-coff.ts";
import { groupOfNode } from "./linker-common.ts";
import { elf } from "./linker-elf.ts";
import { machO } from "./linker-macho.ts";
import type { Link, Linker, LinkerFormat, LinkName, LinkRequest, SectionOrder } from "./linker.ts";
import { partition } from "./partition.ts";
import {
  checkRanges,
  fillOnlyRanges,
  linkedImageOf,
  moduleTextRanges,
  readBuiltinModuleTexts,
  removableRanges,
  type OutputPolicy,
} from "./ranges.ts";
import {
  Demangler,
  describeFailures,
  megabytes,
  writeReviewFiles,
  writeSectionsFile,
  type LinkFailure,
  type ReportContext,
} from "./report.ts";
import { assembleTable, encodeTable, recordBytes, removedRangeListBytes, roomFor } from "./table.ts";
import type {
  BuiltinUses,
  EdgeStrength,
  FeatureEdge,
  FeatureModel,
  IcuLanguage,
  ModuleTextRange,
  ObjectFormat,
  Partition,
  RemovableRange,
} from "./types.ts";

export interface Arguments {
  work: string;
  featuresPath: string;
  builtinUsesPath: string;
  demangler: string | undefined;
  command: string[];
}

// Protects the build from a table whose size never settles.
export const maxSecondLinks = 3;
// BUILTINS_HEADER_SIZE in src/codegen/bundle-modules.ts, HEADER_SIZE in src/exe_format/builtins.rs.
export const builtinModulesHeaderBytes = 48;

const usage =
  "usage: link.ts <work directory> <features.json> <builtin-uses.json> " +
  "[--demangler=<llvm-cxxfilt>] -- <link command>";
const demanglerOption = "--demangler=";
const responseFileArgument = /^((?:\/clang:)?-Wl,)?@(.*)$/;
const rangeCountMargin = 1.25;
const maxListedOutputs = 8;
const maxListedRemarks = 20;
const linkerFormats = { elf, macho: machO, coff } satisfies Record<ObjectFormat, (linker: Linker) => LinkerFormat>;

export class Stopwatch {
  private readonly startedAt = performance.now();
  private lapStartedAt = this.startedAt;
  private readonly laps: string[] = [];

  lap(name: string): void {
    const now = performance.now();
    this.laps.push(`${name} ${((now - this.lapStartedAt) / 1000).toFixed(1)} s`);
    this.lapStartedAt = now;
  }

  describe(): string {
    return `${((performance.now() - this.startedAt) / 1000).toFixed(1)} s: ${this.laps.join(", ")}`;
  }
}

function fail(message: string): never {
  console.error(`trim: ${message}`);
  process.exit(1);
}

export function parseArguments(argv: string[]): Arguments {
  const separator = argv.indexOf("--");
  if (separator < 0) throw new BuildError(usage);
  const positional: string[] = [];
  let demangler: string | undefined;
  for (const word of argv.slice(2, separator)) {
    if (!word.startsWith("--")) positional.push(word);
    else if (word.startsWith(demanglerOption) && word.length > demanglerOption.length) {
      demangler = word.slice(demanglerOption.length);
    } else throw new BuildError(`unknown option ${word}\n${usage}`);
  }
  const command = argv.slice(separator + 1);
  if (positional.length !== 3 || command.length === 0) throw new BuildError(usage);
  const [work, featuresPath, builtinUsesPath] = positional as [string, string, string];
  return { work, featuresPath, builtinUsesPath, demangler, command };
}

interface ResponseFileLine {
  text: string;
  input: string | undefined;
}

interface ResponseFile {
  prefix: string;
  lines: ResponseFileLine[];
}

function readResponseFile(path: string): ResponseFileLine[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new BuildError("cannot read a response file of the link command", { file: path, cause });
  }
  return text
    .split(/\r?\n/)
    .filter(line => line !== "")
    .map(line => {
      const word = line.replace(/^"(.*)"$/, "$1");
      return { text: line, input: word.startsWith("-") || /^\/(start|end)-lib$/.test(word) ? undefined : word };
    });
}

function readResponseFiles(command: readonly string[]): Map<number, ResponseFile> {
  const files = new Map<number, ResponseFile>();
  command.forEach((argument, index) => {
    const file = index === 0 ? null : responseFileArgument.exec(argument);
    if (file !== null) files.set(index, { prefix: file[1] ?? "", lines: readResponseFile(file[2]!) });
  });
  return files;
}

function rewriteResponseFile(file: ResponseFile, request: LinkRequest): string {
  const lines = file.lines.flatMap(({ text, input }) => {
    if (input === undefined) return [text];
    const path = request.rewrite(input);
    return path === undefined ? [] : [`"${path}"`];
  });
  return lines.join("\n") + "\n";
}

function collectTargetFlags(command: readonly string[]): string[] {
  return command.flatMap((argument, index) =>
    /^(--target=|-mmacosx-version-min=)/.test(argument)
      ? [argument]
      : argument === "-isysroot"
        ? [argument, command[index + 1]!]
        : /^\/machine:/i.test(argument)
          ? ["--driver-mode=gcc", `--target=${/arm64/i.test(argument) ? "aarch64" : "x86_64"}-pc-windows-msvc`]
          : [],
  );
}

export function createLinker(arguments_: Arguments): { linker: Linker; format: ObjectFormat } {
  const { work, command } = arguments_;
  const isMachO = command.some(argument => argument.startsWith("-Wl,-map,"));
  const isCoff = command.includes("/link");
  const mapFlag = isCoff ? "/lldmap:" : isMachO ? "-Wl,-map," : "-Wl,-Map=";
  const outputFlag = isCoff ? "/Fe" : "";
  const outputAt = isCoff ? command.findIndex(argument => argument.startsWith(outputFlag)) : command.indexOf("-o") + 1;
  const mapAt = command.findIndex(argument => argument.startsWith(mapFlag));
  const output = outputAt > 0 ? command[outputAt]?.slice(outputFlag.length) : undefined;
  const finalMap = command[mapAt]?.slice(mapFlag.length);
  if (!output || !finalMap) throw new BuildError("the link command has no output or no linker map");
  const compiler = command[0]!;
  const targetFlags = collectTargetFlags(command);
  const responseFiles = readResponseFiles(command);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const firstLinkName = "first-" + createHash("sha256").update(resolve(work)).digest("hex").slice(0, 8);
  const paths: Record<LinkName, { executable: string; map: string }> = {
    first: { executable: join(work, firstLinkName + (isCoff ? ".exe" : "")), map: join(work, "first.map") },
    second: { executable: output, map: finalMap },
  };
  const linker: Linker = {
    work,
    firstLinkName,
    output,
    command,
    inputs: [...responseFiles.values()].flatMap(file => file.lines.flatMap(line => line.input ?? [])),
    assemble(name, text) {
      const source = join(work, name);
      writeFileSync(source, text);
      const assembled = spawnSync(compiler, [...targetFlags, "-c", source, "-o", source + ".o"], { stdio: "inherit" });
      if (assembled.status !== 0) throw new BuildError(`${name} does not assemble`);
      return source + ".o";
    },
    link(request) {
      const { executable, map } = paths[request.name];
      const rewritten = command.flatMap((argument, index) => {
        if (index === 0) return [];
        if (index === outputAt) return [outputFlag + executable];
        if (index === mapAt) return [mapFlag + map];
        const replaced = request.replaced.get(index);
        if (replaced !== undefined) return [replaced];
        if (request.without?.test(argument)) return [];
        const file = responseFiles.get(index);
        if (file === undefined) return [argument];
        const copy = join(work, `${request.name}.${index}.rsp`);
        writeFileSync(copy, rewriteResponseFile(file, request));
        return [`${file.prefix}@${copy}`];
      });
      const linked = spawnSync(compiler, [...request.first, ...rewritten, ...request.last], {
        encoding: "latin1",
        maxBuffer: 1 << 30,
      });
      if (linked.error !== undefined) {
        throw new BuildError(`the ${request.name} link could not run ${compiler}`, { cause: linked.error });
      }
      const log = linked.stdout + linked.stderr;
      writeFileSync(join(work, `${request.name}.log`), log, "latin1");
      if (linked.status !== 0) throw new BuildError(`the ${request.name} link failed:\n${log.slice(-4000)}`);
      return { name: request.name, executable, map, log };
    },
  };
  return { linker, format: isCoff ? "coff" : isMachO ? "macho" : "elf" };
}

export interface LinkSession {
  linker: Linker;
  format: LinkerFormat;
  model: FeatureModel;
  uses: BuiltinUses;
  demangler: string | undefined;
  reviewDirectory: string;
  stopwatch: Stopwatch;
}

export interface Analysis {
  reading: GraphReading;
  entries: EntryPointReading;
  partition: Partition;
  context: ReportContext;
}

function ensureNoFailures(failures: readonly LinkFailure[], context: ReportContext): void {
  if (failures.length > 0) throw new BuildError(describeFailures(failures, context));
}

function analyze(link: Link, session: LinkSession): Analysis {
  const { format, model, uses, demangler, stopwatch } = session;
  const reading = format.read(link);
  stopwatch.lap(`graph of the ${link.name} link`);
  const unpartitioned: ReportContext = { graph: reading.graph, model, uses, demangler, partition: undefined };
  ensureNoFailures(reading.failures, unpartitioned);
  const recorded = readEntryPoints(reading, model, uses.namedByEngine);
  ensureNoFailures(recorded.failures, unpartitioned);
  const symbolNames = new Demangler(demangler);
  const listedInTables = findStaticTableEntryPoints({
    reading,
    model,
    uses,
    isCode: output => format.isCode(output),
    demangle: names => symbolNames.demangle(names),
  });
  const cFunctions = findCFunctionEntryPoints(reading, model);
  if (cFunctions.missing.length > 0)
    console.log(`trim: these c-function names are not in the ${link.name} link: ${cFunctions.missing.join(" ")}`);
  const cxxFunctions = findCxxFunctionEntryPoints({
    reading,
    model,
    isCode: output => format.isCode(output),
    demangle: names => symbolNames.demangle(names),
  });
  if (cxxFunctions.unmatched.length > 0)
    console.log(
      `trim: these cxx-function patterns match nothing in the ${link.name} link: ${cxxFunctions.unmatched.join(" ")}`,
    );
  const entries = {
    ...recorded,
    entryPoints: mergeEntryPoints(
      recorded.entryPoints,
      listedInTables,
      cFunctions.entryPoints,
      cxxFunctions.entryPoints,
    ),
  };
  stopwatch.lap("entry points");
  const result = partition({
    graph: reading.graph,
    entryPoints: entries.entryPoints,
    model,
    isMovable: output => format.isMovable(output),
    isCode: output => format.isCode(output),
  });
  stopwatch.lap("partition");
  const context: ReportContext = { ...unpartitioned, partition: result, entryPoints: entries.entryPoints };
  ensureNoFailures(result.failures, context);
  const declaredUseFailures = checkDeclaredUses({
    graph: reading.graph,
    model,
    uses,
    entryPoints: entries.entryPoints,
    partition: result,
  });
  stopwatch.lap("declared uses");
  ensureNoFailures(declaredUseFailures, context);
  return { reading, entries, partition: result, context };
}

type IcuData = ReturnType<typeof icuPackagesOf>;

function findIcuPackages(link: Link, analysis: Analysis, { format, model }: LinkSession): IcuData {
  return icuPackagesOf(format.namedBytes(link), analysis.reading.graph, model);
}

function encodeTrimTable(
  analysis: Analysis,
  ranges: RemovableRange[],
  { packages, languages }: IcuData,
  moduleTexts: ModuleTextRange[],
  { model }: LinkSession,
): Buffer {
  return encodeTable(
    assembleTable({
      featuresHash: model.hash,
      partition: analysis.partition,
      ranges,
      icuPackages: packages,
      icuLanguages: languages,
      moduleTexts,
    }),
  );
}

function estimateRoom(first: Link, analysis: Analysis, order: SectionOrder, session: LinkSession): number {
  const { graph } = analysis.reading;
  const { partition } = analysis;
  const ordered = order.nodes.filter(node => node < graph.placedCount).sort((a, b) => a - b);
  const orderedRanges = ordered.map(node => ({
    start: graph.address[node]!,
    end: graph.address[node]! + graph.size[node]!,
    set: partition.setOf[node]!,
    isCode: session.format.isCode(graph.output[node]!),
    canBeCut: true,
    canBeFilled: session.format.canBeFilled(graph.output[node]!),
  }));
  const unordered = fillOnlyRanges(graph, partition, orderedRanges, session.format).ranges;
  const orderedRuns = new Set(ordered.map(node => `${partition.setOf[node]} ${graph.output[node]}`));
  const sets = new Set([...partition.groups, ...unordered].map(({ set }) => set));
  const openImage = () => linkedImageOf(graph.format, first.executable);
  const moduleTextCount = readBuiltinModuleTexts(graph, session.format.builtinModulesOutput, openImage).length;
  const rangeCount = rangeCountMargin * (orderedRuns.size + unordered.length) + 2 * moduleTextCount;
  let bytes = encodeTrimTable(analysis, [], findIcuPackages(first, analysis, session), [], session).length;
  bytes += Math.ceil(recordBytes("ranges") * rangeCount) + recordBytes("moduleTexts") * moduleTextCount;
  for (const set of sets) bytes += recordBytes("featureSets") + recordBytes("setMembers") * partition.sets[set]!.length;
  return roomFor(Math.max(bytes, removedRangeListBytes(Math.ceil(rangeCount))));
}

export function withoutBuiltinModulesHeader(
  ranges: RemovableRange[],
  graph: SectionGraph,
  output: string,
): RemovableRange[] {
  const node = graph.output.indexOf(output);
  if (node < 0 || node >= graph.placedCount) return ranges;
  const start = graph.address[node]!;
  const end = start + builtinModulesHeaderBytes;
  return ranges.flatMap(range => {
    if (range.end <= start || end <= range.start) return [range];
    return [
      { ...range, end: start },
      { ...range, start: end },
    ].filter(part => part.start < part.end);
  });
}

interface SecondLinkPlan {
  firstExecutable: string;
  room: number;
  request(room: number): LinkRequest;
}

function planSecondLink(session: LinkSession): SecondLinkPlan {
  const { linker, format, stopwatch } = session;
  const bitcodeInputs = new Set(linker.inputs.filter(isBitcode));
  const preparedInput = (path: string) => (format.firstInputs.includes(path) ? undefined : format.prepareInput(path));
  const preparedNativeInput = (path: string) => (bitcodeInputs.has(path) ? undefined : preparedInput(path));
  const firstRequest: LinkRequest = {
    name: "first",
    rewrite: preparedInput,
    first: [...format.supportObjects(0), ...format.firstInputs],
    ...format.firstLinkArguments(),
  };
  let first = linker.link(firstRequest);
  stopwatch.lap("first link");
  const native = format.compiledObjects("first");
  if (format.prepareCompiledObjects(native)) {
    first = linker.link({ ...firstRequest, rewrite: preparedNativeInput, first: [...firstRequest.first, ...native] });
    stopwatch.lap("first link of the compiled objects");
  }
  const analysis = analyze(first, session);
  const order = format.orderOf(analysis.reading.graph, analysis.partition);
  const copies = format.nameUnnamedSections(order, native);
  const room = estimateRoom(first, analysis, order, session);
  stopwatch.lap("section order and table room");

  const reused = format.relinksSameInputs ? undefined : native;
  const namedNativeInput = (path: string) => {
    const prepared = preparedNativeInput(path);
    return prepared === undefined ? undefined : (copies.get(prepared) ?? prepared);
  };
  return {
    firstExecutable: first.executable,
    room,
    request: tableRoom => ({
      name: "second",
      rewrite: reused === undefined ? preparedInput : namedNativeInput,
      first: [...format.supportObjects(tableRoom), ...format.firstInputs, ...(reused ?? [])],
      ...format.secondLinkArguments(order),
    }),
  };
}

export interface Layout {
  link: Link;
  request: LinkRequest;
  analysis: Analysis;
  ranges: RemovableRange[];
  droppedRanges: number;
  droppedBytes: number;
  icuPackages: IcuPackageRuns[];
  icuLanguages: IcuLanguage[];
  moduleTexts: ModuleTextRange[];
  table: Buffer;
  room: number;
  secondLinks: number;
}

function linkUntilTableFits(plan: SecondLinkPlan, session: LinkSession): Layout {
  const { linker, format, stopwatch } = session;
  let room = plan.room;
  for (let secondLinks = 1; secondLinks <= maxSecondLinks; secondLinks++) {
    const request = plan.request(room);
    const link = linker.link(request);
    stopwatch.lap("second link");
    const analysis = analyze(link, session);
    const { graph } = analysis.reading;
    const { ranges: listed, droppedRanges, droppedBytes } = removableRanges(graph, analysis.partition, format);
    const ranges = withoutBuiltinModulesHeader(listed, graph, format.builtinModulesOutput);
    ensureNoFailures(checkRanges(graph, analysis.partition, ranges), analysis.context);
    const icuData = findIcuPackages(link, analysis, session);
    const moduleTexts = moduleTextRanges({
      graph,
      partition: analysis.partition,
      model: session.model,
      ranges,
      output: format.builtinModulesOutput,
      openImage: () => linkedImageOf(graph.format, link.executable),
    });
    const table = encodeTrimTable(analysis, ranges, icuData, moduleTexts, session);
    stopwatch.lap("ranges and table");
    // A module text splits at most one range in two.
    const neededRoom = Math.max(table.length, removedRangeListBytes(ranges.length + 2 * moduleTexts.length));
    if (neededRoom <= room) {
      return {
        link,
        request,
        analysis,
        ranges,
        droppedRanges,
        droppedBytes,
        icuPackages: icuData.packages,
        icuLanguages: icuData.languages,
        moduleTexts,
        table,
        room,
        secondLinks,
      };
    }
    console.log(`the trim table needs ${neededRoom} bytes and ${room} are reserved`);
    room = roomFor(neededRoom);
  }
  throw new BuildError(`the trim table did not fit the bytes reserved for it in ${maxSecondLinks} links`);
}

export function layOut(session: LinkSession): Layout {
  const { linker, format, stopwatch } = session;
  const plan = planSecondLink(session);
  const layout = linkUntilTableFits(plan, session);
  const { analysis } = layout;
  format.writeTable(layout.table);
  writeReviewFiles(session.reviewDirectory, analysis.context, analysis.entries.entryPoints);
  writeSectionsFile(join(linker.work, "sections.txt"), analysis.context);
  format.tidyUp();
  rmSync(plan.firstExecutable, { force: true });
  for (const folder of ["split", "named"]) rmSync(join(linker.work, folder), { recursive: true, force: true });
  stopwatch.lap("review files");
  return layout;
}

function uncuttableGroupBytes({ analysis, ranges }: Layout, policy: OutputPolicy): number {
  const { graph } = analysis.reading;
  const isMovable = (output: string) => policy.isMovable(output);
  const cuttable = ranges.filter(range => range.canBeCut);
  let bytes = 0;
  let at = 0;
  for (let node = 0; node < graph.placedCount; node++) {
    if (groupOfNode(graph, analysis.partition, isMovable, node) < 0) continue;
    const address = graph.address[node]!;
    while (at < cuttable.length && cuttable[at]!.end <= address) at++;
    if (at === cuttable.length || address < cuttable[at]!.start) bytes += graph.size[node]!;
  }
  return bytes;
}

function unmovableOutputBytes({ analysis }: Layout, policy: OutputPolicy): [output: string, bytes: number][] {
  const { graph } = analysis.reading;
  const bytesOf = new Map<string, number>();
  for (let node = 0; node < graph.placedCount; node++) {
    const output = graph.output[node]!;
    if (analysis.partition.setOf[node] === 0 || policy.isMovable(output)) continue;
    bytesOf.set(output, (bytesOf.get(output) ?? 0) + graph.size[node]!);
  }
  return [...bytesOf].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function describeFeatureEdges(edges: readonly FeatureEdge[]): string {
  const count: Record<EdgeStrength, number> = { Reference: 0, AbortingGuard: 0, RecoverableGuard: 0 };
  for (const { strength } of edges) count[strength]++;
  const unfollowed = edges.filter(edge => !edge.isFollowed).length;
  return (
    `${edges.length} edges between features: ${count.Reference} references, ` +
    `${count.AbortingGuard} aborting guards, ${count.RecoverableGuard} recoverable guards; ` +
    `${unfollowed} are answered by the built-ins table or a start-up option`
  );
}

function describeIcuPackage(
  { start, end, items, runs }: IcuPackageRuns,
  languages: readonly IcuLanguage[],
  featureName: (index: number) => string,
): string {
  const bytesByFeatures = new Map<string, number>();
  for (const { features, bytes } of runs) {
    const names = features.map(featureName).join(",");
    bytesByFeatures.set(names, (bytesByFeatures.get(names) ?? 0) + bytes);
  }
  const groups = new Set(languages.map(({ group }) => group)).size;
  return (
    `ICU data: ${items} items, ${megabytes(end - start)}, removable in ${runs.length} runs, ` +
    `${languages.length} languages in ${groups} groups: ` +
    [...bytesByFeatures].map(([names, bytes]) => `${names} ${megabytes(bytes)}`).join(", ")
  );
}

function describeModuleTexts(moduleTexts: readonly ModuleTextRange[], featureName: (index: number) => string): string {
  const bytes = moduleTexts.reduce((sum, { start, end }) => sum + end - start, 0);
  const readers = [...new Set(moduleTexts.flatMap(text => text.readers))].sort((a, b) => a - b).map(featureName);
  return (
    `built-in modules: ${moduleTexts.length} texts, ${megabytes(bytes)}, removable from an executable that runs no ` +
    `built-in module from its text` +
    (readers.length > 0 ? `, together with ${readers.join(", ")}` : "")
  );
}

export function printSummary(layout: Layout, { model, uses, format, stopwatch }: LinkSession): void {
  const { reading, entries, partition } = layout.analysis;
  const { records, deadGuards, guardsInsideEntryPoint, definitions, guardsOfEmptyEntryPoints } = entries.statistics;
  const cuttableCount = layout.ranges.filter(range => range.canBeCut).length;
  const groupBytes = partition.groups.reduce((sum, group) => sum + group.bytes, 0);
  console.log(
    `${entries.entryPoints.length} entry points in ${records} records: ${deadGuards} dead guards, ` +
      `${guardsInsideEntryPoint} guards inside their entry point, ${guardsOfEmptyEntryPoints} of entry points that do nothing, ` +
      `${definitions} written by the entry point itself, ` +
      `${partition.foldedEntryPoints.length} entry points folded with other code`,
  );
  console.log(describeFeatureEdges(partition.edges));
  console.log(
    `${partition.groups.length} groups, ${cuttableCount} ranges that can be cut, ` +
      `${layout.ranges.length - cuttableCount} that can only be filled: ${megabytes(groupBytes)} in all groups`,
  );
  if (layout.droppedRanges > 0) {
    const dropped = `${layout.droppedRanges} ranges, ${megabytes(layout.droppedBytes)}`;
    console.log(`${dropped}, exceed the limits of the table and are never removed`);
  }
  console.log(`${megabytes(uncuttableGroupBytes(layout, format))} of the groups are outside every cuttable range`);
  console.log(`the trim table takes ${layout.table.length} of ${layout.room} bytes`);
  const featureByIndex = new Map(model.features.map(feature => [feature.index, feature]));
  const featureName = (index: number) => featureByIndex.get(index)?.name ?? String(index);
  const withoutGuard = findUsedFeaturesWithoutGuard({ model, uses, entryPoints: entries.entryPoints });
  if (withoutGuard.length > 0) {
    console.log(
      `${withoutGuard.length} features that built-ins use have no guard, so nothing is removed with them: ` +
        withoutGuard.map(featureName).join(", "),
    );
  }
  for (const icuPackage of layout.icuPackages) {
    console.log(describeIcuPackage(icuPackage, layout.icuLanguages, featureName));
  }
  if (layout.moduleTexts.length > 0) console.log(describeModuleTexts(layout.moduleTexts, featureName));
  for (const index of partition.featuresNearMinimum) {
    const minimum = featureByIndex.get(index)?.minimumBytes[reading.graph.format] ?? 0;
    console.log(
      `${megabytes(partition.removableBytes.get(index) ?? 0)} can be removed with ${featureName(index)}, ` +
        `less than twice the minimum of ${megabytes(minimum)}`,
    );
  }
  console.log(`${megabytes(partition.unexplainedBytes)} are in the image without a known reference and are retained`);
  const statistics = Object.entries(reading.statistics).map(([name, count]) => `${name} ${count}`);
  if (statistics.length > 0) console.log(`graph: ${statistics.join(", ")}`);
  for (const remark of (reading.remarks ?? []).slice(0, maxListedRemarks)) console.log(`graph: ${remark}`);
  console.log(
    "needed only by features, in output sections that cannot be reordered: " +
      unmovableOutputBytes(layout, format)
        .slice(0, maxListedOutputs)
        .map(([output, bytes]) => `${output} ${megabytes(bytes)}`)
        .join(", "),
  );
  console.log(`the trimmable link took ${stopwatch.describe()}`);
}

function main(): void {
  try {
    const stopwatch = new Stopwatch();
    const arguments_ = parseArguments(process.argv);
    const { demangler } = arguments_;
    const model = readFeatureModel(arguments_.featuresPath);
    const uses = readBuiltinUses(arguments_.builtinUsesPath);
    checkBuiltinUses(uses, model, arguments_.builtinUsesPath);
    const { linker, format: objectFormat } = createLinker(arguments_);
    const reviewDirectory = linker.output + ".trim";
    rmSync(reviewDirectory, { recursive: true, force: true });
    mkdirSync(reviewDirectory, { recursive: true });
    const format = linkerFormats[objectFormat](linker);
    const session: LinkSession = {
      linker,
      format,
      model,
      uses,
      demangler,
      reviewDirectory,
      stopwatch,
    };
    printSummary(layOut(session), session);
  } catch (error) {
    if (error instanceof BuildError)
      fail(
        error
          .format()
          .replace(/^error: /, "")
          .trimEnd(),
      );
    throw error;
  }
}

if (import.meta.main) main();
