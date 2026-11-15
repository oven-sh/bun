import { mock, test } from "bun:test";
import { basename } from "node:path";
test("b", async () => {
  const { user } = await import("./user.mjs");
  console.log("SAID b", user(), basename("/a/own.ts"));
  mock.module("node:path", () => ({ basename: path => "patch of " + path }));
  console.log("SAID b", user(), basename("/a/own.ts"));
});
