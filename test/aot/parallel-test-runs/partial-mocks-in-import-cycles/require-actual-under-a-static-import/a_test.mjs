import { jest, mock, test, vi } from "bun:test";
import { describe } from "./shop.mjs";
vi.mock("./price.mjs", () => ({ ...jest.requireActual("./price.mjs"), price: () => "mock price" }));
test("the importer reads the mock while it loads", () => {
  console.log(describe());
});
