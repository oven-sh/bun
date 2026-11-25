import { test, mock } from "bun:test";
import { writeFileSync, utimesSync, statSync } from "node:fs";
import path from "node:path";
const kind = globalThis.never ?? "file";
const when = statSync(import.meta.dir + "/a.ts").mtimeMs / 1000;
const show = (label, m) => console.log(label, typeof m.default, typeof m.default === "string" ? path.basename(m.default) : JSON.stringify(m.default), "ran", globalThis.ran ?? 0);
const save = () => {
  writeFileSync(import.meta.dir + "/a.ts", "globalThis.ran = (globalThis.ran ?? 0) + 1;\nexport default \"a new text\";\n");
  utimesSync(import.meta.dir + "/a.ts", when + 20, when + 20);
};
test("t", async () => {
  const name = globalThis.never ?? "a.ts";
  show("plain", await import("./a.ts"));
  save();
  show("typed", await import("./" + name, { with: { type: kind } }));
  show("typed again", await import("./" + name, { with: { type: kind } }));
});
