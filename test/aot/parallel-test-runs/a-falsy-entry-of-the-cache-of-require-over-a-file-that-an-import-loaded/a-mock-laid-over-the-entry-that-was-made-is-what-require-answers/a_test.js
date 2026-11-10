import { test, vi, mock } from "bun:test";
const key = require.resolve("./part.cjs");
const kind = (got, held) => got === held ? "the namespace" : got === held.default ? "the exports" : Object.prototype.toString.call(got) + " " + Object.keys(got).join(",");
test("t", async () => {
  const held = await import("./part.cjs");
  require.cache[key] = undefined;
  const one = require("./part.cjs");
  mock.module("./part.cjs", () => ({ x: "mock" }));
  const two = require("./part.cjs");
  console.log("| " + kind(one, held) + " | " + kind(two, held) + " " + two.x + " | " + (await import("./part.cjs")).x + " | runs " + globalThis.runs);
});
