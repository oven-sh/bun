import { test } from "bun:test";
test("values-spread", () => {
  
  const kept = Array.prototype.values;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String([...[1, turn]].length);
  Array.prototype.values = function () { asked++; return kept.call(this); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String([...[1, turn]].length);
  } finally {
    Array.prototype.values = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String([...[1, turn]].length);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
