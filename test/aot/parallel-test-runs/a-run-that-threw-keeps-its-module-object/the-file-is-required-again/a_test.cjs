const { test } = require("bun:test");
test("a", () => {
  let kept;
  globalThis.keep = it => { kept = it; };
  try { require("./flaky.cjs"); } catch (error) { console.log("SAID threw", error.message); }
  const helper = require("./helper.cjs");
  console.log("SAID 1", helper.mine.parent === kept, kept.children.length);
  const again = require("./flaky.cjs");
  console.log("SAID 2", again.mine === kept, again.mine.children.length, helper.mine.parent === kept);
});
