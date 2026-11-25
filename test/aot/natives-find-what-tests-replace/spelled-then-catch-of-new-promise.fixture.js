import { test } from "bun:test";
test("then-catch-of-new-promise", () => {
  const ignore = () => {};
  const kept = Promise.prototype.then;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof new Promise((r) => r(turn)).catch(ignore);
  Promise.prototype.then = function (a, b) { asked++; return kept.call(this, a, b); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof new Promise((r) => r(turn)).catch(ignore);
  } finally {
    Promise.prototype.then = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof new Promise((r) => r(turn)).catch(ignore);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
