import { jest, mock, test, vi } from "bun:test";
import { other } from "./other.mjs";
vi.mock("@made-up/relay", () => {
  console.log("factory");
  throw new Error("called");
});
test("d", () => console.log("d", other));
