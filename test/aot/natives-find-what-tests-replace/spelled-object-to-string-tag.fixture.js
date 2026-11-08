import { test } from "bun:test";
test("object-to-string-tag", () => {
  
  const kept = Object.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = `${{}}` + String({ a: turn }) + ({} + '');
  Object.prototype.toString = function () { asked++; return 'obj'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = `${{}}` + String({ a: turn }) + ({} + '');
  } finally {
    Object.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = `${{}}` + String({ a: turn }) + ({} + '');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
