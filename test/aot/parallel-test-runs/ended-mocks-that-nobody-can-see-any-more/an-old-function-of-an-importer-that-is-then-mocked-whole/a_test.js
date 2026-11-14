import { test, vi } from "bun:test";
// keeper.mjs ran for real under a mock of part.mjs and is then loaded wholly as a mock: its old function still reads what it was linked to.
test("t", async () => {
  vi.doMock("./part.mjs", () => ({ word: "mock part" }));
  const old = await import("./keeper.mjs");
  console.log("SAID under", old.read(), await old.later());
  vi.doMock("./keeper.mjs", () => ({ read: () => "mock keeper" }));
  console.log("SAID keeper mocked", (await import("./keeper.mjs")).read(), old.read(), await old.later());
  vi.doUnmock("./part.mjs");
  console.log("SAID part ended", old.read(), await old.later());
  for (let i = 0; i < 3; i++) {
    vi.doMock("./other.mjs", () => ({ word: "mock other" }));
    await import("./other.mjs");
    vi.doUnmock("./other.mjs");
    console.log("SAID behind another end", old.read(), await old.later());
  }
});
