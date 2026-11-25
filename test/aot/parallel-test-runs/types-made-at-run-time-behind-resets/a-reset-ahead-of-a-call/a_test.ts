import { test, vi } from "bun:test";
const text = globalThis.never ?? "text";
const show = (label, space) => console.log(label, typeof space.default, JSON.stringify(space.default), "ran", globalThis.ran ?? 0);
test("t", async () => {
  show("before", await import("./a.ts", { with: { type: text } }));
  vi.resetModules();
  show("behind the reset", await import("./a.ts", { with: { type: text } }));
  show("require", require("./a.ts"));
  show("import again", await import("./a.ts", { with: { type: text } }));
});
