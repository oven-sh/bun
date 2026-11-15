const { mock, test, vi } = require("bun:test");
const say = async step => console.log("SAID", step, (await import("pack/greeting.cjs")).word);
test("a", async () => {
  vi.doMock("pack/greeting.cjs", () => ({ word: "one" }));
  await say("one");
  vi.doUnmock("pack/greeting.cjs");
  mock.module("pack/greeting.cjs", () => ({ word: "two" }));
  vi.doUnmock("pack/greeting.cjs");
  await say("back");
  mock.module("pack/greeting.cjs", () => ({ word: "three" }));
  vi.doUnmock("pack/greeting.cjs");
  await say("back again");
});
