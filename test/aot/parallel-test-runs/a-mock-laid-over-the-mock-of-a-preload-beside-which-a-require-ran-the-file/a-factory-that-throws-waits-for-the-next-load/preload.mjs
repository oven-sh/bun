import { vi, mock } from "bun:test";
mock.module("./part.cjs", async () => {
  await 0;
  return { a: "of the preload" };
});
globalThis.requiredByThePreload = require("./part.cjs");
