import { test, vi } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);

test("a mock of another file does not get in the way", async () => {
  vi.doMock("./src/other.cjs", () => ({ word: "mock" }));
  console.log((await import("./src/other.cjs")).word);
  console.log(load("./src/user.cjs").describe(1));
  console.log(load("./src/other.cjs").word);
});
