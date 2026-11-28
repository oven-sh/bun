import { test } from "bun:test";
const say = (label, module) => console.log(label, module.value, module.own, "ran", globalThis.barrel ?? 0, globalThis.ran ?? 0);
test("an import without a type in front of the require", async () => {
  const typed = await import("./barrel.ts", { with: { type: "ts" } });
  say("typed", typed);
  const plain = await import("./barrel.ts");
  say("plain", plain);
  const required = require("./barrel.ts");
  say("required", required);
  console.log(required === typed, required === plain);
});
