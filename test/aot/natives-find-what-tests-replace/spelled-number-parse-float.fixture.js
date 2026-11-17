import { test } from "bun:test";
test("number-parse-float", () => {
  
  const kept = Number.parseFloat;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(parseFloat('1.5')) + Number('2.5') + Number.parseFloat('3.5');
  Number.parseFloat = function () { asked++; return -1; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(parseFloat('1.5')) + Number('2.5') + Number.parseFloat('3.5');
  } finally {
    Number.parseFloat = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(parseFloat('1.5')) + Number('2.5') + Number.parseFloat('3.5');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
