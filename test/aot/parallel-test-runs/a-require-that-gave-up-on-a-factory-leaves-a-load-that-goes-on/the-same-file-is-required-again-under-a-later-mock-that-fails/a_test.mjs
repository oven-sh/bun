import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const asked = load => {
  try {
    return String(load().seen);
  } catch (error) {
    return "threw " + error.name;
  }
};
test("t", async () => {
  vi.doMock("./thread.mjs", () => new Promise(() => {}));
  console.log(
    "SAID spool",
    asked(() => require("./spool.mjs")),
  );
  vi.doMock("./thread.mjs", async () => {
    await rest(5);
    return { width: "mocked" };
  });
  console.log(
    "SAID reel",
    asked(() => require("./reel.mjs")),
  );
  await rest(20);
  vi.doMock("./thread.mjs", async () => {
    await rest(5);
    throw new Error("the third factory");
  });
  console.log(
    "SAID spool again",
    asked(() => require("./spool.mjs")),
  );
  await rest(60);
  console.log("SAID the end");
});
