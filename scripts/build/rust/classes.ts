import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A crate where a feature starts (src/bun_core/feature.rs). */
export interface FeatureCrate {
  /** The name of its directory, which is in the names of what is generated for it. */
  name: string;
  feature: string;
}

/** The manifest of the crate whose directory `file` is in. */
export function manifestOf(file: string): string {
  for (let directory = dirname(resolve(file)); directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "Cargo.toml"))) return join(directory, "Cargo.toml");
  }
  throw new Error(`${file} is not in the directory of a crate`);
}

/**
 * The classes of a `.classes.ts` file in the directory of a crate where a feature starts are the feature's, like the C and C++
 * there. What is generated for them is compiled with the crate: `ZigGeneratedClasses.<name>.cpp`, `generated_classes.<name>.rs`.
 */
export function featureCrateOf(classesFile: string): FeatureCrate | undefined {
  const manifest = manifestOf(classesFile);
  const feature = /^\[package\.metadata\.bun\]\s*\nfeature = "([^"]+)"/m.exec(readFileSync(manifest, "utf8"))?.[1];
  return feature === undefined ? undefined : { name: basename(dirname(manifest)), feature };
}

/** The crates where a feature starts that have classes among `classesFiles`. */
export function featureCratesOf(classesFiles: string[]): FeatureCrate[] {
  const crates = new Map(classesFiles.flatMap(file => featureCrateOf(file) ?? []).map(crate => [crate.name, crate]));
  return [...crates.values()];
}
