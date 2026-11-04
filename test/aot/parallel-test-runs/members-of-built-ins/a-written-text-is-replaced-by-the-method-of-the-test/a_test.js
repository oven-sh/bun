import { test } from "bun:test";
import { decorate } from "./app.js";

// The text, the pattern and what is put in are all written at the call. An executable knows the answer at the build, where the method is locked.
test("the call on a written text finds what the test has stored", () => {
  const real = String.prototype.replace;
  let calls = 0;
  console.log("as made:", decorate(), "abc".replace(/$/, "!"));
  String.prototype.replace = function (pattern, text) {
    calls++;
    return "patched:" + real.call(this, pattern, text);
  };
  const found = [decorate(), "abc".replace(/$/, "!")];
  String.prototype.replace = real;
  console.log("replaced:", found.join(" "), calls);
  console.log("put back:", decorate(), "abc".replace(/$/, "!"), calls);
});
