import { jest, test } from "bun:test";
import * as own from "node:path";
test("b", async () => {
  const { user } = await import("./user.mjs");
  console.log("SAID b", user(), own.basename("/a/own.ts"));
  jest.doMock("node:path", () => ({ basename: () => "mock of b" }));
  console.log("SAID b", user(), own.basename("/a/own.ts"));
});
