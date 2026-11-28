import { closeSync } from "node:fs";
import { BuildError } from "../error.ts";
import { fail, readAt, stringAt } from "./binary-reader.ts";
import { openElf } from "./elf-file.ts";
import { featureNamed, type FeatureModel } from "./features.ts";
import { nodeAt, type ObjectFormat, type SectionGraph } from "./graph.ts";
import { groupLanguages, languageOfIcuItem } from "./icu-locales.ts";
import { elfImage, type LinkedImage } from "./linked-image.ts";
import type { IcuLanguage } from "./types.ts";

export const icuItemClasses = [
  "break-iteration",
  "sentence-break",
  "collation",
  "collation-root",
  "currency",
  "language-names",
  "region-names",
  "number-spellout",
  "unit",
  "zone",
  "locale",
  "day-periods",
  "plural-rules",
] as const;

export type IcuItemClass = (typeof icuItemClasses)[number];

function classOfTopLevelItem(file: string): IcuItemClass | undefined {
  switch (file) {
    case "units.res":
    case "coldUnits.res":
    case "grammaticalFeatures.res":
      return "unit";
    case "dayPeriods.res":
      return "day-periods";
    case "plurals.res":
    case "pluralRanges.res":
      return "plural-rules";
    case "en.res":
    case "en_US.res":
    case "res_index.res":
      return undefined;
  }
  return languageOfIcuItem(file) === undefined ? undefined : "locale";
}

export function classOfIcuItem(name: string): IcuItemClass | undefined {
  const slash = name.indexOf("/");
  const tree = slash < 0 ? "" : name.slice(0, slash);
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot < 0 ? file : file.slice(0, dot);
  const extension = dot < 0 ? "" : file.slice(dot + 1);
  switch (tree) {
    case "":
      return classOfTopLevelItem(file);
    case "brkitr":
      return extension === "res" || (extension === "brk" && stem.startsWith("sent"))
        ? "sentence-break"
        : "break-iteration";
    case "coll":
      return ["ucadata.icu", "res_index.res", "root.res", "en.res", "en_US.res"].includes(file)
        ? "collation-root"
        : "collation";
    case "curr":
      return "currency";
    case "lang":
      return "language-names";
    case "region":
      return "region-names";
    case "rbnf":
      return "number-spellout";
    case "unit":
      return "unit";
    case "zone":
      return ["root.res", "en.res"].includes(file) ? undefined : "zone";
    default:
      return undefined;
  }
}

export interface IcuItem {
  /** The files of ICU's data that it holds. */
  names: string[];
  size: number;
}

// src/icu/format/package.rs
const [keysItem, localesItem, filesItem] = [0, 1, 2];
const treeOfColumn = ["", "", "zone/", "curr/", "unit/", "lang/", "region/"];

/** The model of a language has the names of its main bundles. `--trim` keeps its bytes while another tree needs them. */
export function itemsOf(dataPackage: Buffer): IcuItem[] {
  const malformed = (): never => {
    throw new BuildError("ICU's data package is malformed");
  };
  if (dataPackage.length < 12 || dataPackage.toString("latin1", 0, 4) !== "BICU") malformed();
  const [firstCell, count] = [dataPackage.readUInt16LE(4), dataPackage.readUInt32LE(8)];
  if (count <= filesItem || 16 + count * 4 > dataPackage.length) malformed();
  const startOf = (index: number) => dataPackage.readUInt32LE(12 + index * 4) & 0x3fff_ffff;
  const items = Array.from({ length: count }, (_, index): IcuItem => {
    if (startOf(index) > startOf(index + 1) || startOf(index + 1) > dataPackage.length) malformed();
    return { names: [], size: startOf(index + 1) - startOf(index) };
  });
  const bytesOf = (index: number) => dataPackage.subarray(startOf(index), startOf(index + 1));
  const nameAt = (names: Buffer, at: number) => {
    const end = names.indexOf(0, at);
    return end < 0 ? malformed() : names.toString("latin1", at, end);
  };
  const entriesOf = (directory: Buffer) => {
    const entries = directory.length >= 2 ? directory.readUInt16LE(0) : malformed();
    if (2 + entries * 8 > directory.length) malformed();
    return Array.from({ length: entries }, (_, index) => directory.subarray(2 + index * 8));
  };
  for (const entry of entriesOf(bytesOf(filesItem))) {
    const item = items[entry.readUInt16LE(2) & 0x3fff] ?? malformed();
    item.names.push(nameAt(bytesOf(filesItem), entry.readUInt16LE(0)));
  }
  for (const entry of entriesOf(bytesOf(localesItem))) {
    const [name, packed] = [nameAt(bytesOf(keysItem), entry.readUInt16LE(0)), entry.readUInt32LE(4)];
    treeOfColumn.forEach((tree, column) => {
      const cell = items[firstCell + (packed >>> 23) * treeOfColumn.length + column] ?? malformed();
      if ((packed >> Math.max(column - 1, 0)) & 1) cell.names.push(`${tree}${name}.res`);
    });
  }
  return items;
}

export interface IcuRun {
  firstItem: number;
  itemCount: number;
  features: number[];
  localeGroup: number | undefined;
  bytes: number;
}

