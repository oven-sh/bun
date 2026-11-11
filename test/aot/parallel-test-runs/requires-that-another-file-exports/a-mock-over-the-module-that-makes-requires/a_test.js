import { mock, test } from "bun:test";
mock.module("node:module", () => ({ createRequire: () => (name) => "made by the mock" }));
test("the mock makes it", async () => {
  const { askWhole, askShort, askOwn } = await import("./asks.js");
  console.log("SAID", askWhole(), "|", askShort(), "|", askOwn());
});
