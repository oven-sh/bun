import { test } from "bun:test";
test("index-of-includes", () => {
  
  const kept = Array.prototype.indexOf;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String([1, turn].includes(turn)) + [1, turn].lastIndexOf(1);
  Array.prototype.indexOf = function () { asked++; return 0; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String([1, turn].includes(turn)) + [1, turn].lastIndexOf(1);
  } finally {
    Array.prototype.indexOf = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String([1, turn].includes(turn)) + [1, turn].lastIndexOf(1);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
