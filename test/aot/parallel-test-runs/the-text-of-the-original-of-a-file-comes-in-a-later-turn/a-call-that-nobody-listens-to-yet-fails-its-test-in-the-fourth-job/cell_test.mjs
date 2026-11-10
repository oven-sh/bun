import { test, vi } from "bun:test";

// The load of the call behind the mock fails in its fourth job, the call in front hears of it when its text has come. Nobody listens to the call behind by then: it is told of, and the test fails.
test("the call behind the mock is listened to behind the call in front", async () => {
  const front = import("./part.mjs");
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const behind = import("./part.mjs");
  vi.doUnmock("./part.mjs");
  console.log("the calls are made");
  await front.catch(() => {});
  await behind.catch(() => {});
});
