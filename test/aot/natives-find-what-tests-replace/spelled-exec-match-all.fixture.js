import { test } from "bun:test";
test("exec-match-all", () => {
  
  const kept = RegExp.prototype.exec;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String([...('abbcb' + turn).matchAll(/b+/g)].length);
  RegExp.prototype.exec = function (t) { asked++; return kept.call(this, t); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String([...('abbcb' + turn).matchAll(/b+/g)].length);
  } finally {
    RegExp.prototype.exec = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String([...('abbcb' + turn).matchAll(/b+/g)].length);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
