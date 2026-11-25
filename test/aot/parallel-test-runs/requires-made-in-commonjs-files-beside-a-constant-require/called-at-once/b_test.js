import { test } from "bun:test";
test("b", () => {
  const held = require("./part.cjs");
  const got = globalThis.later?.();
  console.log("b", held.count(), got?.count(), got === held);
});
