import { test, vi } from "bun:test";

// Six jobs behind the call the load in flight has asked for the original of the file. It runs, though the mock that took it has been replaced, and the call gets the new mock.
test("the body runs once and the call gets the second mock", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), first: 1 }));
  const load = import("./part.mjs");
  for (let job = 0; job < 6; job++) await 0;
  vi.doMock("./part.mjs", () => ({ second: 2 }));
  console.log("came", Object.keys(await load).join(), "| bodies", String(globalThis.timesRun));
});
