import { test } from "bun:test";
import { decorate } from "./app.js";

// String.prototype.replace hands the text to the pattern, and the pattern matches by what it finds under `exec`.
test("a pattern written at the call matches by the exec that the test has stored", () => {
  const real = RegExp.prototype.exec;
  let calls = 0;
  RegExp.prototype.exec = function (text) {
    calls++;
    return real.call(this, text);
  };
  const counted = [decorate(), "abc".replace(/$/, "!")];
  RegExp.prototype.exec = () => null;
  const unmatched = [decorate(), "abc".replace(/$/, "!")];
  RegExp.prototype.exec = real;
  console.log("counted:", counted.join(" "), calls);
  console.log("nothing matches:", unmatched.join(" "));
  console.log("put back:", decorate(), "abc".replace(/$/, "!"));
});
