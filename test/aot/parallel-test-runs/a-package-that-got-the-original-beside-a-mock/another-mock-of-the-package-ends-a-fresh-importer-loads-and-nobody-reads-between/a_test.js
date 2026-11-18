import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 10 }));
  vi.doMock("made-up-pack/side.cjs", () => ({ side: 70 }));
  const { look } = await import("./user.mjs");
  vi.doUnmock("made-up-pack/side.cjs");
  await import("./next.mjs");
  mock.module("made-up-pack/lib.cjs", () => ({ kept: 20 }));
  console.log("SAID end", look());
});
