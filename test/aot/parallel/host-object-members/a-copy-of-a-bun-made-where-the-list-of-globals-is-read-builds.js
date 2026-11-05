// The program comes to Bun by listing the globals and never names it. A copy made right where the list is read is a copy of Bun, and `build` called on it is Bun.build.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "copy-of-bun-"));
const entry = join(folder, "entry.js");
writeFileSync(entry, "console.log(6 * 7);");
const name = ["B", "un"].join(process.argv.length > 99 ? "x" : "");
const values = Object.values(globalThis);
const index = Object.keys(globalThis).indexOf(name);
const source = values[index];
const x = { build() { return { success: "own", outputs: [] }; }, ...source };
try {
  const result = await x.build({ entrypoints: [entry] });
  console.log(result.success, result.outputs.length);
} catch (error) {
  console.log(error.name + ": " + error.message.split(" because")[0]);
}
rmSync(folder, { recursive: true });
