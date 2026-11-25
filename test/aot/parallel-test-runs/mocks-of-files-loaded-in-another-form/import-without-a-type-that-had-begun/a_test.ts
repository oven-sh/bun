import { test, mock } from "bun:test";
const kind = globalThis.never ?? "text";
const show = (label, loaded) => console.log(label, typeof loaded.default, JSON.stringify(loaded.default), Object.keys(loaded).sort().join());
test("an import that had begun keeps the file", async () => {
  show("typed", await import("./crate.toml", { with: { type: kind } }));
  console.log(require("./crate.toml").default === undefined);
  const over = import("./crate.toml");
  mock.module("./crate.toml", () => ({ default: "mocked", tag: "mocked" }));
  show("over", await over);
  show("after typed", await import("./crate.toml", { with: { type: kind } }));
});
