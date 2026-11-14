import { test } from "bun:test";
test("a written text is replaced by the method that is there", () => {
  const original = String.prototype.replace;
  let calls = 0;
  String.prototype.replace = function (pattern, text) {
    calls++;
    return "patched:" + original.call(this, pattern, text);
  };
  const atEnd = "abc".replace(/$/, "!");
  const atStart = "abc".replace(/^/, "!");
  String.prototype.replace = original;
  console.log(atEnd, atStart, calls);
});
