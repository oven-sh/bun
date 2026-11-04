import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../error.ts";
import {
  enteredFromValues,
  featureIndexLimit,
  firstEmbedderFeatureIndex,
  objectFormats,
  trimFeatureLimit,
  type EnteredFrom,
  type Feature,
  type FeatureModel,
  type FeatureName,
  type IcuDataLine,
  type ObjectFormat,
  type TrimFeature,
} from "./types.ts";

export { featureIndexLimit, firstEmbedderFeatureIndex, trimFeatureLimit } from "./types.ts";
export type { Feature, FeatureModel, FeatureName, IcuDataLine, StubKind, TrimFeature } from "./types.ts";

export const featureFiles = [
  "engine.def",
  "tools.def",
  "bun.def",
  "node.def",
  "web.def",
  "process.def",
  "trim-features.def",
  "icu-data.def",
] as const;

type FeatureFile = (typeof featureFiles)[number];
type FeatureLists = Omit<FeatureModel, "hash">;
type NumberByFormat = Partial<Record<ObjectFormat, number>>;

const featureNamePattern = /^[A-Z][A-Za-z0-9]*$/;
const trimFeatureNamePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const languagePattern = /^[a-z]{2,3}$/;
const printableAsciiPattern = /^[\x20-\x7e]+$/;

const isEnteredFrom = (value: unknown): value is EnteredFrom => enteredFromValues.includes(value as EnteredFrom);
const isObjectFormat = (value: unknown): value is ObjectFormat => objectFormats.includes(value as ObjectFormat);

function fail(message: string, file: string): never {
  throw new BuildError(message, { file });
}

function featureRustName(name: FeatureName): string {
  return name.replace(/[A-Z]{2,}/g, (run, offset: number) => {
    const next = name[offset + run.length];
    const lastStartsWord = next !== undefined && next >= "a" && next <= "z";
    const end = lastStartsWord ? run.length - 1 : run.length;
    return run.slice(0, 1) + run.slice(1, end).toLowerCase() + run.slice(end);
  });
}

function trimFeatureRustName(name: string): string {
  return name
    .split("-")
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

interface Origin {
  path: string;
  sites: Map<string, string[]>;
}

const siteOf = (origin: Origin, key: string, occurrence = 0) => origin.sites.get(key)?.[occurrence] ?? origin.path;

type Declaration =
  | { kind: "feature"; feature: Feature; seen: Set<string> }
  | { kind: "trim-feature"; trimFeature: TrimFeature; seen: Set<string> }
  | { kind: "icu-data" }
  | { kind: "icu-language-group" };

interface ParseState extends FeatureLists {
  sites: Map<string, string[]>;
  declaration: Declaration | undefined;
  engineFeatureCount: number;
  embedderFeatureCount: number;
}

interface Line {
  words: string[];
  text: string | undefined;
  site: string;
}

function splitLine(line: string, site: string): Line {
  const words: string[] = [];
  for (const match of line.matchAll(/[^ \t]+/g)) {
    if (match[0].startsWith('"')) return { words, text: line.slice(match.index).trimEnd(), site };
    words.push(match[0]);
  }
  return { words, text: undefined, site };
}

function recordSite(state: ParseState, key: string, site: string) {
  const sites = state.sites.get(key);
  if (sites) sites.push(site);
  else state.sites.set(key, [site]);
}

function argumentsOf(line: Line, minimum: number, maximum = Infinity): string[] {
  const count = line.words.length - 1;
  if (line.text !== undefined || count < minimum || count > maximum)
    fail(`wrong number of words after ${line.words[0]}`, line.site);
  return line.words.slice(1);
}

function parseText(line: Line, wordCount: number): string {
  if (line.text === undefined || line.words.length !== wordCount)
    fail(`wrong number of words in ${line.words[0]}`, line.site);
  let text: unknown;
  try {
    text = JSON.parse(line.text);
  } catch {
    fail(`not a JSON string: ${line.text}`, line.site);
  }
  if (typeof text !== "string") fail(`not a JSON string: ${line.text}`, line.site);
  if (!printableAsciiPattern.test(text)) fail(`text must be non-empty printable ASCII: ${line.text}`, line.site);
  return text;
}

function checkOnce(seen: Set<string>, attribute: string, line: Line) {
  if (seen.has(attribute)) fail(`duplicate ${attribute}`, line.site);
  seen.add(attribute);
}

function checkName(name: string | undefined, pattern: RegExp, line: Line) {
  if (name === undefined || !pattern.test(name)) fail(`invalid name: ${name}`, line.site);
}

function setForFormats(values: NumberByFormat, value: number, format: string | undefined, line: Line) {
  if (format !== undefined && !isObjectFormat(format)) fail(`unknown object format: ${format}`, line.site);
  for (const each of format === undefined ? objectFormats : [format]) {
    if (values[each] !== undefined) fail(`duplicate ${line.words[0]} for ${each}`, line.site);
    values[each] = value;
  }
}

function parseMinimum(feature: Feature, line: Line) {
  const [bytes, format] = argumentsOf(line, 1, 2);
  if (!/^\d+$/.test(bytes!) || !Number.isSafeInteger(Number(bytes)))
    fail(`minimum is not a byte count: ${bytes}`, line.site);
  setForFormats(feature.minimumBytes, Number(bytes), format, line);
}

function parseCxxFunction(feature: Feature, line: Line) {
  const [hint, pattern] = argumentsOf(line, 2, 2);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(hint!))
    fail(`cxx-function starts with an identifier that every symbol it means contains: ${hint}`, line.site);
  try {
    new RegExp(pattern!);
  } catch {
    fail(`cxx-function is not a regular expression: ${pattern}`, line.site);
  }
  const functions = (feature.cxxFunctions ??= []);
  if (functions.some(each => each.pattern === pattern)) fail(`duplicate cxx-function ${pattern}`, line.site);
  functions.push({ hint: hint!, pattern: pattern! });
}

