import { test, vi } from "bun:test";
test("the original", async () => {
  vi.doMock("./sieve.mjs", async original => ({ ...(await original()), extra: 1 }));
  vi.doMock("./grain.mjs", async () => ({ grain: "mock, made with " + (await import("./sack.mjs")).seen }));
  console.log("SAID the test imports the file");
  console.log("SAID " + (await import("./grain.mjs")).grain);
}, 2000);
