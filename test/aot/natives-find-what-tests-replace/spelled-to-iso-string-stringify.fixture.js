import { test } from "bun:test";
test("to-iso-string-stringify", () => {
  
  const kept = Date.prototype.toISOString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = JSON.stringify({ d: new Date(turn) });
  Date.prototype.toISOString = function () { asked++; return 'mocked'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = JSON.stringify({ d: new Date(turn) });
  } finally {
    Date.prototype.toISOString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = JSON.stringify({ d: new Date(turn) });
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
