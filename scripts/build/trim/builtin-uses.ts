import { readFileSync } from "node:fs";
import { BuildError } from "../error.ts";
import { isOutsideCompiledPrograms } from "./features.ts";
import { type BuiltinEntry, type BuiltinUses, type FeatureModel, type FeatureName } from "./types.ts";

function fail(message: string, file: string): never {
  throw new BuildError(message, { file });
}

export function readBuiltinUses(path: string): BuiltinUses {
  return JSON.parse(readFileSync(path, "utf8")) as BuiltinUses;
}

// The natives of a module become callable when the module is evaluated, and the loader refuses a module whose feature is gone.
const isNamedByPrograms = ({ kind, hasHiddenRoot }: BuiltinEntry) =>
  !hasHiddenRoot && kind !== "NativeBinding" && kind !== "Module" && kind !== "InternalModule";

export function checkBuiltinUses(uses: BuiltinUses, model: FeatureModel, path: string): void {
  const known = new Set(model.features.map(feature => feature.name));
  // An executable that lacks only these does not look up the native code of its built-ins in the removed ranges.
  const outsidePrograms = new Set(model.features.filter(isOutsideCompiledPrograms).map(({ name }) => name));
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
  return JSON.stringify(uses, null, 2) + "\n";
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
