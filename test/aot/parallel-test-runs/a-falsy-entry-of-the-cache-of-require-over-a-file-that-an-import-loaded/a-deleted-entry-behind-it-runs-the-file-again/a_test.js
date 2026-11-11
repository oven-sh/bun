import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const kind = (got, held) => got === held ? "the namespace" : got === held.default ? "the exports" : Object.prototype.toString.call(got) + " " + Object.keys(got).join(",");
test("t", async () => {
  const held = await import("./part.cjs");
  require.cache[key] = undefined;
  const got = require("./part.cjs");
  delete require.cache[key];
  const anew = require("./part.cjs");
  console.log("| " + kind(got, held) + " | " + kind(anew, held) + " | " + anew.x + " | runs " + globalThis.runs);
});
