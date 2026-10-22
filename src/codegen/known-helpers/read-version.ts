import path from "node:path";
import { withoutRepeats, type FoundFunction } from "./definitions.ts";
import { folderNameOf } from "./packages.ts";
import { readBabel, readBabelRuntime } from "./readers/babel.ts";
import { readBun, readRolldown, readRollup } from "./readers/bundlers.ts";
import { readEsbuild } from "./readers/esbuild.ts";
import { readSwc, readSwcHelpers } from "./readers/swc.ts";
import { readTslib } from "./readers/tslib.ts";
import { readTypeScript } from "./readers/typescript.ts";
import { loadParser } from "./syntax.ts";

export interface Reader {
  readonly read: (folder: string) => FoundFunction[] | Promise<FoundFunction[]>;
  readonly sources: readonly string[];
}

export const sourcesOfEveryReader = ["syntax.ts", "definitions.ts", "probes.ts"];

export const readers: Record<string, Reader> = {
  "tslib": { read: readTslib, sources: ["readers/tslib.ts"] },
  "typescript": { read: readTypeScript, sources: ["readers/typescript.ts", "probes"] },
  "esbuild-linux-64": { read: readEsbuild, sources: ["readers/esbuild.ts", "probes", "bundle-probes"] },
  "@esbuild/linux-x64": { read: readEsbuild, sources: ["readers/esbuild.ts", "probes", "bundle-probes"] },
  "@oven/bun-linux-x64": { read: readBun, sources: ["readers/bundlers.ts", "probes", "bundle-probes"] },
  "rolldown": { read: readRolldown, sources: ["readers/bundlers.ts", "bundle-probes"] },
  "rollup": { read: readRollup, sources: ["readers/bundlers.ts", "bundle-probes"] },
  "@babel/runtime": { read: readBabelRuntime, sources: ["readers/babel.ts", "readers/helper-files.ts"] },
  "@babel/core": { read: readBabel, sources: ["readers/babel.ts", "readers/helper-files.ts", "probes"] },
  "@swc/helpers": { read: readSwcHelpers, sources: ["readers/swc.ts", "readers/helper-files.ts"] },
  "@swc/core": { read: readSwc, sources: ["readers/swc.ts", "readers/helper-files.ts", "probes"] },
};

if (import.meta.main) {
  const [packagesArgument, name, version] = process.argv.slice(2);
  const packages = path.resolve(packagesArgument);
  await loadParser(packages);
  const found = await readers[name].read(path.join(packages, folderNameOf(name, version)));
  await Bun.write(Bun.stdout, JSON.stringify(withoutRepeats(found)));
  process.exit(0);
}
