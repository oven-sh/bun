import { test } from "bun:test";
test("to-string-date-concat", () => {
  
  const kept = Date.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = new Date(turn) + '' + `${new Date(turn)}`;
  Date.prototype.toString = function () { asked++; return 'when'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = new Date(turn) + '' + `${new Date(turn)}`;
  } finally {
    Date.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = new Date(turn) + '' + `${new Date(turn)}`;
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
