import { test, vi, jest, mock } from "bun:test";
import { writeFileSync, utimesSync, statSync } from "node:fs";
const kind = globalThis.never ?? "text";
const name = globalThis.never ?? "a.ts";
const when = statSync(import.meta.dir + "/a.ts").mtimeMs / 1000;
const show = (l, s) => console.log(l, typeof s.default, JSON.stringify(s.default)?.replaceAll(import.meta.dir, "."), Object.keys(s).sort().join(), "ran", globalThis.ran ?? 0, globalThis.barrel ?? 0, globalThis.facade ?? 0);
test("t", async () => {
  try {
  show("before require", require("./a.ts"));
  show("before require", require("./a.ts"));
  const over = import("./a.ts", { with: { type: "text" } });
  writeFileSync(import.meta.dir + "/a.ts", "globalThis.ran = (globalThis.ran ?? 0) + 1;\nexport default \"c0de\";\nexport const tag = \"tag\";\n// longer\n"); utimesSync(import.meta.dir + "/a.ts", when + 20, when + 20);
  show("over", await over);
  show("after0 typed", await import("./a.ts", { with: { type: "text" } }));
  show("after1 plain", await import("./a.ts"));
  } catch (e) { console.log("error", e.constructor.name); }
});
