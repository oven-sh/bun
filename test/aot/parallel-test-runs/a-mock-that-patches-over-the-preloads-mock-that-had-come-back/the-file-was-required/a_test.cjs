const { mock, test, vi } = require("bun:test");
const say = step => console.log("SAID", step, require("./greeting.cjs").word);
test("a", () => {
  say("start");
  vi.doMock("./greeting.cjs", () => ({ word: "one" }));
  say("one");
  vi.doUnmock("./greeting.cjs");
  say("back");
  mock.module("./greeting.cjs", () => ({ word: "two" }));
  say("two");
  vi.doUnmock("./greeting.cjs");
  say("back again");
});
