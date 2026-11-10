// plain.cjs says nothing of its kind. The test file imports it in front of real.cjs, which holds a require of it: the loader has read it as an ES module, and it runs strict, once.
import { test } from "bun:test";
import "./plain.cjs";
import real from "./real.cjs";
test("what the require answers", () => {
  console.log(Object.prototype.toString.call(real.load()));
});
