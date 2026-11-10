import { test, vi, mock } from "bun:test";
test("a2", async () => {
  const ask = async () => (await import("./greeting.cjs")).word;
  const said = [];
  said.push(require("./greeting.cjs").word);
  vi.resetModules();
  said.push((await import("./helper.mjs")).get());
  said.push(await ask());
  vi.doMock("./greeting.cjs", () => ({ word: "one" }));
  said.push(await ask());
  vi.doUnmock("./greeting.cjs");
  said.push(await ask());
  mock.module("./greeting.cjs", () => ({ word: "two" }));
  said.push(await ask());
  vi.doUnmock("./greeting.cjs");
  said.push(await ask());
  console.log("SAID", "a", said.join(" "), "bodies", globalThis.bodies ?? 0, "factories", globalThis.factories ?? 0);
});
