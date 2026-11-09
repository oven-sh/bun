import { test } from "bun:test";
import Module from "node:module";
test("it answers", async () => {
  const real = Module.createRequire;
  Module.createRequire = () => (name) => "made by what was stored for " + name;
  const { ask } = await import("./asks.mjs");
  console.log("SAID", ask());
  Module.createRequire = real;
});
