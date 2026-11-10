import { test, mock, vi } from "bun:test";
const say = async (word, work) => {
  try {
    console.log("SAID", word, String(await work()));
  } catch (error) {
    console.log("SAID", word, error.name);
  }
};
test("a ring of statements", async () => {
  vi.doMock("./first.mjs", () => ({ x: "mock of first", own: "mocked" }));
  vi.doMock("./second.mjs", () => ({ x: "mock of second", own: "mocked" }));
  vi.doMock("./third.mjs", () => ({ x: "mock of third", own: "mocked" }));
  await say("under first", async () => (await import("./first.mjs")).x);
  await say("under second", async () => (await import("./second.mjs")).x);
  await say("under third", async () => (await import("./third.mjs")).x);
  vi.doUnmock("./first.mjs");
  vi.doUnmock("./second.mjs");
  vi.doUnmock("./third.mjs");
  await say("behind first", async () => (await import("./first.mjs")).x);
  await say("behind second", async () => (await import("./second.mjs")).x);
  await say("behind third", async () => (await import("./third.mjs")).x);
});
