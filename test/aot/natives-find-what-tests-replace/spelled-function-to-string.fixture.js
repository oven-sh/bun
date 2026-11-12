import { test } from "bun:test";
test("function-to-string", () => {
  const ignore = () => {};
  const kept = Function.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = `${ignore}` + String(ignore) + (ignore + '');
  Function.prototype.toString = function () { asked++; return 'fn'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = `${ignore}` + String(ignore) + (ignore + '');
  } finally {
    Function.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = `${ignore}` + String(ignore) + (ignore + '');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
