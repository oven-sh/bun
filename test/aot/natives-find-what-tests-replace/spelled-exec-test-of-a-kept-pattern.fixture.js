import { test } from "bun:test";
test("exec-test-of-a-kept-pattern", () => {
  const pattern = /b+/;
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(pattern.test('abbc' + turn));
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(pattern.test('abbc' + turn));
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(pattern.test('abbc' + turn));
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
