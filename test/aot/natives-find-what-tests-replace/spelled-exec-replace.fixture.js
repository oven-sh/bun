import { test } from "bun:test";
test("exec-replace", () => {
  
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = ('abbc' + turn).replace(/b+/, '-');
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = ('abbc' + turn).replace(/b+/, '-');
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = ('abbc' + turn).replace(/b+/, '-');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
