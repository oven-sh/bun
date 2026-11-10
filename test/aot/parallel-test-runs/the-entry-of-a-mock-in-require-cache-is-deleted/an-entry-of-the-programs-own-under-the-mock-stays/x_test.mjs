import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs"), said = [];
const ask = step => { try { said.unshift(step + " " + require("./part.cjs").x); } catch (error) { said.unshift(step + " threw " + String(error?.message).slice(0, 30)); } };
test("x", () => {
  vi.doMock("./part.cjs", () => ({ x: "mock" })); ask("mocked"); require.cache[key] = { exports: { x: "stored" } }; ask("stored");
   vi.doUnmock("./part.cjs"); ask("ended");
  console.log("SAID x part ran", globalThis.ran?.part ?? 0, "|", said.join(" | "));
});
