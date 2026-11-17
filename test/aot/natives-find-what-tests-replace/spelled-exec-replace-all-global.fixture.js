import { test } from "bun:test";
test("exec-replace-all-global", () => {
  
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = ('abbcb' + turn).replace(/b/g, '-');
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = ('abbcb' + turn).replace(/b/g, '-');
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = ('abbcb' + turn).replace(/b/g, '-');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
