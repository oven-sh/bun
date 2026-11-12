import { test } from "bun:test";
test("set-new-map", () => {
  
  const kept = Map.prototype.set;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Map([[turn, 1]]).size);
  Map.prototype.set = function (k, v) { asked++; return kept.call(this, k, v); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Map([[turn, 1]]).size);
  } finally {
    Map.prototype.set = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Map([[turn, 1]]).size);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
