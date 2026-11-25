import { test, vi, jest, mock } from "bun:test";
import { writeFileSync, utimesSync, statSync } from "node:fs";
const kind = globalThis.never ?? "ts";
const name = globalThis.never ?? "a.ts";
const when = statSync(import.meta.dir + "/a.ts").mtimeMs / 1000;
const show = (l, s) => console.log(l, typeof s.default, JSON.stringify(s.default)?.replaceAll(import.meta.dir, "."), Object.keys(s).sort().join(), "ran", globalThis.ran ?? 0, globalThis.barrel ?? 0, globalThis.facade ?? 0);
test("t", async () => {
  try {
  const over = import("./a.ts", { with: { type: "ts" } });
  await null;
  mock.module("./a.ts", () => ({ default: "mocked", tag: "mocked" }));
  show("over", await over);
  show("after0 plain", await import("./a.ts"));
  show("after1 require", require("./a.ts"));
  show("after2 require", require("./a.ts"));
  const twice = import("./a.ts", { with: { type: "ts" } });
  await null;
  mock.module("./a.ts", () => ({ default: "mocked", tag: "mocked" }));
  show("twice", await twice);
  } catch (e) { console.log("error", e.constructor.name); }
});
