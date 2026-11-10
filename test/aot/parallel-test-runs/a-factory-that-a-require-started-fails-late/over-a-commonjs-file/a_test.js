import { jest, mock, test, vi } from "bun:test";
const ask = road => { try { return String(road().x); } catch (error) { return error.constructor.name; } };
const turn = () => new Promise(resolve => setImmediate(resolve));
test("t", async () => {
  let fail, settle, calls = 0;
  vi.doMock("./part.cjs", () => new Promise((resolve, reject) => { calls++; fail = reject; settle = resolve; }));
  const required = () => require("./part.cjs");
  const imported = () => import("./part.cjs").then(all => all.x, error => error.constructor.name);
  console.log("SAID", ask(required));
  fail(new RangeError("late"));
  console.log("SAID failed");
  await turn();
  console.log("SAID behind the turn", calls);
});
