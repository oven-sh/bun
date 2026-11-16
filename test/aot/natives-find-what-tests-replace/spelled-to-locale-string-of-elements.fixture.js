import { test } from "bun:test";
test("to-locale-string-of-elements", () => {
  
  const kept = Number.prototype.toLocaleString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = [1, turn].toLocaleString();
  Number.prototype.toLocaleString = function () { asked++; return 'n'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = [1, turn].toLocaleString();
  } finally {
    Number.prototype.toLocaleString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = [1, turn].toLocaleString();
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
