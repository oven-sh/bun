import { test, vi } from "bun:test";
vi.doMock("lib", async original => {
  console.log("SAID the factory begins");
  return { ...(await original()), version: "mocked" };
});
test("the package keeps the original, the program gets the mock", async () => {
  console.log("SAID", (await import("./index.ts")).both());
});
