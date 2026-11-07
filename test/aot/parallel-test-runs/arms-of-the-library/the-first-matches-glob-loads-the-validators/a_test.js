import { test } from "bun:test";
import path from "node:path";

test("the first matchesGlob() loads the module that tests its operands", () => {
  const real = Object.defineProperty;
  let calls = 0;
  Object.defineProperty = function (...all) {
    calls++;
    return real.apply(Object, all);
  };
  let answer;
  try {
    answer = path.matchesGlob("a/b.js", "a/*.js");
  } finally {
    Object.defineProperty = real;
  }
  console.log(answer, "calls of Object.defineProperty:", calls);
});
