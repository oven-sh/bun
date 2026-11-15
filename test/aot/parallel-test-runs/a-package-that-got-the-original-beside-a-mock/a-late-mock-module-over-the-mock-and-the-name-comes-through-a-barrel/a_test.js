import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 10 }));
  const { look } = await import("./user.mjs");
  console.log("SAID first", look("kept"), look("other"));
  vi.doMock("./n.mjs", () => ({ n: 2 }));
  const late = mock.module("made-up-pack/lib.cjs", async () => { await 0; return { kept: 20 }; });
  console.log("SAID last", look("kept"));
  await late;
  console.log("SAID behind", look("kept"));
});
