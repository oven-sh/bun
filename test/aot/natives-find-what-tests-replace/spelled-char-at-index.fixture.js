import { test } from "bun:test";
test("char-at-index", () => {
  
  const kept = String.prototype.charAt;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = ('ab' + turn)[0] + ('ab' + turn).at(0) + ('ab' + turn).charAt(0);
  String.prototype.charAt = function () { asked++; return '?'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = ('ab' + turn)[0] + ('ab' + turn).at(0) + ('ab' + turn).charAt(0);
  } finally {
    String.prototype.charAt = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = ('ab' + turn)[0] + ('ab' + turn).at(0) + ('ab' + turn).charAt(0);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
