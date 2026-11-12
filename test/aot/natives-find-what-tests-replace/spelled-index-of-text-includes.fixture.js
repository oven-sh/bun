import { test } from "bun:test";
test("index-of-text-includes", () => {
  
  const kept = String.prototype.indexOf;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(('ab' + turn).includes('b')) + ('ab' + turn).startsWith('a') + ('ab' + turn).indexOf('b');
  String.prototype.indexOf = function () { asked++; return 0; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(('ab' + turn).includes('b')) + ('ab' + turn).startsWith('a') + ('ab' + turn).indexOf('b');
  } finally {
    String.prototype.indexOf = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(('ab' + turn).includes('b')) + ('ab' + turn).startsWith('a') + ('ab' + turn).indexOf('b');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
