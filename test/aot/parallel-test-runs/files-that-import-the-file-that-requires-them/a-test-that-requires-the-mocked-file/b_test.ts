import { expect, test, vi } from "bun:test";
import { floorOfRoom } from "./lamp";
vi.mock("./room", (importOriginal) => ({ floor: 5, size: async (value: number) => (await importOriginal<any>()).size(value) }));
test("another floor", () => {
  console.log("SEEN", require("./room").floor, floorOfRoom());
  expect(floorOfRoom()).toBe(5);
});
