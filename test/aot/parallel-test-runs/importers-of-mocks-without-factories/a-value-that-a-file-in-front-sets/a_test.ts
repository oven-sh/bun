import { expect, test, vi } from "bun:test";
import { where } from "./app";
vi.mock("./logger");
test("region comes from setup", () => {
  expect(where()).toBe("eu");
});
