import { test, mock, vi } from "bun:test";
const say = async (word, work) => {
  try {
    console.log("SAID", word, String(await work()));
  } catch (error) {
    console.log("SAID", word, error.name);
  }
};
test("a ring of statements", async () => {
  mock.module("./first.mjs", () => ({ x: "mock of first", own: "mocked" }));
  mock.module("./second.mjs", () => ({ x: "mock of second", own: "mocked" }));
  await say("under first", async () => (await import("./first.mjs")).x);
  await say("under second", async () => (await import("./second.mjs")).x);
  mock.restore();
  await say("behind first", async () => (await import("./first.mjs")).x);
  await say("behind second", async () => (await import("./second.mjs")).x);
});
