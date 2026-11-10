// mock.module() reaches the files of a package, so the package's file is linked to the mock. vi.doMock() gives a package the original, but only one that is linked under it: laid later, it changes nothing for a file that is linked already.
import { test, vi, mock } from "bun:test";
test("t", async () => {
  mock.module("pack/lib.mjs", () => ({ kept: 10 }));
  mock.module("pack/side.mjs", () => ({ side: 70 }));
  const { look, beside } = await import("./user.mjs");
  console.log("SAID first", look());
  vi.doMock("pack/lib.mjs", () => ({ kept: 30 }));
  console.log("SAID vi", look());
});
