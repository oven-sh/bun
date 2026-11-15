import { test, vi } from "bun:test";
test("t", async () => {
  let other;
  const say = what => console.log("SAID " + what, under.late(), "|", other ? other.late() : "not yet");
  vi.doMock("node:path", () => ({ sep: "mock" }));
  const under = await import("./reader.mjs");
  say("under");
  vi.doMock("node:path", () => ({ sep: "second" }));
  say("the second is laid");
  vi.doUnmock("node:path");
  say("ended");
  await import("node:path");
  say("behind a load");
});
