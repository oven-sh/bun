import { test } from "bun:test";
import { product, products } from "./app.js";
import { put } from "./tools.js";

// No file spells Math.imul beside a store: the object and the name come to the store of a helper in another file.
test("the code under test calls what the helper has stored", () => {
  const real = Math.imul;
  console.log("as made:", product(3, 4), products(4));
  put(Math, "imul", () => 7);
  console.log("replaced:", product(3, 4), products(4), Math.imul === real);
  put(Math, "imul", real);
  console.log("put back:", product(3, 4), products(4), Math.imul === real);
});
