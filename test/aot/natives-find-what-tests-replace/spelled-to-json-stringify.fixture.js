import { test } from "bun:test";
test("to-json-stringify", () => {
  
  const kept = Date.prototype.toJSON;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = JSON.stringify([new Date(turn)]);
  Date.prototype.toJSON = function () { asked++; return 'mocked'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = JSON.stringify([new Date(turn)]);
  } finally {
    Date.prototype.toJSON = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = JSON.stringify([new Date(turn)]);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
