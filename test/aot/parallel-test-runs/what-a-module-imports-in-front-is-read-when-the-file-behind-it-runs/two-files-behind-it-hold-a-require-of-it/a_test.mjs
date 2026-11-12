// plain.cjs says nothing of its kind. The test file imports it in front of two CommonJS files that each hold a require of it: the loader has read it as an ES module, and it runs strict, once.
import { test } from "bun:test";
import "./plain.cjs";
import real from "./real.cjs";
import other from "./other-real.cjs";
test("what the two answer", () => {
  console.log(typeof real.load(), typeof other.load());
});
