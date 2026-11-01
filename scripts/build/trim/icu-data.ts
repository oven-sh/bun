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
  "transliteration",
  "unit",
  "zone",
  "locale",
  "currency-codes",
  "gender-list",
  "day-periods",
  "plural-rules",
  "converter",
  "string-prep",
  "confusables",
  "character-names",
  "nfkc-simple-case-fold",
  "windows-zones",
] as const;

export type IcuItemClass = (typeof icuItemClasses)[number];

function classOfTopLevelItem(file: string, extension: string): IcuItemClass | undefined {
  switch (extension) {
    case "cnv":
      return "converter";
    case "spp":
      return "string-prep";
    case "cfu":
      return "confusables";
  }
  switch (file) {
    case "cnvalias.icu":
      return "converter";
    case "unames.icu":
      return "character-names";
    case "nfkc_scf.nrm":
      return "nfkc-simple-case-fold";
    case "windowsZones.res":
      return "windows-zones";
    case "units.res":
    case "grammaticalFeatures.res":
      return "unit";
    case "currencyNumericCodes.res":
      return "currency-codes";
    case "genderList.res":
      return "gender-list";
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
      return classOfTopLevelItem(file, extension);
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
    case "translit":
      return "transliteration";
    case "unit":
      return "unit";
    case "zone":
      return ["root.res", "pool.res", "en.res"].includes(file) ? undefined : "zone";
    default:
      return undefined;
  }
}

export interface IcuItem {
  name: string;
  size: number;
}

export function itemsOf(dataPackage: Buffer): IcuItem[] {
  const malformed = (): never => {
    throw new BuildError("ICU's data package is malformed");
  };
  const isCommonData =
    dataPackage.length >= 32 &&
    dataPackage.readUInt16BE(2) === 0xda27 &&
    dataPackage[8] === 0 &&
    dataPackage.toString("latin1", 12, 17) === "CmnD\x01";
  if (!isCommonData) malformed();
  const contents = dataPackage.subarray(dataPackage.readUInt16LE(0));
  const count = contents.length >= 4 ? contents.readUInt32LE(0) : malformed();
  if (4 + count * 8 > contents.length) malformed();
  const startOf = (index: number) => (index < count ? contents.readUInt32LE(8 + index * 8) : contents.length);
  return Array.from({ length: count }, (_, index) => {
    const name = contents.readUInt32LE(4 + index * 8);
    const end = contents.indexOf(0, name);
    const size = startOf(index + 1) - startOf(index);
    if (end < 0 || size < 0 || startOf(index + 1) > contents.length) malformed();
    const path = contents.toString("latin1", name, end);
    return { name: path.slice(path.indexOf("/") + 1), size };
  });
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
  name: string,
  classes: RemovableClasses,
): { features: number[]; language: string | undefined } | undefined {
  const itemClass = classOfIcuItem(name);
  const removal = itemClass === undefined ? undefined : classes.get(itemClass);
  if (removal === undefined) return undefined;
  return { features: removal.features, language: removal.byLocale ? languageOfIcuItem(name) : undefined };
}

export function runsOf(
  items: IcuItem[],
  classes: RemovableClasses,
  groupOfLanguage: Map<string, number> | undefined,
): IcuRun[] {
  const runs: IcuRun[] = [];
  items.forEach(({ name, size }, index) => {
    const removal = removalOf(name, classes);
    if (removal === undefined) return;
    const { features, language } = removal;
    const localeGroup = language === undefined ? undefined : groupOfLanguage?.get(language);
    const last = runs.at(-1);
    if (
      last !== undefined &&
      last.firstItem + last.itemCount === index &&
      last.features.join() === features.join() &&
      last.localeGroup === localeGroup
    ) {
      last.itemCount++;
      last.bytes += size;
    } else {
      runs.push({ firstItem: index, itemCount: 1, features, localeGroup, bytes: size });
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
  const starts = linked.symbols.filter(([name]) => /^icudt\d+_dat$/.test(name)).map(([, address]) => address);
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

// The step that builds the archive defining this symbol also patches ICU's udata.cpp to call Bun's hook, which reports a tombstone.
const hookMarkerSymbol = "bun_icu_zstd_dict";

export function icuPackagesOf(
  linked: NamedBytes | undefined,
  graph: SectionGraph,
  model: FeatureModel,
): { packages: IcuPackageRuns[]; languages: IcuLanguage[] } {
  if (linked === undefined || model.icuData.length === 0) return { packages: [], languages: [] };
  const classes = collectClassFeatures(model, graph.format);
  const found = findPackages(linked, graph);
  const hasHook = linked.symbols.some(([name]) => name === hookMarkerSymbol);
  const names = found.flatMap(({ items }) => items.map(({ name }) => name));
  const languages = hasHook
    ? groupLanguages(
        names.flatMap(name => removalOf(name, classes)?.language ?? []),
        model.icuLanguageGroups,
      )
    : [];
  const groupOfLanguage = hasHook ? new Map(languages.map(({ name, group }) => [name, group])) : undefined;
  const packages = found.map(({ start, end, items }) => ({
    start,
    end,
    items: items.length,
    runs: runsOf(items, classes, groupOfLanguage),
  }));
  return { packages, languages };
}
