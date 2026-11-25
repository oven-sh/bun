import { test } from "bun:test";
test("slice-to-spliced", () => {
  
  const kept = Array.prototype.slice;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String([1, turn].toSpliced(0, 1).length + [1, 2].toSorted().length + [3].toReversed().length + [1].with(0, 2).length);
  Array.prototype.slice = function (...a) { asked++; return kept.apply(this, a); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String([1, turn].toSpliced(0, 1).length + [1, 2].toSorted().length + [3].toReversed().length + [1].with(0, 2).length);
  } finally {
    Array.prototype.slice = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String([1, turn].toSpliced(0, 1).length + [1, 2].toSorted().length + [3].toReversed().length + [1].with(0, 2).length);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