function parseCFunctions(feature: Feature, line: Line) {
  const functions = (feature.cFunctions ??= []);
  for (const name of argumentsOf(line, 1)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`c-function is not the name of a C function: ${name}`, line.site);
    if (functions.includes(name)) fail(`duplicate c-function ${name}`, line.site);
    functions.push(name);
  }
}

function addMembers(
  state: ParseState,
  list: FeatureName[],
  attribute: string,
  owner: string,
  words: string[],
  site: string,
) {
  for (const word of words) {
    list.push(word);
    recordSite(state, `${attribute}\0${owner}\0${word}`, site);
  }
}

function parseFeatureAttribute(feature: Feature, seen: Set<string>, line: Line) {
  const keyword = line.words[0];
  switch (keyword) {
    case "entered-from": {
      checkOnce(seen, keyword, line);
      const [value] = argumentsOf(line, 1, 1);
      if (!isEnteredFrom(value)) fail(`unknown entered-from value: ${value}`, line.site);
      if (value === "program") fail("entered-from program is the default", line.site);
      feature.enteredFrom = value;
      return;
    }
    case "exports":
      argumentsOf(line, 0, 0);
      feature.exports = true;
      return;
    case "minimum":
      return parseMinimum(feature, line);
    case "c-function":
      return parseCFunctions(feature, line);
    case "cxx-function":
      return parseCxxFunction(feature, line);
    default:
      fail(`unknown feature attribute: ${keyword ?? line.text}`, line.site);
  }
}

function parseSaves(trimFeature: TrimFeature, line: Line) {
  const [linux, macos] = argumentsOf(line, 2, 2) as [string, string];
  for (const size of [linux, macos])
    if (!/^\d+(\.\d+)?$/.test(size)) fail(`saves is not a decimal number: ${size}`, line.site);
  trimFeature.saves = { linux: Number(linux), macos: Number(macos) };
}

function parseTrimFeatureAttribute(trimFeature: TrimFeature, seen: Set<string>, line: Line) {
  const keyword = line.words[0];
  switch (keyword) {
    case "about":
      checkOnce(seen, keyword, line);
      trimFeature.about = parseText(line, 1);
      return;
    case "also":
      trimFeature.also.push(parseText(line, 1));
      return;
    case "saves":
      checkOnce(seen, keyword, line);
      return parseSaves(trimFeature, line);
    default:
      fail(`unknown trim-feature attribute: ${keyword ?? line.text}`, line.site);
  }
}

