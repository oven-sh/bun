import { jest, test, vi } from "bun:test";
test("the second pass finds nothing loaded", async () => {
  jest.doMock("./lib.mjs", async original => {
    console.log("the factory is called");
    return { ...(await original()), a: "first" };
  });
  await new Promise(done => setTimeout(done, 1));
  console.log("mocked");
  vi.doMock("./lib.mjs", () => ({ a: "second" }));
  vi.doUnmock("./lib.mjs");
  console.log("runs", globalThis.runs);
});
