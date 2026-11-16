import { test } from "bun:test";
test("then-catch", () => {
  const settled = Promise.resolve(1); const ignore = () => {};
  const kept = Promise.prototype.then;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof settled.catch(ignore);
  Promise.prototype.then = function (a, b) { asked++; return kept.call(this, a, b); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof settled.catch(ignore);
  } finally {
    Promise.prototype.then = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof settled.catch(ignore);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
