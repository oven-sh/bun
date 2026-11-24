import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const kind = (got, held) => got === held ? "the namespace" : got === held.default ? "the exports" : Object.prototype.toString.call(got) + " " + Object.keys(got).join(",");
test("t", async () => {
  const held = await import("./part.cjs");
  const before = require.cache[key];
  require.cache[key] = undefined;
  const look = typeof require.cache[key];
  require("./part.cjs");
  const after = require.cache[key];
  console.log("| " + [before === globalThis.own, look, after === before, after === globalThis.own, kind(after.exports, held), after.id === key, after.filename === key, after.loaded].join(" "));
});
