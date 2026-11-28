import { jest, test, vi } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("the factory runs at once", () => {
  console.log(jest.requireActual("bun") === Bun, typeof require("node:path").join);
  try {
    vi.doMock("bun", () => null);
    console.log("taken");
  } catch (error) {
    console.log(error.name, error.message);
  }
});
