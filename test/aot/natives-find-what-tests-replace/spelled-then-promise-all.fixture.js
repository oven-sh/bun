import { test } from "bun:test";
test("then-promise-all", () => {
  
  const kept = Promise.prototype.then;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof Promise.all([Promise.resolve(turn)]);
  Promise.prototype.then = function (a, b) { asked++; return kept.call(this, a, b); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof Promise.all([Promise.resolve(turn)]);
  } finally {
    Promise.prototype.then = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof Promise.all([Promise.resolve(turn)]);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
