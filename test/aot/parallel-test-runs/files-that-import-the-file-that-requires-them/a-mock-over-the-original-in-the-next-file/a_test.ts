import { expect, test, vi } from "bun:test";
import { floorByLamp, size } from "./room";
vi.mock("./door", () => ({ width: () => 3 }));
test("a narrow door", () => {
  console.log("SEEN", size(1), floorByLamp());
  expect(size(1)).toBe(106);
});
