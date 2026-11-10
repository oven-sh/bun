import { test, vi } from "bun:test";
// The mock of part.mjs has ended, and keeper.mjs, which was linked under it, is never loaded anew while mocks over another file come and go.
test("t", async () => {
  vi.doMock("./part.mjs", () => ({ word: "mock part" }));
  const keeper = await import("./keeper.mjs");
  vi.doUnmock("./part.mjs");
  const said = [];
  for (let i = 0; i < 4; i++) {
    vi.doMock("./other.mjs", () => ({ word: "mock other " + i }));
    const other = await import("./other.mjs");
    vi.doUnmock("./other.mjs");
    said.push(keeper.read() + "/" + other.word + "/" + (await keeper.later()));
  }
  console.log("SAID", said.join(" | "));
});