type RemovableClasses = Map<IcuItemClass, { features: number[]; byLocale: boolean }>;

function removalOf(
  { names }: IcuItem,
  classes: RemovableClasses,
): { features: number[]; language: string | undefined } | undefined {
  const [first, ...others] = names.map(name => {
    const itemClass = classOfIcuItem(name);
    const removal = itemClass === undefined ? undefined : classes.get(itemClass);
    return removal && { features: removal.features, language: removal.byLocale ? languageOfIcuItem(name) : undefined };
  });
  if (others.some(other => other?.features !== first?.features || other?.language !== first?.language)) {
    throw new BuildError(`${names.join(", ")} share an item of ICU's data package, but are not removed together`);
  }
  return first;
}

export function runsOf(items: IcuItem[], classes: RemovableClasses, groupOfLanguage: Map<string, number>): IcuRun[] {
  const runs: IcuRun[] = [];
  items.forEach((item, index) => {
    const removal = removalOf(item, classes);
    if (removal === undefined) return;
    const { features, language } = removal;
    const localeGroup = language === undefined ? undefined : groupOfLanguage.get(language);
    const last = runs.at(-1);
    if (
      last !== undefined &&
      last.firstItem + last.itemCount === index &&
      last.features.join() === features.join() &&
      last.localeGroup === localeGroup
    ) {
      last.itemCount++;
      last.bytes += item.size;
    } else {
      runs.push({ firstItem: index, itemCount: 1, features, localeGroup, bytes: item.size });
    }
  });
  return runs;
}

export interface IcuPackageRuns {
  start: number;
  end: number;
  items: number;
  runs: IcuRun[];
}

export interface NamedBytes {
  symbols: [name: string, address: number][];
  image: LinkedImage;
}

export function namedBytesOfElf(executable: string): NamedBytes | undefined {
  const elf = openElf(executable, "r");
  if (elf === undefined) return undefined;
  const table = elf.sections.find(section => section.type === 2) ?? fail(`${executable} has no symbol table`);
  const symbols = readAt(elf.fd, table.offset, table.size);
  const strings = readAt(elf.fd, elf.sections[table.link]!.offset, elf.sections[table.link]!.size);
  const named: NamedBytes["symbols"] = [];
  for (let at = 0; at < symbols.length; at += 24) {
    const section = symbols.readUInt16LE(at + 6);
    if (section === 0 || (section >= 0xff00 && section < 0xffff) || (symbols[at + 4]! & 15) === 6) continue;
    if (section < 0xff00 && (elf.sections[section]!.flags & 2) === 0) continue;
    const name = stringAt(strings, symbols.readUInt32LE(at));
    if (!name.startsWith("$")) named.push([name, Number(symbols.readBigUInt64LE(at + 8))]);
  }
  const image = elfImage(executable, elf);
  closeSync(elf.fd);
  return { symbols: named, image };
}

function collectClassFeatures(model: FeatureModel, format: ObjectFormat): RemovableClasses {
  const classes: RemovableClasses = new Map();
  const seen = new Set<IcuItemClass>();
  for (const line of model.icuData) {
    const itemClass = icuItemClasses.find(known => known === line.itemClass);
    if (itemClass === undefined) throw new BuildError(`unknown icu-data class ${line.itemClass}`);
    if (seen.has(itemClass)) throw new BuildError(`duplicate icu-data line for class ${itemClass}`);
    seen.add(itemClass);
    if ((line.exceptWindows && format === "coff") || line.features.length === 0) continue;
    const features = line.features.map(feature => featureNamed(model, feature).index);
    classes.set(itemClass, { features: features.sort((a, b) => a - b), byLocale: line.byLocale });
  }
  return classes;
}

function findPackages(linked: NamedBytes, graph: SectionGraph): { start: number; end: number; items: IcuItem[] }[] {
  const starts = linked.symbols.filter(([name]) => name === "bun_icu_package").map(([, address]) => address);
  return [...new Set(starts)].map(start => {
    const node = nodeAt(graph, start);
    if (node < 0) fail("ICU's data package lies in no section");
    const end = linked.symbols.reduce(
      (end, [, address]) => (address > start && address < end ? address : end),
      graph.address[node]! + graph.size[node]!,
    );
    const items = itemsOf(linked.image.bytes(start, end - start) ?? fail("ICU's data package lies in no section"));
    return { start, end, items };
  });
}

export function icuPackagesOf(
  linked: NamedBytes | undefined,
  graph: SectionGraph,
  model: FeatureModel,
): { packages: IcuPackageRuns[]; languages: IcuLanguage[] } {
  if (linked === undefined || model.icuData.length === 0) return { packages: [], languages: [] };
  const classes = collectClassFeatures(model, graph.format);
  const found = findPackages(linked, graph);
  const languages = groupLanguages(
    found.flatMap(({ items }) => items.flatMap(item => removalOf(item, classes)?.language ?? [])),
    found.length === 0 ? [] : model.icuLanguageGroups,
  );
  const groupOfLanguage = new Map(languages.map(({ name, group }) => [name, group]));
  const packages = found.map(({ start, end, items }) => ({
    start,
    end,
    items: items.length,
    runs: runsOf(items, classes, groupOfLanguage),
  }));
  return { packages, languages };
}
