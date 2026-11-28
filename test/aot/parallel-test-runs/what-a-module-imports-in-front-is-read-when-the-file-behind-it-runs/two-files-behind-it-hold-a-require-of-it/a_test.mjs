// plain.cjs says nothing of its kind. The test file imports it in front of two CommonJS files that each hold a require of it: it runs sloppy, once.
import { test } from "bun:test";
import "./plain.cjs";
import real from "./real.cjs";
import other from "./other-real.cjs";
test("what the two answer", () => {
  console.log(typeof real.load(), typeof other.load());
});
