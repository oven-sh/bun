import { test, mock, jest } from "bun:test";
const key = require.resolve("./part.mjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const x = () => tried(async () => (await import("./part.mjs")).x);
const count = () => globalThis.ran?.part ?? 0;
let calls = 0;
test("x", async () => {
  mock.module("./part.mjs", () => ({ x: "mock " + ++calls }));
  const mocked = await x();
  delete require.cache[key];
  jest.resetModules();
  const behind = await x();
  console.log("SAID x part ran", count(), "| behind the reset", behind, "calls", calls, "| mocked", mocked);
});
