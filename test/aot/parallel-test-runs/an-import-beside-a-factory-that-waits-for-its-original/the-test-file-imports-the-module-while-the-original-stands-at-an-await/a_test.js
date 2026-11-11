import { test, vi } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers(), began = Promise.withResolvers();
  globalThis.gate = gate.promise;
  globalThis.began = began.resolve;
  vi.doMock("./part.js", async original => ({ ...(await original()), x: "mocked" }));
  const first = import("./whole.js");
  await began.promise;
  const second = import("./part.js");
  gate.resolve();
  const part = await second;
  console.log("SAID second " + part.x + " " + part.late + " | first " + (await first).seen);
});
