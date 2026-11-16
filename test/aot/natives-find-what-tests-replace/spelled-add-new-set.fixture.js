import { test } from "bun:test";
test("add-new-set", () => {
  
  const kept = Set.prototype.add;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Set([turn, 1]).size);
  Set.prototype.add = function (v) { asked++; return kept.call(this, v); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Set([turn, 1]).size);
  } finally {
    Set.prototype.add = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Set([turn, 1]).size);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
