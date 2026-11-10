import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 10 }));
  vi.doMock("made-up-pack/side.cjs", () => ({ side: 70 }));
  const { look } = await import("./user.mjs");
  console.log("SAID first", look());
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 30 }));
  console.log("SAID over", look());
  mock.module("made-up-pack/lib.cjs", () => ({ kept: 20 }));
  console.log("SAID over that", look());
  await import("./next.mjs");
  console.log("SAID end", look());
});
