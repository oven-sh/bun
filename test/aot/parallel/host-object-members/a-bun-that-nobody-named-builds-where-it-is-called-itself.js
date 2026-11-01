// The program comes to Bun by listing the globals and never names it. `build` called on that object itself, not on a copy, is Bun.build.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "copy-of-bun-"));
const entry = join(folder, "entry.js");
writeFileSync(entry, "console.log(6 * 7);");
async function said(use) {
  try {
    const result = await use();
    return result.success + " " + result.outputs.length;
  } catch (error) {
    return error.name + ": " + error.message.split(" because")[0];
  }
}
const name = ["B", "un"].join(process.argv.length > 99 ? "x" : "");
const found = Object.values(globalThis)[Object.keys(globalThis).indexOf(name)];
console.log(await said(() => found.build({ entrypoints: [entry] })));
rmSync(folder, { recursive: true });
