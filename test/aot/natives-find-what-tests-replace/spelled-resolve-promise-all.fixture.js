import { test } from "bun:test";
test("resolve-promise-all", () => {
  
  const kept = Promise.resolve;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = typeof Promise.all([turn]) + typeof Promise.race([turn]) + typeof Promise.allSettled([turn]);
  Promise.resolve = function (v) { asked++; return kept.call(this, v); };
  try {
    for (let turn = 0; turn < 300; turn++) during = typeof Promise.all([turn]) + typeof Promise.race([turn]) + typeof Promise.allSettled([turn]);
  } finally {
    Promise.resolve = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = typeof Promise.all([turn]) + typeof Promise.race([turn]) + typeof Promise.allSettled([turn]);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
