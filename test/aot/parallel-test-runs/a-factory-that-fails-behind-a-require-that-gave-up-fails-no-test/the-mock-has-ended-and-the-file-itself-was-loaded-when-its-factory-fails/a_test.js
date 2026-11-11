import { afterEach, expect, test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
afterEach(() => {
  vi.doUnmock("./wick.mjs");
  vi.resetModules();
});
test("gives up while the factory is slow", () => {
  vi.doMock("./wick.mjs", async () => { await rest(200); return { width: "slow" }; });
  expect(() => require("./lamp.mjs")).toThrow();
  console.log("slow");
});
test("gives up on a factory that will fail", () => {
  vi.doMock("./wick.mjs", async () => { await rest(30); throw new RangeError("the factory fails"); });
  expect(() => require("./torch.mjs")).toThrow();
  console.log("down");
});
test("later", async () => {
  console.log(require("./wick.mjs").width);
  await rest(60);
  console.log("later");
});
