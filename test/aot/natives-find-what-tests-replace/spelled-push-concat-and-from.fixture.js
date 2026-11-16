import { test } from "bun:test";
test("push-concat-and-from", () => {
  
  const kept = Array.prototype.push;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String([1].concat([turn]).length + Array.from([turn]).length + Array.of(1, 2).length + [1, 2].map((x) => x).length);
  Array.prototype.push = function (...a) { asked++; return kept.apply(this, a); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String([1].concat([turn]).length + Array.from([turn]).length + Array.of(1, 2).length + [1, 2].map((x) => x).length);
  } finally {
    Array.prototype.push = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String([1].concat([turn]).length + Array.from([turn]).length + Array.of(1, 2).length + [1, 2].map((x) => x).length);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
