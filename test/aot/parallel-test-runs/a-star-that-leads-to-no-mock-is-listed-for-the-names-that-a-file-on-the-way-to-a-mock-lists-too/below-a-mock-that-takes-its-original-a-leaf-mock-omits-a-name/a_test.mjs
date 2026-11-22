import { test, mock } from "bun:test";
test("what the mock of the leaf leaves out stays out", async () => {
  mock.module("./attic.mjs", () => ({ loft: 5 }));
  mock.module("./shelf.mjs", async () => ({ ...(await import("./shelf.mjs")), extra: 1 }));
  for (const path of ["./roof.mjs", "./porch.mjs", "./shelf.mjs"]) {
    const space = await import(path);
    console.log("SAID", path, Object.keys(space).join(), "gone" in space);
  }
});
