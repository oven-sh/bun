import { test } from "bun:test";
const say = (label, module) => console.log(label, module.value, module.own, "ran", globalThis.barrel ?? 0, globalThis.ran ?? 0);
test("a require of what an import has run", async () => {
  const typed = await import("./barrel.ts", { with: { type: "ts" } });
  say("typed", typed);
  const required = require("./barrel.ts");
  say("required", required);
  console.log(required === typed, require("./barrel.ts") === required);
  say("without a type", await import("./barrel.ts"));
  console.log(require("./barrel.ts") === required);
});
