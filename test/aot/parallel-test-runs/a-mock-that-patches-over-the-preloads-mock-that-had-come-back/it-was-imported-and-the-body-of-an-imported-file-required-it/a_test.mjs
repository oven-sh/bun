import { mock, test, vi } from "bun:test";
const say = async step => console.log("SAID", step, (await import("./greeting.cjs")).word);
test("a", async () => {
  await say("start");
  console.log("SAID asks", (await import("./asks.cjs")).seen);
  vi.doMock("./greeting.cjs", () => ({ word: "one" }));
  await say("one");
  vi.doUnmock("./greeting.cjs");
  await say("back");
  mock.module("./greeting.cjs", () => ({ word: "two" }));
  await say("two");
  vi.doUnmock("./greeting.cjs");
  await say("back again");
});
