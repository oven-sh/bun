import { test, mock } from "bun:test";
const kind = globalThis.never ?? "file";
const show = (label, loaded) => console.log(label, typeof loaded.default, JSON.stringify(loaded.default)?.replaceAll(import.meta.dir, "."), Object.keys(loaded).sort().join());
test("a file that is loaded as a file is mocked, and imported without a type", async () => {
  show("before", await import("./box.json", { with: { type: kind } }));
  const over = import("./box.json", { with: { type: kind } });
  mock.module("./box.json", () => ({ default: "mocked", tag: "mocked" }));
  show("over", await over);
  show("after", await import("./box.json", { with: { type: kind } }));
  show("without a type", await import("./box.json"));
});
