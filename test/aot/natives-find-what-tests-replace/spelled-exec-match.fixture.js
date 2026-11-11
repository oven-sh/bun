import { test } from "bun:test";
test("exec-match", () => {
  
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(('abbc' + turn).match(/b+/));
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(('abbc' + turn).match(/b+/));
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(('abbc' + turn).match(/b+/));
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
