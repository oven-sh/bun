import { test } from "bun:test";
test("has-set-union", () => {
  
  const kept = Set.prototype.has;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Set([1, turn]).intersection(new Set([1])).size) + new Set([1]).isSubsetOf(new Set([1, 2]));
  Set.prototype.has = function (v) { asked++; return kept.call(this, v); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Set([1, turn]).intersection(new Set([1])).size) + new Set([1]).isSubsetOf(new Set([1, 2]));
  } finally {
    Set.prototype.has = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Set([1, turn]).intersection(new Set([1])).size) + new Set([1]).isSubsetOf(new Set([1, 2]));
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
