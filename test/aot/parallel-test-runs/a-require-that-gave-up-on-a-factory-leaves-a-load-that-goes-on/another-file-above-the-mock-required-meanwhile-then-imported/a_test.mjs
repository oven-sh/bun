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
  vi.doMock("./thread.mjs", async () => {
    await rest(5);
    return { width: "mocked" };
  });
  console.log(
    "SAID spool",
    asked(() => require("./spool.mjs")),
  );
  vi.resetModules();
  console.log(
    "SAID reel meanwhile",
    asked(() => require("./reel.mjs")),
  );
  await rest(40);
  console.log(
    "SAID reel",
    await import("./reel.mjs").then(
      it => it.seen,
      () => "rejected",
    ),
  );
});
