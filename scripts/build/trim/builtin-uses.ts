import { readFileSync } from "node:fs";
import { BuildError } from "../error.ts";
import {
  builtinKinds,
  type BuiltinEntry,
  type BuiltinFeatureUse,
  type BuiltinKind,
  type BuiltinUses,
  type FeatureModel,
  type FeatureName,
} from "./types.ts";

export const builtinUsesVersion = 1;
export const builtinIdLimit = 2 ** 32;

type JsonRecord = Record<string, unknown>;

function fail(message: string, file: string): never {
  throw new BuildError(message, { file });
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isBuiltinKind = (value: unknown): value is BuiltinKind => builtinKinds.includes(value as BuiltinKind);
const isBuiltinId = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < builtinIdLimit;
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

function parseUse(value: unknown, owner: string, path: string): BuiltinFeatureUse {
  if (!isRecord(value)) fail(`${owner} has a use that is not an object`, path);
  const feature = value.feature;
  const isConditional = value.isConditional ?? false;
  if (typeof feature !== "string") fail(`${owner} has a use without a feature`, path);
  if (typeof isConditional !== "boolean")
    fail(`${owner} uses ${feature} with an isConditional that is not a boolean`, path);
  return { feature, isConditional };
}

function parseEntry(value: unknown, position: number, path: string): BuiltinEntry {
  const owner = `entries[${position}]`;
  if (!isRecord(value)) fail(`${owner} is not an object`, path);
  const { id, path: builtinPath, kind, uses, nativeSymbols = [], creationSymbol, hasHiddenRoot = false } = value;
  if (!isBuiltinId(id)) fail(`${owner}.id is not a built-in id`, path);
  if (typeof builtinPath !== "string" || builtinPath === "") fail(`${owner}.path is not a path`, path);
  if (!isBuiltinKind(kind)) fail(`${owner}.kind is unknown: ${String(kind)}`, path);
  if (!Array.isArray(uses) || uses.length === 0) fail(`${owner}.uses is not a list with a member`, path);
  if (!isStringList(nativeSymbols)) fail(`${owner}.nativeSymbols is not a list of strings`, path);
  if (creationSymbol !== undefined && typeof creationSymbol !== "string")
    fail(`${owner}.creationSymbol is not a string`, path);
  if (typeof hasHiddenRoot !== "boolean") fail(`${owner}.hasHiddenRoot is not a boolean`, path);
  return {
    id,
    path: builtinPath,
    kind,
    uses: uses.map(use => parseUse(use, builtinPath, path)),
    nativeSymbols,
    ...(creationSymbol === undefined ? {} : { creationSymbol }),
    hasHiddenRoot,
  };
}

export function parseBuiltinUses(json: unknown, path: string): BuiltinUses {
  if (!isRecord(json)) fail("the built-in uses are not an object", path);
  if (json.version !== builtinUsesVersion) fail(`unknown version of the built-in uses: ${String(json.version)}`, path);
  if (!Array.isArray(json.entries)) fail("the built-in uses have no entries", path);
  return { entries: json.entries.map((entry, position) => parseEntry(entry, position, path)) };
}

export function readBuiltinUses(path: string): BuiltinUses {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new BuildError("cannot read the built-in uses", { file: path, cause });
  }
  return parseBuiltinUses(json, path);
}

// The natives of a module become callable when the module is evaluated, and the loader refuses a module whose feature is gone.
const isNamedByPrograms = ({ kind, hasHiddenRoot }: BuiltinEntry) =>
  !hasHiddenRoot && kind !== "NativeBinding" && kind !== "Module" && kind !== "InternalModule";

export function checkBuiltinUses(uses: BuiltinUses, model: FeatureModel, path: string): void {
  const known = new Set(model.features.map(feature => feature.name));
  // `Feature::all_outside_compiled_programs`: an executable that lacks only these does not look up the native code of its built-ins in the removed ranges.
  const outsidePrograms = new Set(
    model.features
      .filter(({ name, enteredFrom }) => enteredFrom === "command-line" || name === "JIT")
      .map(({ name }) => name),
  );
  let previousId = -1;
  for (const entry of uses.entries) {
    if (entry.id <= previousId) fail(`the id of ${entry.path} does not ascend`, path);
    previousId = entry.id;
    const seen = new Set<string>();
    for (const { feature } of entry.uses) {
      if (!known.has(feature)) fail(`${entry.path} uses ${feature}, which src/trim/features does not declare`, path);
      if (outsidePrograms.has(feature) && isNamedByPrograms(entry))
        fail(`${entry.path} uses ${feature}, which no executable compiled ahead of time has`, path);
      if (seen.has(feature)) fail(`${entry.path} uses ${feature} twice`, path);
      seen.add(feature);
    }
  }
}

export function serializeBuiltinUses(uses: BuiltinUses): string {
  const entries = uses.entries.map(
    ({ id, path, kind, uses: entryUses, nativeSymbols, creationSymbol, hasHiddenRoot }) => ({
      id,
      path,
      kind,
      uses: entryUses.map(({ feature, isConditional }) => (isConditional ? { feature, isConditional } : { feature })),
      ...(nativeSymbols.length > 0 ? { nativeSymbols } : {}),
      ...(creationSymbol === undefined ? {} : { creationSymbol }),
      ...(hasHiddenRoot ? { hasHiddenRoot } : {}),
    }),
  );
  return JSON.stringify({ version: builtinUsesVersion, entries }, null, 2) + "\n";
}

export function entriesById(uses: BuiltinUses): Map<number, BuiltinEntry> {
  return new Map(uses.entries.map(entry => [entry.id, entry]));
}

// The one use that guards the pointer of an entry (`Guards` in src/codegen/builtins/guards.ts).
export function guardFeatureOf(entry: BuiltinEntry): FeatureName | undefined {
  return entry.uses.find(use => !use.isConditional)?.feature;
}

export function featuresWithDeclaredUse(uses: BuiltinUses, model: FeatureModel): Set<number> {
  const indexOf = new Map(model.features.map(feature => [feature.name, feature.index]));
  const used = new Set<number>();
  for (const entry of uses.entries) {
    for (const { feature } of entry.uses) {
      const index = indexOf.get(feature);
      if (index !== undefined) used.add(index);
    }
  }
  return used;
}
