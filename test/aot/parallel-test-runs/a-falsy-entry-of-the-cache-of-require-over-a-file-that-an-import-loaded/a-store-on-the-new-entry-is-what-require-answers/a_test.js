import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const kind = (got, held) => got === held ? "the namespace" : got === held.default ? "the exports" : Object.prototype.toString.call(got) + " " + Object.keys(got).join(",");
test("t", async () => {
  const held = await import("./part.cjs");
  require.cache[key] = undefined;
  require("./part.cjs");
  require.cache[key].exports = { x: "stored" };
  console.log("| " + require("./part.cjs").x + " | " + held.x + " | runs " + globalThis.runs);
});
