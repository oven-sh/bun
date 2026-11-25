import { test } from "bun:test";
import path from "node:path";

test("matchesGlob() tests its operands while Object.defineProperty is replaced", () => {
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
  let refused;
  try {
    path.matchesGlob(1, "a/*.js");
  } catch (error) {
    refused = error.code;
  }
  console.log(answer, refused, "calls of Object.defineProperty:", calls);
});
