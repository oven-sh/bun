// plain.cjs says nothing of its kind. The test file imports it in front of real.cjs, which holds a require of it: it runs sloppy, once.
import { test } from "bun:test";
import "./plain.cjs";
import real from "./real.cjs";
test("what the require answers", () => {
  console.log(Object.prototype.toString.call(real.load()));
});
