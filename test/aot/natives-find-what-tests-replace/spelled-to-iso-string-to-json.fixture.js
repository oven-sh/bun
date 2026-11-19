import { test } from "bun:test";
test("to-iso-string-to-json", () => {
  
  const kept = Date.prototype.toISOString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = new Date(turn).toJSON();
  Date.prototype.toISOString = function () { asked++; return 'mocked'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = new Date(turn).toJSON();
  } finally {
    Date.prototype.toISOString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = new Date(turn).toJSON();
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
