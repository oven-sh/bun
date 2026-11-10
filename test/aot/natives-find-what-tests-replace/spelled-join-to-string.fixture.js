import { test } from "bun:test";
test("join-to-string", () => {
  
  const kept = Array.prototype.join;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = [1, 2, turn].toString();
  Array.prototype.join = function () { asked++; return 'joined'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = [1, 2, turn].toString();
  } finally {
    Array.prototype.join = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = [1, 2, turn].toString();
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
