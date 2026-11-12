// The package's file holds the originals beside two vi.doMock(). mock.module() over one of them, an unrelated mock and a fresh importer of that file change nothing for it: it is no importer of any mock, so nothing lets it go.
import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("pack/lib.mjs", () => ({ kept: 10 }));
  vi.doMock("pack/side.mjs", () => ({ side: 70 }));
  const { look, beside } = await import("./user.mjs");
  console.log("SAID first", look());
  mock.module("pack/lib.mjs", () => ({ kept: 20 + 0 }));
  console.log("SAID 0 module", look());
  vi.doMock("./n.mjs", () => ({ n: 2 }));
  console.log("SAID 1 other", look());
  await import("./next2.mjs");
  console.log("SAID 2 fresh", look());
  console.log("SAID end", look());
});
