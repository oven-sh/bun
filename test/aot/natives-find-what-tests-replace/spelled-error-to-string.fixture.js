import { test } from "bun:test";
test("error-to-string", () => {
  
  const kept = Error.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(new Error('m')) + `${new RangeError('r')}`;
  Error.prototype.toString = function () { asked++; return 'err'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(new Error('m')) + `${new RangeError('r')}`;
  } finally {
    Error.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(new Error('m')) + `${new RangeError('r')}`;
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
