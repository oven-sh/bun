import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const kind = (got, held) => got === held ? "the namespace" : got === held.default ? "the exports" : Object.prototype.toString.call(got) + " " + Object.keys(got).join(",");
test("t", async () => {
  const held = await import("./part.cjs");
  require.cache[key] = undefined;
  require("./part.cjs");
  const made = require.cache[key];
  made.exports = { x: "stored" };
  const one = require("./part.cjs").x;
  require.cache[key] = undefined;
  const two = require("./part.cjs");
  console.log("| " + one + " | " + kind(two, held) + " " + two.x + " | " + (require.cache[key] === made) + " " + kind(require.cache[key].exports, held) + " | runs " + globalThis.runs);
});
