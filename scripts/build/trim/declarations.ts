import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../error.ts";
import { checkBuiltinUses, guardFeatureOf, readBuiltinUses } from "./builtin-uses.ts";
import { featureNamed, loadFeatures } from "./features.ts";
import type { BuiltinEntry, BuiltinUses, Feature, FeatureModel, TrimFeature } from "./types.ts";

export const declarationsPath = join(import.meta.dirname, "..", "..", "..", "packages", "bun-types", "trim.d.ts");

const listed = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
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

function classifyBuiltins(entries: BuiltinEntry[]) {
  const throws: string[] = [];
  const modules: string[] = [];
  for (const { kind, path } of entries) {
    switch (kind) {
      case "Function":
      case "Method":
        throws.push(`${path}()`);
        break;
      case "Constructor":
        throws.push(`new ${path}()`);
        break;
      case "Accessor":
        throws.push(path);
        break;
      case "Module":
        modules.push(path);
        break;
      case "Namespace":
      case "DataProperty":
      case "Constant":
      case "Prototype":
      case "NativeBinding":
      case "InternalModule":
        break;
      default: {
        const unhandled: never = kind;
        throw new BuildError(`built-in ${path} has unknown kind ${String(unhandled)}`);
      }
    }
  }
  return { throws, modules };
}

function reachableFeatures(model: FeatureModel, trimFeature: TrimFeature): Feature[] {
  return trimFeature.features
    .map(name => featureNamed(model, name))
    .filter(feature => feature.enteredFrom !== "command-line");
}

// `bun:ffi` is written with `Bun.FFI`. Bun's types declare the module and not the object.
const objectsWithoutDeclaration = ["Bun.FFI"];

function documentedEntries(model: FeatureModel, uses: BuiltinUses, trimFeature: TrimFeature): BuiltinEntry[] {
  const features = new Set(reachableFeatures(model, trimFeature).map(feature => feature.name));
  return uses.entries.filter(entry => {
    const guardFeature = guardFeatureOf(entry);
    const isDeclared =
      !entry.hasHiddenRoot && !objectsWithoutDeclaration.some(object => entry.path.startsWith(`${object}.`));
    return isDeclared && guardFeature !== undefined && features.has(guardFeature);
  });
}

export function documentedModules(model: FeatureModel, uses: BuiltinUses, trimFeature: TrimFeature): string[] {
  return classifyBuiltins(documentedEntries(model, uses, trimFeature)).modules;
}

function paragraphsOf(model: FeatureModel, uses: BuiltinUses, trimFeature: TrimFeature): string[] {
  const { throws, modules } = classifyBuiltins(documentedEntries(model, uses, trimFeature));
  const paragraphs = trimFeature.about === "" ? [] : [trimFeature.about];
  if (throws.length > 0)
    paragraphs.push(
      `Without it, ${listed(throws.map(expression => `\`${expression}\``))} ${throws.length > 1 ? "throw" : "throws"} an \`Error\`.`,
    );
  if (modules.length > 0)
    paragraphs.push(`Without it, importing ${listed(modules.map(module => `\`${module}\``))} throws an \`Error\`.`);
  if (trimFeature.also.length > 0) paragraphs.push(`Also needs it: ${trimFeature.also.join("; ")}.`);
  if (trimFeature.saves) {
    const { linux, macos } = trimFeature.saves;
    paragraphs.push(
      linux < 0.05 && macos < 0.05
        ? "Adds under 0.1 MB by itself."
        : `Adds about ${megabytes(linux)} on Linux x64 and ${megabytes(macos)} on macOS arm64.`,
    );
  }
  return paragraphs;
}

export function declarationsOf(model: FeatureModel, uses: BuiltinUses): string {
  const comment = (paragraphs: string[], indent: string) => [
    `${indent}/**`,
    ...paragraphs.flatMap((paragraph, index) => [...(index > 0 ? [`${indent} *`] : []), ...wrapped(paragraph, indent)]),
    `${indent} */`,
  ];
  const head = [
    "The name of a feature that `compile.trim.allow` of `Bun.build()` keeps in an executable, even if your code never uses it.",
    "Each size is roughly what the feature adds to a trimmed executable. Features share code, and the file only gets shorter where whole pages in a row are removed, so a list usually adds less than the sum of its names.",
    'When `trim` removes a feature, only code is removed: every global, class, prototype, property, method name and constant is still there, so `typeof`, `in` and `instanceof` answer as before. A call, a `new`, a getter or a setter of a removed feature throws an `Error` whose `code` is `"ERR_FEATURE_REMOVED"`, and importing a removed module fails like a module that does not exist (`"ERR_MODULE_NOT_FOUND"`). If code reaches a removed feature any other way, the process prints the feature and exits with code 70. On Windows the data of a removed feature is still in the file for now.',
  ];
  return [
    "// Generated by scripts/build/trim/declarations.ts from src/trim/features/*.def and the built-ins table. Do not edit by hand.",
    "",
    'declare module "bun" {',
    "  namespace Build {",
    ...comment(head, "    "),
    "    type TrimFeature =",
    ...model.trimFeatures.flatMap((trimFeature, index) => [
      ...comment(paragraphsOf(model, uses, trimFeature), "      "),
      `      | "${trimFeature.name}"${index === model.trimFeatures.length - 1 ? ";" : ""}`,
    ]),
    "  }",
    "}",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const usesPath = process.argv[2];
  if (usesPath === undefined) {
    console.error("usage: bun scripts/build/trim/declarations.ts <builtin-uses.json>");
    process.exit(1);
  }
  const model = loadFeatures(join(import.meta.dirname, "..", "..", ".."));
  const uses = readBuiltinUses(usesPath);
  checkBuiltinUses(uses, model, usesPath);
  writeFileSync(declarationsPath, declarationsOf(model, uses));
}
