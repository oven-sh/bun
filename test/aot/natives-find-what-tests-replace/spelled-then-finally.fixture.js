import { test } from "bun:test";
test("then-finally", () => {
  const settled = Promise.resolve(1); const ignore = () => {};
  const kept = Promise.prototype.then;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof settled.finally(ignore);
  Promise.prototype.then = function (a, b) { asked++; return kept.call(this, a, b); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof settled.finally(ignore);
  } finally {
    Promise.prototype.then = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof settled.finally(ignore);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
