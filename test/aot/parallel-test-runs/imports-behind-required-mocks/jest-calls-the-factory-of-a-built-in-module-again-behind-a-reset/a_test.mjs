import { jest, test } from "bun:test";
test("t", async () => {
  let calls = 0;
  jest.doMock("node:os", () => ({ platform: "mock" + ++calls }));
  await import("./first.mjs");
  jest.resetModules();
  await import("./second.mjs");
});
