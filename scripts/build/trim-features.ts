import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TrimFeature {
  name: string;
  features: string[];
  about: string;
  also: { feature: string; what: string }[];
  saves?: { linux: number; macos: number };
}

export interface TrimFeatures {
  names: TrimFeature[];
  libraries: { name: string; version: string; features: string[] }[];
  needs: { needed: string; dependent: string }[];
}

export const doorsPath = join(import.meta.dir, "islands.doors");
export const declarationsPath = join(import.meta.dir, "..", "..", "packages", "bun-types", "trim.d.ts");

export function readTrimFeatures(doors: string): TrimFeatures {
  const result: TrimFeatures = { names: [], libraries: [], needs: [] };
  const named = (name: string) => {
    const found = result.names.find(each => each.name === name);
    if (!found) throw new Error(`there is no public name ${name}`);
    return found;
  };
  for (const line of doors.split("\n")) {
    const words = line.trim().split(/\s+/);
    const rest = (from: number) => words.slice(from).join(" ");
    if (words[0] === "public") result.names.push({ name: words[1]!, features: words.slice(2), about: "", also: [] });
    else if (words[0] === "about") named(words[1]!).about = rest(2);
    else if (words[0] === "also") named(words[1]!).also.push({ feature: words[2]!, what: rest(3) });
    else if (words[0] === "saves") named(words[1]!).saves = { linux: Number(words[2]), macos: Number(words[3]) };
    else if (words[0] === "library" || words[0] === "windows-library") result.libraries.push({ name: words[1]!, version: words[2]!, features: words.slice(3) });
    else if (words[0] === "when" && words[2] === "feature") result.needs.push({ needed: words[1]!, dependent: words[3]! });
  }
  return result;
}

export function narrowestNameOf({ names }: TrimFeatures, feature: string): string | undefined {
  const holders = names.filter(each => each.features.includes(feature));
  return holders.sort((a, b) => a.features.length - b.features.length)[0]?.name;
}

export function removedOnlyWith(all: TrimFeatures, { features, also }: TrimFeature): string[] {
  const tolerated = also.map(each => each.feature);
  const dependents = all.needs.filter(({ needed, dependent }) => features.includes(needed) && !features.includes(dependent) && !tolerated.includes(dependent));
  return [...new Set(dependents.map(({ dependent }) => narrowestNameOf(all, dependent) ?? `(${dependent})`))];
}

const listed = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const quoted = (names: string[]) => listed(names.map(name => `\`"${name}"\``));
const megabytes = (size: number) => `${size.toFixed(1)} MB`;

function wrapped(paragraph: string, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(" ")) {
    if (line && indent.length + 3 + line.length + 1 + word.length > 100) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].map(each => `${indent} * ${each}`);
}

function paragraphsOf(all: TrimFeatures, feature: TrimFeature): string[] {
  const paragraphs = [feature.about];
  if (feature.also.length > 0) paragraphs.push(`Also stops working: ${feature.also.map(each => each.what).join("; ")}.`);
  const touched = all.libraries.filter(library => library.features.some(each => feature.features.includes(each)));
  const whole = touched.filter(library => library.features.every(each => feature.features.includes(each)));
  if (whole.length > 0) paragraphs.push(`Takes ${listed(whole.map(library => library.name))} out of the executable.`);
  for (const library of touched.filter(library => !whole.includes(library))) {
    const others = [...new Set(library.features.filter(each => !feature.features.includes(each)).map(each => narrowestNameOf(all, each)))];
    const named = others.filter(each => each !== undefined);
    if (named.length === others.length) paragraphs.push(`${library.name} leaves the executable once ${quoted(named)} ${named.length > 1 ? "are" : "is"} removed too.`);
  }
  const only = removedOnlyWith(all, feature);
  if (only.length > 0) paragraphs.push(`Can be removed only together with ${quoted(only)}.`);
  if (feature.saves) {
    const { linux, macos } = feature.saves;
    paragraphs.push(linux < 0.05 && macos < 0.05 ? "Saves under 0.1 MB by itself." : `Saves about ${megabytes(linux)} on Linux x64 and ${megabytes(macos)} on macOS arm64.`);
  }
  return paragraphs;
}

export function declarationsOf(doors: string): string {
  const all = readTrimFeatures(doors);
  const comment = (paragraphs: string[], indent: string) => [`${indent}/**`, ...paragraphs.flatMap((paragraph, index) => [...(index > 0 ? [`${indent} *`] : []), ...wrapped(paragraph, indent)]), `${indent} */`];
  const head = [
    "The name of a part of Bun that `compile.trim` of `Bun.build()` can leave out of an executable.",
    'The sizes are what a name saves in an executable that has lost `"cli"` as well. Parts share code, and only runs of at least 128 KB (256 KB on macOS) leave the file, so a list usually saves more than the sum of its names. What is removed is overwritten in the file even where the file does not get smaller.',
  ];
  return [
    "// Generated by scripts/build/trim-features.ts from scripts/build/islands.doors. Do not edit by hand.",
    "",
    'declare module "bun" {',
    "  namespace Build {",
    ...comment(head, "    "),
    "    type TrimFeature =",
    ...all.names.flatMap((feature, index) => [...comment(paragraphsOf(all, feature), "      "), `      | "${feature.name}"${index === all.names.length - 1 ? ";" : ""}`]),
    "  }",
    "}",
    "",
  ].join("\n");
}

if (import.meta.main) writeFileSync(declarationsPath, declarationsOf(readFileSync(doorsPath, "utf8")));
