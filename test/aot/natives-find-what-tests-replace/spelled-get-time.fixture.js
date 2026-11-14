import { test } from "bun:test";
test("get-time", () => {
  
  const kept = Date.prototype.getTime;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Date(turn).getTime());
  Date.prototype.getTime = function () { asked++; return 7; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Date(turn).getTime());
  } finally {
    Date.prototype.getTime = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Date(turn).getTime());
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
