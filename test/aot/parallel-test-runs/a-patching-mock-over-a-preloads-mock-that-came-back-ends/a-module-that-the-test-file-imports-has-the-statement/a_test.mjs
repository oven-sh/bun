import { mock, test, vi } from "bun:test";
import { read } from "./h.mjs";
test("the end of the patch restores nothing", async () => {
  const ask = async () => (await import("./g.cjs")).word;
  const said = [read()];
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
