import { test, vi } from "bun:test";
import * as reader from "./reader.cjs";
vi.mock("./store.ts", () => ({ get: () => "of the file", put: () => "put of the file" }));
test("requires the mock", () => {
  console.log("1", reader.read());
});
