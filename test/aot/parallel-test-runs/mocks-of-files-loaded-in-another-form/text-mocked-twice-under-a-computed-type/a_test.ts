import { test, mock } from "bun:test";
const kind = globalThis.never ?? "text";
const show = (label, loaded) => console.log(label, typeof loaded.default, JSON.stringify(loaded.default), Object.keys(loaded).sort().join());
test("a file that is loaded as text is mocked twice under a computed type", async () => {
  show("before", await import("./box.json", { with: { type: kind } }));
  const over = import("./box.json", { with: { type: kind } });
  mock.module("./box.json", () => ({ default: "mocked", tag: "mocked" }));
  show("over", await over);
  show("after", await import("./box.json", { with: { type: kind } }));
  const twice = import("./box.json", { with: { type: kind } });
  mock.module("./box.json", () => ({ default: "mocked", tag: "mocked" }));
  show("twice", await twice);
});
