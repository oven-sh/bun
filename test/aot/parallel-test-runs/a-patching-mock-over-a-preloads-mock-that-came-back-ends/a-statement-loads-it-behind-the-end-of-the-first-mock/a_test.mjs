import { test, vi, mock, jest } from "bun:test";
test("n4", async () => {
  const ask = async () => (await import("./greeting.cjs")).word;
  const said = [];
  said.push(await ask());
  vi.doMock("./greeting.cjs", () => ({ word: "one" }));
  said.push(await ask());
  vi.doUnmock("./greeting.cjs");
  said.push((await import("./helper.mjs")).get());
  mock.module("./greeting.cjs", () => ({ word: "two" }));
  said.push(await ask());
  vi.doUnmock("./greeting.cjs");
  said.push(await ask(), require("./greeting.cjs").word);
  console.log("SAID", "n4", said.join(" "));
});
