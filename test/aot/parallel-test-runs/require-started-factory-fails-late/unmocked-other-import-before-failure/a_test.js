import { test, vi } from "bun:test";
test("t", async () => {
  let fail, calls = 0, said;
  vi.doMock("./part.js", () => new Promise((resolve, reject) => { calls++; fail = reject; }));
  try { said = String(require("./part.js").x); } catch (error) { said = error.name; }
  vi.doUnmock("./part.js");
  console.log("SAID", (await import("./other.js")).y);
  fail(new RangeError("late"));
  for (let job = 0; job < 8; job++) await 0;
  console.log("SAID", said, calls);
});
test("next", () => console.log("SAID next"));
