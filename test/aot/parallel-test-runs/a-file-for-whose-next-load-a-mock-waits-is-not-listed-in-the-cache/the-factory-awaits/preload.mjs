import { mock } from "bun:test";
mock.module("./part.cjs", async () => {
  await 0;
  return { a: "mocked" };
});
globalThis.requiredByThePreload = require("./part.cjs");
globalThis.listedInThePreload = require.resolve("./part.cjs") in require.cache;
