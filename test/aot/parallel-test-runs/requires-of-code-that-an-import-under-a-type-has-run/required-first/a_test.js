import { test } from "bun:test";
const say = (label, module) => console.log(label, module.value, module.own, "ran", globalThis.barrel ?? 0, globalThis.ran ?? 0);
test("a require in front of the import", async () => {
  const required = require("./barrel.ts");
  say("required", required);
  const typed = await import("./barrel.ts", { with: { type: "ts" } });
  say("typed", typed);
  console.log(required === typed, require("./barrel.ts") === required);
});
