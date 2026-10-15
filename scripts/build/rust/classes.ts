/**
 * Whose the classes of a `.classes.ts` file are. Those in the directory of a crate where a feature starts
 * (src/bun_core/feature.rs) are the feature's, like the C and C++ there, and what src/codegen/generate-classes.ts makes of
 * them is compiled with the crate.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseToml, type TomlTable } from "./toml.ts";

export interface CrateWithClasses {
  name: string;
  feature: string;
  /** The names of the files that are generated for it. */
  cpp: string;
  rust: string;
}

/** The manifest of the crate whose directory `file` is in. */
export function manifestOf(file: string): string {
  for (let directory = dirname(resolve(file)); directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "Cargo.toml"))) return join(directory, "Cargo.toml");
  }
  throw new Error(`${file} is not in the directory of a crate`);
}

export function featureCrateOf(classesFile: string): CrateWithClasses | undefined {
  const manifest = manifestOf(classesFile);
  const { name, metadata } = parseToml(readFileSync(manifest, "utf8"), manifest).package as TomlTable;
  const feature = ((metadata as TomlTable | undefined)?.bun as TomlTable | undefined)?.feature;
  if (feature === undefined) return undefined;
  return {
    name: name as string,
    feature: feature as string,
    cpp: `ZigGeneratedClasses.${name}.cpp`,
    rust: `generated_classes.${name}.rs`,
  };
}

export function featureCratesOf(classesFiles: string[]): CrateWithClasses[] {
  const crates = new Map(classesFiles.flatMap(file => featureCrateOf(file) ?? []).map(crate => [crate.name, crate]));
  return [...crates.values()];
}
