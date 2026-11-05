// The test file imports plain.cjs behind below.mjs, which imports real.cjs. What the test file imports was asked for when it was read: sooner than anything below below.mjs.
import { test } from "bun:test";
import { load } from "./below.mjs";
import "./plain.cjs";
test("what the require answers", () => {
  console.log(Object.prototype.toString.call(load()));
});
