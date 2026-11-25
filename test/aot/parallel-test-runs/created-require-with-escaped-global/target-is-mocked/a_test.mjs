import { test, vi } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);

test("the created require sees a mock of its target", () => {
  vi.doMock("./src/user.cjs", () => ({ describe: () => "mock" }));
  console.log(load("./src/user.cjs").describe(1));
});
