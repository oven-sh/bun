import { test } from "bun:test";
test("math-floor-round", () => {
  
  const kept = Math.floor;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(Math.round(turn + 0.4)) + Math.trunc(turn + 0.5) + Math.ceil(turn + 0.5) + (turn / 2 | 0);
  Math.floor = function () { asked++; return -1; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(Math.round(turn + 0.4)) + Math.trunc(turn + 0.5) + Math.ceil(turn + 0.5) + (turn / 2 | 0);
  } finally {
    Math.floor = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(Math.round(turn + 0.4)) + Math.trunc(turn + 0.5) + Math.ceil(turn + 0.5) + (turn / 2 | 0);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