function parseAttribute(state: ParseState, line: Line) {
  const declaration = state.declaration;
  if (declaration === undefined) fail("indented line outside a declaration", line.site);
  switch (declaration.kind) {
    case "feature":
      return parseFeatureAttribute(declaration.feature, declaration.seen, line);
    case "trim-feature":
      return parseTrimFeatureAttribute(declaration.trimFeature, declaration.seen, line);
    case "icu-data":
    case "icu-language-group":
      fail(`${declaration.kind} takes no indented lines`, line.site);
  }
}

function nextFeatureIndex(state: ParseState, file: FeatureFile, line: Line): number {
  if (file !== "engine.def") return firstEmbedderFeatureIndex + state.embedderFeatureCount++;
  if (state.engineFeatureCount === firstEmbedderFeatureIndex)
    fail(`more than ${firstEmbedderFeatureIndex} engine features`, line.site);
  return state.engineFeatureCount++;
}

function parseFeatureDeclaration(state: ParseState, file: FeatureFile, line: Line) {
  if (file === "trim-features.def" || file === "icu-data.def") fail(`feature is not allowed in ${file}`, line.site);
  const name = line.words[1]!;
  const text = parseText(line, 2);
  checkName(name, featureNamePattern, line);
  const index = nextFeatureIndex(state, file, line);
  const feature: Feature = {
    name,
    rustName: featureRustName(name),
    index,
    text,
    enteredFrom: "program",
    isEngine: index < firstEmbedderFeatureIndex,
    minimumBytes: {},
    exports: false,
  };
  state.features.push(feature);
  recordSite(state, `feature\0${name}`, line.site);
  state.declaration = { kind: "feature", feature, seen: new Set() };
}

function parseTrimFeatureDeclaration(state: ParseState, file: FeatureFile, line: Line) {
  if (file !== "trim-features.def") fail(`trim-feature is not allowed in ${file}`, line.site);
  const [name, colon, ...members] = argumentsOf(line, 3);
  checkName(name, trimFeatureNamePattern, line);
  if (colon !== ":") fail("trim-feature needs a colon after its name", line.site);
  const trimFeature: TrimFeature = {
    name: name!,
    features: [],
    about: "",
    also: [],
    rustName: trimFeatureRustName(name!),
  };
  addMembers(state, trimFeature.features, "trim-feature", trimFeature.name, members, line.site);
  state.trimFeatures.push(trimFeature);
  recordSite(state, `trim-feature\0${trimFeature.name}`, line.site);
  state.declaration = { kind: "trim-feature", trimFeature, seen: new Set() };
}

function parseIcuDataDeclaration(state: ParseState, file: FeatureFile, line: Line) {
  if (file !== "icu-data.def") fail(`icu-data is not allowed in ${file}`, line.site);
  const words = argumentsOf(line, 2);
  const itemClass = words[0]!;
  let colon = 1;
  const exceptWindows = words[colon] === "except-windows";
  if (exceptWindows) colon++;
  const byLocale = words[colon] === "by-locale";
  if (byLocale) colon++;
  if (words[colon] !== ":")
    fail("icu-data takes its class, except-windows, by-locale and a colon, in that order", line.site);
  const icuDataLine: IcuDataLine = { itemClass, exceptWindows, byLocale, features: [] };
  addMembers(state, icuDataLine.features, "icu-data", itemClass, words.slice(colon + 1), line.site);
  state.icuData.push(icuDataLine);
  recordSite(state, `icu-data\0${itemClass}`, line.site);
  state.declaration = { kind: "icu-data" };
}

function parseIcuLanguageGroup(state: ParseState, file: FeatureFile, line: Line) {
  if (file !== "icu-data.def") fail(`icu-language-group is not allowed in ${file}`, line.site);
  const languages = argumentsOf(line, 2);
  for (const language of languages) {
    checkName(language, languagePattern, line);
    recordSite(state, `icu-language\0${language}`, line.site);
  }
  state.icuLanguageGroups.push(languages);
  state.declaration = { kind: "icu-language-group" };
}

