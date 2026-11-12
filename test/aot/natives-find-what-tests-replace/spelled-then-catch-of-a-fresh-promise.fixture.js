import { test } from "bun:test";
test("then-catch-of-a-fresh-promise", () => {
  const ignore = () => {};
  const kept = Promise.prototype.then;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof Promise.resolve(turn).catch(ignore);
  Promise.prototype.then = function (a, b) { asked++; return kept.call(this, a, b); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof Promise.resolve(turn).catch(ignore);
  } finally {
    Promise.prototype.then = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof Promise.resolve(turn).catch(ignore);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
