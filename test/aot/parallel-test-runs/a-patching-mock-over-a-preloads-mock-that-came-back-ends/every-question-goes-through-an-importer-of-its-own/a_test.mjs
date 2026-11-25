import { test, vi, mock } from "bun:test";
test("a6", async () => {
  const ask = async () => (await import("./greeting.cjs")).word;
  const said = [];
  const by = async name => (await import("./" + name + ".mjs")).get();
  said.push(await by("h0"));
  vi.doMock("./greeting.cjs", () => ({ word: "one" }));
  said.push(await by("h1"));
  vi.doUnmock("./greeting.cjs");
  said.push(await by("h2"));
  mock.module("./greeting.cjs", () => ({ word: "two" }));
  said.push(await by("h3"));
  vi.doUnmock("./greeting.cjs");
  said.push(await by("h4"));
  console.log("SAID", "a6", said.join(" "));
});
