// Checks the prototype path functions against the vectors of the reference.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as t from "../../../enumerator/prototype/tspath";
import * as m from "./tspath_more";
const file = process.argv[2] ?? import.meta.dir + "/../vectors/paths.jsonl.gz";
const raw = readFileSync(file);
const text = file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
const fns: Record<string, (name: string, dir: string) => unknown> = {
  getNormalizedAbsolutePath: (n, d) => t.getNormalizedAbsolutePath(n, d),
  normalizePath: n => t.normalizePath(n),
  getDirectoryPath: n => t.getDirectoryPath(n),
  getBaseFileName: n => t.getBaseFileName(n),
  getRootLength: n => Buffer.byteLength(n.slice(0, t.getRootLength(n)), "utf8"),
  isRootedDiskPath: n => t.isRootedDiskPath(n),
  combinePaths: (n, d) => t.combinePaths(d, n),
  toPathCaseSensitive: (n, d) => t.toPath(n, d),
  getAnyExtensionFromPath: n => t.getAnyExtensionFromPath(n),
  hasExtension: n => m.hasExtension(n),
  fileExtensionIsDts: n => m.fileExtensionIs(n, ".d.ts"),
  fileExtensionIsJson: n => m.fileExtensionIs(n, ".json"),
  fileExtensionIsTsBuildInfo: n => m.fileExtensionIs(n, ".tsbuildinfo"),
  changeExtensionTs: n => m.changeExtension(n, ".ts"),
  getNormalizedPathComponents: (n, d) => m.getNormalizedPathComponents(n, d),
  getPathComponents: (n, d) => m.getPathComponents(n, d),
  containsPathDirName: (n, d) => m.containsPath(d, n, d),
  containsPathNameDir: (n, d) => m.containsPath(n, d, d),
  convertToRelativePath: (n, d) => m.convertToRelativePath(n, d),
  removeTrailingDirectorySeparator: n => t.removeTrailingDirectorySeparator(n),
};
const bad: Record<string, number> = {};
const shown: Record<string, number> = {};
let rows = 0;
for (const l of text.split("\n")) {
  if (l === "") continue;
  rows++;
  const r = JSON.parse(l);
  for (const [k, f] of Object.entries(fns)) {
    let got: unknown;
    try { got = f(r.name, r.dir); } catch (e) { got = "throw " + (e as Error).message; }
    if (JSON.stringify(got) !== JSON.stringify(r[k])) {
      bad[k] = (bad[k] ?? 0) + 1;
      if ((shown[k] = (shown[k] ?? 0) + 1) <= 4) console.log(k, JSON.stringify([r.name, r.dir]), "port", JSON.stringify(got), "reference", JSON.stringify(r[k]));
    }
  }
}
console.log(JSON.stringify({ rows, functions: Object.keys(fns).length, mismatches: bad }));
