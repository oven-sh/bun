import { test } from "bun:test";
test("error-to-string-name", () => {
  
  const kept = Error.prototype.name;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Error('m' + turn)) + new TypeError('t').toString();
  Error.prototype.name = 'Renamed';
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Error('m' + turn)) + new TypeError('t').toString();
  } finally {
    Error.prototype.name = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Error('m' + turn)) + new TypeError('t').toString();
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
