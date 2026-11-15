import { test } from "bun:test";
test("to-string-of-elements-in-join", () => {
  
  const kept = Number.prototype.toString;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = [1, turn].join() + String(turn) + `${turn}` + (turn + '');
  Number.prototype.toString = function () { asked++; return 'n'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = [1, turn].join() + String(turn) + `${turn}` + (turn + '');
  } finally {
    Number.prototype.toString = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = [1, turn].join() + String(turn) + `${turn}` + (turn + '');
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
