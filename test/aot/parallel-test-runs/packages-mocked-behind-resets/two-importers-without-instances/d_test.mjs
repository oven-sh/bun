import { jest, mock, test, vi } from "bun:test";
import { other } from "./other.mjs";
vi.mock("@made-up/relay", () => {
  console.log("factory");
  return { relay: "mock", more: "mock" };
});
test("d", () => console.log("d", other));
