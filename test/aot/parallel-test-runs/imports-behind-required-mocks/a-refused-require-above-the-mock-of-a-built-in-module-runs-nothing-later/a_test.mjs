import { mock, test } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers();
  mock.module("node:os", async () => {
    await gate.promise;
    return { default: "mock", platform: "mock" };
  });
  try {
    require("./root.mjs");
  } catch (e) {
    console.log("caught", e.code);
  }
  gate.resolve();
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  console.log("settled");
  await import("./root.mjs");
});
