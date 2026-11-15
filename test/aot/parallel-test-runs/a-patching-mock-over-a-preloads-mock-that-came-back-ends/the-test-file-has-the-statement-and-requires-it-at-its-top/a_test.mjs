import { mock, test, vi } from "bun:test";
import { word } from "./g.cjs";
const required = require("./g.cjs").word;
test("the end of the patch restores what the require loaded", async () => {
  const ask = async () => (await import("./g.cjs")).word;
  const said = [word, required];
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  said.push(await ask());
  vi.doUnmock("./g.cjs");
  said.push(await ask());
  mock.module("./g.cjs", () => ({ word: "patch" }));
  said.push(await ask());
  vi.doUnmock("./g.cjs");
  said.push(await ask());
  console.log("SAID", said.join(" | "), "runs", globalThis.runs ?? 0, "factories", globalThis.factories ?? 0);
});
