import { test } from "bun:test";
const say = (label, module) => console.log(label, module.value, module.own, "ran", globalThis.barrel ?? 0, globalThis.ran ?? 0);
import { vi } from "bun:test";
test("a reset between the import and the require", async () => {
  say("typed", await import("./barrel.ts", { with: { type: "ts" } }));
  vi.resetModules();
  say("required", require("./barrel.ts"));
});
