import { test } from "bun:test";
test("to-string-of-list-template", () => {
  
  const kept = Array.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = `${[1, 2, turn]}` + ([turn] + '');
  Array.prototype.toString = function () { asked++; return 'texted'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = `${[1, 2, turn]}` + ([turn] + '');
  } finally {
    Array.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = `${[1, 2, turn]}` + ([turn] + '');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
