import { test } from "bun:test";
import { writeFileSync, utimesSync, statSync } from "node:fs";
const kind = globalThis.never ?? "js";
const when = statSync(import.meta.dir + "/a.ts").mtimeMs / 1000;
const show = async (label, get) => {
  try {
    const m = await get();
    console.log(label, Object.keys(m).join(), typeof m.default, JSON.stringify(m.default), "ran", globalThis.ran ?? 0);
  } catch (error) {
    console.log(label, "threw", error.name, "ran", globalThis.ran ?? 0);
  }
};
const save = () => {
  writeFileSync(import.meta.dir + "/a.ts", "globalThis.ran = (globalThis.ran ?? 0) + 1;\nexport default \"a new text\";\n");
  utimesSync(import.meta.dir + "/a.ts", when + 20, when + 20);
};
test("t", async () => {
  await show("plain", () => import("./a.ts"));
  save();
  await show("typed", () => import("./a.ts", { with: { type: kind } }));
  await show("typed again", () => import("./a.ts", { with: { type: kind } }));
  await show("plain again", () => import("./a.ts"));
});
