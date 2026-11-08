import { test } from "bun:test";
test("value-of-date-arithmetic", () => {
  
  const kept = Date.prototype.valueOf;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Date(turn) - 0) + (+new Date(turn)) + (new Date(turn) > 100);
  Date.prototype.valueOf = function () { asked++; return 7; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Date(turn) - 0) + (+new Date(turn)) + (new Date(turn) > 100);
  } finally {
    Date.prototype.valueOf = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Date(turn) - 0) + (+new Date(turn)) + (new Date(turn) > 100);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
