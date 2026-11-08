import { test } from "bun:test";
test("exec-split", () => {
  
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = ('a,b;c' + turn).split(/[,;]/).join('|');
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = ('a,b;c' + turn).split(/[,;]/).join('|');
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = ('a,b;c' + turn).split(/[,;]/).join('|');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
