import { test } from "bun:test";
import { useTotal } from "./use-total.js";
import { useSum } from "./use-sum.js";
test("caches", () => {
  console.log(useTotal([1, 2]).scaled.join(","), "caches asked for: " + (globalThis.cachesAskedFor ?? 0));
  console.log(useSum([1, 2]).scaled.join(","), "caches asked for: " + (globalThis.cachesAskedFor ?? 0));
});
