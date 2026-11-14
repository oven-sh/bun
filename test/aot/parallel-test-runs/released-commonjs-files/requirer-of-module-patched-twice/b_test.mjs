import { test } from "bun:test";
import { write } from "./store.mjs";
test("b", () => {
  const legacy = require("./legacy.cjs");
  console.log("SAID b", write(), legacy.write(), legacy.raw.write === write);
});
