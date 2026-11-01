// The program names Bun. `build` taken out of it, and called on a copy of it however the copy is made, is Bun.build.
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
const { build } = Bun;
const spread = { build() { return { success: "own", outputs: [] }; }, ...Bun };
const assigned = Object.assign({}, Bun);
console.log(await said(() => build({ entrypoints: [entry] })));
console.log(await said(() => spread.build({ entrypoints: [entry] })));
console.log(await said(() => assigned.build({ entrypoints: [entry] })));
rmSync(folder, { recursive: true });
