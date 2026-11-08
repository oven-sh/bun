import { test } from "bun:test";
test("reg-exp-to-string-source", () => {
  
  const kept = RegExp.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(/a/) + `${/b/g}`;
  RegExp.prototype.toString = function () { asked++; return 're'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(/a/) + `${/b/g}`;
  } finally {
    RegExp.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(/a/) + `${/b/g}`;
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
