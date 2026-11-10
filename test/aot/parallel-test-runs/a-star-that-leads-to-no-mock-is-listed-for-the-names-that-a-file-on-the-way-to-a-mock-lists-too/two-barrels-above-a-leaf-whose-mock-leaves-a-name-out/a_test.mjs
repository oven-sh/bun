import { test, mock } from "bun:test";
test("what the mock of the leaf leaves out stays out", async () => {
  mock.module("./leaf.mjs", () => ({ kept: "mock" }));
  mock.module("./lib.mjs", async () => ({ ...(await import("./lib.mjs")), added: 1 }));
  for (const path of ["./above.mjs", "./lib.mjs"]) {
    const space = await import(path);
    console.log("SAID", path, Object.keys(space).join(), "gone" in space);
  }
});
