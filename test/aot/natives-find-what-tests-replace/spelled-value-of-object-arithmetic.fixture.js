import { test } from "bun:test";
test("value-of-object-arithmetic", () => {
  
  const kept = Object.prototype.valueOf;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String({} * 2) + ({ a: turn } - 1);
  Object.prototype.valueOf = function () { asked++; return 5; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String({} * 2) + ({ a: turn } - 1);
  } finally {
    Object.prototype.valueOf = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String({} * 2) + ({ a: turn } - 1);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
