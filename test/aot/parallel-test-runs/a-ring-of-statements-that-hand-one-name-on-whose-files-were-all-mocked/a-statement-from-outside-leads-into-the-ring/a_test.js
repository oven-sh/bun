import { test, mock, vi } from "bun:test";
const say = async (word, work) => {
  try {
    console.log("SAID", word, String(await work()));
  } catch (error) {
    console.log("SAID", word, error.name);
  }
};
test("a ring of statements", async () => {
  vi.doMock("./first.mjs", () => ({ x: "mock of first", y: "y of first" }));
  vi.doMock("./second.mjs", () => ({ x: "mock of second", y: "y of second" }));
  await say("under first", async () => (await import("./first.mjs")).x);
  await say("under second", async () => (await import("./second.mjs")).x);
  vi.doUnmock("./first.mjs");
  vi.doUnmock("./second.mjs");
  await say("outer", async () => (await import("./outer.mjs")).x);
});
