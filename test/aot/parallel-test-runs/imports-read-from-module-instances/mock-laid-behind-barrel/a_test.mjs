import { test, vi, jest, mock, spyOn } from "bun:test";
import * as whole from "./barrel.mjs";
test("reads", async () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += whole.base + whole.twice(i);
  vi.doMock("./lib.mjs", () => ({ base: 100, twice: () => 1 }));
  const mocked = await import("./barrel.mjs");
  let after = 0;
  for (let i = 0; i < 300; i++) after += mocked.base + mocked.twice(i) + whole.base;
  vi.doUnmock("./lib.mjs");
  const back = await import("./barrel.mjs");
  let last = 0;
  for (let i = 0; i < 300; i++) last += back.base + back.twice(i);
  console.log("SAID", sum, after, last, globalThis.ran);
});
