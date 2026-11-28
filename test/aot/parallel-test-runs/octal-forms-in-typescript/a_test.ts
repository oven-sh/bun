import { test } from "bun:test";
import { decimal, literal } from "./forms";
const box = { "\101": 1 };
test("the octal forms of JavaScript", () => {
  console.log(literal, decimal, "\101", "\8", "\60x", Object.keys(box)[0]);
  console.log((() => 010 + 1)());
});
