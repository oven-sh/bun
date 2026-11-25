import { test } from "bun:test";
test("map-get-group-by", () => {
  
  const kept = Map.prototype.get;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(Map.groupBy([1, turn], (x) => x % 2).size) + new Map([[1, 2]]).has(1);
  Map.prototype.get = function (k) { asked++; return kept.call(this, k); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(Map.groupBy([1, turn], (x) => x % 2).size) + new Map([[1, 2]]).has(1);
  } finally {
    Map.prototype.get = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(Map.groupBy([1, turn], (x) => x % 2).size) + new Map([[1, 2]]).has(1);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
