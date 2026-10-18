import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TrimFeature {
  name: string;
  features: string[];
  about: string;
  also: { feature: string; what: string }[];
  modules: string[];
  absent: string[];
  throws: string[];
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
    if (words[0] === "public") result.names.push({ name: words[1]!, features: words.slice(2), about: "", also: [], modules: [], absent: [], throws: [] });
    else if (words[0] === "about") named(words[1]!).about = rest(2);
    else if (words[0] === "module") named(words[1]!).modules.push(...words.slice(2));
    else if (words[0] === "absent") named(words[1]!).absent.push(...words.slice(2));
    else if (words[0] === "throws") named(words[1]!).throws.push(...words.slice(2));
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
  if (feature.absent.length > 0) paragraphs.push(`${listed(feature.absent.map(path => `\`${path}\``))} ${feature.absent.length > 1 ? "are" : "is"} \`undefined\`.`);
  if (feature.throws.length > 0) paragraphs.push(`${listed(feature.throws.map(path => `\`${path}()\``))} ${feature.throws.length > 1 ? "throw" : "throws"} an \`Error\`.`);
  if (feature.modules.length > 0) paragraphs.push(`An import of ${listed(feature.modules.map(module => `\`${module}\``))} throws an \`Error\`.`);
  const alsoStops = feature.also.map(each => each.what).filter(what => what !== "");
  if (alsoStops.length > 0) paragraphs.push(`Also stops working: ${alsoStops.join("; ")}.`);
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
    'Each size is what the name saves when `"cli"` is removed too; the size of a part of `"cli"` is what it saves alone. Parts share code, and the file only gets shorter where at least 128 KB in a row (256 KB on macOS) is removed, so a list usually saves more than the sum of its names. Bun overwrites what it removes, even where the file does not get shorter.',
    'A program can find out that a part is gone and go on without it: the way into a removed part is `undefined`, or a function that throws an `Error` whose `code` is `"ERR_FEATURE_REMOVED"`, or an import that fails as one of a module that does not exist (`"ERR_MODULE_NOT_FOUND"`). Each name says which. Past those, code that still reaches a removed part ends the process with exit code 70 and says which part it was.',
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
