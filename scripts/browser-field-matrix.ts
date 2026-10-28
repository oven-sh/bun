// <bun> scripts/browser-field-matrix.ts
// Builds every layout of test/bundler/browser-field-matrix.ts with the bun that runs this script and with esbuild,
// and prints the layouts where the two disagree about which files an import of a package with a "browser" map loads.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bun, esbuild, layouts, table } from "../test/bundler/browser-field-matrix";

const module = await import("esbuild");
const all = layouts().map(layout => ({ ...layout, name: `${layout.group}: ${layout.name}` }));
const root = mkdtempSync(join(realpathSync(tmpdir()), "browser-field-matrix-"));
const [ours, theirs] = [
  await table(join(root, "bun"), all, bun),
  await table(join(root, "esbuild"), all, esbuild(module, join(root, "esbuild"))),
];
rmSync(root, { recursive: true, force: true });

let same = 0;
for (const { name } of all) {
  if (ours[name] === theirs[name]) same++;
  else console.log(`${name}\n  bun ${Bun.version}:     ${ours[name]}\n  esbuild ${module.version}: ${theirs[name]}`);
}
console.log(JSON.stringify({ layouts: all.length, same, differ: all.length - same }));
