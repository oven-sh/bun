import { test } from "bun:test";
import * as first from "./lib.mjs";
import "./helper.cjs";
import { late } from "./late.mjs";
test("x", async () => {
  const called = await import("./lib.mjs");
  console.log(first.used(), late(), called.used(), called === first, require("./lib.mjs").used === first.used);
});
