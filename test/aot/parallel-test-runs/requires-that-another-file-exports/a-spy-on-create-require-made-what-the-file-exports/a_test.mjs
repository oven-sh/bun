import { spyOn, test } from "bun:test";
import Module from "node:module";
test("it answers", async () => {
  const spy = spyOn(Module, "createRequire").mockImplementation(() => (name) => "made by the spy for " + name);
  const { ask } = await import("./asks.mjs");
  console.log("SAID", ask(), spy.mock.calls.length);
  spy.mockRestore();
});
