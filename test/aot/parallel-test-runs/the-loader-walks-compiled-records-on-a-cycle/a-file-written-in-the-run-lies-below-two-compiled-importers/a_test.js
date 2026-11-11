import { test } from "bun:test";
import { writeFileSync } from "node:fs";
for (const [name, text] of Object.entries({ "written-p.mjs": `import { q1 } from "./written-q1.mjs"; (globalThis.order ??= []).push("p"); export const p = () => "p" + q1();`, "written-q1.mjs": `import { q2 } from "./written-q2.mjs"; (globalThis.order ??= []).push("q1"); export const q1 = () => "1" + q2();`, "written-q2.mjs": `import { q3 } from "./written-q3.mjs"; (globalThis.order ??= []).push("q2"); export const q2 = () => "2" + q3();`, "written-q3.mjs": `import { q4 } from "./written-q4.mjs"; (globalThis.order ??= []).push("q3"); export const q3 = () => "3" + q4();`, "written-q4.mjs": `import { q5 } from "./written-q5.mjs"; (globalThis.order ??= []).push("q4"); export const q4 = () => "4" + q5();`, "written-q5.mjs": `import { q6 } from "./written-q6.mjs"; (globalThis.order ??= []).push("q5"); export const q5 = () => "5" + q6();`, "written-q6.mjs": `(globalThis.order ??= []).push("q6"); export const q6 = () => "6";` })) writeFileSync(import.meta.dir + "/" + name, text);
const tell = e => e.name + ": " + String(e.message).replace(/["'`][^"'`]*[\\/]/g, "'").slice(0, 70);
test("t", async () => {
  try { console.log("SAID", (await import("./reads.mjs")).seen()); } catch (e) { console.log("SAID threw", tell(e)); }
  try { console.log("SAID through y", (await import("./y.mjs")).seen()); } catch (e) { console.log("SAID through y threw", tell(e)); }
  try { console.log("SAID again", (await import("./reads.mjs")).seen()); } catch (e) { console.log("SAID again threw", tell(e)); }
  console.log("SAID order", String(globalThis.order));
});