function parseDeclaration(state: ParseState, file: FeatureFile, line: Line) {
  const keyword = line.words[0];
  switch (keyword) {
    case "feature":
      return parseFeatureDeclaration(state, file, line);
    case "trim-feature":
      return parseTrimFeatureDeclaration(state, file, line);
    case "icu-data":
      return parseIcuDataDeclaration(state, file, line);
    case "icu-language-group":
      return parseIcuLanguageGroup(state, file, line);
    default:
      fail(`unknown declaration: ${keyword ?? line.text}`, line.site);
  }
}

function parseFile(state: ParseState, file: FeatureFile, text: string) {
  state.declaration = undefined;
  const lines = text.split(/\r?\n/);
  for (const [number, line] of lines.entries()) {
    if (/^[ \t]*(#|$)/.test(line)) continue;
    const split = splitLine(line, `src/trim/features/${file}:${number + 1}`);
    if (line[0] === " " || line[0] === "\t") parseAttribute(state, split);
    else parseDeclaration(state, file, split);
  }
}

export function parseFeatures(files: { name: FeatureFile; text: string }[]): FeatureModel {
  const state: ParseState = {
    features: [],
    trimFeatures: [],
    icuData: [],
    icuLanguageGroups: [],
    sites: new Map(),
    declaration: undefined,
    engineFeatureCount: 0,
    embedderFeatureCount: 0,
  };
  for (const name of featureFiles) for (const file of files) if (file.name === name) parseFile(state, name, file.text);
  const origin: Origin = { path: "src/trim/features", sites: state.sites };
  for (const { name, about } of state.trimFeatures) {
    if (about === "") fail(`trim feature ${name} has no about line`, siteOf(origin, `trim-feature\0${name}`));
  }
  return finishModel(state, origin);
}

export function loadFeatures(repositoryRoot: string): FeatureModel {
  const files = featureFiles.map(name => {
    const path = join(repositoryRoot, "src", "trim", "features", name);
    try {
      return { name, text: readFileSync(path, "utf8") };
    } catch (cause) {
      throw new BuildError(`cannot read feature file ${name}`, { file: path, cause });
    }
  });
  return parseFeatures(files);
}

function checkLimits(features: Feature[], trimFeatures: TrimFeature[], origin: Origin) {
  for (const { name, index } of features) {
    if (index >= featureIndexLimit)
      fail(`feature ${name} has index ${index}, limit ${featureIndexLimit}`, siteOf(origin, `feature\0${name}`));
  }
  if (trimFeatures.length > trimFeatureLimit) {
    fail(
      `more than ${trimFeatureLimit} trim features`,
      siteOf(origin, `trim-feature\0${trimFeatures[trimFeatureLimit]!.name}`),
    );
  }
}

function checkDeclaredOnce({ features, trimFeatures, icuData }: FeatureLists, origin: Origin) {
  const firstSites = new Map<string, string>();
  const claim = (kind: string, name: string) => {
    const key = `${kind}\0${name}`;
    const first = firstSites.get(key);
    if (first !== undefined) fail(`${kind} ${name} is declared twice, first at ${first}`, siteOf(origin, key, 1));
    firstSites.set(key, siteOf(origin, key));
  };
  for (const { name } of features) claim("feature", name);
  for (const { name } of trimFeatures) claim("trim-feature", name);
  for (const { itemClass } of icuData) claim("icu-data", itemClass);
}

function checkLanguageGroups(groups: string[][], origin: Origin) {
  const seen = new Set<string>();
  for (const language of groups.flat()) {
    if (seen.has(language))
      fail(`icu-language-group lists ${language} twice`, siteOf(origin, `icu-language\0${language}`, 1));
    seen.add(language);
  }
}

function checkRustNames(items: { name: string; rustName: string }[], kind: string, origin: Origin) {
  const names = new Map<string, string>();
  for (const { name, rustName } of items) {
    const first = names.get(rustName);
    if (first !== undefined)
      fail(`${first} and ${name} have the same Rust name, ${rustName}`, siteOf(origin, `${kind}\0${name}`));
    names.set(rustName, name);
  }
}

function checkMembers(
  members: FeatureName[],
  attribute: string,
  owner: string,
  known: Map<FeatureName, number>,
  origin: Origin,
) {
  const seen = new Set<FeatureName>();
  for (const member of members) {
    const key = `${attribute}\0${owner}\0${member}`;
    if (!known.has(member)) fail(`unknown feature ${member} in ${attribute} of ${owner}`, siteOf(origin, key));
    if (seen.has(member)) fail(`${attribute} of ${owner} lists ${member} twice`, siteOf(origin, key, 1));
    seen.add(member);
  }
}

function checkReferences(lists: FeatureLists, known: Map<FeatureName, number>, origin: Origin) {
  for (const { name, features } of lists.trimFeatures) checkMembers(features, "trim-feature", name, known, origin);
  for (const { itemClass, features } of lists.icuData) checkMembers(features, "icu-data", itemClass, known, origin);
}

function computeHash({ features, trimFeatures, icuData, icuLanguageGroups }: FeatureLists): bigint {
  const text = JSON.stringify([
    features.map(f => [f.name, f.index, f.enteredFrom, f.exports]),
    trimFeatures.map(t => [t.name, t.features]),
    icuData.map(d => [d.itemClass, d.exceptWindows, d.byLocale, d.features]),
    icuLanguageGroups,
  ]);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash;
}

function finishModel(
  { features, trimFeatures, icuData, icuLanguageGroups }: FeatureLists,
  origin: Origin,
): FeatureModel {
  const lists: FeatureLists = { features, trimFeatures, icuData, icuLanguageGroups };
  features.sort((a, b) => a.index - b.index);
  checkLimits(features, trimFeatures, origin);
  checkDeclaredOnce(lists, origin);
  checkLanguageGroups(icuLanguageGroups, origin);
  checkRustNames(features, "feature", origin);
  checkRustNames(trimFeatures, "trim-feature", origin);
  const known = new Map(features.map(({ name, index }) => [name, index]));
  checkReferences(lists, known, origin);
  const byIndex = (a: FeatureName, b: FeatureName) => known.get(a)! - known.get(b)!;
  for (const { features: members } of [...trimFeatures, ...icuData]) members.sort(byIndex);
  return { ...lists, hash: computeHash(lists) };
}

interface FeatureLookups {
  features: Map<FeatureName, Feature>;
}

const lookupCache = new WeakMap<FeatureModel, FeatureLookups>();

function lookupsOf(model: FeatureModel): FeatureLookups {
  const existing = lookupCache.get(model);
  if (existing) return existing;
  const lookups: FeatureLookups = { features: new Map(model.features.map(feature => [feature.name, feature])) };
  lookupCache.set(model, lookups);
  return lookups;
}

// `Feature::all_outside_compiled_programs` in src/trim/removable_features/lib.rs.
export function isOutsideCompiledPrograms({ name, enteredFrom }: Pick<Feature, "name" | "enteredFrom">): boolean {
  return enteredFrom === "command-line" || name === "JIT";
}

export function featureNamed(model: FeatureModel, name: FeatureName): Feature {
  const feature = lookupsOf(model).features.get(name);
  if (!feature) throw new BuildError(`unknown feature: ${name}`);
  return feature;
}

export function narrowestTrimFeature(model: FeatureModel, feature: FeatureName): TrimFeature | undefined {
  let narrowest: TrimFeature | undefined;
  for (const trimFeature of model.trimFeatures) {
    if (!trimFeature.features.includes(feature)) continue;
    if (narrowest === undefined || trimFeature.features.length < narrowest.features.length) narrowest = trimFeature;
  }
  return narrowest;
}

export function serializeFeatureModel({ hash, ...lists }: FeatureModel): string {
  return JSON.stringify({ hash: hash.toString(), ...lists }, null, 2) + "\n";
}

export function readFeatureModel(path: string): FeatureModel {
  const { hash, ...lists } = JSON.parse(readFileSync(path, "utf8")) as FeatureLists & { hash: string };
  return { ...lists, hash: BigInt(hash) };
}
