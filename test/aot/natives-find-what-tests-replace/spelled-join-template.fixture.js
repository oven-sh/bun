import { test } from "bun:test";
test("join-template", () => {
  
  const kept = Array.prototype.join;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = `${[1, 2, turn]}`;
  Array.prototype.join = function () { asked++; return 'joined'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = `${[1, 2, turn]}`;
  } finally {
    Array.prototype.join = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = `${[1, 2, turn]}`;
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
